import { useEffect, useMemo, useState } from "react";
import type { Asset, CashMovement, Dividend, Portfolio, Transaction } from "@/types/financial";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useToast } from "@/hooks/use-toast";
import { useSecureStorage } from "@/contexts/SecureStorageContext";

function parseNumberBR(value: string): number {
  const cleaned = value.replace(/\./g, "").replace(/,/g, ".").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function dateToInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseDateInput(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return Date.now();
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

type MovementEditTarget =
  | { kind: "buy" | "sell"; item: Transaction }
  | { kind: "dividend"; item: Dividend }
  | { kind: "cash"; item: CashMovement };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: MovementEditTarget | null;
  portfolios: Portfolio[];
  assets: Asset[];
};

export function MovementEditDialog({ open, onOpenChange, target, portfolios, assets }: Props) {
  const { toast } = useToast();
  const { saveTransaction, saveDividend, saveCashMovement } = useSecureStorage();

  const assetsByPortfolio = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of assets) {
      const list = map.get(a.portfolioId) ?? [];
      list.push(a);
      map.set(a.portfolioId, list);
    }
    return map;
  }, [assets]);

  const initialTab = useMemo<"trade" | "dividend" | "cash">(() => {
    if (!target) return "trade";
    if (target.kind === "dividend") return "dividend";
    if (target.kind === "cash") return "cash";
    return "trade";
  }, [target]);

  const [tab, setTab] = useState<"trade" | "dividend" | "cash">("trade");

  // Trade form
  const [tradePortfolioId, setTradePortfolioId] = useState<string>("");
  const [tradeAssetId, setTradeAssetId] = useState<string>("");
  const [tradeType, setTradeType] = useState<"buy" | "sell">("buy");
  const [tradeShares, setTradeShares] = useState<string>("");
  const [tradePrice, setTradePrice] = useState<string>("");
  const [tradeFees, setTradeFees] = useState<string>("");
  const [tradeDate, setTradeDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [tradeNotes, setTradeNotes] = useState<string>("");

  // Dividend form
  const [divPortfolioId, setDivPortfolioId] = useState<string>("");
  const [divAssetId, setDivAssetId] = useState<string>("");
  const [divType, setDivType] = useState<Dividend["type"]>("dividend");
  const [divShares, setDivShares] = useState<string>("");
  const [divValuePerShare, setDivValuePerShare] = useState<string>("");
  const [divTax, setDivTax] = useState<string>("");
  const [divDate, setDivDate] = useState<string>(new Date().toISOString().slice(0, 10));

  // Cash form
  const [cashPortfolioId, setCashPortfolioId] = useState<string>("");
  const [cashType, setCashType] = useState<CashMovement["type"]>("deposit");
  const [cashValue, setCashValue] = useState<string>("");
  const [cashDate, setCashDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [cashNotes, setCashNotes] = useState<string>("");

  useEffect(() => {
    if (!open) return;

    setTab(initialTab);

    if (!target) return;

    if (target.kind === "buy" || target.kind === "sell") {
      const t = target.item;
      setTradePortfolioId(t.portfolioId);
      setTradeAssetId(t.assetId);
      setTradeType(t.type);
      setTradeShares(String(t.shares));
      setTradePrice(String(t.pricePerShare));
      setTradeFees(String(t.fees ?? 0));
      setTradeDate(dateToInput(t.date));
      setTradeNotes(t.notes ?? "");
    }

    if (target.kind === "dividend") {
      const d = target.item;
      setDivPortfolioId(d.portfolioId);
      setDivAssetId(d.assetId);
      setDivType(d.type);
      setDivShares(String(d.shares));
      setDivValuePerShare(String(d.valuePerShare));
      setDivTax(String(d.taxWithheld ?? 0));
      setDivDate(dateToInput(d.paymentDate));
    }

    if (target.kind === "cash") {
      const m = target.item;
      setCashPortfolioId(m.portfolioId);
      setCashType(m.type);
      setCashValue(String(m.value));
      setCashDate(dateToInput(m.date));
      setCashNotes(m.notes ?? "");
    }
  }, [open, target, initialTab]);

  const tradeAssets = tradePortfolioId ? assetsByPortfolio.get(tradePortfolioId) ?? [] : [];
  const divAssets = divPortfolioId ? assetsByPortfolio.get(divPortfolioId) ?? [] : [];

  const submitTradeUpdate = async () => {
    if (!target || (target.kind !== "buy" && target.kind !== "sell")) return;
    if (!tradePortfolioId || !tradeAssetId) {
      toast({ title: "Selecione portfólio e ativo", variant: "destructive" });
      return;
    }

    const shares = parseNumberBR(tradeShares);
    const price = parseNumberBR(tradePrice);
    const fees = parseNumberBR(tradeFees);
    if (shares <= 0 || price <= 0) {
      toast({ title: "Preencha quantidade e preço", variant: "destructive" });
      return;
    }

    const totalValue = shares * price + (fees || 0);

    const prev = target.item;
    const payload: Transaction = {
      ...prev,
      assetId: tradeAssetId,
      portfolioId: tradePortfolioId,
      type: tradeType,
      shares,
      pricePerShare: price,
      fees: fees || 0,
      totalValue,
      date: parseDateInput(tradeDate),
      notes: tradeNotes.trim() || undefined,
    };

    await saveTransaction(payload);
    toast({ title: "Movimentação atualizada" });
    onOpenChange(false);
  };

  const submitDividendUpdate = async () => {
    if (!target || target.kind !== "dividend") return;
    if (!divPortfolioId || !divAssetId) {
      toast({ title: "Selecione portfólio e ativo", variant: "destructive" });
      return;
    }

    const shares = parseNumberBR(divShares);
    const valuePerShare = parseNumberBR(divValuePerShare);
    const tax = parseNumberBR(divTax);

    if (shares <= 0 || valuePerShare <= 0) {
      toast({ title: "Preencha cotas e valor por cota", variant: "destructive" });
      return;
    }

    const grossValue = shares * valuePerShare;
    const totalValue = Math.max(0, grossValue - (tax || 0));

    const prev = target.item;
    const payload: Dividend = {
      ...prev,
      portfolioId: divPortfolioId,
      assetId: divAssetId,
      type: divType,
      valuePerShare,
      shares,
      grossValue,
      taxWithheld: tax || 0,
      totalValue,
      paymentDate: parseDateInput(divDate),
    };

    await saveDividend(payload);
    toast({ title: "Provento atualizado" });
    onOpenChange(false);
  };

  const submitCashUpdate = async () => {
    if (!target || target.kind !== "cash") return;
    if (!cashPortfolioId) {
      toast({ title: "Selecione o portfólio", variant: "destructive" });
      return;
    }

    const value = parseNumberBR(cashValue);
    if (value <= 0) {
      toast({ title: "Informe um valor", variant: "destructive" });
      return;
    }

    const prev = target.item;
    const payload: CashMovement = {
      ...prev,
      portfolioId: cashPortfolioId,
      type: cashType,
      value,
      date: parseDateInput(cashDate),
      notes: cashNotes.trim() || undefined,
    };

    await saveCashMovement(payload);
    toast({ title: "Movimento de caixa atualizado" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar movimentação</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="space-y-4">
          <TabsList>
            <TabsTrigger value="trade" disabled={!target || (target.kind !== "buy" && target.kind !== "sell")}>
              Compra/Venda
            </TabsTrigger>
            <TabsTrigger value="dividend" disabled={!target || target.kind !== "dividend"}>
              Proventos
            </TabsTrigger>
            <TabsTrigger value="cash" disabled={!target || target.kind !== "cash"}>
              Aporte/Saque
            </TabsTrigger>
          </TabsList>

          <TabsContent value="trade">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Portfólio</Label>
                  <Select
                    value={tradePortfolioId}
                    onValueChange={(v) => {
                      setTradePortfolioId(v);
                      setTradeAssetId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {portfolios.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Ativo</Label>
                  <Select value={tradeAssetId} onValueChange={setTradeAssetId}>
                    <SelectTrigger>
                      <SelectValue placeholder={tradePortfolioId ? "Selecione" : "Escolha um portfólio"} />
                    </SelectTrigger>
                    <SelectContent>
                      {tradeAssets.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.ticker} — {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={tradeType} onValueChange={(v) => setTradeType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="buy">Compra</SelectItem>
                      <SelectItem value="sell">Venda</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Data</Label>
                  <Input type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Quantidade</Label>
                  <Input value={tradeShares} onChange={(e) => setTradeShares(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Preço (unitário)</Label>
                  <Input value={tradePrice} onChange={(e) => setTradePrice(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Taxas</Label>
                  <Input value={tradeFees} onChange={(e) => setTradeFees(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea value={tradeNotes} onChange={(e) => setTradeNotes(e.target.value)} />
              </div>

              <DialogFooter>
                <Button onClick={submitTradeUpdate}>Salvar alterações</Button>
              </DialogFooter>
            </div>
          </TabsContent>

          <TabsContent value="dividend">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Portfólio</Label>
                  <Select
                    value={divPortfolioId}
                    onValueChange={(v) => {
                      setDivPortfolioId(v);
                      setDivAssetId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {portfolios.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Ativo</Label>
                  <Select value={divAssetId} onValueChange={setDivAssetId}>
                    <SelectTrigger>
                      <SelectValue placeholder={divPortfolioId ? "Selecione" : "Escolha um portfólio"} />
                    </SelectTrigger>
                    <SelectContent>
                      {divAssets.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.ticker} — {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={divType} onValueChange={(v) => setDivType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dividend">Dividendo</SelectItem>
                      <SelectItem value="jcp">JCP</SelectItem>
                      <SelectItem value="yield">Rendimento</SelectItem>
                      <SelectItem value="stock_lending">Aluguel de ativos</SelectItem>
                      <SelectItem value="bonus">Bônus</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Data de pagamento</Label>
                  <Input type="date" value={divDate} onChange={(e) => setDivDate(e.target.value)} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Cotas/Ações</Label>
                  <Input value={divShares} onChange={(e) => setDivShares(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Valor por cota</Label>
                  <Input value={divValuePerShare} onChange={(e) => setDivValuePerShare(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>IR retido</Label>
                  <Input value={divTax} onChange={(e) => setDivTax(e.target.value)} />
                </div>
              </div>

              <DialogFooter>
                <Button onClick={submitDividendUpdate}>Salvar alterações</Button>
              </DialogFooter>
            </div>
          </TabsContent>

          <TabsContent value="cash">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Portfólio</Label>
                  <Select value={cashPortfolioId} onValueChange={setCashPortfolioId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {portfolios.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={cashType} onValueChange={(v) => setCashType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deposit">Aporte</SelectItem>
                      <SelectItem value="withdraw">Saque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Valor</Label>
                  <Input value={cashValue} onChange={(e) => setCashValue(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Data</Label>
                  <Input type="date" value={cashDate} onChange={(e) => setCashDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea value={cashNotes} onChange={(e) => setCashNotes(e.target.value)} />
              </div>

              <DialogFooter>
                <Button onClick={submitCashUpdate}>Salvar alterações</Button>
              </DialogFooter>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
