import { motion } from "framer-motion";
import { Blur } from "@/components/ui/blur";

interface AssetData {
  ticker: string;
  name: string;
  value: number;
  price: number;
  change: number;
  allocation: number;
}

interface TopAssetsProps {
  assets: AssetData[];
  totalValue: number;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

export function TopAssets({ assets, totalValue }: TopAssetsProps) {
  if (!assets.length) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.6 }}
        className="min-w-0 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-card sm:p-6"
      >
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground">
            Maiores Posições
          </h3>
          <p className="text-sm text-muted-foreground">
            Top 5 ativos por valor
          </p>
        </div>
        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
          Nenhum ativo cadastrado
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.6 }}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-foreground">
          Maiores Posições
        </h3>
        <p className="text-sm text-muted-foreground">
          Top {assets.length} ativos por valor
        </p>
      </div>

      <div className="space-y-4">
        {assets.map((asset, index) => {
          const formatted = formatCurrency(asset.value);
          const match = formatted.match(/^R\$\s*(.+)$/);
          const prefix = match ? "R$" : null;
          const body = match ? match[1] : formatted;

          return (
            <motion.div
              key={asset.ticker}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.7 + index * 0.1 }}
              className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:p-4"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-mono text-sm font-bold text-primary">
                  {asset.ticker.slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">
                    {asset.name}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {asset.ticker}
                  </p>
                </div>
              </div>

              <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-6">
                <div className="flex items-baseline gap-2 text-left sm:flex-col sm:text-right">
                  <p className="font-semibold text-foreground tabular-nums">
                    {asset.allocation.toFixed(1)}%
                  </p>
                  <div className="flex min-w-0 items-baseline gap-1">
                    {prefix ? (
                      <span className="shrink-0 text-[10px] font-semibold leading-none text-muted-foreground">
                        {prefix}
                      </span>
                    ) : null}
                    <p className="min-w-0 truncate text-[11px] leading-none text-muted-foreground tabular-nums sm:text-xs">
                      <Blur>{body}</Blur>
                    </p>
                  </div>
                </div>

                <div className="w-full sm:w-20">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(asset.allocation * 5, 100)}%` }}
                      transition={{ duration: 0.5, delay: 0.8 + index * 0.1 }}
                      className="h-full rounded-full bg-primary"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
