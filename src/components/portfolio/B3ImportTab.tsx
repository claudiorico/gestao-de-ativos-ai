import { useState, useMemo } from "react";
import { Upload, X, FileSpreadsheet } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { usePortfolios } from "@/hooks/usePortfolios";
import { useAssets } from "@/hooks/useAssets";
import { normalizeTickerForStorage } from "@/lib/ticker";
import { buildImportDedupKey } from "@/lib/import-dedup";
import type { Transaction, Dividend, Asset } from "@/types/financial";

type FileType = "negociacao" | "movimentacao" | null;

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

function parseDateBR(dateStr: string): number {
  // DD/MM/YYYY -> timestamp
  const [d, m, y] = dateStr.split("/").map(Number);
  if (!d || !m || !y) return Date.now();
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

function extractTicker(productName: string): string {
  // "BTHF11 - BTG PACTUAL..." -> "BTHF11"
  const match = productName.match(/^([A-Z0-9]+)/);
  return match ? match[1] : productName.slice(0, 10);
}

interface B3ImportTabProps {
  onImportComplete: () => void;
}

export function B3ImportTab({ onImportComplete }: B3ImportTabProps) {
  const { toast } = useToast();
  const {
    saveTransaction,
    saveDividend,
    saveCashMovement,
    getTransactions,
    getDividends,
    getCashMovements,
  } = useSecureStorage();
  const { portfolios } = usePortfolios();
  const { assets, createAsset } = useAssets();

  const [fileType, setFileType] = useState<FileType>(null);
  const [negociacaoRows, setNegociacaoRows] = useState<NegociacaoRow[]>([]);
  const [movimentacaoRows, setMovimentacaoRows] = useState<MovimentacaoRow[]>([]);
  const [defaultPortfolioForNewAssets, setDefaultPortfolioForNewAssets] = useState<string>("");
  const [autoCreateMissingAssets, setAutoCreateMissingAssets] = useState(true);
  const [isImporting, setIsImporting] = useState(false);

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
        }

        return { type: null, index: -1, headers: [] };
      };

      let rawRows: any[][] = [];
      let detected: { type: FileType; index: number; headers: string[] } = { type: null, index: -1, headers: [] };
      let detectedSheet: string | number | null = null;

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
            detectedSheet = s.name;
            break;
          }

          // fallback: se ainda não achou nada, pelo menos mantemos a 1ª aba pra debug
          if (!rawRows.length) {
            rawRows = rows;
            detectedSheet = s.name;
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

        // Ajuda a depurar rapidamente variações do arquivo (e também detectar se o arquivo tem múltiplas abas)
        console.warn("[B3Import] Could not detect headers.");
        if (detectedSheet != null) console.warn("[B3Import] sheet used:", detectedSheet);
        console.warn("[B3Import] First non-empty rows (raw):");

        let printed = 0;
        for (let i = 0; i < Math.min(rawRows.length, 200) && printed < 15; i++) {
          const r = rawRows[i];
          if (!Array.isArray(r)) continue;
          if (!r.some((c) => String(c ?? "").trim().length > 0)) continue;
          console.warn(`[B3Import] row ${i} raw:`, r);
          console.warn(`[B3Import] row ${i} normalized:`, r.map(normalizeHeader));
          printed++;
        }
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

  const toggleRowSelection = (index: number) => {
    if (fileType === "negociacao") {
      setNegociacaoRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r))
      );
    } else if (fileType === "movimentacao") {
      setMovimentacaoRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r))
      );
    }
  };

  const selectAll = () => {
    if (fileType === "negociacao") {
      setNegociacaoRows((prev) => prev.map((r) => ({ ...r, selected: true })));
    } else if (fileType === "movimentacao") {
      setMovimentacaoRows((prev) => prev.map((r) => ({ ...r, selected: true })));
    }
  };

  const deselectAll = () => {
    if (fileType === "negociacao") {
      setNegociacaoRows((prev) => prev.map((r) => ({ ...r, selected: false })));
    } else if (fileType === "movimentacao") {
      setMovimentacaoRows((prev) => prev.map((r) => ({ ...r, selected: false })));
    }
  };

  const assetsByTicker = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of assets) {
      const t = a.ticker.toUpperCase();
      const list = map.get(t) ?? [];
      list.push(a);
      map.set(t, list);
    }
    return map;
  }, [assets]);

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
    return defaultPortfolioForNewAssets || null;
  };

  const getOrCreateAssetForTicker = async (
    localMap: Map<string, Asset[]>,
    ticker: string,
    suggestedName?: string
  ): Promise<Asset | null> => {
    const existing = localMap.get(ticker) ?? [];

    if (existing.length === 1) return existing[0];

    if (existing.length > 1) {
      toast({
        title: `Ticker ${ticker} existe em mais de um portfólio`,
        description: "Abra o ativo e padronize em apenas um portfólio, ou importe manualmente.",
        variant: "destructive",
      });
      return null;
    }

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

    const asset = await createAsset({
      portfolioId,
      ticker,
      name: suggestedName ?? ticker,
      type: inferAssetType(ticker),
      targetAllocation: 0,
      shares: 0,
      averagePrice: 0,
    });

    localMap.set(ticker, [asset]);
    return asset;
  };

  const handleImport = async () => {
    setIsImporting(true);

    try {
      if (fileType === "negociacao") {
        await importNegociacoes();
      } else if (fileType === "movimentacao") {
        await importMovimentacoes();
      }

      toast({ title: "Importação concluída com sucesso!" });
      setFileType(null);
      setNegociacaoRows([]);
      setMovimentacaoRows([]);
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
    const localAssetByTicker = new Map(assetsByTicker);

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

    for (const row of selected) {
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
      const asset = await getOrCreateAssetForTicker(localAssetByTicker, ticker, ticker);
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

      const transaction: Transaction = {
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
      };

      await saveTransaction(transaction);
    }

    if (skippedDuplicates > 0) {
      toast({
        title: "Duplicidades ignoradas",
        description: `${skippedDuplicates} movimentaç${skippedDuplicates === 1 ? "ão" : "ões"} já existiam e não foram importadas.`,
      });
    }
  };

  const importMovimentacoes = async () => {
    const selected = movimentacaoRows.filter((r) => r.selected);
    const localAssetByTicker = new Map(assetsByTicker);

    // De-dup against existing vault entries and within this import batch.
    const [existingDividends, existingCash] = await Promise.all([
      getDividends(),
      getCashMovements(),
    ]);
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

    const batchKeys = new Set<string>();
    let skippedDuplicates = 0;

    for (const row of selected) {
      const movType = row.movementType.toLowerCase();

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
        const asset = await getOrCreateAssetForTicker(
          localAssetByTicker,
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

        const dividend: Dividend = {
          id: crypto.randomUUID(),
          assetId: asset.id,
          portfolioId: asset.portfolioId,
          type,
          valuePerShare: row.pricePerShare,
          shares: row.quantity,
          grossValue: row.value,
          taxWithheld: 0,
          totalValue: row.value,
          paymentDate,
          createdAt: Date.now(),
        };

        await saveDividend(dividend);
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
          const asset = await getOrCreateAssetForTicker(
            localAssetByTicker,
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

        await saveCashMovement({
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

    if (skippedDuplicates > 0) {
      toast({
        title: "Duplicidades ignoradas",
        description: `${skippedDuplicates} movimentaç${skippedDuplicates === 1 ? "ão" : "ões"} já existiam e não foram importadas.`,
      });
    }
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const selectedCount =
    fileType === "negociacao"
      ? negociacaoRows.filter((r) => r.selected).length
      : movimentacaoRows.filter((r) => r.selected).length;

  const totalCount = fileType === "negociacao" ? negociacaoRows.length : movimentacaoRows.length;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-card space-y-5">
      {!fileType ? (
        <>
          <div className="space-y-2">
            <Label>Selecione o arquivo XLSX da B3</Label>
            <p className="text-sm text-muted-foreground">
              Aceita dois formatos: <strong>Negociação</strong> (compra/venda) e <strong>Movimentação</strong> (proventos, transferências, etc.)
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
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold text-foreground">
                  {fileType === "negociacao" ? "Negociação" : "Movimentação"}
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
