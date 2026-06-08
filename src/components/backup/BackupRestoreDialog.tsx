/**
 * Backup & Restore Dialog
 * Handles both Google Drive sync and manual file export/import
 */

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Cloud,
  CloudOff,
  Download,
  Upload,
  RefreshCw,
  Check,
  AlertTriangle,
  HardDrive,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import { useAutoSync } from '@/hooks/use-auto-sync';
import {
  downloadBackupFile,
  readBackupFile,
  getSyncStatus,
  updateSyncStatus,
} from '@/lib/backup';
import {
  initiateGoogleAuth,
  isGoogleDriveConnected,
  downloadFromGoogleDrive,
  uploadToGoogleDrive,
  clearGoogleDriveConfig,
  getConnectedUserEmail,
  getGoogleDriveBackupInfo,
  getAppGoogleClientId,
} from '@/lib/google-drive';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface BackupRestoreDialogProps {
  trigger: React.ReactNode;
}

export function BackupRestoreDialog({ trigger }: BackupRestoreDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [clientId, setClientId] = useState('');
  const [showClientIdInput, setShowClientIdInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { exportEncryptedBackup, importEncryptedBackup, isUnlocked } = useSecureStorage();
  const { syncNow } = useAutoSync();

  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  const [isConnected, setIsConnected] = useState(isGoogleDriveConnected());
  const connectedEmail = getConnectedUserEmail();
  
  // Manual export
  const handleExport = async () => {
    if (!isUnlocked) return;
    
    setIsLoading(true);
    try {
      const data = await exportEncryptedBackup();
      downloadBackupFile(data);
      
      toast({
        title: 'Backup exportado',
        description: 'Arquivo .vault salvo com sucesso',
      });
    } catch (error) {
      toast({
        title: 'Erro ao exportar',
        description: 'Não foi possível criar o backup',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Manual import
  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsLoading(true);
    try {
      const backup = await readBackupFile(file);
      
      // Convert backup to the format expected by importEncryptedBackup
      const importData = JSON.stringify({
        portfolios: backup.data.portfolios,
        assets: backup.data.assets,
        transactions: backup.data.transactions,
        dividends: backup.data.dividends,
        cash_movements: backup.data.cash_movements,
        settings: backup.data.settings,
        metadata: backup.data.metadata,
      });
      
      await importEncryptedBackup(importData);
      
      toast({
        title: 'Backup restaurado',
        description: 'Dados importados com sucesso. Faça login novamente.',
      });
      
      // Reload to apply changes
      window.location.reload();
    } catch (error) {
      toast({
        title: 'Erro ao importar',
        description: 'Arquivo inválido ou corrompido',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };
  
  const appClientId = getAppGoogleClientId();

  // Google Drive connection
  const handleConnectGoogleDrive = async (idToUse: string = appClientId) => {
    const trimmed = idToUse.trim();
    if (!trimmed) {
      toast({
        title: 'Client ID necessário',
        description: 'Insira seu Google OAuth Client ID',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      await initiateGoogleAuth(trimmed);
      setShowClientIdInput(false);
      setIsConnected(true);

      // Reconectou → limpa o aviso de "backup pausado" e avisa a UI.
      updateSyncStatus({ needsReauth: false });
      window.dispatchEvent(new Event("gdrive-sync-status-changed"));

      toast({
        title: 'Google Drive conectado',
        description: 'Sync automático ativado',
      });
    } catch (error) {
      toast({
        title: 'Erro na conexão',
        description: error instanceof Error ? error.message : 'Falha na autenticação',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnectGoogleDrive = () => {
    clearGoogleDriveConfig();
    updateSyncStatus({ provider: null, autoSyncEnabled: false });
    setIsConnected(false);
    setSyncStatus(getSyncStatus());

    toast({
      title: 'Google Drive desconectado',
      description: 'Seus dados locais permanecem intactos',
    });
  };
  
  // Sync from Google Drive
  const handleSyncFromCloud = async () => {
    setIsLoading(true);
    try {
      const cloudData = await downloadFromGoogleDrive();

      if (cloudData) {
        await importEncryptedBackup(cloudData);

        toast({
          title: 'Dados sincronizados',
          description: 'Backup da nuvem restaurado. Faça login novamente.',
        });

        window.location.reload();
      } else {
        toast({
          title: 'Nenhum backup encontrado',
          description: 'Não há backup no Google Drive',
        });
      }
    } catch (error) {
      toast({
        title: 'Erro ao sincronizar',
        description: 'Não foi possível baixar o backup',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Sync to Google Drive
  const handleSyncToCloud = async () => {
    if (!isUnlocked) return;

    setIsLoading(true);
    try {
      // Primeira vez neste dispositivo/cofre: evita sobrepor um backup antigo sem querer.
      const status = getSyncStatus();
      if (!status.lastSyncAt) {
        const cloud = await getGoogleDriveBackupInfo({ allowInteractive: true });
        if (cloud.exists) {
          const ok = window.confirm(
            'Já existe um backup na nuvem para esta conta.\n\nDeseja substituir o arquivo existente pelos dados deste cofre?'
          );
          if (!ok) {
            toast({
              title: 'Backup cancelado',
              description: 'Nada foi enviado para a nuvem.',
            });
            return;
          }
        }
      }

      const data = await exportEncryptedBackup();
      await uploadToGoogleDrive(data);

      updateSyncStatus({
        lastSyncAt: Date.now(),
        provider: 'google_drive',
      });
      setSyncStatus(getSyncStatus());

      toast({
        title: 'Backup realizado',
        description: 'Dados enviados para o Google Drive',
      });
    } catch (error) {
      toast({
        title: 'Erro ao fazer backup',
        description: 'Não foi possível enviar para o Google Drive',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle auto-sync
  const handleToggleAutoSync = (enabled: boolean) => {
    updateSyncStatus({ autoSyncEnabled: enabled });
    setSyncStatus(getSyncStatus());

    if (enabled && isConnected) {
      syncNow();
    }
  };
  
  const formatLastSync = (timestamp: number | null) => {
    if (!timestamp) return 'Nunca';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Agora mesmo';
    if (diffMins < 60) return `${diffMins} min atrás`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h atrás`;
    
    return date.toLocaleDateString('pt-BR');
  };
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Backup & Sincronização</DialogTitle>
          <DialogDescription>
            Seus dados permanecem criptografados. Ninguém além de você pode acessá-los.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Google Drive Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Cloud className="h-5 w-5 text-primary" />
              <h4 className="font-semibold">Google Drive</h4>
            </div>
            
            {isConnected ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between rounded-lg border border-success/20 bg-success-muted p-3">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-success" />
                      <span className="text-sm font-medium text-success">Conectado</span>
                    </div>
                    {connectedEmail && (
                      <span className="text-xs text-muted-foreground ml-6">{connectedEmail}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDisconnectGoogleDrive}
                    className="h-8 text-xs text-muted-foreground hover:text-destructive"
                  >
                    Desconectar
                  </Button>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="auto-sync">Sync automático</Label>
                    <p className="text-xs text-muted-foreground">
                      Sincroniza a cada alteração
                    </p>
                  </div>
                  <Switch
                    id="auto-sync"
                    checked={syncStatus.autoSyncEnabled}
                    onCheckedChange={handleToggleAutoSync}
                  />
                </div>
                
                <div className="text-xs text-muted-foreground">
                  Último sync: {formatLastSync(syncStatus.lastSyncAt)}
                </div>
                
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={handleSyncFromCloud}
                    disabled={isLoading}
                  >
                    <Download className="h-4 w-4" />
                    Baixar da nuvem
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={handleSyncToCloud}
                    disabled={isLoading || !isUnlocked}
                  >
                    <Upload className="h-4 w-4" />
                    Enviar para nuvem
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-3"
              >
                {showClientIdInput ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-warning/20 bg-warning-muted p-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                        <div className="text-xs text-warning">
                          <p className="font-medium">Avançado: usar seu próprio OAuth</p>
                          <p className="mt-1 text-warning/80">
                            Opcional. Para zero-knowledge total, crie seu próprio projeto no
                            Google Cloud Console e gere um Client ID.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="client-id">Google OAuth Client ID</Label>
                      <Input
                        id="client-id"
                        placeholder="seu-client-id.apps.googleusercontent.com"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                      />
                    </div>
                    
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowClientIdInput(false)}
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => handleConnectGoogleDrive(clientId)}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Cloud className="h-4 w-4" />
                        )}
                        Conectar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      disabled={isLoading}
                      onClick={() => {
                        if (appClientId) {
                          handleConnectGoogleDrive(appClientId);
                        } else {
                          setShowClientIdInput(true);
                        }
                      }}
                    >
                      {isLoading ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Cloud className="h-4 w-4" />
                      )}
                      Conectar Google Drive
                    </Button>
                    <button
                      type="button"
                      onClick={() => setShowClientIdInput(true)}
                      className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                    >
                      Usar meu próprio Client ID (avançado)
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </div>
          
          <Separator />
          
          {/* Manual Backup Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-muted-foreground" />
              <h4 className="font-semibold">Backup Manual</h4>
            </div>
            
            <p className="text-xs text-muted-foreground">
              Exporte seus dados criptografados como arquivo .vault
            </p>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={handleExport}
                disabled={isLoading || !isUnlocked}
              >
                <Download className="h-4 w-4" />
                Exportar
              </Button>
              
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
              >
                <Upload className="h-4 w-4" />
                Importar
              </Button>
              
              <input
                ref={fileInputRef}
                type="file"
                accept=".vault,.json"
                className="hidden"
                onChange={handleImport}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
