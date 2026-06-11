import { describe, it, expect } from "vitest";
import { tesouroTickerToName, isCeiArtifactName } from "../lib/ticker";

describe("tesouroTickerToName", () => {
  it("Tesouro IPCA+ sem juros semestrais", () => {
    expect(tesouroTickerToName("IPCA2035")).toBe("Tesouro IPCA+ 2035");
    expect(tesouroTickerToName("IPCA2030")).toBe("Tesouro IPCA+ 2030");
  });

  it("Tesouro IPCA+ com sufixo JUROS", () => {
    expect(tesouroTickerToName("IPCA2045JUROS")).toBe("Tesouro IPCA+ com Juros Semestrais 2045");
    expect(tesouroTickerToName("IPCA2035JUROS")).toBe("Tesouro IPCA+ com Juros Semestrais 2035");
  });

  it("Tesouro IPCA+ formato longo com data e sufixo :JUROS", () => {
    expect(tesouroTickerToName("TD:IPCA2035-08-15:JUROS")).toBe("Tesouro IPCA+ com Juros Semestrais 2035");
    expect(tesouroTickerToName("TD:IPCA2029-05-15:JUROS")).toBe("Tesouro IPCA+ com Juros Semestrais 2029");
  });

  it("Tesouro Prefixado (PRE) sem juros", () => {
    expect(tesouroTickerToName("PRE2035")).toBe("Tesouro Prefixado 2035");
    expect(tesouroTickerToName("PREF2026")).toBe("Tesouro Prefixado 2026");
  });

  it("Tesouro Prefixado com juros semestrais", () => {
    expect(tesouroTickerToName("PRE2035JUROS")).toBe("Tesouro Prefixado com Juros Semestrais 2035");
    expect(tesouroTickerToName("PREF2026JUROS")).toBe("Tesouro Prefixado com Juros Semestrais 2026");
  });

  it("Tesouro Selic", () => {
    expect(tesouroTickerToName("SELIC2029")).toBe("Tesouro Selic 2029");
    expect(tesouroTickerToName("TDSELIC2031")).toBe("Tesouro Selic 2031");
  });

  it("retorna null para tickers não-Tesouro", () => {
    expect(tesouroTickerToName("PETR4")).toBeNull();
    expect(tesouroTickerToName("BOVA11")).toBeNull();
    expect(tesouroTickerToName("MXRF11")).toBeNull();
    expect(tesouroTickerToName("BTC")).toBeNull();
  });

  it("é case-insensitive", () => {
    expect(tesouroTickerToName("ipca2035")).toBe("Tesouro IPCA+ 2035");
    expect(tesouroTickerToName("selic2029")).toBe("Tesouro Selic 2029");
  });

  it("não quebra com entrada vazia ou nula", () => {
    expect(tesouroTickerToName("")).toBeNull();
    expect(tesouroTickerToName(null as unknown as string)).toBeNull();
  });
});

describe("isCeiArtifactName", () => {
  it("detecta CEI-MOVIMENTAÇÃO (variações de caixa)", () => {
    expect(isCeiArtifactName("CEI-MOVIMENTAÇÃO")).toBe(true);
    expect(isCeiArtifactName("cei-movimentação")).toBe(true);
    expect(isCeiArtifactName("CEI-MOVIMENTAÇÃO ")).toBe(true); // espaço extra no início/fim
  });

  it("detecta MOVIMENTAÇÃO puro", () => {
    expect(isCeiArtifactName("MOVIMENTAÇÃO")).toBe(true);
  });

  it("detecta qualquer prefixo CEI-", () => {
    expect(isCeiArtifactName("CEI-ALGUMA COISA")).toBe(true);
    expect(isCeiArtifactName("CEI-OUTRO")).toBe(true);
  });

  it("não detecta nomes reais de ativos", () => {
    expect(isCeiArtifactName("Tesouro Selic 2029")).toBe(false);
    expect(isCeiArtifactName("PETR4")).toBe(false);
    expect(isCeiArtifactName("Petroleo Brasileiro")).toBe(false);
    expect(isCeiArtifactName("BOVA11")).toBe(false);
  });

  it("não quebra com entrada vazia ou nula", () => {
    expect(isCeiArtifactName("")).toBe(false);
    expect(isCeiArtifactName(null as unknown as string)).toBe(false);
  });
});
