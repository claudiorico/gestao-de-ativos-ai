import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { motion } from "framer-motion";
import { Coins, TrendingUp, Calendar } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { Button } from "@/components/ui/button";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { useAssets } from "@/hooks/useAssets";
import { usePortfolios } from "@/hooks/usePortfolios";
import { useToast } from "@/hooks/use-toast";
import type { Dividend } from "@/types/financial";
import { Blur } from "@/components/ui/blur";

const MONTHS_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const dividendTypeLabel: Record<Dividend["type"], string> = {
  dividend: "Dividendo",
  jcp: "JCP",
  yield: "Rendimento",
  stock_lending: "Aluguel de ativos",
  bonus: "Bônus",
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const formatDate = (dateMs: number) =>
  new Date(dateMs).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

type MonthlyRow = { month: string; dividendos: number; jcp: number };

export default function Dividends() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isUnlocked, getDividends } = useSecureStorage();
  const { assets } = useAssets();
  const { portfolios, portfoliosWithAssets } = usePortfolios();

  const [dividends, setDividends] = useState<Dividend[]>([]);

  const load = useCallback(async () => {
    if (!isUnlocked) {
      setDividends([]);
      return;
    }

    try {
      const dv = await getDividends();
      setDividends(dv);
    } catch (err) {
      console.error("[Dividends] Failed to load dividends:", err);
      toast({
        title: "Não foi possível carregar os proventos",
        description: "Confira se o cofre está desbloqueado e tente novamente.",
        variant: "destructive",
      });
    }
  }, [getDividends, isUnlocked, toast]);

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

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const portfolioById = useMemo(() => new Map(portfolios.map((p) => [p.id, p])), [portfolios]);

  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const monthlyData = useMemo<MonthlyRow[]>(() => {
    const base: MonthlyRow[] = MONTHS_PT.map((m) => ({ month: m, dividendos: 0, jcp: 0 }));

    for (const d of dividends) {
      const dt = new Date(d.paymentDate);
      if (dt.getFullYear() !== currentYear) continue;
      const monthIdx = dt.getMonth();
      const isJcp = d.type === "jcp";
      if (isJcp) base[monthIdx].jcp += d.totalValue;
      else base[monthIdx].dividendos += d.totalValue;
    }

    return base;
  }, [dividends, currentYear]);

  const totalAnnual = useMemo(
    () => monthlyData.reduce((acc, m) => acc + m.dividendos + m.jcp, 0),
    [monthlyData]
  );

  const avgMonthly = useMemo(() => totalAnnual / 12, [totalAnnual]);

  // Cost basis = currentValue - gain, per asset, across all portfolios.
  // Using portfoliosWithAssets because for B3-imported assets the raw
  // asset.shares / asset.averagePrice are 0 — the hook derives the real
  // values from transactions and stores them in currentValue and gain.
  const totalCostBasis = useMemo(
    () =>
      portfoliosWithAssets.reduce(
        (pSum, p) =>
          pSum +
          p.assets.reduce((aSum, a) => aSum + (a.currentValue - a.gain), 0),
        0
      ),
    [portfoliosWithAssets]
  );

  const yieldOnCost = useMemo(() => {
    if (totalCostBasis <= 0) return 0;
    return (totalAnnual / totalCostBasis) * 100;
  }, [totalAnnual, totalCostBasis]);

  const recentDividends = useMemo(() => {
    return [...dividends]
      .sort((a, b) => b.paymentDate - a.paymentDate)
      .slice(0, 10)
      .map((d) => {
        const asset = assetById.get(d.assetId);
        const portfolio = portfolioById.get(d.portfolioId);

        return {
          id: d.id,
          ticker: asset?.ticker ?? "—",
          portfolioName: portfolio?.name,
          type: dividendTypeLabel[d.type],
          value: d.valuePerShare,
          shares: d.shares,
          total: d.totalValue,
          date: d.paymentDate,
        };
      });
  }, [dividends, assetById, portfolioById]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-foreground">Proventos</h1>
          <p className="text-muted-foreground">Dividendos, JCP e rendimentos recebidos</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid gap-4 sm:grid-cols-3"
        >
          <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                <Coins className="h-5 w-5 text-success" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Total ({currentYear})</span>
            </div>
            <p className="break-words text-2xl font-bold text-foreground tabular-nums sm:text-3xl">
              <Blur>{formatCurrency(totalAnnual)}</Blur>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Dividendos + JCP + rendimentos</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Média mensal</span>
            </div>
            <p className="break-words text-2xl font-bold text-foreground tabular-nums sm:text-3xl">
              <Blur>{formatCurrency(avgMonthly)}</Blur>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">No ano corrente</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                <TrendingUp className="h-5 w-5 text-warning" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Yield on Cost</span>
            </div>
            <p className="break-words text-2xl font-bold text-foreground tabular-nums sm:text-3xl">
              {yieldOnCost.toFixed(2)}%
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Sobre o custo (preço médio)</p>
          </div>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-xl border border-border bg-card p-6 shadow-card"
          >
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-foreground">Proventos por Mês</h3>
              <p className="text-sm text-muted-foreground">Ano corrente (dividendos vs JCP)</p>
            </div>

            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    tickFormatter={(value) =>
                      new Intl.NumberFormat("pt-BR", {
                        notation: "compact",
                      }).format(value)
                    }
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "12px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    }}
                    formatter={(value: number, name: string) => [
                      formatCurrency(value),
                      name === "dividendos" ? "Dividendos/Rend." : "JCP",
                    ]}
                    cursor={{ fill: "hsl(var(--primary) / 0.08)" }}
                  />
                  <Bar
                    dataKey="dividendos"
                    fill="hsl(var(--success))"
                    radius={[4, 4, 0, 0]}
                    stackId="stack"
                  />
                  <Bar
                    dataKey="jcp"
                    fill="hsl(var(--chart-2))"
                    radius={[4, 4, 0, 0]}
                    stackId="stack"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 flex items-center justify-center gap-6">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-success" />
                <span className="text-sm text-muted-foreground">Dividendos/Rend.</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-chart-2" />
                <span className="text-sm text-muted-foreground">JCP</span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="rounded-xl border border-border bg-card p-6 shadow-card"
          >
            <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Últimos Recebidos</h3>
                <p className="text-sm text-muted-foreground">Proventos mais recentes</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => navigate("/transactions/new")}
              >
                Novo
              </Button>
            </div>

            {recentDividends.length === 0 ? (
              <div className="rounded-lg border border-border/50 p-4">
                <p className="text-sm text-muted-foreground">Nenhum provento registrado ainda.</p>
                <div className="mt-3">
                  <Button className="w-full sm:w-auto" onClick={() => navigate("/transactions/new")}>
                    Cadastrar o primeiro
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {recentDividends.map((dividend, index) => (
                  <motion.div
                    key={dividend.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + index * 0.05 }}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3 transition-colors hover:bg-muted/20"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 font-mono text-sm font-bold text-success shrink-0">
                        {dividend.ticker.slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-foreground font-mono truncate">
                            {dividend.ticker}
                          </span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {dividend.type}
                          </span>
                          {dividend.portfolioName ? (
                            <span className="text-xs text-muted-foreground truncate">
                              {dividend.portfolioName}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {dividend.shares} cotas × <Blur>{formatCurrency(dividend.value)}</Blur>
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-success tabular-nums">+<Blur>{formatCurrency(dividend.total)}</Blur></p>
                      <p className="text-xs text-muted-foreground">{formatDate(dividend.date)}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </DashboardLayout>
  );
}

