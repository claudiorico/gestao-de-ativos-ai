import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { toast } from "@/hooks/use-toast";

export interface MoveAssetTarget {
  id: string;
  name: string;
  ticker: string;
  portfolioId: string;
}

interface MoveAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: MoveAssetTarget | null;
  portfolios: Array<{ id: string; name: string }>;
  onMoved?: () => void;
}

export function MoveAssetDialog({
  open,
  onOpenChange,
  asset,
  portfolios,
  onMoved,
}: MoveAssetDialogProps) {
  const {
    getAssets,
    getTransactions,
    getDividends,
    saveAssetsBulk,
    saveTransactionsBulk,
    saveDividendsBulk,
  } = useSecureStorage();

  const [targetId, setTargetId] = useState<string>("");
  const [isMoving, setIsMoving] = useState(false);

  const options = portfolios.filter((p) => p.id !== asset?.portfolioId);

  const handleMove = async () => {
    if (!asset || !targetId) return;

    setIsMoving(true);
    try {
      // Lê o ativo BRUTO do cofre (não o enriquecido) para preservar shares/preço médio.
      const assets = await getAssets();
      const raw = assets.find((a) => a.id === asset.id);
      if (!raw) {
        toast({ title: "Ativo não encontrado", variant: "destructive" });
        return;
      }

      const now = Date.now();
      await saveAssetsBulk([{ ...raw, portfolioId: targetId, updatedAt: now }]);

      // Reatribui transações e proventos do ativo para a nova carteira (consistência/IR).
      const txs = await getTransactions(asset.id);
      if (txs.length) {
        await saveTransactionsBulk(txs.map((t) => ({ ...t, portfolioId: targetId })));
      }
      const divs = await getDividends(asset.id);
      if (divs.length) {
        await saveDividendsBulk(divs.map((d) => ({ ...d, portfolioId: targetId })));
      }

      const targetName = portfolios.find((p) => p.id === targetId)?.name ?? "outra carteira";
      toast({
        title: "Ativo movido",
        description: `${asset.ticker} foi movido para “${targetName}” (com transações e proventos).`,
      });

      setTargetId("");
      onOpenChange(false);
      onMoved?.();
    } catch (e) {
      console.error("[MoveAsset] erro ao mover", e);
      toast({ title: "Erro ao mover ativo", variant: "destructive" });
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover ativo para outra carteira</DialogTitle>
          <DialogDescription>
            {asset
              ? `${asset.ticker} — move o ativo e reatribui suas transações e proventos.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Não há outra carteira para onde mover. Crie uma nova carteira primeiro.
          </p>
        ) : (
          <div className="space-y-2">
            <Label>Carteira de destino</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a carteira" />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMoving}>
            Cancelar
          </Button>
          <Button className="gap-2" onClick={handleMove} disabled={isMoving || !targetId}>
            <ArrowRightLeft className="h-4 w-4" />
            {isMoving ? "Movendo..." : "Mover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
