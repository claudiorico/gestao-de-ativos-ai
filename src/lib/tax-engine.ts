/**
 * Tax Engine (IRPF / DARF) - 100% local & deterministic
 *
 * Zero-knowledge: receives decrypted data from the vault and computes results locally.
 *
 * MVP scope:
 * - B3: Ações/ETFs/FIIs (sem day trade)
 * - Cripto
 * - Trilhas de auditoria (detalhe por operação, compensações e isenções)
 */

import type { Asset, CorporateAction, Transaction } from "@/types/financial";

export type TaxMarket = "B3" | "CRYPTO";

export type TaxCategory =
  | "B3_EQUITIES" // ações + ETFs (swing trade)
  | "B3_FII" // FIIs
  | "CRYPTO";

export type YearMonth = string; // format: YYYY-MM

export type TaxEngineConfig = {
  /** BRL */
  exemptions: {
    /** Regra típica: ações/ETFs isentos se vendas no mês <= 20k */
    b3EquitiesMonthlySalesLimit: number;
    /** Regra típica: cripto isento se vendas no mês <= 35k */
    cryptoMonthlySalesLimit: number;
  };
  rates: {
    b3Equities: number; // ex.: 0.15
    b3Fii: number; // ex.: 0.20
    /**
     * Cripto pode ser progressivo. No MVP, suportamos:
     * - number: aliquota única
     * - brackets: tabela progressiva por faixa de ganho mensal
     */
    crypto:
      | number
      | {
          brackets: Array<{
            /** limite superior da faixa (inclusive). use null para "sem teto" */
            upTo: number | null;
            rate: number;
          }>;
        };
  };
  /**
   * Se true, considera taxas/custos (Transaction.fees) como redutor do lucro.
   * (recomendado)
   */
  includeFeesInGain: boolean;
  /**
   * Se true, quando o mês for isento (ex.: vendas <= limite), ainda assim
   * deixa o prejuízo mensal acumular para compensação futura.
   */
  accumulateLossOnExemptMonths: boolean;
};

export const defaultTaxEngineConfig: TaxEngineConfig = {
  exemptions: {
    b3EquitiesMonthlySalesLimit: 20_000,
    cryptoMonthlySalesLimit: 35_000,
  },
  rates: {
    b3Equities: 0.15,
    b3Fii: 0.2,
    crypto: 0.15,
  },
  includeFeesInGain: true,
  accumulateLossOnExemptMonths: true,
};

export type GainOperationAudit = {
  transactionId: string;
  date: number;
  assetId: string;
  ticker: string;
  category: TaxCategory;

  type: "sell";
  quantity: number;

  /** valor bruto da venda (sem taxas) */
  proceedsGross: number;
  /** taxas atribuídas à operação (se houver) */
  fees: number;
  /** valor líquido considerado (proceedsGross - fees) */
  proceedsNet: number;

  /** custo proporcional consumido na venda */
  costBasis: number;

  /** lucro líquido da operação */
  gain: number;

  /** snapshot de custo/quantidade ANTES da venda */
  positionBefore: {
    quantity: number;
    avgCost: number;
  };

  /** snapshot de custo/quantidade APÓS a venda */
  positionAfter: {
    quantity: number;
    avgCost: number;
  };

  warnings: string[];
};

export type MonthlyCategoryApuration = {
  category: TaxCategory;

  /** soma das vendas (brutas) do mês para regras de isenção */
  salesTotalGross: number;

  /** lucro/prejuízo líquido do mês (somando operações) */
  netResult: number;

  /** prejuízo acumulado trazido de meses anteriores (valor <= 0) */
  lossCarryIn: number;
  /** quanto do prejuízo foi usado para abater lucro no mês */
  lossUsed: number;
  /** prejuízo acumulado para o próximo mês (valor <= 0) */
  lossCarryOut: number;

  /** se houve isenção aplicável no mês */
  isExempt: boolean;
  exemptReason?: string;

  /** base tributável após compensação */
  taxableBase: number;

  /** imposto devido para a categoria no mês */
  taxDue: number;

  /** trilha de auditoria por operação */
  operations: GainOperationAudit[];

  warnings: string[];
};

export type MonthlyApuration = {
  month: YearMonth;
  categories: Record<TaxCategory, MonthlyCategoryApuration>;
  totalTaxDue: number;
};

export type TaxEngineInput = {
  assets: Asset[];
  transactions: Transaction[];
  corporateActions?: CorporateAction[];
  /** opcional: filtra por portfólio */
  portfolioId?: string;
  /** ano calendário (ex.: 2025) */
  year: number;
  config?: Partial<TaxEngineConfig>;
};

export type TaxEngineOutput = {
  year: number;
  months: MonthlyApuration[];

  /** prejuízo final acumulado por categoria ao término do ano */
  endingLossCarry: Record<TaxCategory, number>;

  warnings: string[];
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function toYearMonth(dateMs: number): YearMonth {
  const d = new Date(dateMs);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  return `${y}-${m}`;
}

function toYYYYMMDD(dateMs: number): string {
  const d = new Date(dateMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function inferTaxMarket(asset: Asset): TaxMarket {
  return asset.type === "crypto" ? "CRYPTO" : "B3";
}

export function inferTaxCategory(asset: Asset): TaxCategory {
  if (asset.type === "crypto") return "CRYPTO";
  if (asset.type === "reit") return "B3_FII";
  // stock, etf e demais (no MVP: trata como equities)
  return "B3_EQUITIES";
}

/**
 * Retorna true apenas para ativos sujeitos à apuração de ganho de capital via DARF.
 * Fundos de investimento: IR recolhido pelo administrador (come-cotas/resgate).
 * Renda fixa (Tesouro, CDB…): IR na fonte, sem DARF de ganho de capital.
 */
export function isCapitalGainsTaxable(asset: Asset): boolean {
  return asset.type !== "investment_fund" && asset.type !== "fixed_income";
}

function mergeConfig(partial?: Partial<TaxEngineConfig>): TaxEngineConfig {
  const base = defaultTaxEngineConfig;
  return {
    ...base,
    ...partial,
    exemptions: {
      ...base.exemptions,
      ...(partial?.exemptions ?? {}),
    },
    rates: {
      ...base.rates,
      ...(partial?.rates ?? {}),
    },
  };
}

function safeNumber(n: unknown, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function computeCryptoTax(rateCfg: TaxEngineConfig["rates"]["crypto"], taxableBase: number) {
  const base = Math.max(0, taxableBase);
  if (typeof rateCfg === "number") return base * rateCfg;

  // progressivo por faixas
  let remaining = base;
  let taxed = 0;
  let prevUpper = 0;

  for (const b of rateCfg.brackets) {
    if (remaining <= 0) break;

    const upper = b.upTo;
    const slice =
      upper === null
        ? remaining
        : Math.max(0, Math.min(remaining, upper - prevUpper));

    taxed += slice * b.rate;
    remaining -= slice;
    if (upper !== null) prevUpper = upper;
  }

  return taxed;
}

type RunningPosition = {
  qty: number;
  totalCost: number; // custo agregado (qty * avg)
};

function applyTaxCorporateAction(
  positions: Map<string, RunningPosition>,
  action: CorporateAction
) {
  const source = positions.get(action.assetId) ?? { qty: 0, totalCost: 0 };
  const numerator = safeNumber(action.ratioNumerator, 0);
  const denominator = safeNumber(action.ratioDenominator, 0);
  const ratio = numerator > 0 && denominator > 0 ? numerator / denominator : 0;

  if (action.type === "split" || action.type === "reverse_split") {
    if (ratio > 0) source.qty *= ratio;
    positions.set(action.assetId, source);
    return;
  }

  if (action.type === "bonus" || action.type === "subscription") {
    source.qty +=
      safeNumber(action.quantityChange, 0) || (ratio > 0 ? source.qty * ratio : 0);
    source.totalCost = Math.max(
      0,
      source.totalCost + safeNumber(action.costBasisChange, 0)
    );
    positions.set(action.assetId, source);
    return;
  }

  if (action.type === "amortization") {
    const reduction = Math.abs(
      safeNumber(action.costBasisChange, 0) || safeNumber(action.cashValue, 0)
    );
    source.totalCost = Math.max(0, source.totalCost - reduction);
    positions.set(action.assetId, source);
    return;
  }

  if (
    (action.type === "ticker_change" || action.type === "merger") &&
    action.destinationAssetId
  ) {
    const destination = positions.get(action.destinationAssetId) ?? {
      qty: 0,
      totalCost: 0,
    };
    destination.qty += ratio > 0 ? source.qty * ratio : source.qty;
    destination.totalCost += source.totalCost + safeNumber(action.costBasisChange, 0);
    positions.set(action.destinationAssetId, destination);
    positions.set(action.assetId, { qty: 0, totalCost: 0 });
  }
}

/**
 * Apuração mensal (DARF) para o ano, com trilha de auditoria.
 *
 * Regras:
 * - Separação de Day Trade (alíquota 20%, compensação própria, sem isenção)
 * - Isenção de R$ 20k de vendas mensais restrita a Ações swing trade
 * - ETFs e BDRs tributados normalmente a 15%
 * - Compensação de prejuízo por categoria
 */
export function computeMonthlyApuration(input: TaxEngineInput): TaxEngineOutput {
  const config = mergeConfig(input.config);

  const assetsById = new Map(input.assets.map((a) => [a.id, a] as const));

  const warnings: string[] = [];

  // 1) Filtrar transações básicas para o ano
  const baseTxs = input.transactions
    .filter((t) => (input.portfolioId ? t.portfolioId === input.portfolioId : true))
    .filter((t) => {
      const y = new Date(t.date).getFullYear();
      return y === input.year;
    });

  // Buckets por mês e categoria
  type MonthBucket = {
    salesGross: Record<TaxCategory, number>;
    netResult: Record<TaxCategory, number>;
    ops: Record<TaxCategory, GainOperationAudit[]>;
    warnings: Record<TaxCategory, string[]>;
  };

  const buckets = new Map<YearMonth, MonthBucket>();

  const ensureBucket = (ym: YearMonth): MonthBucket => {
    const existing = buckets.get(ym);
    if (existing) return existing;

    const blank = {
      salesGross: {
        B3_EQUITIES: 0,
        B3_FII: 0,
        CRYPTO: 0,
      },
      netResult: {
        B3_EQUITIES: 0,
        B3_FII: 0,
        CRYPTO: 0,
      },
      ops: {
        B3_EQUITIES: [],
        B3_FII: [],
        CRYPTO: [],
      },
      warnings: {
        B3_EQUITIES: [],
        B3_FII: [],
        CRYPTO: [],
      },
    } satisfies MonthBucket;

    buckets.set(ym, blank);
    return blank;
  };

  // Agrupar por dia e ativo para detectar e calcular Day Trade
  const groups: Record<string, Transaction[]> = {};
  for (const t of baseTxs) {
    const asset = assetsById.get(t.assetId);
    if (!asset || !isCapitalGainsTaxable(asset)) continue;
    const dayKey = toYYYYMMDD(t.date);
    const groupKey = `${dayKey}_${t.assetId}`;
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(t);
  }

  const processedTxs: Transaction[] = [];
  
  // Map de YearMonth -> total de vendas brutas, ganho líquido e auditorias de Day Trade
  const dayTradeMonthlyStats: Record<
    YearMonth,
    { salesGross: number; netResult: number; ops: GainOperationAudit[] }
  > = {};

  const ensureDtMonthStats = (ym: YearMonth) => {
    if (!dayTradeMonthlyStats[ym]) {
      dayTradeMonthlyStats[ym] = { salesGross: 0, netResult: 0, ops: [] };
    }
    return dayTradeMonthlyStats[ym];
  };

  for (const groupKey in groups) {
    const group = groups[groupKey];
    const assetId = group[0].assetId;
    const asset = assetsById.get(assetId)!;
    const category = inferTaxCategory(asset);

    const buys = group.filter((t) => t.type === "buy");
    const sells = group.filter((t) => t.type === "sell");

    const totalBuyQty = buys.reduce((sum, t) => sum + safeNumber(t.shares), 0);
    const totalSellQty = sells.reduce((sum, t) => sum + safeNumber(t.shares), 0);

    if (totalBuyQty > 0 && totalSellQty > 0) {
      // Ocorre Day Trade
      const dtQty = Math.min(totalBuyQty, totalSellQty);

      const totalBuyVal = buys.reduce(
        (sum, t) => sum + safeNumber(t.shares) * safeNumber(t.pricePerShare),
        0
      );
      const avgBuyPrice = totalBuyVal / totalBuyQty;

      const totalSellVal = sells.reduce(
        (sum, t) => sum + safeNumber(t.shares) * safeNumber(t.pricePerShare),
        0
      );
      const avgSellPrice = totalSellVal / totalSellQty;

      const totalBuyFees = buys.reduce((sum, t) => sum + safeNumber(t.fees), 0);
      const totalSellFees = sells.reduce((sum, t) => sum + safeNumber(t.fees), 0);

      const dtBuyFees = totalBuyFees * (dtQty / totalBuyQty);
      const dtSellFees = totalSellFees * (dtQty / totalSellQty);
      const dtFees = dtBuyFees + dtSellFees;

      const dtProceedsGross = dtQty * avgSellPrice;
      const dtProceedsNet = dtProceedsGross - (config.includeFeesInGain ? dtFees : 0);
      
      const dtGain = config.includeFeesInGain
        ? dtProceedsNet - (dtQty * avgBuyPrice)
        : dtProceedsGross - (dtQty * avgBuyPrice);

      const firstTx = buys[0] || sells[0];
      const ym = toYearMonth(firstTx.date);

      const dtAudit: GainOperationAudit = {
        transactionId: `dt-${assetId}-${groupKey}`,
        date: firstTx.date,
        assetId,
        ticker: asset.ticker,
        category,
        type: "sell",
        quantity: dtQty,
        proceedsGross: dtProceedsGross,
        fees: dtFees,
        proceedsNet: dtProceedsGross - dtFees,
        costBasis: dtQty * avgBuyPrice,
        gain: dtGain,
        positionBefore: { quantity: totalBuyQty, avgCost: avgBuyPrice },
        positionAfter: { quantity: 0, avgCost: avgBuyPrice },
        warnings: [
          category === "B3_EQUITIES"
            ? "Operação de Day Trade (alíquota 20%, sem isenção)"
            : "Casamento intradia (Day Trade)",
        ],
      };

      if (category === "B3_EQUITIES") {
        const stats = ensureDtMonthStats(ym);
        stats.salesGross += dtProceedsGross;
        stats.netResult += dtGain;
        stats.ops.push(dtAudit);
        // Garante que o mês existe no bucket mesmo que não haja Swing Trade
        ensureBucket(ym);
      } else {
        // Para FII e Cripto, joga direto no bucket mensal para apurar junto com swing trade
        const bucket = ensureBucket(ym);
        bucket.ops[category].push(dtAudit);
        bucket.salesGross[category] += dtProceedsGross;
        bucket.netResult[category] += dtGain;
      }

      // Adicionar resíduos de Swing Trade para o loop cronológico
      if (totalBuyQty > dtQty) {
        const residQty = totalBuyQty - dtQty;
        const residFees = totalBuyFees * (residQty / totalBuyQty);
        processedTxs.push({
          id: `resid-buy-${assetId}-${groupKey}`,
          assetId,
          portfolioId: buys[0].portfolioId,
          type: "buy",
          shares: residQty,
          pricePerShare: avgBuyPrice,
          totalValue: residQty * avgBuyPrice,
          fees: residFees,
          date: buys[0].date,
          createdAt: Date.now(),
        });
      }

      if (totalSellQty > dtQty) {
        const residQty = totalSellQty - dtQty;
        const residFees = totalSellFees * (residQty / totalSellQty);
        processedTxs.push({
          id: `resid-sell-${assetId}-${groupKey}`,
          assetId,
          portfolioId: sells[0].portfolioId,
          type: "sell",
          shares: residQty,
          pricePerShare: avgSellPrice,
          totalValue: residQty * avgSellPrice,
          fees: residFees,
          date: sells[0].date,
          createdAt: Date.now(),
        });
      }
    } else {
      // Não ocorre Day Trade
      processedTxs.push(...group);
    }
  }

  // Ordenar transações processadas (compras sempre antes de vendas no mesmo timestamp)
  processedTxs.sort((a, b) => {
    if (a.date !== b.date) return a.date - b.date;
    if (a.type === "buy" && b.type === "sell") return -1;
    if (a.type === "sell" && b.type === "buy") return 1;
    return 0;
  });

  // positions por ativo (para custo médio de Swing Trade)
  const posByAsset = new Map<string, RunningPosition>();

  const appliedActions = (input.corporateActions ?? []).filter(
    (action) =>
      action.status === "applied" &&
      (!input.portfolioId || action.portfolioId === input.portfolioId) &&
      new Date(action.date).getFullYear() === input.year
  );
  const pendingActions = (input.corporateActions ?? []).filter(
    (action) =>
      action.status === "pending" &&
      (!input.portfolioId || action.portfolioId === input.portfolioId) &&
      new Date(action.date).getFullYear() === input.year
  );
  if (pendingActions.length > 0) {
    warnings.push(
      `${pendingActions.length} evento(s) corporativo(s) pendente(s) nao foram aplicados na apuracao.`
    );
  }

  const timeline = [
    ...appliedActions.map((action) => ({ date: action.date, priority: 0, action })),
    ...processedTxs.map((transaction) => ({
      date: transaction.date,
      priority: 1,
      transaction,
    })),
  ].sort((a, b) => a.date - b.date || a.priority - b.priority);

  // 2) Percorre transações de Swing Trade em ordem cronológica para gerar ganhos
  for (const entry of timeline) {
    if ("action" in entry) {
      applyTaxCorporateAction(posByAsset, entry.action);
      continue;
    }
    const t = entry.transaction;
    const asset = assetsById.get(t.assetId);
    if (!asset) {
      warnings.push(`Transação ${t.id} referencia assetId inexistente (${t.assetId}).`);
      continue;
    }

    const category = inferTaxCategory(asset);

    const qty = safeNumber(t.shares, 0);
    const price = safeNumber(t.pricePerShare, 0);
    const fees = safeNumber(t.fees, 0);

    if (qty <= 0 || price <= 0) {
      const ym = toYearMonth(t.date);
      const bucket = ensureBucket(ym);
      bucket.warnings[category].push(`Transação ${t.id} com quantidade/preço inválidos.`);
      continue;
    }

    const currentPos = posByAsset.get(asset.id) ?? { qty: 0, totalCost: 0 };

    if (t.type === "buy") {
      const gross = qty * price;
      const cost = gross + (config.includeFeesInGain ? fees : 0);

      const next: RunningPosition = {
        qty: currentPos.qty + qty,
        totalCost: currentPos.totalCost + cost,
      };
      posByAsset.set(asset.id, next);
      continue;
    }

    // sell
    const ym = toYearMonth(t.date);
    const bucket = ensureBucket(ym);

    const warningsOp: string[] = [];

    const proceedsGross = qty * price;
    const proceedsNet = proceedsGross - (config.includeFeesInGain ? fees : 0);

    if (currentPos.qty <= 0 || currentPos.totalCost <= 0) {
      warningsOp.push("Venda sem posição/custo anterior (preço médio não encontrado).");
    }

    const avgCost = currentPos.qty > 0 ? currentPos.totalCost / currentPos.qty : 0;

    // custo proporcional
    const costBasis = avgCost * qty;

    // ganho líquido
    const gain = proceedsNet - costBasis;

    // atualiza posição
    const nextQty = currentPos.qty - qty;
    const nextTotalCost = currentPos.totalCost - costBasis;

    if (nextQty < -1e-9) {
      warningsOp.push("Venda maior que a quantidade em custódia (posição ficou negativa).");
    }

    posByAsset.set(asset.id, {
      qty: Math.max(0, nextQty),
      totalCost: Math.max(0, nextTotalCost),
    });

    bucket.salesGross[category] += proceedsGross;
    bucket.netResult[category] += gain;

    const afterPos = posByAsset.get(asset.id)!;
    const afterAvg = afterPos.qty > 0 ? afterPos.totalCost / afterPos.qty : 0;

    bucket.ops[category].push({
      transactionId: t.id,
      date: t.date,
      assetId: asset.id,
      ticker: asset.ticker,
      category,
      type: "sell",
      quantity: qty,
      proceedsGross,
      fees,
      proceedsNet,
      costBasis,
      gain,
      positionBefore: {
        quantity: currentPos.qty,
        avgCost,
      },
      positionAfter: {
        quantity: afterPos.qty,
        avgCost: afterAvg,
      },
      warnings: warningsOp,
    });

    if (warningsOp.length) {
      bucket.warnings[category].push(...warningsOp.map((w) => `${asset.ticker}: ${w}`));
    }
  }

  // 3) Consolida meses do ano
  const monthsSorted = Array.from(buckets.keys()).sort();

  const lossCarry: Record<TaxCategory, number> = {
    B3_EQUITIES: 0,
    B3_FII: 0,
    CRYPTO: 0,
  };

  let dayTradeLossCarry = 0; // Prejuízo acumulado DT para B3_EQUITIES

  const months: MonthlyApuration[] = [];

  for (const ym of monthsSorted) {
    const b = buckets.get(ym)!;

    const categories = (Object.keys(lossCarry) as TaxCategory[]).reduce(
      (acc, cat) => {
        const salesGross = b.salesGross[cat] ?? 0;
        const netResult = b.netResult[cat] ?? 0;
        const ops = b.ops[cat] ?? [];
        const catWarnings = b.warnings[cat] ?? [];

        const lossCarryIn = lossCarry[cat]; // <= 0

        let isExempt = false;
        let exemptReason: string | undefined;

        let taxableBase = 0;
        let lossUsed = 0;
        let taxDue = 0;
        let lossCarryOut = lossCarryIn;

        if (cat === "B3_EQUITIES") {
          // Separar ações de outros ativos para calcular a isenção
          const swingOps = ops;
          const salesGrossStocksOnly = swingOps
            .filter((o) => assetsById.get(o.assetId)?.type === "stock")
            .reduce((sum, o) => sum + o.proceedsGross, 0);

          const isStocksExempt =
            salesGrossStocksOnly > 0 &&
            salesGrossStocksOnly <= config.exemptions.b3EquitiesMonthlySalesLimit;

          if (isStocksExempt) {
            isExempt = true;
            exemptReason = `Isenção de Ações ativa (vendas de ações R$ ${salesGrossStocksOnly.toLocaleString(
              "pt-BR"
            )} <= R$ 20.000). ETFs/BDRs/DayTrade são tributados.`;
          }

          let swingTaxableNetResult = 0;
          let swingExemptNetResult = 0;

          for (const op of swingOps) {
            const assetType = assetsById.get(op.assetId)?.type;
            if (assetType === "stock" && isStocksExempt) {
              swingExemptNetResult += op.gain;
              op.warnings.push("Operação de Ações isenta (vendas de ações no mês <= R$ 20.000)");
            } else {
              swingTaxableNetResult += op.gain;
            }
          }

          // Recuperar estatísticas de Day Trade
          const dtStats = dayTradeMonthlyStats[ym] || { salesGross: 0, netResult: 0, ops: [] };
          const dtNetResult = dtStats.netResult;
          const dtSalesGross = dtStats.salesGross;
          const dtOps = dtStats.ops;

          // Compensar Swing Trade
          const swingBaseBeforeLoss = swingTaxableNetResult;
          let swingLossUsed = 0;
          let swingTaxableBase = 0;

          if (swingBaseBeforeLoss > 0 && lossCarryIn < 0) {
            swingLossUsed = Math.min(swingBaseBeforeLoss, Math.abs(lossCarryIn));
            swingTaxableBase = swingBaseBeforeLoss - swingLossUsed;
          } else {
            swingTaxableBase = Math.max(0, swingBaseBeforeLoss);
          }

          const swingTaxDue = swingTaxableBase * config.rates.b3Equities;

          // Atualizar Swing lossCarryOut
          let swingLossCarryOut = lossCarryIn + swingLossUsed;
          if (swingTaxableNetResult < 0) {
            swingLossCarryOut += swingTaxableNetResult;
          }
          if (isStocksExempt && config.accumulateLossOnExemptMonths && swingExemptNetResult < 0) {
            swingLossCarryOut += swingExemptNetResult;
          }
          if (swingLossCarryOut > 0) swingLossCarryOut = 0;
          lossCarryOut = swingLossCarryOut;
          lossCarry[cat] = swingLossCarryOut;
          lossUsed = swingLossUsed;

          // Compensar Day Trade
          const dtBaseBeforeLoss = dtNetResult;
          const dtLossCarryIn = dayTradeLossCarry;
          let dtLossUsed = 0;
          let dtTaxableBase = 0;

          if (dtBaseBeforeLoss > 0 && dtLossCarryIn < 0) {
            dtLossUsed = Math.min(dtBaseBeforeLoss, Math.abs(dtLossCarryIn));
            dtTaxableBase = dtBaseBeforeLoss - dtLossUsed;
          } else {
            dtTaxableBase = Math.max(0, dtBaseBeforeLoss);
          }

          const dtTaxDue = dtTaxableBase * 0.20; // Day Trade = 20%

          let dtLossCarryOut = dtLossCarryIn + dtLossUsed;
          if (dtNetResult < 0) {
            dtLossCarryOut += dtNetResult;
          }
          if (dtLossCarryOut > 0) dtLossCarryOut = 0;
          dayTradeLossCarry = dtLossCarryOut;

          // Avisos informativos de Day Trade na categoria
          const formatBrl = (v: number) =>
            new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

          if (dtNetResult !== 0 || dtLossCarryIn < 0) {
            catWarnings.push(
              `[Day Trade] Resultado: ${formatBrl(dtNetResult)} | Compensação usada: ${formatBrl(
                dtLossUsed
              )} | Imposto devido (20%): ${formatBrl(dtTaxDue)} | Prejuízo acumulado DT: de ${formatBrl(
                dtLossCarryIn
              )} para ${formatBrl(dtLossCarryOut)}`
            );
          }

          const totalTaxDueForCat = swingTaxDue + dtTaxDue;
          isExempt = isStocksExempt && totalTaxDueForCat === 0;

          acc[cat] = {
            category: cat,
            salesTotalGross: salesGross + dtSalesGross,
            netResult: swingTaxableNetResult + swingExemptNetResult + dtNetResult,
            lossCarryIn,
            lossUsed: swingLossUsed + dtLossUsed,
            lossCarryOut,
            isExempt,
            exemptReason: isStocksExempt ? exemptReason : undefined,
            taxableBase: swingTaxableBase + dtTaxableBase,
            taxDue: totalTaxDueForCat,
            operations: [...swingOps, ...dtOps],
            warnings: catWarnings,
          };
        } else {
          // Categorias FII e CRYPTO (lógica padrão mantida)
          if (cat === "CRYPTO") {
            if (salesGross > 0 && salesGross <= config.exemptions.cryptoMonthlySalesLimit) {
              isExempt = true;
              exemptReason = `Vendas no mês <= ${config.exemptions.cryptoMonthlySalesLimit.toLocaleString(
                "pt-BR"
              )} (isento)`;
            }
          }

          if (!isExempt) {
            const baseBeforeLoss = netResult;

            if (baseBeforeLoss > 0 && lossCarryIn < 0) {
              lossUsed = Math.min(baseBeforeLoss, Math.abs(lossCarryIn));
              taxableBase = Math.max(0, baseBeforeLoss - lossUsed);
            } else {
              taxableBase = Math.max(0, baseBeforeLoss);
            }

            if (taxableBase > 0) {
              if (cat === "B3_FII") taxDue = taxableBase * config.rates.b3Fii;
              if (cat === "CRYPTO") taxDue = computeCryptoTax(config.rates.crypto, taxableBase);
            }
          }

          if (!isExempt) {
            lossCarryOut = lossCarryIn + lossUsed;
            if (netResult < 0) lossCarryOut += netResult;
            if (lossCarryOut > 0) lossCarryOut = 0;
          } else {
            if (config.accumulateLossOnExemptMonths && netResult < 0) {
              lossCarryOut = lossCarryIn + netResult;
            } else {
              lossCarryOut = lossCarryIn;
            }
          }

          lossCarry[cat] = lossCarryOut;

          acc[cat] = {
            category: cat,
            salesTotalGross: salesGross,
            netResult,
            lossCarryIn,
            lossUsed,
            lossCarryOut,
            isExempt,
            exemptReason,
            taxableBase,
            taxDue,
            operations: ops,
            warnings: catWarnings,
          };
        }

        return acc;
      },
      {} as Record<TaxCategory, MonthlyCategoryApuration>
    );

    const totalTaxDue =
      categories.B3_EQUITIES.taxDue + categories.B3_FII.taxDue + categories.CRYPTO.taxDue;

    months.push({
      month: ym,
      categories,
      totalTaxDue,
    });
  }


  return {
    year: input.year,
    months,
    endingLossCarry: { ...lossCarry },
    warnings,
  };
}
