import type {
  CorporateActionType,
  ImportedMovementClassification,
} from "@/types/financial";

export interface B3MovementClassificationInput {
  movementType: string;
  direction?: string;
  productName?: string;
  quantity?: number;
  value?: number;
}

export interface B3MovementClassificationResult {
  classification: ImportedMovementClassification;
  reason: string;
  suggestedCorporateActionType?: CorporateActionType;
  accountingType?: "trade" | "dividend" | "jcp" | "yield" | "stock_lending" | "cash_refund";
  selectedByDefault: boolean;
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

export function classifyB3Movement(
  input: B3MovementClassificationInput
): B3MovementClassificationResult {
  const movement = normalize(input.movementType);
  const product = normalize(input.productName);
  const combined = `${movement} ${product}`;
  const value = Math.abs(Number(input.value) || 0);

  if (
    product.startsWith("tesouro ") &&
    includesAny(movement, ["compra", "venda", "resgate", "transferencia"])
  ) {
    return {
      classification: "accounting",
      accountingType: "trade",
      reason: "Movimentacao de Tesouro Direto identificada.",
      selectedByDefault: true,
    };
  }

  const isLendingIncome =
    includesAny(combined, ["remuneracao", "reembolso de aluguel"]) &&
    includesAny(combined, ["aluguel", "emprestimo", "btc"]);

  if (isLendingIncome && value > 0) {
    return {
      classification: "accounting",
      accountingType: "stock_lending",
      reason: "Remuneracao financeira de aluguel de ativos.",
      selectedByDefault: true,
    };
  }

  if (
    includesAny(combined, [
      "aluguel",
      "emprestimo",
      "btc",
      "doador",
      "tomador",
      "devolucao",
      "bloqueio",
    ])
  ) {
    return {
      classification: "informational",
      reason: "Movimento de custodia ligado a aluguel; nao altera a posicao economica.",
      selectedByDefault: true,
    };
  }

  if (includesAny(movement, ["juros sobre capital", "jcp"])) {
    return {
      classification: "accounting",
      accountingType: "jcp",
      reason: "Provento tributavel identificado.",
      selectedByDefault: true,
    };
  }

  if (movement.includes("dividendo")) {
    return {
      classification: "accounting",
      accountingType: "dividend",
      reason: "Dividendo identificado.",
      selectedByDefault: true,
    };
  }

  if (includesAny(movement, ["rendimento", "rendimentos"])) {
    return {
      classification: "accounting",
      accountingType: "yield",
      reason: "Rendimento identificado.",
      selectedByDefault: true,
    };
  }

  if (movement.includes("reembolso") || movement.includes("restituicao")) {
    return {
      classification: "pending",
      accountingType: "cash_refund",
      suggestedCorporateActionType: "amortization",
      reason: "Pode representar amortizacao de custo ou apenas entrada de caixa.",
      selectedByDefault: false,
    };
  }

  const corporateActions: Array<[string[], CorporateActionType, string]> = [
    [["desdobramento", "desdobro"], "split", "Desdobramento reconhecido; confirme a proporcao."],
    [["grupamento"], "reverse_split", "Grupamento reconhecido; confirme a proporcao."],
    [["bonificacao"], "bonus", "Bonificacao reconhecida; confirme quantidade e custo atribuido."],
    [["amortizacao"], "amortization", "Amortizacao reconhecida; confirme o ajuste de custo."],
    [["subscricao", "direito de subscricao"], "subscription", "Subscricao reconhecida; confirme se houve exercicio."],
    [["mudanca de ticker", "alteracao de codigo"], "ticker_change", "Mudanca de ticker reconhecida; informe o ativo de destino."],
    [["incorporacao", "fusao", "cisao", "conversao"], "merger", "Conversao societaria reconhecida; informe destino e proporcao."],
  ];

  for (const [terms, type, reason] of corporateActions) {
    if (includesAny(combined, terms)) {
      return {
        classification: "pending",
        suggestedCorporateActionType: type,
        reason,
        selectedByDefault: false,
      };
    }
  }

  if (
    includesAny(combined, [
      "transferencia",
      "atualizacao",
      "saldo",
      "deposito de garantia",
      "retirada de garantia",
    ])
  ) {
    return {
      classification: "informational",
      reason: "Registro de custodia sem efeito contabil automatico.",
      selectedByDefault: true,
    };
  }

  if (value === 0 && !(Number(input.quantity) > 0)) {
    return {
      classification: "informational",
      reason: "Linha sem quantidade ou valor contabilizavel.",
      selectedByDefault: true,
    };
  }

  return {
    classification: "pending",
    reason: "Tipo de movimentacao ainda nao reconhecido com seguranca.",
    selectedByDefault: false,
  };
}
