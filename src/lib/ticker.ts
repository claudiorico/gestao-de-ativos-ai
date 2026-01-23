import type { Asset } from "@/types/financial";

/**
 * Padroniza ticker para armazenamento local.
 * - Remove sufixo Yahoo ".SA" (ex.: HGBS11.SA -> HGBS11)
 * - Remove sufixo de fracionário "F" quando for ticker B3 (ex.: PETR4F -> PETR4)
 * - Para fundos CVM (investment_fund), mantém apenas 14 dígitos (CNPJ)
 */
export function normalizeTickerForStorage(raw: string, type?: Asset["type"]): string {
  const input = String(raw ?? "").trim();
  if (!input) return "";

  if (type === "investment_fund") {
    return input.replace(/\D/g, "").slice(0, 14);
  }

  let t = input.toUpperCase();

  // Remove o sufixo do Yahoo Finance (ativos B3)
  t = t.replace(/\.SA$/i, "");

  // Remove 'F' de fracionário apenas quando for um ticker B3 no padrão <AAAA><d><d?>F
  if (/^[A-Z]{4}\d{1,2}F$/.test(t)) {
    t = t.slice(0, -1);
  }

  return t;
}
