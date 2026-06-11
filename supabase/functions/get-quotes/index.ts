import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from 'https://deno.land/x/zipjs@v2.7.52/index.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, x-api-key, content-type',
};

// --- Security: API key + lightweight rate limiting (best-effort, in-memory) ---
const REQUIRED_API_KEY = (Deno.env.get('EDGE_FUNCTIONS_API_KEY') ?? '').trim();

type RateBucket = { tokens: number; lastRefillMs: number };
const rateBuckets = new Map<string, RateBucket>();

function isFromOurApp(req: Request): boolean {
  try {
    const origin = (req.headers.get('origin') ?? '').trim();

    const apikey = (req.headers.get('apikey') ?? '').trim();
    const expectedAnon = (Deno.env.get('SUPABASE_ANON_KEY') ?? '').trim();
    const expectedPub = (Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '').trim();

    const apikeyMatches =
      (!!apikey && !!expectedAnon && apikey === expectedAnon) ||
      (!!apikey && !!expectedPub && apikey === expectedPub);

    // Primary: trusted app origin (configure hosts via ALLOWED_ORIGIN_HOSTS secret)
    if (origin) {
      const host = new URL(origin).hostname.toLowerCase();
      const allowed = (Deno.env.get('ALLOWED_ORIGIN_HOSTS') ?? '')
        .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
      if (allowed.some((h) => host === h || host.endsWith('.' + h))) return true;
    }

    // Fallback: apikey matches this project's public/anon key
    return apikeyMatches;
  } catch {
    return false;
  }
}

function getClientIp(req: Request): string {
  const xfwd = req.headers.get('x-forwarded-for');
  if (xfwd) return xfwd.split(',')[0].trim();
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function allowRequest(ip: string, opts?: { capacity?: number; refillPerSec?: number }): boolean {
  const capacity = opts?.capacity ?? 60; // burst
  const refillPerSec = opts?.refillPerSec ?? 1; // ~60/min

  const now = Date.now();
  const b = rateBuckets.get(ip) ?? { tokens: capacity, lastRefillMs: now };
  const elapsedSec = Math.max(0, (now - b.lastRefillMs) / 1000);
  const refill = elapsedSec * refillPerSec;
  const tokens = Math.min(capacity, b.tokens + refill);

  const allowed = tokens >= 1;
  rateBuckets.set(ip, { tokens: allowed ? tokens - 1 : tokens, lastRefillMs: now });
  return allowed;
}

// Bump this string whenever you change this function, so the UI can confirm
// the deployed version.
const FUNCTION_VERSION = '2026-01-20T15:10Z';

// ------------------
// In-memory cache (best-effort)
// - Persiste enquanto o mesmo runtime estiver “quente”
// - Pode ser perdido a qualquer momento (cold start / restart)
// ------------------
const CACHE_TTL_NAME_MS = 24 * 60 * 60 * 1000; // 24h (nome muda raramente)
// CACHE_TTL_INF_ZIP_MS removido: não há mais cache do CSV monolítico (anti-OOM).
const CACHE_TTL_QUOTA_MS = 6 * 60 * 60 * 1000; // 6h (cota só muda 1x/dia)
const CACHE_TTL_ANBIMA_TPF_MS = 30 * 60 * 1000; // 30min (atualiza ao longo do dia)


type CacheEntry<T> = { value: T; fetchedAt: number };

const cvmNameCache = new Map<string, CacheEntry<string>>(); // cnpj(14) -> nome
const cvmRegistroCsvCache = new Map<string, CacheEntry<string>>(); // url -> csv text
// REMOVIDO: cvmInfDiarioCsvCache (armazenava 150-300MB de CSV como string -- OOM).
// Substituído por cvmQuotaHistoryCache + scanInfDiarioForCnpjs (granular, anti-OOM).
const cvmQuotaHistoryCache = new Map<
  string,
  CacheEntry<{ latest: { quota: number; asOfDate: string }; previous: { quota: number; asOfDate: string } | null }>
>(); // cnpj(14) -> { latest, previous }

// ANBIMA (Tesouro Direto)
const anbimaTpfCache = new Map<string, CacheEntry<any[]>>(); // key='tpf' -> items

// Dedupe de fetches simultâneos (evita estourar CPU e rede quando há vários itens no mesmo request)
const inFlightCsv = new Map<string, Promise<string | null>>();
// REMOVIDO: inFlightInfDiario (não necessário com o scanner granular por CNPJ)
const inFlightAnbimaTpf = new Map<string, Promise<any[]>>();


function isFresh(entry: CacheEntry<any> | undefined, ttlMs: number) {
  return !!entry && Date.now() - entry.fetchedAt < ttlMs;
}

async function fetchCachedCsv(url: string, ttlMs: number): Promise<string | null> {
  const cached = cvmRegistroCsvCache.get(url);
  if (isFresh(cached, ttlMs)) return cached!.value;

  const existing = inFlightCsv.get(url);
  if (existing) return await existing;

  const p = (async () => {
    const regResp = await fetch(url, {
      headers: { 'User-Agent': 'InvestPro/1.0', Accept: 'text/csv,*/*' },
    });

    console.log('[CVM][CACHE] fetch csv', { url, ok: regResp.ok, status: regResp.status });
    if (!regResp.ok) return null;

    const bytes = new Uint8Array(await regResp.arrayBuffer());
    const csv = new TextDecoder('latin1').decode(bytes);
    cvmRegistroCsvCache.set(url, { value: csv, fetchedAt: Date.now() });
    return csv;
  })();

  inFlightCsv.set(url, p);
  try {
    return await p;
  } finally {
    inFlightCsv.delete(url);
  }
}

/**
 * Recupera as últimas 2 cotas de cada CNPJ solicitado no arquivo INF_DIÁRIO do mês indicado.
 *
 * ESTRATÉGIA ANTI-OOM:
 * - Baixa o ZIP em streaming (arrayBuffer necessário para zip.js, mas é o menor custo possível).
 * - Decomprime via zip.js e percorre o CSV byte-a-byte em linha-a-linha SEM materializar
 *   a string gigante do arquivo completo (150-300MB descompactado) em memória de uma vez só.
 * - Retorna apenas um Map<cnpj, {latest, previous}> com os CNPJs solicitados.
 * - O arquivo ZIP comprimido (~5-15MB) é descartado assim que a varredura termina.
 *   Nunca armazenamos o CSV descompactado completo no cache.
 */
async function scanInfDiarioForCnpjs(
  yyyymm: string,
  targets: Set<string>
): Promise<Record<string, { latest: { quota: number; asOfDate: string }; previous: { quota: number; asOfDate: string } | null } | null>> {
  const out: Record<string, { latest: { quota: number; asOfDate: string }; previous: { quota: number; asOfDate: string } | null } | null> =
    Object.fromEntries(Array.from(targets).map((c) => [c, null]));

  const zipUrl = `https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${yyyymm}.zip`;
  const resp = await fetch(zipUrl, {
    headers: { 'User-Agent': 'InvestPro/1.0', Accept: '*/*' },
  });

  console.log('[CVM][INF_DIARIO] fetch zip', { yyyymm, ok: resp.ok, status: resp.status, targets: targets.size });
  if (!resp.ok) return out;

  // O ZIP comprimido é tipicamente 5-15MB — aceitável em RAM.
  const zipBytes = new Uint8Array(await resp.arrayBuffer());
  const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));

  try {
    const entries = await (zipReader as any).getEntries();
    const csvEntry = entries.find((e: any) => String(e?.filename ?? '').toLowerCase().endsWith('.csv'));
    if (!csvEntry || typeof (csvEntry as any).getData !== 'function') return out;

    // Decomprime o CSV completo — inevitável com zip.js (sem streaming interno).
    // Recebemos Uint8Array (bytes puros), que é muito mais econômico que uma string JS.
    // Uma string JS em UTF-16 custaria ~2x o tamanho; o Uint8Array custa 1x.
    const csvBytes: Uint8Array = await (csvEntry as any).getData(new Uint8ArrayWriter());

    // Varredura linha-a-linha SEM converter para string completa.
    // Processamos em latin-1 (ISO-8859-1): cada byte é um char code ≤ 255,
    // então podemos ler direto do buffer sem TextDecoder de bloco completo.
    let lineStart = 0;
    let headerParsed = false;
    let idxCnpj = -1, idxDate = -1, idxQuota = -1;

    // Resultado parcial (cotas mais recentes encontradas)
    const latestBy: Record<string, { quota: number; asOfDate: string }> = {};
    const previousBy: Record<string, { quota: number; asOfDate: string }> = {};

    const decodeLatinSlice = (start: number, end: number): string => {
      let s = '';
      for (let k = start; k < end; k++) s += String.fromCharCode(csvBytes[k]);
      return s;
    };

    for (let pos = 0; pos <= csvBytes.length; pos++) {
      const atEnd = pos === csvBytes.length;
      const ch = atEnd ? 10 : csvBytes[pos]; // trata EOF como \n

      if (ch !== 10 /* \n */ && !atEnd) continue;

      // extrai linha (descarta \r se existir)
      const lineEnd = (pos > 0 && csvBytes[pos - 1] === 13) ? pos - 1 : pos;
      if (lineEnd <= lineStart) { lineStart = pos + 1; continue; }

      const line = decodeLatinSlice(lineStart, lineEnd);
      lineStart = pos + 1;

      if (!line.trim()) continue;

      const cols = line.split(';');

      if (!headerParsed) {
        const headerUpper = cols.map((h) => h.replace(/^\uFEFF/, '').trim().toUpperCase());
        const preferred = ['CNPJ_FUNDO_CLASSE', 'CNPJ_CLASSE', 'CNPJ_SUBCLASSE', 'CNPJ_FUNDO'];
        for (const key of preferred) {
          const idx = headerUpper.findIndex((h) => h === key);
          if (idx !== -1) { idxCnpj = idx; break; }
        }
        if (idxCnpj === -1) idxCnpj = headerUpper.findIndex((h) => h.includes('CNPJ'));
        idxDate = headerUpper.findIndex((h) => h === 'DT_COMPTC');
        idxQuota = headerUpper.findIndex((h) => h === 'VL_QUOTA');
        headerParsed = true;
        if (idxCnpj === -1 || idxDate === -1 || idxQuota === -1) {
          console.warn('[CVM][INF_DIARIO] colunas não encontradas', { idxCnpj, idxDate, idxQuota });
          break;
        }
        continue;
      }

      const cnpj = normalizeCnpj((cols[idxCnpj] ?? '').trim());
      if (!targets.has(cnpj)) continue;

      const date = (cols[idxDate] ?? '').trim();
      const quota = Number((cols[idxQuota] ?? '').trim().replace(',', '.'));
      if (!Number.isFinite(quota) || !date) continue;

      const existingLatest = latestBy[cnpj];
      if (!existingLatest || date > existingLatest.asOfDate) {
        previousBy[cnpj] = existingLatest ?? previousBy[cnpj];
        latestBy[cnpj] = { quota, asOfDate: date };
      } else if (date < existingLatest.asOfDate) {
        const existingPrev = previousBy[cnpj];
        if (!existingPrev || date > existingPrev.asOfDate) {
          previousBy[cnpj] = { quota, asOfDate: date };
        }
      }
    }

    for (const cnpj of Array.from(targets)) {
      const latest = latestBy[cnpj];
      if (latest) {
        out[cnpj] = { latest, previous: previousBy[cnpj] ?? null };
      }
    }

    console.log('[CVM][INF_DIARIO] scan concluído', {
      yyyymm,
      zipKb: Math.round(zipBytes.length / 1024),
      csvLines: lineStart,
      found: Object.values(out).filter(Boolean).length,
    });
  } finally {
    await (zipReader as any).close();
  }

  return out;
}

// Cache granular: cnpj -> {latest, previous} com TTL de 6h (cota só muda 1x/dia)
// Substituiu o cvmInfDiarioCsvCache (que armazenava 150-300MB de CSV como string)
const cvmScanResultCache = new Map<
  string,
  CacheEntry<{ latest: { quota: number; asOfDate: string }; previous: { quota: number; asOfDate: string } | null }>
>();

// In-flight deduplication por (yyyymm + cnpj)
const inFlightScan = new Map<string, Promise<void>>();

interface QuoteResponse {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  name: string;
  currency: string;
  updatedAt: string;
  error?: string;

  // Opcional: data de competência (útil para fundos CVM)
  asOfDate?: string;
}

// Fetch from Yahoo Finance (works for Brazilian stocks with .SA suffix)
async function fetchYahooQuote(ticker: string): Promise<QuoteResponse | null> {
  try {
    // Add .SA suffix for Brazilian stocks if not present
    const yahooTicker = ticker.includes('.') ? ticker : `${ticker}.SA`;
    
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?interval=1d&range=1d`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.log(`Yahoo Finance error for ${ticker}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result) {
      console.log(`No Yahoo data for ${ticker}`);
      return null;
    }

    const meta = result.meta;
    const regularMarketPrice = meta.regularMarketPrice || 0;
    const previousClose = meta.previousClose || meta.chartPreviousClose || regularMarketPrice;
    const change = regularMarketPrice - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

    return {
      ticker: ticker.toUpperCase(),
      price: regularMarketPrice,
      change: change,
      changePercent: changePercent,
      previousClose: previousClose,
      name: meta.shortName || meta.longName || ticker,
      currency: meta.currency || 'BRL',
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Error fetching Yahoo quote for ${ticker}:`, error);
    return null;
  }
}

// Strip trading-pair suffixes from crypto tickers (BTCUSD → BTC, ETHUSD → ETH).
// The original ticker is preserved in the response so the app can match it.
function stripCryptoPairSuffix(ticker: string): string {
  const stripped = ticker.toUpperCase().replace(/(?:USDT|USDC|USD|BRL|EUR|BTC|ETH)$/, '');
  return stripped.length > 0 ? stripped : ticker.toUpperCase();
}

// Fetch from CoinGecko for crypto
async function fetchCoinGeckoQuote(ticker: string): Promise<QuoteResponse | null> {
  try {
    // Map common crypto tickers to CoinGecko IDs
    const cryptoMap: Record<string, string> = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'SOL': 'solana',
      'ADA': 'cardano',
      'DOT': 'polkadot',
      'AVAX': 'avalanche-2',
      'MATIC': 'matic-network',
      'LINK': 'chainlink',
      'UNI': 'uniswap',
      'ATOM': 'cosmos',
      'XRP': 'ripple',
      'DOGE': 'dogecoin',
      'SHIB': 'shiba-inu',
      'LTC': 'litecoin',
      'BCH': 'bitcoin-cash',
      'XLM': 'stellar',
      'ALGO': 'algorand',
      'VET': 'vechain',
      'FIL': 'filecoin',
      'AAVE': 'aave',
      'USDT': 'tether',
      'HYPE': 'hyperliquid',
    };

    // Strip pair suffix for lookup but keep original ticker for the response
    const originalUpper = ticker.toUpperCase();
    const upper = stripCryptoPairSuffix(originalUpper);

    let coinId = cryptoMap[upper];

    // Se não estiver no mapa, tenta descobrir via busca do CoinGecko (ex: HYPE)
    if (!coinId) {
      const searchUrl = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(upper)}`;
      const searchResp = await fetch(searchUrl, { headers: { 'Accept': 'application/json' } });
      if (searchResp.ok) {
        const searchData = await searchResp.json();
        const coins = Array.isArray(searchData?.coins) ? searchData.coins : [];

        // Prioriza match exato por symbol
        const exact = coins.find((c: any) => (c?.symbol ?? '').toLowerCase() === upper.toLowerCase());
        const pick = exact ?? coins[0];
        if (pick?.id) coinId = pick.id;
      }
    }

    if (!coinId) return null;

    const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.log(`CoinGecko error for ${ticker}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    const price = data.market_data?.current_price?.brl || data.market_data?.current_price?.usd || 0;
    const change24h = data.market_data?.price_change_24h_in_currency?.brl || data.market_data?.price_change_24h || 0;
    const changePercent = data.market_data?.price_change_percentage_24h || 0;

    return {
      ticker: originalUpper, // devolve o ticker original (ex: BTCUSD) para o app conseguir o match
      price: price,
      change: change24h,
      changePercent: changePercent,
      previousClose: price - change24h,
      name: data.name || upper,
      currency: data.market_data?.current_price?.brl ? 'BRL' : (data.market_data?.current_price?.usd ? 'USD' : 'BRL'),
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Error fetching CoinGecko quote for ${ticker}:`, error);
    return null;
  }
}

// Detect if ticker is crypto
function isCrypto(ticker: string): boolean {
  const cryptoTickers = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI', 'ATOM', 'XRP', 'DOGE', 'SHIB', 'LTC', 'BCH', 'XLM', 'ALGO', 'VET', 'FIL', 'AAVE', 'USDT', 'HYPE'];
  return cryptoTickers.includes(ticker.toUpperCase());
}

// ------------------
// Tesouro Direto (via feed público da ANBIMA)
// ------------------

type TesouroParsed = {
  rawTicker: string;
  tipo: 'PRE' | 'IPCA';
  vencimento: string; // YYYY-MM-DD
  juros: boolean;
};

function isTesouroTicker(ticker: string): boolean {
  return /^TD:/i.test(String(ticker ?? '').trim());
}

function parseTesouroTicker(ticker: string): TesouroParsed | null {
  const rawTicker = String(ticker ?? '').trim().toUpperCase();

  // Aceitamos:
  // - TD:PRE2035-01-01
  // - TD:PRE2035-01-01:JUROS (ou TD:PRE2035-01-01JUROS)
  // - TD:IPCA2035-05-15:JUROS
  const m = rawTicker.match(/^TD:(PRE|IPCA)(\d{4}-\d{2}-\d{2})(?::?JUROS)?$/);
  if (!m) return null;

  const tipo = m[1] as TesouroParsed['tipo'];
  const vencimento = m[2];
  const juros = /JUROS$/.test(rawTicker);

  // Validação rápida de data
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return null;

  return { rawTicker, tipo, vencimento, juros };
}

type AnbimaTpfItem = {
  tipo_titulo?: string;
  data_vencimento?: string;
  pu?: number | string;
  taxa_indicativa?: number | string;
  data_referencia?: string;
  [k: string]: any;
};

type B3TesouroItem = {
  trsrBdNm?: string;
  mtrtyDt?: string;
  trsrBdTp?: string;
  untrInvstmtVal?: number | string;
  untrRedVal?: number | string;
  anulInvstmtRate?: number | string;
  [k: string]: any;
};

function mapTesouroToAnbimaTipo(p: TesouroParsed): string {
  // Mapeamento simplificado (suficiente para PRE/IPCA e JUROS)
  // PRE:
  // - sem JUROS => LTN (Prefixado)
  // - com JUROS => NTN-F (Prefixado com juros semestrais)
  // IPCA:
  // - sem JUROS => NTN-B Principal (IPCA+ sem cupom)
  // - com JUROS => NTN-B (IPCA+ com juros semestrais)
  if (p.tipo === 'PRE') return p.juros ? 'NTN-F' : 'LTN';
  return p.juros ? 'NTN-B' : 'NTN-B Principal';
}

function normalizeTesouroTipoLabel(input: string): string {
  return String(input ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/–/g, '-')
    .replace(/\u00A0/g, ' ');
}

function toIsoDateOnly(input: string): string {
  const s = String(input ?? '').trim();
  if (!s) return '';
  // Aceita YYYY-MM-DD ou ISO completo
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? '';
}

async function fetchAnbimaTpfItems(): Promise<AnbimaTpfItem[]> {
  const cacheKey = 'tpf';
  const cached = anbimaTpfCache.get(cacheKey);
  if (isFresh(cached, CACHE_TTL_ANBIMA_TPF_MS)) return cached!.value as AnbimaTpfItem[];

  const existing = inFlightAnbimaTpf.get(cacheKey);
  if (existing) return await existing;

  const p = (async () => {
    const url = 'https://api.anbima.com.br/feed/precos-indices/v1/titulos-publicos/mercado-secundario-TPF';
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'InvestPro/1.0',
        Accept: 'application/json',
      },
    });

    console.log('[ANBIMA][TPF] fetch', { ok: resp.ok, status: resp.status });
    if (!resp.ok) return [];

    const data = await resp.json();
    const items = Array.isArray(data) ? (data as AnbimaTpfItem[]) : [];
    anbimaTpfCache.set(cacheKey, { value: items, fetchedAt: Date.now() });
    return items;
  })();

  inFlightAnbimaTpf.set(cacheKey, p);
  try {
    return await p;
  } finally {
    inFlightAnbimaTpf.delete(cacheKey);
  }
}

const tesouroB3Cache = new Map<string, { fetchedAt: number; value: B3TesouroItem[] }>();
const inFlightTesouroB3 = new Map<string, Promise<B3TesouroItem[]>>();
const CACHE_TTL_TESOURO_B3_MS = 10 * 60 * 1000;

async function fetchTesouroB3Items(): Promise<B3TesouroItem[]> {
  const cacheKey = 'b3';
  const cached = tesouroB3Cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_TESOURO_B3_MS) return cached.value;

  const existing = inFlightTesouroB3.get(cacheKey);
  if (existing) return await existing;

  const p = (async () => {
    // Fonte oficial (B3/Tesouro Direto). Pode sofrer bloqueios; por isso tentamos também um mirror.
    const sources = [
      'https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsinfo.json',
      'https://api.radaropcoes.com/bonds.json',
    ];

    for (const url of sources) {
      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'InvestPro/1.0',
            Accept: 'application/json',
          },
        });

        console.log('[TESOURO][B3] fetch', { url, ok: resp.ok, status: resp.status });
        if (!resp.ok) continue;

        const json = await resp.json();

        // Formato oficial: { TrsrBdTradgList: { TrsrBd: [...] } }
        const list = (json?.TrsrBdTradgList?.TrsrBd ?? json?.TrsrBd ?? json?.items ?? json) as any;
        const items = Array.isArray(list) ? (list as B3TesouroItem[]) : [];

        if (items.length) {
          tesouroB3Cache.set(cacheKey, { fetchedAt: Date.now(), value: items });
          return items;
        }
      } catch (e) {
        console.warn('[TESOURO][B3] fetch error', { url, e });
      }
    }

    return [];
  })();

  inFlightTesouroB3.set(cacheKey, p);
  try {
    return await p;
  } finally {
    inFlightTesouroB3.delete(cacheKey);
  }
}

async function fetchTesouroQuote(ticker: string): Promise<QuoteResponse | null> {
  const parsed = parseTesouroTicker(ticker);
  if (!parsed) return null;

  const expectedTipo = normalizeTesouroTipoLabel(mapTesouroToAnbimaTipo(parsed));

  // Preferimos B3/Tesouro Direto (público). ANBIMA pode exigir autenticação.
  const b3Items = await fetchTesouroB3Items();
  const b3Match = b3Items.find((it) => {
    const tipo = normalizeTesouroTipoLabel(it.trsrBdTp ?? it.tipo_titulo ?? '');
    const venc = toIsoDateOnly(it.mtrtyDt ?? it.data_vencimento ?? '');

    // Normalizações comuns encontradas em mirrors
    const tipoNorm = tipo.replace(/-/g, ' ');
    const expectedNorm = expectedTipo.replace(/-/g, ' ');

    // Aceita variações do "NTN-B Principal"
    const isPrincipalMatch =
      expectedNorm === 'NTN B PRINCIPAL' &&
      (tipoNorm === 'NTN B PRINCIPAL' || tipoNorm === 'NTNB PRINCIPAL' || tipoNorm === 'NTNBP' || /PRINCIPAL/.test(tipoNorm));

    return (tipoNorm === expectedNorm || isPrincipalMatch) && venc === parsed.vencimento;
  });

  const fromAnbima = async (): Promise<QuoteResponse | null> => {
    const items = await fetchAnbimaTpfItems();
    const match = items.find((it) => {
      const tipo = normalizeTesouroTipoLabel(String(it.tipo_titulo ?? '').trim());
      const venc = toIsoDateOnly(it.data_vencimento ?? '');
      return tipo === expectedTipo && venc === parsed.vencimento;
    });

    if (!match) return null;

    const pu = Number(String(match.pu ?? '').replace(',', '.'));
    const price = Number.isFinite(pu) ? pu : 0;

    return {
      ticker: parsed.rawTicker,
      price,
      change: 0,
      changePercent: 0,
      previousClose: price,
      name: `${parsed.tipo === 'PRE'
        ? parsed.juros
          ? 'Tesouro Prefixado com Juros Semestrais'
          : 'Tesouro Prefixado'
        : parsed.juros
          ? 'Tesouro IPCA+ com Juros Semestrais'
          : 'Tesouro IPCA+'} ${parsed.vencimento}`,
      currency: 'BRL',
      updatedAt: new Date().toISOString(),
      asOfDate: toIsoDateOnly(match.data_referencia ?? '') || undefined,
    };
  };

  const nameBase = (() => {
    if (parsed.tipo === 'PRE') return parsed.juros ? 'Tesouro Prefixado com Juros Semestrais' : 'Tesouro Prefixado';
    return parsed.juros ? 'Tesouro IPCA+ com Juros Semestrais' : 'Tesouro IPCA+';
  })();

  if (b3Match) {
    const untrInv = Number(String(b3Match.untrInvstmtVal ?? '').replace(',', '.'));
    const untrRed = Number(String(b3Match.untrRedVal ?? '').replace(',', '.'));
    const price = Number.isFinite(untrInv) && untrInv > 0 ? untrInv : (Number.isFinite(untrRed) ? untrRed : 0);

    return {
      ticker: parsed.rawTicker,
      price,
      change: 0,
      changePercent: 0,
      previousClose: price,
      name: String(b3Match.trsrBdNm ?? '').trim() || `${nameBase} ${parsed.vencimento}`,
      currency: 'BRL',
      updatedAt: new Date().toISOString(),
      asOfDate: toIsoDateOnly(b3Match.mtrtyDt ?? '') || undefined,
    };
  }

  // fallback ANBIMA
  const anbima = await fromAnbima();
  if (anbima) return anbima;

  return {
    ticker: parsed.rawTicker,
    price: 0,
    change: 0,
    changePercent: 0,
    previousClose: 0,
    name: `${nameBase} ${parsed.vencimento}`,
    currency: 'BRL',
    updatedAt: new Date().toISOString(),
    error: 'Título não encontrado. Verifique o vencimento completo (YYYY-MM-DD).',
  };
}

function normalizeCnpj(input: string): string {
  return String(input ?? '').replace(/\D/g, '').slice(0, 14);
}

function formatCnpj(cnpjDigits: string): string {
  const d = normalizeCnpj(cnpjDigits);
  if (d.length !== 14) return cnpjDigits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

function isFundCnpj(ticker: string): boolean {
  return /^\d{14}$/.test(normalizeCnpj(ticker));
}

function stripQuotes(v: string): string {
  const s = String(v ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  // Parser simples para CSV/DSV que respeita aspas duplas
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // Trata "" como escape
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      out.push(stripQuotes(cur));
      cur = '';
      continue;
    }

    cur += ch;
  }

  out.push(stripQuotes(cur));
  return out;
}
async function fetchCvmFundName(cnpjDigits: string): Promise<string | null> {
  const target = normalizeCnpj(cnpjDigits);
  if (target.length !== 14) return null;

  const cached = cvmNameCache.get(target);
  if (isFresh(cached, CACHE_TTL_NAME_MS)) return cached!.value;

  // Helper simples (bem tolerante) para achar colunas e bater CNPJ
  // IMPORTANTE: evitamos `split('\n')` em arquivos grandes para não estourar memória.
  const findNameInCsv = (csvText: string, delimiter: string): string | null => {
    const text = String(csvText ?? '');
    const firstNl = text.search(/\r?\n/);
    if (firstNl === -1) return null;

    const headerLine = text.slice(0, firstNl).replace(/\r$/, '');
    const header = parseDelimitedLine(headerLine, delimiter).map((h) =>
      h.replace(/^\uFEFF/, '').trim()
    );

    const headerUpper = header.map((h) => h.toUpperCase());

    const idxCnpj = (() => {
      // Alguns sites chamam de "Código CVM" (não é CNPJ). Nos arquivos da CVM isso pode vir como CD_CVM/CD_FUNDO.
      const direct = headerUpper.findIndex(
        (u) =>
          u === 'CNPJ_FUNDO' ||
          u === 'CNPJ_FDO' ||
          u === 'CNPJ' ||
          // Res. CVM 175: classes/subclasses podem ter CNPJ próprio
          u === 'CNPJ_CLASSE' ||
          u === 'CNPJ_CLASSE_COTA' ||
          u === 'CNPJ_SUBCLASSE' ||
          u === 'CNPJ_FUNDO_CLASSE' ||
          u === 'CNPJ_FUNDO_CLASSE_ANBIMA' ||
          // Alguns arquivos trazem IDs/códigos; mantemos como fallback
          u === 'CD_CVM' ||
          u === 'COD_CVM' ||
          u === 'CODIGO_CVM' ||
          u === 'CD_FUNDO' ||
          u === 'COD_FUNDO' ||
          u === 'CODIGO_FUNDO'
      );
      if (direct !== -1) return direct;

      // Fallback tolerante (CNPJ ou Código CVM)
      return headerUpper.findIndex((u) => u.includes('CNPJ') || (u.includes('CVM') && (u.includes('CD') || u.includes('COD'))));
    })();

    const idxNome = (() => {
      const direct = headerUpper.findIndex((u) =>
        [
          'DENOM_SOCIAL',
          'DENOM_COMERC',
          'DENOMINACAO',
          'DENOMINACAO_SOCIAL',
          'NOME_FUNDO',
          'NOME',
          'DENOM_SOCIAL_FUNDO',
        ].includes(u)
      );
      if (direct !== -1) return direct;

      // Fallback: qualquer campo que pareça nome do fundo (evita ADMIN/GESTOR)
      return headerUpper.findIndex((u) => {
        const hasName = u.includes('DENOM') || u.includes('NOME');
        const isFundish = u.includes('FUNDO') || u.includes('FDO') || u.includes('FUND');
        const isNotPeople = !u.includes('ADMIN') && !u.includes('GESTOR') && !u.includes('DIRETOR');
        return hasName && isFundish && isNotPeople;
      });
    })();

    console.log('[CVM][NAME] header sample', {
      delimiter,
      idxCnpj,
      idxNome,
      header: header.slice(0, 30),
    });

    if (idxCnpj === -1 || idxNome === -1) {
      console.log(`[CVM][NAME] colunas não encontradas (delim='${delimiter}')`);
      return null;
    }

    // Itera linha a linha sem alocar um array gigante
    let i = firstNl;
    let scanned = 0;
    while (i < text.length) {
      // pula \r?\n
      if (text[i] === '\r') i++;
      if (text[i] === '\n') i++;

      if (i >= text.length) break;

      let j = text.indexOf('\n', i);
      if (j === -1) j = text.length;

      const rowLine = text.slice(i, j).replace(/\r$/, '');
      i = j;

      if (!rowLine) continue;

      const cols = parseDelimitedLine(rowLine, delimiter);
      const cnpj = normalizeCnpj(stripQuotes((cols[idxCnpj] ?? '').trim()));
      scanned++;

      if (cnpj !== target) {
        if (scanned === 1) {
          console.log('[CVM][NAME] primeira linha (debug)', {
            firstCnpj: cnpj,
            firstName: stripQuotes((cols[idxNome] ?? '').trim()),
          });
        }
        if (scanned === 250000) {
          console.log('[CVM][NAME] já escaneou 250k linhas sem achar', { target });
        }
        continue;
      }

      const nome = stripQuotes((cols[idxNome] ?? '').trim());
      console.log('[CVM][NAME] match!', { target, nome });
      return nome || null;
    }

    console.log('[CVM][NAME] terminou sem match', { target, scanned });
    return null;
  };

  try {
    // 1) Tentativa rápida (CSV direto) — costuma ser mais leve que o ZIP
    // (Se não existir / mudar, apenas cai no fallback.)
    const registroUrls = [
      // Extrato cadastral (costuma ter a denominação; pode vir com CNPJ formatado)
      'https://dados.cvm.gov.br/dados/FI/DOC/EXTRATO/DADOS/extrato_fi.csv',
      // Res. CVM 175: CNPJ informado pelo investidor pode ser da CLASSE
      'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_classe.csv',
      'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo.csv',
      'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi.csv',
    ];

    for (const registroUrl of registroUrls) {
      const csv = await fetchCachedCsv(registroUrl, CACHE_TTL_NAME_MS);
      if (!csv) continue;

      const name = findNameInCsv(csv, ';') ?? findNameInCsv(csv, ',');
      console.log(
        `CVM ${registroUrl.split('/').pop()}: ${name ? 'encontrou' : 'não encontrou'} nome para ${target}`
      );
      if (name) {
        cvmNameCache.set(target, { value: name, fetchedAt: Date.now() });
        return name;
      }
    }

    // 2) Fallback: arquivo cadastral (zip)
    const cadZipUrl = 'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi.zip';
    const resp = await fetch(cadZipUrl, {
      headers: { 'User-Agent': 'InvestPro/1.0', 'Accept': '*/*' },
    });
    console.log('[CVM][NAME] fetch zip', { ok: resp.ok, status: resp.status });
    if (!resp.ok) return null;

    const zipBytes = new Uint8Array(await resp.arrayBuffer());

    const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));
    const entries = await (zipReader as any).getEntries();
    const csvEntry = entries.find((e: any) => String(e?.filename ?? '').toLowerCase().endsWith('.csv'));
    console.log('[CVM][NAME] zip entries', {
      count: Array.isArray(entries) ? entries.length : null,
      picked: csvEntry?.filename,
    });
    if (!csvEntry || typeof (csvEntry as any).getData !== 'function') {
      await (zipReader as any).close();
      return null;
    }

    const csvBytes: Uint8Array = await (csvEntry as any).getData(new Uint8ArrayWriter());
    await (zipReader as any).close();

    const csv = new TextDecoder('latin1').decode(csvBytes);
    const name = findNameInCsv(csv, ';');
    if (name) cvmNameCache.set(target, { value: name, fetchedAt: Date.now() });
    return name;
  } catch (e) {
    console.error('Error fetching CVM fund name:', e);
    return null;
  }
}

async function fetchCvmFundLastQuota(cnpjDigits: string): Promise<{ quota: number; asOfDate: string } | null> {
  // Delega ao batch para evitar duplicação de lógica e garantir uso do scanner anti-OOM.
  try {
    const result = await fetchCvmFundQuotasBatch([cnpjDigits]);
    const cnpj = normalizeCnpj(cnpjDigits);
    return result[cnpj]?.latest ?? null;
  } catch (e) {
    console.error('Error fetching CVM fund quota:', e);
    return null;
  }
}


async function fetchCvmFundQuote(cnpjDigits: string): Promise<QuoteResponse | null> {
  const cnpj = normalizeCnpj(cnpjDigits);
  if (cnpj.length !== 14) return null;

  const [quotaMap, name] = await Promise.all([
    fetchCvmFundQuotasBatch([cnpj]),
    fetchCvmFundName(cnpj),
  ]);

  const quotaInfo = quotaMap[cnpj];

  // Se não achou cota, ainda assim devolvemos o nome (quando disponível)
  // para conseguir auto-preencher o cadastro.
  if (!quotaInfo) {
    // Mesmo sem cota e sem nome, devolvemos uma resposta mínima para
    // diferenciar de 'Ticker not found' e permitir o usuário salvar o ativo.
    if (!name) {
      console.log(`CVM: sem cota e sem nome para CNPJ ${cnpj}`);
      return {
        ticker: cnpj,
        price: 0,
        change: 0,
        changePercent: 0,
        previousClose: 0,
        name: `Fundo ${formatCnpj(cnpj)}`,
        currency: 'BRL',
        updatedAt: new Date().toISOString(),
        error: 'Fundo não encontrado na base CVM',
      };
    }

    console.log(`CVM: achou nome mas sem cota para CNPJ ${cnpj}`);
    return {
      ticker: cnpj,
      price: 0,
      change: 0,
      changePercent: 0,
      previousClose: 0,
      name,
      currency: 'BRL',
      updatedAt: new Date().toISOString(),
      error: 'Cota não encontrada (CVM INF_DIARIO)',
    };
  }

  const latest = quotaInfo.latest;
  const previousClose = quotaInfo.previous?.quota ?? latest.quota;
  const change = latest.quota - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  return {
    ticker: cnpj,
    price: latest.quota,
    change,
    changePercent,
    previousClose,
    name: name || `Fundo ${formatCnpj(cnpj)}`,
    currency: 'BRL',
    updatedAt: new Date().toISOString(),
    asOfDate: latest.asOfDate,
  };
}

// ------------------
// Batch CVM helpers (reduz CPU vs varrer os mesmos arquivos N vezes)
// ------------------

async function fetchCvmFundNamesBatch(cnpjs: string[]): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(cnpjs.map((c) => normalizeCnpj(c)).filter((c) => c.length === 14)));
  const out: Record<string, string | null> = Object.fromEntries(unique.map((c) => [c, null]));

  if (unique.length === 0) return out;

  // Usa a fonte mais barata/rápida (extrato_fi.csv) e faz 1 varredura.
  const registroUrl = 'https://dados.cvm.gov.br/dados/FI/DOC/EXTRATO/DADOS/extrato_fi.csv';
  const csv = await fetchCachedCsv(registroUrl, CACHE_TTL_NAME_MS);
  if (!csv) return out;

  const targets = new Set(unique);
  const text = String(csv);
  const firstNl = text.search(/\r?\n/);
  if (firstNl === -1) return out;

  const headerLine = text.slice(0, firstNl).replace(/\r$/, '');
  const header = parseDelimitedLine(headerLine, ';').map((h) => h.replace(/^\uFEFF/, '').trim());
  const headerUpper = header.map((h) => h.toUpperCase());

  const idxCnpj = headerUpper.findIndex((u) => u.includes('CNPJ'));
  const idxNome = headerUpper.findIndex((u) => u === 'DENOM_SOCIAL' || u.includes('DENOM'));
  if (idxCnpj === -1 || idxNome === -1) return out;

  let i = firstNl;
  let found = 0;
  while (i < text.length && found < targets.size) {
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    if (i >= text.length) break;

    let j = text.indexOf('\n', i);
    if (j === -1) j = text.length;
    const rowLine = text.slice(i, j).replace(/\r$/, '');
    i = j;
    if (!rowLine) continue;

    const cols = parseDelimitedLine(rowLine, ';');
    const cnpj = normalizeCnpj((cols[idxCnpj] ?? '').trim());
    if (!targets.has(cnpj)) continue;

    const nome = String((cols[idxNome] ?? '')).trim();
    out[cnpj] = nome || null;
    if (nome) {
      cvmNameCache.set(cnpj, { value: nome, fetchedAt: Date.now() });
    }
    found++;
  }

  return out;
}

async function fetchCvmFundQuotasBatch(
  cnpjs: string[]
): Promise<
  Record<
    string,
    {
      latest: { quota: number; asOfDate: string };
      previous: { quota: number; asOfDate: string } | null;
    } | null
  >
> {
  const unique = Array.from(new Set(cnpjs.map((c) => normalizeCnpj(c)).filter((c) => c.length === 14)));
  const out: Record<
    string,
    {
      latest: { quota: number; asOfDate: string };
      previous: { quota: number; asOfDate: string } | null;
    } | null
  > = Object.fromEntries(unique.map((c) => [c, null]));

  if (unique.length === 0) return out;

  // Cache por CNPJ (última + anterior). Ajuda bastante porque a cota só muda 1x/dia.
  const missing = new Set<string>();
  for (const cnpj of unique) {
    const cached = cvmQuotaHistoryCache.get(cnpj);
    if (isFresh(cached, CACHE_TTL_QUOTA_MS)) {
      out[cnpj] = cached!.value;
    } else {
      missing.add(cnpj);
    }
  }

  if (missing.size === 0) return out;

  // Para cada CNPJ, vamos buscar as 2 últimas cotas disponíveis (nem sempre é literalmente D-1,
  // mas é a "cota anterior" mais recente existente no INF_DIARIO).
  const latestBy: Record<string, { quota: number; asOfDate: string } | null> = Object.fromEntries(
    Array.from(missing).map((c) => [c, null])
  );
  const previousBy: Record<string, { quota: number; asOfDate: string } | null> = Object.fromEntries(
    Array.from(missing).map((c) => [c, null])
  );

  const now = new Date();

  // Tenta mês atual e vai voltando; em cada mês usa scanInfDiarioForCnpjs (anti-OOM)
  // que processa o CSV como Uint8Array byte-a-byte sem materializar a string gigante.
  for (let offset = 0; offset < 12 && missing.size > 0; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyymm = `${yyyy}${mm}`;

    console.log(`CVM INF_DIARIO (batch history): usando mês ${yyyymm} para ${missing.size} CNPJs`);

    // Usa o scanner granular — baixa e descarta o ZIP/CSV sem cachear a string gigante.
    const scanResult = await scanInfDiarioForCnpjs(yyyymm, new Set(Array.from(missing)));

    for (const [cnpj, result] of Object.entries(scanResult)) {
      if (!result) continue;

      const existingLatest = latestBy[cnpj];
      const existingPrev = previousBy[cnpj];

      // Incorpora o resultado do mês escaneado nas posições latest/previous
      if (!existingLatest || result.latest.asOfDate > existingLatest.asOfDate) {
        previousBy[cnpj] = existingLatest ?? result.previous ?? null;
        latestBy[cnpj] = result.latest;
      } else if (result.latest.asOfDate < existingLatest.asOfDate) {
        if (!existingPrev || result.latest.asOfDate > existingPrev.asOfDate) {
          previousBy[cnpj] = result.latest;
        }
      }

      // Se temos latest+previous, podemos remover do missing
      if (latestBy[cnpj] && previousBy[cnpj]) {
        missing.delete(cnpj);
      }
    }
  }

  for (const cnpj of unique) {
    if (out[cnpj]) continue; // já veio do cache

    const latest = latestBy[cnpj];
    if (!latest) {
      out[cnpj] = null;
      continue;
    }

    const value = {
      latest,
      previous: previousBy[cnpj] ?? null,
    };

    out[cnpj] = value;
    cvmQuotaHistoryCache.set(cnpj, { value, fetchedAt: Date.now() });
  }

  return out;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // API key (recommended): require only if configured as a secret
  if (REQUIRED_API_KEY) {
    // Allow calls coming from our trusted app origin without exposing the secret in the client.
    // External callers still must provide x-api-key.
    if (!isFromOurApp(req)) {
      const provided = (req.headers.get('x-api-key') ?? '').trim();
      if (provided !== REQUIRED_API_KEY) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
  }

  // Rate limiting (best-effort): per IP
  const ip = getClientIp(req);
  if (!allowRequest(ip)) {
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log(`[get-quotes] version=${FUNCTION_VERSION}`);

    const { tickers } = await req.json();

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Tickers array is required', version: FUNCTION_VERSION }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit to 20 tickers per request
    const limitedTickers = tickers.slice(0, 20);

    // Normalize tickers
    // - ações: mantém como estava
    // - fundos CVM: aceita 14 dígitos mesmo que venha com pontuação
    const normalized = limitedTickers.map((t: string) => {
      const raw = String(t ?? '').trim();
      const digits = raw.replace(/\D/g, '');
      const normalizedTicker = digits.length === 14 ? digits : raw.toUpperCase().replace('.SA', '');
      return { raw, normalizedTicker, digitsLen: digits.length };
    });

    console.log(`Fetching quotes for: ${normalized.map((n) => n.normalizedTicker).join(', ')}`);

    // Separa fundos CVM (CNPJ) do resto para evitar varrer os arquivos CVM N vezes em paralelo.
    const fundEntries = normalized.filter((n) => isFundCnpj(n.normalizedTicker));
    const nonFundEntries = normalized.filter((n) => !isFundCnpj(n.normalizedTicker));

    const fundCnpjs = fundEntries.map((n) => normalizeCnpj(n.normalizedTicker));

    const [fundNames, fundQuotas] = await Promise.all([
      fetchCvmFundNamesBatch(fundCnpjs),
      fetchCvmFundQuotasBatch(fundCnpjs),
    ]);

    const fundQuoteByCnpj: Record<string, any> = {};
    for (const { raw, normalizedTicker, digitsLen } of fundEntries) {
      const cnpj = normalizeCnpj(normalizedTicker);
      const quotaInfo = fundQuotas[cnpj];
      const name = fundNames[cnpj] ?? null;

      // Se não achou cota, ainda devolve nome (quando disponível)
      const base: QuoteResponse = quotaInfo
        ? (() => {
            const latest = quotaInfo.latest;
            const previousClose = quotaInfo.previous?.quota ?? latest.quota;
            const change = latest.quota - previousClose;
            const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

            return {
              ticker: cnpj,
              price: latest.quota,
              change,
              changePercent,
              previousClose,
              name: name || `Fundo ${formatCnpj(cnpj)}`,
              currency: 'BRL',
              updatedAt: new Date().toISOString(),
              asOfDate: latest.asOfDate,
            };
          })()
        : {
            ticker: cnpj,
            price: 0,
            change: 0,
            changePercent: 0,
            previousClose: 0,
            name: name || `Fundo ${formatCnpj(cnpj)}`,
            currency: 'BRL',
            updatedAt: new Date().toISOString(),
            error: name ? 'Cota não encontrada (CVM INF_DIARIO)' : 'Fundo não encontrado na base CVM',
          };

      fundQuoteByCnpj[cnpj] = {
        ...base,
        debug: {
          version: FUNCTION_VERSION,
          input: raw,
          normalized: cnpj,
          digitsLen,
          isFundCnpj: true,
          source: 'cvm_batch',
        },
      };
    }

    // Não-fundos: paralelo é ok (mais leve)
    const nonFundPromises = nonFundEntries.map(async ({ raw, normalizedTicker, digitsLen }) => {
      const ticker = normalizedTicker;

      // Tesouro Direto
      if (isTesouroTicker(ticker)) {
        const tdQuote = await fetchTesouroQuote(ticker);
        if (tdQuote)
          return {
            ...tdQuote,
            debug: {
              version: FUNCTION_VERSION,
              input: raw,
              normalized: String(ticker).toUpperCase(),
              digitsLen,
              isFundCnpj: false,
              source: 'anbima_tpf',
            },
          } as any;

        // Se começou com TD: mas não bateu o formato que aceitamos
        return {
          ticker: String(ticker).toUpperCase(),
          price: 0,
          change: 0,
          changePercent: 0,
          previousClose: 0,
          name: String(ticker).toUpperCase(),
          currency: 'BRL',
          updatedAt: new Date().toISOString(),
          error: 'Formato inválido. Use TD:PREYYYY-MM-DD ou TD:PREYYYY-MM-DD:JUROS (ex.: TD:PRE2035-01-01:JUROS).',
          debug: {
            version: FUNCTION_VERSION,
            input: raw,
            normalized: String(ticker).toUpperCase(),
            digitsLen,
            isFundCnpj: false,
            source: 'anbima_tpf_format_error',
          },
        } as any;
      }

      // Heurística: tickers só com letras (ex: BTC, USDT, HYPE) tendem a ser cripto.
      const looksLikeCrypto = /^[A-Z]{2,10}$/.test(ticker);

      if (looksLikeCrypto) {
        const cryptoQuote = await fetchCoinGeckoQuote(ticker);
        if (cryptoQuote)
          return {
            ...cryptoQuote,
            debug: {
              version: FUNCTION_VERSION,
              input: raw,
              normalized: ticker,
              digitsLen,
              isFundCnpj: false,
              source: 'coingecko',
            },
          } as any;
      }

      const yahooQuote = await fetchYahooQuote(ticker);
      if (yahooQuote)
        return {
          ...yahooQuote,
          debug: {
            version: FUNCTION_VERSION,
            input: raw,
            normalized: ticker,
            digitsLen,
            isFundCnpj: false,
            source: 'yahoo',
          },
        } as any;

      if (!looksLikeCrypto) {
        const cryptoQuote = await fetchCoinGeckoQuote(ticker);
        if (cryptoQuote)
          return {
            ...cryptoQuote,
            debug: {
              version: FUNCTION_VERSION,
              input: raw,
              normalized: ticker,
              digitsLen,
              isFundCnpj: false,
              source: 'coingecko_fallback',
            },
          } as any;
      }

      return {
        ticker,
        price: 0,
        change: 0,
        changePercent: 0,
        previousClose: 0,
        name: ticker,
        currency: 'BRL',
        updatedAt: new Date().toISOString(),
        error: 'Ticker not found',
        debug: {
          version: FUNCTION_VERSION,
          input: raw,
          normalized: ticker,
          digitsLen,
          isFundCnpj: false,
          source: 'fallback',
        },
      } as any;
    });

    const nonFundQuotes = await Promise.all(nonFundPromises);
    const nonFundByTicker: Record<string, any> = Object.fromEntries(
      nonFundQuotes.map((q: any) => [String(q?.ticker ?? '').toUpperCase(), q])
    );

    const quotes = normalized.map((n) => {
      const t = n.normalizedTicker;
      if (isFundCnpj(t)) {
        const cnpj = normalizeCnpj(t);
        return fundQuoteByCnpj[cnpj];
      }
      return nonFundByTicker[String(t).toUpperCase()];
    });

    console.log(`Successfully fetched ${quotes.filter((q: any) => !q.error).length} quotes`);

    return new Response(
      JSON.stringify({
        version: FUNCTION_VERSION,
        quotes,
        debug: {
          normalizedTickers: normalized,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error in get-quotes function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage, version: FUNCTION_VERSION }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

