type WorkerEnv = Record<string, string | undefined>;

type DiagnosticSeverity = "info" | "warning" | "critical";
type AiRiskProfile = "conservative" | "balanced" | "growth";
type AiPortfolioObjective = "rebalance" | "income" | "opportunity";

interface AiPortfolioHolding {
  ticker: string;
  name: string;
  type: string;
  portfolioName: string;
  currentValue: number;
  openCostBasis: number;
  gain: number;
  gainPercent: number;
  currentAllocation: number;
  targetAllocation: number;
  allocationGap: number;
  priceChangePercent?: number;
}

interface AiPortfolioTotals {
  currentValue: number;
  totalCost: number;
  totalGain: number;
  totalGainPercent: number;
  totalDividends?: number;
}

interface AnalyzePortfolioBody {
  userEmail?: string;
  contributionAmount?: number;
  riskProfile?: AiRiskProfile;
  objective?: AiPortfolioObjective;
  includeAi?: boolean;
  holdings?: AiPortfolioHolding[];
  totals?: AiPortfolioTotals;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const DEFAULT_AI_ANALYSIS_EMAILS = [
  "claudiorico81@gmail.com",
  "claudiorico81@hotmail.com",
];

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      ...(init.headers ?? {}),
    },
  });
}

function splitList(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getAllowedHosts(env: WorkerEnv): string[] {
  return splitList(env.ALLOWED_ORIGIN_HOSTS);
}

function isFromAllowedOrigin(req: Request, env: WorkerEnv): boolean {
  const origin = (req.headers.get("origin") ?? "").trim();
  if (!origin) return false;

  try {
    const host = new URL(origin).hostname.toLowerCase();
    const allowed = getAllowedHosts(env);
    return allowed.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
  } catch {
    return false;
  }
}

function hasValidApiKey(req: Request, env: WorkerEnv): boolean {
  const expected = String(env.EDGE_FUNCTIONS_API_KEY ?? "").trim();
  if (!expected) return false;
  return (req.headers.get("x-api-key") ?? "").trim() === expected;
}

function isAllowedAiUser(email: string | undefined, env: WorkerEnv): boolean {
  if (!email) return false;
  const configured = splitList(env.AI_ANALYSIS_EMAILS);
  const allowed = configured.length > 0 ? configured : DEFAULT_AI_ANALYSIS_EMAILS;
  return allowed.includes(email.trim().toLowerCase());
}

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value: unknown): number {
  return Math.max(0, finite(value));
}

function sanitizeHolding(holding: AiPortfolioHolding): AiPortfolioHolding {
  return {
    ticker: String(holding.ticker ?? "").trim().toUpperCase().slice(0, 24),
    name: String(holding.name ?? "").trim().slice(0, 80),
    type: String(holding.type ?? "").trim().slice(0, 32),
    portfolioName: String(holding.portfolioName ?? "").trim().slice(0, 80),
    currentValue: positive(holding.currentValue),
    openCostBasis: positive(holding.openCostBasis),
    gain: finite(holding.gain),
    gainPercent: finite(holding.gainPercent),
    currentAllocation: positive(holding.currentAllocation),
    targetAllocation: positive(holding.targetAllocation),
    allocationGap: finite(holding.allocationGap),
    priceChangePercent: finite(holding.priceChangePercent),
  };
}

function buildLocalAnalysis(holdings: AiPortfolioHolding[], totals: AiPortfolioTotals, contributionAmount: number) {
  const activeHoldings = holdings
    .map(sanitizeHolding)
    .filter((holding) => holding.currentValue > 0 || holding.targetAllocation > 0);

  const diagnostics: Array<{
    severity: DiagnosticSeverity;
    title: string;
    description: string;
    ticker?: string;
    value?: number;
  }> = [];

  const sortedByAllocation = [...activeHoldings].sort((a, b) => b.currentAllocation - a.currentAllocation);
  const largest = sortedByAllocation[0];

  if (largest) {
    diagnostics.push({
      severity: largest.currentAllocation >= 35 ? "critical" : largest.currentAllocation >= 20 ? "warning" : "info",
      ticker: largest.ticker,
      value: largest.currentAllocation,
      title: "Maior concentracao",
      description: `${largest.ticker} representa ${largest.currentAllocation.toFixed(2)}% do patrimonio acompanhado.`,
    });
  }

  const belowTarget = activeHoldings
    .filter((holding) => holding.targetAllocation > 0 && holding.allocationGap > 0.05)
    .sort((a, b) => b.allocationGap - a.allocationGap);

  if (belowTarget.length > 0) {
    diagnostics.push({
      severity: "info",
      title: "Ativos abaixo do alvo",
      description: `${belowTarget.length} ativo(s) estao abaixo da alocacao alvo informada.`,
    });
  }

  const negativeReturn = activeHoldings
    .filter((holding) => holding.openCostBasis > 0 && holding.gainPercent <= -15)
    .sort((a, b) => a.gainPercent - b.gainPercent)
    .slice(0, 3);

  for (const holding of negativeReturn) {
    diagnostics.push({
      severity: "warning",
      ticker: holding.ticker,
      value: holding.gainPercent,
      title: "Queda relevante no custo",
      description: `${holding.ticker} esta ${holding.gainPercent.toFixed(2)}% abaixo do custo. Revise tese, liquidez e peso antes de aportar mais.`,
    });
  }

  const topGaps = belowTarget.slice(0, 5);
  const totalGap = topGaps.reduce((sum, holding) => sum + Math.max(0, holding.allocationGap), 0);
  const cash = positive(contributionAmount);
  const suggestions =
    cash > 0 && totalGap > 0
      ? topGaps.map((holding) => ({
          ticker: holding.ticker,
          name: holding.name,
          portfolioName: holding.portfolioName,
          suggestedValue: Math.round(cash * (holding.allocationGap / totalGap) * 100) / 100,
          allocationGap: holding.allocationGap,
          currentAllocation: holding.currentAllocation,
          targetAllocation: holding.targetAllocation,
          rationale: "Aporte proporcional ao desvio positivo em relacao ao alvo informado.",
        }))
      : [];

  if (suggestions.length > 0) {
    const roundedTotal = suggestions.reduce((sum, item) => sum + item.suggestedValue, 0);
    const diff = Math.round((cash - roundedTotal) * 100) / 100;
    suggestions[0].suggestedValue = Math.max(0, Math.round((suggestions[0].suggestedValue + diff) * 100) / 100);
  }

  if (diagnostics.length === 0 && positive(totals.currentValue) > 0) {
    diagnostics.push({
      severity: "info",
      title: "Carteira sem alertas fortes",
      description: "Nao encontrei concentracao ou desvio grande usando as regras locais.",
    });
  }

  return {
    diagnostics,
    suggestions,
    concentration: {
      ticker: largest?.ticker ?? null,
      allocation: largest?.currentAllocation ?? 0,
    },
  };
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text;

  const chunks: string[] = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

async function callOpenAi(body: Required<Pick<AnalyzePortfolioBody, "riskProfile" | "objective">> & {
  contributionAmount: number;
  holdings: AiPortfolioHolding[];
  totals: AiPortfolioTotals;
  local: unknown;
}, env: WorkerEnv) {
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;

  const model = String(env.OPENAI_MODEL ?? "gpt-5").trim();
  const payload = {
    model,
    input: [
      {
        role: "system",
        content:
          "Voce e um assistente de analise de carteira para uso privado. Responda em portugues do Brasil, apenas em JSON valido. Nao prometa resultado, nao de recomendacao financeira definitiva e trate tudo como cenario educativo. Foque em riscos de concentracao, lacunas de alocacao, perguntas de diligencia e simulacoes de aporte.",
      },
      {
        role: "user",
        content: JSON.stringify({
          riskProfile: body.riskProfile,
          objective: body.objective,
          contributionAmount: body.contributionAmount,
          totals: body.totals,
          holdings: body.holdings.slice(0, 80),
          localAnalysis: body.local,
          expectedJsonShape: {
            summary: "string",
            risks: ["string"],
            opportunities: ["string"],
            suggestedActions: [{ title: "string", description: "string", tickers: ["string"] }],
            questions: ["string"],
          },
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "portfolio_ai_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            risks: {
              type: "array",
              items: { type: "string" },
            },
            opportunities: {
              type: "array",
              items: { type: "string" },
            },
            suggestedActions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  tickers: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["title", "description", "tickers"],
              },
            },
            questions: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["summary", "risks", "opportunities", "suggestedActions", "questions"],
        },
      },
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const outputText = extractResponseText(data);
  if (!outputText) return null;
  return JSON.parse(outputText);
}

export async function handleAnalyzePortfolio(req: Request, env: WorkerEnv): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!isFromAllowedOrigin(req, env) && !hasValidApiKey(req, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as AnalyzePortfolioBody;

  if (!isAllowedAiUser(body.userEmail, env)) {
    return json({ error: "AI portfolio analysis is restricted" }, { status: 403 });
  }

  const holdings = Array.isArray(body.holdings) ? body.holdings.map(sanitizeHolding) : [];
  const totals: AiPortfolioTotals = {
    currentValue: positive(body.totals?.currentValue),
    totalCost: positive(body.totals?.totalCost),
    totalGain: finite(body.totals?.totalGain),
    totalGainPercent: finite(body.totals?.totalGainPercent),
    totalDividends: positive(body.totals?.totalDividends),
  };
  const contributionAmount = positive(body.contributionAmount);
  const riskProfile = body.riskProfile ?? "balanced";
  const objective = body.objective ?? "rebalance";
  const local = buildLocalAnalysis(holdings, totals, contributionAmount);

  let ai: unknown = null;
  let aiUnavailable: string | null = null;

  if (body.includeAi) {
    try {
      ai = await callOpenAi({ riskProfile, objective, contributionAmount, holdings, totals, local }, env);
    } catch (error) {
      console.error("[analyze-portfolio] OpenAI call failed", error);
      aiUnavailable = "A analise por IA nao respondeu agora. O diagnostico local foi gerado normalmente.";
    }
  }

  return json({
    generatedAt: new Date().toISOString(),
    local,
    ai,
    aiUnavailable,
    disclaimer:
      "Simulacao educativa para apoiar sua revisao. Nao e recomendacao financeira, oferta ou garantia de retorno.",
  });
}
