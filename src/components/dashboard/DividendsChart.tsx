import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useEffect, useMemo, useState } from "react";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import type { Dividend } from "@/types/financial";

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function DividendsChart() {
  const { isUnlocked, getDividends } = useSecureStorage();
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isUnlocked) {
      setDividends([]);
      return;
    }

    let mounted = true;
    const load = async () => {
      try {
        setIsLoading(true);
        const items = await getDividends();
        if (mounted) setDividends(Array.isArray(items) ? items : []);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    load();
    const onChanged = () => load();
    window.addEventListener('vault-data-changed', onChanged);
    return () => {
      mounted = false;
      window.removeEventListener('vault-data-changed', onChanged);
    };
  }, [isUnlocked, getDividends]);

  const { data, totalProventos } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const byMonth = new Array(12).fill(0);

    for (const d of dividends) {
      const date = new Date(d.paymentDate);
      if (Number.isNaN(date.getTime())) continue;
      if (date.getFullYear() !== year) continue;
      const m = date.getMonth();
      const v = Number.isFinite(d.totalValue) ? d.totalValue : 0;
      byMonth[m] += v;
    }

    const rows = byMonth.map((proventos, idx) => ({
      month: MONTH_LABELS[idx],
      proventos,
    }));

    return {
      data: rows,
      totalProventos: byMonth.reduce((acc, v) => acc + v, 0),
    };
  }, [dividends]);

  const formattedTotal = useMemo(() => formatCurrency(totalProventos), [totalProventos]);
  const totalCurrencyMatch = formattedTotal.match(/^R\$\s*(.+)$/);
  const totalCurrencyPrefix = totalCurrencyMatch ? "R$" : null;
  const totalValueBody = totalCurrencyMatch ? totalCurrencyMatch[1] : formattedTotal;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-card sm:p-6"
    >
    <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground">
            Proventos Recebidos
          </h3>
          <p className="text-sm text-muted-foreground">
            Histórico mensal de dividendos e JCP
          </p>
        </div>

        <div className="min-w-0 text-left sm:text-right">
          <div className="flex min-w-0 items-start gap-1 sm:justify-end">
            {totalCurrencyPrefix ? (
              <span className="mt-0.5 shrink-0 text-[10px] font-semibold leading-none text-muted-foreground sm:mt-1 sm:text-sm">
                {totalCurrencyPrefix}
              </span>
            ) : null}
            <p className="min-w-0 whitespace-normal break-words text-lg font-bold leading-snug tracking-tight text-foreground tabular-nums sm:text-2xl sm:leading-none">
              {totalValueBody}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {isLoading ? 'Carregando…' : 'Total no ano'}
          </p>
        </div>
      </div>

    <div className="h-[200px] min-w-0 w-full overflow-hidden sm:h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 0, left: -10, bottom: 5 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              vertical={false}
            />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={(value) =>
                new Intl.NumberFormat("pt-BR", {
                  notation: "compact",
                  maximumFractionDigits: 0,
                }).format(value)
              }
              width={50}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--background))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
              formatter={(value: number) => [formatCurrency(value), "Proventos"]}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              cursor={{ fill: "hsl(var(--primary) / 0.1)" }}
            />
            <Bar
              dataKey="proventos"
              fill="hsl(var(--primary))"
              radius={[6, 6, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
