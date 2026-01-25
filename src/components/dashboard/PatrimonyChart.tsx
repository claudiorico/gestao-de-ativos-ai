import { motion } from "framer-motion";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { useMemo } from "react";

interface PatrimonyChartProps {
  totalValue: number;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
};

export function PatrimonyChart({ totalValue }: PatrimonyChartProps) {
  // Generate simulated historical data based on current value
  // In a real app, this would come from transaction history
  const data = useMemo(() => {
    if (totalValue === 0) {
      return [];
    }

    const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const currentMonth = new Date().getMonth();
    
    // Show last 6 months with simulated growth
    const result = [];
    for (let i = 5; i >= 0; i--) {
      const monthIndex = (currentMonth - i + 12) % 12;
      const growthFactor = 1 - (i * 0.05); // Simulate growth over time
      result.push({
        month: months[monthIndex],
        patrimonio: Math.round(totalValue * growthFactor),
      });
    }
    
    return result;
  }, [totalValue]);

  if (data.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="min-w-0 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-card sm:p-6"
      >
        <div className="mb-4 sm:mb-6">
          <h3 className="text-lg font-semibold text-foreground">
            Evolução Patrimonial
          </h3>
          <p className="text-sm text-muted-foreground">
            Histórico do patrimônio
          </p>
        </div>
          <div className="flex min-w-0 items-center justify-center h-[240px] overflow-hidden text-muted-foreground sm:h-[300px]">
          Nenhum dado disponível
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-card sm:p-6"
    >
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Evolução Patrimonial
          </h3>
          <p className="text-sm text-muted-foreground">
            Últimos 6 meses
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">Patrimônio</span>
          </div>
        </div>
      </div>

      <div className="h-[240px] min-w-0 w-full overflow-hidden sm:h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 0, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="colorPatrimonio" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(152, 60%, 40%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(152, 60%, 40%)" stopOpacity={0} />
              </linearGradient>
            </defs>
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
              tickFormatter={formatCurrency}
              width={60}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
              formatter={(value: number) => [formatCurrency(value), "Patrimônio"]}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
            />
            <Area
              type="monotone"
              dataKey="patrimonio"
              stroke="hsl(152, 60%, 40%)"
              strokeWidth={3}
              fill="url(#colorPatrimonio)"
              dot={false}
              activeDot={{ r: 6, fill: "hsl(152, 60%, 40%)", stroke: "#fff", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
