import type { Asset, Portfolio, Transaction } from "@/types/financial";

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

export interface PortfolioDisplaySnapshot {
  portfoliosWithAssets: PortfolioWithAssets[];
  dataSignature: string;
  quotesUpdatedAt: string | null;
  hasQuoteData?: boolean;
  calculatedAt: number;
}

interface ComputePortfolioSummariesInput {
  portfolios: Portfolio[];
  assets: Asset[];
  transactions: Transaction[];
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

export function computeAssetPositions(transactions: Transaction[]) {
  const map = new Map<string, AssetPosition>();
  const byAsset = new Map<string, Transaction[]>();

  for (const t of transactions) {
    const list = byAsset.get(t.assetId) ?? [];
    list.push(t);
    byAsset.set(t.assetId, list);
  }

  for (const [assetId, txs] of byAsset.entries()) {
    const ordered = [...txs].sort((a, b) => a.date - b.date);
    let shares = 0;
    let cost = 0;

    for (const tx of ordered) {
      const qty = Number(tx.shares ?? 0);
      const total = Number(tx.totalValue ?? 0);
      const fees = Number(tx.fees ?? 0);
      if (!Number.isFinite(qty) || qty === 0) continue;

      if (tx.type === "buy") {
        shares += qty;
        cost += (Number.isFinite(total) ? total : 0) + (Number.isFinite(fees) ? fees : 0);
      } else {
        const avg = shares > 0 ? cost / shares : 0;
        const sellQty = Math.min(shares, qty);
        shares -= sellQty;
        cost -= avg * sellQty;
      }

      if (shares <= HOLDING_EPS) {
        shares = 0;
        cost = 0;
      }
    }

    map.set(assetId, {
      shares,
      openCostBasis: cost,
      averagePrice: shares > 0 ? cost / shares : 0,
    });
  }

  return map;
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

export function buildPortfolioDataSignature(input: {
  portfolios: Portfolio[];
  assets: Asset[];
  transactions: Transaction[];
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

  return `p=${portfolioPart};a=${assetPart};t=${transactionPart}`;
}

export function computePortfolioSummaries({
  portfolios,
  assets,
  transactions,
  quotes = {},
  positionsByAssetId,
}: ComputePortfolioSummariesInput): PortfolioWithAssets[] {
  if (portfolios.length === 0 && assets.length === 0) return [];

  const assetPositions = positionsByAssetId ?? computeAssetPositions(transactions);

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
