/**
 * Hook for managing assets with encrypted local storage
 */

import { useState, useEffect, useCallback } from 'react';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import { normalizeTickerForStorage } from '@/lib/ticker';
import type { Asset } from '@/types/financial';

export function useAssets(portfolioId?: string) {
  const {
    isUnlocked,
    getAssets,
    saveAsset,
    deleteAsset,
  } = useSecureStorage();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load assets
  const loadAssets = useCallback(async () => {
    if (!isUnlocked) {
      setAssets([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const loadedAssets = await getAssets(portfolioId);
      setAssets(loadedAssets);
    } catch (err) {
      setError('Erro ao carregar ativos');
      console.error('Error loading assets:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isUnlocked, getAssets, portfolioId]);

  // Create new asset
  const createAsset = useCallback(
    async (data: Omit<Asset, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = Date.now();
      const newAsset: Asset = {
        ...data,
        ticker: normalizeTickerForStorage(data.ticker, data.type),
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      await saveAsset(newAsset);
      await loadAssets();
      return newAsset;
    },
    [saveAsset, loadAssets]
  );

  // Update existing asset
  const updateAsset = useCallback(
    async (id: string, data: Partial<Omit<Asset, 'id' | 'createdAt'>>) => {
      const existing = assets.find((a) => a.id === id);
      if (!existing) throw new Error('Ativo não encontrado');

      const nextType = (data as Partial<Asset>).type ?? existing.type;
      const nextTicker =
        typeof (data as Partial<Asset>).ticker === 'string'
          ? normalizeTickerForStorage(String((data as Partial<Asset>).ticker), nextType)
          : existing.ticker;

      const updated: Asset = {
        ...existing,
        ...data,
        ticker: nextTicker,
        updatedAt: Date.now(),
      };

      await saveAsset(updated);
      await loadAssets();
      return updated;
    },
    [assets, saveAsset, loadAssets]
  );

  // Remove asset
  const removeAsset = useCallback(
    async (id: string) => {
      await deleteAsset(id);
      await loadAssets();
    },
    [deleteAsset, loadAssets]
  );

  // Load on mount and when vault unlocks
  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  return {
    assets,
    isLoading,
    error,
    createAsset,
    updateAsset,
    removeAsset,
    refresh: loadAssets,
  };
}
