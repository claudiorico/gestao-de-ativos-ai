/**
 * Hook for fetching real-time prices through the configured backend function.
 */

import { useState, useCallback } from 'react';
import { invokeBackendFunction } from '@/lib/backend/functionsClient';

export interface Quote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  name: string;
  currency: string;
  updatedAt: string;
  error?: string;
}

interface UsePricesReturn {
  quotes: Record<string, Quote>;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  fetchQuotes: (tickers: string[], options?: { force?: boolean }) => Promise<void>;
  getQuote: (ticker: string) => Quote | undefined;
}

const CACHE_DURATION_MS = 5 * 60 * 1000;
const FUND_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const BACKEND_TICKER_BATCH_SIZE = 20;

let sharedQuoteCache: {
  quotes: Record<string, Quote>;
  timestamps: Record<string, number>;
} = { quotes: {}, timestamps: {} };

const inflightQuoteRequests = new Map<string, Promise<Quote[]>>();

function mergeQuotes(
  current: Record<string, Quote>,
  incoming: Record<string, Quote>
): Record<string, Quote> {
  let changed = false;
  const next = { ...current };

  for (const [ticker, quote] of Object.entries(incoming)) {
    if (next[ticker] !== quote) {
      next[ticker] = quote;
      changed = true;
    }
  }

  return changed ? next : current;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function normalizeTickers(tickers: string[]): string[] {
  return Array.from(
    new Set(
      tickers
        .map((ticker) => String(ticker ?? '').trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function isFundCnpj(ticker: string) {
  return /^\d{14}$/.test(String(ticker ?? '').replace(/\D/g, ''));
}

async function fetchQuoteBatch(batch: string[]): Promise<Quote[]> {
  const requestKey = batch.map((ticker) => ticker.toUpperCase()).sort().join(',');
  const inflight = inflightQuoteRequests.get(requestKey);
  if (inflight) return inflight;

  const request = invokeBackendFunction<{ quotes: Quote[]; error?: string }>(
    'get-quotes',
    { body: { tickers: batch } }
  )
    .then(({ data, error: fnError }) => {
      if (fnError) {
        console.error('Edge function error:', fnError);
        throw new Error(fnError.message || 'Erro ao buscar cotacoes');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (!data?.quotes) {
        throw new Error('Resposta invalida da API');
      }

      return data.quotes;
    })
    .finally(() => {
      inflightQuoteRequests.delete(requestKey);
    });

  inflightQuoteRequests.set(requestKey, request);
  return request;
}

export function usePrices(): UsePricesReturn {
  const [quotes, setQuotes] = useState<Record<string, Quote>>(
    () => sharedQuoteCache.quotes
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(() => {
    const latestTimestamp = Math.max(0, ...Object.values(sharedQuoteCache.timestamps));
    return latestTimestamp > 0 ? new Date(latestTimestamp) : null;
  });

  const fetchQuotes = useCallback(async (tickers: string[], options?: { force?: boolean }) => {
    if (!tickers || tickers.length === 0) return;

    const force = options?.force === true;
    const now = Date.now();
    const cachedQuotes = sharedQuoteCache;
    const normalizedTickers = normalizeTickers(tickers);

    const tickersToFetch = force
      ? normalizedTickers
      : normalizedTickers.filter((ticker) => {
          const cached = cachedQuotes.quotes[ticker];
          if (!cached) return true;

          const ttl = isFundCnpj(ticker) ? FUND_CACHE_DURATION_MS : CACHE_DURATION_MS;
          const ts = cachedQuotes.timestamps[ticker] ?? 0;
          return now - ts > ttl;
        });

    if (tickersToFetch.length === 0) {
      const cachedResult: Record<string, Quote> = {};
      normalizedTickers.forEach((ticker) => {
        if (cachedQuotes.quotes[ticker]) {
          cachedResult[ticker] = cachedQuotes.quotes[ticker];
        }
      });
      setQuotes((prev) => mergeQuotes(prev, cachedResult));
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const batches = chunkArray(tickersToFetch, BACKEND_TICKER_BATCH_SIZE);
      const newQuotes: Record<string, Quote> = {};

      for (const batch of batches) {
        const batchQuotes = await fetchQuoteBatch(batch);
        batchQuotes.forEach((quote) => {
          const key = String(quote.ticker ?? '').toUpperCase();
          const normalized = { ...quote, ticker: key };
          newQuotes[key] = normalized;

          if (/^[A-Z]{4}\d{1,2}$/.test(key)) {
            newQuotes[`${key}.SA`] = normalized;
          }
        });
      }

      sharedQuoteCache = {
        quotes: { ...cachedQuotes.quotes, ...newQuotes },
        timestamps: {
          ...cachedQuotes.timestamps,
          ...Object.fromEntries(Object.keys(newQuotes).map((key) => [key, now])),
        },
      };

      setQuotes((prev) => mergeQuotes(prev, newQuotes));
      setLastUpdated(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao buscar cotacoes';
      setError(message);
      console.error('Error fetching quotes:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getQuote = useCallback((ticker: string): Quote | undefined => {
    return quotes[ticker.toUpperCase()];
  }, [quotes]);

  return {
    quotes,
    isLoading,
    error,
    lastUpdated,
    fetchQuotes,
    getQuote,
  };
}
