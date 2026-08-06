import { describe, expect, it } from "vitest";

import {
  buildLocalPortfolioAnalysis,
  type AiPortfolioHolding,
} from "@/lib/ai-portfolio-analysis";

const baseTotals = {
  currentValue: 100_000,
  totalCost: 90_000,
  totalGain: 10_000,
  totalGainPercent: 11.11,
};

function holding(partial: Partial<AiPortfolioHolding>): AiPortfolioHolding {
  return {
    ticker: partial.ticker ?? "TEST3",
    name: partial.name ?? "Teste",
    type: partial.type ?? "stock",
    portfolioName: partial.portfolioName ?? "Principal",
    currentValue: partial.currentValue ?? 10_000,
    openCostBasis: partial.openCostBasis ?? 9_000,
    gain: partial.gain ?? 1_000,
    gainPercent: partial.gainPercent ?? 11.11,
    currentAllocation: partial.currentAllocation ?? 10,
    targetAllocation: partial.targetAllocation ?? 10,
    allocationGap: partial.allocationGap ?? 0,
    priceChangePercent: partial.priceChangePercent ?? 0,
  };
}

describe("buildLocalPortfolioAnalysis", () => {
  it("distribui aporte entre ativos abaixo do alvo e limita em 5 sugestoes", () => {
    const result = buildLocalPortfolioAnalysis({
      holdings: [
        holding({ ticker: "AAA3", currentAllocation: 5, targetAllocation: 15, allocationGap: 10 }),
        holding({ ticker: "BBB3", currentAllocation: 8, targetAllocation: 14, allocationGap: 6 }),
        holding({ ticker: "CCC3", currentAllocation: 9, targetAllocation: 13, allocationGap: 4 }),
        holding({ ticker: "DDD3", currentAllocation: 3, targetAllocation: 6, allocationGap: 3 }),
        holding({ ticker: "EEE3", currentAllocation: 2, targetAllocation: 4, allocationGap: 2 }),
        holding({ ticker: "FFF3", currentAllocation: 1, targetAllocation: 2, allocationGap: 1 }),
      ],
      totals: baseTotals,
      contributionAmount: 1_000,
    });

    expect(result.suggestions).toHaveLength(5);
    expect(result.suggestions.map((item) => item.ticker)).toEqual(["AAA3", "BBB3", "CCC3", "DDD3", "EEE3"]);
    expect(result.suggestions.reduce((sum, item) => sum + item.suggestedValue, 0)).toBeCloseTo(1_000, 2);
  });

  it("nao sugere aporte para ativo acima do alvo", () => {
    const result = buildLocalPortfolioAnalysis({
      holdings: [
        holding({ ticker: "OVER3", currentAllocation: 20, targetAllocation: 10, allocationGap: -10 }),
        holding({ ticker: "UNDER3", currentAllocation: 5, targetAllocation: 10, allocationGap: 5 }),
      ],
      totals: baseTotals,
      contributionAmount: 500,
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].ticker).toBe("UNDER3");
  });

  it("sinaliza concentracao relevante", () => {
    const result = buildLocalPortfolioAnalysis({
      holdings: [
        holding({ ticker: "BIG3", currentAllocation: 42, targetAllocation: 20, allocationGap: -22 }),
        holding({ ticker: "SMAL3", currentAllocation: 8, targetAllocation: 15, allocationGap: 7 }),
      ],
      totals: baseTotals,
      contributionAmount: 0,
    });

    expect(result.concentration).toEqual({ ticker: "BIG3", allocation: 42 });
    expect(result.diagnostics[0]).toMatchObject({
      severity: "critical",
      ticker: "BIG3",
    });
  });
});
