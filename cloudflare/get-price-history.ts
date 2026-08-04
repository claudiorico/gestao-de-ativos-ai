const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-api-key, content-type",
};

// --- Security: API key + lightweight rate limiting (best-effort, in-memory) ---
type WorkerEnv = Record<string, string | undefined>;
let runtimeEnv: WorkerEnv = {};
function getEnv(name: string): string { return String(runtimeEnv[name] ?? '').trim(); }
function getRequiredApiKey(): string { return getEnv('EDGE_FUNCTIONS_API_KEY'); }

type RateBucket = { tokens: number; lastRefillMs: number };
const rateBuckets = new Map<string, RateBucket>();

function isFromOurApp(req: Request): boolean {
  try {
    const origin = (req.headers.get('origin') ?? '').trim();

    const apikey = (req.headers.get('apikey') ?? '').trim();
    const expectedAnon = (getEnv('SUPABASE_ANON_KEY') ?? '').trim();
    const expectedPub = (getEnv('SUPABASE_PUBLISHABLE_KEY') ?? '').trim();

    const apikeyMatches =
      (!!apikey && !!expectedAnon && apikey === expectedAnon) ||
      (!!apikey && !!expectedPub && apikey === expectedPub);

    if (origin) {
      const host = new URL(origin).hostname.toLowerCase();
      const allowed = (getEnv('ALLOWED_ORIGIN_HOSTS') ?? '')
        .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
      if (allowed.some((h) => host === h || host.endsWith('.' + h))) return true;
    }

    return apikeyMatches;
  } catch {
    return false;
  }
}

function getClientIp(req: Request): string {
  // Use the rightmost entry added by the trusted proxy, not the leftmost (which callers can forge).
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const xfwd = req.headers.get('x-forwarded-for');
  if (xfwd) return xfwd.split(',').at(-1)!.trim();
  return req.headers.get('x-real-ip') || 'unknown';
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

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const Decompression = (globalThis as any).DecompressionStream;
  if (!Decompression) throw new Error("DecompressionStream is not available");
  const stream = new Blob([bytes]).stream().pipeThrough(new Decompression("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractFirstCsvFromZip(zipBytes: Uint8Array): Promise<Uint8Array | null> {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  let eocdOffset = -1;

  for (let i = zipBytes.length - 22; i >= 0; i--) {
    if (readUint32(zipBytes, i) === eocdSignature) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const entries = readUint16(zipBytes, eocdOffset + 10);
  let offset = readUint32(zipBytes, eocdOffset + 16);
  const decoder = new TextDecoder();

  for (let i = 0; i < entries; i++) {
    if (readUint32(zipBytes, offset) !== centralSignature) return null;

    const method = readUint16(zipBytes, offset + 10);
    const compressedSize = readUint32(zipBytes, offset + 20);
    const filenameLength = readUint16(zipBytes, offset + 28);
    const extraLength = readUint16(zipBytes, offset + 30);
    const commentLength = readUint16(zipBytes, offset + 32);
    const localHeaderOffset = readUint32(zipBytes, offset + 42);
    const filename = decoder
      .decode(zipBytes.subarray(offset + 46, offset + 46 + filenameLength))
      .toLowerCase();

    if (filename.endsWith(".csv")) {
      if (readUint32(zipBytes, localHeaderOffset) !== localSignature) return null;
      const localFilenameLength = readUint16(zipBytes, localHeaderOffset + 26);
      const localExtraLength = readUint16(zipBytes, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
      const compressed = zipBytes.subarray(dataStart, dataStart + compressedSize);

      if (method === 0) return compressed;
      if (method === 8) return inflateRaw(compressed);
      throw new Error(`Unsupported ZIP compression method: ${method}`);
    }

    offset += 46 + filenameLength + extraLength + commentLength;
  }

  return null;
}

type HistoryPoint = { t: number; price: number };
type HistoryResponse = { ticker: string; points: HistoryPoint[] };

// ------------------
// Helpers (tipo de ativo por formato do ticker)
// ------------------
function normalizeCnpj(input: string): string {
  return String(input ?? "").replace(/\D/g, "").slice(0, 14);
}

function isFundCnpj(ticker: string): boolean {
  return /^\d{14}$/.test(normalizeCnpj(ticker));
}

function isTesouroTicker(ticker: string): boolean {
  return /^TD:/i.test(String(ticker ?? "").trim());
}

function toIsoDateOnly(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? "";
}

function yyyymmUtc(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}${mm}`;
}

function dateOnlyToMs(dateOnly: string): number {
  // Interpreta como UTC para ficar estável entre timezones.
  const ms = Date.parse(`${dateOnly}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : Date.now();
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init.headers ?? {}),
    },
  });
}

function isCrypto(ticker: string): boolean {
  const t = ticker.toUpperCase();
  return [
    "BTC",
    "ETH",
    "SOL",
    "ADA",
    "DOT",
    "AVAX",
    "MATIC",
    "LINK",
    "UNI",
    "ATOM",
    "XRP",
    "DOGE",
    "SHIB",
    "LTC",
    "BCH",
    "XLM",
    "ALGO",
    "VET",
    "FIL",
    "AAVE",
    "USDT",
    "HYPE",
  ].includes(t);
}

function clampMonths(m: unknown): number {
  const n = Number(m);
  if (!Number.isFinite(n)) return 6;
  return Math.max(1, Math.min(24, Math.floor(n)));
}

// ------------------
// Fundos (CVM) - histórico de cota via INF_DIARIO (zip mensal)
// Obs: o INF_DIARIO é grande; por isso fazemos 1 varredura por mês
// e extraímos a última cota disponível do mês para cada CNPJ pedido.
// ------------------

const corsFetchHeaders = { "User-Agent": "InvestPro/1.0", Accept: "*/*" };

// Cache por invocação (vive enquanto o worker estiver quente)
const infDiarioCsvCache = new Map<string, string | null>();

type FundMonthPick = { quota: number; asOfDate: string };

async function getInfDiarioCsv(yyyymm: string): Promise<string | null> {
  if (infDiarioCsvCache.has(yyyymm)) return infDiarioCsvCache.get(yyyymm) ?? null;
  const zipUrl = `https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${yyyymm}.zip`;
  const resp = await fetch(zipUrl, { headers: corsFetchHeaders });
  console.log("[CVM][HIST] fetch", { yyyymm, ok: resp.ok, status: resp.status });
  if (!resp.ok) {
    infDiarioCsvCache.set(yyyymm, null);
    return null;
  }

  const zipBytes = new Uint8Array(await resp.arrayBuffer());
  const csvBytes = await extractFirstCsvFromZip(zipBytes);
  if (!csvBytes) return null;
  const decoded = new TextDecoder("latin1").decode(csvBytes);
  infDiarioCsvCache.set(yyyymm, decoded);
  return decoded;
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Fast path for CVM CSV parsing.
 * We only need a few columns (cnpj/date/quota). Most INF_DIARIO lines are not quoted;
 * splitting the whole line is expensive and is a main source of CPU exhaustion.
 */
function getColumnAtFast(line: string, delimiter: string, index: number): string {
  if (index < 0) return "";
  // If the line contains quotes, fall back to the robust parser.
  if (line.includes('"')) {
    return parseDelimitedLine(line, delimiter)[index] ?? "";
  }

  let start = 0;
  let col = 0;

  while (true) {
    const end = line.indexOf(delimiter, start);
    if (col === index) {
      const slice = end === -1 ? line.slice(start) : line.slice(start, end);
      return slice.trim();
    }
    if (end === -1) return "";
    col++;
    start = end + 1;
  }
}

function detectDelimiter(headerLine: string): ";" | "," {
  const semi = (headerLine.match(/;/g) ?? []).length;
  const comma = (headerLine.match(/,/g) ?? []).length;
  return semi >= comma ? ";" : ",";
}

function findHeaderIndexes(headerCols: string[]) {
  const u = headerCols.map((c) => c.replace(/^\uFEFF/, "").trim().toUpperCase());
  const idxCnpj = u.findIndex((x) => x === "CNPJ_FUNDO" || x === "CNPJ" || x === "CNPJ_FDO" || x.includes("CNPJ"));
  const idxDate = u.findIndex((x) => x === "DT_COMPTC" || x === "DT_COMPET" || x.includes("DT") && x.includes("COM"));
  const idxQuota = u.findIndex((x) => x === "VL_QUOTA" || x === "VL_COTA" || x.includes("QUOTA") || x.includes("COTA"));
  return { idxCnpj, idxDate, idxQuota };
}

function parseQuotaNumber(raw: string): number | null {
  // INF_DIARIO costuma vir com vírgula decimal.
  const value = String(raw ?? "").trim().replace(/\s/g, "");
  if (!value) return null;

  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value.split(".").length > 2
      ? value.replace(/\.(?=.*\.)/g, "")
      : value;

  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchFundMonthLastQuotas(
  cnpjs: string[],
  yyyymm: string,
): Promise<Record<string, FundMonthPick>> {
  const out: Record<string, FundMonthPick> = {};
  const target = new Set(cnpjs.map(normalizeCnpj).filter((c) => c.length === 14));
  if (!target.size) return out;

  const csv = await getInfDiarioCsv(yyyymm);
  if (!csv) return out;

  const text = String(csv);
  const firstNl = text.search(/\r?\n/);
  if (firstNl === -1) return out;

  const headerLine = text.slice(0, firstNl).replace(/\r$/, "");
  const delimiter = detectDelimiter(headerLine);
  const headerCols = parseDelimitedLine(headerLine, delimiter);
  const { idxCnpj, idxDate, idxQuota } = findHeaderIndexes(headerCols);

  console.log("[CVM][HIST] header", { yyyymm, delimiter, idxCnpj, idxDate, idxQuota });
  if (idxCnpj < 0 || idxDate < 0 || idxQuota < 0) return out;

  const bestByCnpj = new Map<string, FundMonthPick>();

  let i = firstNl;
  while (i < text.length) {
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
    if (i >= text.length) break;

    let j = text.indexOf("\n", i);
    if (j === -1) j = text.length;
    const line = text.slice(i, j).replace(/\r$/, "");
    i = j;
    if (!line) continue;

    const cnpj = normalizeCnpj(getColumnAtFast(line, delimiter, idxCnpj));
    if (!target.has(cnpj)) continue;

    const dtRaw = getColumnAtFast(line, delimiter, idxDate);
    // INF_DIARIO vem como YYYY-MM-DD
    const dt = toIsoDateOnly(dtRaw);
    if (!dt) continue;

    const q = parseQuotaNumber(getColumnAtFast(line, delimiter, idxQuota));
    if (q === null) continue;

    const prev = bestByCnpj.get(cnpj);
    if (!prev || prev.asOfDate < dt) {
      bestByCnpj.set(cnpj, { quota: q, asOfDate: dt });
    }
  }

  for (const [cnpj, pick] of bestByCnpj.entries()) {
    out[cnpj] = pick;
  }
  return out;
}

async function fetchCvmFundHistory(cnpj: string, months: number): Promise<HistoryPoint[]> {
  const cnpjDigits = normalizeCnpj(cnpj);
  if (cnpjDigits.length !== 14) return [];

  const now = new Date();
  const points: HistoryPoint[] = [];

  // Para cada mês (do mais antigo -> atual), pega a última cota do mês.
  for (let offset = months - 1; offset >= 0; offset--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const key = yyyymmUtc(d);
    const monthPicks = await fetchFundMonthLastQuotas([cnpjDigits], key);
    const pick = monthPicks[cnpjDigits];
    if (!pick) continue;
    points.push({ t: dateOnlyToMs(pick.asOfDate), price: pick.quota });
  }

  // Garante ordenação ascendente
  points.sort((a, b) => a.t - b.t);
  return points;
}

async function fetchCvmFundsHistoriesBatch(cnpjs: string[], months: number): Promise<Record<string, HistoryPoint[]>> {
  const clean = Array.from(new Set(cnpjs.map(normalizeCnpj).filter((c) => c.length === 14)));
  const out: Record<string, HistoryPoint[]> = {};
  for (const c of clean) out[c] = [];
  if (clean.length === 0) return out;

  const now = new Date();
  for (let offset = months - 1; offset >= 0; offset--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const key = yyyymmUtc(d);
    const monthPicks = await fetchFundMonthLastQuotas(clean, key);
    for (const cnpj of clean) {
      const pick = monthPicks[cnpj];
      if (!pick) continue;
      out[cnpj].push({ t: dateOnlyToMs(pick.asOfDate), price: pick.quota });
    }
  }

  for (const cnpj of clean) {
    out[cnpj].sort((a, b) => a.t - b.t);
  }
  return out;
}

function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

// ------------------
// Tesouro Direto (TD:...) - atualmente só temos preço atual público.
// Para nao sumir no grafico, devolvemos uma serie constante.
// ------------------

type B3TesouroItem = {
  trsrBdNm?: string;
  mtrtyDt?: string;
  trsrBdTp?: string;
  untrInvstmtVal?: number | string;
  untrRedVal?: number | string;
  anulInvstmtRate?: number | string;
  [k: string]: any;
};

type TesouroParsed = { rawTicker: string; tipo: "PRE" | "IPCA"; vencimento: string; juros: boolean };

function parseTesouroTicker(ticker: string): TesouroParsed | null {
  const rawTicker = String(ticker ?? "").trim().toUpperCase();
  const m = rawTicker.match(/^TD:(PRE|IPCA)(\d{4}-\d{2}-\d{2})(?::?JUROS)?$/);
  if (!m) return null;
  const tipo = m[1] as TesouroParsed["tipo"];
  const vencimento = m[2];
  const juros = /JUROS$/.test(rawTicker);
  return { rawTicker, tipo, vencimento, juros };
}

function normalizeTesouroTipoLabel(input: string): string {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u00A0/g, " ");
}

function mapTesouroToTipo(parsed: TesouroParsed): string {
  if (parsed.tipo === "PRE") return parsed.juros ? "NTN-F" : "LTN";
  return parsed.juros ? "NTN-B" : "NTN-B Principal";
}

async function fetchTesouroCurrentPrice(ticker: string): Promise<number | null> {
  const parsed = parseTesouroTicker(ticker);
  if (!parsed) return null;

  const expectedTipo = normalizeTesouroTipoLabel(mapTesouroToTipo(parsed));
  const sources = [
    "https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsinfo.json",
    "https://api.radaropcoes.com/bonds.json",
  ];

  for (const url of sources) {
    try {
      const resp = await fetch(url, { headers: corsFetchHeaders });
      console.log("[TESOURO][HIST] fetch", { url, ok: resp.ok, status: resp.status });
      if (!resp.ok) continue;
      const json = await resp.json();
      const list = (json?.TrsrBdTradgList?.TrsrBd ?? json?.TrsrBd ?? json?.items ?? json) as any;
      const items = Array.isArray(list) ? (list as B3TesouroItem[]) : [];

      const match = items.find((it) => {
        const tipo = normalizeTesouroTipoLabel(it.trsrBdTp ?? it.tipo_titulo ?? "").replace(/-/g, " ");
        const expected = expectedTipo.replace(/-/g, " ");
        const venc = toIsoDateOnly(it.mtrtyDt ?? it.data_vencimento ?? "");

        const isPrincipalMatch =
          expected === "NTN B PRINCIPAL" &&
          (tipo === "NTN B PRINCIPAL" || tipo === "NTNB PRINCIPAL" || tipo === "NTNBP" || /PRINCIPAL/.test(tipo));

        return (tipo === expected || isPrincipalMatch) && venc === parsed.vencimento;
      });

      if (!match) continue;
      const raw = match.untrInvstmtVal ?? match.untrRedVal ?? match.pu;
      const price = Number(String(raw ?? "").replace(",", "."));
      if (Number.isFinite(price) && price > 0) return price;
    } catch (e) {
      console.warn("[TESOURO][HIST] error", { url, e });
    }
  }
  return null;
}

async function fetchTesouroHistoryConstant(ticker: string, months: number): Promise<HistoryPoint[]> {
  const price = await fetchTesouroCurrentPrice(ticker);
  if (!price) return [];

  const now = new Date();
  const points: HistoryPoint[] = [];
  for (let offset = months - 1; offset >= 0; offset--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    // usamos o 1º dia do mês (UTC) como marcador
    points.push({ t: d.getTime(), price });
  }
  return points;
}

async function fetchYahooHistory(ticker: string, months: number): Promise<HistoryPoint[]> {
  // Yahoo: Brazilian tickers usually need .SA
  const yahooTicker = ticker.includes(".") ? ticker : `${ticker}.SA`;
  const range = months <= 3 ? "3mo" : months <= 6 ? "6mo" : months <= 12 ? "1y" : "2y";
  const interval = months <= 6 ? "1wk" : "1mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooTicker,
  )}?interval=${interval}&range=${range}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (InvestPro)",
      Accept: "application/json",
    },
  });

  if (!resp.ok) return [];
  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  if (!result) return [];

  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes: number[] =
    Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];

  const points: HistoryPoint[] = [];
  for (let i = 0; i < Math.min(timestamps.length, closes.length); i++) {
    const ts = timestamps[i];
    const c = closes[i];
    if (!Number.isFinite(ts) || !Number.isFinite(c)) continue;
    points.push({ t: ts * 1000, price: c });
  }
  return points;
}

async function fetchCoinGeckoHistory(ticker: string, months: number): Promise<HistoryPoint[]> {
  const cryptoMap: Record<string, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    SOL: "solana",
    ADA: "cardano",
    DOT: "polkadot",
    AVAX: "avalanche-2",
    MATIC: "matic-network",
    LINK: "chainlink",
    UNI: "uniswap",
    ATOM: "cosmos",
    XRP: "ripple",
    DOGE: "dogecoin",
    SHIB: "shiba-inu",
    LTC: "litecoin",
    BCH: "bitcoin-cash",
    XLM: "stellar",
    ALGO: "algorand",
    VET: "vechain",
    FIL: "filecoin",
    AAVE: "aave",
    USDT: "tether",
    HYPE: "hyperliquid",
  };
  const upper = ticker.toUpperCase();
  let coinId = cryptoMap[upper];

  if (!coinId) {
    const searchUrl = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(upper)}`;
    const searchResp = await fetch(searchUrl, { headers: { Accept: "application/json" } });
    if (searchResp.ok) {
      const searchData = await searchResp.json();
      const coins = Array.isArray(searchData?.coins) ? searchData.coins : [];
      const exact = coins.find((c: any) => (c?.symbol ?? "").toLowerCase() === upper.toLowerCase());
      const pick = exact ?? coins[0];
      if (pick?.id) coinId = pick.id;
    }
  }
  if (!coinId) return [];

  const days = Math.max(1, Math.min(730, months * 30));
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
    coinId,
  )}/market_chart?vs_currency=brl&days=${days}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) return [];
  const data = await resp.json();
  const prices: any[] = Array.isArray(data?.prices) ? data.prices : [];

  // Downsample: keep roughly weekly points to avoid huge payload
  const step = prices.length > 200 ? Math.ceil(prices.length / 200) : 1;
  const out: HistoryPoint[] = [];
  for (let i = 0; i < prices.length; i += step) {
    const row = prices[i];
    const t = Number(row?.[0]);
    const p = Number(row?.[1]);
    if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
    out.push({ t, price: p });
  }
  return out;
}

async function getHistoryForTicker(ticker: string, months: number): Promise<HistoryResponse> {
  try {
    const clean = String(ticker ?? "").trim().toUpperCase();
    if (!clean) return { ticker: "", points: [] };

    const points = isFundCnpj(clean)
      ? await fetchCvmFundHistory(clean, months)
      : isTesouroTicker(clean)
        ? await fetchTesouroHistoryConstant(clean, months)
        : isCrypto(clean)
          ? await fetchCoinGeckoHistory(clean, months)
          : await fetchYahooHistory(clean, months);

    return { ticker: clean, points };
  } catch (e) {
    console.error("[get-price-history] ticker failed", { ticker, e });
    return { ticker: String(ticker ?? "").trim().toUpperCase(), points: [] };
  }
}

export async function handleGetPriceHistory(req: Request, env: WorkerEnv): Promise<Response> {
  runtimeEnv = env;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: always require either a trusted app origin OR a valid API key.
  if (!isFromOurApp(req)) {
    if (!getRequiredApiKey()) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const provided = (req.headers.get('x-api-key') ?? '').trim();
    if (provided !== getRequiredApiKey()) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
    const body = await req.json().catch(() => ({}));
    const tickersRaw = Array.isArray(body?.tickers) ? body.tickers : [];
    const months = clampMonths(body?.months);

    const tickers = tickersRaw
      .map((t: any) => String(t ?? "").trim())
      .filter(Boolean)
      .slice(0, 30);

    // Evita estourar compute: CVM é pesado (ZIP grande), então batcheamos por mês.
    const funds = tickers.map((t: string) => normalizeCnpj(t)).filter((t: string) => isFundCnpj(t));
    const nonFunds = tickers.filter((t: string) => !isFundCnpj(t));

    // INF_DIARIO é muito pesado (ZIP grande + varredura completa). Para evitar WORKER_LIMIT,
    // limitamos a janela de fundos por chamada. O frontend já tem fallback (cotação atual/preço médio)
    // para preencher meses ausentes sem quebrar a UX.
    const fundMonths = Math.min(months, 2);
    const fundHistories = await fetchCvmFundsHistoriesBatch(funds, fundMonths);

    const limit = createLimiter(4);
    const otherHistories = await Promise.all(
      nonFunds.map((t: string) =>
        limit(async () => {
          const clean = String(t ?? "").trim().toUpperCase();
          // Rotas não-fundo seguem a lógica original
          return getHistoryForTicker(clean, months);
        }),
      ),
    );

    const histories: HistoryResponse[] = [];

    // Mantém a ordem do input
    for (const tRaw of tickers) {
      const t = String(tRaw ?? "").trim();
      const cnpj = normalizeCnpj(t);
      if (isFundCnpj(cnpj)) {
        histories.push({ ticker: cnpj, points: fundHistories[cnpj] ?? [] });
      } else {
        const upper = t.toUpperCase();
        const found = otherHistories.find((h) => h.ticker === upper);
        histories.push(found ?? { ticker: upper, points: [] });
      }
    }

    return json({ histories });
  } catch (error) {
    console.error("[get-price-history] error", error);
    return json({ error: "Erro ao buscar histórico" }, { status: 500 });
  }
}

