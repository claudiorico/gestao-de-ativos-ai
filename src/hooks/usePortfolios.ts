/**
 * Hook for managing portfolios with encrypted local storage
 * Integrates real-time prices from Brapi
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import { usePrices, type Quote } from '@/hooks/usePrices';
import type { Portfolio, Asset, Transaction } from '@/types/financial';

export interface AssetWithPrice extends Asset {
  currentPrice: number;
  currentValue: number;
  gain: number;
  gainPercent: number;
  priceChange: number;
  priceChangePercent: number;
}

export interface PortfolioWithAssets extends Portfolio {
  assets: AssetWithPrice[];
  currentValue: number;
  currentAllocation: number;
  totalGain: number;
  totalGainPercent: number;
}

export function usePortfolios() {
  const {
    isUnlocked,
    getPortfolios,
    savePortfolio,
    deletePortfolio,
    getAssets,
    getTransactions,
    notifyDataChange,
  } = useSecureStorage();

  const { quotes, fetchQuotes, isLoading: isPricesLoading, lastUpdated: quotesLastUpdated } = usePrices();

  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [portfoliosWithAssets, setPortfoliosWithAssets] = useState<PortfolioWithAssets[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);

  const derivedHoldingsByAssetId = useMemo(() => {
    // Calcula quantidade e preço médio a partir das transações.
    // Útil quando o ativo foi criado via importação e ficou com shares/averagePrice = 0.
    const map = new Map<string, { shares: number; averagePrice: number }>();
    const byAsset = new Map<string, Transaction[]>();

    for (const t of allTransactions) {
      const list = byAsset.get(t.assetId) ?? [];
      list.push(t);
      byAsset.set(t.assetId, list);
    }

    for (const [assetId, txs] of byAsset.entries()) {
      const ordered = [...txs].sort((a, b) => a.date - b.date);
      let shares = 0;
      let cost = 0;

      for (const tx of ordered) {
        const qty = Number(tx.shares ?? 0);
        const total = Number(tx.totalValue ?? 0);
        if (!Number.isFinite(qty) || qty === 0) continue;

        if (tx.type === 'buy') {
          shares += qty;
          cost += total;
        } else {
          // Reduz custo pelo preço médio atual (método custo médio)
          const avg = shares > 0 ? cost / shares : 0;
          const sellQty = Math.min(shares, qty);
          shares -= sellQty;
          cost -= avg * sellQty;
        }
      }

      if (shares > 0 && cost > 0) {
        map.set(assetId, { shares, averagePrice: cost / shares });
      }
    }

    return map;
  }, [allTransactions]);

  // Load portfolios and assets
  const loadPortfolios = useCallback(async () => {
    if (!isUnlocked) {
      setPortfolios([]);
      setPortfoliosWithAssets([]);
      setAllAssets([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const [loadedPortfolios, loadedAssets, loadedTransactions] = await Promise.all([
        getPortfolios(),
        getAssets(),
        getTransactions(),
      ]);

      setPortfolios(loadedPortfolios);
      setAllAssets(loadedAssets);
      setAllTransactions(loadedTransactions);

      // Fetch quotes for all tickers (inclui cripto e fundos CVM)
      const tickers = loadedAssets
        .filter((a) => ['stock', 'reit', 'etf', 'crypto', 'investment_fund', 'fixed_income'].includes(a.type))
        .map((a) => a.ticker);
      
      if (tickers.length > 0) {
        // Ao abrir/desbloquear o cofre, força refresh para não depender do cache/intervalo.
        await fetchQuotes(tickers, { force: true });
      }
    } catch (err) {
      setError('Erro ao carregar portfólios');
      console.error('Error loading portfolios:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isUnlocked, getPortfolios, getAssets, getTransactions, fetchQuotes]);

  // Recalculate portfolios when quotes or assets change
  useEffect(() => {
    if (portfolios.length === 0 && allAssets.length === 0) {
      setPortfoliosWithAssets([]);
      return;
    }

    // Enrich assets with current prices
    const enrichedAssets: AssetWithPrice[] = allAssets.map((asset) => {
      const derived = derivedHoldingsByAssetId.get(asset.id);
      const hasManualHoldings = (asset.shares ?? 0) > 0 && (asset.averagePrice ?? 0) > 0;

      // Se o ativo foi criado/importado com 0 e existem transações, usamos o derivado.
      const effectiveShares = hasManualHoldings ? asset.shares : (derived?.shares ?? asset.shares);
      const effectiveAveragePrice = hasManualHoldings
        ? asset.averagePrice
        : (derived?.averagePrice ?? asset.averagePrice);

      const quoteKey = String(asset.ticker ?? '')
        .trim()
        .toUpperCase();

      // Alguns usuários podem salvar tickers no formato Yahoo (ex: "HGBS11.SA").
      // O backend normaliza e devolve sem ".SA", então aqui garantimos a compatibilidade.
      const quote =
        quotes[quoteKey] ??
        quotes[quoteKey.replace(/\.SA$/i, '')];

      // Importante: não usar "||" aqui, porque quote.price pode ser 0 (falha/ausência) e isso derruba o cálculo.
      const quotedPrice =
        Number.isFinite(quote?.price) && (quote?.price ?? 0) > 0 ? (quote!.price as number) : null;
      const currentPrice = quotedPrice ?? effectiveAveragePrice;

      const currentValue = effectiveShares * currentPrice;
      const costBasis = effectiveShares * effectiveAveragePrice;
      const gain = currentValue - costBasis;
      const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0;

      return {
        ...asset,
        shares: effectiveShares,
        averagePrice: effectiveAveragePrice,
        currentPrice,
        currentValue,
        gain,
        gainPercent,
        priceChange: quote?.change || 0,
        priceChangePercent: quote?.changePercent || 0,
      };
    });

    // Calculate total portfolio value
    const totalValue = enrichedAssets.reduce((sum, a) => sum + a.currentValue, 0);
    const totalCost = allAssets.reduce((sum, a) => sum + a.shares * a.averagePrice, 0);

    // Map portfolios with their enriched assets
    const enrichedPortfolios: PortfolioWithAssets[] = portfolios.map((portfolio) => {
      const assets = enrichedAssets.filter((a) => a.portfolioId === portfolio.id);
      const currentValue = assets.reduce((sum, a) => sum + a.currentValue, 0);
      const costBasis = assets.reduce((sum, a) => sum + a.shares * a.averagePrice, 0);
      const currentAllocation = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
      const totalGain = currentValue - costBasis;
      const totalGainPercent = costBasis > 0 ? (totalGain / costBasis) * 100 : 0;

      return {
        ...portfolio,
        assets,
        currentValue,
        currentAllocation,
        totalGain,
        totalGainPercent,
      };
    });

    setPortfoliosWithAssets(enrichedPortfolios);
  }, [portfolios, allAssets, quotes, derivedHoldingsByAssetId]);

  // Create new portfolio
  const createPortfolio = useCallback(
    async (data: Omit<Portfolio, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = Date.now();
      const newPortfolio: Portfolio = {
        ...data,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      await savePortfolio(newPortfolio);
      notifyDataChange();
      await loadPortfolios();
      return newPortfolio;
    },
    [savePortfolio, notifyDataChange, loadPortfolios]
  );

  // Update existing portfolio
  const updatePortfolio = useCallback(
    async (id: string, data: Partial<Omit<Portfolio, 'id' | 'createdAt'>>) => {
      const existing = portfolios.find((p) => p.id === id);
      if (!existing) throw new Error('Portfolio não encontrado');

      const updated: Portfolio = {
        ...existing,
        ...data,
        updatedAt: Date.now(),
      };

      await savePortfolio(updated);
      notifyDataChange();
      await loadPortfolios();
      return updated;
    },
    [portfolios, savePortfolio, notifyDataChange, loadPortfolios]
  );

  // Remove portfolio
  const removePortfolio = useCallback(
    async (id: string) => {
      await deletePortfolio(id);
      notifyDataChange();
      await loadPortfolios();
    },
    [deletePortfolio, notifyDataChange, loadPortfolios]
  );

  // Load on mount and when vault unlocks
  useEffect(() => {
    loadPortfolios();
  }, [loadPortfolios]);

  // Recarrega automaticamente quando qualquer parte do cofre mudar (ex.: manutenção de tickers)
  useEffect(() => {
    if (!isUnlocked) return;

    const onVaultDataChanged = () => {
      loadPortfolios();
    };

    window.addEventListener('vault-data-changed', onVaultDataChanged);
    return () => window.removeEventListener('vault-data-changed', onVaultDataChanged);
  }, [isUnlocked, loadPortfolios]);

  // Refresh quotes periodically (every 5 minutes)
  useEffect(() => {
    if (!isUnlocked || allAssets.length === 0) return;

    const interval = setInterval(() => {
      const tickers = allAssets
        .filter((a) => ['stock', 'reit', 'etf', 'crypto', 'investment_fund', 'fixed_income'].includes(a.type))
        .map((a) => a.ticker);
      
      if (tickers.length > 0) {
        fetchQuotes(tickers);
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [isUnlocked, allAssets, fetchQuotes]);

  const refreshQuotesNow = useCallback(async () => {
    if (!isUnlocked) return;

    const tickers = allAssets
      .filter((a) => ['stock', 'reit', 'etf', 'crypto', 'investment_fund', 'fixed_income'].includes(a.type))
      .map((a) => a.ticker);

    if (tickers.length > 0) {
      await fetchQuotes(tickers, { force: true });
    }
  }, [isUnlocked, allAssets, fetchQuotes]);

  return {
    portfolios,
    portfoliosWithAssets,
    isLoading: isLoading || isPricesLoading,
    error,
    createPortfolio,
    updatePortfolio,
    removePortfolio,
    refresh: loadPortfolios,
    refreshQuotesNow,
    quotesLastUpdated,
  };
}
