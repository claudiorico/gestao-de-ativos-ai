import type { Asset, CorporateAction, Portfolio, Transaction } from "@/types/financial";
import { computePositionsWithCorporateActions } from "@/lib/corporate-action-engine";

export interface PortfolioQuote {
  price?: number;
  change?: number;
  changePercent?: number;
}

export interface AssetWithPrice extends Asset {
  openCostBasis: number;
  currentPrice: number;
  currentValue: number;
  gain: number;
  gainPercent: number;
  priceChange: number;
  priceChangePercent: number;
}

export interface PortfolioWithAssets extends Portfolio {
  assets: AssetWithPrice[];
  openCostBasis: number;
  currentValue: number;
  currentAllocation: number;
  totalGain: number;
  totalGainPercent: number;
}

export interface PortfolioDashboardMetrics {
  totalValue: number;
  totalCost: number;
  totalGain: number;
  totalGainPercent: number;
  dayGain: number;
  dayGainPercent: number;
}

export interface PortfolioDisplaySnapshot {
  portfoliosWithAssets: PortfolioWithAssets[];
  dashboardMetrics?: PortfolioDashboardMetrics;
  dataSignature: string;
  quotesUpdatedAt: string | null;
  hasQuoteData?: boolean;
  calculatedAt: number;
}

interface ComputePortfolioSummariesInput {
  portfolios: Portfolio[];
  assets: Asset[];
  transactions: Transaction[];
  corporateActions?: CorporateAction[];
  quotes?: Record<string, PortfolioQuote | undefined>;
  positionsByAssetId?: Map<string, AssetPosition>;
}

const PRICED_ASSET_TYPES: Asset["type"][] = [
  "stock",
  "reit",
  "etf",
  "crypto",
  "investment_fund",
  "fixed_income",
];

const HOLDING_EPS = 1e-8;

export interface AssetPosition {
  shares: number;
  openCostBasis: number;
  averagePrice: number;
}

function normalizeTickerKey(ticker: string) {
  return String(ticker ?? "").trim().toUpperCase();
}

function getQuoteForAsset(
  quotes: Record<string, PortfolioQuote | undefined>,
  ticker: string
) {
  const quoteKey = normalizeTickerKey(ticker);
  return quotes[quoteKey] ?? quotes[quoteKey.replace(/\.SA$/i, "")];
}

export function computeAssetPositions(
  transactions: Transaction[],
  corporateActions: CorporateAction[] = [],
  cutoffDate = Number.POSITIVE_INFINITY
) {
  return computePositionsWithCorporateActions(transactions, corporateActions, cutoffDate);
}

export function isPricedAssetType(type: Asset["type"]) {
  return PRICED_ASSET_TYPES.includes(type);
}

export function computeAssetDayGain(
  asset: Pick<AssetWithPrice, "shares" | "currentPrice" | "priceChangePercent">
) {
  const pct = Number.isFinite(asset.priceChangePercent) ? asset.priceChangePercent : 0;
  if (pct === 0) return 0;

  const previousPrice = asset.currentPrice / (1 + pct / 100);
  const delta = asset.shares * (asset.currentPrice - previousPrice);
  return Number.isFinite(delta) ? delta : 0;
}

export function computePortfolioDashboardMetrics(
  portfoliosWithAssets: PortfolioWithAssets[]
): PortfolioDashboardMetrics {
  let totalValue = 0;
  let totalCost = 0;
  let totalGain = 0;
  let dayGain = 0;

  for (const portfolio of portfoliosWithAssets) {
    totalValue += Number.isFinite(portfolio.currentValue) ? portfolio.currentValue : 0;
    totalGain += Number.isFinite(portfolio.totalGain) ? portfolio.totalGain : 0;
    totalCost += Number.isFinite(portfolio.openCostBasis) ? portfolio.openCostBasis : 0;

    for (const asset of portfolio.assets) {
      dayGain += computeAssetDayGain(asset);
    }
  }

  return {
    totalValue,
    totalCost,
    totalGain,
    totalGainPercent: totalCost > 0 ? (totalGain / totalCost) * 100 : 0,
    dayGain,
    dayGainPercent: totalValue > 0 ? (dayGain / totalValue) * 100 : 0,
  };
}

export function buildPortfolioDataSignature(input: {
  portfolios: Portfolio[];
  assets: Asset[];
  transactions: Transaction[];
  corporateActions?: CorporateAction[];
}) {
  const portfolioPart = input.portfolios
    .map((p) => `${p.id}:${p.updatedAt}`)
    .sort()
    .join("|");
  const assetPart = input.assets
    .map((a) => `${a.id}:${a.updatedAt}`)
    .sort()
    .join("|");
  const transactionPart = input.transactions
    .map((t) => `${t.id}:${t.createdAt}:${t.type}:${t.date}:${t.shares}:${t.pricePerShare}:${t.totalValue}:${t.fees}`)
    .sort()
    .join("|");
  const corporateActionPart = (input.corporateActions ?? [])
    .map((action) =>
      [
        action.id,
        action.status,
        action.type,
        action.date,
        action.assetId,
        action.destinationAssetId ?? "",
        action.ratioNumerator ?? "",
        action.ratioDenominator ?? "",
        action.quantityChange ?? "",
        action.costBasisChange ?? "",
      ].join(":")
    )
    .sort()
    .join("|");

  return `p=${portfolioPart};a=${assetPart};t=${transactionPart};c=${corporateActionPart}`;
}

export function computePortfolioSummaries({
  portfolios,
  assets,
  transactions,
  corporateActions = [],
  quotes = {},
  positionsByAssetId,
}: ComputePortfolioSummariesInput): PortfolioWithAssets[] {
  if (portfolios.length === 0 && assets.length === 0) return [];

  const assetPositions =
    positionsByAssetId ?? computeAssetPositions(transactions, corporateActions);

  const enrichedAssets: AssetWithPrice[] = assets.map((asset) => {
    const position = assetPositions.get(asset.id);
    const effectiveShares = position ? position.shares : asset.shares;
    const effectiveAveragePrice = position ? position.averagePrice : asset.averagePrice;
    const openCostBasis = position
      ? position.openCostBasis
      : effectiveShares * effectiveAveragePrice;
    const quote = getQuoteForAsset(quotes, asset.ticker);

    const quotedPrice =
      Number.isFinite(quote?.price) && (quote?.price ?? 0) > 0
        ? (quote!.price as number)
        : null;
    const currentPrice = quotedPrice ?? effectiveAveragePrice;

    const currentValue = effectiveShares * currentPrice;
    const gain = currentValue - openCostBasis;
    const gainPercent = openCostBasis > 0 ? (gain / openCostBasis) * 100 : 0;

    return {
      ...asset,
      shares: effectiveShares,
      averagePrice: effectiveAveragePrice,
      openCostBasis,
      currentPrice,
      currentValue,
      gain,
      gainPercent,
      priceChange: quote?.change || 0,
      priceChangePercent: quote?.changePercent || 0,
    };
  });

  const totalValue = enrichedAssets.reduce((sum, a) => sum + a.currentValue, 0);
  const isVisibleHolding = (a: AssetWithPrice) =>
    a.shares > HOLDING_EPS || (a.targetAllocation ?? 0) > 0;

  return portfolios.map((portfolio) => {
    const portfolioAssets = enrichedAssets.filter(
      (a) => a.portfolioId === portfolio.id && isVisibleHolding(a)
    );
    const currentValue = portfolioAssets.reduce((sum, a) => sum + a.currentValue, 0);
    const openCostBasis = portfolioAssets.reduce((sum, a) => sum + a.openCostBasis, 0);
    const currentAllocation = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
    const totalGain = currentValue - openCostBasis;
    const totalGainPercent = openCostBasis > 0 ? (totalGain / openCostBasis) * 100 : 0;

    return {
      ...portfolio,
      assets: portfolioAssets,
      openCostBasis,
      currentValue,
      currentAllocation,
      totalGain,
      totalGainPercent,
    };
  });
}
