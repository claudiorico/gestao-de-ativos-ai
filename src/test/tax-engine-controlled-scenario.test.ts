import { describe, expect, it } from "vitest";
import { computeMonthlyApuration } from "../lib/tax-engine";
import type { Asset, Transaction } from "../types/financial";

const portfolioId = "controlled-darf";

function date(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).getTime();
}

function asset(
  id: string,
  ticker: string,
  type: Asset["type"]
): Asset {
  return {
    id,
    portfolioId,
    ticker,
    name: `Cenario controlado ${ticker}`,
    type,
    targetAllocation: 0,
    shares: 0,
    averagePrice: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function trade(input: {
  id: string;
  assetId: string;
  type: Transaction["type"];
  shares: number;
  price: number;
  year: number;
  month: number;
  day: number;
  hour?: number;
  fees?: number;
}): Transaction {
  return {
    id: input.id,
    assetId: input.assetId,
    portfolioId,
    type: input.type,
    shares: input.shares,
    pricePerShare: input.price,
    totalValue: input.shares * input.price,
    fees: input.fees ?? 0,
    date: date(input.year, input.month, input.day, input.hour),
    createdAt: 0,
  };
}

describe("controlled DARF scenario", () => {
  it("calculates exemption, loss carry, ETF, FII and day trade month by month", () => {
    const stockJan = asset("stock-jan", "TSTJ3", "stock");
    const stockLoss = asset("stock-loss", "TSTF3", "stock");
    const stockTaxable = asset("stock-taxable", "TSTM3", "stock");
    const etf = asset("etf", "TEST11", "etf");
    const fii = asset("fii", "TSTF11", "reit");
    const dayTrade = asset("day-trade", "TSTD3", "stock");

    const transactions: Transaction[] = [
      // January: stock sale below R$ 20k, gain R$ 500, exempt.
      trade({ id: "jan-buy", assetId: stockJan.id, type: "buy", shares: 100, price: 10, year: 2025, month: 1, day: 2 }),
      trade({ id: "jan-sell", assetId: stockJan.id, type: "sell", shares: 100, price: 15, year: 2025, month: 1, day: 20 }),

      // February: stock loss R$ 1,000, carried forward.
      trade({ id: "feb-buy", assetId: stockLoss.id, type: "buy", shares: 100, price: 20, year: 2025, month: 2, day: 3 }),
      trade({ id: "feb-sell", assetId: stockLoss.id, type: "sell", shares: 100, price: 10, year: 2025, month: 2, day: 21 }),

      // March: stock sales above R$ 20k, gain R$ 5,000.
      // After February loss: taxable base R$ 4,000, tax R$ 600.
      trade({ id: "mar-buy", assetId: stockTaxable.id, type: "buy", shares: 100, price: 200, year: 2025, month: 3, day: 3 }),
      trade({ id: "mar-sell", assetId: stockTaxable.id, type: "sell", shares: 100, price: 250, year: 2025, month: 3, day: 25 }),

      // April: ETF gain R$ 200, always taxable at 15%.
      trade({ id: "apr-buy", assetId: etf.id, type: "buy", shares: 10, price: 100, year: 2025, month: 4, day: 2 }),
      trade({ id: "apr-sell", assetId: etf.id, type: "sell", shares: 10, price: 120, year: 2025, month: 4, day: 22 }),

      // May: FII gain R$ 200, taxable at 20%.
      trade({ id: "may-buy", assetId: fii.id, type: "buy", shares: 10, price: 100, year: 2025, month: 5, day: 2 }),
      trade({ id: "may-sell", assetId: fii.id, type: "sell", shares: 10, price: 120, year: 2025, month: 5, day: 22 }),

      // June: same-day stock gain R$ 500, day trade at 20%.
      trade({ id: "jun-buy", assetId: dayTrade.id, type: "buy", shares: 100, price: 60, year: 2025, month: 6, day: 5, hour: 10 }),
      trade({ id: "jun-sell", assetId: dayTrade.id, type: "sell", shares: 100, price: 65, year: 2025, month: 6, day: 5, hour: 15 }),
    ];

    const result = computeMonthlyApuration({
      assets: [stockJan, stockLoss, stockTaxable, etf, fii, dayTrade],
      transactions,
      year: 2025,
    });
    const month = new Map(result.months.map((item) => [item.month, item]));

    const january = month.get("2025-01")!.categories.B3_EQUITIES;
    expect(january.netResult).toBe(500);
    expect(january.isExempt).toBe(true);
    expect(january.taxDue).toBe(0);

    const february = month.get("2025-02")!.categories.B3_EQUITIES;
    expect(february.netResult).toBe(-1000);
    expect(february.lossCarryOut).toBe(-1000);
    expect(february.taxDue).toBe(0);

    const march = month.get("2025-03")!.categories.B3_EQUITIES;
    expect(march.netResult).toBe(5000);
    expect(march.lossCarryIn).toBe(-1000);
    expect(march.lossUsed).toBe(1000);
    expect(march.taxableBase).toBe(4000);
    expect(march.taxDue).toBe(600);

    const april = month.get("2025-04")!.categories.B3_EQUITIES;
    expect(april.netResult).toBe(200);
    expect(april.taxableBase).toBe(200);
    expect(april.taxDue).toBe(30);

    const may = month.get("2025-05")!.categories.B3_FII;
    expect(may.netResult).toBe(200);
    expect(may.taxableBase).toBe(200);
    expect(may.taxDue).toBe(40);

    const june = month.get("2025-06")!.categories.B3_EQUITIES;
    expect(june.netResult).toBe(500);
    expect(june.taxableBase).toBe(500);
    expect(june.taxDue).toBe(100);
  });
});
