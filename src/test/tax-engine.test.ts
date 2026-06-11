import { describe, it, expect } from "vitest";
import { computeMonthlyApuration } from "../lib/tax-engine";
import type { Asset, Transaction } from "../types/financial";

// Helper to create date timestamps
function dateMs(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
}

describe("Tax Engine", () => {
  const portfolioId = "p1";

  it("should process buys before sells on the same day", () => {
    const asset: Asset = {
      id: "a1",
      portfolioId,
      ticker: "PETR4",
      name: "Petroleo Brasileiro",
      type: "stock",
      targetAllocation: 0,
      shares: 0,
      averagePrice: 0,
      createdAt: 0,
      updatedAt: 0,
    };

    // Venda e compra no mesmo segundo. Se processado venda antes, avisa erro/zera custo.
    const transactions: Transaction[] = [
      {
        id: "t1",
        assetId: "a1",
        portfolioId,
        type: "sell",
        shares: 10,
        pricePerShare: 35.0,
        totalValue: 350.0,
        fees: 0,
        date: dateMs(2025, 1, 10),
        createdAt: 0,
      },
      {
        id: "t2",
        assetId: "a1",
        portfolioId,
        type: "buy",
        shares: 10,
        pricePerShare: 30.0,
        totalValue: 300.0,
        fees: 0,
        date: dateMs(2025, 1, 10),
        createdAt: 0,
      },
    ];

    const result = computeMonthlyApuration({
      assets: [asset],
      transactions,
      year: 2025,
    });

    const monthData = result.months[0]?.categories.B3_EQUITIES;
    expect(monthData).toBeDefined();
    // Se for considerado Day Trade:
    // Compra 10 e venda 10 no mesmo dia = Day Trade de 10 acoes.
    // Lucro de Day Trade: 350 - 300 = 50. Imposto (20%): 10.
    // Nao deve ter avisos de "Venda sem posicao/custo".
    const warnings = monthData.warnings;
    const hasZeroCustodyWarning = warnings.some(w => w.includes("sem posição") || w.includes("custódia"));
    expect(hasZeroCustodyWarning).toBe(false);
  });

  it("should exempt stocks but tax ETFs under 20k sales", () => {
    const stock: Asset = {
      id: "a_stock",
      portfolioId,
      ticker: "PETR4",
      name: "Petroleo Brasileiro",
      type: "stock",
      targetAllocation: 0,
      shares: 0,
      averagePrice: 0,
      createdAt: 0,
      updatedAt: 0,
    };

    const etf: Asset = {
      id: "a_etf",
      portfolioId,
      ticker: "BOVA11",
      name: "Ibovespa ETF",
      type: "etf",
      targetAllocation: 0,
      shares: 0,
      averagePrice: 0,
      createdAt: 0,
      updatedAt: 0,
    };

    const transactions: Transaction[] = [
      // Compra e venda de stock no mês 1
      {
        id: "b1",
        assetId: "a_stock",
        portfolioId,
        type: "buy",
        shares: 100,
        pricePerShare: 10.0,
        totalValue: 1000.0,
        fees: 0,
        date: dateMs(2025, 2, 1),
        createdAt: 0,
      },
      {
        id: "s1",
        assetId: "a_stock",
        portfolioId,
        type: "sell",
        shares: 100,
        pricePerShare: 15.0,
        totalValue: 1500.0, // Venda total < 20k
        fees: 0,
        date: dateMs(2025, 2, 15),
        createdAt: 0,
      },
      // Compra e venda de ETF no mesmo mês 1
      {
        id: "b2",
        assetId: "a_etf",
        portfolioId,
        type: "buy",
        shares: 10,
        pricePerShare: 100.0,
        totalValue: 1000.0,
        fees: 0,
        date: dateMs(2025, 2, 2),
        createdAt: 0,
      },
      {
        id: "s2",
        assetId: "a_etf",
        portfolioId,
        type: "sell",
        shares: 10,
        pricePerShare: 120.0,
        totalValue: 1200.0, // Venda total do mês ainda < 20k
        fees: 0,
        date: dateMs(2025, 2, 20),
        createdAt: 0,
      },
    ];

    const result = computeMonthlyApuration({
      assets: [stock, etf],
      transactions,
      year: 2025,
    });

    const monthData = result.months[0]?.categories.B3_EQUITIES;
    expect(monthData).toBeDefined();

    // Vendas totais da categoria: 1500 (stock) + 1200 (etf) = 2700
    expect(monthData.salesTotalGross).toBe(2700);

    // Ganhos:
    // Stock: 1500 - 1000 = 500 (isento, pois vendas totais de stock = 1500 <= 20000)
    // ETF: 1200 - 1000 = 200 (tributável a 15%)
    // Base tributável: 200 BRL
    // Imposto devido: 200 * 0.15 = 30 BRL
    expect(monthData.taxableBase).toBe(200);
    expect(monthData.taxDue).toBe(30);
  });

  it("should calculate simple Day Trade tax at 20%", () => {
    const asset: Asset = {
      id: "a1",
      portfolioId,
      ticker: "VALE3",
      name: "Vale S.A.",
      type: "stock",
      targetAllocation: 0,
      shares: 0,
      averagePrice: 0,
      createdAt: 0,
      updatedAt: 0,
    };

    // Compras e Vendas de VALE3 no dia 05/03/2025
    const transactions: Transaction[] = [
      {
        id: "t1",
        assetId: "a1",
        portfolioId,
        type: "buy",
        shares: 100,
        pricePerShare: 60.0,
        totalValue: 6000.0,
        fees: 0,
        date: dateMs(2025, 3, 5, 10),
        createdAt: 0,
      },
      {
        id: "t2",
        assetId: "a1",
        portfolioId,
        type: "sell",
        shares: 100,
        pricePerShare: 65.0,
        totalValue: 6500.0,
        fees: 0,
        date: dateMs(2025, 3, 5, 15),
        createdAt: 0,
      },
    ];

    const result = computeMonthlyApuration({
      assets: [asset],
      transactions,
      year: 2025,
    });

    const monthData = result.months[0]?.categories.B3_EQUITIES;
    expect(monthData).toBeDefined();

    // Day Trade lucro: 500. Imposto: 500 * 20% = 100
    expect(monthData.taxDue).toBe(100);
  });

  it("should split partial Day Trade and Swing Trade correctly", () => {
    const asset: Asset = {
      id: "a1",
      portfolioId,
      ticker: "PETR4",
      name: "Petroleo Brasileiro",
      type: "stock",
      targetAllocation: 0,
      shares: 0,
      averagePrice: 0,
      createdAt: 0,
      updatedAt: 0,
    };

    // Situação: usuário já tem 100 PETR4 em carteira com preço médio de R$ 20.
    // No dia 10/04/2025, ele vende 100 PETR4 a R$ 30 e compra 40 PETR4 a R$ 25.
    // Casamento de Day Trade:
    // - 40 PETR4 são Day Trade: venda a R$ 30, compra a R$ 25. Lucro = 40 * (30 - 25) = 200. Imposto DT (20%): 40.
    // - 60 PETR4 são Swing Trade (reduzem a custódia original): venda a R$ 30, custo médio anterior de R$ 20. Lucro = 60 * (30 - 20) = 600.
    // - Supondo que a venda de stock no mês (100 * 30 = 3000) seja <= 20000, o lucro de Swing Trade (600) é ISENTO.
    // - Total imposto do mês = 40 (do DT) + 0 (do ST isento) = 40 BRL.
    // Custódia após a operação: 40 ações de saldo residual (100 inicial - 60 vendidas ST = 40 restantes, PM continua R$ 20).
    const transactions: Transaction[] = [
      // Custódia inicial (compra anterior em outro dia)
      {
        id: "t_init",
        assetId: "a1",
        portfolioId,
        type: "buy",
        shares: 100,
        pricePerShare: 20.0,
        totalValue: 2000.0,
        fees: 0,
        date: dateMs(2025, 4, 1),
        createdAt: 0,
      },
      // Operação do dia 10/04/2025
      {
        id: "t_sell",
        assetId: "a1",
        portfolioId,
        type: "sell",
        shares: 100,
        pricePerShare: 30.0,
        totalValue: 3000.0,
        fees: 0,
        date: dateMs(2025, 4, 10, 15),
        createdAt: 0,
      },
      {
        id: "t_buy",
        assetId: "a1",
        portfolioId,
        type: "buy",
        shares: 40,
        pricePerShare: 25.0,
        totalValue: 1000.0,
        fees: 0,
        date: dateMs(2025, 4, 10, 10),
        createdAt: 0,
      },
    ];

    const result = computeMonthlyApuration({
      assets: [asset],
      transactions,
      year: 2025,
    });

    const monthData = result.months[0]?.categories.B3_EQUITIES;
    expect(monthData).toBeDefined();

    // Imposto esperado: 40 BRL (proveniente apenas do Day Trade de 40 ações)
    expect(monthData.taxDue).toBe(40);
  });
});
