import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Upload, ArrowDownLeft, Coins, Wallet } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { usePortfolios } from "@/hooks/usePortfolios";
import { useAssets } from "@/hooks/useAssets";
import { B3ImportTab } from "@/components/portfolio/B3ImportTab";
import type { CashMovement, Dividend, Transaction } from "@/types/financial";

function parseNumberBR(value: string): number {
  const cleaned = value
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDateInput(value: string): number {
  // value in YYYY-MM-DD
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return Date.now();
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

type TransactionPrefill = {
  tab?: "trade";
  type?: "buy" | "sell";
  portfolioId?: string;
  assetId?: string;
  shares?: string;
  price?: string;
  notes?: string;
};

type LocationState = {
  prefill?: TransactionPrefill;
};

export default function TransactionNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { portfolios } = usePortfolios();
  const { assets } = useAssets();

  const { saveTransaction, saveDividend, saveCashMovement } = useSecureStorage();

  const [tab, setTab] = useState<"trade" | "dividend" | "cash" | "b3">("trade");

  // Trade
  const [tradePortfolioId, setTradePortfolioId] = useState<string>("");
  const [tradeAssetId, setTradeAssetId] = useState<string>("");
  const [tradeType, setTradeType] = useState<"buy" | "sell">("buy");
  const [tradeShares, setTradeShares] = useState<string>("");
  const [tradePrice, setTradePrice] = useState<string>("");
  const [tradeFees, setTradeFees] = useState<string>("");
  const [tradeDate, setTradeDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [tradeNotes, setTradeNotes] = useState<string>("");

  // Dividend
  const [divPortfolioId, setDivPortfolioId] = useState<string>("");
  const [divAssetId, setDivAssetId] = useState<string>("");
  const [divType, setDivType] = useState<Dividend["type"]>("dividend");
  const [divShares, setDivShares] = useState<string>("");
  const [divValuePerShare, setDivValuePerShare] = useState<string>("");
  const [divTax, setDivTax] = useState<string>("");
  const [divDate, setDivDate] = useState<string>(new Date().toISOString().slice(0, 10));

  // Cash
  const [cashPortfolioId, setCashPortfolioId] = useState<string>("");
  const [cashType, setCashType] = useState<CashMovement["type"]>("deposit");
  const [cashValue, setCashValue] = useState<string>("");
  const [cashDate, setCashDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [cashNotes, setCashNotes] = useState<string>("");

  const assetsByPortfolio = useMemo(() => {
    const map = new Map<string, typeof assets>();
    for (const a of assets) {
      const list = map.get(a.portfolioId) ?? [];
      list.push(a);
      map.set(a.portfolioId, list);
    }
    return map;
  }, [assets]);

  const tradeAssets = tradePortfolioId ? assetsByPortfolio.get(tradePortfolioId) ?? [] : [];
  const divAssets = divPortfolioId ? assetsByPortfolio.get(divPortfolioId) ?? [] : [];

  const didPrefillRef = useRef(false);

  useEffect(() => {
    if (didPrefillRef.current) return;
    didPrefillRef.current = true;

    const state = (location.state ?? {}) as LocationState;
    const prefill = state.prefill;
    if (!prefill) return;

    if (prefill.tab) setTab(prefill.tab);
    if (prefill.portfolioId) setTradePortfolioId(prefill.portfolioId);
    if (prefill.assetId) setTradeAssetId(prefill.assetId);
    if (prefill.type) setTradeType(prefill.type);
    if (prefill.shares) setTradeShares(prefill.shares);
    if (prefill.price) setTradePrice(prefill.price);
    if (prefill.notes) setTradeNotes(prefill.notes);
  }, [location.state]);
  const submitTrade = async () => {
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

    const payload: Transaction = {
      id: crypto.randomUUID(),
      assetId: tradeAssetId,
      portfolioId: tradePortfolioId,
      type: tradeType,
      shares,
      pricePerShare: price,
      fees: fees || 0,
      totalValue,
      date: parseDateInput(tradeDate),
      notes: tradeNotes.trim() || undefined,
      createdAt: Date.now(),
    };

    await saveTransaction(payload);
    toast({ title: "Movimentação salva" });
    navigate("/transactions");
  };

  const submitDividend = async () => {
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

    const payload: Dividend = {
      id: crypto.randomUUID(),
      assetId: divAssetId,
      portfolioId: divPortfolioId,
      type: divType,
      valuePerShare,
      shares,
      grossValue,
      taxWithheld: tax || 0,
      totalValue,
      paymentDate: parseDateInput(divDate),
      createdAt: Date.now(),
    };

    await saveDividend(payload);
    toast({ title: "Provento salvo" });
    navigate("/transactions");
  };

  const submitCash = async () => {
    if (!cashPortfolioId) {
      toast({ title: "Selecione o portfólio", variant: "destructive" });
      return;
    }

    const value = parseNumberBR(cashValue);
    if (value <= 0) {
      toast({ title: "Informe um valor", variant: "destructive" });
      return;
    }

    const payload: CashMovement = {
      id: crypto.randomUUID(),
      portfolioId: cashPortfolioId,
      type: cashType,
      value,
      date: parseDateInput(cashDate),
      notes: cashNotes.trim() || undefined,
      createdAt: Date.now(),
    };

    await saveCashMovement(payload);
    toast({ title: "Movimento de caixa salvo" });
    navigate("/transactions");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">Nova movimentação</h1>
            <p className="text-muted-foreground">Cadastro manual e importação B3</p>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
        </motion.header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="space-y-4">
          <TabsList>
            <TabsTrigger value="trade" className="gap-2">
              <ArrowDownLeft className="h-4 w-4" /> Compra/Venda
            </TabsTrigger>
            <TabsTrigger value="dividend" className="gap-2">
              <Coins className="h-4 w-4" /> Proventos
            </TabsTrigger>
            <TabsTrigger value="cash" className="gap-2">
              <Wallet className="h-4 w-4" /> Aporte/Saque
            </TabsTrigger>
            <TabsTrigger value="b3" className="gap-2">
              <Upload className="h-4 w-4" /> Importar B3
            </TabsTrigger>
          </TabsList>

          <TabsContent value="trade">
            <div className="rounded-xl border border-border bg-card p-6 shadow-card space-y-5">
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
                  <Label>Tipo</Label>
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
                  <Input value={tradeShares} onChange={(e) => setTradeShares(e.target.value)} placeholder="Ex: 10" />
                </div>
                <div className="space-y-2">
                  <Label>Preço (unitário)</Label>
                  <Input value={tradePrice} onChange={(e) => setTradePrice(e.target.value)} placeholder="Ex: 38,12" />
                </div>
                <div className="space-y-2">
                  <Label>Taxas (opcional)</Label>
                  <Input value={tradeFees} onChange={(e) => setTradeFees(e.target.value)} placeholder="Ex: 2,50" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Observações (opcional)</Label>
                <Textarea value={tradeNotes} onChange={(e) => setTradeNotes(e.target.value)} placeholder="Ex: corretagem, lote fracionário..." />
              </div>

              <div className="flex justify-end">
                <Button onClick={submitTrade}>Salvar</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="dividend">
            <div className="rounded-xl border border-border bg-card p-6 shadow-card space-y-5">
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
                  <Label>Tipo de provento</Label>
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
                  <Input value={divShares} onChange={(e) => setDivShares(e.target.value)} placeholder="Ex: 100" />
                </div>
                <div className="space-y-2">
                  <Label>Valor por cota</Label>
                  <Input value={divValuePerShare} onChange={(e) => setDivValuePerShare(e.target.value)} placeholder="Ex: 0,82" />
                </div>
                <div className="space-y-2">
                  <Label>IR retido (opcional)</Label>
                  <Input value={divTax} onChange={(e) => setDivTax(e.target.value)} placeholder="Ex: 1,50" />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={submitDividend}>Salvar</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="cash">
            <div className="rounded-xl border border-border bg-card p-6 shadow-card space-y-5">
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
                  <Label>Tipo</Label>
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
                  <Input value={cashValue} onChange={(e) => setCashValue(e.target.value)} placeholder="Ex: 1.000,00" />
                </div>
                <div className="space-y-2">
                  <Label>Data</Label>
                  <Input type="date" value={cashDate} onChange={(e) => setCashDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Observações (opcional)</Label>
                <Textarea value={cashNotes} onChange={(e) => setCashNotes(e.target.value)} placeholder="Ex: aporte mensal" />
              </div>

              <div className="flex justify-end">
                <Button onClick={submitCash}>Salvar</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="b3">
            <B3ImportTab onImportComplete={() => navigate("/transactions")} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
