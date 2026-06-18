/**
 * Hook for managing portfolios with encrypted local storage
 * Integrates real-time prices from Brapi
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import { usePrices, type Quote } from '@/hooks/usePrices';
import type { Asset, Portfolio, Transaction } from '@/types/financial';
import {
  buildPortfolioDataSignature,
  computePortfolioSummaries,
  isPricedAssetType,
  type AssetWithPrice,
  type PortfolioDisplaySnapshot,
  type PortfolioWithAssets,
} from '@/lib/portfolio-summary';

export type { AssetWithPrice, PortfolioWithAssets };

interface LoadedPortfolioData {
  portfolios: Portfolio[];
  assets: Asset[];
  transactions: Transaction[];
  dataSignature: string;
  loadedAt: number;
}

function getPricedTickers(assets: Asset[]) {
  return assets.filter((a) => isPricedAssetType(a.type)).map((a) => a.ticker);
}

export function usePortfolios() {
  const {
    isUnlocked,
    getPortfolios,
    savePortfolio,
    deletePortfolio,
    getAssets,
    getTransactions,
    getPortfolioDisplaySnapshot,
    savePortfolioDisplaySnapshot,
  } = useSecureStorage();

  const { quotes, fetchQuotes, isLoading: isPricesLoading, lastUpdated: quotesLastUpdated } = usePrices();

  const [portfolioData, setPortfolioData] = useState<LoadedPortfolioData | null>(null);
  const [portfoliosWithAssets, setPortfoliosWithAssets] = useState<PortfolioWithAssets[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasDisplayDataRef = useRef(false);

  const portfolios = useMemo<Portfolio[]>(() => {
    if (portfolioData) return portfolioData.portfolios;

    return portfoliosWithAssets.map(({ assets, currentValue, currentAllocation, totalGain, totalGainPercent, ...portfolio }) => portfolio);
  }, [portfolioData, portfoliosWithAssets]);
  const allAssets = portfolioData?.assets ?? [];

  const applyDisplaySnapshot = useCallback((snapshot: PortfolioDisplaySnapshot) => {
    setPortfoliosWithAssets(snapshot.portfoliosWithAssets);
    hasDisplayDataRef.current = true;
    setIsLoading(false);
  }, []);

  const loadCachedSnapshot = useCallback(async () => {
    if (!isUnlocked) return;

    const snapshot = await getPortfolioDisplaySnapshot();
    if (snapshot) {
      applyDisplaySnapshot(snapshot);
    }
  }, [applyDisplaySnapshot, getPortfolioDisplaySnapshot, isUnlocked]);

  const loadPortfolios = useCallback(async (opts?: { forceQuotes?: boolean; silent?: boolean }) => {
    if (!isUnlocked) {
      setPortfolioData(null);
      setPortfoliosWithAssets([]);
      hasDisplayDataRef.current = false;
      setIsLoading(false);
      return;
    }

    try {
      // When a cached display snapshot exists, keep it visible while the fresh
      // encrypted data is loaded and recalculated.
      if (!opts?.silent && !hasDisplayDataRef.current) setIsLoading(true);
      setError(null);

      const [loadedPortfolios, loadedAssets, loadedTransactions] = await Promise.all([
        getPortfolios(),
        getAssets(),
        getTransactions(),
      ]);

      const dataSignature = buildPortfolioDataSignature({
        portfolios: loadedPortfolios,
        assets: loadedAssets,
        transactions: loadedTransactions,
      });

      setPortfolioData({
        portfolios: loadedPortfolios,
        assets: loadedAssets,
        transactions: loadedTransactions,
        dataSignature,
        loadedAt: Date.now(),
      });

      if (!opts?.silent) setIsLoading(false);

      const tickers = getPricedTickers(loadedAssets);
      if (tickers.length > 0) {
        void fetchQuotes(tickers, { force: opts?.forceQuotes === true });
      }
    } catch (err) {
      setError('Erro ao carregar portfólios');
      console.error('Error loading portfolios:', err);
    } finally {
      if (!opts?.silent) setIsLoading(false);
    }
  }, [
    fetchQuotes,
    getAssets,
    getPortfolios,
    getTransactions,
    isUnlocked,
  ]);

  const calculatedPortfolios = useMemo(() => {
    if (!portfolioData) return null;

    return computePortfolioSummaries({
      portfolios: portfolioData.portfolios,
      assets: portfolioData.assets,
      transactions: portfolioData.transactions,
      quotes: quotes as Record<string, Quote | undefined>,
    });
  }, [portfolioData, quotes]);

  useEffect(() => {
    if (!portfolioData || !calculatedPortfolios) return;

    setPortfoliosWithAssets(calculatedPortfolios);
    hasDisplayDataRef.current = true;
    setIsLoading(false);

    const snapshot: PortfolioDisplaySnapshot = {
      portfoliosWithAssets: calculatedPortfolios,
      dataSignature: portfolioData.dataSignature,
      quotesUpdatedAt: quotesLastUpdated?.toISOString() ?? null,
      calculatedAt: Date.now(),
    };

    savePortfolioDisplaySnapshot(snapshot).catch((err) => {
      console.warn('[usePortfolios] Failed to save display snapshot', err);
    });
  }, [calculatedPortfolios, portfolioData, quotesLastUpdated, savePortfolioDisplaySnapshot]);

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
      await loadPortfolios({ silent: true });
      return newPortfolio;
    },
    [savePortfolio, loadPortfolios]
  );

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
      await loadPortfolios({ silent: true });
      return updated;
    },
    [portfolios, savePortfolio, loadPortfolios]
  );

  const removePortfolio = useCallback(
    async (id: string) => {
      await deletePortfolio(id);
      await loadPortfolios({ silent: true });
    },
    [deletePortfolio, loadPortfolios]
  );

  useEffect(() => {
    if (!isUnlocked) {
      setPortfolioData(null);
      setPortfoliosWithAssets([]);
      hasDisplayDataRef.current = false;
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const hydrate = async () => {
      try {
        await loadCachedSnapshot();
      } catch (err) {
        console.warn('[usePortfolios] Failed to load display snapshot', err);
      }

      if (!cancelled) {
        await loadPortfolios({ forceQuotes: true });
      }
    };

    hydrate().catch((err) => {
      console.error('[usePortfolios] Failed to hydrate portfolios', err);
    });

    return () => {
      cancelled = true;
    };
  }, [isUnlocked, loadCachedSnapshot, loadPortfolios]);

  const reloadDebounceRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!isUnlocked) return;

    const onVaultDataChanged = () => {
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
      reloadDebounceRef.current = setTimeout(() => {
        loadPortfolios({ silent: true });
      }, 600);
    };

    window.addEventListener('vault-data-changed', onVaultDataChanged);
    return () => {
      window.removeEventListener('vault-data-changed', onVaultDataChanged);
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
    };
  }, [isUnlocked, loadPortfolios]);

  useEffect(() => {
    if (!isUnlocked || allAssets.length === 0) return;

    const interval = setInterval(() => {
      const tickers = getPricedTickers(allAssets);
      if (tickers.length > 0) {
        fetchQuotes(tickers);
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [isUnlocked, allAssets, fetchQuotes]);

  const refreshQuotesNow = useCallback(async () => {
    if (!isUnlocked) return;

    const tickers = getPricedTickers(allAssets);
    if (tickers.length > 0) {
      await fetchQuotes(tickers, { force: true });
    }
  }, [isUnlocked, allAssets, fetchQuotes]);

  return {
    portfolios,
    portfoliosWithAssets,
    isLoading,
    isPricesLoading,
    error,
    createPortfolio,
    updatePortfolio,
    removePortfolio,
    refresh: loadPortfolios,
    refreshQuotesNow,
    quotesLastUpdated,
  };
}
