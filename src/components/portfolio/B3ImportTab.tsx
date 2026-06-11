import { useState, useMemo, useEffect } from "react";
import { Upload, X, FileSpreadsheet, Download, HelpCircle, Copy } from "lucide-react";
import * as XLSX from "xlsx";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { usePortfolios } from "@/hooks/usePortfolios";
import { useAssets } from "@/hooks/useAssets";
import { normalizeTickerForStorage, tesouroTickerToName, isCeiArtifactName } from "@/lib/ticker";
import { buildImportDedupKey } from "@/lib/import-dedup";
import type { Transaction, Dividend, Asset, CashMovement } from "@/types/financial";

type FileType = "negociacao" | "movimentacao" | "fundos" | null;

interface NegociacaoRow {
  date: string;
  type: string;
  ticker: string;
  quantity: number;
  price: number;
  value: number;
  selected: boolean;
}

interface MovimentacaoRow {
  date: string;
  movementType: string;
  productName: string;
  ticker: string;
  quantity: number;
  pricePerShare: number;
  value: number;
  selected: boolean;
}

// Fundos de investimento (CNPJ) e Tesouro Direto: ativos cujo identificador
// não é um ticker de bolsa, então têm parser/tipo próprios.
interface FundoRow {
  date: string;
  ativo: string; // original (ex.: "CVM:29562673000117" ou "TD:PRE2035JUROS")
  name: string;
  ticker: string; // identificador já normalizado para armazenamento
  assetType: Asset["type"]; // investment_fund | fixed_income
  evento: string;
  type: "buy" | "sell";
  quantity: number;
  price: number;
  value: number;
  selected: boolean;
}

function parseDateBR(dateStr: string): number {
  // DD/MM/YYYY -> timestamp
  const [d, m, y] = dateStr.split("/").map(Number);
  if (!d || !m || !y) return Date.now();
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

// Converts B3 Tesouro Direto product names to TD: ticker format.
// Infers maturity month/day from bond type:
//   NTN-B Principal (IPCA+ sem juros) → May 15
//   NTN-B (IPCA+ com juros)           → Aug 15
//   LTN / NTN-F (Prefixado)           → Jan 1
//   Tesouro Selic                      → alphanum ticker (no price lookup support)
function extractTesouroTicker(productName: string): string | null {
  if (!/^Tesouro\s/i.test(String(productName ?? "").trim())) return null;

  const yearMatch = productName.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : "";
  const hasJuros = /juros\s+semestrais/i.test(productName);

  if (/IPCA/i.test(productName)) {
    const mmdd = hasJuros ? "08-15" : "05-15";
    const base = year ? `TD:IPCA${year}-${mmdd}` : "TD:IPCA";
    return hasJuros ? `${base}:JUROS` : base;
  }
  if (/Prefixado/i.test(productName)) {
    const base = year ? `TD:PRE${year}-01-01` : "TD:PRE";
    return hasJuros ? `${base}:JUROS` : base;
  }
  if (/Selic/i.test(productName)) {
    return year ? `TDSELIC${year}` : "TDSELIC";
  }

  const slug = productName
    .replace(/^Tesouro\s+/i, "")
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 10)
    .toUpperCase();
  return `TD${slug || "TESOURO"}`;
}

function extractTicker(productName: string): string {
  const td = extractTesouroTicker(productName);
  if (td) return td;
  // "BTHF11 - BTG PACTUAL..." -> "BTHF11"
  const match = productName.match(/^([A-Z0-9]+)/);
  return match ? match[1] : productName.slice(0, 10);
}

function downloadText(filename: string, text: string) {
  // BOM para o Excel abrir os acentos corretamente.
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Modelos de exemplo (1ª linha = cabeçalho que o importador reconhece).
const TEMPLATE_NEGOCIACAO = [
  "Data do Negócio;Tipo de Movimentação;Mercado;Prazo/Vencimento;Instituição;Código de Negociação;Quantidade;Preço;Valor",
  "02/01/2024;Compra;Mercado à Vista;;CORRETORA;PETR4;100;38,50;3850,00",
  "15/02/2024;Venda;Mercado à Vista;;CORRETORA;PETR4;50;40,00;2000,00",
  "10/03/2024;Compra;Mercado à Vista;;CORRETORA;HGLG11;30;160,00;4800,00",
].join("\n");

const TEMPLATE_MOVIMENTACAO = [
  "Entrada/Saída;Data;Movimentação;Produto;Instituição;Quantidade;Preço unitário;Valor da Operação",
  "Credito;20/01/2024;Dividendo;PETR4;CORRETORA;100;0,50;50,00",
  "Credito;20/02/2024;Rendimento;HGLG11;CORRETORA;30;0,90;27,00",
  "Credito;15/03/2024;Juros Sobre Capital Próprio;ITSA4;CORRETORA;200;0,12;24,00",
].join("\n");

const TEMPLATE_FUNDOS = [
  "ativo;classe;date;evento;quantidade;preco;valor;observacao",
  "CVM:00000000000191;FUNDO;10/01/2024;C;1000;1,05;1050,00;Nome do Fundo de Investimento",
  "TD:IPCA2035;RFIXA;12/01/2024;C;1,5;3200,00;4800,00;Tesouro IPCA+ 2035",
].join("\n");

// Guia para quem tem planilha própria: especificação dos formatos para colar num LLM.
const PROMPT_PLANILHA = `Tenho uma planilha com minhas operações de investimento e quero convertê-la em
arquivos CSV de importação. Gere os CSVs abaixo (delimitador ";", datas dd/mm/aaaa,
decimais com vírgula, valores sempre positivos — o tipo/lado indica compra ou venda).
A 1ª linha de cada arquivo deve ser EXATAMENTE o cabeçalho indicado.

1) NEGOCIAÇÃO (compra/venda de ações, FIIs, ETFs). Cabeçalho:
Data do Negócio;Tipo de Movimentação;Mercado;Prazo/Vencimento;Instituição;Código de Negociação;Quantidade;Preço;Valor
- Tipo de Movimentação = "Compra" ou "Venda"
- Mercado = "Mercado à Vista"; Código de Negociação = o ticker (ex.: PETR4, HGLG11)
- Valor = Quantidade × Preço

2) MOVIMENTAÇÃO (proventos). Cabeçalho:
Entrada/Saída;Data;Movimentação;Produto;Instituição;Quantidade;Preço unitário;Valor da Operação
- Entrada/Saída = "Credito"
- Movimentação = "Rendimento" | "Dividendo" | "Juros Sobre Capital Próprio" | "Reembolso"
- Produto = ticker; Valor da Operação = valor recebido

3) FUNDOS/TESOURO (fundos por CNPJ e Tesouro Direto). Cabeçalho:
ativo;classe;date;evento;quantidade;preco;valor;observacao
- ativo = "CVM:<cnpj 14 dígitos>" para fundos, ou "TD:<nome>" para Tesouro
- classe = "FUNDO" ou "RFIXA"; evento = "C" (compra) ou "V" (venda)
- observacao = nome do ativo

Eventos corporativos (desdobramento, bonificação, subscrição, IPO): trate como linhas de
NEGOCIAÇÃO ("Compra" com a quantidade recebida; Valor 0 quando não houve desembolso).
Não invente dados; se faltar um campo, deixe 0,00. Entregue cada CSV num bloco separado.`;

interface B3ImportTabProps {
  onImportComplete: () => void;
}

export function B3ImportTab({ onImportComplete }: B3ImportTabProps) {
  const { toast } = useToast();
  const {
    getAssets,
    saveAssetsBulk,
    saveTransactionsBulk,
    saveDividendsBulk,
    saveCashMovementsBulk,
    getTransactions,
    getDividends,
    getCashMovements,
  } = useSecureStorage();
  const { portfolios } = usePortfolios();
  const { refresh: refreshAssets } = useAssets();

  const [fileType, setFileType] = useState<FileType>(null);
  const [negociacaoRows, setNegociacaoRows] = useState<NegociacaoRow[]>([]);
  const [movimentacaoRows, setMovimentacaoRows] = useState<MovimentacaoRow[]>([]);
  const [fundoRows, setFundoRows] = useState<FundoRow[]>([]);
  const [defaultPortfolioForNewAssets, setDefaultPortfolioForNewAssets] = useState<string>("");
  const [autoCreateMissingAssets, setAutoCreateMissingAssets] = useState(true);
  const [isImporting, setIsImporting] = useState(false);

  // Pré-seleciona a primeira carteira como destino dos ativos novos (quando há mais de uma),
  // para o usuário ver/escolher em vez de o importador descartar por falta de seleção.
  useEffect(() => {
    if (portfolios.length > 1 && !defaultPortfolioForNewAssets) {
      setDefaultPortfolioForNewAssets(portfolios[0].id);
    }
  }, [portfolios, defaultPortfolioForNewAssets]);

  const normalizeHeader = (v: unknown) =>
    String(v ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");

  const parseCsvToRows = async (file: File): Promise<any[][]> => {
    const text = await file.text();

    // B3 costuma exportar com ';' e vírgula decimal.
    // Aqui só precisamos das colunas (strings/números), então fazemos um split simples.
    const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
    const delimiter = firstLine.includes(";") ? ";" : ",";

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const parseCell = (cell: string) => {
      const raw = cell.replace(/^"|"$/g, "").trim();

      // tenta número BR (1.234,56)
      const cleaned = raw.replace(/\./g, "").replace(/,/g, ".");
      const n = Number(cleaned);
      if (raw && Number.isFinite(n) && /\d/.test(raw)) return n;
      return raw;
    };

    return lines.map((line) => line.split(delimiter).map(parseCell));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const lower = file.name.toLowerCase();
      const isCsv = lower.endsWith(".csv");

      const readExcelSheets = async (f: File): Promise<Array<{ name: string; rows: any[][] }>> => {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });

        return wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const rows = (XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as any[][]) ?? [];
          return { name, rows };
        });
      };

      // XLSX/XLS da B3 pode vir com múltiplas abas e/ou em formato .xls.
      // Aqui tentamos detectar a aba correta varrendo todas as abas.
      const detectHeader = (allRows: any[][]): { type: FileType; index: number; headers: string[] } => {
        // Alguns arquivos da B3 têm muitos blocos antes do cabeçalho (título, avisos, etc.).
        // Então escaneamos um range maior.
        const maxScan = Math.min(allRows.length, 500);

        for (let i = 0; i < maxScan; i++) {
          const row = allRows[i];
          if (!Array.isArray(row)) continue;

          const normalized = row.map(normalizeHeader).filter((h) => h.length > 0);

          const isNeg = normalized.includes("data do negocio") && normalized.includes("tipo de movimentacao");
          if (isNeg) return { type: "negociacao", index: i, headers: normalized };

          const isMov = normalized.includes("entrada/saida") && normalized.includes("movimentacao");
          if (isMov) return { type: "movimentacao", index: i, headers: normalized };

          // Formato próprio de fundos/tesouro: ativo;classe;date;evento;quantidade;preco;valor;observacao
          const isFundos =
            normalized.includes("classe") &&
            normalized.includes("ativo") &&
            normalized.includes("evento");
          if (isFundos) return { type: "fundos", index: i, headers: normalized };
        }

        return { type: null, index: -1, headers: [] };
      };

      let rawRows: any[][] = [];
      let detected: { type: FileType; index: number; headers: string[] } = { type: null, index: -1, headers: [] };

      if (isCsv) {
        rawRows = await parseCsvToRows(file);
        detected = detectHeader(rawRows);
      } else {
        const sheets = await readExcelSheets(file);
        const sheetsToTry = sheets.length ? sheets : [{ name: "(sem nome)", rows: [] as any[][] }];

        for (const s of sheetsToTry) {
          const rows = s.rows;
          if (!rows?.length) continue;

          const d = detectHeader(rows);
          if (d.type && d.index >= 0) {
            rawRows = rows;
            detected = d;
            break;
          }

          // fallback: se ainda não achou nada, pelo menos mantemos a 1ª aba
          if (!rawRows.length) {
            rawRows = rows;
          }
        }
      }

      if (!rawRows?.length) {
        toast({
          title: "Arquivo vazio",
          description: "O arquivo não contém linhas para importar.",
          variant: "destructive",
        });
        return;
      }

      if (!detected.type || detected.index < 0) {
        toast({
          title: "Formato não reconhecido",
          description:
            "Envie um arquivo exportado da B3 (XLSX ou CSV). Se possível, exporte as abas de Negociação/Movimentação.",
          variant: "destructive",
        });
        return;
      }

      // Normaliza para que o parser continue esperando o header em rows[0]
      const rows = rawRows.slice(detected.index);

      if (detected.type === "negociacao") {
        parseNegociacaoFile(rows);
        setFileType("negociacao");
        toast({ title: "Arquivo de Negociação detectado" });
      } else if (detected.type === "movimentacao") {
        parseMovimentacaoFile(rows);
        setFileType("movimentacao");
        toast({ title: "Arquivo de Movimentação detectado" });
      } else if (detected.type === "fundos") {
        parseFundosFile(rows);
        setFileType("fundos");
        toast({ title: "Arquivo de Fundos/Tesouro detectado" });
      }
    } catch (error) {
      console.error("[B3Import] Parse error:", error);
      toast({ title: "Erro ao ler arquivo", variant: "destructive" });
    } finally {
      // Reset input
      e.target.value = "";
    }
  };

  const parseNegociacaoFile = (rows: any[][]) => {
    const parsed: NegociacaoRow[] = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 8) continue;

      const [dateStr, typeStr, , , , ticker, qty, price, value] = row;
      
      if (!dateStr || !ticker) continue;

      parsed.push({
        date: String(dateStr),
        type: String(typeStr || "").toLowerCase().includes("compra") ? "buy" : "sell",
        ticker: normalizeTickerForStorage(String(ticker || "")),
        quantity: Number(qty) || 0,
        price: Number(price) || 0,
        value: Number(value) || 0,
        selected: true,
      });
    }

    setNegociacaoRows(parsed);
  };

  const parseMovimentacaoFile = (rows: any[][]) => {
    const parsed: MovimentacaoRow[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 8) continue;

      const [, dateStr, movementType, productName, , qty, pricePerShare, value] = row;

      if (!dateStr || !productName) continue;

      const ticker = extractTicker(String(productName));

      parsed.push({
        date: String(dateStr),
        movementType: String(movementType || ""),
        productName: String(productName),
        ticker: normalizeTickerForStorage(ticker),
        quantity: Number(qty) || 0,
        pricePerShare: Number(pricePerShare) || 0,
        value: Number(value) || 0,
        selected: true,
      });
    }

    setMovimentacaoRows(parsed);
  };

  const parseFundosFile = (rows: any[][]) => {
    const parsed: FundoRow[] = [];

    // Cabeçalho: ativo;classe;date;evento;quantidade;preco;valor;observacao
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 7) continue;

      const [ativo, classe, dateStr, evento, qty, price, value, obs] = row;
      if (!ativo || !dateStr) continue;

      const classeNorm = normalizeHeader(classe);
      const ativoStr = String(ativo).trim();
      const isFixedIncome =
        classeNorm.includes("fixa") ||
        classeNorm.includes("tesouro") ||
        /^TD:/i.test(ativoStr);
      const assetType: Asset["type"] = isFixedIncome ? "fixed_income" : "investment_fund";

      // Identificador armazenado: fundo CVM -> CNPJ (14 dígitos); tesouro -> remove o prefixo "TD:".
      const tickerBase = isFixedIncome ? ativoStr.replace(/^TD:/i, "") : ativoStr;
      const ticker = normalizeTickerForStorage(tickerBase, assetType);

      const ev = String(evento || "").trim().toUpperCase();
      // C = compra; V/C.COTA (come-cotas) = saída de cotas.
      const type: "buy" | "sell" = ev === "C" ? "buy" : "sell";

      const obsStr = String(obs || "").trim();
      // Se obs é um artefato CEI sem valor descritivo, tenta derivar o nome do ticker
      const derivedName = (isCeiArtifactName(obsStr) || !obsStr) && isFixedIncome
        ? (tesouroTickerToName(ticker) ?? (obsStr || ativoStr))
        : (obsStr || ativoStr);

      parsed.push({
        date: String(dateStr),
        ativo: ativoStr,
        name: derivedName,
        ticker,
        assetType,
        evento: ev,
        type,
        quantity: Math.abs(Number(qty) || 0),
        price: Math.abs(Number(price) || 0),
        value: Math.abs(Number(value) || 0),
        selected: true,
      });
    }

    setFundoRows(parsed);
  };

  const toggleRowSelection = (index: number) => {
    if (fileType === "negociacao") {
      setNegociacaoRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r))
      );
    } else if (fileType === "movimentacao") {
      setMovimentacaoRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r))
      );
    } else if (fileType === "fundos") {
      setFundoRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r))
      );
    }
  };

  const selectAll = () => {
    if (fileType === "negociacao") {
      setNegociacaoRows((prev) => prev.map((r) => ({ ...r, selected: true })));
    } else if (fileType === "movimentacao") {
      setMovimentacaoRows((prev) => prev.map((r) => ({ ...r, selected: true })));
    } else if (fileType === "fundos") {
      setFundoRows((prev) => prev.map((r) => ({ ...r, selected: true })));
    }
  };

  const deselectAll = () => {
    if (fileType === "negociacao") {
      setNegociacaoRows((prev) => prev.map((r) => ({ ...r, selected: false })));
    } else if (fileType === "movimentacao") {
      setMovimentacaoRows((prev) => prev.map((r) => ({ ...r, selected: false })));
    } else if (fileType === "fundos") {
      setFundoRows((prev) => prev.map((r) => ({ ...r, selected: false })));
    }
  };

  // Monta o índice ticker -> ativos lendo SEMPRE do cofre (fresco), e não de um estado
  // em memória que pode estar desatualizado (ex.: após remover órfãos). Evita pular
  // ativos achando que existem duplicados que já foram apagados.
  const buildAssetMap = async (): Promise<Map<string, Asset[]>> => {
    const all = await getAssets();
    const map = new Map<string, Asset[]>();
    for (const a of all) {
      const t = a.ticker.toUpperCase();
      const list = map.get(t) ?? [];
      list.push(a);
      map.set(t, list);
    }
    return map;
  };

  const tickerSchema = useMemo(
    () => z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,15}$/, "Ticker inválido"),
    []
  );

  const inferAssetType = (ticker: string): Asset["type"] => {
    // Heurística simples para B3
    if (/\d{2}$/.test(ticker) && ticker.endsWith("11")) return "reit";
    if (ticker.endsWith("34")) return "international";
    if (ticker.endsWith("39")) return "etf";
    return "stock";
  };

  const normalizeAssetName = (raw: string, fallback: string) => {
    const name = raw
      .replace(/^([A-Z0-9]+)\s*-\s*/i, "")
      .trim();
    return (name || fallback).toUpperCase().slice(0, 120);
  };

  const resolvePortfolioForNewAssets = () => {
    if (portfolios.length === 1) return portfolios[0].id;
    // Usa a carteira escolhida; se nenhuma foi escolhida, cai na primeira (em vez de
    // descartar silenciosamente os ativos novos quando há mais de uma carteira).
    return defaultPortfolioForNewAssets || portfolios[0]?.id || null;
  };

  // Resolve um ativo existente ou prepara um novo (sem persistir ainda). Os ativos novos
  // são acumulados em `newAssets` para gravação em lote ao final da importação.
  const resolveOrStageAsset = (
    localMap: Map<string, Asset[]>,
    newAssets: Asset[],
    ticker: string,
    suggestedName?: string,
    typeOverride?: Asset["type"]
  ): Asset | null => {
    const existing = localMap.get(ticker) ?? [];

    // Se já existe (1 ou mais), reutiliza o primeiro — não bloqueia a importação por
    // duplicidade. Assim, mesmo que tenha sobrado um ativo duplicado de tentativas
    // anteriores, as transações entram normalmente.
    if (existing.length >= 1) return existing[0];

    if (!autoCreateMissingAssets) return null;

    const portfolioId = resolvePortfolioForNewAssets();
    if (!portfolioId) {
      toast({
        title: "Escolha um portfólio padrão",
        description:
          "Para criar ativos novos automaticamente, selecione um portfólio padrão de criação.",
        variant: "destructive",
      });
      return null;
    }

    const now = Date.now();
    const asset: Asset = {
      id: crypto.randomUUID(),
      portfolioId,
      ticker: normalizeTickerForStorage(ticker, typeOverride),
      name: suggestedName ?? ticker,
      type: typeOverride ?? inferAssetType(ticker),
      targetAllocation: 0,
      shares: 0,
      averagePrice: 0,
      createdAt: now,
      updatedAt: now,
    };

    localMap.set(ticker, [asset]);
    newAssets.push(asset);
    return asset;
  };

  const handleImport = async () => {
    setIsImporting(true);

    try {
      let summary = "";
      if (fileType === "negociacao") {
        summary = await importNegociacoes();
      } else if (fileType === "movimentacao") {
        summary = await importMovimentacoes();
      } else if (fileType === "fundos") {
        summary = await importFundos();
      }

      // Recarrega os ativos para que uma próxima importação na sequência enxergue
      // os que acabamos de criar (evita duplicar ativos entre arquivos).
      await refreshAssets();

      toast({ title: "Importação concluída com sucesso!", description: summary });
      setFileType(null);
      setNegociacaoRows([]);
      setMovimentacaoRows([]);
      setFundoRows([]);
      setDefaultPortfolioForNewAssets("");
      onImportComplete();
    } catch (error) {
      console.error("Import error:", error);
      toast({ title: "Erro na importação", variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  const importNegociacoes = async () => {
    const selected = negociacaoRows.filter((r) => r.selected);
    const localAssetByTicker = await buildAssetMap();
    const newAssets: Asset[] = [];
    const newTransactions: Transaction[] = [];

    // De-dup against existing vault entries and within this import batch.
    const existingTransactions = await getTransactions();
    const existingKeys = new Set(
      existingTransactions.map((t) =>
        buildImportDedupKey({
          scope: `tx:${t.assetId}:${t.type}`,
          date: t.date,
          quantity: t.shares,
          value: t.totalValue,
        })
      )
    );
    const batchKeys = new Set<string>();
    let skippedDuplicates = 0;
    let invalidTickers = 0;

    for (const row of selected) {
      const tickerParsed = tickerSchema.safeParse(row.ticker);
      if (!tickerParsed.success) {
        invalidTickers++;
        continue;
      }

      const ticker = tickerParsed.data;
      const asset = resolveOrStageAsset(localAssetByTicker, newAssets, ticker, ticker);
      if (!asset) continue;

      const date = parseDateBR(row.date);
      const dedupKey = buildImportDedupKey({
        scope: `tx:${asset.id}:${row.type}`,
        date,
        quantity: row.quantity,
        value: row.value,
      });

      if (existingKeys.has(dedupKey) || batchKeys.has(dedupKey)) {
        skippedDuplicates++;
        continue;
      }
      batchKeys.add(dedupKey);

      newTransactions.push({
        id: crypto.randomUUID(),
        assetId: asset.id,
        portfolioId: asset.portfolioId,
        type: row.type as "buy" | "sell",
        shares: row.quantity,
        pricePerShare: row.price,
        fees: 0,
        totalValue: row.value,
        date,
        notes: "Importado B3",
        createdAt: Date.now(),
      });
    }

    await saveAssetsBulk(newAssets);
    await saveTransactionsBulk(newTransactions);

    return `${newAssets.length} ativos novos, ${newTransactions.length} transações${
      skippedDuplicates ? `, ${skippedDuplicates} duplicadas ignoradas` : ""
    }${invalidTickers ? `, ${invalidTickers} inválidas` : ""}.`;
  };

  const importMovimentacoes = async () => {
    const selected = movimentacaoRows.filter((r) => r.selected);
    const localAssetByTicker = await buildAssetMap();
    const newAssets: Asset[] = [];
    const newTransactions: Transaction[] = [];
    const newDividends: Dividend[] = [];
    const newCash: CashMovement[] = [];

    // De-dup against existing vault entries and within this import batch.
    // Also load all transactions to calculate shares held on each payment date.
    const [existingDividends, existingCash, allTxs] = await Promise.all([
      getDividends(),
      getCashMovements(),
      getTransactions(),
    ]);

    // assetId → transactions sorted by date; used to compute holding qty at provento date.
    const txsByAsset = new Map<string, Transaction[]>();
    for (const tx of allTxs) {
      const list = txsByAsset.get(tx.assetId) ?? [];
      list.push(tx);
      txsByAsset.set(tx.assetId, list);
    }
    const existingKeys = new Set<string>();
    for (const d of existingDividends) {
      existingKeys.add(
        buildImportDedupKey({
          scope: `div:${d.assetId}:${d.type}`,
          date: d.paymentDate,
          quantity: d.shares,
          value: d.totalValue,
        })
      );
    }
    for (const c of existingCash) {
      existingKeys.add(
        buildImportDedupKey({
          scope: `cash:${c.portfolioId}:${c.type}`,
          date: c.date,
          quantity: 0,
          value: c.value,
        })
      );
    }
    for (const tx of allTxs) {
      existingKeys.add(
        buildImportDedupKey({
          scope: `tx:${tx.assetId}:${tx.type}`,
          date: tx.date,
          quantity: tx.shares,
          value: tx.totalValue,
        })
      );
    }

    const batchKeys = new Set<string>();
    let skippedDuplicates = 0;

    for (const row of selected) {
      const movType = row.movementType.toLowerCase();

      // --- Tesouro Direto: compra/venda/rendimento detectados pelo nome do produto ---
      const tdTicker = extractTesouroTicker(row.productName);
      if (tdTicker) {
        const tdName = isCeiArtifactName(row.productName)
          ? (tesouroTickerToName(tdTicker) ?? row.productName)
          : row.productName;
        const asset = resolveOrStageAsset(
          localAssetByTicker,
          newAssets,
          tdTicker,
          tdName,
          "fixed_income"
        );
        if (!asset) continue;

        const date = parseDateBR(row.date);

        const isCompra = movType.includes("compra") || movType.includes("transferência");
        const isVenda = movType.includes("venda") || movType.includes("resgate");
        const isRendimento = movType.includes("rendimento");

        if (isCompra || isVenda) {
          const txType = isCompra ? "buy" : "sell";
          const qty = row.quantity > 0 ? row.quantity : 1;
          const ppu = row.pricePerShare > 0 ? row.pricePerShare : row.value / qty;
          const dedupKey = buildImportDedupKey({
            scope: `tx:${asset.id}:${txType}`,
            date,
            quantity: qty,
            value: row.value,
          });
          if (existingKeys.has(dedupKey) || batchKeys.has(dedupKey)) { skippedDuplicates++; continue; }
          batchKeys.add(dedupKey);
          newTransactions.push({
            id: crypto.randomUUID(),
            assetId: asset.id,
            portfolioId: asset.portfolioId,
            type: txType,
            shares: qty,
            pricePerShare: ppu,
            fees: 0,
            totalValue: row.value,
            date,
            notes: `Importado B3 • ${row.movementType}`,
            createdAt: Date.now(),
          });
        } else if (isRendimento) {
          const dedupKey = buildImportDedupKey({
            scope: `div:${asset.id}:yield`,
            date,
            quantity: row.quantity,
            value: row.value,
          });
          if (existingKeys.has(dedupKey) || batchKeys.has(dedupKey)) { skippedDuplicates++; continue; }
          batchKeys.add(dedupKey);
          const qty = row.quantity > 0 ? row.quantity : 0;
          newDividends.push({
            id: crypto.randomUUID(),
            assetId: asset.id,
            portfolioId: asset.portfolioId,
            type: "yield",
            valuePerShare: qty > 0 ? row.value / qty : row.value,
            shares: qty,
            grossValue: row.value,
            taxWithheld: 0,
            totalValue: row.value,
            paymentDate: date,
            createdAt: Date.now(),
          });
        }
        // outros eventos do Tesouro (Atualização, etc.) são ignorados
        continue;
      }

      const isDividendLike =
        movType.includes("rendimento") ||
        movType.includes("dividendo") ||
        movType.includes("jcp") ||
        movType.includes("juros");

      const isJcp = movType.includes("jcp") || movType.includes("juros");

      // Proventos: Dividendos / JCP / Rendimentos
      if (isDividendLike) {
        const tickerParsed = tickerSchema.safeParse(row.ticker);
        if (!tickerParsed.success) {
          toast({
            title: "Ticker inválido no arquivo",
            description: String(row.ticker),
            variant: "destructive",
          });
          continue;
        }

        const ticker = tickerParsed.data;
        const asset = resolveOrStageAsset(
          localAssetByTicker,
          newAssets,
          ticker,
          normalizeAssetName(row.productName, ticker)
        );
        if (!asset) continue;

        const paymentDate = parseDateBR(row.date);
        const type = isJcp ? "jcp" : "yield";
        const dedupKey = buildImportDedupKey({
          scope: `div:${asset.id}:${type}`,
          date: paymentDate,
          quantity: row.quantity,
          value: row.value,
        });
        if (existingKeys.has(dedupKey) || batchKeys.has(dedupKey)) {
          skippedDuplicates++;
          continue;
        }
        batchKeys.add(dedupKey);

        // If the B3 report already has the quantity, use it; otherwise derive from
        // the transaction history: sum all buys minus sells up to paymentDate.
        let sharesOnDate = row.quantity > 0 ? row.quantity : 0;
        if (sharesOnDate === 0) {
          const assetTxs = txsByAsset.get(asset.id) ?? [];
          for (const tx of assetTxs) {
            if (tx.date <= paymentDate) {
              sharesOnDate += tx.type === "buy" ? tx.shares : -tx.shares;
            }
          }
          sharesOnDate = Math.max(0, Math.round(sharesOnDate * 1e8) / 1e8);
        }
        const valuePerShare =
          sharesOnDate > 0 ? row.value / sharesOnDate : row.pricePerShare;

        newDividends.push({
          id: crypto.randomUUID(),
          assetId: asset.id,
          portfolioId: asset.portfolioId,
          type,
          valuePerShare,
          shares: sharesOnDate,
          grossValue: row.value,
          taxWithheld: 0,
          totalValue: row.value,
          paymentDate,
          createdAt: Date.now(),
        });
        continue;
      }

      // Reembolso (geralmente eventos como reembolso de capital em fundos/ativos)
      if (movType.includes("reembolso")) {
        // Preferimos associar ao portfólio do ativo (pelo ticker no nome do produto).
        // Se não conseguirmos resolver/ criar ativo, caímos para o portfólio padrão (se houver).
        const tickerParsed = tickerSchema.safeParse(row.ticker);
        const ticker = tickerParsed.success ? tickerParsed.data : null;

        let portfolioId: string | null = null;

        if (ticker) {
          const asset = resolveOrStageAsset(
            localAssetByTicker,
            newAssets,
            ticker,
            normalizeAssetName(row.productName, ticker)
          );
          portfolioId = asset?.portfolioId ?? null;
        }

        if (!portfolioId) {
          portfolioId = resolvePortfolioForNewAssets();
        }

        if (!portfolioId) {
          toast({
            title: "Reembolso sem portfólio",
            description: "Selecione um portfólio padrão para importar eventos de reembolso.",
            variant: "destructive",
          });
          continue;
        }

        const date = parseDateBR(row.date);
        const value = Math.abs(row.value);
        const dedupKey = buildImportDedupKey({
          scope: `cash:${portfolioId}:deposit`,
          date,
          quantity: 0,
          value,
        });
        if (existingKeys.has(dedupKey) || batchKeys.has(dedupKey)) {
          skippedDuplicates++;
          continue;
        }
        batchKeys.add(dedupKey);

        newCash.push({
          id: crypto.randomUUID(),
          portfolioId,
          type: "deposit",
          value,
          date,
          notes: `Importado B3 • ${row.movementType}${row.productName ? ` • ${row.productName}` : ""}`,
          createdAt: Date.now(),
        });

        continue;
      }

      // Add more conditions for other movement types as needed
    }

    await saveAssetsBulk(newAssets);
    await saveTransactionsBulk(newTransactions);
    await saveDividendsBulk(newDividends);
    await saveCashMovementsBulk(newCash);

    return `${newAssets.length} ativos novos, ${newTransactions.length} transações, ${newDividends.length} proventos, ${newCash.length} em caixa${
      skippedDuplicates ? `, ${skippedDuplicates} duplicadas ignoradas` : ""
    }.`;
  };

  const importFundos = async () => {
    const selected = fundoRows.filter((r) => r.selected);
    const localAssetByTicker = await buildAssetMap();
    const newAssets: Asset[] = [];
    const newTransactions: Transaction[] = [];
    let invalidAssets = 0;

    // De-dup contra o cofre e dentro do lote (mesma chave usada nas negociações).
    const existingTransactions = await getTransactions();
    const existingKeys = new Set(
      existingTransactions.map((t) =>
        buildImportDedupKey({
          scope: `tx:${t.assetId}:${t.type}`,
          date: t.date,
          quantity: t.shares,
          value: t.totalValue,
        })
      )
    );
    const batchKeys = new Set<string>();
    let skippedDuplicates = 0;

    for (const row of selected) {
      if (!row.ticker) {
        invalidAssets++;
        continue;
      }

      const asset = resolveOrStageAsset(
        localAssetByTicker,
        newAssets,
        row.ticker.toUpperCase(),
        row.name,
        row.assetType
      );
      if (!asset) continue;

      const date = parseDateBR(row.date);
      const dedupKey = buildImportDedupKey({
        scope: `tx:${asset.id}:${row.type}`,
        date,
        quantity: row.quantity,
        value: row.value,
      });

      if (existingKeys.has(dedupKey) || batchKeys.has(dedupKey)) {
        skippedDuplicates++;
        continue;
      }
      batchKeys.add(dedupKey);

      newTransactions.push({
        id: crypto.randomUUID(),
        assetId: asset.id,
        portfolioId: asset.portfolioId,
        type: row.type,
        shares: row.quantity,
        pricePerShare: row.price,
        fees: 0,
        totalValue: row.value,
        date,
        notes: `Importado planilha • ${row.evento}`,
        createdAt: Date.now(),
      });
    }

    await saveAssetsBulk(newAssets);
    await saveTransactionsBulk(newTransactions);

    return `${newAssets.length} ativos novos, ${newTransactions.length} transações${
      skippedDuplicates ? `, ${skippedDuplicates} duplicadas ignoradas` : ""
    }${invalidAssets ? `, ${invalidAssets} inválidas` : ""}.`;
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const activeRows =
    fileType === "negociacao"
      ? negociacaoRows
      : fileType === "movimentacao"
      ? movimentacaoRows
      : fileType === "fundos"
      ? fundoRows
      : [];

  const selectedCount = activeRows.filter((r) => r.selected).length;
  const totalCount = activeRows.length;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-card space-y-5">
      {!fileType ? (
        <>
          <div className="space-y-2">
            <Label>Selecione o arquivo XLSX da B3</Label>
            <p className="text-sm text-muted-foreground">
              Aceita três formatos: <strong>Negociação</strong> (compra/venda), <strong>Movimentação</strong> (proventos) e <strong>Fundos/Tesouro</strong> (fundos por CNPJ e Tesouro Direto).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
              id="b3-file-input"
            />
            <label htmlFor="b3-file-input">
              <Button variant="outline" className="gap-2" asChild>
                <span>
                  <Upload className="h-4 w-4" />
                  Selecionar arquivo
                </span>
              </Button>
            </label>
          </div>

          {/* Ajuda: modelos para baixar + guia para planilha própria */}
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Não sabe o formato? Baixe um modelo</p>
              <p className="text-xs text-muted-foreground">
                Relatórios oficiais da B3 (Negociação e Movimentação) já importam direto. Os modelos
                abaixo mostram as colunas esperadas.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => downloadText("modelo_negociacao.csv", TEMPLATE_NEGOCIACAO)}
              >
                <Download className="h-4 w-4" />
                Negociação
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => downloadText("modelo_movimentacao.csv", TEMPLATE_MOVIMENTACAO)}
              >
                <Download className="h-4 w-4" />
                Movimentação
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => downloadText("modelo_fundos_tesouro.csv", TEMPLATE_FUNDOS)}
              >
                <Download className="h-4 w-4" />
                Fundos/Tesouro
              </Button>
            </div>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 px-0 text-primary hover:bg-transparent">
                  <HelpCircle className="h-4 w-4" />
                  Tenho uma planilha própria
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Converter sua planilha</DialogTitle>
                  <DialogDescription>
                    Copie o texto abaixo e cole num assistente de IA (ChatGPT, Claude, etc.) junto
                    com os dados da sua planilha. Ele gera os CSVs no formato que o app importa.
                  </DialogDescription>
                </DialogHeader>
                <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-muted/50 p-3 text-xs whitespace-pre-wrap">
                  {PROMPT_PLANILHA}
                </pre>
                <Button
                  className="gap-2"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(PROMPT_PLANILHA);
                      toast({ title: "Guia copiado para a área de transferência" });
                    } catch {
                      toast({ title: "Não foi possível copiar", variant: "destructive" });
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                  Copiar guia
                </Button>
              </DialogContent>
            </Dialog>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold text-foreground">
                  {fileType === "negociacao"
                    ? "Negociação"
                    : fileType === "movimentacao"
                    ? "Movimentação"
                    : "Fundos/Tesouro"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedCount} de {totalCount} selecionadas
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll}>
                Selecionar todas
              </Button>
              <Button variant="ghost" size="sm" onClick={deselectAll}>
                Limpar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFileType(null);
                  setNegociacaoRows([]);
                  setMovimentacaoRows([]);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Importação automática</Label>

            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                checked={autoCreateMissingAssets}
                onCheckedChange={(v) => setAutoCreateMissingAssets(Boolean(v))}
              />
              <span className="text-sm text-muted-foreground">
                Criar ativo automaticamente quando não existir (alocação alvo = 0%)
              </span>
            </div>

            {autoCreateMissingAssets && portfolios.length > 1 && (
              <div className="space-y-2 pt-2">
                <Label>Portfólio padrão para criar ativos novos</Label>
                <Select
                  value={defaultPortfolioForNewAssets}
                  onValueChange={setDefaultPortfolioForNewAssets}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o portfólio" />
                  </SelectTrigger>
                  <SelectContent>
                    {portfolios.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Só é usado quando o ticker ainda não existe em nenhum portfólio.
                </p>
              </div>
            )}
          </div>

          <div className="max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-12 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left">Data</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Ativo</th>
                  <th className="px-3 py-2 text-right">Qtd</th>
                  <th className="px-3 py-2 text-right">Preço</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fileType === "negociacao" &&
                  negociacaoRows.map((row, index) => (
                    <tr
                      key={index}
                      className={row.selected ? "bg-card" : "bg-muted/20 opacity-50"}
                    >
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={row.selected}
                          onCheckedChange={() => toggleRowSelection(index)}
                        />
                      </td>
                      <td className="px-3 py-2">{row.date}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            row.type === "buy" ? "text-primary font-medium" : "text-loss font-medium"
                          }
                        >
                          {row.type === "buy" ? "Compra" : "Venda"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">{row.ticker}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.price)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {formatCurrency(row.value)}
                      </td>
                    </tr>
                  ))}

                {fileType === "movimentacao" &&
                  movimentacaoRows.map((row, index) => (
                    <tr
                      key={index}
                      className={row.selected ? "bg-card" : "bg-muted/20 opacity-50"}
                    >
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={row.selected}
                          onCheckedChange={() => toggleRowSelection(index)}
                        />
                      </td>
                      <td className="px-3 py-2">{row.date}</td>
                      <td className="px-3 py-2 text-xs">{row.movementType}</td>
                      <td className="px-3 py-2 font-mono font-semibold">{row.ticker}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.quantity || "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.pricePerShare ? formatCurrency(row.pricePerShare) : "-"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {formatCurrency(row.value)}
                      </td>
                    </tr>
                  ))}

                {fileType === "fundos" &&
                  fundoRows.map((row, index) => (
                    <tr
                      key={index}
                      className={row.selected ? "bg-card" : "bg-muted/20 opacity-50"}
                    >
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={row.selected}
                          onCheckedChange={() => toggleRowSelection(index)}
                        />
                      </td>
                      <td className="px-3 py-2">{row.date}</td>
                      <td className="px-3 py-2 text-xs">{row.evento}</td>
                      <td className="px-3 py-2 font-mono font-semibold" title={row.ativo}>
                        {row.name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.quantity || "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.price ? formatCurrency(row.price) : "-"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {formatCurrency(row.value)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setFileType(null);
                setNegociacaoRows([]);
                setMovimentacaoRows([]);
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={isImporting || selectedCount === 0}>
              {isImporting ? "Importando..." : `Importar ${selectedCount} movimentações`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
