import { describe, expect, it } from "vitest";
import { classifyB3Movement } from "../lib/b3-movement-classifier";

describe("classifyB3Movement", () => {
  it("keeps stock lending custody movements informational", () => {
    const result = classifyB3Movement({
      movementType: "Transferencia - Emprestimo de ativos",
      productName: "PETR4",
      quantity: 100,
      value: 0,
    });

    expect(result.classification).toBe("informational");
  });

  it("recognizes stock lending income", () => {
    const result = classifyB3Movement({
      movementType: "Remuneracao de aluguel",
      productName: "PETR4",
      value: 12.5,
    });

    expect(result.accountingType).toBe("stock_lending");
    expect(result.classification).toBe("accounting");
  });

  it.each(["Reembolso", "Restituição de capital", "restituicao de capital", "Reembolso de capital"])(
    "recognizes %s as a cash refund",
    (movementType) => {
      const result = classifyB3Movement({
        movementType,
        productName: "HGLG11",
        value: 42.5,
      });

      expect(result.accountingType).toBe("cash_refund");
      expect(result.classification).toBe("accounting");
      expect(result.selectedByDefault).toBe(true);
    }
  );

  it.each(["Compra", "Venda", "Resgate", "Transferência"])(
    "recognizes Tesouro %s as a trade",
    (movementType) => {
      const result = classifyB3Movement({
        movementType,
        productName: "Tesouro IPCA+ 2035",
        quantity: 1,
        value: 3200,
      });

      expect(result.accountingType).toBe("trade");
      expect(result.classification).toBe("accounting");
    }
  );

  it.each(["Juros", "Rendimento", "Cupom", "Pagamento de juros"])(
    "recognizes Tesouro %s as yield",
    (movementType) => {
      const result = classifyB3Movement({
        movementType,
        productName: "Tesouro IPCA+ com Juros Semestrais 2035",
        value: 80,
      });

      expect(result.accountingType).toBe("yield");
      expect(result.classification).toBe("accounting");
    }
  );

  it("keeps unknown Tesouro movements pending", () => {
    const result = classifyB3Movement({
      movementType: "Atualização",
      productName: "Tesouro IPCA+ 2035",
      value: 0,
    });

    expect(result.classification).toBe("pending");
    expect(result.selectedByDefault).toBe(false);
  });

  it.each([
    ["Desdobramento", "split"],
    ["Grupamento", "reverse_split"],
    ["Bonificacao em ativos", "bonus"],
    ["Amortizacao", "amortization"],
    ["Direito de subscricao", "subscription"],
    ["Mudanca de ticker", "ticker_change"],
    ["Incorporacao", "merger"],
  ] as const)("recognizes %s as a pending corporate action", (movementType, type) => {
    const result = classifyB3Movement({ movementType, value: 0 });
    expect(result.classification).toBe("pending");
    expect(result.suggestedCorporateActionType).toBe(type);
  });

  it("requires review for unknown movements", () => {
    const result = classifyB3Movement({
      movementType: "Evento especial",
      quantity: 10,
      value: 100,
    });
    expect(result.classification).toBe("pending");
    expect(result.selectedByDefault).toBe(false);
  });
});

