import { forwardRef, useState } from "react";
import { motion } from "framer-motion";
import { Shield, Lock, Cloud, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/contexts/FirebaseAuthContext";
import { Link } from "react-router-dom";

type FirebaseLoginScreenProps = Record<string, never>;

export const FirebaseLoginScreen = forwardRef<HTMLDivElement, FirebaseLoginScreenProps>(
  function FirebaseLoginScreen(_props, ref) {
    const { login } = useFirebaseAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await login();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao fazer login");
    } finally {
      setIsLoading(false);
    }
  };

  const benefits = [
    {
      icon: Lock,
      title: "100% Criptografado",
      description: "Seus dados financeiros são criptografados localmente",
    },
    {
      icon: Cloud,
      title: "Backup Opcional",
      description: "Sincronize com Google Drive quando quiser",
    },
    {
      icon: Smartphone,
      title: "Multi-Dispositivo",
      description: "Acesse de qualquer lugar com sua conta Google",
    },
  ];

  return (
    <div
      ref={ref}
      className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md space-y-8"
      >
        {/* Logo */}
        <div className="text-center">
          <motion.div
            initial={{ scale: 0.5 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 mb-4"
          >
            <Shield className="h-10 w-10 text-primary" />
          </motion.div>
          <h1 className="text-3xl font-bold text-foreground">FinVault</h1>
          <p className="text-muted-foreground mt-2">Seu cofre financeiro pessoal</p>
        </div>

        {/* Benefits */}
        <div className="space-y-3">
          {benefits.map((benefit, index) => (
            <motion.div
              key={benefit.title}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + index * 0.1 }}
              className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <benefit.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">{benefit.title}</p>
                <p className="text-sm text-muted-foreground">{benefit.description}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Login Button */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <Button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full h-12 text-base gap-3"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {isLoading ? "Entrando..." : "Entrar com Google"}
          </Button>

          {error && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-destructive text-center">{error}</p>
              <p className="text-xs text-center text-muted-foreground">
                Se aparecer erro de <strong>domínio não autorizado</strong>, abra o{" "}
                <Link to="/auth/diagnostico" className="underline underline-offset-4">
                  diagnóstico de autenticação
                </Link>
                .
              </p>
            </div>
          )}
        </motion.div>

        {/* Footer */}
        <p className="text-xs text-center text-muted-foreground">
          Seus dados são criptografados e só você tem acesso.
        </p>
      </motion.div>
    </div>
  );
  }
);

