import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { PatrimonyChart } from "@/components/dashboard/PatrimonyChart";
import { AllocationChart } from "@/components/dashboard/AllocationChart";
import { DividendsChart } from "@/components/dashboard/DividendsChart";
import { TopAssets } from "@/components/dashboard/TopAssets";
import { AssetsGainsTable } from "@/components/dashboard/AssetsGainsTable";
import { motion } from "framer-motion";
import { Wallet, TrendingUp, PiggyBank, Loader2 } from "lucide-react";
import { usePortfolios } from "@/hooks/usePortfolios";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { computeAssetDayGain } from "@/lib/portfolio-summary";

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

const Index = () => {
  const navigate = useNavigate();
  const { isUnlocked } = useSecureStorage();
  const { portfoliosWithAssets, isLoading } = usePortfolios();
  const [showHeavySections, setShowHeavySections] = useState(false);

  useEffect(() => {
    if (!portfoliosWithAssets.length) {
      setShowHeavySections(false);
      return;
    }

    const schedule = (callback: () => void) => {
      if ("requestIdleCallback" in window) {
        return window.requestIdleCallback(callback, { timeout: 1500 });
      }
      return window.setTimeout(callback, 250);
    };

    const cancel = (handle: number) => {
      if ("cancelIdleCallback" in window) {
        window.cancelIdleCallback(handle);
        return;
      }
      window.clearTimeout(handle);
    };

    const handle = schedule(() => setShowHeavySections(true));
    return () => cancel(handle);
  }, [portfoliosWithAssets.length]);

  // Calculate real metrics from portfolios
  const metrics = useMemo(() => {
    if (!portfoliosWithAssets.length) {
      return {
        totalValue: 0,
        totalCost: 0,
        totalGain: 0,
        totalGainPercent: 0,
        dayGain: 0,
        dayGainPercent: 0,
      };
    }

    let totalValue = 0;
    let totalCost = 0;
    let dayGain = 0;
    let totalGain = 0;

    portfoliosWithAssets.forEach((portfolio) => {
      totalValue += Number.isFinite(portfolio.currentValue) ? portfolio.currentValue : 0;
      totalGain += Number.isFinite(portfolio.totalGain) ? portfolio.totalGain : 0;

      portfolio.assets.forEach((asset) => {
        dayGain += computeAssetDayGain(asset);
      });
    });

    totalCost = totalValue - totalGain;
    const totalGainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    const dayGainPercent = totalValue > 0 ? (dayGain / totalValue) * 100 : 0;

    return {
      totalValue,
      totalCost,
      totalGain,
      totalGainPercent,
      dayGain,
      dayGainPercent,
    };
  }, [portfoliosWithAssets]);

  // Get all assets for TopAssets component
  const allAssets = useMemo(() => {
    const assets: Array<{
      ticker: string;
      name: string;
      value: number;
      price: number;
      change: number;
      allocation: number;
    }> = [];

    portfoliosWithAssets.forEach((portfolio) => {
      portfolio.assets.forEach((asset) => {
        const currentPrice = asset.currentPrice ?? asset.averagePrice;
        const value = asset.shares * currentPrice;
        assets.push({
          ticker: asset.ticker,
          name: asset.name,
          value,
          price: currentPrice,
          change: asset.priceChangePercent ?? 0,
          allocation: metrics.totalValue > 0 ? (value / metrics.totalValue) * 100 : 0,
        });
      });
    });

    // Sort by value descending and take top 5
    return assets.sort((a, b) => b.value - a.value).slice(0, 5);
  }, [portfoliosWithAssets, metrics.totalValue]);

  // Get allocation data for pie chart
  const allocationData = useMemo(() => {
    const colors = [
      "hsl(152, 60%, 40%)",
      "hsl(200, 70%, 50%)",
      "hsl(280, 60%, 55%)",
      "hsl(38, 92%, 50%)",
      "hsl(0, 72%, 51%)",
      "hsl(170, 60%, 45%)",
      "hsl(250, 60%, 55%)",
    ];

    return portfoliosWithAssets.map((portfolio, index) => ({
      portfolioId: portfolio.id,
      name: portfolio.name,
      value: metrics.totalValue > 0 
        ? Number(((portfolio.currentValue / metrics.totalValue) * 100).toFixed(1))
        : 0,
      color: portfolio.color || colors[index % colors.length],
      amount: portfolio.currentValue,
    }));
  }, [portfoliosWithAssets, metrics.totalValue]);

  if (!isUnlocked) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            Desbloqueie o cofre para acessar seu dashboard.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  const hasData = portfoliosWithAssets.length > 0;

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6">
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">
            {hasData 
              ? "Visão geral do seu portfólio de investimentos"
              : "Crie suas carteiras na página Portfólio para começar"}
          </p>
        </motion.div>

        {/* Metrics Grid */}
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            title="Patrimônio Total"
            value={formatCurrency(metrics.totalValue)}
            icon={<Wallet className="h-5 w-5" />}
            variant={hasData ? "success" : "default"}
            delay={0}
          />
          <MetricCard
            title="Lucro do Dia"
            value={formatCurrency(metrics.dayGain)}
            change={metrics.dayGainPercent}
            changeLabel="hoje"
            icon={<TrendingUp className="h-5 w-5" />}
            variant={metrics.dayGain >= 0 ? "success" : "loss"}
            delay={0.1}
          />
          <MetricCard
            title="Lucro/Prejuízo Total"
            value={formatCurrency(metrics.totalGain)}
            change={metrics.totalGainPercent}
            changeLabel="total"
            icon={<PiggyBank className="h-5 w-5" />}
            variant={metrics.totalGain >= 0 ? "success" : "loss"}
            delay={0.2}
          />
        </div>

        {hasData && (
          <>
            {/* Charts */}
            <div className="grid min-w-0 gap-4 sm:gap-6">
              <AllocationChart
                data={allocationData}
                totalValue={metrics.totalValue}
                onSelectPortfolio={(portfolioId) => navigate(`/portfolio/${portfolioId}`)}
              />
              <PatrimonyChart totalValue={metrics.totalValue} />
            </div>

            {showHeavySections && (
              <>
                {/* Bottom Row */}
                <div className="grid min-w-0 gap-4 sm:gap-6 lg:grid-cols-2">
                  <DividendsChart />
                  <TopAssets assets={allAssets} totalValue={metrics.totalValue} />
                </div>

                {/* Assets Gains Table */}
                {portfoliosWithAssets.some((p) => p.assets.length > 0) && (
                  <AssetsGainsTable portfolios={portfoliosWithAssets} />
                )}
              </>
            )}
          </>
        )}

        {!hasData && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <Wallet className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Nenhum dado disponível
            </h3>
            <p className="text-muted-foreground max-w-md">
              Acesse a página <strong>Portfólio</strong> para criar suas carteiras e adicionar ativos.
              Os dados aparecerão automaticamente aqui.
            </p>
          </motion.div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Index;
