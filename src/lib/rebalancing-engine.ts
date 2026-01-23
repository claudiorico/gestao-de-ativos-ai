export type RebalanceMode = "REBALANCE_ONLY" | "WITH_CONTRIBUTION";

export type RebalanceInputAsset = {
  id: string;
  targetPercent: number; // 0..1
  currentQuantity: number; // pode ser fracionário (ex.: Tesouro)
  currentPrice: number; // >0
  lotSize?: number; // passo mínimo de negociação (default: 1)
};

export type RebalanceInput = {
  assets: RebalanceInputAsset[];
  availableCash: number;
  mode: RebalanceMode;
};

export type RebalanceSuggestion = {
  assetId: string;
  action: "BUY" | "SELL" | "HOLD";
  quantity: number; // >= 0 (pode ser fracionário)
  estimatedValue: number;
};

export type RebalanceOutput = {
  suggestions: RebalanceSuggestion[];
  remainingCash: number;
  finalQuantities: Record<string, number>;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const normalizeStep = (step?: number) => {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return 1;
  return s;
};

const floorToStep = (value: number, step: number) => {
  if (!Number.isFinite(value)) return 0;
  const s = normalizeStep(step);
  return Math.max(0, Math.floor(value / s) * s);
};

function computeValues(assets: RebalanceInputAsset[], quantities: Record<string, number>) {
  const currentValues = assets.map((a) => {
    const qty = quantities[a.id] ?? a.currentQuantity;
    return qty * a.currentPrice;
  });
  const total = currentValues.reduce((acc, v) => acc + v, 0);
  return { currentValues, total };
}

function computeDiffs(params: {
  assets: RebalanceInputAsset[];
  quantities: Record<string, number>;
  targetPortfolioValue: number;
}) {
  const { assets, quantities, targetPortfolioValue } = params;
  return assets.map((a) => {
    const qty = quantities[a.id] ?? a.currentQuantity;
    const currentValue = qty * a.currentPrice;
    const targetValue = targetPortfolioValue * clamp01(a.targetPercent);
    const difference = targetValue - currentValue;

    return {
      id: a.id,
      currentValue,
      targetValue,
      difference,
      currentPrice: a.currentPrice,
      lotSize: normalizeStep(a.lotSize),
    };
  });
}

/**
 * Motor determinístico, incremental e stateful (consciente das compras/vendas simuladas dentro do ciclo).
 */
export function rebalanceAssets(input: RebalanceInput): RebalanceOutput {
  // 1) Sanitiza entradas
  // 2) Normaliza alvos para somarem 100% (1.0) quando necessário
  const sanitized = input.assets
    .filter((a) => a.currentPrice > 0)
    .map((a) => ({
      ...a,
      targetPercent: clamp01(a.targetPercent),
      currentQuantity: Math.max(0, Number(a.currentQuantity || 0)),
      lotSize: normalizeStep(a.lotSize),
    }));

  const targetSum = sanitized.reduce((acc, a) => acc + (Number.isFinite(a.targetPercent) ? a.targetPercent : 0), 0);

  const assets = sanitized.map((a) => ({
    ...a,
    targetPercent: targetSum > 0 ? a.targetPercent / targetSum : 0,
  }));

  const initialQuantities: Record<string, number> = Object.fromEntries(
    assets.map((a) => [a.id, a.currentQuantity])
  );

  const quantities: Record<string, number> = { ...initialQuantities };

  const { total: totalPortfolioValue } = computeValues(assets, quantities);

  const availableCash = Math.max(0, input.availableCash || 0);
  const mode = input.mode;

  // Estratégia:
  // - WITH_CONTRIBUTION: alocar o aporte APENAS para cobrir subalocações atuais (sem “antecipar”
  //   o novo total após o aporte). Isso evita comprar ativos/carteiras já sobrealocados.
  // - REBALANCE_ONLY: patrimônio total constante.
  const targetPortfolioValue = totalPortfolioValue;

  let remainingCash = mode === "WITH_CONTRIBUTION" ? availableCash : 0;

  const canBuyAny = () =>
    assets.some((a) => {
      const step = normalizeStep(a.lotSize);
      return remainingCash >= a.currentPrice * step;
    });

  if (mode === "WITH_CONTRIBUTION") {
    // Loop principal incremental: compra em blocos para evitar loops enormes (ex.: cripto com passo muito pequeno)
    // Guardrail para evitar loops infinitos por floating point
    const MAX_STEPS = 10_000;
    let steps = 0;

    while (steps < MAX_STEPS) {
      steps++;

       const diffs = computeDiffs({ assets, quantities, targetPortfolioValue });

       // Elegíveis: cabem pelo menos 1 lote no caixa
       const affordable = diffs.filter((d) => remainingCash >= d.currentPrice * d.lotSize);

       // Compra somente ativos subalocados (difference > 0). Se não houver, encerra.
       const eligibleBuys = affordable
         .filter((d) => d.difference > 0)
         .sort((a, b) => {
           const aRel = a.targetValue > 0 ? a.difference / a.targetValue : 0;
           const bRel = b.targetValue > 0 ? b.difference / b.targetValue : 0;
           if (bRel !== aRel) return bRel - aRel;
           return b.difference - a.difference;
         });

       const pick = eligibleBuys[0] as (typeof diffs)[number] | undefined;
       if (!pick) break;

      // Compra o máximo possível (respeitando lote) para este ativo na iteração
      const maxByCash = floorToStep(remainingCash / pick.currentPrice, pick.lotSize);
      const maxByDiff = pick.difference > 0 ? floorToStep(pick.difference / pick.currentPrice, pick.lotSize) : maxByCash;
      const buyQty = Math.max(0, Math.min(maxByCash, maxByDiff));

      if (buyQty <= 0) break;

      quantities[pick.id] = (quantities[pick.id] ?? 0) + buyQty;
      remainingCash = Math.max(0, remainingCash - pick.currentPrice * buyQty);

      if (!canBuyAny()) break;
    }
  } else {
    // REBALANCE_ONLY: vende sobrealocados para comprar subalocados (patrimônio total constante)
    const MAX_STEPS = 100_000;
    let steps = 0;

    while (steps < MAX_STEPS) {
      steps++;

      const diffs = computeDiffs({ assets, quantities, targetPortfolioValue });

      const toSell = diffs
        .filter((d) => d.difference < 0)
        .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

      const toBuy = diffs
        .filter((d) => d.difference > 0)
        .sort((a, b) => b.difference - a.difference);

      const canTrade = toSell.length > 0 && (toBuy.length > 0 || remainingCash > 0);
      if (!canTrade) break;

      // 1) Realiza 1 venda por iteração (determinístico)
      const sellPick = toSell[0];
      const sellAsset = assets.find((a) => a.id === sellPick.id);
      const currentQty = quantities[sellPick.id] ?? 0;

      if (!sellAsset || currentQty <= 0) {
        break;
      }

      const step = normalizeStep(sellAsset.lotSize);
      const maxSellByDiff = floorToStep(Math.abs(sellPick.difference) / sellPick.currentPrice, step);
      const sellQty = Math.min(currentQty, Math.max(0, maxSellByDiff));

      if (sellQty <= 0) {
        // Nada vendável -> encerra
        break;
      }

      // Vende TUDO de uma vez para este ativo (como descrito), convertendo em caixa
      quantities[sellPick.id] = currentQty - sellQty;
      remainingCash += sellQty * sellPick.currentPrice;

      // 2) Distribui o caixa comprando subalocados em blocos (respeitando lote)
      // enquanto houver caixa suficiente
      let boughtSomething = false;
      while (remainingCash > 0) {
         const diffsAfterSell = computeDiffs({ assets, quantities, targetPortfolioValue });

         const affordable = diffsAfterSell.filter((d) => remainingCash >= d.currentPrice * d.lotSize);

         // Compra somente ativos subalocados (difference > 0). Se não houver, para.
         const eligibleBuys = affordable
           .filter((d) => d.difference > 0)
           .sort((a, b) => {
             const aRel = a.targetValue > 0 ? a.difference / a.targetValue : 0;
             const bRel = b.targetValue > 0 ? b.difference / b.targetValue : 0;
             if (bRel !== aRel) return bRel - aRel;
             return b.difference - a.difference;
           });

         const buyPick = eligibleBuys[0] as (typeof diffsAfterSell)[number] | undefined;

         if (!buyPick) break;

        const maxByCash = floorToStep(remainingCash / buyPick.currentPrice, buyPick.lotSize);
        const maxByDiff =
          buyPick.difference > 0
            ? floorToStep(buyPick.difference / buyPick.currentPrice, buyPick.lotSize)
            : maxByCash;
        const buyQty = Math.max(0, Math.min(maxByCash, maxByDiff));

        if (buyQty <= 0) break;

        quantities[buyPick.id] = (quantities[buyPick.id] ?? 0) + buyQty;
        remainingCash = Math.max(0, remainingCash - buyPick.currentPrice * buyQty);
        boughtSomething = true;

        if (!canBuyAny()) break;
      }

      // Se nem comprou nada com a venda, e não dá pra comprar mais, encerra
      if (!boughtSomething && !canBuyAny()) break;
    }
  }

  // Sugestões finais
  const suggestions: RebalanceSuggestion[] = assets.map((a) => {
    const initialQty = initialQuantities[a.id] ?? 0;
    const finalQty = quantities[a.id] ?? 0;

    if (finalQty > initialQty) {
      const qty = finalQty - initialQty;
      return {
        assetId: a.id,
        action: "BUY",
        quantity: qty,
        estimatedValue: qty * a.currentPrice,
      };
    }

    if (finalQty < initialQty) {
      const qty = initialQty - finalQty;
      return {
        assetId: a.id,
        action: "SELL",
        quantity: qty,
        estimatedValue: qty * a.currentPrice,
      };
    }

    return { assetId: a.id, action: "HOLD", quantity: 0, estimatedValue: 0 };
  });

  return {
    suggestions,
    remainingCash,
    finalQuantities: quantities,
  };
}
