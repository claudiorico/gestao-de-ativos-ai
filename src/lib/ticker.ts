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

/**
 * Converte um ticker de Tesouro Direto de volta ao nome legível.
 * Suporta todos os formatos gerados pelo importer:
 *   IPCA2035, IPCA2035JUROS, IPCA2035J, TD:IPCA2035-08-15:JUROS
 *   PRE2035, PREF2035, PRE2035JUROS, TD:PRE2035-01-01:JUROS
 *   SELIC2029, TDSELIC2029, TD:SELIC2029
 */
export function tesouroTickerToName(ticker: string): string | null {
  // Remove o prefixo "TD:" (formato com dois pontos gerado pelo importador B3)
  const t = String(ticker ?? "").trim().toUpperCase().replace(/^TD:/i, "");

  // Tesouro Selic: SELIC2029, TDSELIC2029
  const s = t.match(/^(?:TD)?SELIC(\d{4})/);
  if (s) return `Tesouro Selic ${s[1]}`;

  // Tesouro IPCA+: IPCA2035, IPCA2045JUROS, IPCA2035J, IPCA2035-08-15:JUROS
  const i = t.match(/^IPCA(\d{4})(?:-\d{2}-\d{2})?[:-]?(JUROS|J)?/);
  if (i) {
    return i[2]
      ? `Tesouro IPCA+ com Juros Semestrais ${i[1]}`
      : `Tesouro IPCA+ ${i[1]}`;
  }

  // Tesouro Prefixado: PRE2035, PREF2026, PRE2035JUROS, PREF2026J, PRE2035-01-01:JUROS
  const p = t.match(/^PRE(?:F)?(\d{4})(?:-\d{2}-\d{2})?[:-]?(JUROS|J)?/);
  if (p) {
    return p[2]
      ? `Tesouro Prefixado com Juros Semestrais ${p[1]}`
      : `Tesouro Prefixado ${p[1]}`;
  }

  return null;
}

/** Retorna true quando o nome é um artefato do CEI/B3 sem valor descritivo. */
export function isCeiArtifactName(name: string): boolean {
  const n = String(name ?? "").trim().toUpperCase();
  return n === "CEI-MOVIMENTAÇÃO" || n === "MOVIMENTAÇÃO" || n.startsWith("CEI-");
}
