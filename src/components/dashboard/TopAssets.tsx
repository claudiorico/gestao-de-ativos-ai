import { motion } from "framer-motion";

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
        className="rounded-xl border border-border bg-card p-6 shadow-card"
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
      className="rounded-xl border border-border bg-card p-6 shadow-card"
    >
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground">
          Maiores Posições
        </h3>
        <p className="text-sm text-muted-foreground">
          Top {assets.length} ativos por valor
        </p>
      </div>

      <div className="space-y-4">
        {assets.map((asset, index) => {
          return (
            <motion.div
              key={asset.ticker}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.7 + index * 0.1 }}
              className="flex items-center justify-between rounded-lg border border-border/50 p-4 transition-colors hover:bg-muted/30"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 font-mono text-sm font-bold text-primary">
                  {asset.ticker.slice(0, 2)}
                </div>
                <div className="min-w-0 max-w-[140px] sm:max-w-[200px]">
                  <p className="font-semibold text-foreground truncate">
                    {asset.name}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {asset.ticker}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="font-semibold text-foreground tabular-nums">
                    {asset.allocation.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(asset.value)}
                  </p>
                </div>

                <div className="w-20">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">Alocação</span>
                    <span className="font-medium text-foreground tabular-nums">
                      {asset.allocation.toFixed(1)}%
                    </span>
                  </div>
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
