import { useState, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { motion } from "framer-motion";
import { User, Bell, Shield, Palette, Database, HelpCircle, Cloud, Download, Upload, RefreshCw, Check, AlertTriangle, Tag, Trash2 } from "lucide-react";
import { invokeBackendFunction } from "@/lib/backend/functionsClient";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { useAuthUser } from "@/contexts/GoogleUserContext";
import { normalizeTickerForStorage } from "@/lib/ticker";

import {
  downloadBackupFile,
  readBackupFile,
  getSyncStatus,
  updateSyncStatus,
} from "@/lib/backup";
import {
  initiateGoogleAuth,
  isGoogleDriveConnected,
  downloadFromGoogleDrive,
  uploadToGoogleDrive,
  clearGoogleDriveConfig,
  checkPendingOAuthToken,
  getPendingClientId,
  clearPendingClientId,
  getGoogleDriveBackupInfo,
  getAppGoogleClientId,
} from "@/lib/google-drive";
import { toast } from "@/hooks/use-toast";
import { GoogleOAuthTutorial } from "@/components/settings/GoogleOAuthTutorial";

type SettingsSection = "profile" | "notifications" | "security" | "appearance" | "data" | "help";

const settingsSections = [
  {
    id: "profile" as SettingsSection,
    title: "Perfil",
    description: "Informações pessoais e conta",
    icon: User,
  },
  {
    id: "notifications" as SettingsSection,
    title: "Notificações",
    description: "Preferências de alertas",
    icon: Bell,
  },
  {
    id: "security" as SettingsSection,
    title: "Segurança",
    description: "Autenticação e privacidade",
    icon: Shield,
  },
  {
    id: "appearance" as SettingsSection,
    title: "Aparência",
    description: "Tema e personalização",
    icon: Palette,
  },
  {
    id: "data" as SettingsSection,
    title: "Backup & Sincronização",
    description: "Google Drive e exportação",
    icon: Database,
  },
  {
    id: "help" as SettingsSection,
    title: "Ajuda",
    description: "Suporte e documentação",
    icon: HelpCircle,
  },
];

export default function Settings() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile");
  const [isLoading, setIsLoading] = useState(false);
  const [clientId, setClientId] = useState("");
  const [showClientIdInput, setShowClientIdInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const {
    exportEncryptedBackup,
    importEncryptedBackup,
    isUnlocked,
    getSettings,
    saveSettings,
    getAssets,
    saveAsset,
    saveAssetsBulk,
    deleteAssetsBulk,
    getTransactions,
    getDividends,
    saveDividendsBulk,
    notifyDataChange,
  } = useSecureStorage();
  const { user } = useAuthUser();

  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  const [isConnected, setIsConnected] = useState(isGoogleDriveConnected());

  const buildDefaultSettings = () => {
    const now = Date.now();
    return {
      id: "settings",
      theme: "system" as const,
      currency: "BRL",
      language: "pt-BR",
      notifications: {
        dividends: true,
        rebalance: true,
        taxReminders: true,
        priceAlerts: false,
      },
      averagePriceAdjustments: {
        fiiYieldReducesCost: true,
        jcpReducesCost: false,
      },
      createdAt: now,
      updatedAt: now,
    };
  };

  const mergeSettings = (base: ReturnType<typeof buildDefaultSettings>, incoming: any) => {
    const merged = {
      ...base,
      ...(incoming ?? {}),
      notifications: {
        ...base.notifications,
        ...((incoming?.notifications ?? {}) as any),
      },
      averagePriceAdjustments: {
        ...base.averagePriceAdjustments,
        ...((incoming?.averagePriceAdjustments ?? {}) as any),
      },
    };
    // Garante timestamps
    merged.createdAt = Number(incoming?.createdAt) || base.createdAt;
    merged.updatedAt = Number(incoming?.updatedAt) || base.updatedAt;
    merged.id = String(incoming?.id || base.id);
    return merged;
  };

  const [settingsDraft, setSettingsDraft] = useState(buildDefaultSettings);
  const [savedSettings, setSavedSettings] = useState(buildDefaultSettings);
  const [isSettingsReady, setIsSettingsReady] = useState(false);
  const [isStandardizingTickers, setIsStandardizingTickers] = useState(false);
  const [isBackfillingNames, setIsBackfillingNames] = useState(false);
  const [isCleaningOrphans, setIsCleaningOrphans] = useState(false);
  const [isBackfillingShares, setIsBackfillingShares] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!isUnlocked) {
        setIsSettingsReady(false);
        return;
      }

      try {
        const base = buildDefaultSettings();
        const loaded = await getSettings();
        const merged = mergeSettings(base, loaded);

        if (cancelled) return;
        setSavedSettings(merged);
        setSettingsDraft(merged);
        setIsSettingsReady(true);
      } catch (e) {
        console.error("[Settings] getSettings failed", e);
        if (cancelled) return;
        setIsSettingsReady(true);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlocked]);

  const syncNow = async () => {
    try {
      if (!isUnlocked) {
        toast({
          title: "Cofre bloqueado",
          description: "Desbloqueie o cofre para sincronizar.",
          variant: "destructive",
        });
        return;
      }

      if (!isGoogleDriveConnected()) {
        toast({
          title: "Google Drive não conectado",
          description: "Conecte o Google Drive nas configurações para ativar o sync.",
          variant: "destructive",
        });
        return;
      }

      setIsLoading(true);

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
              title: "Sincronização cancelada",
              description: "Nada foi enviado para a nuvem.",
            });
            return;
          }
        }
      }

      const encryptedData = await exportEncryptedBackup();
      await uploadToGoogleDrive(encryptedData, { allowInteractive: true });

      updateSyncStatus({
        lastSyncAt: Date.now(),
        provider: "google_drive",
        existingBackupWarningShown: false,
      });

      setSyncStatus(getSyncStatus());
      setIsConnected(isGoogleDriveConnected());

      toast({
        title: "Sincronizado",
        description: "Backup enviado para o Google Drive.",
      });
    } catch (e) {
      console.error("[Settings] syncNow failed", e);
      toast({
        title: "Falha na sincronização",
        description: "Não foi possível enviar o backup para o Google Drive.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Check for OAuth callback from redirect flow
  useEffect(() => {
    const oauthParam = searchParams.get('oauth');
    
    if (oauthParam === 'success') {
      // Get the stored client ID
      const pendingClientId = getPendingClientId();
      
      if (pendingClientId) {
        // Try to process the pending token (async)
        const processToken = async () => {
          const success = await checkPendingOAuthToken(pendingClientId);
          
          if (success) {
            clearPendingClientId();
            setIsConnected(true);
            setShowClientIdInput(false);
            
            toast({
              title: "Google Drive conectado",
              description: "Sync automático ativado",
            });
          } else {
            toast({
              title: "Erro na conexão",
              description: "Token expirado ou inválido. Tente novamente.",
              variant: "destructive",
            });
          }
        };
        
        processToken();
      }
      
      // Clean URL parameters
      navigate('/settings', { replace: true });
    }
  }, [searchParams, navigate]);

  // Manual export
  const handleExport = async () => {
    if (!isUnlocked) {
      toast({
        title: "Cofre bloqueado",
        description: "Desbloqueie o cofre primeiro",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    try {
      const data = await exportEncryptedBackup();
      downloadBackupFile(data);
      
      toast({
        title: "Backup exportado",
        description: "Arquivo .vault salvo com sucesso",
      });
    } catch (error) {
      toast({
        title: "Erro ao exportar",
        description: "Não foi possível criar o backup",
        variant: "destructive",
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
      
      const importData = JSON.stringify({
        portfolios: backup.data.portfolios,
        assets: backup.data.assets,
        transactions: backup.data.transactions,
        dividends: backup.data.dividends,
        settings: backup.data.settings,
        metadata: backup.data.metadata,
      });
      
      await importEncryptedBackup(importData);
      
      toast({
        title: "Backup restaurado",
        description: "Dados importados com sucesso. Faça login novamente.",
      });
      
      window.location.reload();
    } catch (error) {
      toast({
        title: "Erro ao importar",
        description: "Arquivo inválido ou corrompido",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const appClientId = getAppGoogleClientId();

  // Google Drive connection
  const handleConnectGoogleDrive = async (idToUse: string = appClientId) => {
    const trimmed = idToUse.trim();
    if (!trimmed) {
      toast({
        title: "Client ID necessário",
        description: "Insira seu Google OAuth Client ID",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await initiateGoogleAuth(trimmed);

      // If result is 'pending', the token will be processed via redirect
      if (result !== 'pending') {
        setIsConnected(true);
        setShowClientIdInput(false);

        // Reconectou → limpa o aviso de "backup pausado" e avisa a UI.
        updateSyncStatus({ needsReauth: false });
        window.dispatchEvent(new Event("gdrive-sync-status-changed"));

        toast({
          title: "Google Drive conectado",
          description: "Sync automático ativado para backup",
        });
      }

      // Estado do switch/último sync vem do localStorage
      setSyncStatus(getSyncStatus());
    } catch (error) {
      toast({
        title: "Erro na conexão",
        description: error instanceof Error ? error.message : "Falha na autenticação",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnectGoogleDrive = () => {
    clearGoogleDriveConfig();
    updateSyncStatus({
      provider: null,
      autoSyncEnabled: false,
      lastSyncAt: null,
      existingBackupWarningShown: false,
    });
    setIsConnected(false);
    setSyncStatus(getSyncStatus());

    toast({
      title: "Google Drive desconectado",
      description: "Seus dados locais permanecem intactos",
    });
  };

  // Sync from Google Drive
  const handleSyncFromCloud = async () => {
    setIsLoading(true);
    try {
      const cloudData = await downloadFromGoogleDrive({ allowInteractive: true });

      if (cloudData) {
        await importEncryptedBackup(cloudData);

        toast({
          title: "Dados sincronizados",
          description: "Backup da nuvem restaurado. Faça login novamente.",
        });

        window.location.reload();
      } else {
        toast({
          title: "Nenhum backup encontrado",
          description: "Não há backup no Google Drive",
        });
      }
    } catch (error) {
      toast({
        title: "Erro ao sincronizar",
        description: "Não foi possível baixar o backup",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Sync to Google Drive
  const handleSyncToCloud = async () => {
    if (!isUnlocked) {
      toast({
        title: "Cofre bloqueado",
        description: "Desbloqueie o cofre primeiro",
        variant: "destructive",
      });
      return;
    }

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
              title: "Backup cancelado",
              description: "Nada foi enviado para a nuvem.",
            });
            return;
          }
        }
      }

      const data = await exportEncryptedBackup();
      await uploadToGoogleDrive(data, { allowInteractive: true });

      updateSyncStatus({
        lastSyncAt: Date.now(),
        provider: "google_drive",
      });
      setSyncStatus(getSyncStatus());

      toast({
        title: "Backup realizado",
        description: "Dados enviados para o Google Drive",
      });
    } catch (error) {
      toast({
        title: "Erro ao fazer backup",
        description: "Não foi possível enviar para o Google Drive",
        variant: "destructive",
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
    if (!timestamp) return "Nunca";
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "Agora mesmo";
    if (diffMins < 60) return `${diffMins} min atrás`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h atrás`;
    
    return date.toLocaleDateString("pt-BR");
  };

  const handleStandardizeTickers = async () => {
    if (!isUnlocked) {
      toast({
        title: "Cofre bloqueado",
        description: "Desbloqueie o cofre para padronizar tickers.",
        variant: "destructive",
      });
      return;
    }

    const ok = window.confirm(
      "Isto vai padronizar os tickers já salvos (ex.: HGBS11.SA → HGBS11, PETR4F → PETR4).\n\nDeseja continuar?"
    );
    if (!ok) return;

    setIsStandardizingTickers(true);
    try {
      const assets = await getAssets();
      let changed = 0;

      // Atualiza em lote (sequencial para evitar picos no IndexedDB)
      for (const a of assets) {
        const nextTicker = normalizeTickerForStorage(a.ticker, a.type);
        if (nextTicker && nextTicker !== a.ticker) {
          changed += 1;
          await saveAsset({
            ...a,
            ticker: nextTicker,
            updatedAt: Date.now(),
          });
        }
      }

      // Força recálculo/refresh em telas abertas (ouvintes do evento)
      notifyDataChange();

      toast({
        title: "Tickers padronizados",
        description:
          changed > 0
            ? `${changed} ativo(s) atualizado(s).` 
            : "Nenhum ticker precisava de ajuste.",
      });
    } catch (e) {
      console.error("[Settings] handleStandardizeTickers failed", e);
      toast({
        title: "Falha ao padronizar",
        description: "Não foi possível atualizar os tickers agora.",
        variant: "destructive",
      });
    } finally {
      setIsStandardizingTickers(false);
    }
  };

  // Busca os nomes reais dos ativos (via get-quotes) para os que ficaram só com o ticker
  // — caso típico de importação da B3 (o relatório de Negociação não traz o nome).
  const handleBackfillAssetNames = async () => {
    setIsBackfillingNames(true);
    try {
      const assets = await getAssets();
      const candidates = assets.filter((a) => {
        const n = (a.name || "").trim().toUpperCase();
        const t = (a.ticker || "").trim().toUpperCase();
        return !n || n === t;
      });

      if (candidates.length === 0) {
        toast({ title: "Nada a atualizar", description: "Todos os ativos já têm nome." });
        return;
      }

      const BATCH = 20; // alinhado ao limite por requisição da edge function get-quotes
      const nameByTicker = new Map<string, string>();
      for (let i = 0; i < candidates.length; i += BATCH) {
        const tickers = candidates.slice(i, i + BATCH).map((a) => a.ticker.toUpperCase());
        try {
          const { data } = await invokeBackendFunction<{
            quotes?: Array<{ ticker?: string; name?: string }>;
          }>("get-quotes", { body: { tickers } });

          for (const q of data?.quotes ?? []) {
            const key = String(q.ticker ?? "").toUpperCase();
            const nm = (q.name ?? "").trim();
            if (key && nm && nm.toUpperCase() !== key) nameByTicker.set(key, nm);
          }
        } catch (e) {
          console.warn("[Settings] backfill nomes: lote falhou", e);
        }
      }

      const updated: typeof candidates = [];
      for (const a of candidates) {
        const nm = nameByTicker.get(a.ticker.toUpperCase());
        if (nm) updated.push({ ...a, name: nm, updatedAt: Date.now() });
      }

      if (updated.length) {
        await saveAssetsBulk(updated);
      } else {
        notifyDataChange();
      }

      toast({
        title: updated.length ? "Nomes atualizados" : "Nenhum nome encontrado",
        description: updated.length
          ? `${updated.length} ativo(s) atualizado(s).`
          : "Não encontrei nomes para os ativos pendentes (cripto/Tesouro podem não ter nome na fonte).",
      });
    } catch (e) {
      console.error("[Settings] handleBackfillAssetNames failed", e);
      toast({ title: "Falha ao atualizar nomes", variant: "destructive" });
    } finally {
      setIsBackfillingNames(false);
    }
  };

  // Remove ativos órfãos (sem nenhuma transação nem provento) — sobras de importações
  // que falharam no meio (criaram o ativo mas não gravaram as transações).
  const handleRemoveOrphanAssets = async () => {
    const ok = window.confirm(
      "Remover ativos que não têm NENHUMA transação nem provento?\n\n" +
        "São sobras de importações que falharam (ex.: o ativo apareceu mas sem histórico). " +
        "Depois disso, reimporte os arquivos para recriar tudo corretamente."
    );
    if (!ok) return;

    setIsCleaningOrphans(true);
    try {
      const [assets, txs, divs] = await Promise.all([
        getAssets(),
        getTransactions(),
        getDividends(),
      ]);

      const usedAssetIds = new Set<string>();
      for (const t of txs) usedAssetIds.add(t.assetId);
      for (const d of divs) usedAssetIds.add(d.assetId);

      const orphanIds = assets.filter((a) => !usedAssetIds.has(a.id)).map((a) => a.id);

      if (orphanIds.length === 0) {
        toast({ title: "Nenhum ativo órfão", description: "Todos os ativos têm transações ou proventos." });
        return;
      }

      await deleteAssetsBulk(orphanIds);

      toast({
        title: "Ativos órfãos removidos",
        description: `${orphanIds.length} ativo(s) sem histórico foram removidos. Agora reimporte os arquivos.`,
      });
    } catch (e) {
      console.error("[Settings] handleRemoveOrphanAssets failed", e);
      toast({ title: "Falha ao limpar", variant: "destructive" });
    } finally {
      setIsCleaningOrphans(false);
    }
  };

  // Recalcula shares e valuePerShare de proventos importados com shares = 0,
  // usando o histórico de transações até a data do pagamento.
  const handleBackfillDividendShares = async () => {
    if (!isUnlocked) {
      toast({ title: "Cofre bloqueado", variant: "destructive" });
      return;
    }
    setIsBackfillingShares(true);
    try {
      const [dividends, transactions] = await Promise.all([
        getDividends(),
        getTransactions(),
      ]);

      // Build assetId -> sorted transactions map
      const txsByAsset = new Map<string, typeof transactions>();
      for (const tx of transactions) {
        const list = txsByAsset.get(tx.assetId) ?? [];
        list.push(tx);
        txsByAsset.set(tx.assetId, list);
      }

      const toUpdate: typeof dividends = [];
      for (const div of dividends) {
        if (div.shares > 0) continue; // already has shares

        const assetTxs = txsByAsset.get(div.assetId) ?? [];
        let sharesOnDate = 0;
        for (const tx of assetTxs) {
          if (tx.date <= div.paymentDate) {
            sharesOnDate += tx.type === "buy" ? tx.shares : -tx.shares;
          }
        }
        sharesOnDate = Math.max(0, Math.round(sharesOnDate * 1e8) / 1e8);
        if (sharesOnDate === 0) continue; // no transaction history for this asset

        const valuePerShare =
          sharesOnDate > 0 ? div.totalValue / sharesOnDate : 0;
        toUpdate.push({ ...div, shares: sharesOnDate, valuePerShare });
      }

      if (toUpdate.length === 0) {
        toast({ title: "Nenhum provento precisava de ajuste" });
        return;
      }

      await saveDividendsBulk(toUpdate);
      toast({
        title: "Cotas recalculadas",
        description: `${toUpdate.length} provento(s) atualizados com a quantidade de cotas na data do pagamento.`,
      });
    } catch (e) {
      console.error("[Settings] handleBackfillDividendShares failed", e);
      toast({ title: "Falha ao recalcular cotas", variant: "destructive" });
    } finally {
      setIsBackfillingShares(false);
    }
  };

  const renderDataSection = () => (
    <div className="space-y-6">
      {/* Google Drive Section */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Cloud className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Google Drive</h3>
            <p className="text-sm text-muted-foreground">Sincronização automática na nuvem</p>
          </div>
        </div>

        {isConnected ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between rounded-lg border border-success/20 bg-success/5 p-4">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" />
                <span className="text-sm font-medium text-success">Conectado</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnectGoogleDrive}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                Desconectar
              </Button>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
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

            <div className="text-sm text-muted-foreground">
              Último sync: {formatLastSync(syncStatus.lastSyncAt)}
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={handleSyncFromCloud}
                disabled={isLoading}
              >
                <Download className="h-4 w-4" />
                Baixar da nuvem
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={handleSyncToCloud}
                disabled={isLoading}
              >
                {isLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Enviar para nuvem
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {showClientIdInput ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-warning/20 bg-warning/5 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
                    <div className="text-sm text-warning">
                      <p className="font-medium">Avançado: usar seu próprio OAuth</p>
                      <p className="mt-1 text-warning/80">
                        Opcional. Para zero-knowledge total, crie seu próprio projeto no
                        Google Cloud Console e gere um Client ID.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="client-id">Google OAuth Client ID</Label>
                    <GoogleOAuthTutorial />
                  </div>
                  <Input
                    id="client-id"
                    placeholder="seu-client-id.apps.googleusercontent.com"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowClientIdInput(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
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

      {/* Manual Backup Section */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Database className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Backup Manual</h3>
            <p className="text-sm text-muted-foreground">Exporte dados criptografados como arquivo .vault</p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={handleExport}
            disabled={isLoading}
          >
            <Download className="h-4 w-4" />
            Exportar Backup
          </Button>

          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
          >
            <Upload className="h-4 w-4" />
            Importar Backup
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".vault,.json"
            className="hidden"
            onChange={handleImport}
          />
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Seus dados permanecem criptografados. Ninguém além de você pode acessá-los.
        </p>
      </div>

      {/* Maintenance */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <RefreshCw className={"h-5 w-5 text-muted-foreground"} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Manutenção</h3>
            <p className="text-sm text-muted-foreground">
              Corrige tickers antigos para o padrão (sem .SA e sem F do fracionário)
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Útil se você já tinha ativos salvos como “HGBS11.SA” ou “PETR4F”.
          </p>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleStandardizeTickers}
            disabled={isStandardizingTickers || isLoading}
          >
            {isStandardizingTickers ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Padronizar tickers existentes
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Busca o nome dos ativos que ficaram só com o código (ex.: importação da B3).
          </p>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleBackfillAssetNames}
            disabled={isBackfillingNames || isLoading}
          >
            {isBackfillingNames ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Tag className="h-4 w-4" />
            )}
            Atualizar nomes dos ativos
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Remove ativos sem nenhuma transação/provento (sobras de importações que falharam).
            Faça isto se uma importação deu erro e ficaram ativos duplicados/vazios.
          </p>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleRemoveOrphanAssets}
            disabled={isCleaningOrphans || isLoading}
          >
            {isCleaningOrphans ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Remover ativos órfãos
          </Button>
        </div>

        <div className="pt-4 border-t border-border/50 space-y-2">
          <p className="text-sm font-medium text-foreground">Recalcular cotas dos proventos</p>
          <p className="text-xs text-muted-foreground">
            Preenche a quantidade de cotas e o valor por cota nos proventos importados sem essa informação,
            usando o histórico de transações na data de cada pagamento.
            Execute após importar as negociações.
          </p>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleBackfillDividendShares}
            disabled={isBackfillingShares || isLoading}
          >
            {isBackfillingShares ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Recalcular cotas dos proventos
          </Button>
        </div>

      </div>
    </div>
  );

  const renderProfileSection = () => (
    <div className="rounded-xl border border-border bg-card p-6 shadow-card">
      <h3 className="text-lg font-semibold text-foreground mb-6">
        Informações do Perfil
      </h3>

      <div className="space-y-4">
        {user && (
          <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 border border-border/50">
            {user.photoURL && (
              <img
                src={user.photoURL}
                alt={user.displayName || "Avatar"}
                className="h-12 w-12 rounded-full"
              />
            )}
            <div>
              <p className="font-medium text-foreground">{user.displayName || "Usuário"}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
        )}
        
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Nome completo</Label>
            <Input id="name" defaultValue={user?.displayName || ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              defaultValue={user?.email || ""}
              disabled
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cpf">CPF</Label>
          <Input id="cpf" defaultValue="***.***.***-00" disabled />
          <p className="text-xs text-muted-foreground">
            Usado para cálculos de imposto de renda
          </p>
        </div>
      </div>
    </div>
  );

  const renderNotificationsSection = () => (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-6">
          Preferências de Notificação
        </h3>

        <div className="space-y-4">
          {[
            {
              id: "dividends" as const,
              label: "Proventos recebidos",
              description: "Notificar quando receber dividendos ou JCP",
              value: settingsDraft.notifications.dividends,
              onChange: (v: boolean) =>
                setSettingsDraft((s) => ({
                  ...s,
                  notifications: { ...s.notifications, dividends: v },
                })),
            },
            {
              id: "rebalance" as const,
              label: "Alertas de balanceamento",
              description: "Avisar quando a carteira estiver desbalanceada",
              value: settingsDraft.notifications.rebalance,
              onChange: (v: boolean) =>
                setSettingsDraft((s) => ({
                  ...s,
                  notifications: { ...s.notifications, rebalance: v },
                })),
            },
            {
              id: "tax" as const,
              label: "Lembretes de DARF",
              description: "Lembrar de pagar imposto mensal",
              value: settingsDraft.notifications.taxReminders,
              onChange: (v: boolean) =>
                setSettingsDraft((s) => ({
                  ...s,
                  notifications: { ...s.notifications, taxReminders: v },
                })),
            },
            {
              id: "price" as const,
              label: "Alertas de preço",
              description: "Notificar variações significativas",
              value: settingsDraft.notifications.priceAlerts,
              onChange: (v: boolean) =>
                setSettingsDraft((s) => ({
                  ...s,
                  notifications: { ...s.notifications, priceAlerts: v },
                })),
            },
          ].map((notification) => (
            <div
              key={notification.id}
              className="flex items-center justify-between rounded-lg border border-border/50 p-4"
            >
              <div>
                <p className="font-medium text-foreground">{notification.label}</p>
                <p className="text-sm text-muted-foreground">{notification.description}</p>
              </div>
              <Switch
                checked={notification.value}
                onCheckedChange={notification.onChange}
                disabled={!isSettingsReady}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-2">Preço médio por proventos</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Define se alguns proventos devem reduzir o custo (preço médio) do ativo.
        </p>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
            <div>
              <p className="font-medium text-foreground">FIIs: rendimento reduz custo</p>
              <p className="text-sm text-muted-foreground">
                Regra usada: ao registrar <span className="font-medium">Yield/Rendimento</span> em FIIs,
                o sistema pode tratar como retorno de capital e reduzir o custo efetivo.
              </p>
            </div>
            <Switch
              checked={settingsDraft.averagePriceAdjustments?.fiiYieldReducesCost ?? true}
              onCheckedChange={(v) =>
                setSettingsDraft((s) => ({
                  ...s,
                  averagePriceAdjustments: {
                    fiiYieldReducesCost: v,
                    jcpReducesCost: s.averagePriceAdjustments?.jcpReducesCost ?? false,
                  },
                }))
              }
              disabled={!isSettingsReady}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
            <div>
              <p className="font-medium text-foreground">JCP reduz custo</p>
              <p className="text-sm text-muted-foreground">
                Regra usada: quando habilitado, JCP pode ser tratado como retorno que reduz o custo.
                Se você prefere tratar JCP apenas como renda (sem mexer no custo), deixe desativado.
              </p>
            </div>
            <Switch
              checked={settingsDraft.averagePriceAdjustments?.jcpReducesCost ?? false}
              onCheckedChange={(v) =>
                setSettingsDraft((s) => ({
                  ...s,
                  averagePriceAdjustments: {
                    fiiYieldReducesCost: s.averagePriceAdjustments?.fiiYieldReducesCost ?? true,
                    jcpReducesCost: v,
                  },
                }))
              }
              disabled={!isSettingsReady}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Observação: isso afeta apenas o cálculo do seu preço médio/custo; não muda o registro do provento.
          </p>
        </div>
      </div>
    </div>
  );

  const renderSectionContent = () => {
    switch (activeSection) {
      case "data":
        return renderDataSection();
      case "profile":
        return renderProfileSection();
      case "notifications":
        return renderNotificationsSection();
      default:
        return (
          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              {settingsSections.find(s => s.id === activeSection)?.title}
            </h3>
            <p className="text-muted-foreground">
              Esta seção estará disponível em breve.
            </p>
          </div>
        );
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
          <p className="text-muted-foreground">
            Gerencie suas preferências e conta
          </p>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Settings Navigation */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-2"
          >
            {settingsSections.map((section, index) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <motion.button
                  key={section.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + index * 0.05 }}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 ${
                    isActive ? "bg-accent border-primary/20" : "bg-card border-border"
                  }`}
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{section.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {section.description}
                    </p>
                  </div>
                </motion.button>
              );
            })}
          </motion.div>

          {/* Settings Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-2 space-y-6"
          >
            {renderSectionContent()}

            {/* Save Button */}
            {(activeSection === "profile" || activeSection === "notifications") && (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSettingsDraft(savedSettings)}
                  disabled={!isSettingsReady}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      if (!isUnlocked) {
                        toast({
                          title: "Cofre bloqueado",
                          description: "Desbloqueie o cofre para salvar configurações.",
                          variant: "destructive",
                        });
                        return;
                      }

                      const now = Date.now();
                      const payload = {
                        ...settingsDraft,
                        updatedAt: now,
                        // garante defaults do bloco novo
                        averagePriceAdjustments: {
                          fiiYieldReducesCost:
                            settingsDraft.averagePriceAdjustments?.fiiYieldReducesCost ?? true,
                          jcpReducesCost: settingsDraft.averagePriceAdjustments?.jcpReducesCost ?? false,
                        },
                      };

                      await saveSettings(payload as any);
                      setSavedSettings(payload as any);
                      toast({ title: "Configurações salvas" });
                    } catch (e) {
                      console.error("[Settings] saveSettings failed", e);
                      toast({
                        title: "Erro ao salvar",
                        description: "Não foi possível salvar suas configurações.",
                        variant: "destructive",
                      });
                    }
                  }}
                  disabled={!isSettingsReady}
                >
                  Salvar Alterações
                </Button>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </DashboardLayout>
  );
}
