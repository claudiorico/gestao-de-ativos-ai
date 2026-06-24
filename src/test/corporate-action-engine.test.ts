import { describe, expect, it } from "vitest";
import { computePositionsWithCorporateActions } from "../lib/corporate-action-engine";
import type { CorporateAction, Transaction } from "../types/financial";

const buy: Transaction = {
  id: "buy-1",
  assetId: "asset-a",
  portfolioId: "portfolio",
  type: "buy",
  shares: 100,
  pricePerShare: 10,
  totalValue: 1000,
  fees: 0,
  date: 1,
  createdAt: 1,
};

function action(overrides: Partial<CorporateAction>): CorporateAction {
  return {
    id: "action-1",
    portfolioId: "portfolio",
    assetId: "asset-a",
    type: "split",
    date: 2,
    ratioNumerator: 2,
    ratioDenominator: 1,
    status: "applied",
    createdAt: 2,
    ...overrides,
  };
}

describe("computePositionsWithCorporateActions", () => {
  it("preserves total cost through a split", () => {
    const positions = computePositionsWithCorporateActions([buy], [action({})]);
    expect(positions.get("asset-a")).toEqual({
      shares: 200,
      openCostBasis: 1000,
      averagePrice: 5,
    });
  });

  it("preserves total cost through a reverse split", () => {
    const positions = computePositionsWithCorporateActions(
      [buy],
      [action({ type: "reverse_split", ratioNumerator: 1, ratioDenominator: 10 })]
    );
    expect(positions.get("asset-a")?.shares).toBe(10);
    expect(positions.get("asset-a")?.openCostBasis).toBe(1000);
  });

  it("adds bonus shares and assigned cost", () => {
    const positions = computePositionsWithCorporateActions(
      [buy],
      [action({ type: "bonus", quantityChange: 10, costBasisChange: 50 })]
    );
    expect(positions.get("asset-a")?.shares).toBe(110);
    expect(positions.get("asset-a")?.openCostBasis).toBe(1050);
  });

  it("reduces cost basis for amortization", () => {
    const positions = computePositionsWithCorporateActions(
      [buy],
      [action({ type: "amortization", costBasisChange: 200 })]
    );
    expect(positions.get("asset-a")?.openCostBasis).toBe(800);
  });

  it("moves quantity and cost to a destination asset", () => {
    const positions = computePositionsWithCorporateActions(
      [buy],
      [
        action({
          type: "merger",
          destinationAssetId: "asset-b",
          ratioNumerator: 1,
          ratioDenominator: 2,
        }),
      ]
    );
    expect(positions.get("asset-a")?.shares).toBe(0);
    expect(positions.get("asset-b")).toEqual({
      shares: 50,
      openCostBasis: 1000,
      averagePrice: 20,
    });
  });

  it("ignores pending actions", () => {
    const positions = computePositionsWithCorporateActions(
      [buy],
      [action({ status: "pending", ratioNumerator: 10 })]
    );
    expect(positions.get("asset-a")?.shares).toBe(100);
  });
});
