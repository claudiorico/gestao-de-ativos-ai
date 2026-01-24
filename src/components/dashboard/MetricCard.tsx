import { ReactNode } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string;
  change?: number;
  changeLabel?: string;
  icon: ReactNode;
  variant?: "default" | "success" | "loss" | "warning";
  delay?: number;
}

export function MetricCard({
  title,
  value,
  change,
  changeLabel = "vs. mês anterior",
  icon,
  variant = "default",
  delay = 0,
}: MetricCardProps) {
  const isPositive = change && change > 0;
  const isNegative = change && change < 0;
  const isNeutral = change === 0;

  const variantStyles = {
    default: "bg-card",
    success: "bg-success-muted",
    loss: "bg-loss-muted",
    warning: "bg-warning-muted",
  };

  const iconContainerStyles = {
    default: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    loss: "bg-loss/10 text-loss",
    warning: "bg-warning/10 text-warning",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative overflow-hidden rounded-xl border border-border p-6 shadow-card transition-shadow hover:shadow-card-hover",
        variantStyles[variant]
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-3">
          <p className="truncate text-sm font-medium text-muted-foreground">{title}</p>
          <p className="break-words text-2xl font-bold tracking-tight text-foreground tabular-nums sm:text-3xl">
            {value}
          </p>
          {change !== undefined && (
            <div className="flex flex-wrap items-center gap-1.5">
              <div
                className={cn(
                  "flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium",
                  isPositive && "bg-success/10 text-success",
                  isNegative && "bg-loss/10 text-loss",
                  isNeutral && "bg-muted text-muted-foreground"
                )}
              >
                {isPositive && <TrendingUp className="h-3 w-3" />}
                {isNegative && <TrendingDown className="h-3 w-3" />}
                {isNeutral && <Minus className="h-3 w-3" />}
                <span>{Math.abs(change).toFixed(2)}%</span>
              </div>
              <span className="text-xs text-muted-foreground">{changeLabel}</span>
            </div>
          )}
        </div>
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
            iconContainerStyles[variant]
          )}
        >
          {icon}
        </div>
      </div>

      {/* Decorative gradient */}
      <div
        className={cn(
          "absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl",
          variant === "success" && "bg-success",
          variant === "loss" && "bg-loss",
          variant === "warning" && "bg-warning",
          variant === "default" && "bg-primary"
        )}
      />
    </motion.div>
  );
}
