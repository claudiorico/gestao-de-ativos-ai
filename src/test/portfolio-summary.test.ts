import { describe, expect, it } from "vitest";
import { computePortfolioSummaries } from "../lib/portfolio-summary";
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
    expect(asset.currentValue).toBe(160);
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
    expect(asset.currentValue).toBe(60);
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
});
