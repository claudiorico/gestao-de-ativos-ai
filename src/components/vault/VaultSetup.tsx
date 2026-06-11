/**
 * Vault Setup Component - Initial encryption password setup
 * Zero-Knowledge: password never leaves the client
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Eye, EyeOff, Lock, AlertTriangle, HardDrive, Database, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import { useAuthUser } from '@/contexts/GoogleUserContext';
import { toast } from '@/hooks/use-toast';
import { isPersistentStorageEnabled, requestPersistentStorage } from '@/lib/indexeddb';
import { isBiometricSupported, enrollBiometric } from '@/lib/biometric-unlock';

interface VaultSetupProps {
  onComplete: () => void;
}

export function VaultSetup({ onComplete }: VaultSetupProps) {
  const { initializeVault, isLoading, localHasData, migrateFromLocal } = useSecureStorage();
  const { user } = useAuthUser();
  const namespace = user?.uid || 'default';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [persistBusy, setPersistBusy] = useState(false);

  const [bioSupported, setBioSupported] = useState(false);
  const [enrollBio, setEnrollBio] = useState(false);

  // Migration state
  const [showMigration, setShowMigration] = useState(false);
  const [migPassword, setMigPassword] = useState('');
  const [migError, setMigError] = useState('');
  const [isMigrating, setIsMigrating] = useState(false);

  useEffect(() => {
    isPersistentStorageEnabled().then(setPersisted).catch(() => setPersisted(null));
    isBiometricSupported().then(setBioSupported).catch(() => setBioSupported(false));
  }, []);

  // Show migration view by default when local data is available.
  useEffect(() => {
    if (localHasData) setShowMigration(true);
  }, [localHasData]);

  const handleMigrate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMigError('');
    if (!migPassword) { setMigError('Informe a senha do cofre local'); return; }
    setIsMigrating(true);
    try {
      await migrateFromLocal(migPassword);
      toast({ title: 'Migração concluída', description: 'Seus dados locais foram migrados para sua conta Google.' });
      onComplete();
    } catch (err) {
      setMigError(err instanceof Error ? err.message : 'Erro ao migrar dados');
    } finally {
      setIsMigrating(false);
    }
  };

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) return 'Mínimo de 8 caracteres';
    if (!/[A-Z]/.test(pwd)) return 'Inclua pelo menos uma letra maiúscula';
    if (!/[0-9]/.test(pwd)) return 'Inclua pelo menos um número';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const validationError = validatePassword(password);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    try {
      await initializeVault(password);

      if (enrollBio && bioSupported) {
        try {
          await enrollBiometric(namespace, password);
          toast({ title: 'Windows Hello ativado', description: 'Você poderá desbloquear pela biometria neste dispositivo.' });
        } catch (err) {
          const msg = err instanceof Error && err.message === 'PRF_UNSUPPORTED'
            ? 'Seu navegador não suporta a biometria para isso (precisa de Chrome/Edge atualizado).'
            : 'Não foi possível ativar a biometria agora; você pode ativar depois ao desbloquear.';
          toast({ title: 'Biometria não ativada', description: msg, variant: 'destructive' });
        }
      }

      onComplete();
    } catch (err) {
      setError('Erro ao criar cofre seguro');
    }
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
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              {showMigration ? <Database className="h-8 w-8 text-primary" /> : <Shield className="h-8 w-8 text-primary" />}
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              {showMigration ? 'Migrar Dados Locais' : 'Criar Cofre Seguro'}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {showMigration
                ? 'Mova seus dados do modo local para sua conta Google'
                : 'Seus dados financeiros serão criptografados localmente'}
            </p>
          </div>

          {/* Migration form */}
          {showMigration ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-primary/5 border border-primary/20 p-4 text-sm">
                <Database className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-foreground">Dados locais detectados</p>
                  <p className="mt-1 text-muted-foreground">
                    Você tem um cofre no modo sem login. Use a mesma senha para migrá-lo para esta conta Google — nada será recriptografado.
                  </p>
                </div>
              </div>

              <form onSubmit={handleMigrate} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Senha do cofre local
                  </label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={migPassword}
                      onChange={(e) => setMigPassword(e.target.value)}
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

                {migError && (
                  <div className="flex items-center gap-2 rounded-lg bg-loss-muted p-3 text-sm text-loss">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {migError}
                  </div>
                )}

                <Button type="submit" className="w-full h-12" disabled={isMigrating}>
                  {isMigrating ? 'Migrando...' : 'Migrar dados locais'}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => setShowMigration(false)}
                className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Não, criar um cofre novo
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          ) : (
          <>

          {/* Zero-Knowledge Badge */}
          <div className="mb-6 flex items-center gap-3 rounded-lg bg-success-muted p-4">
            <Lock className="h-5 w-5 text-success" />
            <div className="text-sm">
              <p className="font-medium text-success">Zero-Knowledge</p>
              <p className="text-success/80">
                Nenhum dado financeiro sai do seu dispositivo
              </p>
            </div>
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
                  autoComplete="new-password"
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

            {/* Confirm Password */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Confirmar Senha
              </label>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-loss-muted p-3 text-sm text-loss">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </div>
            )}

            {/* Warning */}
            <div className="rounded-lg bg-warning-muted p-4 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                <div className="text-warning">
                  <p className="font-medium">Importante</p>
                  <p className="mt-1 opacity-90">
                    Não há recuperação de senha. Se você esquecer, seus dados serão perdidos permanentemente.
                  </p>
                </div>
              </div>
            </div>

            {/* Persistent Storage */}
            <div className="rounded-lg border border-border bg-card/50 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Persistência do cofre</p>
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

            {/* Ativar Windows Hello */}
            {bioSupported && (
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={enrollBio}
                  onCheckedChange={(v) => setEnrollBio(Boolean(v))}
                  className="mt-0.5"
                />
                <span className="text-xs text-muted-foreground">
                  Ativar <strong>Windows Hello</strong> neste dispositivo para desbloquear pela
                  biometria (a senha continua válida como recuperação).
                </span>
              </label>
            )}

            {/* Submit Button */}
            <Button type="submit" className="w-full h-12" disabled={isLoading}>
              {isLoading ? 'Criando cofre...' : 'Criar Cofre Seguro'}
            </Button>

            {/* Switch to migration */}
            {localHasData && (
              <button
                type="button"
                onClick={() => setShowMigration(true)}
                className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Database className="h-3 w-3" />
                Migrar dados do modo local
              </button>
            )}
          </form>
          </>
          )}
        </div>

        {/* Privacy Footer */}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Criptografia AES-256-GCM • Dados armazenados apenas no seu dispositivo
        </p>
      </motion.div>
    </div>
  );
}
