import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface AllocationData {
  portfolioId?: string;
  name: string;
  value: number;
  color: string;
  amount: number;
}

interface AllocationChartProps {
  data: AllocationData[];
  totalValue: number;
  onSelectPortfolio?: (portfolioId: string) => void;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

export function AllocationChart({ data, totalValue, onSelectPortfolio }: AllocationChartProps) {
  if (!data.length) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
        className="rounded-xl border border-border bg-card p-6 shadow-card"
      >
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground">
            Alocação por Carteira
          </h3>
          <p className="text-sm text-muted-foreground">
            Distribuição atual do portfólio
          </p>
        </div>
        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
          Nenhuma carteira cadastrada
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4 }}
      className="rounded-xl border border-border bg-card p-6 shadow-card"
    >
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground">
          Alocação por Carteira
        </h3>
        <p className="text-sm text-muted-foreground">
          Distribuição atual do portfólio
        </p>
      </div>

      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <div className="mx-auto h-[220px] w-full max-w-[220px] sm:mx-0 sm:h-[260px] sm:max-w-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={3}
                dataKey="value"
                stroke="none"
                style={{ cursor: onSelectPortfolio ? "pointer" : "default" }}
                onClick={(slice) => {
                  const pid = (slice as { payload?: AllocationData })?.payload?.portfolioId;
                  if (pid && onSelectPortfolio) onSelectPortfolio(pid);
                }}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "12px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                }}
                formatter={(
                  value: number,
                  name: string,
                  props: { payload: AllocationData }
                ) => [
                  `${value}% - ${formatCurrency(props.payload.amount)}`,
                  props.payload.name,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="w-full flex-1 space-y-3 min-w-0">
          {data.map((item, index) => (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.5 + index * 0.1 }}
              className="flex items-start justify-between gap-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {item.name}
                </span>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-sm font-semibold text-foreground tabular-nums">
                  {item.value}%
                </span>
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  {formatCurrency(item.amount)}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
