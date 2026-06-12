import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, ArrowRightLeft, Pencil } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { MoveAssetDialog, type MoveAssetTarget } from "@/components/portfolio/MoveAssetDialog";
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
import type { Asset, Dividend } from "@/types/financial";
import type { AssetWithPrice } from "@/hooks/usePortfolios";
import { Blur } from "@/components/ui/blur";

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
  const [searchParams] = useSearchParams();
  const highlightAssetId = searchParams.get("asset");
  const { portfoliosWithAssets, isLoading } = usePortfolios();
  const { getDividends, saveAsset } = useSecureStorage();

  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [isDividendsLoading, setIsDividendsLoading] = useState(false);
  const [assetToMove, setAssetToMove] = useState<MoveAssetTarget | null>(null);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [editingTargetValue, setEditingTargetValue] = useState("");

  // Overrides otimistas: aplicados imediatamente ao salvar, sem chamar refresh().
  // Evitam o isLoading=true que desmontava a tabela e causava scroll para o topo.
  // O vault persiste o valor em background; ao sair e voltar, os dados carregados já estarão corretos.
  const [localTargets, setLocalTargets] = useState<Record<string, number>>({});

  const saveTargetAllocation = useCallback(
    async (a: AssetWithPrice, rawValue: string) => {
      const parsed = parseFloat(rawValue.replace(",", "."));
      const newTarget = Number.isFinite(parsed) && parsed >= 0 ? parsed : (a.targetAllocation ?? 0);

      // Atualiza estado local instantaneamente (sem re-render da tabela inteira)
      setLocalTargets((prev) => ({ ...prev, [a.id]: newTarget }));
      setEditingTargetId(null);

      // Persiste no vault em background
      const assetToSave: Asset = {
        id: a.id,
        portfolioId: a.portfolioId,
        ticker: a.ticker,
        name: a.name,
        type: a.type,
        targetAllocation: newTarget,
        shares: a.shares,
        averagePrice: a.averagePrice,
        createdAt: a.createdAt,
        updatedAt: Date.now(),
      };
      await saveAsset(assetToSave);
    },
    [saveAsset]
  );

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

  // Total de % alvo configurado — atualiza ao vivo enquanto o usuário digita
  const totalTargetAllocation = useMemo(() => {
    if (!portfolio) return 0;
    return portfolio.assets.reduce((sum, a) => {
      if (editingTargetId === a.id) {
        return sum + (parseFloat(editingTargetValue) || 0);
      }
      return sum + (localTargets[a.id] ?? a.targetAllocation ?? 0);
    }, 0);
  }, [portfolio, localTargets, editingTargetId, editingTargetValue]);

  // Quando vem da busca (?asset=...), rola até a linha do ativo e a destaca brevemente.
  useEffect(() => {
    if (!highlightAssetId || !portfolio) return;
    const el = document.getElementById(`asset-row-${highlightAssetId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary");
    const t = setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2500);
    return () => clearTimeout(t);
  }, [highlightAssetId, portfolio]);

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
                  <Blur>{formatCurrency(summary.totalValue)}</Blur>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground">Custo (PM)</div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  <Blur>{formatCurrency(summary.costBasis)}</Blur>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground">Proventos recebidos</div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  <Blur>{formatCurrency(summary.totalDividends)}</Blur>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground">Ganho total (c/ proventos)</div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  <Blur>{formatCurrency(summary.totalGainWithDividends)}</Blur>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  <Blur>{formatPercent(summary.totalGainWithDividendsPercent)}</Blur>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground">Ganho do dia</div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  <Blur>{formatCurrency(summary.dayGain)}</Blur>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  <Blur>{formatPercent(summary.dayGainPercent)}</Blur>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-0 shadow-card overflow-hidden">
              <div className="flex items-center justify-between gap-4 p-6 pb-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Ativos</h2>
                  <p className="text-sm text-muted-foreground">
                    Ganho total e alocação atual dentro da carteira
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-lg font-bold tabular-nums ${
                    totalTargetAllocation > 100.5
                      ? "text-destructive"
                      : totalTargetAllocation >= 99.5
                        ? "text-green-600 dark:text-green-400"
                        : "text-amber-500"
                  }`}>
                    {totalTargetAllocation.toFixed(0)}%
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {totalTargetAllocation >= 99.5 && totalTargetAllocation <= 100.5
                      ? "alvo configurado ✓"
                      : totalTargetAllocation > 100.5
                        ? `excede em ${(totalTargetAllocation - 100).toFixed(0)}%`
                        : `faltam ${(100 - totalTargetAllocation).toFixed(0)}%`}
                  </div>
                </div>
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
                      <TableHead className="text-right">% Alvo</TableHead>
                      <TableHead className="text-right">Proventos</TableHead>
                      <TableHead className="text-right">Ganho total (c/ prov.)</TableHead>
                      <TableHead className="text-right">Ganho dia</TableHead>
                      <TableHead className="w-10" aria-label="Ações" />
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
                            id={`asset-row-${a.id}`}
                            className="cursor-pointer transition-shadow"
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
                              <Blur>{formatCurrency(a.averagePrice)}</Blur>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Blur>{formatCurrency(a.currentPrice)}</Blur>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Blur>{formatCurrency(a.currentValue)}</Blur>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {allocation.toFixed(1)}%
                            </TableCell>
                            <TableCell
                              className="text-right tabular-nums"
                              onClick={(e) => {
                                e.stopPropagation();
                                const current = localTargets[a.id] ?? a.targetAllocation ?? 0;
                                setEditingTargetId(a.id);
                                setEditingTargetValue(String(current));
                              }}
                            >
                              {editingTargetId === a.id ? (
                                <input
                                  autoFocus
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="1"
                                  className="w-16 text-right bg-transparent border-b border-primary outline-none text-sm tabular-nums"
                                  value={editingTargetValue}
                                  onChange={(e) => setEditingTargetValue(e.target.value)}
                                  onBlur={() => saveTargetAllocation(a, editingTargetValue)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === "Tab") {
                                      e.preventDefault();
                                      saveTargetAllocation(a, editingTargetValue);
                                    }
                                    if (e.key === "Escape") setEditingTargetId(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <span
                                  className={`group inline-flex items-center gap-1 cursor-pointer hover:text-primary ${
                                    (localTargets[a.id] ?? a.targetAllocation ?? 0) > 0
                                      ? "text-foreground"
                                      : "text-muted-foreground"
                                  }`}
                                  title="Clique para editar"
                                >
                                  {(localTargets[a.id] ?? a.targetAllocation ?? 0) > 0
                                    ? `${localTargets[a.id] ?? a.targetAllocation}%`
                                    : "—"}
                                  <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Blur>{formatCurrency(dividendsTotal)}</Blur>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Blur>{formatCurrency(gainWithDividends)}</Blur>
                              <div className="text-xs text-muted-foreground tabular-nums">
                                <Blur>{formatPercent(gainWithDividendsPercent)}</Blur>
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Blur>{formatCurrency(dayGain)}</Blur>
                              <div className="text-xs text-muted-foreground tabular-nums">
                                <Blur>{formatPercent(dayGainPct)}</Blur>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Mover para outra carteira"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAssetToMove({
                                    id: a.id,
                                    name: a.name,
                                    ticker: a.ticker,
                                    portfolioId: portfolio.id,
                                  });
                                }}
                              >
                                <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                              </Button>
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

      <MoveAssetDialog
        open={!!assetToMove}
        onOpenChange={(o) => !o && setAssetToMove(null)}
        asset={assetToMove}
        portfolios={portfoliosWithAssets.map((p) => ({ id: p.id, name: p.name }))}
        onMoved={refresh}
      />
    </DashboardLayout>
  );
}
