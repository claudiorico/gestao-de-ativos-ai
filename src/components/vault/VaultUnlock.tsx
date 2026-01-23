/**
 * Vault Unlock Component - Decrypt local data with password
 * Zero-Knowledge: password never leaves the client
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, Eye, EyeOff, AlertTriangle, Trash2, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import { toast } from '@/hooks/use-toast';
import { isPersistentStorageEnabled, requestPersistentStorage } from '@/lib/indexeddb';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface VaultUnlockProps {
  onUnlock: () => void;
  onReset: () => void;
}

export function VaultUnlock({ onUnlock, onReset }: VaultUnlockProps) {
  const { unlockVault, wipeAllData, error } = useSecureStorage();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [persistBusy, setPersistBusy] = useState(false);

  useEffect(() => {
    isPersistentStorageEnabled().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isSubmitting || !password) return;
    
    setIsSubmitting(true);
    try {
      const success = await unlockVault(password);
      if (success) {
        onUnlock();
      } else {
        setAttempts((prev) => prev + 1);
        setPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async () => {
    await wipeAllData();
    onReset();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
          {/* Header */}
          <div className="mb-8 text-center">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"
            >
              <Lock className="h-8 w-8 text-primary" />
            </motion.div>
            <h1 className="text-2xl font-bold text-foreground">
              Desbloquear Cofre
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Digite sua senha para acessar seus dados
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Password Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Senha de Criptografia
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                  autoComplete="current-password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-lg bg-loss-muted p-3 text-sm text-loss"
              >
                <AlertTriangle className="h-4 w-4" />
                {error}
                {attempts >= 3 && (
                  <span className="ml-auto text-xs">
                    Tentativa {attempts}
                  </span>
                )}
              </motion.div>
            )}

            {/* Submit Button */}
            <Button type="submit" className="w-full h-12" disabled={isSubmitting || !password}>
              {isSubmitting ? 'Desbloqueando...' : 'Desbloquear'}
            </Button>
          </form>

          {/* Persistent Storage */}
          <div className="mt-6 rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Persistência do cofre</p>
                <p className="text-xs text-muted-foreground">
                  {persisted === true
                    ? 'Ativa: o navegador tende a não limpar seus dados.'
                    : persisted === false
                      ? 'Inativa: seus dados podem ser removidos em limpezas automáticas.'
                      : 'Indisponível neste navegador.'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={persistBusy || persisted !== false}
                onClick={async () => {
                  setPersistBusy(true);
                  try {
                    const granted = await requestPersistentStorage();
                    const next = await isPersistentStorageEnabled();
                    setPersisted(next);

                    toast({
                      title: granted ? 'Persistência ativada' : 'Persistência negada',
                      description: granted
                        ? 'O navegador tende a não limpar os dados do cofre.'
                        : 'Seu navegador recusou a persistência. Ainda funciona, mas pode ser apagado em limpezas automáticas (principalmente em modo anônimo / pouca memória).',
                      variant: granted ? undefined : 'destructive',
                    });
                  } catch (e) {
                    console.error('[Vault] Persist request failed', e);
                    toast({
                      title: 'Não foi possível ativar',
                      description: 'Este navegador não suportou ou bloqueou a persistência.',
                      variant: 'destructive',
                    });
                    setPersisted(await isPersistentStorageEnabled().catch(() => null));
                  } finally {
                    setPersistBusy(false);
                  }
                }}
              >
                <HardDrive className="h-4 w-4" />
                {persisted === true ? 'Ativo' : persistBusy ? 'Ativando...' : 'Ativar'}
              </Button>
            </div>
          </div>

          {/* Reset Option */}
          {attempts >= 3 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 pt-6 border-t border-border"
            >
              <p className="text-sm text-muted-foreground mb-3">
                Esqueceu sua senha? Você pode resetar o cofre, mas todos os dados serão perdidos.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="w-full gap-2 text-loss hover:text-loss">
                    <Trash2 className="h-4 w-4" />
                    Resetar Cofre
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Resetar Cofre?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação é irreversível. Todos os seus dados financeiros serão permanentemente excluídos do seu dispositivo.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleReset}
                      className="bg-loss text-loss-foreground hover:bg-loss/90"
                    >
                      Resetar Tudo
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </motion.div>
          )}
        </div>

        {/* Privacy Footer */}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          🔒 Seus dados permanecem criptografados no seu dispositivo
        </p>
      </motion.div>
    </div>
  );
}
