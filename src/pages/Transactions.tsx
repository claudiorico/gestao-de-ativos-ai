import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blur } from "@/components/ui/blur";
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
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { useAssets } from "@/hooks/useAssets";
import { useToast } from "@/hooks/use-toast";
import type { Asset, CashMovement, Dividend, Portfolio, Transaction } from "@/types/financial";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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

const PAGE_SIZE = 50;

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
  kind: MovementKind;
  category: MovementCategory;
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

const categoryConfig: Record<
  MovementCategory,
  { label: string; icon: React.ElementType; color: string; bg: string }
> = {
  buy: { label: "Compra", icon: ArrowDownLeft, color: "text-chart-2", bg: "bg-accent" },
  sell: { label: "Venda", icon: ArrowUpRight, color: "text-loss", bg: "bg-loss-muted" },
  deposit: { label: "Aporte", icon: Wallet, color: "text-success", bg: "bg-success-muted" },
  withdraw: { label: "Saque", icon: Wallet, color: "text-loss", bg: "bg-loss-muted" },
  dividend_dividend: { label: "Dividendo", icon: Coins, color: "text-warning", bg: "bg-warning-muted" },
  dividend_jcp: { label: "JCP", icon: Percent, color: "text-chart-3", bg: "bg-secondary" },
  dividend_yield: { label: "Rendimento", icon: TrendingUp, color: "text-success", bg: "bg-success-muted" },
  dividend_bonus: { label: "Bônus", icon: Gift, color: "text-chart-2", bg: "bg-accent" },
};

const categoryOrder: MovementCategory[] = [
  "buy", "sell", "deposit", "withdraw",
  "dividend_dividend", "dividend_jcp", "dividend_yield", "dividend_bonus",
];

const isMovementCategory = (v: string): v is MovementCategory =>
  categoryOrder.includes(v as MovementCategory);

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

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
    getPortfolios,
    deleteTransaction,
    deleteDividend,
    deleteCashMovement,
    isUnlocked,
    decryptIssues,
    clearDecryptIssues,
  } = useSecureStorage();
  const { assets } = useAssets();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!isUnlocked) return;
    try {
      const [tx, dv, cm, ps] = await Promise.all([
        getTransactions(),
        getDividends(),
        getCashMovements(),
        getPortfolios(),
      ]);
      setTransactions(tx);
      setDividends(dv);
      setCashMovements(cm);
      setPortfolios(ps);
    } catch (err) {
      console.error("[Transactions] Failed to load movements:", err);
      toast({
        title: "Não foi possível carregar as movimentações",
        description: "Confira se o cofre está desbloqueado e tente novamente.",
        variant: "destructive",
      });
    }
  }, [getTransactions, getDividends, getCashMovements, getPortfolios, isUnlocked, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isUnlocked) return;
    const onVaultChange = () => load();
    window.addEventListener("vault-data-changed", onVaultChange);
    return () => window.removeEventListener("vault-data-changed", onVaultChange);
  }, [isUnlocked, load]);

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const portfolioById = useMemo(() => new Map(portfolios.map((p) => [p.id, p])), [portfolios]);
  const txById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const divById = useMemo(() => new Map(dividends.map((d) => [d.id, d])), [dividends]);
  const cashById = useMemo(() => new Map(cashMovements.map((m) => [m.id, m])), [cashMovements]);

  const movements = useMemo<MovementRow[]>(() => {
    const txRows: MovementRow[] = transactions.map((t) => ({
      id: t.id,
      kind: t.type,
      category: t.type,
      label: categoryConfig[t.type].label,
      assetId: t.assetId,
      ticker: assetById.get(t.assetId)?.ticker,
      portfolioName: portfolioById.get(t.portfolioId)?.name,
      shares: t.shares,
      price: t.pricePerShare,
      total: t.totalValue,
      date: t.date,
    }));

    const divRows: MovementRow[] = dividends.map((d) => {
      const category = `dividend_${d.type}` as MovementCategory;
      return {
        id: d.id,
        kind: "dividend" as MovementKind,
        category,
        label: categoryConfig[category].label,
        assetId: d.assetId,
        ticker: assetById.get(d.assetId)?.ticker,
        portfolioName: portfolioById.get(d.portfolioId)?.name,
        shares: d.shares,
        price: d.valuePerShare,
        total: d.totalValue,
        date: d.paymentDate,
      };
    });

    const cashRows: MovementRow[] = cashMovements.map((m) => ({
      id: m.id,
      kind: m.type as MovementKind,
      category: m.type,
      label: categoryConfig[m.type].label,
      portfolioName: portfolioById.get(m.portfolioId)?.name,
      total: m.type === "withdraw" ? -m.value : m.value,
      date: m.date,
    }));

    return [...txRows, ...divRows, ...cashRows].sort((a, b) => b.date - a.date);
  }, [transactions, dividends, cashMovements, assetById, portfolioById]);

  // Available years derived from all movements
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const m of movements) years.add(new Date(m.date).getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [movements]);

  const currentYear = new Date().getFullYear();

  const [assetFilter, setAssetFilter] = useState<string>(() => searchParams.get("asset") ?? "all");
  const [categoryFilters, setCategoryFilters] = useState<MovementCategory[]>(() => {
    const fromUrl = searchParams.get("category");
    if (!fromUrl) return [];
    return fromUrl.split(",").filter(isMovementCategory) as MovementCategory[];
  });
  const [yearFilter, setYearFilter] = useState<string>(() => {
    const urlYear = searchParams.get("year");
    if (urlYear) return urlYear;
    if (searchParams.get("asset")) return "all";
    return String(currentYear);
  });

  // Sync filters <-> URL
  useEffect(() => {
    const nextAsset = searchParams.get("asset") ?? "all";
    const nextCatRaw = searchParams.get("category");
    const nextCat = nextCatRaw
      ? (nextCatRaw.split(",").filter(isMovementCategory) as MovementCategory[])
      : [];
    const urlYear = searchParams.get("year");
    // When arriving with a specific asset but no explicit year (e.g. from portfolio
    // detail), default to "all" years so the full history is visible.
    const nextYear = urlYear ?? (nextAsset !== "all" ? "all" : String(currentYear));
    if (nextAsset !== assetFilter) setAssetFilter(nextAsset);
    if (nextCat.join(",") !== categoryFilters.join(",")) setCategoryFilters(nextCat);
    if (nextYear !== yearFilter) setYearFilter(nextYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (assetFilter !== "all") next.set("asset", assetFilter);
    if (categoryFilters.length > 0) next.set("category", categoryFilters.join(","));
    if (yearFilter !== "all") next.set("year", yearFilter);
    setSearchParams(next, { replace: true });
  }, [assetFilter, categoryFilters, yearFilter, setSearchParams]);

  // Reset to page 1 when any filter changes
  const prevFiltersRef = useRef({ assetFilter, categoryFilters, yearFilter });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    if (
      prev.assetFilter !== assetFilter ||
      prev.categoryFilters.join(",") !== categoryFilters.join(",") ||
      prev.yearFilter !== yearFilter
    ) {
      setPage(1);
      prevFiltersRef.current = { assetFilter, categoryFilters, yearFilter };
    }
  }, [assetFilter, categoryFilters, yearFilter]);

  const filteredMovements = useMemo(() => {
    return movements.filter((row) => {
      if (assetFilter !== "all" && row.assetId !== assetFilter) return false;
      if (categoryFilters.length > 0 && !categoryFilters.includes(row.category)) return false;
      if (yearFilter !== "all") {
        if (new Date(row.date).getFullYear() !== Number(yearFilter)) return false;
      }
      return true;
    });
  }, [movements, assetFilter, categoryFilters, yearFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredMovements.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filteredMovements.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredMovements, safePage],
  );

  const openEdit = (row: MovementRow) => {
    if (row.kind === "buy" || row.kind === "sell") {
      const item = txById.get(row.id);
      if (!item) return;
      setEditTarget({ kind: row.kind, item });
    } else if (row.kind === "dividend") {
      const item = divById.get(row.id);
      if (!item) return;
      setEditTarget({ kind: "dividend", item });
    } else {
      const item = cashById.get(row.id);
      if (!item) return;
      setEditTarget({ kind: "cash", item });
    }
    setEditOpen(true);
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
      console.error("[Transactions] Failed to delete:", err);
      toast({ title: "Não foi possível excluir", variant: "destructive" });
    }
  };

  const monthStart = useMemo(() => startOfMonth(), []);

  const monthTotals = useMemo(() => {
    const inPeriod = filteredMovements.filter((m) => {
      if (yearFilter === "all" || Number(yearFilter) !== currentYear) {
        // For non-current years, show totals for the whole filtered set
        return true;
      }
      return m.date >= monthStart;
    });

    return {
      purchases: inPeriod.filter((m) => m.kind === "buy").reduce((s, m) => s + m.total, 0),
      sales: inPeriod.filter((m) => m.kind === "sell").reduce((s, m) => s + m.total, 0),
      proventos: inPeriod.filter((m) => m.kind === "dividend").reduce((s, m) => s + m.total, 0),
    };
  }, [filteredMovements, monthStart, yearFilter, currentYear]);

  const isCurrentYear = yearFilter === String(currentYear);
  const hasActiveFilter = assetFilter !== "all" || categoryFilters.length > 0;
  const totalsLabel =
    hasActiveFilter ? "(filtro)" : isCurrentYear ? "(mês)" : `(${yearFilter})`;

  // Assets that actually have movements in the selected year (for the filter dropdown)
  // Asset dropdown: filtered by year only (ignores active assetFilter so the user
  // can always see and switch between all assets that have movements in the period)
  const assetsWithMovements = useMemo<Asset[]>(() => {
    const assetIds = new Set<string>();
    for (const m of movements) {
      if (!m.assetId) continue;
      if (yearFilter !== "all" && new Date(m.date).getFullYear() !== Number(yearFilter)) continue;
      assetIds.add(m.assetId);
    }
    return assets.filter((a) => assetIds.has(a.id));
  }, [assets, movements, yearFilter]);

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
              {transactions.length} tx · {dividends.length} proventos · {cashMovements.length} caixa
              {filteredMovements.length !== movements.length &&
                ` · ${filteredMovements.length} filtrados`}
            </p>
          </div>
          <Button className="gap-2" onClick={() => navigate("/transactions/new")}>
            <Plus className="h-4 w-4" />
            Nova Movimentação
          </Button>
        </motion.header>

        {/* Filters */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-xl border border-border bg-card p-4 shadow-card"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Filter className="h-4 w-4" />
              Filtros
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              {/* Year filter */}
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue placeholder="Ano" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {availableYears.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Asset filter — only shows assets with movements in the period */}
              <Select value={assetFilter} onValueChange={setAssetFilter}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Todos os ativos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os ativos</SelectItem>
                  {assetsWithMovements.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.ticker}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Category filter (multi-select) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-[190px] justify-between font-normal"
                  >
                    <span className="truncate">
                      {categoryFilters.length === 0
                        ? "Todas as categorias"
                        : categoryFilters.length === 1
                          ? categoryConfig[categoryFilters[0]].label
                          : `${categoryFilters.length} categorias`}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
                  <DropdownMenuCheckboxItem
                    checked={categoryFilters.length === 0}
                    onCheckedChange={(checked) => {
                      if (checked) setCategoryFilters([]);
                    }}
                  >
                    Todas as categorias
                  </DropdownMenuCheckboxItem>

                  <DropdownMenuSeparator />

                  {categoryOrder.map((key) => {
                    const isAll = categoryFilters.length === 0;
                    const checked = !isAll && categoryFilters.includes(key);

                    return (
                      <DropdownMenuCheckboxItem
                        key={key}
                        checked={checked}
                        onCheckedChange={(nextChecked) => {
                          if (isAll) {
                            if (nextChecked) setCategoryFilters([key]);
                            return;
                          }

                          setCategoryFilters((prev) => {
                            const set = new Set(prev);
                            if (nextChecked) set.add(key);
                            else set.delete(key);
                            return Array.from(set);
                          });
                        }}
                      >
                        {categoryConfig[key].label}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAssetFilter("all");
                  setCategoryFilters([]);
                  setYearFilter(String(currentYear));
                }}
                disabled={
                  assetFilter === "all" &&
                  categoryFilters.length === 0 &&
                  yearFilter === String(currentYear)
                }
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

        {decryptIssues.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                Alguns dados não puderam ser lidos ({decryptIssues.join(", ")}). Restaure um backup
                se necessário.
              </div>
              <div className="flex items-center gap-2">
                <BackupRestoreDialog
                  trigger={<Button variant="outline" size="sm">Restaurar backup</Button>}
                />
                <Button variant="ghost" size="sm" onClick={clearDecryptIssues}>
                  Ocultar
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Summary cards */}
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
                <p className="text-sm text-muted-foreground">Compras {totalsLabel}</p>
                <p className="text-xl font-bold text-foreground tabular-nums">
                  <Blur>{formatCurrency(monthTotals.purchases)}</Blur>
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
                <p className="text-sm text-muted-foreground">Vendas {totalsLabel}</p>
                <p className="text-xl font-bold text-foreground tabular-nums">
                  <Blur>{formatCurrency(monthTotals.sales)}</Blur>
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
                <p className="text-sm text-muted-foreground">Proventos {totalsLabel}</p>
                <p className="text-xl font-bold text-foreground tabular-nums">
                  <Blur>{formatCurrency(monthTotals.proventos)}</Blur>
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* List */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-border bg-card shadow-card"
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
              pageRows.map((row, index) => {
                const config = categoryConfig[row.category];
                const Icon = config.icon;

                return (
                  <div
                    key={row.id}
                    className={cn(
                      "flex items-center justify-between p-4 transition-colors",
                      index % 2 === 0
                        ? "bg-muted/20 dark:bg-muted/10"
                        : "bg-muted/35 dark:bg-muted/20",
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
                        {typeof row.shares === "number" && typeof row.price === "number" && (
                          <p className="text-sm text-muted-foreground">
                            {row.shares} × <Blur>{formatCurrency(row.price)}</Blur>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p
                          className={cn(
                            "font-semibold tabular-nums",
                            row.total < 0 ? "text-loss" : "text-foreground",
                          )}
                        >
                          {row.total < 0 ? "-" : "+"}
                          <Blur>{formatCurrency(Math.abs(row.total))}</Blur>
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
                                <AlertDialogAction onClick={() => deleteRow(row)}>
                                  Excluir
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {filteredMovements.length > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-6 py-4">
              <p className="text-sm text-muted-foreground">
                {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, filteredMovements.length)} de{" "}
                {filteredMovements.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {safePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                >
                  Próximo
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </motion.section>
      </div>
    </DashboardLayout>
  );
}
