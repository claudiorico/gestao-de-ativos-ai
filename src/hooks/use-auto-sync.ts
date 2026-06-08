/**
 * Auto-sync hook for automatic Google Drive backup
 * Syncs encrypted data automatically on changes
 * Listens to vault-data-changed events to trigger sync
 */

import { useEffect, useRef, useCallback } from 'react';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import {
  uploadToGoogleDrive,
  isGoogleDriveConnected,
  GoogleAuthInteractionRequiredError,
  getGoogleDriveBackupInfo,
  hasValidGoogleToken,
} from '@/lib/google-drive';
import { updateSyncStatus, getSyncStatus } from '@/lib/backup';
import { toast } from '@/hooks/use-toast';

const DEBOUNCE_MS = 5000; // Wait 5 seconds after last change before syncing

export function useAutoSync() {
  const { isUnlocked, exportEncryptedBackup } = useSecureStorage();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingRef = useRef(false);

  // Evita loop de tentativas quando o navegador exige gesto do usuário (popup bloqueado).
  const needsUserActionRef = useRef(false);
  const lastNeedActionToastAtRef = useRef<number>(0);

  const performSync = useCallback(async () => {
    // Se estávamos travados aguardando reconexão mas já existe um token válido
    // (usuário reconectou o Drive), destrava e segue normalmente.
    if (needsUserActionRef.current && hasValidGoogleToken()) {
      needsUserActionRef.current = false;
      updateSyncStatus({ needsReauth: false });
      window.dispatchEvent(new Event('gdrive-sync-status-changed'));
    }

    if (
      isSyncingRef.current ||
      !isUnlocked ||
      !isGoogleDriveConnected() ||
      needsUserActionRef.current
    ) {
      return;
    }

    const status = getSyncStatus();
    if (!status.autoSyncEnabled) {
      return;
    }

    // Se este dispositivo ainda nunca sincronizou, não sobrescreva um backup existente
    // automaticamente (sem confirmação explícita do usuário).
    // Importante: mostramos o aviso apenas UMA vez (na primeira detecção), para não ficar
    // repetindo toast a cada mudança enquanto o usuário não confirma manualmente.
    if (!status.lastSyncAt) {
      try {
        const cloud = await getGoogleDriveBackupInfo({ allowInteractive: false });
        if (cloud.exists) {
          needsUserActionRef.current = true;

          if (!status.existingBackupWarningShown) {
            updateSyncStatus({ existingBackupWarningShown: true });
            toast({
              title: 'Backup já existe na nuvem',
              description:
                'Para evitar sobrescrever dados, vá em Configurações e use “Enviar para nuvem” para confirmar a substituição.',
              variant: 'destructive',
            });
          }

          return;
        }
      } catch (e) {
        // Se não conseguirmos checar (token expirado, etc.), seguimos o fluxo normal
        // e deixamos o erro ser tratado no upload.
        console.warn('[AutoSync] Could not check existing cloud backup', e);
      }
    }

    isSyncingRef.current = true;

    try {
      const encryptedData = await exportEncryptedBackup();
      await uploadToGoogleDrive(encryptedData);

      updateSyncStatus({
        lastSyncAt: Date.now(),
        provider: 'google_drive',
        needsReauth: false,
      });
      window.dispatchEvent(new Event('gdrive-sync-status-changed'));

      console.log('[AutoSync] Backup completed successfully');
    } catch (error) {
      // Caso clássico: o navegador bloqueou popup / precisa consentimento → só resolve com clique do usuário.
      if (error instanceof GoogleAuthInteractionRequiredError) {
        needsUserActionRef.current = true;
        updateSyncStatus({ needsReauth: true });
        window.dispatchEvent(new Event('gdrive-sync-status-changed'));

        const now = Date.now();
        if (now - lastNeedActionToastAtRef.current > 30_000) {
          lastNeedActionToastAtRef.current = now;
          toast({
            title: 'Conexão com Google Drive necessária',
            description:
              'Para voltar a sincronizar, abra Configurações e reconecte o Google Drive (o navegador exige um clique para autorizar).',
            variant: 'destructive',
          });
        }

        console.warn('[AutoSync] Interaction required to renew Google token');
        return;
      }

      console.error('[AutoSync] Backup failed:', error);
      toast({
        title: 'Falha na sincronização',
        description: 'Não foi possível fazer backup no Google Drive. Tentaremos novamente depois.',
        variant: 'destructive',
      });
    } finally {
      isSyncingRef.current = false;
    }
  }, [isUnlocked, exportEncryptedBackup]);

  const scheduleSync = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      performSync();
    }, DEBOUNCE_MS);
  }, [performSync]);

  // Listen to vault data changes and schedule sync automatically
  useEffect(() => {
    const handleDataChange = () => {
      console.log('[AutoSync] Data change detected, scheduling sync...');
      scheduleSync();
    };

    window.addEventListener('vault-data-changed', handleDataChange);

    return () => {
      window.removeEventListener('vault-data-changed', handleDataChange);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [scheduleSync]);

  return {
    scheduleSync,
    syncNow: performSync,
    isSyncing: isSyncingRef.current,
  };
}
