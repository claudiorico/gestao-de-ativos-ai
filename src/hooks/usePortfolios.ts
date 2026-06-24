/**
 * Hook for managing portfolios with encrypted local storage
 * Integrates real-time prices from Brapi
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import { usePrices, type Quote } from '@/hooks/usePrices';
import type { Asset, CorporateAction, Portfolio, Transaction } from '@/types/financial';
import {
  buildPortfolioDataSignature,
  computePortfolioDashboardMetrics,
  type AssetWithPrice,
  type PortfolioDashboardMetrics,
  type PortfolioDisplaySnapshot,
  type PortfolioWithAssets,
} from '@/lib/portfolio-summary';

export type { AssetWithPrice, PortfolioWithAssets };

interface LoadedPortfolioData {
  portfolios: Portfolio[];
  assets: Asset[];
  transactions: Transaction[];
  corporateActions: CorporateAction[];
  dataSignature: string;
  loadedAt: number;
}

type IdleCallbackHandle = ReturnType<typeof setTimeout> | number;

interface PortfolioSummaryWorkerResponse {
  requestId: number;
  portfoliosWithAssets: PortfolioWithAssets[];
  pricedTickers: string[];
  hasQuoteData: boolean;
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
    getCorporateActions,
    portfolioDisplaySnapshot,
    getPortfolioDisplaySnapshot,
    savePortfolioDisplaySnapshot,
  } = useSecureStorage();

  const { quotes, fetchQuotes, isLoading: isPricesLoading, lastUpdated: quotesLastUpdated } = usePrices();

  const initialSnapshotRef = useRef(portfolioDisplaySnapshot);
  const initialSnapshot = initialSnapshotRef.current;
  const [portfolioData, setPortfolioData] = useState<LoadedPortfolioData | null>(null);
  const [portfoliosWithAssets, setPortfoliosWithAssets] = useState<PortfolioWithAssets[]>(
    () => initialSnapshot?.portfoliosWithAssets ?? []
  );
  const [dashboardMetrics, setDashboardMetrics] = useState<PortfolioDashboardMetrics | null>(
    () =>
      initialSnapshot?.dashboardMetrics ??
      (initialSnapshot
        ? computePortfolioDashboardMetrics(initialSnapshot.portfoliosWithAssets)
        : null)
  );
  const [isLoading, setIsLoading] = useState(() => !initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const hasDisplayDataRef = useRef(Boolean(initialSnapshot));
  const lastSavedSnapshotKeyRef = useRef<string | null>(null);
  const calculationWorkerRef = useRef<Worker | null>(null);
  const calculationRequestIdRef = useRef(0);
  const forceQuotesOnNextCalculationRef = useRef(false);
  const [pricedTickers, setPricedTickers] = useState<string[]>([]);

  const portfolios = useMemo<Portfolio[]>(() => {
    if (portfolioData) return portfolioData.portfolios;

    return portfoliosWithAssets.map(({ assets, openCostBasis, currentValue, currentAllocation, totalGain, totalGainPercent, ...portfolio }) => portfolio);
  }, [portfolioData, portfoliosWithAssets]);
  const allAssets = portfolioData?.assets ?? [];

  const applyDisplaySnapshot = useCallback((snapshot: PortfolioDisplaySnapshot) => {
    setPortfoliosWithAssets(snapshot.portfoliosWithAssets);
    setDashboardMetrics(
      snapshot.dashboardMetrics ?? computePortfolioDashboardMetrics(snapshot.portfoliosWithAssets)
    );
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
      setDashboardMetrics(null);
      hasDisplayDataRef.current = false;
      setIsLoading(false);
      return;
    }

    try {
      // When a cached display snapshot exists, keep it visible while the fresh
      // encrypted data is loaded and recalculated.
      if (!opts?.silent && !hasDisplayDataRef.current) setIsLoading(true);
      setError(null);

      const [loadedPortfolios, loadedAssets, loadedTransactions, loadedCorporateActions] = await Promise.all([
        getPortfolios(),
        getAssets(),
        getTransactions(),
        getCorporateActions(),
      ]);

      const dataSignature = buildPortfolioDataSignature({
        portfolios: loadedPortfolios,
        assets: loadedAssets,
        transactions: loadedTransactions,
        corporateActions: loadedCorporateActions,
      });

      setPortfolioData({
        portfolios: loadedPortfolios,
        assets: loadedAssets,
        transactions: loadedTransactions,
        corporateActions: loadedCorporateActions,
        dataSignature,
        loadedAt: Date.now(),
      });

      if (!opts?.silent && hasDisplayDataRef.current) setIsLoading(false);

      if (opts?.forceQuotes) forceQuotesOnNextCalculationRef.current = true;
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
    getCorporateActions,
    isUnlocked,
  ]);

  useEffect(() => {
    if (!portfolioData) return;

    const requestId = ++calculationRequestIdRef.current;

    if (!calculationWorkerRef.current) {
      calculationWorkerRef.current = new Worker(
        new URL('../workers/portfolio-summary.worker.ts', import.meta.url),
        { type: 'module' }
      );
    }

    const worker = calculationWorkerRef.current;
    worker.onmessage = (event: MessageEvent<PortfolioSummaryWorkerResponse>) => {
      const result = event.data;
      if (result.requestId !== calculationRequestIdRef.current) return;

      setPricedTickers(result.pricedTickers);

      const shouldForceQuotes = forceQuotesOnNextCalculationRef.current;
      forceQuotesOnNextCalculationRef.current = false;

      if (!result.hasQuoteData && result.pricedTickers.length > 0) {
        // The first calculation after navigation may run before usePrices has
        // hydrated its quotes. Keep the last complete values visible instead
        // of replacing them with a provisional zero-gain calculation.
        if (!hasDisplayDataRef.current) {
          setPortfoliosWithAssets(result.portfoliosWithAssets);
          setDashboardMetrics(computePortfolioDashboardMetrics(result.portfoliosWithAssets));
          hasDisplayDataRef.current = true;
          setIsLoading(false);
        }

        scheduleIdleTask(() => {
          void fetchQuotes(result.pricedTickers, { force: shouldForceQuotes });
        });
        return;
      }

      setPortfoliosWithAssets(result.portfoliosWithAssets);
      const nextDashboardMetrics = computePortfolioDashboardMetrics(result.portfoliosWithAssets);
      setDashboardMetrics(nextDashboardMetrics);
      hasDisplayDataRef.current = true;
      setIsLoading(false);

      const snapshot: PortfolioDisplaySnapshot = {
        portfoliosWithAssets: toLightweightSnapshotPortfolios(result.portfoliosWithAssets),
        dashboardMetrics: nextDashboardMetrics,
        dataSignature: portfolioData.dataSignature,
        quotesUpdatedAt: quotesLastUpdated?.toISOString() ?? null,
        hasQuoteData: true,
        calculatedAt: Date.now(),
      };

      const saveKey = `${snapshot.dataSignature}:${snapshot.quotesUpdatedAt ?? 'no-quotes'}`;
      if (lastSavedSnapshotKeyRef.current === saveKey) return;

      lastSavedSnapshotKeyRef.current = saveKey;
      void savePortfolioDisplaySnapshot(snapshot).catch((err) => {
        lastSavedSnapshotKeyRef.current = null;
        console.warn('[usePortfolios] Failed to save display snapshot', err);
      });
    };

    worker.onerror = (err) => {
      console.error('[usePortfolios] Portfolio worker failed', err);
      setError('Erro ao calcular portfÃ³lio');
      if (!hasDisplayDataRef.current) setIsLoading(false);
    };

    worker.postMessage({
      requestId,
      portfolios: portfolioData.portfolios,
      assets: portfolioData.assets,
      transactions: portfolioData.transactions,
      corporateActions: portfolioData.corporateActions,
      quotes,
    });
  }, [fetchQuotes, portfolioData, quotes, quotesLastUpdated, savePortfolioDisplaySnapshot]);

  useEffect(() => {
    return () => {
      if (calculationWorkerRef.current) {
        calculationWorkerRef.current.terminate();
        calculationWorkerRef.current = null;
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
      setDashboardMetrics(null);
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

      if (pricedTickers.length > 0) {
        scheduleIdleTask(() => {
          void fetchQuotes(pricedTickers);
        });
      }
    }, 15 * 60 * 1000);

    return () => clearInterval(interval);
  }, [isUnlocked, allAssets.length, fetchQuotes, pricedTickers]);

  const refreshQuotesNow = useCallback(async () => {
    if (!isUnlocked) return;

    if (pricedTickers.length > 0) {
      await fetchQuotes(pricedTickers, { force: true });
    }
  }, [isUnlocked, fetchQuotes, pricedTickers]);

  return {
    portfolios,
    portfoliosWithAssets,
    dashboardMetrics,
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
