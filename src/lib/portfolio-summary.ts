import type { Asset, Portfolio, Transaction } from "@/types/financial";

export interface PortfolioQuote {
  price?: number;
  change?: number;
  changePercent?: number;
}

export interface AssetWithPrice extends Asset {
  currentPrice: number;
  currentValue: number;
  gain: number;
  gainPercent: number;
  priceChange: number;
  priceChangePercent: number;
}

export interface PortfolioWithAssets extends Portfolio {
  assets: AssetWithPrice[];
  currentValue: number;
  currentAllocation: number;
  totalGain: number;
  totalGainPercent: number;
}

export interface PortfolioDisplaySnapshot {
  portfoliosWithAssets: PortfolioWithAssets[];
  dataSignature: string;
  quotesUpdatedAt: string | null;
  calculatedAt: number;
}

interface ComputePortfolioSummariesInput {
  portfolios: Portfolio[];
  assets: Asset[];
  transactions: Transaction[];
  quotes?: Record<string, PortfolioQuote | undefined>;
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

function computeDerivedHoldings(transactions: Transaction[]) {
  const map = new Map<string, { shares: number; averagePrice: number }>();
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
      if (!Number.isFinite(qty) || qty === 0) continue;

      if (tx.type === "buy") {
        shares += qty;
        cost += total;
      } else {
        const avg = shares > 0 ? cost / shares : 0;
        const sellQty = Math.min(shares, qty);
        shares -= sellQty;
        cost -= avg * sellQty;
      }
    }

    map.set(assetId, { shares, averagePrice: shares > 0 ? cost / shares : 0 });
  }

  return map;
}

export function isPricedAssetType(type: Asset["type"]) {
  return PRICED_ASSET_TYPES.includes(type);
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
    .map((t) => `${t.id}:${t.createdAt}:${t.date}:${t.shares}:${t.totalValue}`)
    .sort()
    .join("|");

  return `p=${portfolioPart};a=${assetPart};t=${transactionPart}`;
}

export function computePortfolioSummaries({
  portfolios,
  assets,
  transactions,
  quotes = {},
}: ComputePortfolioSummariesInput): PortfolioWithAssets[] {
  if (portfolios.length === 0 && assets.length === 0) return [];

  const derivedHoldingsByAssetId = computeDerivedHoldings(transactions);

  const enrichedAssets: AssetWithPrice[] = assets.map((asset) => {
    const derived = derivedHoldingsByAssetId.get(asset.id);
    const effectiveShares = derived ? derived.shares : asset.shares;
    const effectiveAveragePrice = derived ? derived.averagePrice : asset.averagePrice;
    const quote = getQuoteForAsset(quotes, asset.ticker);

    const quotedPrice =
      Number.isFinite(quote?.price) && (quote?.price ?? 0) > 0
        ? (quote!.price as number)
        : null;
    const currentPrice = quotedPrice ?? effectiveAveragePrice;

    const currentValue = effectiveShares * currentPrice;
    const costBasis = effectiveShares * effectiveAveragePrice;
    const gain = currentValue - costBasis;
    const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0;

    return {
      ...asset,
      shares: effectiveShares,
      averagePrice: effectiveAveragePrice,
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
    const costBasis = portfolioAssets.reduce((sum, a) => sum + a.shares * a.averagePrice, 0);
    const currentAllocation = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
    const totalGain = currentValue - costBasis;
    const totalGainPercent = costBasis > 0 ? (totalGain / costBasis) * 100 : 0;

    return {
      ...portfolio,
      assets: portfolioAssets,
      currentValue,
      currentAllocation,
      totalGain,
      totalGainPercent,
    };
  });
}
