/// <reference lib="webworker" />

import type { Asset, Portfolio, Transaction } from "@/types/financial";
import {
  computePortfolioSummaries,
  isPricedAssetType,
  type PortfolioQuote,
  type PortfolioWithAssets,
} from "@/lib/portfolio-summary";

interface PortfolioSummaryWorkerRequest {
  requestId: number;
  portfolios: Portfolio[];
  assets: Asset[];
  transactions: Transaction[];
  quotes: Record<string, PortfolioQuote | undefined>;
}

interface PortfolioSummaryWorkerResponse {
  requestId: number;
  portfoliosWithAssets: PortfolioWithAssets[];
  pricedTickers: string[];
  hasQuoteData: boolean;
}

function normalizeTickerKey(ticker: string) {
  return String(ticker ?? "").trim().toUpperCase();
}

function getQuoteForTicker(quotes: Record<string, PortfolioQuote | undefined>, ticker: string) {
  const key = normalizeTickerKey(ticker);
  return quotes[key] ?? quotes[key.replace(/\.SA$/i, "")];
}

self.onmessage = (event: MessageEvent<PortfolioSummaryWorkerRequest>) => {
  const { requestId, portfolios, assets, transactions, quotes } = event.data;

  const portfoliosWithAssets = computePortfolioSummaries({
    portfolios,
    assets,
    transactions,
    quotes,
  });

  const pricedTickers = Array.from(
    new Set(
      portfoliosWithAssets
        .flatMap((portfolio) => portfolio.assets)
        .filter((asset) => asset.shares > 1e-8 && isPricedAssetType(asset.type))
        .map((asset) => asset.ticker)
        .filter(Boolean)
    )
  );

  const hasQuoteData =
    pricedTickers.length === 0 ||
    pricedTickers.every((ticker) => !!getQuoteForTicker(quotes, ticker));

  const response: PortfolioSummaryWorkerResponse = {
    requestId,
    portfoliosWithAssets,
    pricedTickers,
    hasQuoteData,
  };

  self.postMessage(response);
};
