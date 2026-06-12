import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Shield, Cloud, BarChart3, Scale, Coins, FileText,
  Download, Lock, Eye, EyeOff, Database, CheckCircle,
  ChevronRight, Github,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthUser } from '@/contexts/GoogleUserContext';
import { useGoogleUser } from '@/contexts/GoogleUserContext';
import {
  initiateGoogleAuth,
  getGoogleDriveConfig,
  getAppGoogleClientId,
} from '@/lib/google-drive';

const features = [
  {
    icon: BarChart3,
    title: 'Portfólio',
    description: 'Multi-carteira, cotas, preço médio, P&L e ganho do dia consolidados.',
  },
  {
    icon: Scale,
    title: 'Balanceamento',
    description: 'Sugestões automáticas de compra por aporte ou rebalanceamento sem venda.',
  },
  {
    icon: Coins,
    title: 'Proventos',
    description: 'Dividendos, JCP e rendimentos com histórico e Yield on Cost.',
  },
  {
    icon: FileText,
    title: 'Imposto de Renda',
    description: 'DARF automático, isenção de R$20k, GCAP e swing trade calculados.',
  },
  {
    icon: Cloud,
    title: 'Backup Google Drive',
    description: 'O arquivo salvo no Drive é criptografado — a Google não consegue abrir.',
  },
  {
    icon: Download,
    title: 'Importar B3',
    description: 'Importação de CSV de negociação, movimentação e Tesouro Direto.',
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: 'easeOut' },
  }),
};

export default function Landing() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuthUser();
  const { login } = useGoogleUser();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  if (!isAuthLoading && isAuthenticated) {
    return <Navigate to="/home" replace />;
  }

  const handleLogin = async () => {
    setLoginError(null);
    const clientId = getAppGoogleClientId();
    if (!clientId) {
      navigate('/home');
      return;
    }
    setIsLoading(true);
    try {
      const result = await initiateGoogleAuth(clientId);
      if (result !== 'pending') {
        const config = getGoogleDriveConfig();
        if (config?.accessToken && config.expiresAt) {
          const expiresIn = Math.floor((config.expiresAt - Date.now()) / 1000);
          await login(config.accessToken, expiresIn);
          navigate('/home');
        }
      }
    } catch (err) {
      setLoginError('Falha ao conectar com o Google. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">

      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold tracking-tight">Cofre Investimentos</span>
          </div>
          <Button onClick={handleLogin} disabled={isLoading} size="sm" className="gap-2">
            {isLoading ? 'Entrando...' : 'Entrar'}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-24 sm:px-6 sm:pt-32 text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={0}
            className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm text-primary mb-8"
          >
            <Lock className="h-3.5 w-3.5" />
            Seus dados ficam só no seu dispositivo
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
            className="text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl"
          >
            Seus investimentos.
            <br />
            <span className="text-primary">Só seus.</span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
            className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground"
          >
            Gerencie portfólio, IR e proventos com os dados criptografados no seu
            próprio dispositivo — nenhum servidor acessa suas informações financeiras.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={3}
            className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
          >
            <Button onClick={handleLogin} disabled={isLoading} size="lg" className="h-12 gap-2 px-8 text-base">
              {isLoading ? 'Aguarde...' : 'Entrar com Google'}
              <ChevronRight className="h-5 w-5" />
            </Button>
          </motion.div>
          {loginError && (
            <p className="mt-4 text-center text-sm text-destructive">{loginError}</p>
          )}

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={4}
            className="mt-10 flex flex-wrap justify-center gap-6 text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <CheckCircle className="h-4 w-4 text-primary" /> Criptografia AES-256 local
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle className="h-4 w-4 text-primary" /> Backup no Google Drive
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle className="h-4 w-4 text-primary" /> Gratuito e código aberto
            </span>
          </motion.div>
        </div>
      </section>

      {/* Segurança */}
      <section className="border-y border-border/50 bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-14"
          >
            <h2 className="text-3xl font-bold sm:text-4xl">Seus dados nunca saem daqui</h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              A criptografia acontece no seu navegador. Nem nós, nem o Google,
              nem nenhum servidor tem acesso ao conteúdo do seu cofre.
            </p>
          </motion.div>

          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                icon: Lock,
                title: 'Cofre local',
                description: 'Todos os dados são cifrados com AES-256 no seu dispositivo antes de qualquer operação. A senha nunca trafega pela rede.',
              },
              {
                icon: EyeOff,
                title: 'Zero-knowledge',
                description: 'Não coletamos informações pessoais, não há telemetria e não existe conta no nosso servidor. Seu portfólio é só seu.',
              },
              {
                icon: Database,
                title: 'Backup cifrado',
                description: 'O arquivo salvo no Google Drive é criptografado com sua senha. Apenas você consegue abrir — nem a Google tem acesso.',
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                custom={i}
                className="rounded-xl border border-border bg-card p-6"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
          className="text-center mb-14"
        >
          <h2 className="text-3xl font-bold sm:text-4xl">Tudo para gerir seus investimentos</h2>
          <p className="mt-4 text-muted-foreground">
            Do portfólio ao imposto de renda, integrado e privado.
          </p>
        </motion.div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              custom={i}
              className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/30 hover:bg-card/80"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/20">
                <feature.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mb-1.5 font-semibold">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Backup destaque */}
      <section className="border-y border-border/50 bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="flex flex-col items-center gap-10 lg:flex-row lg:gap-16">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              custom={0}
              className="flex-1"
            >
              <h2 className="text-3xl font-bold sm:text-4xl">
                Backup no Google Drive —<br />sem abrir mão da privacidade
              </h2>
              <p className="mt-4 text-muted-foreground">
                O arquivo enviado ao Drive é criptografado com sua senha antes de sair do
                dispositivo. A Google armazena um cofre que não consegue abrir.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  'Backup automático a cada alteração',
                  'Restaure em qualquer dispositivo com sua senha',
                  'Criptografia ponta-a-ponta com sua chave',
                  'Suporte a Windows Hello (biometria)',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle className="h-4 w-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              custom={1}
              className="flex flex-1 justify-center"
            >
              <div className="relative w-full max-w-sm">
                <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-xl">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                    <Cloud className="h-8 w-8 text-primary" />
                  </div>
                  <p className="font-semibold">Google Drive</p>
                  <p className="mt-1 text-sm text-muted-foreground">cofre.investpro.bak</p>
                  <div className="mt-4 rounded-lg border border-border bg-background/50 p-3 text-left font-mono text-xs text-muted-foreground">
                    <p>AES-256-GCM encrypted</p>
                    <p className="mt-1 opacity-60">QkFTRTY0...</p>
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    Ilegível sem sua senha
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6 text-center">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <h2 className="text-3xl font-bold sm:text-4xl">Comece agora. É gratuito.</h2>
          <p className="mt-4 text-muted-foreground">
            Seus dados ficam no seu dispositivo. Não coletamos informações pessoais.
          </p>
          <Button onClick={handleLogin} disabled={isLoading} size="lg" className="mt-8 h-12 gap-2 px-8 text-base">
            {isLoading ? 'Aguarde...' : 'Entrar com Google'}
            <ChevronRight className="h-5 w-5" />
          </Button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-card/20">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span>© {new Date().getFullYear()} Cofre Investimentos</span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/claudiorico81/gestao-de-ativos-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <Github className="h-4 w-4" />
              Código aberto
            </a>
            <a href="/privacy" className="hover:text-foreground transition-colors">
              Privacidade
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
