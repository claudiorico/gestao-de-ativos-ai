/**
 * Hook for managing portfolios with encrypted local storage
 * Integrates real-time prices from Brapi
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
    // Sempre que o ativo tiver transações, elas são a fonte da verdade (mesmo que
    // o ativo tenha sido criado com shares/averagePrice manuais).
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

      // shares pode chegar a 0 (ativo zerado por vendas) — nesse caso o preço médio
      // não é mais significativo, mas a quantidade 0 ainda precisa prevalecer sobre
      // o valor estático do ativo.
      map.set(assetId, { shares, averagePrice: shares > 0 ? cost / shares : 0 });
    }

    return map;
  }, [allTransactions]);

  // Load portfolios and assets.
  // forceQuotes=true deve ser usado apenas no desbloqueio/mount inicial para garantir
  // cotações frescas. Mutações de dados locais (salvar ativo, mover, etc.) devem passar
  // forceQuotes=false para reutilizar o cache (TTL 5 min) e não bater na edge function.
  const loadPortfolios = useCallback(async (opts?: { forceQuotes?: boolean; silent?: boolean }) => {
    if (!isUnlocked) {
      setPortfolios([]);
      setPortfoliosWithAssets([]);
      setAllAssets([]);
      setIsLoading(false);
      return;
    }

    try {
      // Reloads silenciosos (vault-data-changed) não alteram isLoading para evitar
      // que o spinner desmonte a tabela e cause scroll indesejado.
      if (!opts?.silent) setIsLoading(true);
      setError(null);

      const [loadedPortfolios, loadedAssets, loadedTransactions] = await Promise.all([
        getPortfolios(),
        getAssets(),
        getTransactions(),
      ]);

      setPortfolios(loadedPortfolios);
      setAllAssets(loadedAssets);
      setAllTransactions(loadedTransactions);

      const tickers = loadedAssets
        .filter((a) => ['stock', 'reit', 'etf', 'crypto', 'investment_fund', 'fixed_income'].includes(a.type))
        .map((a) => a.ticker);

      // Keep local calculations visible while quotes refresh in the background.
      if (!opts?.silent) setIsLoading(false);

      if (tickers.length > 0) {
        void fetchQuotes(tickers, { force: opts?.forceQuotes === true });
      }
    } catch (err) {
      setError('Erro ao carregar portfólios');
      console.error('Error loading portfolios:', err);
    } finally {
      if (!opts?.silent) setIsLoading(false);
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

      // Se existem transações para o ativo, elas são a fonte da verdade (mesmo que o
      // ativo tenha sido criado com shares/averagePrice manuais). Sem transações,
      // usamos a posição estática informada na criação do ativo.
      const effectiveShares = derived ? derived.shares : asset.shares;
      const effectiveAveragePrice = derived ? derived.averagePrice : asset.averagePrice;

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

    // Oculta ativos zerados (totalmente vendidos): quantidade ~0 e sem alocação-alvo.
    // Mantém o ativo/transações no cofre (histórico/IR), só não exibe na carteira.
    // Papéis planejados (shares 0 mas com alocação-alvo > 0) continuam visíveis.
    const HOLDING_EPS = 1e-8;
    const isVisibleHolding = (a: AssetWithPrice) =>
      a.shares > HOLDING_EPS || (a.targetAllocation ?? 0) > 0;

    // Map portfolios with their enriched assets
    const enrichedPortfolios: PortfolioWithAssets[] = portfolios.map((portfolio) => {
      const assets = enrichedAssets.filter(
        (a) => a.portfolioId === portfolio.id && isVisibleHolding(a)
      );
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
      await loadPortfolios({ silent: true });
      return newPortfolio;
    },
    [savePortfolio, loadPortfolios]
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
      await loadPortfolios({ silent: true });
      return updated;
    },
    [portfolios, savePortfolio, loadPortfolios]
  );

  // Remove portfolio
  const removePortfolio = useCallback(
    async (id: string) => {
      await deletePortfolio(id);
      await loadPortfolios({ silent: true });
    },
    [deletePortfolio, loadPortfolios]
  );

  // No desbloqueio/mount inicial, força cotações frescas.
  // Recargas subsequentes (mutações de dados) reutilizam o cache.
  useEffect(() => {
    loadPortfolios({ forceQuotes: true });
  }, [loadPortfolios]);

  // Recarrega automaticamente quando qualquer parte do cofre mudar (ex.: manutenção de tickers).
  // Com debounce: uma importação em massa dispara muitos eventos em sequência; sem isso
  // recarregaríamos (e buscaríamos cotações) dezenas de vezes, estourando a edge function.
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
