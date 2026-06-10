/**
 * Google Login Screen - First step authentication
 * Users must login with Google before accessing their vault
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Chrome, Shield, Lock, Cloud, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoogleOAuthTutorial } from '@/components/settings/GoogleOAuthTutorial';
import { useGoogleUser } from '@/contexts/GoogleUserContext';
import {
  initiateGoogleAuth,
  getGoogleDriveConfig,
  getPendingClientId,
  clearPendingClientId,
  checkPendingOAuthToken,
  getAppGoogleClientId,
} from '@/lib/google-drive';

interface GoogleLoginScreenProps {
  onLoginSuccess: () => void;
}

export function GoogleLoginScreen({ onLoginSuccess }: GoogleLoginScreenProps) {
  const appClientId = getAppGoogleClientId();
  const [clientId, setClientId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClientIdInput, setShowClientIdInput] = useState(false);

  const { login } = useGoogleUser();

  const handleGoogleLogin = async (idToUse: string) => {
    const trimmed = idToUse.trim();
    if (!trimmed) {
      setError('Insira seu Google OAuth Client ID');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await initiateGoogleAuth(trimmed);

      if (result !== 'pending') {
        // Popup flow completed
        const config = getGoogleDriveConfig();
        if (config?.accessToken && config.expiresAt) {
          const expiresIn = Math.floor((config.expiresAt - Date.now()) / 1000);
          await login(config.accessToken, expiresIn);
          onLoginSuccess();
        }
      }
      // If 'pending', redirect flow will handle it
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na autenticação');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-lg"
          >
            <Shield className="h-10 w-10 text-primary-foreground" />
          </motion.div>
          
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Cofre Investimentos
          </h1>
          <p className="text-muted-foreground">
            Gestão de investimentos com criptografia local
          </p>
        </div>

        {/* Main Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl border border-border bg-card p-8 shadow-xl"
        >
          {!showClientIdInput ? (
            <>
              {/* Benefits */}
              <div className="space-y-4 mb-8">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Lock className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground text-sm">Dados 100% seus</p>
                    <p className="text-xs text-muted-foreground">
                      Criptografados localmente, nunca saem do dispositivo
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Cloud className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground text-sm">Backup automático</p>
                    <p className="text-xs text-muted-foreground">
                      Sincroniza com seu Google Drive pessoal
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Chrome className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground text-sm">Multi-dispositivo</p>
                    <p className="text-xs text-muted-foreground">
                      Cada conta Google tem seu próprio cofre
                    </p>
                  </div>
                </div>
              </div>

              {/* Login Button */}
              <Button
                className="w-full gap-3 h-12 text-base"
                disabled={isLoading}
                onClick={() => {
                  if (appClientId) {
                    handleGoogleLogin(appClientId);
                  } else {
                    // Sem Client ID do app configurado → cai no modo avançado.
                    setShowClientIdInput(true);
                  }
                }}
              >
                {isLoading ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <Chrome className="h-5 w-5" />
                  </motion.div>
                ) : (
                  <Chrome className="h-5 w-5" />
                )}
                Entrar com Google
                <ArrowRight className="h-4 w-4 ml-auto" />
              </Button>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                >
                  <p className="text-sm text-destructive">{error}</p>
                </motion.div>
              )}

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setShowClientIdInput(true);
                }}
                className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Usar meu próprio Client ID (avançado)
              </button>
            </>
          ) : (
            <>
              {/* Client ID Input */}
              <div className="space-y-4">
                <div className="rounded-lg border border-warning/20 bg-warning/5 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 text-warning shrink-0" />
                    <div className="text-sm text-warning">
                      <p className="font-medium">Configure seu OAuth</p>
                      <p className="mt-1 text-warning/80">
                        Para manter zero-knowledge, você usa seu próprio Client ID do Google Cloud Console.
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
                    onKeyDown={(e) => e.key === 'Enter' && handleGoogleLogin(clientId)}
                  />
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                  >
                    <p className="text-sm text-destructive">{error}</p>
                  </motion.div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowClientIdInput(false);
                      setError(null);
                    }}
                    disabled={isLoading}
                  >
                    Voltar
                  </Button>
                  <Button
                    className="flex-1 gap-2"
                    onClick={() => handleGoogleLogin(clientId)}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Chrome className="h-4 w-4" />
                      </motion.div>
                    ) : (
                      <Chrome className="h-4 w-4" />
                    )}
                    Conectar
                  </Button>
                </div>
              </div>
            </>
          )}
        </motion.div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          Seus dados financeiros nunca são enviados para servidores externos
        </p>
        <div className="flex justify-center gap-4 mt-2 text-xs text-muted-foreground">
          <a href="/ajuda" className="hover:text-foreground underline transition-colors">Manual de uso</a>
          <a href="/privacy" className="hover:text-foreground underline transition-colors">Privacidade</a>
        </div>
      </motion.div>
    </div>
  );
}
