/**
 * Hook for fetching real-time stock prices from Brapi
 * Uses Edge Function to avoid CORS issues
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

// Cache quotes:
// - ativos comuns: 5 min
// - fundos CVM (CNPJ): 24h (cota geralmente é D+1/D+2, então não precisa refetch constante)
const CACHE_DURATION_MS = 5 * 60 * 1000;
const FUND_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

// Backend limita a 20 tickers por request; então dividimos em lotes.
const BACKEND_TICKER_BATCH_SIZE = 20;

let sharedQuoteCache: {
  quotes: Record<string, Quote>;
  timestamps: Record<string, number>;
} = { quotes: {}, timestamps: {} };

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

function isFundCnpj(ticker: string) {
  return /^\d{14}$/.test(String(ticker ?? '').replace(/\D/g, ''));
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
    if (!tickers || tickers.length === 0) {
      return;
    }

    const force = options?.force === true;

    // Filter out tickers that are still cached (unless forced)
    const now = Date.now();
    const cachedQuotes = sharedQuoteCache;
    const tickersToFetch = force
      ? tickers
      : tickers.filter(ticker => {
          const upper = ticker.toUpperCase();
          const cached = cachedQuotes.quotes[upper];
          if (!cached) return true;

          const ttl = isFundCnpj(upper) ? FUND_CACHE_DURATION_MS : CACHE_DURATION_MS;
          const ts = cachedQuotes.timestamps[upper] ?? 0;
          return now - ts > ttl;
        });

    // If all tickers are cached, just update state from cache
    if (tickersToFetch.length === 0) {
      const cachedResult: Record<string, Quote> = {};
      tickers.forEach(ticker => {
        const upperTicker = ticker.toUpperCase();
        if (cachedQuotes.quotes[upperTicker]) {
          cachedResult[upperTicker] = cachedQuotes.quotes[upperTicker];
        }
      });
      setQuotes(prev => mergeQuotes(prev, cachedResult));
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const batches = chunkArray(tickersToFetch, BACKEND_TICKER_BATCH_SIZE);

      // Update cache and state (normaliza a chave do ticker para bater com lookups em .toUpperCase())
      // Além disso, para ativos negociados no Yahoo (ações/FIIs), também salvamos uma chave alternativa com sufixo ".SA"
      // porque alguns usuários podem ter cadastrado o ticker como "HGBS11.SA", por exemplo.
      const newQuotes: Record<string, Quote> = {};

      for (const batch of batches) {
        const { data, error: fnError } = await invokeBackendFunction<{ quotes: Quote[]; error?: string }>(
          'get-quotes',
          { body: { tickers: batch } }
        );

        if (fnError) {
          console.error('Edge function error:', fnError);
          throw new Error(fnError.message || 'Erro ao buscar cotações');
        }

        if (data?.error) {
          throw new Error(data.error);
        }

        if (!data?.quotes) {
          throw new Error('Resposta inválida da API');
        }

        data.quotes.forEach((quote: Quote) => {
          const key = String(quote.ticker ?? '').toUpperCase();
          const normalized = { ...quote, ticker: key };
          newQuotes[key] = normalized;

          // Alias para tickers brasileiros no padrão Yahoo (ex.: PETR4.SA, HGBS11.SA)
          if (/^[A-Z]{4}\d{1,2}$/.test(key)) {
            newQuotes[`${key}.SA`] = normalized;
          }
        });
      }

      sharedQuoteCache = {
        quotes: { ...cachedQuotes.quotes, ...newQuotes },
        timestamps: {
          ...cachedQuotes.timestamps,
          ...Object.fromEntries(Object.keys(newQuotes).map((k) => [k, now])),
        },
      };

      setQuotes(prev => mergeQuotes(prev, newQuotes));
      setLastUpdated(new Date());

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao buscar cotações';
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
