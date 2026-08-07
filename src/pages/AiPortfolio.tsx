import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Blur } from "@/components/ui/blur";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthUser } from "@/contexts/GoogleUserContext";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { usePortfolios } from "@/hooks/usePortfolios";
import { canUsePortfolioAi } from "@/lib/ai-access";
import {
  buildLocalPortfolioAnalysis,
  type AiPortfolioHolding,
  type AiPortfolioObjective,
  type AiPortfolioTotals,
  type AiRiskProfile,
  type LocalPortfolioAnalysis,
} from "@/lib/ai-portfolio-analysis";
import { invokeBackendFunction } from "@/lib/backend/functionsClient";
import type { Dividend } from "@/types/financial";

interface AiPortfolioResponse {
  generatedAt: string;
  local: LocalPortfolioAnalysis;
  ai: {
    summary?: string;
    risks?: string[];
    opportunities?: string[];
    suggestedActions?: Array<{ title?: string; description?: string; tickers?: string[] }>;
    questions?: string[];
  } | null;
  aiUnavailable?: string | null;
  disclaimer: string;
}

const riskProfiles: Record<AiRiskProfile, string> = {
  conservative: "Conservador",
  balanced: "Equilibrado",
  growth: "Crescimento",
};

const objectives: Record<AiPortfolioObjective, string> = {
  rebalance: "Rebalancear",
  income: "Aumentar renda",
  opportunity: "Buscar oportunidades",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatPercent(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe >= 0 ? "+" : ""}${safe.toFixed(2)}%`;
}

function severityVariant(severity: string) {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "secondary";
  return "outline";
}

export default function AiPortfolio() {
  const { user } = useAuthUser();
  const { isUnlocked, getDividends } = useSecureStorage();
  const { portfoliosWithAssets, dashboardMetrics, isLoading, isPricesLoading } = usePortfolios();

  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [contributionAmount, setContributionAmount] = useState("1000");
  const [riskProfile, setRiskProfile] = useState<AiRiskProfile>("balanced");
  const [objective, setObjective] = useState<AiPortfolioObjective>("rebalance");
  const [consent, setConsent] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [remoteAnalysis, setRemoteAnalysis] = useState<AiPortfolioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAccess = canUsePortfolioAi(user?.email);

  useEffect(() => {
    if (!isUnlocked || !canAccess) {
      setDividends([]);
      return;
    }

    let mounted = true;
    getDividends()
      .then((items) => {
        if (mounted) setDividends(items);
      })
      .catch((err) => {
        console.warn("[AiPortfolio] Failed to load dividends", err);
      });

    return () => {
      mounted = false;
    };
  }, [canAccess, getDividends, isUnlocked]);

  const totals = useMemo<AiPortfolioTotals>(() => {
    const currentValue =
      dashboardMetrics?.totalValue ??
      portfoliosWithAssets.reduce((sum, portfolio) => sum + portfolio.currentValue, 0);
    const totalCost =
      dashboardMetrics?.totalCost ??
      portfoliosWithAssets.reduce((sum, portfolio) => sum + portfolio.openCostBasis, 0);
    const totalGain = dashboardMetrics?.totalGain ?? currentValue - totalCost;
    const totalGainPercent =
      dashboardMetrics?.totalGainPercent ?? (totalCost > 0 ? (totalGain / totalCost) * 100 : 0);
    const totalDividends = dividends.reduce((sum, dividend) => sum + Number(dividend.totalValue ?? 0), 0);

    return {
      currentValue,
      totalCost,
      totalGain,
      totalGainPercent,
      totalDividends,
    };
  }, [dashboardMetrics, dividends, portfoliosWithAssets]);

  const holdings = useMemo<AiPortfolioHolding[]>(() => {
    const totalValue = totals.currentValue;

    return portfoliosWithAssets.flatMap((portfolio) =>
      portfolio.assets
        .filter((asset) => asset.currentValue > 0 || asset.targetAllocation > 0)
        .map((asset) => {
          const targetAllocation = Math.max(
            0,
            (Number(portfolio.targetAllocation ?? 0) * Number(asset.targetAllocation ?? 0)) / 100,
          );
          const currentAllocation = totalValue > 0 ? (asset.currentValue / totalValue) * 100 : 0;

          return {
            ticker: asset.ticker,
            name: asset.name,
            type: asset.type,
            portfolioName: portfolio.name,
            currentValue: asset.currentValue,
            openCostBasis: asset.openCostBasis,
            gain: asset.gain,
            gainPercent: asset.gainPercent,
            currentAllocation,
            targetAllocation,
            allocationGap: targetAllocation - currentAllocation,
            priceChangePercent: asset.priceChangePercent,
          };
        }),
    );
  }, [portfoliosWithAssets, totals.currentValue]);

  const numericContribution = useMemo(() => {
    const parsed = Number(String(contributionAmount).replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [contributionAmount]);

  const localAnalysis = useMemo(
    () =>
      buildLocalPortfolioAnalysis({
        holdings,
        totals,
        contributionAmount: numericContribution,
      }),
    [holdings, numericContribution, totals],
  );

  const analysis = localAnalysis;

  const runAiAnalysis = async () => {
    if (!canAccess || !user?.email) return;
    if (!consent) {
      setError("Marque a autorizacao para enviar o resumo agregado para a IA.");
      return;
    }
    if (holdings.length === 0) {
      setError("Nao encontrei ativos com valor ou alvo para enviar. Abra uma carteira, aguarde o carregamento e tente novamente.");
      return;
    }
    setIsAnalyzing(true);
    setError(null);

    const { data, error: functionError } = await invokeBackendFunction<AiPortfolioResponse>(
      "analyze-portfolio",
      {
        body: {
          userEmail: user.email,
          contributionAmount: numericContribution,
          riskProfile,
          objective,
          includeAi: consent,
          holdings,
          totals,
        },
      },
    );

    if (functionError) {
      setError(functionError.message);
    } else {
      setRemoteAnalysis(data);
    }

    setIsAnalyzing(false);
  };

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center">
          <Alert>
            <LockKeyhole className="h-4 w-4" />
            <AlertTitle>Area privada</AlertTitle>
            <AlertDescription>
              Esta secao esta liberada apenas para contas configuradas para analise assistida por IA.
            </AlertDescription>
          </Alert>
        </div>
      </DashboardLayout>
    );
  }

  const ai = remoteAnalysis?.ai;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-6 w-6 text-primary" />
              <h1 className="text-3xl font-bold text-foreground">IA do Portifolio</h1>
            </div>
            <p className="mt-1 text-muted-foreground">
              Analise privada para revisar alocacao, concentracao e cenarios de aporte.
            </p>
          </div>
          <Badge variant="secondary" className="w-fit gap-1 rounded-md px-3 py-1.5 text-sm">
            <ShieldCheck className="h-4 w-4" />
            Resumo enviado somente com confirmacao
          </Badge>
        </div>

        <Alert className="border-primary/20 bg-primary/5">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Privacidade do cofre</AlertTitle>
          <AlertDescription>
            A tela monta um resumo com tickers, valores agregados e percentuais. Historico bruto da B3,
            observacoes e dados descriptografados completos nao sao enviados automaticamente.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Valor atual</CardDescription>
                <CardTitle className="text-2xl tabular-nums"><Blur>{formatCurrency(totals.currentValue)}</Blur></CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Custo investido</CardDescription>
                <CardTitle className="text-2xl tabular-nums"><Blur>{formatCurrency(totals.totalCost)}</Blur></CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Resultado</CardDescription>
                <CardTitle className={`text-2xl tabular-nums ${totals.totalGain >= 0 ? "text-success" : "text-destructive"}`}>
                  <Blur>{formatCurrency(totals.totalGain)}</Blur>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{formatPercent(totals.totalGainPercent)} sobre o custo</p>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Maior concentracao</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {analysis.concentration.ticker ?? "-"}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{analysis.concentration.allocation.toFixed(2)}%</p>
              </CardHeader>
            </Card>
          </section>

          <Card className="lg:row-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="h-5 w-5 text-primary" />
                Cenario de aporte
              </CardTitle>
              <CardDescription>Use como simulacao de calculo, nao como ordem de compra.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="contributionAmount">Valor para aportar</Label>
                <Input
                  id="contributionAmount"
                  inputMode="decimal"
                  value={contributionAmount}
                  onChange={(event) => setContributionAmount(event.target.value)}
                  placeholder="1000"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="space-y-2">
                  <Label>Perfil</Label>
                  <Select value={riskProfile} onValueChange={(value) => setRiskProfile(value as AiRiskProfile)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(riskProfiles).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Objetivo</Label>
                  <Select value={objective} onValueChange={(value) => setObjective(value as AiPortfolioObjective)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(objectives).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} />
                <span className="leading-5 text-muted-foreground">
                  Enviar o resumo agregado do portifolio para a analise por IA.
                </span>
              </label>

              <Button
                className="w-full gap-2"
                onClick={runAiAnalysis}
                disabled={isAnalyzing || !consent}
              >
                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {consent ? "Analisar com IA" : "Autorize o envio para analisar"}
              </Button>

              {error && (
                <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
              )}
              {remoteAnalysis?.aiUnavailable && (
                <p className="rounded-md bg-warning/10 p-3 text-sm text-warning">{remoteAnalysis.aiUnavailable}</p>
              )}
              {isPricesLoading && (
                <p className="text-xs text-muted-foreground">Atualizando cotacoes antes de consolidar a leitura.</p>
              )}
              {consent && holdings.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum ativo elegivel foi encontrado ainda. Se sua carteira acabou de abrir, aguarde alguns segundos.
                </p>
              )}
            </CardContent>
          </Card>

          <section className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertTriangle className="h-5 w-5 text-warning" />
                  Diagnostico local
                </CardTitle>
                <CardDescription>Regras objetivas aplicadas dentro do app.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {analysis.diagnostics.map((item, index) => (
                  <div key={`${item.title}-${index}`} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{item.title}</p>
                        {item.ticker && <Badge variant="outline" className="rounded-md">{item.ticker}</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    </div>
                    <Badge variant={severityVariant(item.severity) as any} className="w-fit rounded-md">
                      {item.severity}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Sugestao de aporte
                </CardTitle>
                <CardDescription>Distribuicao proporcional aos maiores desvios positivos, limitada a 5 ativos.</CardDescription>
              </CardHeader>
              <CardContent>
                {analysis.suggestions.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    Informe um valor de aporte e alvos de alocacao para gerar uma sugestao.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 font-medium">Ativo</th>
                          <th className="py-2 font-medium">Carteira</th>
                          <th className="py-2 text-right font-medium">Atual</th>
                          <th className="py-2 text-right font-medium">Alvo</th>
                          <th className="py-2 text-right font-medium">Aporte</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.suggestions.map((item) => (
                          <tr key={`${item.portfolioName}-${item.ticker}`} className="border-b last:border-0">
                            <td className="py-3">
                              <div className="font-medium text-foreground">{item.ticker}</div>
                              <div className="max-w-[16rem] truncate text-xs text-muted-foreground">{item.name}</div>
                            </td>
                            <td className="py-3 text-muted-foreground">{item.portfolioName}</td>
                            <td className="py-3 text-right tabular-nums">{item.currentAllocation.toFixed(2)}%</td>
                            <td className="py-3 text-right tabular-nums">{item.targetAllocation.toFixed(2)}%</td>
                            <td className="py-3 text-right font-semibold tabular-nums"><Blur>{formatCurrency(item.suggestedValue)}</Blur></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BrainCircuit className="h-5 w-5 text-primary" />
              Leitura da IA
            </CardTitle>
            <CardDescription>
              Resultado aparece aqui quando voce autorizar o envio do resumo e executar a analise.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!ai ? (
              <div className="flex items-start gap-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  O diagnostico local ja esta disponivel. Para uma leitura qualitativa, marque a autorizacao de envio
                  e clique em analisar.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {ai.summary && (
                  <div className="rounded-md border p-4 lg:col-span-2">
                    <h3 className="font-semibold text-foreground">Resumo</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{ai.summary}</p>
                  </div>
                )}
                <AiList title="Riscos" items={ai.risks} />
                <AiList title="Oportunidades" items={ai.opportunities} />
                {ai.suggestedActions && ai.suggestedActions.length > 0 && (
                  <div className="rounded-md border p-4 lg:col-span-2">
                    <h3 className="font-semibold text-foreground">Proximas acoes</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {ai.suggestedActions.map((action, index) => (
                        <div key={`${action.title}-${index}`} className="rounded-md bg-muted/50 p-3">
                          <p className="font-medium text-foreground">{action.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
                          {action.tickers && action.tickers.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {action.tickers.map((ticker) => (
                                <Badge key={ticker} variant="outline" className="rounded-md">{ticker}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <AiList title="Perguntas para revisar" items={ai.questions} />
              </div>
            )}
            {remoteAnalysis?.disclaimer && (
              <p className="mt-4 text-xs text-muted-foreground">{remoteAnalysis.disclaimer}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function AiList({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;

  return (
    <div className="rounded-md border p-4">
      <h3 className="font-semibold text-foreground">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="leading-6">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
