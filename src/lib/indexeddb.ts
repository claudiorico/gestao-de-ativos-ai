/**
 * IndexedDB wrapper for encrypted local storage
 * All financial data is stored locally with zero-knowledge
 * Supports multi-user through namespaced database names
 */

const DB_NAME_PREFIX = 'investpro_secure';
const DB_VERSION = 2;

// Current user namespace (set when user logs in)
let currentNamespace: string = 'default';

export interface DBStores {
  portfolios: string;
  assets: string;
  transactions: string;
  dividends: string;
  cash_movements: string;
  settings: string;
  metadata: string;
}

const STORES: (keyof DBStores)[] = [
  'portfolios',
  'assets', 
  'transactions',
  'dividends',
  'cash_movements',
  'settings',
  'metadata',
];

let dbInstance: IDBDatabase | null = null;
let currentDbName: string | null = null;

/**
 * Get the database name for the current user
 */
function getDbName(): string {
  return currentNamespace === 'default' 
    ? DB_NAME_PREFIX 
    : `${DB_NAME_PREFIX}_${currentNamespace}`;
}

/**
 * Set the current user namespace for IndexedDB
 * This allows each Google account to have its own separate database
 */
export function setUserNamespace(namespace: string): void {
  const newNamespace = namespace || 'default';
  
  if (newNamespace !== currentNamespace) {
    
    // Close current connection if namespace changes
    if (dbInstance) {
      dbInstance.close();
      dbInstance = null;
      currentDbName = null;
    }
    
    currentNamespace = newNamespace;
  }
}

/**
 * Get the current user namespace
 */
export function getUserNamespace(): string {
  return currentNamespace;
}

/**
 * List all user namespaces (databases) in the browser
 */
export async function listUserNamespaces(): Promise<string[]> {
  if (!indexedDB.databases) {
    return [];
  }
  
  try {
    const databases = await indexedDB.databases();
    return databases
      .map(db => db.name)
      .filter((name): name is string => 
        name !== undefined && name.startsWith(DB_NAME_PREFIX)
      )
      .map(name => {
        if (name === DB_NAME_PREFIX) return 'default';
        return name.replace(`${DB_NAME_PREFIX}_`, '');
      });
  } catch {
    return [];
  }
}

/**
 * Request persistent storage to prevent browser from clearing data
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persisted();
    if (!isPersisted) {
      const granted = await navigator.storage.persist();
      return granted;
    }
    return true;
  }
  return false;
}

/**
 * Returns whether storage is already persistent.
 * - true: persistent
 * - false: not persistent
 * - null: API not available in this browser
 */
export async function isPersistentStorageEnabled(): Promise<boolean | null> {
  if (!navigator.storage || !navigator.storage.persisted) return null;
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

/**
 * Opens or creates the IndexedDB database
 */
export function openDatabase(): Promise<IDBDatabase> {
  const dbName = getDbName();
  
  return new Promise((resolve, reject) => {
    // If we have an instance for the current db name, reuse it
    if (dbInstance && currentDbName === dbName) {
      resolve(dbInstance);
      return;
    }
    
    // Close existing connection if switching databases
    if (dbInstance && currentDbName !== dbName) {
      dbInstance.close();
      dbInstance = null;
    }

    const request = indexedDB.open(dbName, DB_VERSION);

    request.onerror = () => {
      console.error('[IndexedDB] Failed to open database:', request.error);
      reject(new Error('Failed to open database'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      currentDbName = dbName;
      
      // Handle connection close
      dbInstance.onclose = () => {
        dbInstance = null;
        currentDbName = null;
      };
      
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object stores for each data type
      STORES.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      });
    };
  });
}

/**
 * Stores encrypted data in IndexedDB
 */
export async function setItem<T extends keyof DBStores>(
  store: T,
  id: string,
  encryptedData: string
): Promise<void> {
  const db = await openDatabase();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    const objectStore = transaction.objectStore(store);
    
    const request = objectStore.put({ id, data: encryptedData, updatedAt: Date.now() });

    request.onerror = () => reject(new Error(`Failed to store ${store}`));
    request.onsuccess = () => resolve();
  });
}

/**
 * Retrieves encrypted data from IndexedDB
 */
export async function getItem<T extends keyof DBStores>(
  store: T,
  id: string
): Promise<string | null> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const objectStore = transaction.objectStore(store);
    
    const request = objectStore.get(id);

    request.onerror = () => reject(new Error(`Failed to retrieve ${store}`));
    request.onsuccess = () => {
      resolve(request.result?.data ?? null);
    };
  });
}

/**
 * Gets all items from a store
 */
export async function getAllItems<T extends keyof DBStores>(
  store: T
): Promise<Array<{ id: string; data: string; updatedAt: number }>> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const objectStore = transaction.objectStore(store);
    
    const request = objectStore.getAll();

    request.onerror = () => reject(new Error(`Failed to retrieve all ${store}`));
    request.onsuccess = () => resolve(request.result ?? []);
  });
}

/**
 * Deletes an item from IndexedDB
 */
export async function deleteItem<T extends keyof DBStores>(
  store: T,
  id: string
): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    const objectStore = transaction.objectStore(store);
    
    const request = objectStore.delete(id);

    request.onerror = () => reject(new Error(`Failed to delete ${store}`));
    request.onsuccess = () => resolve();
  });
}

/**
 * Clears all data from a store
 */
export async function clearStore<T extends keyof DBStores>(store: T): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    const objectStore = transaction.objectStore(store);
    
    const request = objectStore.clear();

    request.onerror = () => reject(new Error(`Failed to clear ${store}`));
    request.onsuccess = () => resolve();
  });
}

/**
 * Exports all encrypted data for backup
 */
export async function exportAllData(): Promise<Record<string, unknown[]>> {
  const data: Record<string, unknown[]> = {};

  for (const store of STORES) {
    data[store] = await getAllItems(store);
  }

  return data;
}

/**
 * Check whether a given namespace has an initialised vault (encryption_metadata present)
 * without creating the database if it does not exist.
 */
export async function hasVaultInNamespace(namespace: string): Promise<boolean> {
  const ns = namespace || 'local';
  const dbName = ns === 'default' ? DB_NAME_PREFIX : `${DB_NAME_PREFIX}_${ns}`;

  // Fast-path: if the browser lists databases, skip opening an absent one.
  if ('databases' in indexedDB) {
    try {
      const dbs = await (indexedDB as any).databases() as Array<{ name?: string }>;
      if (!dbs.some((d) => d.name === dbName)) return false;
    } catch {}
  }

  return new Promise((resolve) => {
    const req = indexedDB.open(dbName);
    req.onupgradeneeded = () => {
      // DB was just created → it didn't exist → abort and report false.
      req.transaction!.abort();
      resolve(false);
    };
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('metadata')) {
        db.close();
        resolve(false);
        return;
      }
      const tx = db.transaction('metadata', 'readonly');
      const r = tx.objectStore('metadata').get('encryption_metadata');
      r.onsuccess = () => { db.close(); resolve(!!r.result); };
      r.onerror   = () => { db.close(); resolve(false); };
    };
  });
}

/**
 * Read a single raw encrypted string from a different namespace's database.
 * Returns null if the namespace / store / key does not exist.
 */
export async function getRawItemFromNamespace(
  namespace: string,
  store: keyof DBStores,
  id: string,
): Promise<string | null> {
  const ns = namespace || 'local';
  const dbName = ns === 'default' ? DB_NAME_PREFIX : `${DB_NAME_PREFIX}_${ns}`;

  return new Promise((resolve) => {
    const req = indexedDB.open(dbName);
    req.onupgradeneeded = () => { req.transaction!.abort(); resolve(null); };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store)) { db.close(); resolve(null); return; }
      const tx = db.transaction(store, 'readonly');
      const r = tx.objectStore(store).get(id);
      r.onsuccess = () => { db.close(); resolve(r.result?.data ?? null); };
      r.onerror   = () => { db.close(); resolve(null); };
    };
  });
}

/**
 * Copy all raw (still-encrypted) records from a source namespace into the
 * current namespace's database.  Existing records with the same key are
 * overwritten so the operation is idempotent.
 */
export async function copyAllRawFromNamespace(sourceNamespace: string): Promise<void> {
  const ns = sourceNamespace || 'local';
  const srcDbName = ns === 'default' ? DB_NAME_PREFIX : `${DB_NAME_PREFIX}_${ns}`;

  // --- Read all records from source ---
  const sourceData = await new Promise<Record<string, Array<{ id: string; data: string; updatedAt?: number }>>>(
    (resolve, reject) => {
      const req = indexedDB.open(srcDbName);
      req.onupgradeneeded = () => { req.transaction!.abort(); reject(new Error('Source DB missing')); };
      req.onerror = () => reject(new Error('Cannot open source DB'));
      req.onsuccess = () => {
        const db = req.result;
        const result: Record<string, any[]> = {};
        let pending = STORES.length;

        const done = () => { if (--pending === 0) { db.close(); resolve(result as any); } };

        for (const s of STORES) {
          result[s] = [];
          if (!db.objectStoreNames.contains(s)) { done(); continue; }
          const tx = db.transaction(s, 'readonly');
          const r = tx.objectStore(s).getAll();
          r.onsuccess = () => { result[s] = r.result ?? []; done(); };
          r.onerror   = () => { db.close(); reject(r.error ?? new Error(`getAll failed on store ${s}`)); };
        }
      };
    }
  );

  // --- Write everything into the current namespace ---
  const destDb = await openDatabase();
  for (const s of STORES) {
    const rows = sourceData[s];
    if (!rows?.length) continue;
    await new Promise<void>((resolve, reject) => {
      const tx = destDb.transaction(s as keyof DBStores, 'readwrite');
      const os = tx.objectStore(s);
      for (const row of rows) os.put(row);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
      tx.onabort    = () => reject(tx.error);
    });
  }
}

/**
 * Completely wipes the database
 */
export async function wipeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      dbInstance.close();
      dbInstance = null;
    }

    const request = indexedDB.deleteDatabase(getDbName());
    request.onerror = () => reject(new Error('Failed to wipe database'));
    request.onsuccess = () => resolve();
  });
}
