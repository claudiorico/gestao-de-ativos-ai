import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Plus,
  Filter,
  ArrowUpRight,
  ArrowDownLeft,
  Coins,
  Wallet,
  MoreVertical,
  Pencil,
  Trash2,
  Percent,
  TrendingUp,
  Gift,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { useAssets } from "@/hooks/useAssets";
import { usePortfolios } from "@/hooks/usePortfolios";
import { useToast } from "@/hooks/use-toast";
import type { CashMovement, Dividend, Transaction } from "@/types/financial";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MovementEditDialog } from "@/components/transactions/MovementEditDialog";
import { BackupRestoreDialog } from "@/components/backup/BackupRestoreDialog";

type MovementKind = "buy" | "sell" | "dividend" | "deposit" | "withdraw";

type MovementCategory =
  | "buy"
  | "sell"
  | "deposit"
  | "withdraw"
  | "dividend_dividend"
  | "dividend_jcp"
  | "dividend_yield"
  | "dividend_bonus";

type MovementRow = {
  id: string;
  kind: MovementKind; // usado para editar/excluir
  category: MovementCategory; // usado para chip + filtros
  label: string;
  assetId?: string;
  ticker?: string;
  portfolioName?: string;
  shares?: number;
  price?: number;
  total: number;
  date: number;
};

type EditTarget =
  | { kind: "buy" | "sell"; item: Transaction }
  | { kind: "dividend"; item: Dividend }
  | { kind: "cash"; item: CashMovement };

const categoryConfig: Record<MovementCategory, { label: string; icon: any; color: string; bg: string }> = {
  buy: {
    label: "Compra",
    icon: ArrowDownLeft,
    color: "text-chart-2",
    bg: "bg-accent",
  },
  sell: {
    label: "Venda",
    icon: ArrowUpRight,
    color: "text-loss",
    bg: "bg-loss-muted",
  },
  deposit: {
    label: "Aporte",
    icon: Wallet,
    color: "text-success",
    bg: "bg-success-muted",
  },
  withdraw: {
    label: "Saque",
    icon: Wallet,
    color: "text-loss",
    bg: "bg-loss-muted",
  },
  dividend_dividend: {
    label: "Dividendo",
    icon: Coins,
    color: "text-warning",
    bg: "bg-warning-muted",
  },
  dividend_jcp: {
    label: "JCP",
    icon: Percent,
    color: "text-chart-3",
    bg: "bg-secondary",
  },
  dividend_yield: {
    label: "Rendimento",
    icon: TrendingUp,
    color: "text-success",
    bg: "bg-success-muted",
  },
  dividend_bonus: {
    label: "Bônus",
    icon: Gift,
    color: "text-chart-2",
    bg: "bg-accent",
  },
};

const categoryOrder: MovementCategory[] = [
  "buy",
  "sell",
  "deposit",
  "withdraw",
  "dividend_dividend",
  "dividend_jcp",
  "dividend_yield",
  "dividend_bonus",
];

const isMovementCategory = (value: string): value is MovementCategory => {
  return categoryOrder.includes(value as MovementCategory);
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const formatDate = (dateMs: number) =>
  new Date(dateMs).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

export default function Transactions() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const {
    getTransactions,
    getDividends,
    getCashMovements,
    deleteTransaction,
    deleteDividend,
    deleteCashMovement,
    isUnlocked,
    decryptIssues,
    clearDecryptIssues,
  } = useSecureStorage();
  const { assets } = useAssets();
  const { portfolios } = usePortfolios();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editOpen, setEditOpen] = useState(false);


  const load = useCallback(async () => {
    if (!isUnlocked) return;
    try {
      const [tx, dv, cm] = await Promise.all([
        getTransactions(),
        getDividends(),
        getCashMovements(),
      ]);
      setTransactions(tx);
      setDividends(dv);
      setCashMovements(cm);
    } catch (err) {
      console.error("[Transactions] Failed to load movements:", err);
      toast({
        title: "Não foi possível carregar as movimentações",
        description: "Confira se o cofre está desbloqueado e tente novamente.",
        variant: "destructive",
      });
    }
  }, [getTransactions, getDividends, getCashMovements, isUnlocked, toast]);

  // Carrega ao entrar na tela e também quando houver mudanças no cofre (salvar/importar/etc.)
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isUnlocked) return;

    const onVaultChange = () => {
      // não precisa await aqui; evita bloquear o handler
      load();
    };

    window.addEventListener("vault-data-changed", onVaultChange);
    return () => window.removeEventListener("vault-data-changed", onVaultChange);
  }, [isUnlocked, load]);

  const assetById = useMemo(() => {
    return new Map(assets.map((a) => [a.id, a]));
  }, [assets]);

  const portfolioById = useMemo(() => {
    return new Map(portfolios.map((p) => [p.id, p]));
  }, [portfolios]);

  const txById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const divById = useMemo(() => new Map(dividends.map((d) => [d.id, d])), [dividends]);
  const cashById = useMemo(() => new Map(cashMovements.map((m) => [m.id, m])), [cashMovements]);

  const movements = useMemo<MovementRow[]>(() => {
    const txRows: MovementRow[] = transactions.map((t) => {
      const asset = assetById.get(t.assetId);
      const portfolio = portfolioById.get(t.portfolioId);
      return {
        id: t.id,
        kind: t.type,
        category: t.type,
        label: categoryConfig[t.type].label,
        assetId: t.assetId,
        ticker: asset?.ticker,
        portfolioName: portfolio?.name,
        shares: t.shares,
        price: t.pricePerShare,
        total: t.totalValue,
        date: t.date,
      };
    });

    const divRows: MovementRow[] = dividends.map((d) => {
      const asset = assetById.get(d.assetId);
      const portfolio = portfolioById.get(d.portfolioId);
      const category = `dividend_${d.type}` as MovementCategory;
      return {
        id: d.id,
        kind: "dividend",
        category,
        label: categoryConfig[category].label,
        assetId: d.assetId,
        ticker: asset?.ticker,
        portfolioName: portfolio?.name,
        shares: d.shares,
        price: d.valuePerShare,
        total: d.totalValue,
        date: d.paymentDate,
      };
    });

    const cashRows: MovementRow[] = cashMovements.map((m) => {
      const portfolio = portfolioById.get(m.portfolioId);
      const sign = m.type === "withdraw" ? -1 : 1;
      return {
        id: m.id,
        kind: m.type,
        category: m.type,
        label: categoryConfig[m.type].label,
        portfolioName: portfolio?.name,
        total: m.value * sign,
        date: m.date,
      };
    });

    return [...txRows, ...divRows, ...cashRows].sort((a, b) => b.date - a.date);
  }, [transactions, dividends, cashMovements, assetById, portfolioById]);

  const [assetFilter, setAssetFilter] = useState<string>(() => searchParams.get("asset") ?? "all");
  const [categoryFilter, setCategoryFilter] = useState<MovementCategory | "all">(() => {
    const fromUrl = searchParams.get("category");
    if (!fromUrl) return "all";
    return isMovementCategory(fromUrl) ? fromUrl : "all";
  });

  // Sincroniza filtros <-> URL (permite deep link e navegação a partir de outras telas)
  useEffect(() => {
    const nextAsset = searchParams.get("asset") ?? "all";
    const nextCategoryRaw = searchParams.get("category");
    const nextCategory: MovementCategory | "all" = nextCategoryRaw
      ? isMovementCategory(nextCategoryRaw)
        ? nextCategoryRaw
        : "all"
      : "all";

    if (nextAsset !== assetFilter) setAssetFilter(nextAsset);
    if (nextCategory !== categoryFilter) setCategoryFilter(nextCategory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (assetFilter !== "all") next.set("asset", assetFilter);
    if (categoryFilter !== "all") next.set("category", categoryFilter);
    setSearchParams(next, { replace: true });
  }, [assetFilter, categoryFilter, setSearchParams]);

  const filteredMovements = useMemo(() => {
    return movements.filter((row) => {
      const matchesAsset = assetFilter === "all" ? true : row.assetId === assetFilter;
      const matchesCategory = categoryFilter === "all" ? true : row.category === categoryFilter;
      return matchesAsset && matchesCategory;
    });
  }, [movements, assetFilter, categoryFilter]);

  const openEdit = (row: MovementRow) => {
    if (row.kind === "buy" || row.kind === "sell") {
      const item = txById.get(row.id);
      if (!item) return;
      setEditTarget({ kind: row.kind, item });
      setEditOpen(true);
      return;
    }
    if (row.kind === "dividend") {
      const item = divById.get(row.id);
      if (!item) return;
      setEditTarget({ kind: "dividend", item });
      setEditOpen(true);
      return;
    }
    if (row.kind === "deposit" || row.kind === "withdraw") {
      const item = cashById.get(row.id);
      if (!item) return;
      setEditTarget({ kind: "cash", item });
      setEditOpen(true);
    }
  };

  const deleteRow = async (row: MovementRow) => {
    try {
      if (row.kind === "buy" || row.kind === "sell") {
        await deleteTransaction(row.id);
      } else if (row.kind === "dividend") {
        await deleteDividend(row.id);
      } else {
        await deleteCashMovement(row.id);
      }
      toast({ title: "Movimentação excluída" });
    } catch (err) {
      console.error("[Transactions] Failed to delete movement:", err);
      toast({
        title: "Não foi possível excluir",
        description: "Tente novamente.",
        variant: "destructive",
      });
    }
  };


  const monthStart = useMemo(() => startOfMonth(), []);

  const monthTotals = useMemo(() => {
    // Totais do mês respeitando os filtros ativos (ativo + categoria)
    const inMonth = filteredMovements.filter((m) => m.date >= monthStart);

    const purchases = inMonth
      .filter((m) => m.kind === "buy")
      .reduce((sum, m) => sum + m.total, 0);

    const sales = inMonth
      .filter((m) => m.kind === "sell")
      .reduce((sum, m) => sum + m.total, 0);

    const proventos = inMonth
      .filter((m) => m.kind === "dividend")
      .reduce((sum, m) => sum + m.total, 0);

    return { purchases, sales, proventos };
  }, [filteredMovements, monthStart]);

  const totalsLabelSuffix = assetFilter !== "all" || categoryFilter !== "all" ? "(filtro)" : "(mês)";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div>
            <h1 className="text-2xl font-bold text-foreground">Movimentações</h1>
            <p className="text-muted-foreground">
              Histórico de compras, vendas, proventos e aportes/saques • {transactions.length} tx • {dividends.length} proventos • {cashMovements.length} caixa
            </p>
          </div>
          <div className="flex gap-2">
            <Button className="gap-2" onClick={() => navigate("/transactions/new")}>
              <Plus className="h-4 w-4" />
              Nova Movimentação
            </Button>
          </div>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-xl border border-border bg-card p-4 shadow-card"
          aria-label="Filtros"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Filter className="h-4 w-4" />
              Filtros
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select value={assetFilter} onValueChange={setAssetFilter}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Todos os ativos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os ativos</SelectItem>
                  {assets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.ticker}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={categoryFilter}
                onValueChange={(v) => setCategoryFilter(v as MovementCategory | "all")}
              >
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Todas as categorias" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  {categoryOrder.map((key) => (
                    <SelectItem key={key} value={key}>
                      {categoryConfig[key].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAssetFilter("all");
                  setCategoryFilter("all");
                }}
                disabled={assetFilter === "all" && categoryFilter === "all"}
              >
                Limpar
              </Button>
            </div>
          </div>
        </motion.section>

        <MovementEditDialog
          open={editOpen}
          onOpenChange={(v) => {
            setEditOpen(v);
            if (!v) setEditTarget(null);
          }}
          target={editTarget}
          portfolios={portfolios}
          assets={assets}
        />

        {decryptIssues.length > 0 ? (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                Alguns dados do cofre não puderam ser lidos ({decryptIssues.join(", ")}). Isso pode acontecer se você trocou de conta/dispositivo ou se esse bloco ficou corrompido.
              </div>

              <div className="flex items-center gap-2">
                <BackupRestoreDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      Restaurar backup
                    </Button>
                  }
                />

                <Button variant="ghost" size="sm" onClick={clearDecryptIssues}>
                  Ocultar
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid gap-4 sm:grid-cols-3"
        >
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
                <ArrowDownLeft className="h-5 w-5 text-chart-2" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Compras {totalsLabelSuffix}</p>
                <p className="text-xl font-bold text-foreground tabular-nums">
                  {formatCurrency(monthTotals.purchases)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-loss-muted">
                <ArrowUpRight className="h-5 w-5 text-loss" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Vendas {totalsLabelSuffix}</p>
                <p className="text-xl font-bold text-foreground tabular-nums">
                  {formatCurrency(monthTotals.sales)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-muted">
                <Coins className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Proventos {totalsLabelSuffix}</p>
                <p className="text-xl font-bold text-foreground tabular-nums">
                  {formatCurrency(monthTotals.proventos)}
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-border bg-card shadow-card"
          aria-label="Lista de movimentações"
        >
          <div className="divide-y divide-border">
            {movements.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                Nenhuma movimentação cadastrada ainda.
                <div className="mt-3">
                  <Button variant="outline" onClick={() => navigate("/transactions/new")}>
                    Cadastrar a primeira
                  </Button>
                </div>
              </div>
            ) : filteredMovements.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                Nenhuma movimentação encontrada com esses filtros.
              </div>
            ) : (
              filteredMovements.map((row, index) => {
                const config = categoryConfig[row.category];
                const Icon = config.icon;

                return (
                  <motion.div
                    key={row.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + index * 0.03 }}
                    className={cn(
                      "flex items-center justify-between p-4 transition-colors",
                      index % 2 === 0 ? "bg-muted/20 dark:bg-muted/10" : "bg-muted/35 dark:bg-muted/20",
                      "hover:bg-muted/50 dark:hover:bg-muted/30",
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          {row.ticker && (
                            <span className="font-semibold text-foreground font-mono truncate">
                              {row.ticker}
                            </span>
                          )}

                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-none",
                              "ring-1 ring-border/60 shadow-sm",
                              config.bg,
                              config.color,
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            {row.label}
                          </span>

                          {row.portfolioName && (
                            <span className="text-xs text-muted-foreground truncate">
                              {row.portfolioName}
                            </span>
                          )}
                        </div>

                        {typeof row.shares === "number" && typeof row.price === "number" ? (
                          <p className="text-sm text-muted-foreground">
                            {row.shares} × {formatCurrency(row.price)}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p
                          className={cn(
                            "font-semibold tabular-nums",
                            row.total < 0 ? "text-loss" : "text-foreground"
                          )}
                        >
                          {row.total < 0 ? "-" : "+"}
                          {formatCurrency(Math.abs(row.total))}
                        </p>
                        <p className="text-sm text-muted-foreground">{formatDate(row.date)}</p>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Ações">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEdit(row)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar / recategorizar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Excluir
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir movimentação?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Isso remove o registro e desfaz qualquer cálculo influenciado por ele.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteRow(row)}>Excluir</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </motion.section>
      </div>
    </DashboardLayout>
  );
}

