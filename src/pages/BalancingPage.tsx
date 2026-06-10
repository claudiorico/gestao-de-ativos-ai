import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Loader2,
  AlertCircle,
  Calculator,
  ChevronsUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { usePortfolios } from "@/hooks/usePortfolios";
import { rebalanceAssets, type RebalanceMode } from "@/lib/rebalancing-engine";
import { toast } from "@/hooks/use-toast";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

type SuggestionAction = "BUY" | "SELL" | "HOLD";

interface RebalancedAssetRow {
  id: string;
  portfolioId: string;
  ticker: string;
  name: string;
  portfolioName: string;
  price: number;
  target: number; // % (0..100)
  current: number; // % (0..100)
  shares: number; // integer
  diff: number; // target-current (p.p.)
  suggestedAction: SuggestionAction;
  suggestedQuantity: number;
  suggestedValue: number;
}

type FlatAsset = {
  id: string;
  portfolioId: string;
  ticker: string;
  name: string;
  portfolioName: string;
  type:
    | "stock"
    | "reit"
    | "etf"
    | "fixed_income"
    | "crypto"
    | "international"
    | "investment_fund";

  price: number;
  target: number; // % (0..100) global
  current: number; // % (0..100) global
  shares: number; // integer

  // Diagnóstico / regras por carteira
  portfolioTarget: number; // % (0..100) target da carteira (normalizado nas selecionadas)
  portfolioCurrent: number; // % (0..100) atual da carteira (no agregado selecionado)
};

type PersistedBalancingState = {
  portfolioIds: string[]; // vazio = todas
  investmentAmount: string;
  assetsSignature: string;
  mode: RebalanceMode;
  suggestions: Array<{ assetId: string; action: SuggestionAction; quantity: number }>;
  remainingCash: number;
  updatedAt: number;
};

const STORAGE_KEY = "balancing:last_state:v2";

export default function Balancing() {
  const navigate = useNavigate();

  const [investmentAmount, setInvestmentAmount] = useState("5000");
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<string[]>([]); // vazio = todas
  const [lastCalculated, setLastCalculated] = useState<Date | null>(null);
  const [rebalancedAssets, setRebalancedAssets] = useState<RebalancedAssetRow[]>([]);
  const [remainingCash, setRemainingCash] = useState<number>(0);

  const { portfoliosWithAssets, isLoading, error, refresh } = usePortfolios();

  const selectedPortfolios = useMemo(() => {
    if (selectedPortfolioIds.length === 0) return portfoliosWithAssets;
    const set = new Set(selectedPortfolioIds);
    return portfoliosWithAssets.filter((p) => set.has(p.id));
  }, [portfoliosWithAssets, selectedPortfolioIds]);

  // Só entram no balanceamento carteiras com % alvo (>0). Carteiras com alvo 0%
  // não devem “puxar” o total e distorcer o cálculo (ex.: forçar compras em classes já cheias).
  const portfoliosForBalancing = useMemo(() => {
    return selectedPortfolios.filter(
      (p) => Number.isFinite(p.targetAllocation) && (p.targetAllocation ?? 0) > 0
    );
  }, [selectedPortfolios]);

  const portfolioValue = useMemo(() => {
    return portfoliosForBalancing.reduce((total, portfolio) => total + (portfolio.currentValue || 0), 0);
  }, [portfoliosForBalancing]);

  const allAssets: FlatAsset[] = useMemo(() => {
    const assets: FlatAsset[] = [];

    // Estratégia (multi-carteiras):
    // 1) Normaliza o peso das carteiras selecionadas para somar 100%
    // 2) Dentro de cada carteira, normaliza os alvos dos ativos para somarem 100%
    // Assim o somatório global de % alvo por ativo tende a 100% e o motor consegue alocar o aporte.
    //
    // Importante: usamos SOMENTE carteiras com alvo > 0 para evitar distorção de cálculo.

    const selectedPortfoliosTargetSum = portfoliosForBalancing.reduce(
      (acc, p) => acc + (Number.isFinite(p.targetAllocation) ? p.targetAllocation : 0),
      0
    );

    portfoliosForBalancing.forEach((portfolio) => {
      const portfolioTargetRaw = Number.isFinite(portfolio.targetAllocation)
        ? portfolio.targetAllocation
        : 0;

      const portfolioTargetNormalized =
        selectedPortfoliosTargetSum > 0
          ? (portfolioTargetRaw / selectedPortfoliosTargetSum) * 100
          : 0;

      const portfolioAssets = portfolio.assets ?? [];
      const assetsTargetSum = portfolioAssets.reduce(
        (acc, a) => acc + (Number.isFinite(a.targetAllocation) ? a.targetAllocation : 0),
        0
      );

      portfolioAssets.forEach((asset) => {
        // currentValue já vem calculado com preço atual no hook (usePortfolios)
        const currentValue = Number.isFinite(asset.currentValue)
          ? asset.currentValue
          : asset.shares * (asset.currentPrice || asset.averagePrice);

        const currentAllocation = portfolioValue > 0 ? (currentValue / portfolioValue) * 100 : 0;

        const assetTargetRaw = Number.isFinite(asset.targetAllocation) ? asset.targetAllocation : 0;

        // IMPORTANTE: só aloca aporte em ativos com % alvo explícito (>0).
        // Se a carteira não tem alvos por ativo, o usuário deve configurar antes de balancear.
        const assetTargetNormalized = assetsTargetSum > 0 ? (assetTargetRaw / assetsTargetSum) * 100 : 0;

        const globalTargetAllocation = (portfolioTargetNormalized * assetTargetNormalized) / 100;

        assets.push({
          id: asset.id,
          portfolioId: portfolio.id,
          ticker: asset.ticker,
          name: asset.name,
          portfolioName: portfolio.name,
          type: asset.type,
          price: asset.currentPrice || asset.averagePrice,
          target: globalTargetAllocation,
          current: currentAllocation,
          shares:
            asset.type === "fixed_income" || asset.type === "crypto"
              ? Math.max(0, Number(asset.shares || 0))
              : Math.max(0, Math.floor(asset.shares || 0)),
          portfolioTarget: portfolioTargetNormalized,
          portfolioCurrent: portfolioValue > 0 ? (portfolio.currentValue / portfolioValue) * 100 : 0,
        });
      });
    });

    return assets;
  }, [portfoliosForBalancing, portfolioValue]);

  const assetsSignature = useMemo(() => {
    return allAssets
      .map((a) => `${a.id}:${a.shares}:${a.price}:${a.target.toFixed(4)}`)
      .sort()
      .join("|");
  }, [allAssets]);

  const totalSuggested = useMemo(
    () =>
      rebalancedAssets
        .filter((a) => a.suggestedAction === "BUY")
        .reduce((acc, a) => acc + a.suggestedValue, 0),
    [rebalancedAssets]
  );

  const getMode = (): RebalanceMode => {
    const amount = parseFloat(investmentAmount) || 0;
    return amount > 0 ? "WITH_CONTRIBUTION" : "REBALANCE_ONLY";
  };

  const runRebalancing = () => {
    try {
      const amount = parseFloat(investmentAmount) || 0;
      const mode = getMode();

      // Regra: com aporte, só compra em carteiras que estão abaixo do alvo (análise por carteira primeiro).
      const PORTFOLIO_EPS = 0.25; // p.p.
      const portfolioUnderTarget = new Set(
        portfoliosForBalancing
          .map((p) => {
            const any = allAssets.find((a) => a.portfolioId === p.id);
            if (!any) return null;
            const isUnder = any.portfolioCurrent + PORTFOLIO_EPS < any.portfolioTarget;
            return isUnder ? p.id : null;
          })
          .filter(Boolean) as string[]
      );

      const engineAssets = allAssets.map((a) => {
        const upper = (a.ticker || "").toUpperCase();
        const cryptoStep = upper === "BTC" || upper === "ETH" ? 0.00000001 : 0.0001;

        const allowBuyInPortfolio = mode !== "WITH_CONTRIBUTION" || portfolioUnderTarget.has(a.portfolioId);
        const effectiveTargetPercent = allowBuyInPortfolio ? Math.max(0, a.target / 100) : 0;

        return {
          id: a.id,
          targetPercent: effectiveTargetPercent,
          currentQuantity: a.shares,
          currentPrice: a.price,
          lotSize: a.type === "fixed_income" ? 0.01 : a.type === "crypto" ? cryptoStep : 1,
        };
      });

      const totalTarget = engineAssets.reduce(
        (acc, a) => acc + (Number.isFinite(a.targetPercent) ? a.targetPercent : 0),
        0
      );
      if (totalTarget <= 0) {
        toast({
          title: "Defina suas alocações alvo",
          description:
            mode === "WITH_CONTRIBUTION"
              ? "No modo com aporte, só compramos em carteiras abaixo do alvo. No cenário atual nenhuma carteira está abaixo do alvo (ou os ativos não têm % alvo)."
              : "Nenhum ativo está com % alvo configurado (ou as carteiras estão com alvo 0%). Ajuste os alvos e tente novamente.",
          variant: "destructive",
        });
        return;
      }

      const invalidPrices = allAssets.filter((a) => !Number.isFinite(a.price) || a.price <= 0);
      if (invalidPrices.length > 0) {
        const tickers = invalidPrices
          .map((a) => a.ticker)
          .filter(Boolean)
          .slice(0, 8)
          .join(", ");

        console.warn("[Balancing] invalid prices", invalidPrices);
        toast({
          title: "Sem preços para calcular",
          description:
            `Alguns ativos estão sem preço (0). Ex.: ${tickers}. Atualize as cotações ou preencha o preço médio do ativo para que ele entre no balanceamento.`,
          variant: "destructive",
        });
        return;
      }

      const missingPricedTargets = allAssets.filter(
        (a) => a.target > 0 && (!Number.isFinite(a.price) || a.price <= 0)
      );
      if (missingPricedTargets.length > 0) {
        const tickers = missingPricedTargets
          .map((a) => a.ticker)
          .filter(Boolean)
          .slice(0, 8)
          .join(", ");

        toast({
          title: "Ativos com alvo sem preço",
          description:
            `Há ativos com % alvo configurado mas sem preço. Ex.: ${tickers}. Preencha o preço médio (ou faça uma atualização de cotação) para calcular uma distribuição correta.`,
          variant: "destructive",
        });
        return;
      }

      const result = rebalanceAssets({
        assets: engineAssets,
        availableCash: amount,
        mode,
      });

      const summary = result.suggestions.reduce(
        (acc, s) => {
          acc[s.action] += s.quantity;
          return acc;
        },
        { BUY: 0, SELL: 0, HOLD: 0 } as Record<SuggestionAction, number>
      );

      toast({
        title: "Balanceamento calculado",
        description: `BUY: ${summary.BUY} | SELL: ${summary.SELL} | Caixa: ${formatCurrency(
          result.remainingCash
        )}`,
      });

      const byId = new Map(result.suggestions.map((s) => [s.assetId, s] as const));

      const rows: RebalancedAssetRow[] = allAssets.map((asset) => {
        const s = byId.get(asset.id);
        const action: SuggestionAction = s?.action ?? "HOLD";
        const qty = s?.quantity ?? 0;

        return {
          id: asset.id,
          portfolioId: asset.portfolioId,
          ticker: asset.ticker,
          name: asset.name,
          portfolioName: asset.portfolioName,
          price: asset.price,
          target: asset.target,
          current: asset.current,
          shares: asset.shares,
          diff: asset.target - asset.current,
          suggestedAction: action,
          suggestedQuantity: qty,
          suggestedValue: qty * asset.price,
        };
      });

      setRebalancedAssets(rows);
      setRemainingCash(result.remainingCash);
      setLastCalculated(new Date());

      const persisted: PersistedBalancingState = {
        portfolioIds: [...selectedPortfolioIds].sort(),
        investmentAmount,
        assetsSignature,
        mode,
        suggestions: result.suggestions.map((s) => ({
          assetId: s.assetId,
          action: s.action,
          quantity: s.quantity,
        })),
        remainingCash: result.remainingCash,
        updatedAt: Date.now(),
      };

      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      } catch {
        // ignore
      }

      const hasAnyAction = result.suggestions.some((s) => s.action !== "HOLD" && s.quantity > 0);
      if (!hasAnyAction) {
        toast({
          title: "Sem sugestões de compra/venda",
          description:
            mode === "WITH_CONTRIBUTION"
              ? "Com os % alvo atuais, o motor não encontrou compras possíveis (verifique se existe alguma carteira abaixo do alvo e se algum ativo está abaixo do alvo)."
              : "Sem aporte, só é possível balancear vendendo sobrealocados e comprando subalocados. Verifique se existe algum ativo acima do alvo.",
        });
      }
    } catch (e) {
      console.error("[Balancing] runRebalancing failed", e);
      toast({
        title: "Erro ao calcular balanceamento",
        description: "Verifique os dados dos ativos (preço, % alvo e quantidade) e tente novamente.",
        variant: "destructive",
      });
    }
  };

  const didInitFromStorageRef = useRef(false);
  const savedStateRef = useRef<PersistedBalancingState | null>(null);

  // 1) Ao montar: restaura inputs (carteiras/valor) do último cálculo, para manter o estado ao navegar e voltar.
  useEffect(() => {
    if (didInitFromStorageRef.current) return;
    didInitFromStorageRef.current = true;

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as PersistedBalancingState;
      savedStateRef.current = saved;

      // Restaura inputs primeiro (isso influencia allAssets/assetsSignature)
      if (Array.isArray(saved.portfolioIds)) {
        setSelectedPortfolioIds(saved.portfolioIds);
      }
      if (typeof saved.investmentAmount === "string") {
        setInvestmentAmount(saved.investmentAmount);
      }
    } catch {
      // ignore
    }
  }, []);

  // 2) Quando os ativos estiverem prontos (assetsSignature), restaura o resultado do cálculo se for compatível.
  useEffect(() => {
    try {
      const saved = savedStateRef.current;
      if (!saved) return;

      // Só reaplica se o "estado dos ativos" não mudou (evita reaplicar sugestões antigas)
      if (saved.assetsSignature !== assetsSignature) return;

      const byId = new Map(saved.suggestions.map((s) => [s.assetId, s] as const));
      const rows: RebalancedAssetRow[] = allAssets.map((asset) => {
        const s = byId.get(asset.id);
        const action: SuggestionAction = s?.action ?? "HOLD";
        const qty = s?.quantity ?? 0;
        return {
          id: asset.id,
          portfolioId: asset.portfolioId,
          ticker: asset.ticker,
          name: asset.name,
          portfolioName: asset.portfolioName,
          price: asset.price,
          target: asset.target,
          current: asset.current,
          shares: asset.shares,
          diff: asset.target - asset.current,
          suggestedAction: action,
          suggestedQuantity: qty,
          suggestedValue: qty * asset.price,
        };
      });

      setRebalancedAssets(rows);
      setRemainingCash(saved.remainingCash);
      setLastCalculated(new Date(saved.updatedAt));
    } catch {
      // ignore
    }
  }, [assetsSignature, allAssets]);

  // Mantém o último cálculo ao navegar entre abas/páginas.
  // Só limpa quando o usuário muda inputs (carteiras/valor do aporte) e ainda não recalculou.
  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const saved = JSON.parse(raw) as PersistedBalancingState;
      const sameInputs =
        (saved.portfolioIds ?? []).sort().join(",") === [...selectedPortfolioIds].sort().join(",") &&
        saved.investmentAmount === investmentAmount;

      if (!sameInputs) {
        setRebalancedAssets([]);
        setRemainingCash(0);
        setLastCalculated(null);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPortfolioIds, investmentAmount]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <p className="text-lg text-muted-foreground">{error}</p>
          <Button onClick={refresh}>Tentar novamente</Button>
        </div>
      </DashboardLayout>
    );
  }

  // Has assets overall but none have target allocations configured
  const hasAssetsWithoutTargets =
    allAssets.length === 0 &&
    portfoliosWithAssets.some((p) => (p.assets ?? []).length > 0);

  if (allAssets.length === 0) {
    return (
      <DashboardLayout>
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <div className="rounded-full bg-muted p-4">
            <TrendingUp className="h-8 w-8 text-muted-foreground" />
          </div>
          {hasAssetsWithoutTargets ? (
            <div>
              <h2 className="text-xl font-semibold">Configure as alocações alvo</h2>
              <p className="text-muted-foreground max-w-sm">
                Você tem ativos cadastrados, mas nenhuma carteira tem alocação alvo configurada (%).
                Abra cada carteira, defina a % alvo dos ativos e volte aqui.
              </p>
            </div>
          ) : (
            <div>
              <h2 className="text-xl font-semibold">Nenhum ativo cadastrado</h2>
              <p className="text-muted-foreground">
                Adicione ativos aos seus portfólios para calcular o balanceamento
              </p>
            </div>
          )}
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h1 className="text-2xl font-bold text-foreground">Balanceamento</h1>
            <p className="text-muted-foreground">Otimize suas alocações com compras e vendas</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl border border-border bg-card p-6 shadow-card"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-2 block text-sm font-medium text-foreground">
                Carteiras para balancear
              </label>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full justify-between"
                  >
                    <span className="truncate">
                      {selectedPortfolioIds.length === 0
                        ? "Todas as carteiras"
                        : selectedPortfolioIds.length === 1
                          ? portfoliosWithAssets.find((p) => p.id === selectedPortfolioIds[0])?.name ??
                            "1 carteira"
                          : `${selectedPortfolioIds.length} carteiras`}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
                  <DropdownMenuCheckboxItem
                    checked={selectedPortfolioIds.length === 0}
                    onCheckedChange={(checked) => {
                      // "Todas" significa: sem filtro (seleção vazia)
                      if (checked) setSelectedPortfolioIds([]);
                    }}
                  >
                    Todas as carteiras
                  </DropdownMenuCheckboxItem>

                  <DropdownMenuSeparator />

                  {portfoliosWithAssets.map((p) => {
                    const isAll = selectedPortfolioIds.length === 0;
                    const checked = !isAll && selectedPortfolioIds.includes(p.id);

                    return (
                      <DropdownMenuCheckboxItem
                        key={p.id}
                        checked={checked}
                        onCheckedChange={(nextChecked) => {
                          // Se estava em "todas" e o usuário marcou uma, vira seleção explícita
                          if (isAll) {
                            if (nextChecked) setSelectedPortfolioIds([p.id]);
                            return;
                          }

                          setSelectedPortfolioIds((prev) => {
                            const set = new Set(prev);
                            if (nextChecked) set.add(p.id);
                            else set.delete(p.id);
                            return Array.from(set);
                          });
                        }}
                      >
                        {p.name}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex-1">
              <label className="mb-2 block text-sm font-medium text-foreground">
                Valor disponível para investir
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  R$
                </span>
                <Input
                  type="text"
                  value={investmentAmount}
                  onChange={(e) => setInvestmentAmount(e.target.value.replace(/\D/g, ""))}
                  className="h-12 pl-10 text-lg font-semibold tabular-nums"
                  placeholder="5000"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={runRebalancing} className="h-12 gap-2 px-6">
                <Calculator className="h-4 w-4" />
                Calcular
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            <div className="rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Patrimônio atual: </span>
              <span className="font-semibold text-foreground tabular-nums">
                {formatCurrency(portfolioValue)}
              </span>
            </div>
            <div className="rounded-lg bg-primary/10 px-3 py-2">
              <span className="text-muted-foreground">Sugestão (compras): </span>
              <span className="font-semibold text-primary tabular-nums">
                {formatCurrency(totalSuggested)}
              </span>
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Caixa restante: </span>
              <span className="font-semibold text-foreground tabular-nums">
                {formatCurrency(remainingCash)}
              </span>
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Ativos: </span>
              <span className="font-semibold text-foreground">{allAssets.length}</span>
            </div>
            {lastCalculated && (
              <div className="text-xs text-muted-foreground">
                Atualizado às {lastCalculated.toLocaleTimeString("pt-BR")}
              </div>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ativo
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Preço
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    % Alvo
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    % Atual
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Diferença
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Qtd Sugerida
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Valor
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {rebalancedAssets.map((asset, index) => {
                  const isUnderAllocated = asset.diff > 0;
                  const isOverAllocated = asset.diff < 0;

                  return (
                    <motion.tr
                      key={asset.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + index * 0.03 }}
                      className="border-b border-border/50 transition-colors hover:bg-muted/20"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 font-mono text-sm font-bold text-primary">
                            {asset.ticker.slice(0, 2)}
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">{asset.ticker}</p>
                            <p className="text-xs text-muted-foreground">{asset.name}</p>
                            <p className="text-[11px] text-muted-foreground">{asset.portfolioName}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right font-medium text-foreground tabular-nums">
                        {formatCurrency(asset.price)}
                      </td>
                      <td className="px-4 py-4 text-right font-medium text-foreground tabular-nums">
                        {asset.target.toFixed(1)}%
                      </td>
                      <td className="px-4 py-4 text-right font-medium text-foreground tabular-nums">
                        {asset.current.toFixed(1)}%
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
                            isUnderAllocated && "bg-primary/10 text-primary",
                            isOverAllocated && "bg-warning/10 text-warning",
                            !isUnderAllocated && !isOverAllocated && "bg-muted text-muted-foreground"
                          )}
                        >
                          {isUnderAllocated && <TrendingDown className="h-3 w-3" />}
                          {isOverAllocated && <TrendingUp className="h-3 w-3" />}
                          {asset.diff > 0 ? "-" : "+"}
                          {Math.abs(asset.diff).toFixed(1)}%
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right font-semibold text-foreground tabular-nums">
                        {asset.suggestedQuantity > 0 ? asset.suggestedQuantity : "-"}
                      </td>
                      <td className="px-4 py-4 text-right font-semibold text-primary tabular-nums">
                        {asset.suggestedValue > 0 ? formatCurrency(asset.suggestedValue) : "-"}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {asset.suggestedQuantity > 0 && asset.suggestedAction === "BUY" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => {
                              const priceBR = asset.price.toFixed(2).replace(".", ",");
                              navigate("/transactions/new", {
                                state: {
                                  prefill: {
                                    tab: "trade" as const,
                                    type: "buy" as const,
                                    portfolioId: asset.portfolioId,
                                    assetId: asset.id,
                                    shares: String(asset.suggestedQuantity),
                                    price: priceBR,
                                    notes: "Sugestão do balanceamento",
                                  },
                                },
                              });
                            }}
                          >
                            <ShoppingCart className="h-3 w-3" />
                            Comprar
                          </Button>
                        )}
                        {asset.suggestedQuantity > 0 && asset.suggestedAction === "SELL" && (
                          <span className="text-xs font-medium text-muted-foreground">Vender</span>
                        )}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
