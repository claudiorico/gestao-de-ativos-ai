import type { CorporateAction, Transaction } from "@/types/financial";

export interface PositionState {
  shares: number;
  openCostBasis: number;
  averagePrice: number;
}

type MutablePosition = { shares: number; cost: number };

function safe(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function getPosition(map: Map<string, MutablePosition>, assetId: string) {
  const existing = map.get(assetId);
  if (existing) return existing;
  const created = { shares: 0, cost: 0 };
  map.set(assetId, created);
  return created;
}

function applyTransaction(map: Map<string, MutablePosition>, transaction: Transaction) {
  const position = getPosition(map, transaction.assetId);
  const quantity = Math.max(0, safe(transaction.shares));

  if (transaction.type === "buy") {
    position.shares += quantity;
    position.cost += Math.max(0, safe(transaction.totalValue)) + Math.max(0, safe(transaction.fees));
    return;
  }

  const soldQuantity = Math.min(position.shares, quantity);
  const averagePrice = position.shares > 0 ? position.cost / position.shares : 0;
  position.shares = Math.max(0, position.shares - soldQuantity);
  position.cost = Math.max(0, position.cost - averagePrice * soldQuantity);
}

function applyCorporateAction(map: Map<string, MutablePosition>, action: CorporateAction) {
  if (action.status !== "applied") return;

  const source = getPosition(map, action.assetId);
  const numerator = safe(action.ratioNumerator);
  const denominator = safe(action.ratioDenominator);
  const ratio = numerator > 0 && denominator > 0 ? numerator / denominator : 0;

  if (action.type === "split" || action.type === "reverse_split") {
    if (ratio > 0) source.shares *= ratio;
    return;
  }

  if (action.type === "bonus" || action.type === "subscription") {
    const quantityIncrease =
      safe(action.quantityChange) > 0
        ? safe(action.quantityChange)
        : ratio > 0
          ? source.shares * ratio
          : 0;
    source.shares += quantityIncrease;
    source.cost = Math.max(0, source.cost + safe(action.costBasisChange));
    return;
  }

  if (action.type === "amortization") {
    const reduction = Math.abs(safe(action.costBasisChange) || safe(action.cashValue));
    source.cost = Math.max(0, source.cost - reduction);
    return;
  }

  if (
    (action.type === "ticker_change" || action.type === "merger") &&
    action.destinationAssetId
  ) {
    const destination = getPosition(map, action.destinationAssetId);
    const sourceSharesBefore = source.shares;
    const sharesToMove =
      safe(action.quantityChange) > 0
        ? Math.min(sourceSharesBefore, safe(action.quantityChange))
        : sourceSharesBefore;
    const costToMove =
      sourceSharesBefore > 0 ? source.cost * (sharesToMove / sourceSharesBefore) : 0;
    const destinationShares = ratio > 0 ? sharesToMove * ratio : sharesToMove;

    source.shares = Math.max(0, source.shares - sharesToMove);
    source.cost = Math.max(0, source.cost - costToMove);
    destination.shares += destinationShares;
    destination.cost += costToMove + safe(action.costBasisChange);
  }
}

export function computePositionsWithCorporateActions(
  transactions: Transaction[],
  corporateActions: CorporateAction[] = [],
  cutoffDate = Number.POSITIVE_INFINITY
): Map<string, PositionState> {
  const positions = new Map<string, MutablePosition>();
  const timeline = [
    ...corporateActions
      .filter((action) => action.status === "applied" && action.date <= cutoffDate)
      .map((action) => ({ date: action.date, priority: 0, action })),
    ...transactions
      .filter((transaction) => transaction.date <= cutoffDate)
      .map((transaction) => ({ date: transaction.date, priority: 1, transaction })),
  ].sort((a, b) => a.date - b.date || a.priority - b.priority);

  for (const entry of timeline) {
    if ("action" in entry) applyCorporateAction(positions, entry.action);
    else applyTransaction(positions, entry.transaction);
  }

  return new Map(
    Array.from(positions.entries()).map(([assetId, position]) => [
      assetId,
      {
        shares: position.shares,
        openCostBasis: position.cost,
        averagePrice: position.shares > 0 ? position.cost / position.shares : 0,
      },
    ])
  );
}

