import { describe, expect, it } from "vitest";
import {
  computeAssetDayGain,
  computePortfolioDashboardMetrics,
  computePortfolioSummaries,
} from "../lib/portfolio-summary";
import type { Asset, Portfolio, Transaction } from "../types/financial";

const portfolio: Portfolio = {
  id: "p1",
  name: "Carteira",
  targetAllocation: 100,
  color: "#16a34a",
  createdAt: 1,
  updatedAt: 1,
};

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    portfolioId: portfolio.id,
    ticker: "TEST3",
    name: "Teste",
    type: "stock",
    targetAllocation: 100,
    shares: 10,
    averagePrice: 20,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: "t1",
    assetId: "a1",
    portfolioId: portfolio.id,
    type: "buy",
    shares: 1,
    pricePerShare: 10,
    totalValue: 10,
    fees: 0,
    date: 1,
    createdAt: 1,
    ...overrides,
  };
}

describe("portfolio-summary", () => {
  it("uses manual shares and average price when an asset has no transactions", () => {
    const result = computePortfolioSummaries({
      portfolios: [portfolio],
      assets: [makeAsset({ shares: 7, averagePrice: 11 })],
      transactions: [],
    });

    const asset = result[0].assets[0];
    expect(asset.shares).toBe(7);
    expect(asset.averagePrice).toBe(11);
    expect(asset.currentValue).toBe(77);
    expect(result[0].currentValue).toBe(77);
  });

  it("uses transactions as the source of truth when they exist", () => {
    const result = computePortfolioSummaries({
      portfolios: [portfolio],
      assets: [makeAsset({ shares: 999, averagePrice: 1 })],
      transactions: [
        makeTransaction({ id: "t1", shares: 4, pricePerShare: 10, totalValue: 40 }),
        makeTransaction({ id: "t2", shares: 6, pricePerShare: 20, totalValue: 120 }),
      ],
    });

    const asset = result[0].assets[0];
    expect(asset.shares).toBe(10);
    expect(asset.averagePrice).toBe(16);
    expect(asset.openCostBasis).toBe(160);
    expect(asset.currentValue).toBe(160);
  });

  it("adds buy fees to the open cost basis and average price", () => {
    const result = computePortfolioSummaries({
      portfolios: [portfolio],
      assets: [makeAsset({ shares: 999, averagePrice: 1 })],
      transactions: [
        makeTransaction({ id: "t1", shares: 10, pricePerShare: 10, totalValue: 100, fees: 5 }),
      ],
      quotes: { TEST3: { price: 12 } },
    });

    const asset = result[0].assets[0];
    expect(asset.shares).toBe(10);
    expect(asset.openCostBasis).toBe(105);
    expect(asset.averagePrice).toBe(10.5);
    expect(asset.currentValue).toBe(120);
    expect(asset.gain).toBe(15);
  });

  it("reduces quantity and keeps weighted average cost after a partial sell", () => {
    const result = computePortfolioSummaries({
      portfolios: [portfolio],
      assets: [makeAsset({ shares: 999, averagePrice: 1 })],
      transactions: [
        makeTransaction({ id: "t1", shares: 10, pricePerShare: 10, totalValue: 100, date: 1 }),
        makeTransaction({ id: "t2", shares: 4, pricePerShare: 30, totalValue: 120, type: "sell", date: 2 }),
      ],
    });

    const asset = result[0].assets[0];
    expect(asset.shares).toBe(6);
    expect(asset.averagePrice).toBe(10);
    expect(asset.openCostBasis).toBe(60);
    expect(asset.currentValue).toBe(60);
  });

  it("keeps realized sell gain out of the open position gain", () => {
    const result = computePortfolioSummaries({
      portfolios: [portfolio],
      assets: [makeAsset({ shares: 999, averagePrice: 1 })],
      transactions: [
        makeTransaction({ id: "t1", shares: 10, pricePerShare: 10, totalValue: 100, date: 1 }),
        makeTransaction({ id: "t2", shares: 5, pricePerShare: 30, totalValue: 150, type: "sell", date: 2 }),
      ],
      quotes: { TEST3: { price: 10 } },
    });

    const asset = result[0].assets[0];
    expect(asset.shares).toBe(5);
    expect(asset.openCostBasis).toBe(50);
    expect(asset.currentValue).toBe(50);
    expect(asset.gain).toBe(0);
    expect(result[0].totalGain).toBe(0);
  });

  it("does not inflate patrimony for a fully sold asset without target allocation", () => {
    const result = computePortfolioSummaries({
      portfolios: [portfolio],
      assets: [makeAsset({ shares: 999, averagePrice: 1, targetAllocation: 0 })],
      transactions: [
        makeTransaction({ id: "t1", shares: 10, pricePerShare: 10, totalValue: 100, date: 1 }),
        makeTransaction({ id: "t2", shares: 10, pricePerShare: 20, totalValue: 200, type: "sell", date: 2 }),
      ],
    });

    expect(result[0].assets).toHaveLength(0);
    expect(result[0].currentValue).toBe(0);
    expect(result[0].openCostBasis).toBe(0);
    expect(result[0].totalGain).toBe(0);
  });

  it("uses quotes for current price but keeps average price as cost basis", () => {
    const result = computePortfolioSummaries({
      portfolios: [portfolio],
      assets: [makeAsset({ shares: 5, averagePrice: 10 })],
      transactions: [],
      quotes: {
        TEST3: {
          price: 15,
          change: 2,
          changePercent: 3,
        },
      },
    });

    const asset = result[0].assets[0];
    expect(asset.currentPrice).toBe(15);
    expect(asset.averagePrice).toBe(10);
    expect(asset.currentValue).toBe(75);
    expect(asset.gain).toBe(25);
    expect(asset.priceChange).toBe(2);
    expect(asset.priceChangePercent).toBe(3);
  });

  it("calculates day gain from changePercent, not from the absolute change value", () => {
    const result = computePortfolioSummaries({
      portfolios: [portfolio],
      assets: [makeAsset({ shares: 10, averagePrice: 80 })],
      transactions: [],
      quotes: {
        TEST3: {
          price: 100,
          change: 50,
          changePercent: 10,
        },
      },
    });

    const asset = result[0].assets[0];
    expect(computeAssetDayGain(asset)).toBeCloseTo(90.909, 3);
  });

  it("builds stable dashboard metrics from the calculated portfolios", () => {
    const result = computePortfolioSummaries({
      portfolios: [portfolio],
      assets: [makeAsset({ shares: 10, averagePrice: 80 })],
      transactions: [],
      quotes: {
        TEST3: {
          price: 100,
          change: 50,
          changePercent: 10,
        },
      },
    });

    const metrics = computePortfolioDashboardMetrics(result);
    expect(metrics.totalValue).toBe(1000);
    expect(metrics.totalCost).toBe(800);
    expect(metrics.totalGain).toBe(200);
    expect(metrics.totalGainPercent).toBe(25);
    expect(metrics.dayGain).toBeCloseTo(90.909, 3);
    expect(metrics.dayGainPercent).toBeCloseTo(9.0909, 3);
  });
});
