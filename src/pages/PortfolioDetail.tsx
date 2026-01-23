import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePortfolios } from "@/hooks/usePortfolios";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import type { Dividend } from "@/types/financial";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

const formatPercent = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function PortfolioDetailPage() {
  const navigate = useNavigate();
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const { portfoliosWithAssets, isLoading } = usePortfolios();
  const { getDividends } = useSecureStorage();

  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [isDividendsLoading, setIsDividendsLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!portfolioId) return;
      setIsDividendsLoading(true);
      try {
        const all = await getDividends();
        if (!mounted) return;
        setDividends(all.filter((d) => d.portfolioId === portfolioId));
      } finally {
        if (mounted) setIsDividendsLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [getDividends, portfolioId]);

  const portfolio = useMemo(() => {
    if (!portfolioId) return null;
    return portfoliosWithAssets.find((p) => p.id === portfolioId) ?? null;
  }, [portfoliosWithAssets, portfolioId]);

  const dividendsByAsset = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of dividends) {
      map.set(d.assetId, (map.get(d.assetId) ?? 0) + (d.totalValue ?? 0));
    }
    return map;
  }, [dividends]);

  const summary = useMemo(() => {
    if (!portfolio) return null;

    const costBasis = portfolio.assets.reduce(
      (sum, a) => sum + a.shares * a.averagePrice,
      0
    );

    const totalDividends = dividends.reduce(
      (sum, d) => sum + (Number.isFinite(d.totalValue) ? d.totalValue : 0),
      0
    );

    const dayGain = portfolio.assets.reduce((sum, a) => {
      const pct = Number.isFinite(a.priceChangePercent) ? a.priceChangePercent : 0;
      if (!Number.isFinite(pct) || pct === 0) return sum;

      // aproximação usando variação % para inferir preço anterior
      const previousPrice = a.currentPrice / (1 + pct / 100);
      const delta = a.shares * (a.currentPrice - previousPrice);
      return Number.isFinite(delta) ? sum + delta : sum;
    }, 0);

    const dayGainPercent =
      portfolio.currentValue > 0 ? (dayGain / portfolio.currentValue) * 100 : 0;

    const totalGainWithDividends = portfolio.totalGain + totalDividends;
    const totalGainWithDividendsPercent =
      costBasis > 0 ? (totalGainWithDividends / costBasis) * 100 : 0;

    return {
      costBasis,
      totalValue: portfolio.currentValue,
      totalDividends,
      totalGain: portfolio.totalGain,
      totalGainPercent: portfolio.totalGainPercent,
      totalGainWithDividends,
      totalGainWithDividendsPercent,
      dayGain,
      dayGainPercent,
    };
  }, [dividends, portfolio]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-start justify-between gap-4"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(-1)}
                aria-label="Voltar"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-foreground truncate">
                  {portfolio ? portfolio.name : "Carteira"}
                </h1>
                <p className="text-muted-foreground">
                  Detalhamento de ativos, ganhos e alocação
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {(isLoading || isDividendsLoading) && (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && !portfolio && (
          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <p className="text-foreground font-medium">Carteira não encontrada.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Ela pode ter sido removida. Volte para a lista de carteiras.
            </p>
            <div className="mt-4">
              <Button onClick={() => navigate("/portfolio")}>Ir para Portfólio</Button>
            </div>
          </div>
        )}

        {!isLoading && portfolio && summary && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground">Valor atual</div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  {formatCurrency(summary.totalValue)}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground">Custo (PM)</div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  {formatCurrency(summary.costBasis)}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground">Proventos recebidos</div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  {formatCurrency(summary.totalDividends)}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground">Ganho total (c/ proventos)</div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  {formatCurrency(summary.totalGainWithDividends)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {formatPercent(summary.totalGainWithDividendsPercent)}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground">Ganho do dia</div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  {formatCurrency(summary.dayGain)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {formatPercent(summary.dayGainPercent)}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-0 shadow-card overflow-hidden">
              <div className="p-6 pb-4">
                <h2 className="text-lg font-semibold text-foreground">Ativos</h2>
                <p className="text-sm text-muted-foreground">
                  Ganho total e alocação atual dentro da carteira
                </p>
              </div>

              <div className="overflow-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Ativo</TableHead>
                      <TableHead className="text-right">Qtde</TableHead>
                      <TableHead className="text-right">PM</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Alocação</TableHead>
                      <TableHead className="text-right">Proventos</TableHead>
                      <TableHead className="text-right">Ganho total (c/ prov.)</TableHead>
                      <TableHead className="text-right">Ganho dia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&>tr:nth-child(odd)]:bg-muted/20 [&>tr:nth-child(even)]:bg-muted/35 dark:[&>tr:nth-child(odd)]:bg-muted/10 dark:[&>tr:nth-child(even)]:bg-muted/20">
                    {portfolio.assets
                      .slice()
                      .sort((a, b) => b.currentValue - a.currentValue)
                      .map((a) => {
                        const allocation =
                          portfolio.currentValue > 0
                            ? (a.currentValue / portfolio.currentValue) * 100
                            : 0;

                        const dividendsTotal = dividendsByAsset.get(a.id) ?? 0;
                        const assetCostBasis = a.shares * a.averagePrice;
                        const gainWithDividends = a.gain + dividendsTotal;
                        const gainWithDividendsPercent =
                          assetCostBasis > 0
                            ? (gainWithDividends / assetCostBasis) * 100
                            : 0;

                        const dayGain = (() => {
                          const pct = Number.isFinite(a.priceChangePercent)
                            ? a.priceChangePercent
                            : 0;
                          if (!Number.isFinite(pct) || pct === 0) return 0;
                          const previousPrice = a.currentPrice / (1 + pct / 100);
                          const delta = a.shares * (a.currentPrice - previousPrice);
                          return Number.isFinite(delta) ? delta : 0;
                        })();

                        const dayGainPct =
                          a.currentValue > 0 ? (dayGain / a.currentValue) * 100 : 0;

                        return (
                          <TableRow
                            key={a.id}
                            className="cursor-pointer"
                            onClick={() =>
                              navigate(`/transactions?asset=${encodeURIComponent(a.id)}`)
                            }
                          >
                            <TableCell className="min-w-[220px]">
                              <div className="font-medium text-foreground">
                                {(a.name || a.ticker).toUpperCase()}
                              </div>
                              <div className="text-xs text-muted-foreground font-mono">
                                {a.ticker}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {a.shares}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(a.averagePrice)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(a.currentPrice)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(a.currentValue)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {allocation.toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(dividendsTotal)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(gainWithDividends)}
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {formatPercent(gainWithDividendsPercent)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(dayGain)}
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {formatPercent(dayGainPct)}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
