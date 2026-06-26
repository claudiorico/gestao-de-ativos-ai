import { describe, expect, it } from "vitest";
import { buildImportedMovementFingerprint } from "../lib/import-dedup";

describe("imported movement deduplication", () => {
  it("creates the same fingerprint for an identical reimport", () => {
    const input = {
      direction: "Credito",
      movementType: "Remuneracao de aluguel",
      productName: "PETR4",
      date: new Date(2026, 0, 15, 12).getTime(),
      quantity: 100,
      value: 12.5,
    };

    expect(buildImportedMovementFingerprint(input)).toBe(
      buildImportedMovementFingerprint({ ...input })
    );
  });

  it("distinguishes movements with a different economic value", () => {
    const base = {
      direction: "Credito",
      movementType: "Dividendo",
      productName: "PETR4",
      date: new Date(2026, 0, 15, 12).getTime(),
      quantity: 100,
      value: 50,
    };

    expect(buildImportedMovementFingerprint(base)).not.toBe(
      buildImportedMovementFingerprint({ ...base, value: 60 })
    );
  });
});
