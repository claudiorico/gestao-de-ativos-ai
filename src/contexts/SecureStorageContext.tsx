/**
 * Secure Storage Context - Zero-Knowledge Architecture
 * All financial data is encrypted client-side and stored in IndexedDB
 * Backend has NO access to decrypted data
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  deriveKey,
  encrypt,
  decrypt,
  generateSalt,
  saltToBase64,
  base64ToSalt,
} from '@/lib/crypto';
import {
  openDatabase,
  setItem,
  getItem,
  getAllItems,
  deleteItem,
  clearStore,
  wipeDatabase,
  setUserNamespace,
} from '@/lib/indexeddb';
import { useAuthUser } from '@/contexts/GoogleUserContext';
import type {
  Portfolio,
  Asset,
  Transaction,
  Dividend,
  CashMovement,
  UserSettings,
  EncryptionMetadata,
} from '@/types/financial';

interface SecureStorageState {
  isInitialized: boolean;
  isUnlocked: boolean;
  isLoading: boolean;
  error: string | null;
}

interface SecureStorageContextType extends SecureStorageState {
  // Initialization
  initializeVault: (password: string) => Promise<void>;
  unlockVault: (password: string) => Promise<boolean>;
  lockVault: () => void;
  isVaultSetup: () => Promise<boolean>;

  // Diagnostics
  /** Stores that failed to decrypt (may indicate corruption or a different user namespace). */
  decryptIssues: string[];
  clearDecryptIssues: () => void;

  // Portfolio operations
  getPortfolios: () => Promise<Portfolio[]>;
  savePortfolio: (portfolio: Portfolio) => Promise<void>;
  deletePortfolio: (id: string) => Promise<void>;

  // Asset operations
  getAssets: (portfolioId?: string) => Promise<Asset[]>;
  saveAsset: (asset: Asset) => Promise<void>;
  deleteAsset: (id: string) => Promise<void>;

  // Transaction operations
  getTransactions: (assetId?: string) => Promise<Transaction[]>;
  saveTransaction: (transaction: Transaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;

  // Dividend operations
  getDividends: (assetId?: string) => Promise<Dividend[]>;
  saveDividend: (dividend: Dividend) => Promise<void>;
  deleteDividend: (id: string) => Promise<void>;

  // Cash movement operations
  getCashMovements: (portfolioId?: string) => Promise<CashMovement[]>;
  saveCashMovement: (movement: CashMovement) => Promise<void>;
  deleteCashMovement: (id: string) => Promise<void>;

  // Settings
  getSettings: () => Promise<UserSettings | null>;
  saveSettings: (settings: UserSettings) => Promise<void>;

  // Data management
  exportEncryptedBackup: () => Promise<string>;
  importEncryptedBackup: (backup: string) => Promise<void>;
  wipeAllData: () => Promise<void>;

  // Trigger sync after data changes
  notifyDataChange: () => void;
}

const SecureStorageContext = createContext<SecureStorageContextType | null>(null);

const METADATA_KEY = 'encryption_metadata';
const MASTER_DATA_KEY = 'master';

export function SecureStorageProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SecureStorageState>({
    isInitialized: false,
    isUnlocked: false,
    isLoading: true,
    error: null,
  });

  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  const [decryptIssuesByStore, setDecryptIssuesByStore] = useState<Record<string, number>>({});

  const clearDecryptIssues = useCallback(() => setDecryptIssuesByStore({}), []);
  
  // Get user namespace from Google auth context
  const { user, isLoading: isUserLoading } = useAuthUser();

  // Generate namespace from the authenticated user
  const getUserNamespace = useCallback(() => {
    return user?.uid || 'local';
  }, [user]);

  // Set IndexedDB namespace when user changes
  useEffect(() => {
    if (!isUserLoading) {
      const namespace = getUserNamespace();
      setUserNamespace(namespace);
    }
  }, [getUserNamespace, isUserLoading]);

  // Check if vault is already set up on mount (after namespace is set)
  useEffect(() => {
    // Wait for auth to fully resolve AND have a user.
    // Auth can briefly emit "null" before restoring the session, which would
    // incorrectly show the "create vault" screen for a moment.
    if (isUserLoading || !user) return;

    const checkVault = async () => {
      try {
        const namespace = getUserNamespace();
        setUserNamespace(namespace);

        await openDatabase();
        const metadata = await getItem('metadata', METADATA_KEY);

        setState((prev) => ({
          ...prev,
          isInitialized: !!metadata,
          isLoading: false,
        }));
      } catch (error) {
        console.error('[Vault] Error checking vault:', error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Failed to initialize secure storage',
        }));
      }
    };

    checkVault();
  }, [getUserNamespace, isUserLoading, user]);

  const isVaultSetup = useCallback(async (): Promise<boolean> => {
    const metadata = await getItem('metadata', METADATA_KEY);
    return !!metadata;
  }, []);

  const initializeVault = useCallback(async (password: string): Promise<void> => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      
      const salt = generateSalt();
      const key = await deriveKey(password, salt);
      
      const metadata: EncryptionMetadata = {
        id: METADATA_KEY,
        salt: saltToBase64(salt),
        version: 1,
        createdAt: Date.now(),
      };
      
      // Store metadata (salt is safe to store, password is not)
      await setItem('metadata', METADATA_KEY, JSON.stringify(metadata));
      
      // Initialize empty data stores with encrypted empty arrays
      const emptyData = await encrypt('[]', key);
      await Promise.all([
        setItem('portfolios', MASTER_DATA_KEY, emptyData),
        setItem('assets', MASTER_DATA_KEY, emptyData),
        setItem('transactions', MASTER_DATA_KEY, emptyData),
        setItem('dividends', MASTER_DATA_KEY, emptyData),
        setItem('cash_movements', MASTER_DATA_KEY, emptyData),
      ]);
      
      setEncryptionKey(key);
      setState({
        isInitialized: true,
        isUnlocked: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: 'Failed to initialize vault',
      }));
      throw error;
    }
  }, []);

  const unlockVault = useCallback(async (password: string): Promise<boolean> => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      
      const metadataStr = await getItem('metadata', METADATA_KEY);
      if (!metadataStr) {
        throw new Error('Vault not initialized');
      }
      
      const metadata: EncryptionMetadata = JSON.parse(metadataStr);
      const salt = base64ToSalt(metadata.salt);
      const key = await deriveKey(password, salt);
      
      // Test decryption with stored data
      const testData = await getItem('portfolios', MASTER_DATA_KEY);
      if (testData) {
        try {
          await decrypt(testData, key); // Will throw if wrong password
        } catch (decryptError) {
          console.error('Decryption failed:', decryptError);
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: 'Senha incorreta',
          }));
          return false;
        }
      }
      
      setEncryptionKey(key);
      setState({
        isInitialized: true,
        isUnlocked: true,
        isLoading: false,
        error: null,
      });
      return true;
    } catch (error) {
      console.error('Unlock vault error:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: 'Senha incorreta',
      }));
      return false;
    }
  }, []);

  const lockVault = useCallback((): void => {
    setEncryptionKey(null);
    setState((prev) => ({ ...prev, isUnlocked: false }));
  }, []);

  // Generic encrypted CRUD operations
  const getEncryptedData = useCallback(
    async <T,>(
      store: 'portfolios' | 'assets' | 'transactions' | 'dividends' | 'cash_movements'
    ): Promise<T[]> => {
      if (!encryptionKey) throw new Error('Vault is locked');

      const encrypted = await getItem(store, MASTER_DATA_KEY);
      if (!encrypted) return [];

      try {
        const decrypted = await decrypt(encrypted, encryptionKey);
        return JSON.parse(decrypted);
      } catch (err) {
        // If a single store becomes corrupted (or was written with a previous key/version),
        // we prefer to keep the app usable by returning an empty array for that store.
        console.error(`[SecureStorage] Failed to decrypt store "${store}"`, err);
        setDecryptIssuesByStore((prev) => (prev[store] ? prev : { ...prev, [store]: Date.now() }));
        return [];
      }
    },
    [encryptionKey]
  );

  // Notify for auto-sync (consumers can listen to this)
  const [dataChangeCounter, setDataChangeCounter] = useState(0);
  const notifyDataChange = useCallback(() => {
    setDataChangeCounter((c) => c + 1);
    // Dispatch custom event for auto-sync hook to listen
    window.dispatchEvent(new CustomEvent('vault-data-changed'));
  }, []);

  const saveEncryptedData = useCallback(
    async <T extends { id: string }>(
      store: 'portfolios' | 'assets' | 'transactions' | 'dividends' | 'cash_movements',
      item: T
    ): Promise<void> => {
      if (!encryptionKey) throw new Error('Vault is locked');

      const items = await getEncryptedData<T>(store);
      const index = items.findIndex((i) => i.id === item.id);

      if (index >= 0) {
        items[index] = item;
      } else {
        items.push(item);
      }

      const encrypted = await encrypt(JSON.stringify(items), encryptionKey);
      await setItem(store, MASTER_DATA_KEY, encrypted);
      notifyDataChange();
    },
    [encryptionKey, getEncryptedData, notifyDataChange]
  );

  const deleteEncryptedData = useCallback(
    async <T extends { id: string }>(
      store: 'portfolios' | 'assets' | 'transactions' | 'dividends' | 'cash_movements',
      id: string
    ): Promise<void> => {
      if (!encryptionKey) throw new Error('Vault is locked');

      const items = await getEncryptedData<T>(store);
      const filtered = items.filter((i) => i.id !== id);

      const encrypted = await encrypt(JSON.stringify(filtered), encryptionKey);
      await setItem(store, MASTER_DATA_KEY, encrypted);
      notifyDataChange();
    },
    [encryptionKey, getEncryptedData, notifyDataChange]
  );

  // Portfolio operations
  const getPortfolios = useCallback(() => getEncryptedData<Portfolio>('portfolios'), [getEncryptedData]);
  const savePortfolio = useCallback((p: Portfolio) => saveEncryptedData('portfolios', p), [saveEncryptedData]);
  const deletePortfolio = useCallback((id: string) => deleteEncryptedData<Portfolio>('portfolios', id), [deleteEncryptedData]);

  // Asset operations
  const getAssets = useCallback(async (portfolioId?: string): Promise<Asset[]> => {
    const assets = await getEncryptedData<Asset>('assets');
    return portfolioId ? assets.filter((a) => a.portfolioId === portfolioId) : assets;
  }, [getEncryptedData]);
  const saveAsset = useCallback((a: Asset) => saveEncryptedData('assets', a), [saveEncryptedData]);
  const deleteAsset = useCallback((id: string) => deleteEncryptedData<Asset>('assets', id), [deleteEncryptedData]);

  // Transaction operations
  const getTransactions = useCallback(async (assetId?: string): Promise<Transaction[]> => {
    const transactions = await getEncryptedData<Transaction>('transactions');
    return assetId ? transactions.filter((t) => t.assetId === assetId) : transactions;
  }, [getEncryptedData]);
  const saveTransaction = useCallback((t: Transaction) => saveEncryptedData('transactions', t), [saveEncryptedData]);
  const deleteTransaction = useCallback((id: string) => deleteEncryptedData<Transaction>('transactions', id), [deleteEncryptedData]);

  // Dividend operations
  const getDividends = useCallback(async (assetId?: string): Promise<Dividend[]> => {
    const dividends = await getEncryptedData<Dividend>('dividends');
    return assetId ? dividends.filter((d) => d.assetId === assetId) : dividends;
  }, [getEncryptedData]);
  const saveDividend = useCallback((d: Dividend) => saveEncryptedData('dividends', d), [saveEncryptedData]);
  const deleteDividend = useCallback((id: string) => deleteEncryptedData<Dividend>('dividends', id), [deleteEncryptedData]);

  // Cash movement operations
  const getCashMovements = useCallback(async (portfolioId?: string): Promise<CashMovement[]> => {
    const movements = await getEncryptedData<CashMovement>('cash_movements');
    return portfolioId ? movements.filter((m) => m.portfolioId === portfolioId) : movements;
  }, [getEncryptedData]);
  const saveCashMovement = useCallback((m: CashMovement) => saveEncryptedData('cash_movements', m), [saveEncryptedData]);
  const deleteCashMovement = useCallback((id: string) => deleteEncryptedData<CashMovement>('cash_movements', id), [deleteEncryptedData]);

  // Settings (stored separately, also encrypted)
  const getSettings = useCallback(async (): Promise<UserSettings | null> => {
    if (!encryptionKey) return null;

    const encrypted = await getItem('settings', MASTER_DATA_KEY);
    if (!encrypted) return null;

    const decrypted = await decrypt(encrypted, encryptionKey);
    return JSON.parse(decrypted);
  }, [encryptionKey]);

  const saveSettings = useCallback(
    async (settings: UserSettings): Promise<void> => {
      if (!encryptionKey) throw new Error('Vault is locked');

      const encrypted = await encrypt(JSON.stringify(settings), encryptionKey);
      await setItem('settings', MASTER_DATA_KEY, encrypted);
      notifyDataChange();
    },
    [encryptionKey, notifyDataChange]
  );

  // Backup/restore
  const exportEncryptedBackup = useCallback(async (): Promise<string> => {
    if (!encryptionKey) throw new Error('Vault is locked');
    
      const data = {
        portfolios: await getItem('portfolios', MASTER_DATA_KEY),
        assets: await getItem('assets', MASTER_DATA_KEY),
        transactions: await getItem('transactions', MASTER_DATA_KEY),
        dividends: await getItem('dividends', MASTER_DATA_KEY),
        cash_movements: await getItem('cash_movements', MASTER_DATA_KEY),
        settings: await getItem('settings', MASTER_DATA_KEY),
        metadata: await getItem('metadata', METADATA_KEY),
        exportedAt: Date.now(),
      };
    
    return JSON.stringify(data);
  }, [encryptionKey]);

  const importEncryptedBackup = useCallback(
    async (backup: string): Promise<void> => {
      const data = JSON.parse(backup);

      if (data.portfolios) await setItem('portfolios', MASTER_DATA_KEY, data.portfolios);
      if (data.assets) await setItem('assets', MASTER_DATA_KEY, data.assets);
      if (data.transactions) await setItem('transactions', MASTER_DATA_KEY, data.transactions);
      if (data.dividends) await setItem('dividends', MASTER_DATA_KEY, data.dividends);
      if (data.cash_movements) await setItem('cash_movements', MASTER_DATA_KEY, data.cash_movements);
      if (data.settings) await setItem('settings', MASTER_DATA_KEY, data.settings);
      if (data.metadata) await setItem('metadata', METADATA_KEY, data.metadata);

      notifyDataChange();
    },
    [notifyDataChange]
  );

  const wipeAllData = useCallback(async (): Promise<void> => {
    await wipeDatabase();
    setEncryptionKey(null);
    setState({
      isInitialized: false,
      isUnlocked: false,
      isLoading: false,
      error: null,
    });
  }, []);

  const value: SecureStorageContextType = {
    ...state,
    isVaultSetup,
    initializeVault,
    unlockVault,
    lockVault,
    decryptIssues: Object.keys(decryptIssuesByStore),
    clearDecryptIssues,
    getPortfolios,
    savePortfolio,
    deletePortfolio,
    getAssets,
    saveAsset,
    deleteAsset,
    getTransactions,
    saveTransaction,
    deleteTransaction,
    getDividends,
    saveDividend,
    deleteDividend,
    getCashMovements,
    saveCashMovement,
    deleteCashMovement,
    getSettings,
    saveSettings,
    exportEncryptedBackup,
    importEncryptedBackup,
    wipeAllData,
    notifyDataChange,
  };

  return (
    <SecureStorageContext.Provider value={value}>
      {children}
    </SecureStorageContext.Provider>
  );
}

export function useSecureStorage() {
  const context = useContext(SecureStorageContext);
  if (!context) {
    throw new Error('useSecureStorage must be used within SecureStorageProvider');
  }
  return context;
}
