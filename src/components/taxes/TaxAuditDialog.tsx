import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Blur } from "@/components/ui/blur";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  GainOperationAudit,
  MonthlyApuration,
  MonthlyCategoryApuration,
  TaxCategory,
} from "@/lib/tax-engine";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

const formatDateTime = (ms: number) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(ms));

function categoryLabel(cat: TaxCategory) {
  if (cat === "B3_EQUITIES") return "Ações/ETFs";
  if (cat === "B3_FII") return "FIIs";
  return "Cripto";
}

function sumWarnings(cat: MonthlyCategoryApuration) {
  const opWarnings = cat.operations.flatMap((o) => o.warnings.map((w) => `${o.ticker}: ${w}`));
  return [...cat.warnings, ...opWarnings];
}

function CategorySummary({ cat }: { cat: MonthlyCategoryApuration }) {
  const warnings = useMemo(() => sumWarnings(cat), [cat]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">Vendas (bruto)</p>
          <p className="mt-1 font-semibold tabular-nums text-foreground">
            {cat.salesTotalGross > 0 ? <Blur>{formatCurrency(cat.salesTotalGross)}</Blur> : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">Resultado do mês</p>
          <p className="mt-1 font-semibold tabular-nums text-foreground">
            {cat.netResult !== 0 ? <Blur>{formatCurrency(cat.netResult)}</Blur> : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">Compensação usada</p>
          <p className="mt-1 font-semibold tabular-nums text-foreground">
            {cat.lossUsed > 0 ? <Blur>{formatCurrency(cat.lossUsed)}</Blur> : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">Imposto (categoria)</p>
          <p className="mt-1 font-semibold tabular-nums text-foreground">
            {cat.taxDue > 0 ? <Blur>{formatCurrency(cat.taxDue)}</Blur> : "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {cat.isExempt ? (
          <Badge variant="secondary">Isento</Badge>
        ) : (
          <Badge variant="outline">Tributável</Badge>
        )}
        {cat.exemptReason ? <span className="text-xs text-muted-foreground">{cat.exemptReason}</span> : null}
        {!cat.isExempt && cat.taxableBase > 0 ? (
          <span className="text-xs text-muted-foreground">
            Base: <span className="font-medium text-foreground tabular-nums"><Blur>{formatCurrency(cat.taxableBase)}</Blur></span>
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          Prejuízo: <span className="font-medium text-foreground tabular-nums"><Blur>{formatCurrency(cat.lossCarryIn)}</Blur></span>
          {" → "}
          <span className="font-medium text-foreground tabular-nums"><Blur>{formatCurrency(cat.lossCarryOut)}</Blur></span>
        </span>
      </div>

      <div className="rounded-lg border border-border">
        <div className="border-b border-border p-3">
          <p className="text-sm font-semibold text-foreground">Vendas auditadas</p>
          <p className="text-xs text-muted-foreground">
            Cada linha representa uma venda (lucro = venda líquida − custo proporcional do preço médio).
          </p>
        </div>

        {cat.operations.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Nenhuma venda registrada nesta categoria no mês.</div>
        ) : (
          <div className="max-h-[45vh] overflow-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Data
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ativo
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Qtde
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    PM antes
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Venda bruta
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Taxas
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Venda líquida
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Custo
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ganho
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Avisos
                  </th>
                </tr>
              </thead>
              <tbody>
                {cat.operations.map((op) => (
                  <OperationRow key={op.transactionId} op={op} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {warnings.length > 0 ? (
          <div className="border-t border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avisos</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OperationRow({ op }: { op: GainOperationAudit }) {
  const avgBefore = op.positionBefore.avgCost;

  return (
    <tr className="border-b border-border/50 last:border-b-0">
      <td className="px-3 py-2 text-xs text-foreground tabular-nums">{formatDateTime(op.date)}</td>
      <td className="px-3 py-2 text-xs font-medium text-foreground">{op.ticker}</td>
      <td className="px-3 py-2 text-right text-xs text-foreground tabular-nums">{op.quantity}</td>
      <td className="px-3 py-2 text-right text-xs text-foreground tabular-nums">
        {avgBefore > 0 ? <Blur>{formatCurrency(avgBefore)}</Blur> : "—"}
      </td>
      <td className="px-3 py-2 text-right text-xs text-foreground tabular-nums"><Blur>{formatCurrency(op.proceedsGross)}</Blur></td>
      <td className="px-3 py-2 text-right text-xs text-foreground tabular-nums">{op.fees ? <Blur>{formatCurrency(op.fees)}</Blur> : "—"}</td>
      <td className="px-3 py-2 text-right text-xs text-foreground tabular-nums"><Blur>{formatCurrency(op.proceedsNet)}</Blur></td>
      <td className="px-3 py-2 text-right text-xs text-foreground tabular-nums"><Blur>{formatCurrency(op.costBasis)}</Blur></td>
      <td
        className={cn(
          "px-3 py-2 text-right text-xs font-semibold tabular-nums",
          op.gain > 0 ? "text-success" : op.gain < 0 ? "text-loss" : "text-muted-foreground",
        )}
      >
        {op.gain !== 0 ? <Blur>{formatCurrency(op.gain)}</Blur> : "—"}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {op.warnings.length ? op.warnings.join("; ") : "—"}
      </td>
    </tr>
  );
}

export function TaxAuditDialog({
  open,
  onOpenChange,
  month,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: MonthlyApuration | null;
  title: string;
}) {
  const categories = month?.categories;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Trilhas de auditoria por categoria: vendas, custo médio, ganhos, isenções e compensações.
          </DialogDescription>
        </DialogHeader>

        {!month || !categories ? (
          <div className="text-sm text-muted-foreground">Sem dados para exibir.</div>
        ) : (
          <Tabs defaultValue="B3_EQUITIES" className="w-full">
            <TabsList className="w-full justify-start">
              {(Object.keys(categories) as TaxCategory[]).map((cat) => (
                <TabsTrigger key={cat} value={cat}>
                  {categoryLabel(cat)}
                </TabsTrigger>
              ))}
            </TabsList>

            {(Object.keys(categories) as TaxCategory[]).map((cat) => (
              <TabsContent key={cat} value={cat} className="mt-4">
                <CategorySummary cat={categories[cat]} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
