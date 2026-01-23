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

import type { Asset, Transaction } from "@/types/financial";

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

export function inferTaxMarket(asset: Asset): TaxMarket {
  return asset.type === "crypto" ? "CRYPTO" : "B3";
}

export function inferTaxCategory(asset: Asset): TaxCategory {
  if (asset.type === "crypto") return "CRYPTO";
  if (asset.type === "reit") return "B3_FII";
  // stock, etf e demais (no MVP: trata como equities)
  return "B3_EQUITIES";
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

/**
 * Apuração mensal (DARF) para o ano, com trilha de auditoria.
 *
 * Regras MVP:
 * - Sem day trade (não separa DT)
 * - Compensação de prejuízo por categoria (B3_EQUITIES vs B3_FII vs CRYPTO)
 * - Isenção por volume de vendas no mês (equities e cripto)
 */
export function computeMonthlyApuration(input: TaxEngineInput): TaxEngineOutput {
  const config = mergeConfig(input.config);

  const assetsById = new Map(input.assets.map((a) => [a.id, a] as const));

  const warnings: string[] = [];

  const txs = input.transactions
    .filter((t) => (input.portfolioId ? t.portfolioId === input.portfolioId : true))
    .filter((t) => {
      const y = new Date(t.date).getFullYear();
      return y === input.year;
    })
    .slice()
    .sort((a, b) => a.date - b.date);

  // positions por ativo (para custo médio)
  const posByAsset = new Map<string, RunningPosition>();

  // buckets por mês e categoria
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

  // 1) Percorre transações do ano em ordem cronológica para gerar ganhos por venda
  for (const t of txs) {
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
      // custo: soma de (qty*price) + fees (quando aplicável)
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

  // 2) Consolida meses do ano (inclusive meses sem movimentação? MVP: só os com movimento)
  const monthsSorted = Array.from(buckets.keys()).sort();

  const lossCarry: Record<TaxCategory, number> = {
    B3_EQUITIES: 0,
    B3_FII: 0,
    CRYPTO: 0,
  };

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

        // isenções
        let isExempt = false;
        let exemptReason: string | undefined;

        if (cat === "B3_EQUITIES") {
          if (salesGross > 0 && salesGross <= config.exemptions.b3EquitiesMonthlySalesLimit) {
            isExempt = true;
            exemptReason = `Vendas no mês <= ${config.exemptions.b3EquitiesMonthlySalesLimit.toLocaleString("pt-BR")} (isento)`;
          }
        }

        if (cat === "CRYPTO") {
          if (salesGross > 0 && salesGross <= config.exemptions.cryptoMonthlySalesLimit) {
            isExempt = true;
            exemptReason = `Vendas no mês <= ${config.exemptions.cryptoMonthlySalesLimit.toLocaleString("pt-BR")} (isento)`;
          }
        }

        // regra MVP: se isento, não calcula imposto; ainda assim pode acumular prejuízo
        let taxableBase = 0;
        let lossUsed = 0;
        let taxDue = 0;

        if (!isExempt) {
          const baseBeforeLoss = netResult;

          if (baseBeforeLoss > 0 && lossCarryIn < 0) {
            const usable = Math.min(baseBeforeLoss, Math.abs(lossCarryIn));
            lossUsed = usable;
            taxableBase = Math.max(0, baseBeforeLoss - usable);
          } else {
            taxableBase = Math.max(0, baseBeforeLoss);
          }

          if (taxableBase > 0) {
            if (cat === "B3_EQUITIES") taxDue = taxableBase * config.rates.b3Equities;
            if (cat === "B3_FII") taxDue = taxableBase * config.rates.b3Fii;
            if (cat === "CRYPTO") taxDue = computeCryptoTax(config.rates.crypto, taxableBase);
          }
        } else {
          // Isento: base tributável e imposto são 0.
          taxableBase = 0;
          taxDue = 0;
        }

        // atualiza lossCarryOut
        // lossCarry é sempre um número <= 0 (prejuízo acumulado)
        // netResult negativo aumenta o prejuízo
        // netResult positivo pode consumir prejuízo (lossUsed)
        let lossCarryOut = lossCarryIn;

        if (!isExempt) {
          // mês tributável: aplica consumo
          lossCarryOut = lossCarryIn + lossUsed;

          // se ainda assim o mês foi negativo, acumula
          if (netResult < 0) lossCarryOut += netResult; // netResult é negativo

          // se mês foi positivo e excedeu prejuízo, lossCarryOut pode ir a 0
          if (lossCarryOut > 0) lossCarryOut = 0;
        } else {
          // mês isento
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
