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
    notifyDataChange,
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
      notifyDataChange();
      await loadAssets();
      return newAsset;
    },
    [saveAsset, notifyDataChange, loadAssets]
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
      notifyDataChange();
      await loadAssets();
      return updated;
    },
    [assets, saveAsset, notifyDataChange, loadAssets]
  );

  // Remove asset
  const removeAsset = useCallback(
    async (id: string) => {
      await deleteAsset(id);
      notifyDataChange();
      await loadAssets();
    },
    [deleteAsset, notifyDataChange, loadAssets]
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
