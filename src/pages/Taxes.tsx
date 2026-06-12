import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { motion } from "framer-motion";
import {
  FileText,
  Download,
  AlertTriangle,
  CheckCircle,
  Calculator,
  Eye,
  ExternalLink,
  Info,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import type { Asset, Dividend, Portfolio, Transaction } from "@/types/financial";
import {
  computeMonthlyApuration,
  defaultTaxEngineConfig,
  type MonthlyApuration,
  type TaxEngineOutput,
} from "@/lib/tax-engine";
import { TaxAuditDialog } from "@/components/taxes/TaxAuditDialog";
import * as XLSX from "xlsx";

import { Blur } from "@/components/ui/blur";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

const formatDate = (ms: number) =>
  new Intl.DateTimeFormat("pt-BR").format(new Date(ms));

const statusConfig = {
  paid: { label: "Pago", color: "text-success", bg: "bg-success/10", icon: CheckCircle },
  pending: { label: "Pendente", color: "text-warning", bg: "bg-warning/10", icon: AlertTriangle },
  exempt: { label: "Isento", color: "text-muted-foreground", bg: "bg-muted", icon: CheckCircle },
};

type DarfRow = {
  key: string;
  label: string;
  gain: number;
  tax: number;
  status: keyof typeof statusConfig;
};

function formatMonthLabel(ym: string) {
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return ym;
  const d = new Date(y, m - 1, 1);
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(d);
  const prettyMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  return `${prettyMonth} / ${y}`;
}

function sumMonthGain(month: MonthlyApuration) {
  const c = month.categories;
  return (c.B3_EQUITIES?.netResult ?? 0) + (c.B3_FII?.netResult ?? 0) + (c.CRYPTO?.netResult ?? 0);
}

function irpfCode(type: Asset["type"]): string {
  switch (type) {
    case "reit": return "73";
    case "crypto": return "89";
    case "investment_fund": return "71";
    case "fixed_income": return "06";
    default: return "31"; // stock, etf, international
  }
}

// Compute asset positions at end-of-day 31/12/year using FIFO-compatible weighted average
function computePositionsAt(
  assets: Asset[],
  transactions: Transaction[],
  year: number,
  portfolioId?: string,
) {
  const endMs = new Date(year, 11, 31, 23, 59, 59, 999).getTime();
  const assetMap = new Map(assets.map((a) => [a.id, a]));

  const positions = new Map<string, { qty: number; totalCost: number }>();

  const relevant = transactions
    .filter((t) => t.date <= endMs)
    .filter((t) => !portfolioId || t.portfolioId === portfolioId)
    .sort((a, b) => a.date - b.date);

  for (const tx of relevant) {
    const pos = positions.get(tx.assetId) ?? { qty: 0, totalCost: 0 };
    if (tx.type === "buy") {
      pos.totalCost += tx.totalValue + (tx.fees ?? 0);
      pos.qty += tx.shares;
    } else {
      const avgCost = pos.qty > 0 ? pos.totalCost / pos.qty : 0;
      pos.qty = Math.max(0, pos.qty - tx.shares);
      pos.totalCost = pos.qty * avgCost;
    }
    positions.set(tx.assetId, pos);
  }

  return Array.from(positions.entries())
    .filter(([, p]) => p.qty > 0.0001)
    .map(([assetId, p]) => {
      const asset = assetMap.get(assetId);
      return {
        assetId,
        ticker: asset?.ticker ?? assetId,
        name: asset?.name ?? assetId,
        type: asset?.type ?? ("stock" as Asset["type"]),
        qty: p.qty,
        avgCost: p.qty > 0 ? p.totalCost / p.qty : 0,
        totalCost: p.totalCost,
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function downloadXlsx(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

function exportDarfXlsx(darfRows: DarfRow[], year: number) {
  const data = [
    ["Mês", "Ganho Líquido (R$)", "Imposto Devido (R$)", "Status"],
    ...darfRows.map((r) => [r.label, r.gain, r.tax, statusConfig[r.status].label]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 22 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Apuração DARF");
  downloadXlsx(wb, `darf-apuracao-${year}.xlsx`);
}

function buildBensSheet(
  assets: Asset[],
  transactions: Transaction[],
  year: number,
  portfolioId?: string,
) {
  const prevYear = computePositionsAt(assets, transactions, year - 1, portfolioId);
  const currYear = computePositionsAt(assets, transactions, year, portfolioId);

  const prevMap = new Map(prevYear.map((p) => [p.assetId, p]));

  const allIds = new Set([
    ...prevYear.map((p) => p.assetId),
    ...currYear.map((p) => p.assetId),
  ]);

  const rows: (string | number)[][] = [
    [
      "Código do Bem",
      "Ticker",
      "Nome",
      "Tipo",
      `Custo em 31/12/${year - 1} (R$)`,
      `Custo em 31/12/${year} (R$)`,
      `Qtd em 31/12/${year}`,
    ],
  ];

  for (const id of allIds) {
    const prev = prevMap.get(id);
    const curr = currYear.find((p) => p.assetId === id);
    const ref = curr ?? prev!;
    rows.push([
      irpfCode(ref.type),
      ref.ticker,
      ref.name,
      ref.type,
      prev?.totalCost ?? 0,
      curr?.totalCost ?? 0,
      curr?.qty ?? 0,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 16 }, { wch: 24 }, { wch: 24 }, { wch: 16 },
  ];
  return ws;
}

function buildRendimentosSheet(
  dividends: Dividend[],
  assets: Asset[],
  year: number,
  type: "isento" | "tributavel",
) {
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const filtered = dividends
    .filter((d) => new Date(d.paymentDate).getFullYear() === year)
    .filter((d) =>
      type === "tributavel" ? d.type === "jcp" : d.type !== "jcp",
    );

  const rows: (string | number)[][] = [
    ["Data", "Ticker", "Nome", "Tipo", "Qtd Cotas", "Valor por Cota (R$)", "Valor Bruto (R$)"],
    ...filtered.map((d) => {
      const asset = assetMap.get(d.assetId);
      const gross = Number.isFinite(d.grossValue) && d.grossValue > 0 ? d.grossValue : d.totalValue;
      return [
        formatDate(d.paymentDate),
        asset?.ticker ?? d.assetId,
        asset?.name ?? d.assetId,
        d.type,
        d.shares,
        d.valuePerShare,
        gross,
      ];
    }),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 18 },
  ];
  return ws;
}

function buildApuracaoSheet(darfRows: DarfRow[]) {
  const rows: (string | number)[][] = [
    ["Mês", "Ganho Líquido (R$)", "Imposto Devido (R$)", "Status"],
    ...darfRows.map((r) => [r.label, r.gain, r.tax, statusConfig[r.status].label]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 22 }, { wch: 12 }];
  return ws;
}

function exportAuxiliarIrpf(
  assets: Asset[],
  transactions: Transaction[],
  dividends: Dividend[],
  darfRows: DarfRow[],
  year: number,
  portfolioId?: string,
) {
  const wb = XLSX.utils.book_new();

  const aviso = XLSX.utils.aoa_to_sheet([
    ["AVISO IMPORTANTE"],
    [],
    [
      "Este arquivo é um AUXILIAR gerado pelo Cofre Investimentos para uso como referência.",
    ],
    [
      "Os cálculos estão em desenvolvimento e podem conter divergências.",
    ],
    [
      "NÃO substitui declaração oficial, assessoria tributária ou ferramenta homologada pela Receita Federal.",
    ],
    ["Verifique todos os valores com sua corretora e/ou contador antes de declarar."],
    [],
    [`Ano-calendário: ${year}`],
    [`Gerado em: ${new Date().toLocaleString("pt-BR")}`],
  ]);
  aviso["!cols"] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, aviso, "Aviso");

  XLSX.utils.book_append_sheet(wb, buildApuracaoSheet(darfRows), "Apuração Mensal");
  XLSX.utils.book_append_sheet(
    wb,
    buildBensSheet(assets, transactions, year, portfolioId),
    "Bens e Direitos",
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildRendimentosSheet(dividends, assets, year, "isento"),
    "Rendimentos Isentos",
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildRendimentosSheet(dividends, assets, year, "tributavel"),
    "Rendimentos Tributáveis",
  );

  downloadXlsx(wb, `auxiliar-irpf-${year}.xlsx`);
}

// DARF instructions dialog per month
function DarfInstructionsDialog({
  row,
  month,
  onClose,
}: {
  row: DarfRow;
  month: MonthlyApuration | null;
  onClose: () => void;
}) {
  const [mm, yy] = row.key.split("-");

  const categories: Array<{ label: string; code: string; tax: number }> = [];
  if (month) {
    const eq = month.categories.B3_EQUITIES;
    const fi = month.categories.B3_FII;
    const cr = month.categories.CRYPTO;
    if (eq?.taxDue > 0)
      categories.push({ label: "Ações / ETFs (Renda Variável)", code: "6015", tax: eq.taxDue });
    if (fi?.taxDue > 0)
      categories.push({ label: "FIIs (Renda Variável)", code: "6015", tax: fi.taxDue });
    if (cr?.taxDue > 0)
      categories.push({ label: "Criptomoedas (Ganho de Capital)", code: "4600", tax: cr.taxDue });
  }

  if (categories.length === 0) {
    categories.push({ label: "Renda Variável", code: "6015", tax: row.tax });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-warning" />
            Dados para DARF — {row.label}
          </DialogTitle>
          <DialogDescription>
            Referência para preenchimento no Sicalc da Receita Federal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {categories.map((cat) => (
            <div key={cat.code + cat.label} className="rounded-lg border border-border p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">{cat.label}</p>
              <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
                <span className="text-muted-foreground">Código da receita</span>
                <span className="font-mono font-bold text-foreground">{cat.code}</span>
                <span className="text-muted-foreground">Período de apuração</span>
                <span className="font-mono text-foreground">{mm}/{yy}</span>
                <span className="text-muted-foreground">Valor principal</span>
                <span className="font-mono font-bold text-warning"><Blur>{formatCurrency(cat.tax)}</Blur></span>
                <span className="text-muted-foreground">Vencimento</span>
                <span className="text-foreground text-xs">último dia útil do mês seguinte</span>
              </div>
            </div>
          ))}

          <div className="rounded-lg border border-warning/20 bg-warning/5 p-3">
            <div className="flex items-start gap-2 text-xs text-warning">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Estes valores são <strong>auxiliares</strong> e estão em desenvolvimento — podem conter
                divergências. Confira com sua corretora (nota de corretagem) e seu contador antes de
                emitir o DARF.
              </span>
            </div>
          </div>

          <a
            href="https://sicalcweb.receita.fazenda.gov.br/SICALCWEB/pages/emissaoDarf/sicalcWebEmissaoDarf.jsf"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            Abrir Sicalc — Receita Federal
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Taxes() {
  const { toast } = useToast();
  const { isUnlocked, getPortfolios, getAssets, getTransactions, getDividends } = useSecureStorage();

  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [auditMonth, setAuditMonth] = useState<MonthlyApuration | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const [darfDialogRow, setDarfDialogRow] = useState<DarfRow | null>(null);

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>("all");

  const load = useCallback(async () => {
    if (!isUnlocked) {
      setPortfolios([]);
      setAssets([]);
      setTransactions([]);
      setDividends([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const [p, a, tx, dv] = await Promise.all([
        getPortfolios(),
        getAssets(),
        getTransactions(),
        getDividends(),
      ]);
      setPortfolios(p);
      setAssets(a);
      setTransactions(tx);
      setDividends(dv);
    } catch (err) {
      console.error("[Taxes] Failed to load vault data:", err);
      toast({
        title: "Não foi possível carregar os dados do cofre",
        description: "Confira se o cofre está desbloqueado e tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [getAssets, getDividends, getPortfolios, getTransactions, isUnlocked, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isUnlocked) return;
    const onVaultChange = () => load();
    window.addEventListener("vault-data-changed", onVaultChange);
    return () => window.removeEventListener("vault-data-changed", onVaultChange);
  }, [isUnlocked, load]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    years.add(currentYear);
    for (const t of transactions) years.add(new Date(t.date).getFullYear());
    for (const d of dividends) years.add(new Date(d.paymentDate).getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [currentYear, dividends, transactions]);

  useEffect(() => {
    if (availableYears.length === 0) return;
    if (!availableYears.includes(selectedYear)) setSelectedYear(availableYears[0]);
  }, [availableYears, selectedYear]);

  const filteredDividends = useMemo(() => {
    return dividends
      .filter((d) => (selectedPortfolioId === "all" ? true : d.portfolioId === selectedPortfolioId))
      .filter((d) => new Date(d.paymentDate).getFullYear() === selectedYear);
  }, [dividends, selectedPortfolioId, selectedYear]);

  const apuration = useMemo((): TaxEngineOutput | null => {
    if (!isUnlocked) return null;
    return computeMonthlyApuration({
      assets,
      transactions,
      year: selectedYear,
      portfolioId: selectedPortfolioId === "all" ? undefined : selectedPortfolioId,
      config: defaultTaxEngineConfig,
    });
  }, [assets, isUnlocked, selectedPortfolioId, selectedYear, transactions]);

  const summary = useMemo(() => {
    const months = apuration?.months ?? [];
    const totalGain = months.reduce((acc, m) => acc + sumMonthGain(m), 0);
    const taxDue = months.reduce((acc, m) => acc + (m.totalTaxDue ?? 0), 0);

    const exemptDividends = filteredDividends
      .filter((d) => d.type !== "jcp")
      .reduce((acc, d) => {
        const v = Number.isFinite(d.grossValue) ? d.grossValue : Number(d.totalValue ?? 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);

    const taxableDividends = filteredDividends
      .filter((d) => d.type === "jcp")
      .reduce((acc, d) => {
        const v = Number.isFinite(d.grossValue) ? d.grossValue : Number(d.totalValue ?? 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);

    return { totalGain, taxDue, exemptDividends, taxableDividends };
  }, [apuration, filteredDividends]);

  const darfRows: DarfRow[] = useMemo(() => {
    if (!apuration) return [];
    return apuration.months.map((m) => {
      const gain = sumMonthGain(m);
      const tax = m.totalTaxDue ?? 0;
      const status: DarfRow["status"] = tax <= 0 ? "exempt" : "pending";
      return { key: m.month, label: formatMonthLabel(m.month), gain, tax, status };
    });
  }, [apuration]);

  const openAuditForMonth = useCallback(
    (monthKey: string) => {
      const month = apuration?.months.find((m) => m.month === monthKey) ?? null;
      setAuditMonth(month);
      setAuditOpen(true);
    },
    [apuration],
  );

  const portfolioFilter = selectedPortfolioId === "all" ? undefined : selectedPortfolioId;

  const hasData = isUnlocked && !isLoading && darfRows.length > 0;

  return (
    <DashboardLayout>
      <TaxAuditDialog
        open={auditOpen}
        onOpenChange={(open) => {
          setAuditOpen(open);
          if (!open) setAuditMonth(null);
        }}
        month={auditMonth}
        title={auditMonth ? `Cálculo — ${formatMonthLabel(auditMonth.month)}` : "Cálculo"}
      />

      {darfDialogRow && (
        <DarfInstructionsDialog
          row={darfDialogRow}
          month={apuration?.months.find((m) => m.month === darfDialogRow.key) ?? null}
          onClose={() => setDarfDialogRow(null)}
        />
      )}

      <div className="space-y-6">
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div>
            <h1 className="text-2xl font-bold text-foreground">Imposto de Renda</h1>
            <p className="text-muted-foreground">Controle de DARF e preparação para DIRPF</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2"
              disabled={!hasData}
              onClick={() => exportDarfXlsx(darfRows, selectedYear)}
            >
              <Download className="h-4 w-4" />
              Exportar Excel
            </Button>
            <Button
              className="gap-2"
              disabled={!hasData}
              onClick={() =>
                exportAuxiliarIrpf(
                  assets,
                  transactions,
                  filteredDividends,
                  darfRows,
                  selectedYear,
                  portfolioFilter,
                )
              }
            >
              <FileText className="h-4 w-4" />
              Auxiliar IRPF
            </Button>
          </div>
        </motion.div>

        {/* Disclaimer */}
        <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 px-4 py-3 text-xs text-warning">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Os cálculos desta tela são <strong>auxiliares e estão em desenvolvimento</strong> — podem
            conter divergências. Não substituem declaração oficial, assessoria tributária ou
            ferramenta homologada pela Receita Federal.
          </span>
        </div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">Ano</label>
            <Select
              value={String(selectedYear)}
              onValueChange={(v) => setSelectedYear(Number(v))}
              disabled={!isUnlocked}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Ano" />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">Portfólio</label>
            <Select
              value={selectedPortfolioId}
              onValueChange={setSelectedPortfolioId}
              disabled={!isUnlocked}
            >
              <SelectTrigger className="min-w-[220px]">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {portfolios.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </motion.div>

        {/* Summary Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Calculator className="h-5 w-5 text-primary" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-1">Ganho de Capital ({selectedYear})</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {isLoading ? "—" : <Blur>{formatCurrency(summary.totalGain)}</Blur>}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-1">Imposto Devido (DARF)</p>
            <p className="text-2xl font-bold text-warning tabular-nums">
              {isLoading ? "—" : <Blur>{formatCurrency(summary.taxDue)}</Blur>}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                <CheckCircle className="h-5 w-5 text-success" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-1">Rendimentos Isentos</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {isLoading ? "—" : <Blur>{formatCurrency(summary.exemptDividends)}</Blur>}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-loss/10">
                <FileText className="h-5 w-5 text-loss" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-1">JCP (Tributável)</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {isLoading ? "—" : <Blur>{formatCurrency(summary.taxableDividends)}</Blur>}
            </p>
          </div>
        </motion.div>

        {/* DARF Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-border bg-card shadow-card"
        >
          <div className="border-b border-border p-6">
            <h3 className="text-lg font-semibold text-foreground">DARF Mensal</h3>
            <p className="text-sm text-muted-foreground">
              Apuração mensal local (B3 + cripto) com compensação e isenções
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Mês
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ganho Líquido
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Imposto (Total)
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {!isUnlocked && (
                  <tr className="border-b border-border/50">
                    <td className="px-6 py-6 text-sm text-muted-foreground" colSpan={5}>
                      Desbloqueie o cofre para ver a apuração.
                    </td>
                  </tr>
                )}

                {isUnlocked && !isLoading && darfRows.length === 0 && (
                  <tr className="border-b border-border/50">
                    <td className="px-6 py-6 text-sm text-muted-foreground" colSpan={5}>
                      Nenhuma movimentação encontrada em {selectedYear}.
                    </td>
                  </tr>
                )}

                {darfRows.map((darf, index) => {
                  const cfg = statusConfig[darf.status];
                  const Icon = cfg.icon;

                  return (
                    <motion.tr
                      key={darf.key}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + index * 0.05 }}
                      className="border-b border-border/50 transition-colors hover:bg-muted/20"
                    >
                      <td className="px-6 py-4 font-medium text-foreground">{darf.label}</td>
                      <td className="px-4 py-4 text-right font-medium text-foreground tabular-nums">
                        {darf.gain !== 0 ? <Blur>{formatCurrency(darf.gain)}</Blur> : "-"}
                      </td>
                      <td className="px-4 py-4 text-right font-medium text-foreground tabular-nums">
                        {darf.tax > 0 ? <Blur>{formatCurrency(darf.tax)}</Blur> : "-"}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                            cfg.bg,
                            cfg.color,
                          )}
                        >
                          <Icon className="h-3 w-3" />
                          {cfg.label}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            onClick={() => openAuditForMonth(darf.key)}
                            disabled={!apuration}
                          >
                            <Eye className="h-4 w-4" />
                            Ver cálculo
                          </Button>

                          {darf.status === "pending" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-warning border-warning/30 hover:bg-warning/10"
                              onClick={() => setDarfDialogRow(darf)}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Dados DARF
                            </Button>
                          )}
                          {darf.status === "exempt" && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* IRPF Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="grid gap-4 md:grid-cols-3"
        >
          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <h4 className="font-semibold text-foreground mb-2">Bens e Direitos</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Posições em 31/12/{selectedYear} com custo médio
            </p>
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={!isUnlocked || isLoading}
              onClick={() => {
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(
                  wb,
                  buildBensSheet(assets, transactions, selectedYear, portfolioFilter),
                  "Bens e Direitos",
                );
                downloadXlsx(wb, `bens-e-direitos-${selectedYear}.xlsx`);
              }}
            >
              <Download className="h-4 w-4" />
              Exportar XLSX
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <h4 className="font-semibold text-foreground mb-2">Rendimentos Isentos</h4>
            <p className="text-sm text-muted-foreground mb-4">Dividendos e LCI/LCA recebidos</p>
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={!isUnlocked || isLoading}
              onClick={() => {
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(
                  wb,
                  buildRendimentosSheet(filteredDividends, assets, selectedYear, "isento"),
                  "Rendimentos Isentos",
                );
                downloadXlsx(wb, `rendimentos-isentos-${selectedYear}.xlsx`);
              }}
            >
              <Download className="h-4 w-4" />
              Exportar XLSX
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <h4 className="font-semibold text-foreground mb-2">Rendimentos Tributáveis</h4>
            <p className="text-sm text-muted-foreground mb-4">JCP e aluguéis recebidos</p>
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={!isUnlocked || isLoading}
              onClick={() => {
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(
                  wb,
                  buildRendimentosSheet(filteredDividends, assets, selectedYear, "tributavel"),
                  "Rendimentos Tributáveis",
                );
                downloadXlsx(wb, `rendimentos-tributaveis-${selectedYear}.xlsx`);
              }}
            >
              <Download className="h-4 w-4" />
              Exportar XLSX
            </Button>
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
