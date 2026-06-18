import {
  ArrowLeft,
  BarChart3,
  CheckCircle,
  ChevronRight,
  Cloud,
  Download,
  FileText,
  Lock,
  Scale,
  Shield,
  Wallet,
} from "lucide-react";
import type { ElementType } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

type FeaturePage = {
  slug: string;
  title: string;
  metaTitle: string;
  description: string;
  eyebrow: string;
  hero: string;
  intro: string;
  icon: ElementType;
  highlights: string[];
  stepsTitle: string;
  steps: string[];
  featuresTitle: string;
  features: { title: string; description: string }[];
  trustTitle: string;
  trustDescription: string;
  faq: { question: string; answer: string }[];
};

const SITE_URL = "https://cofreinvestimentos.com.br";

const pages: Record<string, FeaturePage> = {
  "importar-b3": {
    slug: "importar-b3",
    title: "Importar dados da B3",
    metaTitle: "Importar dados da B3 para sua carteira | Cofre Investimentos",
    description:
      "Importe arquivos da B3 para organizar negociações, movimentações, proventos e Tesouro Direto em uma carteira privada e criptografada.",
    eyebrow: "Importação B3",
    hero: "Leve seu histórico da B3 para uma carteira organizada",
    intro:
      "O Cofre Investimentos ajuda a transformar arquivos da Área do Investidor em uma visão prática de carteira, com transações, proventos e posição consolidados sem enviar seus dados financeiros para servidores.",
    icon: Download,
    highlights: ["Negociação", "Movimentação", "Tesouro Direto", "Deduplicação"],
    stepsTitle: "Como funciona a importação",
    steps: [
      "Baixe os arquivos de negociação ou movimentação no portal da B3.",
      "Entre no Cofre Investimentos e escolha a carteira que receberá os dados.",
      "Envie o arquivo; o app identifica o formato e evita duplicatas em reimportações.",
    ],
    featuresTitle: "O que a página privada de importação resolve",
    features: [
      {
        title: "Compras e vendas",
        description:
          "Registra operações de ações, FIIs, ETFs, BDRs e outros ativos negociados na bolsa.",
      },
      {
        title: "Proventos e eventos",
        description:
          "Organiza dividendos, JCP, rendimentos e movimentações relevantes para acompanhamento da carteira.",
      },
      {
        title: "Tesouro Direto",
        description:
          "Converte títulos importados para um padrão interno compatível com cotação e acompanhamento.",
      },
    ],
    trustTitle: "A importação acontece no seu navegador",
    trustDescription:
      "Os dados importados são gravados no cofre local, criptografados no dispositivo. O app consulta cotações por ticker, mas não envia sua posição, transações ou patrimônio.",
    faq: [
      {
        question: "A importação da B3 fica disponível sem login?",
        answer:
          "Não. Esta página explica o recurso publicamente, mas a importação real acontece dentro do app, após login e desbloqueio do cofre.",
      },
      {
        question: "Posso importar o mesmo arquivo mais de uma vez?",
        answer:
          "Sim. O importador foi desenhado para detectar duplicatas e reduzir o risco de registros repetidos.",
      },
      {
        question: "Meus arquivos da B3 são enviados para algum servidor?",
        answer:
          "Não para armazenamento. A leitura do arquivo e a organização dos dados acontecem no navegador.",
      },
    ],
  },
  "controle-carteira-investimentos": {
    slug: "controle-carteira-investimentos",
    title: "Controle de carteira de investimentos",
    metaTitle: "Controle de carteira de investimentos privado | Cofre Investimentos",
    description:
      "Controle carteira de investimentos com multi-carteira, preço médio, P&L, ganho do dia e visão consolidada com criptografia local.",
    eyebrow: "Gestão de carteira",
    hero: "Acompanhe sua carteira sem abrir mão da privacidade",
    intro:
      "Organize ativos, carteiras e resultados em uma experiência local-first. O Cofre Investimentos foi criado para quem quer clareza financeira sem transformar patrimônio em dado de plataforma.",
    icon: Wallet,
    highlights: ["Multi-carteira", "Preço médio", "P&L", "Visão consolidada"],
    stepsTitle: "Como organizar sua carteira",
    steps: [
      "Crie carteiras para objetivos diferentes, como longo prazo, renda ou aposentadoria.",
      "Cadastre ativos manualmente ou importe movimentações da B3.",
      "Acompanhe posição, ganho do dia, preço médio e evolução patrimonial.",
    ],
    featuresTitle: "Recursos de acompanhamento",
    features: [
      {
        title: "Carteiras separadas",
        description:
          "Divida estratégias e objetivos sem perder a visão consolidada do patrimônio.",
      },
      {
        title: "Indicadores essenciais",
        description:
          "Veja preço médio, cotas, rentabilidade, P&L e participação de cada ativo.",
      },
      {
        title: "Painel prático",
        description:
          "Use gráficos e tabelas para comparar alocação, evolução e concentração.",
      },
    ],
    trustTitle: "Controle local, não uma conta financeira em servidor",
    trustDescription:
      "A carteira fica no IndexedDB do navegador, protegida por criptografia local. O app não mantém uma base central com seus ativos ou patrimônio.",
    faq: [
      {
        question: "O Cofre Investimentos substitui minha corretora?",
        answer:
          "Não. Ele organiza seus dados e ajuda no acompanhamento, mas ordens e custódia continuam na corretora.",
      },
      {
        question: "Posso usar mais de uma carteira?",
        answer:
          "Sim. O app suporta múltiplas carteiras para separar objetivos e estratégias.",
      },
      {
        question: "O app armazena meu patrimônio em servidor?",
        answer:
          "Não. A proposta é local-first: seus dados ficam no dispositivo e podem ser salvos em backup criptografado.",
      },
    ],
  },
  "imposto-renda-investimentos": {
    slug: "imposto-renda-investimentos",
    title: "Imposto de renda sobre investimentos",
    metaTitle: "Imposto de renda de investimentos com apoio privado | Cofre Investimentos",
    description:
      "Acompanhe ganhos, prejuízos, DARF, isenção de R$20 mil e informações de apoio para IR de investimentos, com dados criptografados localmente.",
    eyebrow: "IR e DARF",
    hero: "Tenha uma base organizada para revisar seu imposto de renda",
    intro:
      "O Cofre Investimentos calcula informações auxiliares para declaração e pagamento de imposto, mantendo o histórico financeiro protegido no seu dispositivo.",
    icon: FileText,
    highlights: ["DARF", "Isenção de R$20 mil", "GCAP", "Swing trade"],
    stepsTitle: "Como o apoio fiscal entra no fluxo",
    steps: [
      "Registre ou importe compras, vendas e eventos relevantes.",
      "Acompanhe ganhos e prejuízos por operação e período.",
      "Use os relatórios como referência para revisar DARF e declaração com suas fontes oficiais.",
    ],
    featuresTitle: "Pontos que o app ajuda a organizar",
    features: [
      {
        title: "Ganho e prejuízo",
        description:
          "Consolida resultados de operações para facilitar conferência mensal.",
      },
      {
        title: "Regras de apoio",
        description:
          "Considera pontos como isenção de R$20 mil e classificação de operações comuns.",
      },
      {
        title: "Histórico auditável",
        description:
          "Mantém registros para você voltar à origem dos cálculos quando precisar revisar.",
      },
    ],
    trustTitle: "Cálculo auxiliar, com conferência obrigatória",
    trustDescription:
      "Os recursos fiscais são apoio e podem evoluir. Sempre confira valores com informes oficiais, corretora, Receita Federal ou contador antes de emitir DARF ou enviar declaração.",
    faq: [
      {
        question: "O Cofre Investimentos envia minha declaração?",
        answer:
          "Não. O app ajuda a organizar dados e cálculos, mas não substitui o programa oficial da Receita Federal.",
      },
      {
        question: "O cálculo de DARF é definitivo?",
        answer:
          "Não. Ele é uma referência de apoio e deve ser conferido antes de qualquer pagamento.",
      },
      {
        question: "Meus dados fiscais ficam privados?",
        answer:
          "Sim. O histórico fica criptografado no dispositivo, seguindo a mesma lógica local-first do app.",
      },
    ],
  },
  "backup-criptografado-google-drive": {
    slug: "backup-criptografado-google-drive",
    title: "Backup criptografado no Google Drive",
    metaTitle: "Backup criptografado de investimentos no Google Drive | Cofre Investimentos",
    description:
      "Faça backup criptografado da sua carteira no Google Drive. O arquivo fica cifrado antes de sair do dispositivo e só abre com sua senha.",
    eyebrow: "Backup privado",
    hero: "Backup no Drive sem entregar seus dados financeiros",
    intro:
      "O backup do Cofre Investimentos foi pensado para resolver troca de dispositivo e perda de navegador sem criar um banco central com suas informações financeiras.",
    icon: Cloud,
    highlights: ["AES-256-GCM", "Zero-knowledge", "Google Drive", "Restauração"],
    stepsTitle: "Como o backup protege seus dados",
    steps: [
      "Você cria um cofre protegido por senha no navegador.",
      "O app cifra os dados antes de salvar o arquivo de backup.",
      "O Google Drive armazena apenas o arquivo criptografado, ilegível sem sua senha.",
    ],
    featuresTitle: "Por que esse modelo é diferente",
    features: [
      {
        title: "Sem leitura pelo servidor",
        description:
          "O conteúdo financeiro não precisa passar por uma base central do Cofre Investimentos.",
      },
      {
        title: "Restauração em outro dispositivo",
        description:
          "Você pode recuperar o cofre usando o backup e a senha correta.",
      },
      {
        title: "Controle do usuário",
        description:
          "O arquivo fica na sua conta Google Drive e pode ser removido por você.",
      },
    ],
    trustTitle: "Senha perdida significa dados irrecuperáveis",
    trustDescription:
      "A privacidade forte tem uma consequência: se você perder a senha e não tiver outro acesso válido, não há recuperação central. Anote a senha e mantenha backups atualizados.",
    faq: [
      {
        question: "O Google consegue ler meu backup?",
        answer:
          "Não o conteúdo financeiro. O arquivo enviado ao Drive já está criptografado pelo app.",
      },
      {
        question: "O Cofre Investimentos consegue recuperar minha senha?",
        answer:
          "Não. A senha não é guardada por um servidor de recuperação.",
      },
      {
        question: "Posso usar arquivo local em vez do Drive?",
        answer:
          "Sim. O app também oferece exportação e importação de backup em arquivo.",
      },
    ],
  },
  "rebalanceamento-carteira": {
    slug: "rebalanceamento-carteira",
    title: "Rebalanceamento de carteira",
    metaTitle: "Rebalanceamento de carteira por aporte | Cofre Investimentos",
    description:
      "Defina alocações-alvo e receba sugestões de aporte para rebalancear carteira sem venda, com dados privados no seu dispositivo.",
    eyebrow: "Alocação e estratégia",
    hero: "Rebalanceie com aportes, não com planilhas confusas",
    intro:
      "Defina pesos-alvo para seus ativos e veja onde o próximo aporte pode fazer mais diferença, preservando uma visão clara da alocação atual.",
    icon: Scale,
    highlights: ["Alocação-alvo", "Aportes sugeridos", "Sem venda", "Desvios"],
    stepsTitle: "Como usar o rebalanceamento",
    steps: [
      "Defina a porcentagem-alvo para cada ativo ou classe que você acompanha.",
      "Informe o valor de aporte disponível para o período.",
      "Veja sugestões priorizando ativos abaixo da alocação desejada.",
    ],
    featuresTitle: "Decisões que ficam mais claras",
    features: [
      {
        title: "Desvio da meta",
        description:
          "Identifique rapidamente quais ativos estão acima ou abaixo do planejado.",
      },
      {
        title: "Aporte direcionado",
        description:
          "Use dinheiro novo para aproximar a carteira da estratégia sem vender posições.",
      },
      {
        title: "Disciplina de longo prazo",
        description:
          "Reduza decisões impulsivas com uma regra de alocação explícita.",
      },
    ],
    trustTitle: "Sugestão não é recomendação de investimento",
    trustDescription:
      "O app calcula desvios com base nas metas que você definiu. Ele não avalia suitability, perfil de risco ou recomendação personalizada.",
    faq: [
      {
        question: "O app recomenda quais ativos comprar?",
        answer:
          "Não. Ele sugere distribuição de aporte conforme as metas informadas por você.",
      },
      {
        question: "Preciso vender ativos para rebalancear?",
        answer:
          "Não necessariamente. O foco do recurso é rebalanceamento por aporte, sem venda.",
      },
      {
        question: "As metas ficam salvas onde?",
        answer:
          "As metas ficam no cofre local, junto com os demais dados da carteira.",
      },
    ],
  },
};

function FeatureSeoPage({ page }: { page: FeaturePage }) {
  const canonical = `${SITE_URL}/${page.slug}`;
  const Icon = page.icon;
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Cofre Investimentos",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: page.title,
        item: canonical,
      },
    ],
  };

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Helmet>
        <title>{page.metaTitle}</title>
        <meta name="description" content={page.description} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={page.metaTitle} />
        <meta property="og:description" content={page.description} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <script type="application/ld+json">{JSON.stringify(faqJsonLd)}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbJsonLd)}</script>
      </Helmet>

      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold tracking-tight">Cofre Investimentos</span>
          </Link>
          <Button asChild size="sm" className="gap-2">
            <Link to="/">
              Entrar
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-border/50">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--secondary)/0.45),transparent_35%),linear-gradient(180deg,hsl(var(--card)/0.72),transparent)]" />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <Link
                to="/"
                className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar para o início
              </Link>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
                <Icon className="h-4 w-4" />
                {page.eyebrow}
              </div>
              <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                {page.hero}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
                {page.intro}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 gap-2 px-8 text-base">
                  <Link to="/">
                    Entrar com Google
                    <ChevronRight className="h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-12 gap-2 px-8 text-base">
                  <Link to="/ajuda">Ler manual</Link>
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-card">
              <div className="rounded-lg border border-border/70 bg-background/70 p-4">
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Recursos cobertos</span>
                  <Lock className="h-4 w-4 text-primary" />
                </div>
                <div className="grid gap-3">
                  {page.highlights.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium"
                    >
                      <CheckCircle className="h-4 w-4 shrink-0 text-primary" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{page.stepsTitle}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              O fluxo real acontece dentro do app autenticado, preservando o mesmo padrão de privacidade.
            </p>
          </div>
          <div className="grid gap-4">
            {page.steps.map((step, index) => (
              <div key={step} className="flex gap-4 rounded-xl border border-border bg-card p-5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <p className="text-sm leading-6 text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-border/50 bg-card/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-3xl font-bold tracking-tight">{page.featuresTitle}</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {page.features.map((feature) => (
                <article key={feature.title} className="rounded-xl border border-border bg-card p-6">
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{feature.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">{page.trustTitle}</h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">{page.trustDescription}</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight">Perguntas frequentes</h2>
            <div className="mt-5 divide-y divide-border rounded-xl border border-border bg-card">
              {page.faq.map((item) => (
                <details key={item.question} className="group p-5">
                  <summary className="cursor-pointer list-none font-medium">
                    <span className="flex items-center justify-between gap-4">
                      {item.question}
                      <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border/50 bg-card/30">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-12 sm:px-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Use o recurso dentro do Cofre Investimentos</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Crie seu cofre, mantenha seus dados criptografados e organize sua vida financeira com mais controle.
              </p>
            </div>
            <Button asChild size="lg" className="h-12 gap-2 px-8 text-base">
              <Link to="/">
                Começar agora
                <ChevronRight className="h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

export function ImportarB3Page() {
  return <FeatureSeoPage page={pages["importar-b3"]} />;
}

export function ControleCarteiraPage() {
  return <FeatureSeoPage page={pages["controle-carteira-investimentos"]} />;
}

export function ImpostoRendaPage() {
  return <FeatureSeoPage page={pages["imposto-renda-investimentos"]} />;
}

export function BackupCriptografadoPage() {
  return <FeatureSeoPage page={pages["backup-criptografado-google-drive"]} />;
}

export function RebalanceamentoCarteiraPage() {
  return <FeatureSeoPage page={pages["rebalanceamento-carteira"]} />;
}
