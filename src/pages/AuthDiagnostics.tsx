import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Globe, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AuthDiagnostics() {
  const info = useMemo(() => {
    const { origin, hostname } = window.location;

    const suggestedDomains = [
      "localhost",
      hostname,
      // Users typically also need their published/custom domains.
      "seu-dominio.com",
      "www.seu-dominio.com",
    ];

    return { origin, hostname, suggestedDomains };
  }, []);

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">Diagnóstico de autenticação</h1>
            <p className="text-sm text-muted-foreground">
              Use esta página quando o login falhar por <strong>domínio não autorizado</strong>.
            </p>
          </div>

          <Button asChild variant="outline" className="gap-2">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Link>
          </Button>
        </div>

        <Card className="p-6">
          <div className="flex items-start gap-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10"
            >
              <AlertTriangle className="h-5 w-5 text-warning" />
            </motion.div>

            <div className="space-y-3">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">Domínio atual do app</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="gap-2">
                    <Globe className="h-3.5 w-3.5" />
                    {info.hostname}
                  </Badge>
                  <span className="text-sm text-muted-foreground">({info.origin})</span>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="font-medium text-foreground">O que adicionar em “Authorized domains”</h3>
                <p className="text-sm text-muted-foreground">
                  No seu provedor de autenticação, inclua pelo menos o domínio do preview acima. Se você publicar ou usar
                  domínio custom, inclua também o domínio raiz e o <code>www</code>.
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {info.suggestedDomains.map((d) => (
                    <li key={d}>
                      <code className="text-foreground">{d}</code>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Dica: se o erro for <code>auth/unauthorized-domain</code>, quase sempre falta adicionar o domínio do preview
                  ou do deploy na lista.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <ShieldCheck className="h-4 w-4 text-success" />
                <p className="text-sm text-muted-foreground">
                  Depois de salvar, tente entrar novamente. Algumas mudanças podem levar alguns minutos para propagar.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
