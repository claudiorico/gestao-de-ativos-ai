import { describe, it, expect } from "vitest";
import { rebalanceAssets } from "../lib/rebalancing-engine";

// ---------------------------------------------------------------------------
// WITH_CONTRIBUTION — aloca aporte em ativos subalocados sem vender nada
// ---------------------------------------------------------------------------
describe("rebalancing-engine — WITH_CONTRIBUTION", () => {
  it("compra o ativo subalocado com o caixa disponível", () => {
    const result = rebalanceAssets({
      assets: [{ id: "A", targetPercent: 1, currentQuantity: 0, currentPrice: 10 }],
      availableCash: 50,
      mode: "WITH_CONTRIBUTION",
    });
    const a = result.suggestions.find((s) => s.assetId === "A");
    expect(a?.action).toBe("BUY");
    expect(a?.quantity).toBe(5);
    expect(result.remainingCash).toBe(0);
  });

  it("prioriza o ativo com maior subalocação relativa", () => {
    // Dois ativos zerados, alvo 70%/30%, preço R$ 5, caixa R$ 10 (2 lotes)
    // Gap de A = 70% * 10 = 7 > preço 5 → compra 1 lote de A
    // Após compra de A: gap de B (3) < preço 5 → não compra B
    const result = rebalanceAssets({
      assets: [
        { id: "A", targetPercent: 0.7, currentQuantity: 0, currentPrice: 5 },
        { id: "B", targetPercent: 0.3, currentQuantity: 0, currentPrice: 5 },
      ],
      availableCash: 10,
      mode: "WITH_CONTRIBUTION",
    });
    const a = result.suggestions.find((s) => s.assetId === "A");
    const b = result.suggestions.find((s) => s.assetId === "B");
    expect(a?.action).toBe("BUY");   // A tem maior gap relativo → priorizado
    expect(b?.action).toBe("HOLD");
  });

  it("respeita lotSize e devolve o troco no remainingCash", () => {
    const result = rebalanceAssets({
      assets: [{ id: "A", targetPercent: 1, currentQuantity: 0, currentPrice: 10, lotSize: 100 }],
      availableCash: 1500,
      mode: "WITH_CONTRIBUTION",
    });
    const a = result.suggestions.find((s) => s.assetId === "A");
    expect(a?.quantity).toBe(100);         // 1 lote de 100 = R$ 1000
    expect(result.remainingCash).toBe(500); // 1500 − 1000 = 500 de troco
  });

  it("não faz nada quando o caixa é zero", () => {
    const result = rebalanceAssets({
      assets: [{ id: "A", targetPercent: 1, currentQuantity: 10, currentPrice: 10 }],
      availableCash: 0,
      mode: "WITH_CONTRIBUTION",
    });
    expect(result.suggestions[0]?.action).toBe("HOLD");
    expect(result.remainingCash).toBe(0);
  });

  it("não compra quando o caixa não cobre 1 lote", () => {
    const result = rebalanceAssets({
      assets: [{ id: "A", targetPercent: 1, currentQuantity: 0, currentPrice: 50, lotSize: 10 }],
      availableCash: 499, // < 50 * 10 = 500
      mode: "WITH_CONTRIBUTION",
    });
    expect(result.suggestions[0]?.action).toBe("HOLD");
    expect(result.remainingCash).toBe(499);
  });

  it("aceita lotSize fracionário (Tesouro Direto, passo 0,01)", () => {
    const result = rebalanceAssets({
      assets: [{ id: "TD", targetPercent: 1, currentQuantity: 0, currentPrice: 13_500, lotSize: 0.01 }],
      availableCash: 200,
      mode: "WITH_CONTRIBUTION",
    });
    const td = result.suggestions.find((s) => s.assetId === "TD");
    expect(td?.action).toBe("BUY");
    // 200 / 13500 ≈ 0.01481 → floor(step=0.01) → 0.01
    expect(td?.quantity).toBeCloseTo(0.01, 8);
  });

  it("distribui o aporte entre múltiplos ativos até esgotar o caixa", () => {
    // Dois ativos zerados, alvo 50%/50%, caixa para 3 lotes
    const result = rebalanceAssets({
      assets: [
        { id: "A", targetPercent: 0.5, currentQuantity: 0, currentPrice: 10 },
        { id: "B", targetPercent: 0.5, currentQuantity: 0, currentPrice: 10 },
      ],
      availableCash: 30,
      mode: "WITH_CONTRIBUTION",
    });
    const totalBought =
      (result.suggestions.find((s) => s.assetId === "A")?.quantity ?? 0) +
      (result.suggestions.find((s) => s.assetId === "B")?.quantity ?? 0);
    // Deve usar pelo menos 20 (2 lotes), de preferência tudo
    expect(totalBought).toBeGreaterThanOrEqual(2);
    expect(result.remainingCash).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// REBALANCE_ONLY — vende sobrealocados para comprar subalocados (sem aporte)
// ---------------------------------------------------------------------------
describe("rebalancing-engine — REBALANCE_ONLY", () => {
  it("vende o sobrealocado e compra o subalocado", () => {
    // A tem 80%, alvo 50% — B tem 20%, alvo 50%
    const result = rebalanceAssets({
      assets: [
        { id: "A", targetPercent: 0.5, currentQuantity: 8, currentPrice: 10 },
        { id: "B", targetPercent: 0.5, currentQuantity: 2, currentPrice: 10 },
      ],
      availableCash: 0,
      mode: "REBALANCE_ONLY",
    });
    const a = result.suggestions.find((s) => s.assetId === "A");
    const b = result.suggestions.find((s) => s.assetId === "B");
    expect(a?.action).toBe("SELL");
    expect(b?.action).toBe("BUY");
    expect(a?.quantity).toBe(b?.quantity); // vende X, compra X (mesmo preço)
  });

  it("mantém HOLD quando a carteira já está no alvo", () => {
    const result = rebalanceAssets({
      assets: [
        { id: "A", targetPercent: 0.6, currentQuantity: 6, currentPrice: 10 },
        { id: "B", targetPercent: 0.4, currentQuantity: 4, currentPrice: 10 },
      ],
      availableCash: 0,
      mode: "REBALANCE_ONLY",
    });
    expect(result.suggestions.every((s) => s.action === "HOLD")).toBe(true);
    expect(result.remainingCash).toBe(0);
  });

  it("venda e compra são múltiplos do lotSize", () => {
    // A tem 70, alvo 50% — B tem 30, alvo 50%; lote 10
    const result = rebalanceAssets({
      assets: [
        { id: "A", targetPercent: 0.5, currentQuantity: 70, currentPrice: 1, lotSize: 10 },
        { id: "B", targetPercent: 0.5, currentQuantity: 30, currentPrice: 1, lotSize: 10 },
      ],
      availableCash: 0,
      mode: "REBALANCE_ONLY",
    });
    const a = result.suggestions.find((s) => s.assetId === "A");
    const b = result.suggestions.find((s) => s.assetId === "B");
    expect(a?.action).toBe("SELL");
    expect(b?.action).toBe("BUY");
    expect(a!.quantity % 10).toBe(0);
    expect(b!.quantity % 10).toBe(0);
  });

  it("ignora ativos com preço zero ou inválido", () => {
    const result = rebalanceAssets({
      assets: [
        { id: "INVALIDO", targetPercent: 0.5, currentQuantity: 10, currentPrice: 0 },
        { id: "B", targetPercent: 0.5, currentQuantity: 5, currentPrice: 10 },
      ],
      availableCash: 0,
      mode: "REBALANCE_ONLY",
    });
    const invalido = result.suggestions.find((s) => s.assetId === "INVALIDO");
    expect(invalido).toBeUndefined(); // filtrado na sanitização
  });

  it("patrimônio total se mantém constante (± 1 lote de imprecisão)", () => {
    const assets = [
      { id: "A", targetPercent: 0.4, currentQuantity: 10, currentPrice: 20 },
      { id: "B", targetPercent: 0.3, currentQuantity: 5,  currentPrice: 30 },
      { id: "C", targetPercent: 0.3, currentQuantity: 8,  currentPrice: 15 },
    ];
    const initialTotal = assets.reduce((s, a) => s + a.currentQuantity * a.currentPrice, 0);

    const result = rebalanceAssets({ assets, availableCash: 0, mode: "REBALANCE_ONLY" });

    const finalTotal = assets.reduce((s, a) => {
      const qty = result.finalQuantities[a.id] ?? a.currentQuantity;
      return s + qty * a.currentPrice;
    }, 0);

    // O caixa residual (troco de lote) faz parte do total
    expect(finalTotal + result.remainingCash).toBeCloseTo(initialTotal, 0);
  });
});
