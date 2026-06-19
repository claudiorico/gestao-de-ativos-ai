import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, TrendingUp, Coins, AlertTriangle, Percent } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import type { Asset, Dividend, Transaction } from "@/types/financial";
import { usePrices } from "@/hooks/usePrices";
import { invokeBackendFunction } from "@/lib/backend/functionsClient";
import { Blur } from "@/components/ui/blur";
import { computeAssetPositions } from "@/lib/portfolio-summary";

type HistoryPoint = { t: number; price: number };
type TickerHistory = { ticker: string; points: HistoryPoint[] };

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function monthLabel(dateMs: number) {
  const d = new Date(dateMs);
  return new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(d);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
}

function lastPriceOnOrBefore(points: HistoryPoint[], t: number): number | null {
  if (!points?.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  let bestIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) {
      bestIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return bestIdx >= 0 ? points[bestIdx].price : null;
}

function sumSafe(n: number) {
  return Number.isFinite(n) ? n : 0;
}

// Returns shares held per assetId at a given point in time, derived from transactions
function computeSharesAtDate(transactions: Transaction[], dateMs: number): Map<string, number> {
  const byAsset = new Map<string, number>();
  for (const t of transactions) {
    if (t.date > dateMs) continue;
    const cur = byAsset.get(t.assetId) ?? 0;
    byAsset.set(t.assetId, cur + (t.type === "buy" ? t.shares : -t.shares));
  }
  return byAsset;
}

// Returns current shares held per assetId from all transactions
function computeNetSharesNow(transactions: Transaction[]): Map<string, number> {
  return computeSharesAtDate(transactions, Date.now());
}

function computeOpenCostBasisAtDate(transactions: Transaction[], dateMs: number): number {
  const costByAsset = new Map<string, { qty: number; cost: number }>();
  const sorted = [...transactions].filter((t) => t.date <= dateMs).sort((a, b) => a.date - b.date);
  for (const t of sorted) {
    const pos = costByAsset.get(t.assetId) ?? { qty: 0, cost: 0 };
    if (t.type === "buy") {
      pos.cost += sumSafe(t.totalValue) + sumSafe(t.fees);
      pos.qty += sumSafe(t.shares);
    } else {
      const avg = pos.qty > 0 ? pos.cost / pos.qty : 0;
      const soldQty = Math.min(sumSafe(t.shares), pos.qty);
      pos.qty = Math.max(0, pos.qty - soldQty);
      pos.cost = Math.max(0, pos.cost - avg * soldQty);
    }
    costByAsset.set(t.assetId, pos);
  }
  let total = 0;
  for (const { cost } of costByAsset.values()) total += cost;
  return total;
}

export default function Analytics() {
  const { isUnlocked, getAssets, getTransactions, getDividends } = useSecureStorage();
  const { quotes, fetchQuotes, isLoading: isPricesLoading, error: pricesError } = usePrices();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [historyByTicker, setHistoryByTicker] = useState<Record<string, HistoryPoint[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isUnlocked) {
      setAssets([]);
      setTransactions([]);
      setDividends([]);
      setHistoryByTicker({});
      setLoadError(null);
      return;
    }

    let mounted = true;
    const load = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const [a, tx, dv] = await Promise.all([
          getAssets(),
          getTransactions(),
          getDividends(),
        ]);
        if (!mounted) return;
        setAssets(a);
        setTransactions(tx);
        setDividends(dv);
      } catch (e) {
        console.error("[Analytics] load failed", e);
        if (!mounted) return;
        setLoadError("Não foi possível carregar os dados do cofre.");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    load();
    const onChanged = () => load();
    window.addEventListener("vault-data-changed", onChanged);
    return () => {
      mounted = false;
      window.removeEventListener("vault-data-changed", onChanged);
    };
  }, [getAssets, getDividends, getTransactions, isUnlocked]);

  const derivedSharesNowByAssetId = useMemo(() => computeNetSharesNow(transactions), [transactions]);

  const tickers = useMemo(() => {
    return Array.from(
      new Set(
        assets
          .filter((a) => {
            const derived = (derivedSharesNowByAssetId.get(a.id) ?? 0) > 0;
            const manual = Number(a.shares ?? 0) > 0;
            return manual || derived;
          })
          .map((a) => String(a.ticker ?? "").trim().toUpperCase())
          .filter(Boolean),
      ),
    );
  }, [assets, derivedSharesNowByAssetId]);

  useEffect(() => {
    if (!isUnlocked || tickers.length === 0) return;
    fetchQuotes(tickers).catch(() => {});
  }, [fetchQuotes, isUnlocked, tickers]);

  useEffect(() => {
    if (!isUnlocked || tickers.length === 0) return;
    let mounted = true;

    const loadHistory = async () => {
      const { data, error } = await invokeBackendFunction<{ histories: TickerHistory[]; error?: string }>(
        "get-price-history",
        { body: { tickers: tickers.slice(0, 25), months: 6 } },
      );
      if (!mounted) return;
      if (error || data?.error) return;

      const next: Record<string, HistoryPoint[]> = {};
      for (const h of data?.histories ?? []) {
        const key = String(h.ticker ?? "").toUpperCase();
        const pts = Array.isArray(h.points) ? h.points : [];
        next[key] = pts
          .filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.price))
          .sort((a, b) => a.t - b.t);
      }
      setHistoryByTicker(next);
    };

    loadHistory();
    return () => { mounted = false; };
  }, [isUnlocked, tickers]);

  const transactionsByAssetId = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of transactions) {
      const list = map.get(t.assetId) ?? [];
      list.push(t);
      map.set(t.assetId, list);
    }
    return map;
  }, [transactions]);

  const months = useMemo(() => {
    const now = new Date();
    const out: { key: string; t: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ key: monthLabel(d.getTime()), t: endOfMonth(d) });
    }
    return out;
  }, []);

  // Series: portfolio value vs cost basis over the last 6 months
  const series = useMemo(() => {
    if (!isUnlocked) return [];

    return months.map(({ key, t }) => {
      const sharesAt = computeSharesAtDate(transactions, t);
      const costBasis = computeOpenCostBasisAtDate(transactions, t);

      // Total dividends accumulated up to this point
      const totalDividends = dividends
        .filter((d) => d.paymentDate <= t)
        .reduce((acc, d) => acc + sumSafe(d.totalValue), 0);

      let holdings = 0;
      for (const asset of assets) {
        const txsForAsset = transactionsByAssetId.get(asset.id) ?? [];
        const derivedSharesAt = sharesAt.get(asset.id) ?? 0;
        const hasManual = Number(asset.shares ?? 0) > 0 && Number(asset.averagePrice ?? 0) > 0;
        const shares = txsForAsset.length > 0 ? derivedSharesAt : hasManual ? Number(asset.shares) : 0;

        if (!Number.isFinite(shares) || shares <= 0) continue;

        const ticker = String(asset.ticker ?? "").toUpperCase();
        if (!ticker) continue;

        const historyPoints = historyByTicker[ticker] ?? historyByTicker[`${ticker}.SA`];
        const histPrice = historyPoints ? lastPriceOnOrBefore(historyPoints, t) : null;
        const live = quotes[ticker]?.price ?? quotes[`${ticker}.SA`]?.price;
        const fallback = asset.averagePrice;

        const price = histPrice ?? live ?? fallback ?? 0;
        holdings += shares * price;
      }

      return {
        month: key,
        patrimony: holdings,
        costBasis,
        totalDividends,
      };
    });
  }, [assets, dividends, historyByTicker, isUnlocked, months, quotes, transactions, transactionsByAssetId]);

  // Summary cards: use current quotes for live portfolio value
  const summary = useMemo(() => {
    let currentValue = 0;
    for (const asset of assets) {
      const txsForAsset = transactionsByAssetId.get(asset.id) ?? [];
      const derivedShares = derivedSharesNowByAssetId.get(asset.id) ?? 0;
      const hasManual = Number(asset.shares ?? 0) > 0;
      const shares = txsForAsset.length > 0 ? derivedShares : hasManual ? Number(asset.shares) : 0;
      if (!Number.isFinite(shares) || shares <= 0) continue;

      const ticker = String(asset.ticker ?? "").toUpperCase();
      const price =
        quotes[ticker]?.price ??
        quotes[`${ticker}.SA`]?.price ??
        asset.averagePrice ??
        0;
      currentValue += shares * sumSafe(price);
    }

    const positionsByAsset = computeAssetPositions(transactions);
    let costBasis = 0;
    for (const { openCostBasis } of positionsByAsset.values()) costBasis += sumSafe(openCostBasis);

    const totalDividends = dividends.reduce((acc, d) => acc + sumSafe(d.totalValue), 0);

    const result = currentValue - costBasis;
    const returnPct = costBasis > 0 ? (result / costBasis) * 100 : 0;

    return { currentValue, costBasis, result, returnPct, totalDividends };
  }, [assets, derivedSharesNowByAssetId, dividends, quotes, transactions, transactionsByAssetId]);

  const hasData = isUnlocked && (assets.length > 0 || transactions.length > 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-muted-foreground">Performance e evolução do portfólio</p>
          <p className="mt-1 text-xs text-muted-foreground">
            O histórico usa preços públicos quando disponíveis; caso falte para algum ativo, o preço
            médio é usado como aproximação.
          </p>
        </motion.div>

        {!isUnlocked && (
          <div className="rounded-xl border border-border bg-card p-6 shadow-card text-muted-foreground">
            Desbloqueie o cofre para ver as análises.
          </div>
        )}

        {isUnlocked && (loadError || pricesError) && (
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <div className="text-sm">
                <div className="font-medium text-foreground">Alguns dados não puderam ser carregados</div>
                <div className="text-muted-foreground">{loadError ?? pricesError}</div>
              </div>
            </div>
          </div>
        )}

        {isUnlocked && !hasData && !isLoading && (
          <div className="rounded-xl border border-border bg-card p-6 shadow-card text-muted-foreground">
            Nenhum dado suficiente para calcular performance. Adicione transações ao seu portfólio.
          </div>
        )}

        {isUnlocked && hasData && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="h-4 w-4" /> Valor atual do portfólio
                </div>
                <div className="text-2xl font-bold text-foreground tabular-nums">
                  {isLoading ? "…" : <Blur>{formatCurrency(summary.currentValue)}</Blur>}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Coins className="h-4 w-4" /> Custo total investido
                </div>
                <div className="text-2xl font-bold text-foreground tabular-nums">
                  {isLoading ? "…" : <Blur>{formatCurrency(summary.costBasis)}</Blur>}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4" /> Resultado (ganho/perda)
                </div>
                <div
                  className={
                    "text-2xl font-bold tabular-nums " +
                    (summary.result >= 0 ? "text-success" : "text-destructive")
                  }
                >
                  {isLoading ? "…" : <Blur>{formatCurrency(summary.result)}</Blur>}
                </div>
                {!isLoading && summary.costBasis > 0 && (
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {summary.returnPct >= 0 ? "+" : ""}
                    {summary.returnPct.toFixed(2)}% sobre o custo
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Percent className="h-4 w-4" /> Proventos recebidos
                </div>
                <div className="text-2xl font-bold text-foreground tabular-nums">
                  {isLoading ? "…" : <Blur>{formatCurrency(summary.totalDividends)}</Blur>}
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="rounded-xl border border-border bg-card p-6 shadow-card"
            >
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-foreground">Valor do Portfólio vs Custo</h3>
                <p className="text-sm text-muted-foreground">
                  Últimos 6 meses {isLoading || isPricesLoading ? "• atualizando…" : ""}
                </p>
              </div>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
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
                      tickFormatter={formatCompact}
                      width={70}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "12px",
                      }}
                      formatter={(value: number, name: string) => [formatCurrency(value), name]}
                      labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="patrimony"
                      name="Valor do portfólio"
                      stroke="hsl(var(--primary))"
                      strokeWidth={3}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="costBasis"
                      name="Custo investido"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2}
                      strokeDasharray="6 6"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
