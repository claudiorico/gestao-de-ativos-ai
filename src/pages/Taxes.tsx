import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { motion } from "framer-motion";
import {
  FileText,
  Download,
  AlertTriangle,
  CheckCircle,
  Calculator,
  Eye,
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
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import type { Asset, Dividend, Portfolio, Transaction } from "@/types/financial";
import {
  computeMonthlyApuration,
  defaultTaxEngineConfig,
  type MonthlyApuration,
} from "@/lib/tax-engine";
import { TaxAuditDialog } from "@/components/taxes/TaxAuditDialog";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

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
  // ym: YYYY-MM
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

    const onVaultChange = () => {
      load();
    };

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
    // Mantém seleção válida caso o usuário não tenha dados no ano atual.
    if (availableYears.length === 0) return;
    if (!availableYears.includes(selectedYear)) setSelectedYear(availableYears[0]);
  }, [availableYears, selectedYear]);

  const filteredDividends = useMemo(() => {
    return dividends
      .filter((d) => (selectedPortfolioId === "all" ? true : d.portfolioId === selectedPortfolioId))
      .filter((d) => new Date(d.paymentDate).getFullYear() === selectedYear);
  }, [dividends, selectedPortfolioId, selectedYear]);

  const apuration = useMemo(() => {
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

      return {
        key: m.month,
        label: formatMonthLabel(m.month),
        gain,
        tax,
        status,
      };
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
            <Button variant="outline" className="gap-2" disabled>
              <Download className="h-4 w-4" />
              Exportar Excel
            </Button>
            <Button className="gap-2" disabled>
              <FileText className="h-4 w-4" />
              Gerar Relatório IRPF
            </Button>
          </div>
        </motion.div>

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
              {isLoading ? "—" : formatCurrency(summary.totalGain)}
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
              {isLoading ? "—" : formatCurrency(summary.taxDue)}
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
              {isLoading ? "—" : formatCurrency(summary.exemptDividends)}
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
              {isLoading ? "—" : formatCurrency(summary.taxableDividends)}
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
                        {darf.gain !== 0 ? formatCurrency(darf.gain) : "-"}
                      </td>
                      <td className="px-4 py-4 text-right font-medium text-foreground tabular-nums">
                        {darf.tax > 0 ? formatCurrency(darf.tax) : "-"}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                            cfg.bg,
                            cfg.color
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
                            <Button size="sm" variant="outline" disabled>
                              Gerar DARF
                            </Button>
                          )}
                          {darf.status === "paid" && (
                            <Button size="sm" variant="ghost" className="text-muted-foreground" disabled>
                              Ver comprovante
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
            <p className="text-sm text-muted-foreground mb-4">Declaração de posições em 31/12</p>
            <Button variant="outline" className="w-full gap-2" disabled>
              <Download className="h-4 w-4" />
              Exportar
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <h4 className="font-semibold text-foreground mb-2">Rendimentos Isentos</h4>
            <p className="text-sm text-muted-foreground mb-4">Dividendos e LCI/LCA recebidos</p>
            <Button variant="outline" className="w-full gap-2" disabled>
              <Download className="h-4 w-4" />
              Exportar
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <h4 className="font-semibold text-foreground mb-2">Rendimentos Tributáveis</h4>
            <p className="text-sm text-muted-foreground mb-4">JCP e aluguéis recebidos</p>
            <Button variant="outline" className="w-full gap-2" disabled>
              <Download className="h-4 w-4" />
              Exportar
            </Button>
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
