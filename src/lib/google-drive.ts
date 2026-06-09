/**
 * Google Drive Integration - Zero-Knowledge
 *
 * Encrypted data is synced to user's personal Google Drive.
 * Google only sees encrypted blobs, never plaintext financial data.
 */

import { createBackupPayload, parseBackupPayload } from "./backup";

const GOOGLE_DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
const BACKUP_FILENAME = "investpro-vault.encrypted";

/**
 * App-wide Google OAuth Client ID (single "Sign in with Google").
 * Configured at build time via VITE_GOOGLE_CLIENT_ID. Returns "" when unset,
 * which lets the UI fall back to the advanced "bring your own Client ID" flow.
 */
export function getAppGoogleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? "";
}

export interface GoogleDriveConfig {
  clientId: string;
  accessToken: string | null;
  refreshToken: string | null; // kept for backward compat (not used)
  expiresAt: number | null;
  userEmail: string | null;
}

// Store config in localStorage (tokens only, no financial data)
const CONFIG_KEY = "investpro_gdrive_config";
const PENDING_TOKEN_KEY = "investpro_gdrive_pending";

// How soon (ms) before expiry we should refresh
const EXPIRY_SAFETY_WINDOW_MS = 2 * 60 * 1000;

type GisTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: "" | "consent" }) => void;
};

export class GoogleAuthInteractionRequiredError extends Error {
  code = 'INTERACTION_REQUIRED' as const;
  constructor(message = 'Interação do usuário necessária para conectar ao Google Drive') {
    super(message);
    this.name = 'GoogleAuthInteractionRequiredError';
  }
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (opts: {
            client_id: string;
            scope: string;
            callback: (resp: GisTokenResponse) => void;
            error_callback?: (resp: GisTokenResponse) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

export function getGoogleDriveConfig(): GoogleDriveConfig | null {
  const stored = localStorage.getItem(CONFIG_KEY);
  return stored ? JSON.parse(stored) : null;
}

export function setGoogleDriveConfig(config: GoogleDriveConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearGoogleDriveConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

/**
 * "Connected" means the user has completed OAuth at least once.
 * The access token itself is short-lived, but we can renew it via GIS.
 */
export function isGoogleDriveConnected(): boolean {
  const config = getGoogleDriveConfig();
  return !!(config?.clientId && (config.accessToken || config.userEmail));
}

/**
 * Fetch user's email from Google API
 */
async function fetchUserEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.email || null;
  } catch {
    return null;
  }
}

function ensureGisLoaded(): void {
  if (!window.google?.accounts?.oauth2?.initTokenClient) {
    throw new Error(
      "Google Identity Services não carregou. Recarregue a página e tente novamente."
    );
  }
}

async function requestGisAccessToken(
  clientId: string,
  prompt: "" | "consent"
): Promise<{ accessToken: string; expiresIn: number }> {
  ensureGisLoaded();

  return new Promise((resolve, reject) => {
    const tokenClient = window.google!.accounts!.oauth2!.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: (resp: GisTokenResponse) => {
        if (resp.error || !resp.access_token) {
          const msg = resp.error_description || resp.error || "Falha ao obter token";
          reject(new Error(msg));
          return;
        }

        resolve({
          accessToken: resp.access_token,
          expiresIn: Number(resp.expires_in || 3600),
        });
      },
      error_callback: (resp: GisTokenResponse) => {
        const msg = resp.error_description || resp.error || "Falha ao obter token";
        reject(new Error(msg));
      },
    });

    tokenClient.requestAccessToken({ prompt });
  });
}

/**
 * Há um access token ainda válido em cache? Usado para destravar o auto-sync
 * depois que o usuário reconecta (sem depender de reload da página).
 */
export function hasValidGoogleToken(): boolean {
  const c = getGoogleDriveConfig();
  return !!(
    c?.accessToken &&
    c.expiresAt &&
    c.expiresAt - Date.now() > EXPIRY_SAFETY_WINDOW_MS
  );
}

async function getValidAccessToken(
  clientId: string,
  opts?: { allowInteractive?: boolean }
): Promise<string> {
  const allowInteractive = opts?.allowInteractive ?? false;
  const config = getGoogleDriveConfig();

  // If we still have a safe token, use it.
  if (
    config?.accessToken &&
    config.expiresAt &&
    config.expiresAt - Date.now() > EXPIRY_SAFETY_WINDOW_MS
  ) {
    return config.accessToken;
  }

  // Sem token válido. Em segundo plano (auto-sync, sem gesto do usuário) NÃO tentamos
  // renovar: o modelo de token do GIS não tem refresh token silencioso e abrir popup
  // sem clique é bloqueado pelo navegador. Sinalizamos que é preciso reconectar.
  if (!allowInteractive) {
    throw new GoogleAuthInteractionRequiredError();
  }

  // Fluxo interativo (disparado por clique): tenta silencioso e cai para consentimento.
  try {
    const { accessToken, expiresIn } = await requestGisAccessToken(clientId, "");
    const userEmail = await fetchUserEmail(accessToken);

    setGoogleDriveConfig({
      clientId,
      accessToken,
      refreshToken: null,
      expiresAt: Date.now() + expiresIn * 1000,
      userEmail,
    });

    return accessToken;
  } catch (e) {
    // Fallback to interactive consent.
    const { accessToken, expiresIn } = await requestGisAccessToken(clientId, "consent");
    const userEmail = await fetchUserEmail(accessToken);

    setGoogleDriveConfig({
      clientId,
      accessToken,
      refreshToken: null,
      expiresAt: Date.now() + expiresIn * 1000,
      userEmail,
    });

    return accessToken;
  }
}

/**
 * Check for pending OAuth token from redirect flow (legacy)
 */
export async function checkPendingOAuthToken(clientId: string): Promise<boolean> {
  const pending = localStorage.getItem(PENDING_TOKEN_KEY);
  if (!pending) return false;

  try {
    const { access_token, expires_in, timestamp } = JSON.parse(pending);

    // Check if token is still valid (not expired and not too old)
    const tokenAge = Date.now() - timestamp;
    if (tokenAge > 5 * 60 * 1000) {
      // 5 minutes max
      localStorage.removeItem(PENDING_TOKEN_KEY);
      return false;
    }

    // Get user email to identify the backup
    const userEmail = await fetchUserEmail(access_token);

    // Save the config
    const config: GoogleDriveConfig = {
      clientId,
      accessToken: access_token,
      refreshToken: null,
      expiresAt: Date.now() + expires_in * 1000,
      userEmail,
    };
    setGoogleDriveConfig(config);
    localStorage.removeItem(PENDING_TOKEN_KEY);

    return true;
  } catch {
    localStorage.removeItem(PENDING_TOKEN_KEY);
    return false;
  }
}

/**
 * Get pending OAuth client ID if stored
 */
export function getPendingClientId(): string | null {
  return localStorage.getItem("investpro_gdrive_pending_clientid");
}

export function setPendingClientId(clientId: string): void {
  localStorage.setItem("investpro_gdrive_pending_clientid", clientId);
}

export function clearPendingClientId(): void {
  localStorage.removeItem("investpro_gdrive_pending_clientid");
}

/**
 * Initialize Google auth using Google Identity Services.
 * - Silent refresh happens later (no popup) via token client
 * - First time requires user gesture (interactive consent)
 */
export async function initiateGoogleAuth(clientId: string): Promise<string> {
  // Must be called from a user gesture (button click)
  // First time requires interactive consent.
  const token = await getValidAccessToken(clientId, { allowInteractive: true });
  return token;
}

/**
 * Upload encrypted backup to Google Drive AppData folder
 */
export async function uploadToGoogleDrive(
  encryptedData: string,
  opts?: { allowInteractive?: boolean }
): Promise<void> {
  const config = getGoogleDriveConfig();
  if (!config?.clientId) {
    throw new Error("Google Drive não configurado");
  }

  const accessToken = await getValidAccessToken(config.clientId, {
    allowInteractive: opts?.allowInteractive ?? false,
  });

  // Create backup payload with proper structure (same format as manual backup)
  const backupPayload = createBackupPayload(encryptedData);
  const backupContent = JSON.stringify(backupPayload);

  // First, check if file exists
  const existingFileId = await findBackupFile(accessToken);
  const fileName = getBackupFileName();

  const metadata = {
    name: fileName,
    mimeType: "application/json",
    parents: existingFileId ? undefined : ["appDataFolder"],
  };

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", new Blob([backupContent], { type: "application/json" }));

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

  const response = await fetch(url, {
    method: existingFileId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to upload to Google Drive");
  }
}

/**
 * Download encrypted backup from Google Drive
 */
export async function downloadFromGoogleDrive(
  opts?: { allowInteractive?: boolean }
): Promise<string | null> {
  const config = getGoogleDriveConfig();
  if (!config?.clientId) {
    throw new Error("Google Drive não configurado");
  }

  const accessToken = await getValidAccessToken(config.clientId, {
    allowInteractive: opts?.allowInteractive ?? false,
  });

  const fileId = await findBackupFile(accessToken);
  if (!fileId) {
    return null;
  }

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to download from Google Drive");
  }

  const content = await response.text();

  // Parse the backup payload and convert to the format expected by importEncryptedBackup
  try {
    const backup = parseBackupPayload(content);

    const importData = JSON.stringify({
      portfolios: backup.data.portfolios,
      assets: backup.data.assets,
      transactions: backup.data.transactions,
      dividends: backup.data.dividends,
      settings: backup.data.settings,
      metadata: backup.data.metadata,
    });

    return importData;
  } catch {
    // If parsing fails, return the raw content (might be old format)
    return content;
  }
}

/**
 * Find existing backup file in AppData folder
 */
async function findBackupFile(accessToken: string): Promise<string | null> {
  const info = await findBackupFileInfo(accessToken);
  return info?.id || null;
}

type BackupFileInfo = { id: string; modifiedTime?: string };

async function findBackupFileInfo(accessToken: string): Promise<BackupFileInfo | null> {
  const config = getGoogleDriveConfig();
  const userEmail = config?.userEmail || "default";
  const fileName = `${BACKUP_FILENAME}-${btoa(userEmail).replace(/[^a-zA-Z0-9]/g, "")}`;

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${fileName}'&fields=files(id,name,modifiedTime)`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const files: Array<{ id: string; modifiedTime?: string }> = data.files || [];

  // Pode existir mais de 1 arquivo com o mesmo nome (duplicatas antigas).
  // Sempre escolhemos o mais recente para garantir “últimas atualizações”.
  const latest = files
    .filter((f) => !!f?.id)
    .sort((a, b) => {
      const ta = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const tb = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return tb - ta;
    })[0];

  return latest?.id ? { id: latest.id, modifiedTime: latest.modifiedTime } : null;
}

/**
 * Check if a backup already exists in the cloud for the connected user.
 * Useful to avoid overwriting a previous vault by accident.
 */
export async function getGoogleDriveBackupInfo(opts?: {
  allowInteractive?: boolean;
}): Promise<{ exists: boolean; modifiedTime: number | null }> {
  const config = getGoogleDriveConfig();
  if (!config?.clientId) {
    throw new Error("Google Drive não configurado");
  }

  const accessToken = await getValidAccessToken(config.clientId, {
    allowInteractive: opts?.allowInteractive ?? false,
  });

  const info = await findBackupFileInfo(accessToken);
  return {
    exists: !!info,
    modifiedTime: info?.modifiedTime ? new Date(info.modifiedTime).getTime() : null,
  };
}

/**
 * Get the backup filename for the current user
 */
function getBackupFileName(): string {
  const config = getGoogleDriveConfig();
  const userEmail = config?.userEmail || "default";
  return `${BACKUP_FILENAME}-${btoa(userEmail).replace(/[^a-zA-Z0-9]/g, "")}`;
}

/**
 * Get last sync time from Google Drive
 */
export async function getLastSyncTime(): Promise<number | null> {
  const config = getGoogleDriveConfig();
  if (!config?.clientId) {
    return null;
  }

  const accessToken = await getValidAccessToken(config.clientId);
  const fileName = getBackupFileName();

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${fileName}'&fields=files(id,modifiedTime)`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const files: Array<{ id: string; modifiedTime?: string }> = data.files || [];
  const latest = files
    .filter((f) => !!f?.id)
    .sort((a, b) => {
      const ta = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const tb = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return tb - ta;
    })[0];

  return latest?.modifiedTime ? new Date(latest.modifiedTime).getTime() : null;
}

/**
 * Get the connected user's email
 */
export function getConnectedUserEmail(): string | null {
  const config = getGoogleDriveConfig();
  return config?.userEmail || null;
}
