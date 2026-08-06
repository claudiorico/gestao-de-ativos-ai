export type AiRiskProfile = "conservative" | "balanced" | "growth";
export type AiPortfolioObjective = "rebalance" | "income" | "opportunity";
export type DiagnosticSeverity = "info" | "warning" | "critical";

export interface AiPortfolioHolding {
  ticker: string;
  name: string;
  type: string;
  portfolioName: string;
  currentValue: number;
  openCostBasis: number;
  gain: number;
  gainPercent: number;
  currentAllocation: number;
  targetAllocation: number;
  allocationGap: number;
  priceChangePercent?: number;
}

export interface AiPortfolioTotals {
  currentValue: number;
  totalCost: number;
  totalGain: number;
  totalGainPercent: number;
  totalDividends?: number;
}

export interface PortfolioDiagnostic {
  severity: DiagnosticSeverity;
  title: string;
  description: string;
  ticker?: string;
  value?: number;
}

export interface ContributionSuggestion {
  ticker: string;
  name: string;
  portfolioName: string;
  suggestedValue: number;
  allocationGap: number;
  currentAllocation: number;
  targetAllocation: number;
  rationale: string;
}

export interface LocalPortfolioAnalysis {
  diagnostics: PortfolioDiagnostic[];
  suggestions: ContributionSuggestion[];
  concentration: {
    ticker: string | null;
    allocation: number;
  };
}

export interface BuildLocalPortfolioAnalysisInput {
  holdings: AiPortfolioHolding[];
  totals: AiPortfolioTotals;
  contributionAmount: number;
  maxSuggestions?: number;
}

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value: unknown): number {
  return Math.max(0, finite(value));
}

export function buildLocalPortfolioAnalysis({
  holdings,
  totals,
  contributionAmount,
  maxSuggestions = 5,
}: BuildLocalPortfolioAnalysisInput): LocalPortfolioAnalysis {
  const activeHoldings = holdings
    .map((holding) => ({
      ...holding,
      currentValue: positive(holding.currentValue),
      openCostBasis: positive(holding.openCostBasis),
      currentAllocation: positive(holding.currentAllocation),
      targetAllocation: positive(holding.targetAllocation),
      allocationGap: finite(holding.allocationGap),
      gainPercent: finite(holding.gainPercent),
    }))
    .filter((holding) => holding.currentValue > 0 || holding.targetAllocation > 0);

  const diagnostics: PortfolioDiagnostic[] = [];
  const sortedByAllocation = [...activeHoldings].sort(
    (a, b) => b.currentAllocation - a.currentAllocation,
  );
  const largest = sortedByAllocation[0];

  if (largest) {
    const severity: DiagnosticSeverity =
      largest.currentAllocation >= 35 ? "critical" : largest.currentAllocation >= 20 ? "warning" : "info";
    diagnostics.push({
      severity,
      ticker: largest.ticker,
      value: largest.currentAllocation,
      title: "Maior concentração",
      description: `${largest.ticker} representa ${largest.currentAllocation.toFixed(2)}% do patrimônio acompanhado.`,
    });
  }

  const belowTarget = activeHoldings
    .filter((holding) => holding.targetAllocation > 0 && holding.allocationGap > 0.05)
    .sort((a, b) => b.allocationGap - a.allocationGap);

  if (belowTarget.length > 0) {
    diagnostics.push({
      severity: "info",
      title: "Ativos abaixo do alvo",
      description: `${belowTarget.length} ativo(s) estao abaixo da alocacao alvo informada.`,
    });
  }

  const negativeReturn = activeHoldings
    .filter((holding) => holding.openCostBasis > 0 && holding.gainPercent <= -15)
    .sort((a, b) => a.gainPercent - b.gainPercent)
    .slice(0, 3);

  for (const holding of negativeReturn) {
    diagnostics.push({
      severity: "warning",
      ticker: holding.ticker,
      value: holding.gainPercent,
      title: "Queda relevante no custo",
      description: `${holding.ticker} esta ${holding.gainPercent.toFixed(2)}% abaixo do custo. Vale revisar tese, liquidez e peso antes de aportar mais.`,
    });
  }

  const totalGap = belowTarget
    .slice(0, maxSuggestions)
    .reduce((sum, holding) => sum + Math.max(0, holding.allocationGap), 0);

  const cash = positive(contributionAmount);
  const suggestions =
    cash > 0 && totalGap > 0
      ? belowTarget.slice(0, maxSuggestions).map((holding) => ({
          ticker: holding.ticker,
          name: holding.name,
          portfolioName: holding.portfolioName,
          suggestedValue: Math.round((cash * (holding.allocationGap / totalGap)) * 100) / 100,
          allocationGap: holding.allocationGap,
          currentAllocation: holding.currentAllocation,
          targetAllocation: holding.targetAllocation,
          rationale: "Aporte proporcional ao desvio positivo em relacao ao alvo informado.",
        }))
      : [];

  const roundedTotal = suggestions.reduce((sum, item) => sum + item.suggestedValue, 0);
  if (suggestions.length > 0) {
    const diff = Math.round((cash - roundedTotal) * 100) / 100;
    suggestions[0].suggestedValue = Math.max(0, Math.round((suggestions[0].suggestedValue + diff) * 100) / 100);
  }

  if (diagnostics.length === 0 && totals.currentValue > 0) {
    diagnostics.push({
      severity: "info",
      title: "Carteira sem alertas fortes",
      description: "Nao encontrei concentracao ou desvio grande usando as regras locais.",
    });
  }

  return {
    diagnostics,
    suggestions,
    concentration: {
      ticker: largest?.ticker ?? null,
      allocation: largest?.currentAllocation ?? 0,
    },
  };
}
