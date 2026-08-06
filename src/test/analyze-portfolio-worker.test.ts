import { describe, expect, it } from "vitest";

import { handleAnalyzePortfolio } from "../../cloudflare/analyze-portfolio";

const env = {
  ALLOWED_ORIGIN_HOSTS: "cofreinvestimentos.com.br,localhost",
  AI_ANALYSIS_EMAILS: "claudiorico81@gmail.com",
};

function request(body: unknown, origin = "https://cofreinvestimentos.com.br") {
  return new Request("https://worker.test/analyze-portfolio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  userEmail: "claudiorico81@gmail.com",
  contributionAmount: 1000,
  riskProfile: "balanced",
  objective: "rebalance",
  includeAi: false,
  totals: {
    currentValue: 100000,
    totalCost: 90000,
    totalGain: 10000,
    totalGainPercent: 11.11,
  },
  holdings: [
    {
      ticker: "AAA3",
      name: "AAA",
      type: "stock",
      portfolioName: "Principal",
      currentValue: 5000,
      openCostBasis: 4500,
      gain: 500,
      gainPercent: 11.11,
      currentAllocation: 5,
      targetAllocation: 15,
      allocationGap: 10,
    },
    {
      ticker: "BBB3",
      name: "BBB",
      type: "stock",
      portfolioName: "Principal",
      currentValue: 20000,
      openCostBasis: 21000,
      gain: -1000,
      gainPercent: -4.76,
      currentAllocation: 20,
      targetAllocation: 10,
      allocationGap: -10,
    },
  ],
};

describe("handleAnalyzePortfolio", () => {
  it("bloqueia origem nao autorizada sem api key", async () => {
    const response = await handleAnalyzePortfolio(
      request(validPayload, "https://malicious.example"),
      env,
    );

    expect(response.status).toBe(401);
  });

  it("bloqueia email fora da allowlist", async () => {
    const response = await handleAnalyzePortfolio(
      request({ ...validPayload, userEmail: "outro@example.com" }),
      env,
    );

    expect(response.status).toBe(403);
  });

  it("gera diagnostico local e sugestao de aporte", async () => {
    const response = await handleAnalyzePortfolio(request(validPayload), env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.local.suggestions).toHaveLength(1);
    expect(data.local.suggestions[0]).toMatchObject({
      ticker: "AAA3",
      suggestedValue: 1000,
    });
    expect(data.ai).toBeNull();
  });

  it("informa indisponibilidade quando IA e pedida sem OPENAI_API_KEY", async () => {
    const response = await handleAnalyzePortfolio(
      request({ ...validPayload, includeAi: true }),
      env,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ai).toBeNull();
    expect(data.aiUnavailable).toContain("OpenAI");
  });
});
