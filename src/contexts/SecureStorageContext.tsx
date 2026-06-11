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
  hasVaultInNamespace,
  getRawItemFromNamespace,
  copyAllRawFromNamespace,
} from '@/lib/indexeddb';
import { useAuthUser } from '@/contexts/GoogleUserContext';
import { disableBiometric } from '@/lib/biometric-unlock';
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
  saveAssetsBulk: (assets: Asset[]) => Promise<void>;
  deleteAsset: (id: string) => Promise<void>;
  deleteAssetsBulk: (ids: string[]) => Promise<void>;

  // Transaction operations
  getTransactions: (assetId?: string) => Promise<Transaction[]>;
  saveTransaction: (transaction: Transaction) => Promise<void>;
  saveTransactionsBulk: (transactions: Transaction[]) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;

  // Dividend operations
  getDividends: (assetId?: string) => Promise<Dividend[]>;
  saveDividend: (dividend: Dividend) => Promise<void>;
  saveDividendsBulk: (dividends: Dividend[]) => Promise<void>;
  deleteDividend: (id: string) => Promise<void>;

  // Cash movement operations
  getCashMovements: (portfolioId?: string) => Promise<CashMovement[]>;
  saveCashMovement: (movement: CashMovement) => Promise<void>;
  saveCashMovementsBulk: (movements: CashMovement[]) => Promise<void>;
  deleteCashMovement: (id: string) => Promise<void>;

  // Settings
  getSettings: () => Promise<UserSettings | null>;
  saveSettings: (settings: UserSettings) => Promise<void>;

  // Data management
  exportEncryptedBackup: () => Promise<string>;
  importEncryptedBackup: (backup: string) => Promise<void>;
  wipeAllData: () => Promise<void>;
  changeVaultPassword: (oldPassword: string, newPassword: string) => Promise<void>;

  // Local → Google migration
  localHasData: boolean;
  migrateFromLocal: (password: string) => Promise<void>;

  // Trigger sync after data changes
  notifyDataChange: () => void;
}

const SecureStorageContext = createContext<SecureStorageContextType | null>(null);

const METADATA_KEY = 'encryption_metadata';
const MASTER_DATA_KEY = 'master';
const KEY_VERIFIER_KEY = 'key_verifier';
const KEY_VERIFIER_VALUE = 'investpro-vault-key-v1';
const RECORD_DATA_PREFIX = 'record:';

type EncryptedDataStore = 'portfolios' | 'assets' | 'transactions' | 'dividends' | 'cash_movements';

const ENCRYPTED_DATA_STORES: EncryptedDataStore[] = [
  'portfolios',
  'assets',
  'transactions',
  'dividends',
  'cash_movements',
];

const makeRecordKey = (id: string) => `${RECORD_DATA_PREFIX}${id}`;

export function SecureStorageProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SecureStorageState>({
    isInitialized: false,
    isUnlocked: false,
    isLoading: true,
    error: null,
  });

  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  const [decryptIssuesByStore, setDecryptIssuesByStore] = useState<Record<string, number>>({});
  const [localHasData, setLocalHasData] = useState(false);

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

        // Offer migration when a Google account has no vault but 'local' does.
        let hasLocal = false;
        if (!metadata && namespace !== 'local') {
          hasLocal = await hasVaultInNamespace('local');
        }
        setLocalHasData(hasLocal);

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
      await setItem('metadata', KEY_VERIFIER_KEY, await encrypt(KEY_VERIFIER_VALUE, key));
      
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
      
      // Test decryption with a verifier. Older vaults may not have it yet, so
      // fall back to the legacy master block and create the verifier after a
      // successful unlock.
      const verifier = await getItem('metadata', KEY_VERIFIER_KEY);
      if (verifier) {
        try {
          const verifierValue = await decrypt(verifier, key);
          if (verifierValue !== KEY_VERIFIER_VALUE) throw new Error('Invalid key verifier');
        } catch (decryptError) {
          console.error('Decryption failed:', decryptError);
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: 'Senha incorreta',
          }));
          return false;
        }
      } else {
        let testData = await getItem('portfolios', MASTER_DATA_KEY);
        if (!testData) {
          for (const store of ENCRYPTED_DATA_STORES) {
            const rows = await getAllItems(store);
            testData = rows.find((row) => row.id.startsWith(RECORD_DATA_PREFIX))?.data ?? null;
            if (testData) break;
          }
        }

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

        await setItem('metadata', KEY_VERIFIER_KEY, await encrypt(KEY_VERIFIER_VALUE, key));
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

  const decryptJson = useCallback(
    async <T,>(store: EncryptedDataStore | 'settings', encrypted: string): Promise<T> => {
      if (!encryptionKey) throw new Error('Vault is locked');

      try {
        const decrypted = await decrypt(encrypted, encryptionKey);
        return JSON.parse(decrypted);
      } catch (err) {
        // Register the failure so the UI can surface a diagnostic warning.
        console.error(`[SecureStorage] Failed to decrypt store "${store}"`, err);
        setDecryptIssuesByStore((prev) => (prev[store] ? prev : { ...prev, [store]: Date.now() }));

        // CRITICAL: Re-throw so write operations abort instead of overwriting
        // encrypted data with a partial/empty payload.
        throw new Error(
          `[SecureStorage] Store "${store}" could not be decrypted - aborting write to prevent data loss. ` +
          `This may indicate data corruption or a key mismatch. Original error: ${String(err)}`
        );
      }
    },
    [encryptionKey]
  );

  const migrateLegacyMasterStore = useCallback(
    async <T extends { id: string }>(store: EncryptedDataStore, items: T[]): Promise<void> => {
      if (!encryptionKey) throw new Error('Vault is locked');

      await Promise.all(
        items.map(async (item) =>
          setItem(store, makeRecordKey(item.id), await encrypt(JSON.stringify(item), encryptionKey))
        )
      );
      await deleteItem(store, MASTER_DATA_KEY);
    },
    [encryptionKey]
  );

  // Generic encrypted CRUD operations. Data rows are encrypted item-by-item as
  // record:<id>. Legacy vaults with a single encrypted "master" array are read
  // first and migrated only after all record writes succeed.
  const getEncryptedData = useCallback(
    async <T extends { id: string }>(store: EncryptedDataStore): Promise<T[]> => {
      if (!encryptionKey) throw new Error('Vault is locked');

      const rows = await getAllItems(store);
      const legacyMaster = rows.find((row) => row.id === MASTER_DATA_KEY)?.data;

      if (legacyMaster) {
        const legacyItems = await decryptJson<T[]>(store, legacyMaster);
        await migrateLegacyMasterStore(store, legacyItems);
        return legacyItems;
      }

      const recordRows = rows.filter((row) => row.id.startsWith(RECORD_DATA_PREFIX));
      return Promise.all(recordRows.map((row) => decryptJson<T>(store, row.data)));
    },
    [decryptJson, encryptionKey, migrateLegacyMasterStore]
  );

  const ensureRecordStore = useCallback(
    async (store: EncryptedDataStore): Promise<void> => {
      const legacyMaster = await getItem(store, MASTER_DATA_KEY);
      if (legacyMaster) {
        await getEncryptedData(store);
      }
    },
    [getEncryptedData]
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
      store: EncryptedDataStore,
      item: T
    ): Promise<void> => {
      if (!encryptionKey) throw new Error('Vault is locked');

      await ensureRecordStore(store);
      const encrypted = await encrypt(JSON.stringify(item), encryptionKey);
      await setItem(store, makeRecordKey(item.id), encrypted);
      notifyDataChange();
    },
    [encryptionKey, ensureRecordStore, notifyDataChange]
  );

  // Salva muitos itens como registros criptografados independentes, notificando
  // uma única vez. Evita recriptografar a tabela inteira em importações grandes.
  const saveManyEncryptedData = useCallback(
    async <T extends { id: string }>(
      store: EncryptedDataStore,
      newItems: T[]
    ): Promise<void> => {
      if (!encryptionKey) throw new Error('Vault is locked');
      if (!newItems.length) return;

      await ensureRecordStore(store);
      await Promise.all(
        newItems.map(async (item) =>
          setItem(store, makeRecordKey(item.id), await encrypt(JSON.stringify(item), encryptionKey))
        )
      );
      notifyDataChange();
    },
    [encryptionKey, ensureRecordStore, notifyDataChange]
  );

  // Remove vários registros de uma vez e notifica uma única vez.
  const deleteManyEncryptedData = useCallback(
    async <T extends { id: string }>(
      store: EncryptedDataStore,
      ids: string[]
    ): Promise<void> => {
      if (!encryptionKey) throw new Error('Vault is locked');
      if (!ids.length) return;

      await ensureRecordStore(store);
      await Promise.all(ids.map((id) => deleteItem(store, makeRecordKey(id))));
      notifyDataChange();
    },
    [encryptionKey, ensureRecordStore, notifyDataChange]
  );

  const deleteEncryptedData = useCallback(
    async <T extends { id: string }>(
      store: EncryptedDataStore,
      id: string
    ): Promise<void> => {
      if (!encryptionKey) throw new Error('Vault is locked');

      await ensureRecordStore(store);
      await deleteItem(store, makeRecordKey(id));
      notifyDataChange();
    },
    [encryptionKey, ensureRecordStore, notifyDataChange]
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
  const saveAssetsBulk = useCallback((a: Asset[]) => saveManyEncryptedData('assets', a), [saveManyEncryptedData]);
  const deleteAsset = useCallback((id: string) => deleteEncryptedData<Asset>('assets', id), [deleteEncryptedData]);
  const deleteAssetsBulk = useCallback((ids: string[]) => deleteManyEncryptedData<Asset>('assets', ids), [deleteManyEncryptedData]);

  // Transaction operations
  const getTransactions = useCallback(async (assetId?: string): Promise<Transaction[]> => {
    const transactions = await getEncryptedData<Transaction>('transactions');
    return assetId ? transactions.filter((t) => t.assetId === assetId) : transactions;
  }, [getEncryptedData]);
  const saveTransaction = useCallback((t: Transaction) => saveEncryptedData('transactions', t), [saveEncryptedData]);
  const saveTransactionsBulk = useCallback((t: Transaction[]) => saveManyEncryptedData('transactions', t), [saveManyEncryptedData]);
  const deleteTransaction = useCallback((id: string) => deleteEncryptedData<Transaction>('transactions', id), [deleteEncryptedData]);

  // Dividend operations
  const getDividends = useCallback(async (assetId?: string): Promise<Dividend[]> => {
    const dividends = await getEncryptedData<Dividend>('dividends');
    return assetId ? dividends.filter((d) => d.assetId === assetId) : dividends;
  }, [getEncryptedData]);
  const saveDividend = useCallback((d: Dividend) => saveEncryptedData('dividends', d), [saveEncryptedData]);
  const saveDividendsBulk = useCallback((d: Dividend[]) => saveManyEncryptedData('dividends', d), [saveManyEncryptedData]);
  const deleteDividend = useCallback((id: string) => deleteEncryptedData<Dividend>('dividends', id), [deleteEncryptedData]);

  // Cash movement operations
  const getCashMovements = useCallback(async (portfolioId?: string): Promise<CashMovement[]> => {
    const movements = await getEncryptedData<CashMovement>('cash_movements');
    return portfolioId ? movements.filter((m) => m.portfolioId === portfolioId) : movements;
  }, [getEncryptedData]);
  const saveCashMovement = useCallback((m: CashMovement) => saveEncryptedData('cash_movements', m), [saveEncryptedData]);
  const saveCashMovementsBulk = useCallback((m: CashMovement[]) => saveManyEncryptedData('cash_movements', m), [saveManyEncryptedData]);
  const deleteCashMovement = useCallback((id: string) => deleteEncryptedData<CashMovement>('cash_movements', id), [deleteEncryptedData]);

  // Settings (stored separately, also encrypted)
  const getSettings = useCallback(async (): Promise<UserSettings | null> => {
    if (!encryptionKey) return null;

    const encrypted = await getItem('settings', MASTER_DATA_KEY);
    if (!encrypted) return null;

    return decryptJson<UserSettings>('settings', encrypted);
  }, [decryptJson, encryptionKey]);

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
        portfolios: await encrypt(JSON.stringify(await getEncryptedData<Portfolio>('portfolios')), encryptionKey),
        assets: await encrypt(JSON.stringify(await getEncryptedData<Asset>('assets')), encryptionKey),
        transactions: await encrypt(JSON.stringify(await getEncryptedData<Transaction>('transactions')), encryptionKey),
        dividends: await encrypt(JSON.stringify(await getEncryptedData<Dividend>('dividends')), encryptionKey),
        cash_movements: await encrypt(JSON.stringify(await getEncryptedData<CashMovement>('cash_movements')), encryptionKey),
        settings: await getItem('settings', MASTER_DATA_KEY),
        metadata: await getItem('metadata', METADATA_KEY),
        exportedAt: Date.now(),
      };
    
    return JSON.stringify(data);
  }, [encryptionKey, getEncryptedData]);

  const importEncryptedBackup = useCallback(
    async (backup: string): Promise<void> => {
      const data = JSON.parse(backup);

      if (!data.metadata) {
        throw new Error('Invalid encrypted backup: missing metadata');
      }

      await Promise.all([
        clearStore('portfolios'),
        clearStore('assets'),
        clearStore('transactions'),
        clearStore('dividends'),
        clearStore('cash_movements'),
        clearStore('settings'),
        clearStore('metadata'),
      ]);

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

  const changeVaultPassword = useCallback(
    async (oldPassword: string, newPassword: string): Promise<void> => {
      if (!encryptionKey) throw new Error('Vault is locked');

      // 1. Verify old password against stored verifier
      const metadataStr = await getItem('metadata', METADATA_KEY);
      if (!metadataStr) throw new Error('Vault not initialized');
      const metadata: EncryptionMetadata = JSON.parse(metadataStr);
      const oldSalt = base64ToSalt(metadata.salt);
      const testKey = await deriveKey(oldPassword, oldSalt);

      const verifier = await getItem('metadata', KEY_VERIFIER_KEY);
      if (verifier) {
        try {
          const v = await decrypt(verifier, testKey);
          if (v !== KEY_VERIFIER_VALUE) throw new Error('bad verifier');
        } catch {
          throw new Error('Senha atual incorreta');
        }
      }

      // 2. Read all decrypted data with current (correct) key
      const portfolios = await getEncryptedData<Portfolio>('portfolios');
      const assets = await getEncryptedData<Asset>('assets');
      const transactions = await getEncryptedData<Transaction>('transactions');
      const dividends = await getEncryptedData<Dividend>('dividends');
      const cashMovements = await getEncryptedData<CashMovement>('cash_movements');
      const settingsRaw = await getItem('settings', MASTER_DATA_KEY);
      let settingsJson: string | null = null;
      if (settingsRaw) {
        try { settingsJson = await decrypt(settingsRaw, encryptionKey); } catch {}
      }

      // 3. Generate new salt + key
      const newSalt = generateSalt();
      const newKey = await deriveKey(newPassword, newSalt);

      // 4. Persist new metadata + verifier
      const newMetadata: EncryptionMetadata = { ...metadata, salt: saltToBase64(newSalt) };
      await setItem('metadata', METADATA_KEY, JSON.stringify(newMetadata));
      await setItem('metadata', KEY_VERIFIER_KEY, await encrypt(KEY_VERIFIER_VALUE, newKey));

      // 5. Re-encrypt every record with new key
      const reencrypt = async <T extends { id: string }>(store: EncryptedDataStore, items: T[]) => {
        await Promise.all(
          items.map(async (item) =>
            setItem(store, makeRecordKey(item.id), await encrypt(JSON.stringify(item), newKey))
          )
        );
      };
      await reencrypt('portfolios', portfolios);
      await reencrypt('assets', assets);
      await reencrypt('transactions', transactions);
      await reencrypt('dividends', dividends);
      await reencrypt('cash_movements', cashMovements);
      if (settingsJson) {
        await setItem('settings', MASTER_DATA_KEY, await encrypt(settingsJson, newKey));
      }

      // 6. Update context key + clear biometric (ciphertext is now stale)
      setEncryptionKey(newKey);
      disableBiometric(getUserNamespace());
    },
    [encryptionKey, getEncryptedData, getUserNamespace]
  );

  const migrateFromLocal = useCallback(async (password: string): Promise<void> => {
    // 1. Verify password against the local vault before touching anything.
    const localMetaStr = await getRawItemFromNamespace('local', 'metadata', METADATA_KEY);
    if (!localMetaStr) throw new Error('Nenhum cofre local encontrado');

    const localMeta: EncryptionMetadata = JSON.parse(localMetaStr);
    const localSalt = base64ToSalt(localMeta.salt);
    const testKey = await deriveKey(password, localSalt);

    const localVerifier = await getRawItemFromNamespace('local', 'metadata', KEY_VERIFIER_KEY);
    if (localVerifier) {
      try {
        const v = await decrypt(localVerifier, testKey);
        if (v !== KEY_VERIFIER_VALUE) throw new Error('bad verifier');
      } catch {
        throw new Error('Senha incorreta');
      }
    }

    // 2. Copy all raw encrypted records (including metadata/salt) to current namespace.
    await copyAllRawFromNamespace('local');

    // 3. Unlock normally — metadata + data are now in the current namespace.
    const ok = await unlockVault(password);
    if (!ok) {
      // Rollback: remove the partial copy so the setup screen reappears.
      await wipeDatabase();
      throw new Error('Falha inesperada ao desbloquear após migração');
    }

    setLocalHasData(false);
  }, [unlockVault]);

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
    saveAssetsBulk,
    deleteAssetsBulk,
    deleteAsset,
    getTransactions,
    saveTransaction,
    saveTransactionsBulk,
    deleteTransaction,
    getDividends,
    saveDividend,
    saveDividendsBulk,
    deleteDividend,
    getCashMovements,
    saveCashMovement,
    saveCashMovementsBulk,
    deleteCashMovement,
    getSettings,
    saveSettings,
    exportEncryptedBackup,
    importEncryptedBackup,
    wipeAllData,
    changeVaultPassword,
    localHasData,
    migrateFromLocal,
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
