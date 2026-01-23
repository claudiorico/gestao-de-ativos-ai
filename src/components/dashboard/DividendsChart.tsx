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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
      className="rounded-xl border border-border bg-card p-6 shadow-card"
    >
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Proventos Recebidos
          </h3>
          <p className="text-sm text-muted-foreground">
            Histórico mensal de dividendos e JCP
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {formatCurrency(totalProventos)}
          </p>
          <p className="text-xs text-muted-foreground">
            {isLoading ? 'Carregando…' : 'Total no ano'}
          </p>
        </div>
      </div>

      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
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
