/**
 * Import de-duplication helpers.
 *
 * Goal: avoid importing the same movement twice when users re-import a B3 file.
 *
 * We keep the key stable and conservative:
 * - date (ms)
 * - quantity (or shares)
 * - value (money)
 * - plus a scope (asset/portfolio/type) to avoid cross-asset collisions.
 */

const DEFAULT_QTY_PRECISION = 6;

function roundTo(value: number, decimals: number) {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function normalizeMoney(value: number): number {
  // cents
  return roundTo(value, 2);
}

export function normalizeQuantity(value: number, decimals = DEFAULT_QTY_PRECISION): number {
  return roundTo(value, decimals);
}

export function buildImportDedupKey(input: {
  scope: string;
  date: number;
  quantity?: number;
  value: number;
}): string {
  const qty = normalizeQuantity(input.quantity ?? 0);
  const val = normalizeMoney(input.value);
  // Keep as a string key for Set/Map.
  return `${input.scope}|${input.date}|${qty}|${val}`;
}

export function buildImportedMovementFingerprint(input: {
  direction?: string;
  movementType: string;
  productName?: string;
  date: number;
  quantity?: number;
  value: number;
}) {
  const normalize = (value: unknown) =>
    String(value ?? "").trim().toLocaleLowerCase("pt-BR");
  return buildImportDedupKey({
    scope: [
      "b3-movement",
      normalize(input.direction),
      normalize(input.movementType),
      normalize(input.productName),
    ].join(":"),
    date: input.date,
    quantity: input.quantity,
    value: input.value,
  });
}
