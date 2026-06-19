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
  computeAssetPositions,
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

type IdleCallbackHandle = ReturnType<typeof setTimeout> | number;

function getPricedTickers(
  assets: Asset[],
  positionsByAssetId?: Map<string, { shares: number }>
) {
  return assets
    .filter((asset) => {
      if (!isPricedAssetType(asset.type)) return false;

      const position = positionsByAssetId?.get(asset.id);
      const shares = position ? position.shares : asset.shares;
      return Number.isFinite(shares) && shares > 1e-8;
    })
    .map((a) => a.ticker);
}

function getQuoteForTicker(quotes: Record<string, Quote | undefined>, ticker: string) {
  const key = String(ticker ?? '').trim().toUpperCase();
  return quotes[key] ?? quotes[key.replace(/\.SA$/i, '')];
}

function scheduleIdleTask(callback: () => void): IdleCallbackHandle {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    return window.requestIdleCallback(callback, { timeout: 2500 });
  }

  return setTimeout(callback, 500);
}

function cancelIdleTask(handle: IdleCallbackHandle) {
  if (typeof window !== 'undefined' && 'cancelIdleCallback' in window && typeof handle === 'number') {
    window.cancelIdleCallback(handle);
    return;
  }

  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function toLightweightSnapshotPortfolios(portfolios: PortfolioWithAssets[]): PortfolioWithAssets[] {
  return portfolios.map((portfolio) => ({
    ...portfolio,
    assets: [],
  }));
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
  const snapshotSaveHandleRef = useRef<IdleCallbackHandle | null>(null);
  const lastSavedSnapshotKeyRef = useRef<string | null>(null);

  const portfolios = useMemo<Portfolio[]>(() => {
    if (portfolioData) return portfolioData.portfolios;

    return portfoliosWithAssets.map(({ assets, openCostBasis, currentValue, currentAllocation, totalGain, totalGainPercent, ...portfolio }) => portfolio);
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
    if (snapshot && (snapshot.hasQuoteData === true || !!snapshot.quotesUpdatedAt)) {
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

      if (!opts?.silent && hasDisplayDataRef.current) setIsLoading(false);

      const loadedPositionsByAssetId = computeAssetPositions(loadedTransactions);
      const tickers = getPricedTickers(loadedAssets, loadedPositionsByAssetId);
      if (tickers.length > 0) {
        const fetch = () => void fetchQuotes(tickers, { force: opts?.forceQuotes === true });
        scheduleIdleTask(fetch);
      }
    } catch (err) {
      setError('Erro ao carregar portfólios');
      console.error('Error loading portfolios:', err);
      if (!opts?.silent) setIsLoading(false);
    } finally {
      if (!opts?.silent && hasDisplayDataRef.current) setIsLoading(false);
    }
  }, [
    fetchQuotes,
    getAssets,
    getPortfolios,
    getTransactions,
    isUnlocked,
  ]);

  const computedPositionsByAssetId = useMemo(() => {
    return portfolioData ? computeAssetPositions(portfolioData.transactions) : undefined;
  }, [portfolioData]);

  const calculatedPortfolios = useMemo(() => {
    if (!portfolioData) return null;

    return computePortfolioSummaries({
      portfolios: portfolioData.portfolios,
      assets: portfolioData.assets,
      transactions: portfolioData.transactions,
      positionsByAssetId: computedPositionsByAssetId,
      quotes: quotes as Record<string, Quote | undefined>,
    });
  }, [computedPositionsByAssetId, portfolioData, quotes]);

  const pricedTickers = useMemo(
    () => (portfolioData ? getPricedTickers(portfolioData.assets, computedPositionsByAssetId) : []),
    [computedPositionsByAssetId, portfolioData]
  );

  const hasQuoteDataForSnapshot = useMemo(() => {
    if (pricedTickers.length === 0) return true;
    return pricedTickers.every((ticker) => !!getQuoteForTicker(quotes, ticker));
  }, [pricedTickers, quotes]);

  useEffect(() => {
    if (!portfolioData || !calculatedPortfolios) return;

    if (!hasQuoteDataForSnapshot) {
      if (!hasDisplayDataRef.current) setIsLoading(true);
      return;
    }

    setPortfoliosWithAssets(calculatedPortfolios);
    hasDisplayDataRef.current = true;
    setIsLoading(false);

    const snapshot: PortfolioDisplaySnapshot = {
      portfoliosWithAssets: toLightweightSnapshotPortfolios(calculatedPortfolios),
      dataSignature: portfolioData.dataSignature,
      quotesUpdatedAt: quotesLastUpdated?.toISOString() ?? null,
      hasQuoteData: true,
      calculatedAt: Date.now(),
    };

    const saveKey = `${snapshot.dataSignature}:${snapshot.quotesUpdatedAt ?? 'no-quotes'}`;
    if (lastSavedSnapshotKeyRef.current === saveKey) return;

    if (snapshotSaveHandleRef.current) {
      cancelIdleTask(snapshotSaveHandleRef.current);
      snapshotSaveHandleRef.current = null;
    }

    snapshotSaveHandleRef.current = scheduleIdleTask(() => {
      snapshotSaveHandleRef.current = null;
      savePortfolioDisplaySnapshot(snapshot)
        .then(() => {
          lastSavedSnapshotKeyRef.current = saveKey;
        })
        .catch((err) => {
          console.warn('[usePortfolios] Failed to save display snapshot', err);
        });
    });
  }, [
    calculatedPortfolios,
    hasQuoteDataForSnapshot,
    portfolioData,
    quotesLastUpdated,
    savePortfolioDisplaySnapshot,
  ]);

  useEffect(() => {
    return () => {
      if (snapshotSaveHandleRef.current) {
        cancelIdleTask(snapshotSaveHandleRef.current);
        snapshotSaveHandleRef.current = null;
      }
    };
  }, []);

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
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const tickers = getPricedTickers(allAssets, computedPositionsByAssetId);
      if (tickers.length > 0) {
        scheduleIdleTask(() => {
          void fetchQuotes(tickers);
        });
      }
    }, 15 * 60 * 1000);

    return () => clearInterval(interval);
  }, [computedPositionsByAssetId, isUnlocked, allAssets, fetchQuotes]);

  const refreshQuotesNow = useCallback(async () => {
    if (!isUnlocked) return;

    const tickers = getPricedTickers(allAssets, computedPositionsByAssetId);
    if (tickers.length > 0) {
      await fetchQuotes(tickers, { force: true });
    }
  }, [computedPositionsByAssetId, isUnlocked, allAssets, fetchQuotes]);

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
