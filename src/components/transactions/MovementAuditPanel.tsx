import { useMemo, useState } from "react";
import { AlertTriangle, FileSearch, Info, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { useToast } from "@/hooks/use-toast";
import type {
  Asset,
  CorporateAction,
  CorporateActionType,
  Dividend,
  ImportedMovement,
  Portfolio,
  Transaction,
} from "@/types/financial";

const actionLabels: Record<CorporateActionType, string> = {
  split: "Desdobramento",
  reverse_split: "Grupamento",
  bonus: "Bonificacao",
  amortization: "Amortizacao",
  subscription: "Subscricao",
  ticker_change: "Mudanca de ticker",
  merger: "Incorporacao / conversao",
};

type ReviewTreatment = "trade" | "cash_refund" | "dividend" | "corporate_action";
type ReviewDividendType = Extract<Dividend["type"], "dividend" | "jcp" | "yield" | "stock_lending">;

const treatmentLabels: Record<ReviewTreatment, string> = {
  trade: "Compra/Venda/Resgate",
  cash_refund: "Entrada de caixa / Reembolso",
  dividend: "Provento",
  corporate_action: "Evento corporativo",
};

const dividendLabels: Record<ReviewDividendType, string> = {
  dividend: "Dividendo",
  jcp: "JCP",
  yield: "Rendimento",
  stock_lending: "Aluguel de ativos",
};

function formatDate(value: number) {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function parseLocaleNumber(value: string) {
  const normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function inferTradeType(movement: ImportedMovement): Transaction["type"] {
  const text = normalizeText(`${movement.movementType} ${movement.direction ?? ""}`);
  if (text.includes("venda") || text.includes("resgate") || text.includes("saida")) {
    return "sell";
  }
  return "buy";
}

function isTradeLikeMovement(movement: ImportedMovement) {
  const text = normalizeText(`${movement.movementType} ${movement.direction ?? ""} ${movement.productName ?? ""}`);
  return (
    text.includes("compra") ||
    text.includes("venda") ||
    text.includes("resgate") ||
    text.includes("transferencia")
  );
}

type Props = {
  importedMovements: ImportedMovement[];
  assets: Asset[];
  portfolios: Portfolio[];
  onChanged: () => Promise<void> | void;
};

export function MovementAuditPanel({
  importedMovements,
  assets,
  portfolios,
  onChanged,
}: Props) {
  const { toast } = useToast();
  const {
    saveCorporateAction,
    saveDividend,
    saveCashMovement,
    saveImportedMovement,
    saveTransaction,
  } = useSecureStorage();
  const [reviewing, setReviewing] = useState<ImportedMovement | null>(null);
  const [reviewTreatment, setReviewTreatment] = useState<ReviewTreatment>("corporate_action");
  const [assetId, setAssetId] = useState("");
  const [portfolioId, setPortfolioId] = useState("");
  const [destinationAssetId, setDestinationAssetId] = useState("");
  const [actionType, setActionType] = useState<CorporateActionType>("split");
  const [dividendType, setDividendType] = useState<ReviewDividendType>("yield");
  const [tradeType, setTradeType] = useState<Transaction["type"]>("buy");
  const [ratioNumerator, setRatioNumerator] = useState("");
  const [ratioDenominator, setRatioDenominator] = useState("");
  const [quantityChange, setQuantityChange] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [fees, setFees] = useState("");
  const [costBasisChange, setCostBasisChange] = useState("");
  const [cashValue, setCashValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const pending = useMemo(
    () => importedMovements.filter((movement) => movement.status === "pending"),
    [importedMovements]
  );
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const assetsByPortfolio = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const asset of assets) {
      const list = map.get(asset.portfolioId) ?? [];
      list.push(asset);
      map.set(asset.portfolioId, list);
    }
    return map;
  }, [assets]);
  const tradeAssets = portfolioId ? assetsByPortfolio.get(portfolioId) ?? [] : assets;

  const openReview = (movement: ImportedMovement) => {
    const matchedAsset = assets.find(
      (asset) => asset.ticker.toUpperCase() === movement.ticker?.toUpperCase()
    );
    const hasSuggestedDividendType =
      movement.accountingType === "dividend" ||
      movement.accountingType === "jcp" ||
      movement.accountingType === "yield" ||
      movement.accountingType === "stock_lending";
    const hasSuggestedTrade = movement.accountingType === "trade" || isTradeLikeMovement(movement);

    setReviewing(movement);
    setReviewTreatment(
      hasSuggestedTrade
        ? "trade"
        : movement.accountingType === "cash_refund"
        ? "cash_refund"
        : hasSuggestedDividendType
          ? "dividend"
          : "corporate_action"
    );
    setAssetId(matchedAsset?.id ?? "");
    setPortfolioId(matchedAsset?.portfolioId ?? portfolios[0]?.id ?? "");
    setDestinationAssetId("");
    setActionType(movement.suggestedCorporateActionType ?? "split");
    setDividendType(hasSuggestedDividendType ? movement.accountingType : "yield");
    setTradeType(inferTradeType(movement));
    setRatioNumerator("");
    setRatioDenominator("");
    setQuantityChange(movement.quantity > 0 ? String(movement.quantity) : "");
    setUnitPrice(
      movement.unitPrice > 0
        ? String(movement.unitPrice)
        : movement.quantity > 0 && movement.value > 0
          ? String(movement.value / movement.quantity)
          : ""
    );
    setFees("");
    setCostBasisChange("");
    setCashValue(movement.value > 0 ? String(movement.value) : "");
  };

  const markInformational = async (movement: ImportedMovement) => {
    await saveImportedMovement({
      ...movement,
      classification: "informational",
      status: "informational",
      reason: `${movement.reason} Revisado e mantido sem efeito contabil.`,
    });
    await onChanged();
    toast({ title: "Registro mantido como informativo" });
  };

  const saveCashReview = async (movement: ImportedMovement): Promise<boolean> => {
    if (!portfolioId) {
      toast({ title: "Selecione o portfolio de destino", variant: "destructive" });
      return false;
    }

    const value = parseLocaleNumber(cashValue) || Math.abs(movement.value);
    if (!(value > 0)) {
      toast({ title: "Informe um valor recebido valido", variant: "destructive" });
      return false;
    }

    const cashId = crypto.randomUUID();
    await saveCashMovement({
      id: cashId,
      portfolioId,
      type: "deposit",
      value,
      date: movement.date,
      notes: `Revisao B3 - ${movement.movementType}`,
      createdAt: Date.now(),
    });
    await saveImportedMovement({
      ...movement,
      classification: "accounting",
      accountingType: "cash_refund",
      status: "applied",
      linkedRecordIds: [...movement.linkedRecordIds, cashId],
      reason: `${movement.reason} Aplicado como entrada de caixa.`,
    });
    toast({ title: "Entrada de caixa aplicada" });
    return true;
  };

  const saveTradeReview = async (movement: ImportedMovement): Promise<boolean> => {
    if (!portfolioId || !assetId) {
      toast({ title: "Selecione portfolio e ativo", variant: "destructive" });
      return false;
    }

    const sourceAsset = assetById.get(assetId);
    if (!sourceAsset || sourceAsset.portfolioId !== portfolioId) {
      toast({ title: "Selecione um ativo do portfolio escolhido", variant: "destructive" });
      return false;
    }

    const shares = parseLocaleNumber(quantityChange) || movement.quantity;
    const total = parseLocaleNumber(cashValue) || Math.abs(movement.value);
    const price =
      parseLocaleNumber(unitPrice) ||
      (shares > 0 && total > 0 ? total / shares : 0);
    const parsedFees = parseLocaleNumber(fees);

    if (!(shares > 0) || !(price > 0)) {
      toast({ title: "Informe quantidade e preco unitario validos", variant: "destructive" });
      return false;
    }

    const transactionId = crypto.randomUUID();
    await saveTransaction({
      id: transactionId,
      assetId,
      portfolioId,
      type: tradeType,
      shares,
      pricePerShare: price,
      totalValue: total > 0 ? total : shares * price,
      fees: parsedFees || 0,
      date: movement.date,
      notes: `Revisao B3 - ${movement.movementType}`,
      createdAt: Date.now(),
    });
    await saveImportedMovement({
      ...movement,
      classification: "accounting",
      accountingType: "trade",
      status: "applied",
      linkedRecordIds: [...movement.linkedRecordIds, transactionId],
      reason: `${movement.reason} Aplicado como transacao.`,
    });
    toast({ title: tradeType === "buy" ? "Compra aplicada" : "Venda/resgate aplicado" });
    return true;
  };

  const saveDividendReview = async (movement: ImportedMovement): Promise<boolean> => {
    if (!assetId) {
      toast({ title: "Selecione o ativo do provento", variant: "destructive" });
      return false;
    }

    const sourceAsset = assetById.get(assetId);
    if (!sourceAsset) return false;

    const totalValue = parseLocaleNumber(cashValue) || Math.abs(movement.value);
    if (!(totalValue > 0)) {
      toast({ title: "Informe um valor recebido valido", variant: "destructive" });
      return false;
    }

    const shares = parseLocaleNumber(quantityChange) || movement.quantity || 0;
    const valuePerShare =
      shares > 0 ? totalValue / shares : parseLocaleNumber(costBasisChange) || movement.unitPrice || totalValue;

    const dividendId = crypto.randomUUID();
    await saveDividend({
      id: dividendId,
      assetId,
      portfolioId: sourceAsset.portfolioId,
      type: dividendType,
      valuePerShare,
      shares,
      grossValue: totalValue,
      taxWithheld: 0,
      totalValue,
      paymentDate: movement.date,
      createdAt: Date.now(),
    });
    await saveImportedMovement({
      ...movement,
      classification: "accounting",
      accountingType: dividendType,
      status: "applied",
      linkedRecordIds: [...movement.linkedRecordIds, dividendId],
      reason: `${movement.reason} Aplicado como provento.`,
    });
    toast({ title: "Provento aplicado" });
    return true;
  };

  const saveCorporateActionReview = async (movement: ImportedMovement): Promise<boolean> => {
    if (!assetId) {
      toast({ title: "Selecione o ativo afetado", variant: "destructive" });
      return false;
    }

    const needsRatio =
      actionType === "split" ||
      actionType === "reverse_split" ||
      actionType === "ticker_change" ||
      actionType === "merger";
    const numerator = parseLocaleNumber(ratioNumerator);
    const denominator = parseLocaleNumber(ratioDenominator);
    if (needsRatio && (!(numerator > 0) || !(denominator > 0))) {
      toast({ title: "Informe uma proporcao valida", variant: "destructive" });
      return false;
    }
    if ((actionType === "ticker_change" || actionType === "merger") && !destinationAssetId) {
      toast({ title: "Selecione o ativo de destino", variant: "destructive" });
      return false;
    }

    const sourceAsset = assetById.get(assetId);
    if (!sourceAsset) return false;

    const actionId = crypto.randomUUID();
    const generatedCashMovementId =
      actionType === "amortization" && parseLocaleNumber(cashValue) > 0
        ? crypto.randomUUID()
        : undefined;
    const action: CorporateAction = {
      id: actionId,
      portfolioId: sourceAsset.portfolioId,
      assetId,
      destinationAssetId: destinationAssetId || undefined,
      type: actionType,
      date: movement.date,
      ratioNumerator: needsRatio ? numerator : undefined,
      ratioDenominator: needsRatio ? denominator : undefined,
      quantityChange: parseLocaleNumber(quantityChange) || undefined,
      costBasisChange: parseLocaleNumber(costBasisChange) || undefined,
      cashValue: parseLocaleNumber(cashValue) || undefined,
      cashMovementId: generatedCashMovementId,
      status: "applied",
      sourceImportedMovementId: movement.id,
      notes: movement.rawDescription,
      createdAt: Date.now(),
    };

    await saveCorporateAction(action);
    const linkedRecordIds = [...movement.linkedRecordIds, actionId];
    if (generatedCashMovementId) {
      await saveCashMovement({
        id: generatedCashMovementId,
        portfolioId: sourceAsset.portfolioId,
        type: "deposit",
        value: parseLocaleNumber(cashValue),
        date: movement.date,
        notes: `Evento corporativo B3 - ${movement.movementType}`,
        createdAt: Date.now(),
      });
      linkedRecordIds.push(generatedCashMovementId);
    }
    await saveImportedMovement({
      ...movement,
      classification: "corporate_action",
      status: "applied",
      linkedRecordIds,
      reason: `${movement.reason} Evento confirmado pelo usuario.`,
    });
    toast({ title: "Evento corporativo aplicado" });
    return true;
  };

  const saveReview = async () => {
    if (!reviewing) return;

    setIsSaving(true);
    try {
      let saved = false;
      if (reviewTreatment === "trade") {
        saved = await saveTradeReview(reviewing);
      } else if (reviewTreatment === "cash_refund") {
        saved = await saveCashReview(reviewing);
      } else if (reviewTreatment === "dividend") {
        saved = await saveDividendReview(reviewing);
      } else {
        saved = await saveCorporateActionReview(reviewing);
      }
      if (!saved) return;
      await onChanged();
      setReviewing(null);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Revisao de movimentacoes B3 ({pending.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Apenas registros pendentes aparecem aqui; itens ja aplicados ficam guardados para auditoria.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void onChanged()} title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {pending.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              Estes registros nao afetam posicao, custo, patrimonio ou impostos ate serem
              confirmados.
            </span>
          </div>
        )}

        <div className="divide-y divide-border rounded-md border border-border">
          {pending.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nenhum registro aguardando revisao.
            </p>
          ) : (
            pending.map((movement) => (
              <div
                key={movement.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {movement.ticker && (
                      <span className="font-mono text-sm font-semibold">{movement.ticker}</span>
                    )}
                    <span className="text-sm font-medium">{movement.movementType}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(movement.date)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{movement.reason}</p>
                  {(movement.quantity > 0 || movement.value > 0) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {movement.quantity > 0 ? `Qtd. ${movement.quantity}` : "Sem quantidade"}
                      {" - "}
                      {formatCurrency(movement.value)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void markInformational(movement)}
                  >
                    Sem efeito
                  </Button>
                  <Button size="sm" onClick={() => openReview(movement)}>
                    Revisar
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <Dialog open={Boolean(reviewing)} onOpenChange={(open) => !open && setReviewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Revisar movimentacao B3</DialogTitle>
          </DialogHeader>

          {reviewing && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <FileSearch className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{reviewing.movementType}</p>
                    <p className="text-xs text-muted-foreground">{reviewing.rawDescription}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Tratamento</Label>
                <Select
                  value={reviewTreatment}
                  onValueChange={(value) => setReviewTreatment(value as ReviewTreatment)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(treatmentLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {reviewTreatment === "trade" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Portfolio</Label>
                      <Select
                        value={portfolioId}
                        onValueChange={(value) => {
                          setPortfolioId(value);
                          if (assetId && assetById.get(assetId)?.portfolioId !== value) {
                            setAssetId("");
                          }
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {portfolios.map((portfolio) => (
                            <SelectItem key={portfolio.id} value={portfolio.id}>
                              {portfolio.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Ativo</Label>
                      <Select value={assetId} onValueChange={setAssetId}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {tradeAssets.map((asset) => (
                            <SelectItem key={asset.id} value={asset.id}>
                              {asset.ticker} - {asset.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select value={tradeType} onValueChange={(value) => setTradeType(value as Transaction["type"])}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="buy">Compra</SelectItem>
                          <SelectItem value="sell">Venda / Resgate</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Valor total informado</Label>
                      <Input
                        inputMode="decimal"
                        value={cashValue}
                        onChange={(event) => setCashValue(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Quantidade</Label>
                      <Input
                        inputMode="decimal"
                        value={quantityChange}
                        onChange={(event) => {
                          setQuantityChange(event.target.value);
                          const quantity = parseLocaleNumber(event.target.value);
                          const total = parseLocaleNumber(cashValue);
                          if (quantity > 0 && total > 0 && !unitPrice) {
                            setUnitPrice(String(total / quantity));
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Preco unitario</Label>
                      <Input
                        inputMode="decimal"
                        value={unitPrice}
                        onChange={(event) => setUnitPrice(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Taxas</Label>
                      <Input
                        inputMode="decimal"
                        value={fees}
                        onChange={(event) => setFees(event.target.value)}
                        placeholder="0,00"
                      />
                    </div>
                  </div>
                </>
              )}

              {reviewTreatment === "cash_refund" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Portfolio de destino</Label>
                    <Select value={portfolioId} onValueChange={setPortfolioId}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {portfolios.map((portfolio) => (
                          <SelectItem key={portfolio.id} value={portfolio.id}>
                            {portfolio.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Valor recebido</Label>
                    <Input
                      inputMode="decimal"
                      value={cashValue}
                      onChange={(event) => setCashValue(event.target.value)}
                    />
                  </div>
                </div>
              )}

              {reviewTreatment === "dividend" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Tipo de provento</Label>
                      <Select
                        value={dividendType}
                        onValueChange={(value) => setDividendType(value as ReviewDividendType)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(dividendLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Ativo do provento</Label>
                      <Select value={assetId} onValueChange={setAssetId}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {assets.map((asset) => (
                            <SelectItem key={asset.id} value={asset.id}>
                              {asset.ticker} - {portfolios.find((p) => p.id === asset.portfolioId)?.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Quantidade</Label>
                      <Input
                        inputMode="decimal"
                        value={quantityChange}
                        onChange={(event) => setQuantityChange(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Valor total</Label>
                      <Input
                        inputMode="decimal"
                        value={cashValue}
                        onChange={(event) => setCashValue(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Valor por cota opcional</Label>
                      <Input
                        inputMode="decimal"
                        value={costBasisChange}
                        onChange={(event) => setCostBasisChange(event.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              {reviewTreatment === "corporate_action" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Tipo de evento</Label>
                      <Select
                        value={actionType}
                        onValueChange={(value) => setActionType(value as CorporateActionType)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(actionLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Ativo afetado</Label>
                      <Select value={assetId} onValueChange={setAssetId}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {assets.map((asset) => (
                            <SelectItem key={asset.id} value={asset.id}>
                              {asset.ticker} - {portfolios.find((p) => p.id === asset.portfolioId)?.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {(actionType === "ticker_change" || actionType === "merger") && (
                    <div className="space-y-2">
                      <Label>Ativo de destino</Label>
                      <Select value={destinationAssetId} onValueChange={setDestinationAssetId}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {assets
                            .filter((asset) => asset.id !== assetId)
                            .map((asset) => (
                              <SelectItem key={asset.id} value={asset.id}>{asset.ticker}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {(actionType === "split" ||
                    actionType === "reverse_split" ||
                    actionType === "ticker_change" ||
                    actionType === "merger") && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Nova proporcao</Label>
                        <Input
                          inputMode="decimal"
                          value={ratioNumerator}
                          onChange={(event) => setRatioNumerator(event.target.value)}
                          placeholder="Ex.: 2"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Para cada</Label>
                        <Input
                          inputMode="decimal"
                          value={ratioDenominator}
                          onChange={(event) => setRatioDenominator(event.target.value)}
                          placeholder="Ex.: 1"
                        />
                      </div>
                    </div>
                  )}

                  {(actionType === "bonus" || actionType === "subscription") && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Quantidade adicionada</Label>
                        <Input
                          inputMode="decimal"
                          value={quantityChange}
                          onChange={(event) => setQuantityChange(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Custo atribuido</Label>
                        <Input
                          inputMode="decimal"
                          value={costBasisChange}
                          onChange={(event) => setCostBasisChange(event.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {actionType === "amortization" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Reducao do custo</Label>
                        <Input
                          inputMode="decimal"
                          value={costBasisChange}
                          onChange={(event) => setCostBasisChange(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Valor recebido</Label>
                        <Input
                          inputMode="decimal"
                          value={cashValue}
                          onChange={(event) => setCashValue(event.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-start gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                O registro so entra nos calculos depois desta confirmacao. Confira os dados no
                extrato da B3, comunicado da empresa ou informe da corretora.
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>Cancelar</Button>
            <Button onClick={() => void saveReview()} disabled={isSaving}>
              {isSaving ? "Aplicando..." : "Aplicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
