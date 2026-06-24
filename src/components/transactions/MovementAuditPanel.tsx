import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSearch, Info, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { useToast } from "@/hooks/use-toast";
import type {
  Asset,
  CorporateAction,
  CorporateActionType,
  ImportedMovement,
  Portfolio,
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

type Props = {
  importedMovements: ImportedMovement[];
  corporateActions: CorporateAction[];
  assets: Asset[];
  portfolios: Portfolio[];
  accountingCount: number;
  legacyCandidates: ImportedMovement[];
  onChanged: () => Promise<void> | void;
};

export function MovementAuditPanel({
  importedMovements,
  corporateActions,
  assets,
  portfolios,
  accountingCount,
  legacyCandidates,
  onChanged,
}: Props) {
  const { toast } = useToast();
  const {
    saveCorporateAction,
    deleteCorporateAction,
    saveCashMovement,
    deleteCashMovement,
    saveImportedMovement,
    saveImportedMovementsBulk,
  } = useSecureStorage();
  const [reviewing, setReviewing] = useState<ImportedMovement | null>(null);
  const [assetId, setAssetId] = useState("");
  const [destinationAssetId, setDestinationAssetId] = useState("");
  const [actionType, setActionType] = useState<CorporateActionType>("split");
  const [ratioNumerator, setRatioNumerator] = useState("");
  const [ratioDenominator, setRatioDenominator] = useState("");
  const [quantityChange, setQuantityChange] = useState("");
  const [costBasisChange, setCostBasisChange] = useState("");
  const [cashValue, setCashValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const pending = useMemo(
    () => importedMovements.filter((movement) => movement.status === "pending"),
    [importedMovements]
  );
  const informational = useMemo(
    () => importedMovements.filter((movement) => movement.status === "informational"),
    [importedMovements]
  );
  const accountedImports = useMemo(
    () => importedMovements.filter((movement) => movement.status === "applied"),
    [importedMovements]
  );
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const openReview = (movement: ImportedMovement) => {
    const matchedAsset = assets.find(
      (asset) => asset.ticker.toUpperCase() === movement.ticker?.toUpperCase()
    );
    setReviewing(movement);
    setAssetId(matchedAsset?.id ?? "");
    setDestinationAssetId("");
    setActionType(movement.suggestedCorporateActionType ?? "split");
    setRatioNumerator("");
    setRatioDenominator("");
    setQuantityChange(movement.quantity > 0 ? String(movement.quantity) : "");
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

  const prepareLegacyReview = async () => {
    await saveImportedMovementsBulk(legacyCandidates);
    await onChanged();
    toast({
      title: "Revisao preparada",
      description: `${legacyCandidates.length} registros antigos foram adicionados a auditoria.`,
    });
  };

  const saveReview = async () => {
    if (!reviewing || !assetId) {
      toast({ title: "Selecione o ativo afetado", variant: "destructive" });
      return;
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
      return;
    }
    if (
      (actionType === "ticker_change" || actionType === "merger") &&
      !destinationAssetId
    ) {
      toast({ title: "Selecione o ativo de destino", variant: "destructive" });
      return;
    }

    const sourceAsset = assetById.get(assetId);
    if (!sourceAsset) return;

    setIsSaving(true);
    try {
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
        date: reviewing.date,
        ratioNumerator: needsRatio ? numerator : undefined,
        ratioDenominator: needsRatio ? denominator : undefined,
        quantityChange: parseLocaleNumber(quantityChange) || undefined,
        costBasisChange: parseLocaleNumber(costBasisChange) || undefined,
        cashValue: parseLocaleNumber(cashValue) || undefined,
        cashMovementId: generatedCashMovementId,
        status: "applied",
        sourceImportedMovementId: reviewing.id,
        notes: reviewing.rawDescription,
        createdAt: Date.now(),
      };

      await saveCorporateAction(action);
      const linkedRecordIds = [...reviewing.linkedRecordIds, actionId];
      if (generatedCashMovementId) {
        await saveCashMovement({
          id: generatedCashMovementId,
          portfolioId: sourceAsset.portfolioId,
          type: "deposit",
          value: parseLocaleNumber(cashValue),
          date: reviewing.date,
          notes: `Evento corporativo B3 · ${reviewing.movementType}`,
          createdAt: Date.now(),
        });
        linkedRecordIds.push(generatedCashMovementId);
      }
      await saveImportedMovement({
        ...reviewing,
        classification: "corporate_action",
        status: "applied",
        linkedRecordIds,
        reason: `${reviewing.reason} Evento confirmado pelo usuario.`,
      });
      await onChanged();
      setReviewing(null);
      toast({ title: "Evento corporativo aplicado" });
    } finally {
      setIsSaving(false);
    }
  };

  const undoAction = async (action: CorporateAction) => {
    await deleteCorporateAction(action.id);
    if (action.cashMovementId) {
      await deleteCashMovement(action.cashMovementId);
    }
    if (action.sourceImportedMovementId) {
      const source = importedMovements.find(
        (movement) => movement.id === action.sourceImportedMovementId
      );
      if (source) {
        await saveImportedMovement({
          ...source,
          classification: "pending",
          status: "pending",
          linkedRecordIds: source.linkedRecordIds.filter(
            (id) => id !== action.id && id !== action.cashMovementId
          ),
          reason: `${source.reason} Aplicacao desfeita pelo usuario.`,
        });
      }
    }
    await onChanged();
    toast({ title: "Evento desfeito" });
  };

  const renderImportedRows = (
    rows: ImportedMovement[],
    emptyMessage: string,
    pendingMode = false
  ) => (
    <div className="divide-y divide-border rounded-md border border-border">
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        rows.map((movement) => (
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
                  {" · "}
                  {formatCurrency(movement.value)}
                </p>
              )}
            </div>
            {pendingMode && (
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
            )}
          </div>
        ))
      )}
    </div>
  );

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Auditoria de movimentacoes</h2>
            <p className="text-xs text-muted-foreground">
              O historico original da B3 fica separado dos efeitos usados nos calculos.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void onChanged()} title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <Tabs defaultValue={pending.length > 0 ? "pending" : "accounting"}>
          <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="accounting">Contabilizadas ({accountingCount})</TabsTrigger>
            <TabsTrigger value="events">Eventos ({corporateActions.length})</TabsTrigger>
            <TabsTrigger value="informational">Informativas ({informational.length})</TabsTrigger>
            <TabsTrigger value="pending">Revisar ({pending.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="accounting" className="mt-3">
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                <div>
                  {accountedImports.length} registros importados possuem efeito contabil confirmado.
                  {legacyCandidates.length > 0 && (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-warning">
                        {legacyCandidates.length} registros antigos com marca “Importado B3” ainda
                        nao possuem auditoria vinculada.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void prepareLegacyReview()}
                      >
                        Preparar revisao
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="events" className="mt-3">
            <div className="divide-y divide-border rounded-md border border-border">
              {corporateActions.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  Nenhum evento corporativo confirmado.
                </p>
              ) : (
                corporateActions
                  .slice()
                  .sort((a, b) => b.date - a.date)
                  .map((action) => (
                    <div key={action.id} className="flex items-center justify-between gap-4 p-4">
                      <div>
                        <p className="text-sm font-medium">
                          {actionLabels[action.type]} · {assetById.get(action.assetId)?.ticker}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(action.date)}
                          {action.ratioNumerator && action.ratioDenominator
                            ? ` · ${action.ratioNumerator}:${action.ratioDenominator}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-success" />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void undoAction(action)}
                        >
                          Desfazer
                        </Button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="informational" className="mt-3">
            {renderImportedRows(
              informational,
              "Nenhum registro informativo importado."
            )}
          </TabsContent>

          <TabsContent value="pending" className="mt-3">
            {pending.length > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>
                  Estes registros nao afetam posicao, custo, patrimonio ou impostos ate serem
                  confirmados.
                </span>
              </div>
            )}
            {renderImportedRows(pending, "Nenhum registro aguardando revisao.", true)}
          </TabsContent>
        </Tabs>
      </section>

      <Dialog open={Boolean(reviewing)} onOpenChange={(open) => !open && setReviewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Revisar evento corporativo</DialogTitle>
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
                          {asset.ticker} · {portfolios.find((p) => p.id === asset.portfolioId)?.name}
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

              <div className="flex items-start gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                O evento so entra nos calculos depois desta confirmacao. Confira os dados no
                comunicado da empresa ou da corretora.
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>Cancelar</Button>
            <Button onClick={() => void saveReview()} disabled={isSaving}>
              {isSaving ? "Aplicando..." : "Aplicar evento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
