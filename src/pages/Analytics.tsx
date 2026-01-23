import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, TrendingUp, Coins, AlertTriangle } from "lucide-react";
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
import type { Asset, CashMovement, Dividend, Transaction } from "@/types/financial";
import { usePrices } from "@/hooks/usePrices";
import { invokeBackendFunction } from "@/lib/backend/functionsClient";

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
  // points expected sorted asc
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

function computeSharesAtDate(transactions: Transaction[], dateMs: number): Map<string, number> {
  const byAsset = new Map<string, number>();
  for (const t of transactions) {
    if (t.date > dateMs) continue;
    const cur = byAsset.get(t.assetId) ?? 0;
    const delta = t.type === "buy" ? t.shares : -t.shares;
    byAsset.set(t.assetId, cur + delta);
  }
  return byAsset;
}

function computeNetSharesNow(transactions: Transaction[]): Map<string, number> {
  const byAsset = new Map<string, number>();
  for (const t of transactions) {
    const cur = byAsset.get(t.assetId) ?? 0;
    const delta = t.type === "buy" ? t.shares : -t.shares;
    byAsset.set(t.assetId, cur + delta);
  }
  return byAsset;
}

function computeCashAtDate(
  transactions: Transaction[],
  dividends: Dividend[],
  cashMovements: CashMovement[],
  dateMs: number,
) {
  let cash = 0;
  for (const m of cashMovements) {
    if (m.date > dateMs) continue;
    cash += m.type === "deposit" ? sumSafe(m.value) : -sumSafe(m.value);
  }
  for (const t of transactions) {
    if (t.date > dateMs) continue;
    const fees = sumSafe(t.fees);
    if (t.type === "buy") cash -= sumSafe(t.totalValue) + fees;
    else cash += sumSafe(t.totalValue) - fees;
  }
  for (const d of dividends) {
    if (d.paymentDate > dateMs) continue;
    cash += sumSafe(d.totalValue);
  }
  return cash;
}

function computeNetDepositsAtDate(cashMovements: CashMovement[], dateMs: number) {
  let net = 0;
  for (const m of cashMovements) {
    if (m.date > dateMs) continue;
    net += m.type === "deposit" ? sumSafe(m.value) : -sumSafe(m.value);
  }
  return net;
}

function computeWithdrawalsTotal(cashMovements: CashMovement[]) {
  return cashMovements.filter((m) => m.type === "withdraw").reduce((acc, m) => acc + sumSafe(m.value), 0);
}

function computeDepositsTotal(cashMovements: CashMovement[]) {
  return cashMovements.filter((m) => m.type === "deposit").reduce((acc, m) => acc + sumSafe(m.value), 0);
}

export default function Analytics() {
  const { isUnlocked, getAssets, getTransactions, getDividends, getCashMovements } = useSecureStorage();
  const { quotes, fetchQuotes, isLoading: isPricesLoading, error: pricesError } = usePrices();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [historyByTicker, setHistoryByTicker] = useState<Record<string, HistoryPoint[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isUnlocked) {
      setAssets([]);
      setTransactions([]);
      setDividends([]);
      setCashMovements([]);
      setHistoryByTicker({});
      setLoadError(null);
      return;
    }

    let mounted = true;
    const load = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const [a, tx, dv, cm] = await Promise.all([
          getAssets(),
          getTransactions(),
          getDividends(),
          getCashMovements(),
        ]);
        if (!mounted) return;
        setAssets(a);
        setTransactions(tx);
        setDividends(dv);
        setCashMovements(cm);
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
  }, [getAssets, getCashMovements, getDividends, getTransactions, isUnlocked]);

  const transactionsByAssetId = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of transactions) {
      const list = map.get(t.assetId) ?? [];
      list.push(t);
      map.set(t.assetId, list);
    }
    return map;
  }, [transactions]);

  const derivedSharesNowByAssetId = useMemo(() => computeNetSharesNow(transactions), [transactions]);

  const tickers = useMemo(() => {
    // Importante: só pede cotações/histórico para ativos que têm posição (via shares manual ou via transações).
    return Array.from(
      new Set(
        assets
          .filter((a) => {
            const manual = Number(a.shares ?? 0) > 0;
            const derived = (derivedSharesNowByAssetId.get(a.id) ?? 0) > 0;
            return manual || derived;
          })
          .map((a) => String(a.ticker ?? "").trim().toUpperCase())
          .filter(Boolean),
      ),
    );
  }, [assets, derivedSharesNowByAssetId]);

  useEffect(() => {
    if (!isUnlocked) return;
    if (tickers.length === 0) return;

    // current quotes
    fetchQuotes(tickers).catch(() => {
      // hook already stores error
    });
  }, [fetchQuotes, isUnlocked, tickers]);

  useEffect(() => {
    if (!isUnlocked) return;
    if (tickers.length === 0) return;

    let mounted = true;
    const loadHistory = async () => {
      const { data, error } = await invokeBackendFunction<{ histories: TickerHistory[]; error?: string }>(
        "get-price-history",
        // Enviar no máximo 25 tickers por chamada evita estourar limite de compute.
        { body: { tickers: tickers.slice(0, 25), months: 6 } },
      );

      if (!mounted) return;

      if (error) {
        console.warn("[Analytics] get-price-history error", error);
        return;
      }
      if (data?.error) {
        console.warn("[Analytics] get-price-history responded error", data.error);
        return;
      }

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
    return () => {
      mounted = false;
    };
  }, [isUnlocked, tickers]);

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const months = useMemo(() => {
    const now = new Date();
    const out: { key: string; t: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ key: monthLabel(d.getTime()), t: endOfMonth(d) });
    }
    return out;
  }, []);

  const series = useMemo(() => {
    if (!isUnlocked) return [];

    return months.map(({ key, t }) => {
      const sharesAt = computeSharesAtDate(transactions, t);
      const cash = computeCashAtDate(transactions, dividends, cashMovements, t);
      const invested = computeNetDepositsAtDate(cashMovements, t);

      let holdings = 0;
      // Estratégia de shares:
      // - se houver transações, usamos o saldo derivado delas
      // - se não houver transações para o ativo, mas o ativo tem shares manual, assumimos que ele existia durante toda a janela
      for (const asset of assets) {
        const assetId = asset.id;
        const txsForAsset = transactionsByAssetId.get(assetId) ?? [];

        const derivedSharesAt = sharesAt.get(assetId) ?? 0;
        const hasManualHoldings = Number(asset.shares ?? 0) > 0 && Number(asset.averagePrice ?? 0) > 0;
        const shares = txsForAsset.length > 0 ? derivedSharesAt : hasManualHoldings ? Number(asset.shares) : 0;

        if (!Number.isFinite(shares) || shares <= 0) continue;

        const ticker = String(asset?.ticker ?? "").toUpperCase();
        if (!ticker) continue;

        const historyPoints = historyByTicker[ticker] ?? historyByTicker[`${ticker}.SA`];
        const histPrice = historyPoints ? lastPriceOnOrBefore(historyPoints, t) : null;
        const live = quotes[ticker]?.price ?? quotes[`${ticker}.SA`]?.price;
        const fallback = asset?.averagePrice;

        const price = histPrice ?? live ?? fallback ?? 0;
        holdings += shares * price;
      }

      const patrimony = holdings + cash;
      return {
        month: key,
        patrimony,
        cash,
        invested,
      };
    });
  }, [assetById, assets, cashMovements, dividends, historyByTicker, isUnlocked, months, quotes, transactions, transactionsByAssetId]);

  const summary = useMemo(() => {
    const deposits = computeDepositsTotal(cashMovements);
    const withdrawals = computeWithdrawalsTotal(cashMovements);
    const last = series[series.length - 1];
    const patrimony = last?.patrimony ?? 0;
    const cash = last?.cash ?? 0;

    // Resultado total (considera saques como realização)
    const totalResult = patrimony + withdrawals - deposits;
    const totalReturnPct = deposits > 0 ? (totalResult / deposits) * 100 : 0;

    // Resultado de caixa (quanto “sobrou/foi gerado” em caixa vs aportes)
    const cashResult = cash + withdrawals - deposits;
    const cashReturnPct = deposits > 0 ? (cashResult / deposits) * 100 : 0;

    return {
      deposits,
      withdrawals,
      patrimony,
      cash,
      totalResult,
      totalReturnPct,
      cashResult,
      cashReturnPct,
    };
  }, [cashMovements, series]);

  const hasData = isUnlocked && (assets.length > 0 || transactions.length > 0 || cashMovements.length > 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-muted-foreground">Performance do patrimônio e performance de caixa</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Observação: o histórico usa preços públicos quando disponíveis; caso falte histórico para algum ativo, usamos a
            cotação atual como aproximação.
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
                <div className="text-muted-foreground">
                  {loadError ?? pricesError}
                </div>
              </div>
            </div>
          </div>
        )}

        {isUnlocked && !hasData && !isLoading && (
          <div className="rounded-xl border border-border bg-card p-6 shadow-card text-muted-foreground">
            Nenhum dado suficiente para calcular performance (adicione aportes/saques e/ou transações).
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
                  <Wallet className="h-4 w-4" /> Patrimônio atual
                </div>
                <div className="text-2xl font-bold text-foreground tabular-nums">
                  {formatCurrency(summary.patrimony)}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Coins className="h-4 w-4" /> Caixa atual
                </div>
                <div className="text-2xl font-bold text-foreground tabular-nums">
                  {formatCurrency(summary.cash)}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4" /> Resultado total
                </div>
                <div className="text-2xl font-bold text-foreground tabular-nums">
                  {formatCurrency(summary.totalResult)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {summary.totalReturnPct >= 0 ? "+" : ""}
                  {summary.totalReturnPct.toFixed(2)}% sobre aportes
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4" /> Resultado de caixa
                </div>
                <div className="text-2xl font-bold text-foreground tabular-nums">
                  {formatCurrency(summary.cashResult)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {summary.cashReturnPct >= 0 ? "+" : ""}
                  {summary.cashReturnPct.toFixed(2)}% sobre aportes
                </div>
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
                  <h3 className="text-lg font-semibold text-foreground">Patrimônio x Aportes</h3>
                  <p className="text-sm text-muted-foreground">
                    Últimos 6 meses {isLoading || isPricesLoading ? "• carregando…" : ""}
                  </p>
                </div>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
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
                      <Line type="monotone" dataKey="patrimony" name="Patrimônio" stroke="hsl(var(--primary))" strokeWidth={3} dot={false} />
                      <Line
                        type="monotone"
                        dataKey="invested"
                        name="Aportes líquidos"
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={2}
                        strokeDasharray="6 6"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="rounded-xl border border-border bg-card p-6 shadow-card"
              >
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-foreground">Evolução do Caixa</h3>
                  <p className="text-sm text-muted-foreground">Últimos 6 meses</p>
                </div>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
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
                        formatter={(value: number) => [formatCurrency(value), "Caixa"]}
                        labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                      />
                      <Line type="monotone" dataKey="cash" name="Caixa" stroke="hsl(var(--chart-2))" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
