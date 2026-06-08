/**
 * Backup Service - Zero-Knowledge Compatible
 * 
 * All exported data remains encrypted - backup services only see encrypted blobs
 * Google Drive stores encrypted data, never has access to plaintext
 */

// Backup file format version
const BACKUP_VERSION = 1;

export interface BackupData {
  version: number;
  createdAt: number;
  deviceId: string;
  data: {
    portfolios: string | null;
    assets: string | null;
    transactions: string | null;
    dividends: string | null;
    cash_movements: string | null;
    settings: string | null;
    metadata: string | null;
  };
}

export interface SyncStatus {
  lastSyncAt: number | null;
  provider: 'google_drive' | 'local' | null;
  autoSyncEnabled: boolean;
  fileName: string | null;

  /**
   * True when we already warned (once) that a cloud backup exists and auto-sync won't overwrite it.
   * This prevents repeated toasts on every change before the first manual confirmation/upload.
   */
  existingBackupWarningShown: boolean;

  /**
   * True quando a sessão do Google expirou e o backup automático está pausado
   * aguardando o usuário reconectar (clique). Usado para um indicador persistente na UI.
   */
  needsReauth: boolean;
}

// Generate a unique device ID for this browser instance
function getDeviceId(): string {
  let deviceId = localStorage.getItem('investpro_device_id');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem('investpro_device_id', deviceId);
  }
  return deviceId;
}

/**
 * Creates a backup object from encrypted data
 */
export function createBackupPayload(encryptedData: string): BackupData {
  const parsed = JSON.parse(encryptedData);
  
  return {
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    deviceId: getDeviceId(),
    data: {
      portfolios: parsed.portfolios || null,
      assets: parsed.assets || null,
      transactions: parsed.transactions || null,
      dividends: parsed.dividends || null,
      cash_movements: parsed.cash_movements || null,
      settings: parsed.settings || null,
      metadata: parsed.metadata || null,
    },
  };
}

/**
 * Validates and extracts backup data
 */
export function parseBackupPayload(content: string): BackupData {
  const backup = JSON.parse(content);
  
  if (!backup.version || !backup.data || !backup.data.metadata) {
    throw new Error('Invalid backup file format');
  }
  
  return backup as BackupData;
}

/**
 * Downloads encrypted backup as a file
 */
export function downloadBackupFile(encryptedData: string): void {
  const backup = createBackupPayload(encryptedData);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const date = new Date().toISOString().split('T')[0];
  const filename = `investpro-backup-${date}.vault`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Reads a backup file from user selection
 */
export function readBackupFile(file: File): Promise<BackupData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const backup = parseBackupPayload(content);
        resolve(backup);
      } catch (error) {
        reject(new Error('Failed to parse backup file'));
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// Sync status storage
const SYNC_STATUS_KEY = 'investpro_sync_status';

export function getSyncStatus(): SyncStatus {
  const defaults: SyncStatus = {
    lastSyncAt: null,
    provider: null,
    autoSyncEnabled: false,
    fileName: null,
    existingBackupWarningShown: false,
    needsReauth: false,
  };

  const stored = localStorage.getItem(SYNC_STATUS_KEY);
  if (!stored) return defaults;

  try {
    const parsed = JSON.parse(stored) as Partial<SyncStatus>;

    return {
      lastSyncAt: typeof parsed.lastSyncAt === "number" ? parsed.lastSyncAt : null,
      provider:
        parsed.provider === "google_drive" || parsed.provider === "local" ? parsed.provider : null,
      autoSyncEnabled: Boolean(parsed.autoSyncEnabled),
      fileName: typeof parsed.fileName === "string" ? parsed.fileName : null,
      existingBackupWarningShown: Boolean(parsed.existingBackupWarningShown),
      needsReauth: Boolean(parsed.needsReauth),
    };
  } catch {
    return defaults;
  }
}

export function updateSyncStatus(partial: Partial<SyncStatus>): void {
  const current = getSyncStatus();
  const updated = { ...current, ...partial };
  localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(updated));
}
