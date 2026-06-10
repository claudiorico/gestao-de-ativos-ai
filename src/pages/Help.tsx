import { ArrowLeft, BookOpen, Shield, Upload, Cloud, TrendingUp, RefreshCw, Fingerprint, HelpCircle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate, Link } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-md bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      <div className="pl-8 space-y-2 text-sm text-muted-foreground leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
        {n}
      </span>
      <span>{children}</span>
    </div>
  );
}

export default function Help() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-10">

        {/* Header */}
        <div className="space-y-4">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2 text-muted-foreground" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Manual de uso</h1>
              <p className="text-sm text-muted-foreground">Cofre Investimentos</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Gerencie portfólio, importações da B3, proventos e balanceamento — tudo com dados
            criptografados no seu próprio dispositivo.
          </p>
        </div>

        {/* Guia rápido */}
        <Section icon={ChevronRight} title="Primeiros passos">
          <div className="space-y-2">
            <Step n={1}>Faça login com sua conta Google (botão na tela inicial).</Step>
            <Step n={2}>Crie seu cofre escolhendo uma senha forte. <strong className="text-foreground">Anote essa senha</strong> — ela não pode ser recuperada, pois os dados ficam apenas no seu dispositivo.</Step>
            <Step n={3}>Em <strong className="text-foreground">Portfólio</strong>, crie sua primeira carteira (ex.: "Previdência", "Longo prazo").</Step>
            <Step n={4}>Adicione ativos manualmente ou importe pelo botão <strong className="text-foreground">Importar B3</strong>.</Step>
          </div>
        </Section>

        {/* Importação B3 */}
        <Section icon={Upload} title="Importar dados da B3">
          <p>O importador aceita três formatos de arquivo XLSX baixados direto do portal B3 (CEI / Área do Investidor):</p>
          <Accordion type="multiple" className="mt-2">
            <AccordionItem value="negociacao">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">
                Negociação (compra e venda)
              </AccordionTrigger>
              <AccordionContent className="text-sm space-y-2 pb-3">
                <p>Registra todas as compras e vendas de ações, FIIs, ETFs e BDRs. No portal B3, acesse <strong>Extratos → Negociação de Ativos</strong>, selecione o período e exporte o XLSX.</p>
                <p>O importador detecta automaticamente o tipo de arquivo e ignora duplicatas — pode importar o mesmo arquivo mais de uma vez sem problema.</p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="movimentacao">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">
                Movimentação (proventos e Tesouro Direto)
              </AccordionTrigger>
              <AccordionContent className="text-sm space-y-2 pb-3">
                <p>Importa dividendos, JCP, rendimentos e compras/vendas de Tesouro Direto. No portal B3, acesse <strong>Extratos → Movimentação</strong>.</p>
                <p>Para Tesouro Direto, o importador converte nomes como "Tesouro IPCA+ 2035" para o formato <code className="bg-muted px-1 rounded">TD:IPCA2035-05-15</code>, compatível com a busca de cotações.</p>
                <p className="text-yellow-600 dark:text-yellow-400">⚠ Se o campo de quantidade estiver vazio no arquivo da B3, o sistema calcula automaticamente as cotas pelo histórico de transações.</p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="fundos">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">
                Fundos e Tesouro (formato CSV próprio)
              </AccordionTrigger>
              <AccordionContent className="text-sm space-y-2 pb-3">
                <p>Para fundos de investimento (identificados pelo CNPJ) e Tesouro Direto, use o formato CSV do app. Clique em <strong>Baixar modelo</strong> na aba de importação para ver o exemplo.</p>
                <p>Cada linha deve ter: <code className="bg-muted px-1 rounded">ativo;classe;data;evento;qtd;preco;valor;observacao</code></p>
                <p>O app busca nome e cota do fundo automaticamente na base da CVM.</p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="cripto">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">
                Criptomoedas
              </AccordionTrigger>
              <AccordionContent className="text-sm space-y-2 pb-3">
                <p>Adicione manualmente ou via CSV (mesmo formato de negociação). Tickers no padrão de par (<code className="bg-muted px-1 rounded">BTCUSD</code>) são reconhecidos — as últimas 3 letras de moeda (USD, BRL) são ignoradas na busca de cotação.</p>
                <p>Cotações são buscadas via CoinGecko em BRL ou USD.</p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Section>

        {/* Backup */}
        <Section icon={Cloud} title="Backup e sincronização">
          <div className="space-y-2">
            <p>O cofre fica no seu navegador. Se limpar os dados do navegador ou trocar de dispositivo, você perde tudo — <strong className="text-foreground">faça backup regularmente</strong>.</p>
            <p><strong className="text-foreground">Google Drive (recomendado):</strong> em Configurações → Backup, conecte sua conta Google e ative o backup automático. O arquivo é salvo criptografado no Drive; sem sua senha, é ilegível.</p>
            <p><strong className="text-foreground">Arquivo local:</strong> use "Exportar backup" para salvar um arquivo <code className="bg-muted px-1 rounded">.json</code> no computador. Para restaurar, use "Importar backup" em qualquer dispositivo.</p>
            <p className="text-yellow-600 dark:text-yellow-400">⚠ O token do Google Drive expira periodicamente. Quando o ícone da nuvem ficar laranja no topo, clique nele para reconectar.</p>
          </div>
        </Section>

        {/* Balanceamento */}
        <Section icon={TrendingUp} title="Balanceamento de carteira">
          <div className="space-y-2">
            <p>Em cada ativo você pode definir uma <strong className="text-foreground">alocação-alvo</strong> (%). A tela de Balanceamento mostra quanto está fora do alvo e sugere aportes para rebalancear.</p>
            <p>Ativos com quantidade zerada e sem alocação-alvo são ocultados automaticamente (histórico preservado para IR).</p>
          </div>
        </Section>

        {/* Cotações */}
        <Section icon={RefreshCw} title="Cotações e preços">
          <div className="space-y-2">
            <p>Os preços são buscados automaticamente ao abrir o app e a cada 5 minutos, usando Edge Functions no Supabase. As fontes são:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><strong className="text-foreground">Ações / FIIs / ETFs:</strong> Yahoo Finance (.SA)</li>
              <li><strong className="text-foreground">Fundos CVM:</strong> arquivo INF_DIARIO da CVM (cota diária)</li>
              <li><strong className="text-foreground">Tesouro Direto:</strong> B3 / ANBIMA</li>
              <li><strong className="text-foreground">Criptomoedas:</strong> CoinGecko (em BRL)</li>
            </ul>
            <p>Se um ativo ficar com preço zerado, verifique se o ticker está no formato correto (sem sufixo <code className="bg-muted px-1 rounded">.SA</code>) e se os servidores de cotação estão acessíveis.</p>
          </div>
        </Section>

        {/* Biometria */}
        <Section icon={Fingerprint} title="Windows Hello / biometria">
          <div className="space-y-2">
            <p>Se o seu dispositivo suportar Windows Hello, Face ID ou leitor de impressão digital, você pode ativar o desbloqueio biométrico em <strong className="text-foreground">Configurações → Segurança</strong>.</p>
            <p>A senha do cofre é cifrada com um segredo gerado pelo autenticador do dispositivo — sem a biometria, o segredo é inacessível. A senha continua existindo como fallback.</p>
            <p className="text-yellow-600 dark:text-yellow-400">⚠ A credencial biométrica é vinculada ao dispositivo e ao domínio. Trocar de dispositivo ou de URL exige recadastro.</p>
          </div>
        </Section>

        {/* Manutenção */}
        <Section icon={RefreshCw} title="Manutenção (ações avançadas)">
          <p>Em <strong className="text-foreground">Configurações → Manutenção</strong> ficam as ações de correção:</p>
          <Accordion type="multiple" className="mt-2">
            <AccordionItem value="tickers">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">Padronizar tickers</AccordionTrigger>
              <AccordionContent className="text-sm pb-3">
                Remove sufixos legados (<code className="bg-muted px-1 rounded">.SA</code>, <code className="bg-muted px-1 rounded">F</code> de fracionário) de ativos importados em formato antigo.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="names">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">Atualizar nomes dos ativos</AccordionTrigger>
              <AccordionContent className="text-sm pb-3">
                Busca o nome real (razão social) para ativos que ficaram apenas com o ticker após a importação da B3 Negociação.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="orphans">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">Remover ativos órfãos</AccordionTrigger>
              <AccordionContent className="text-sm pb-3">
                Exclui ativos que foram criados mas não têm nenhuma transação nem provento — geralmente resultado de uma importação interrompida. Use antes de reimportar para evitar duplicatas.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="shares">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">Recalcular cotas dos proventos</AccordionTrigger>
              <AccordionContent className="text-sm pb-3">
                O arquivo de Movimentação da B3 frequentemente omite a quantidade de cotas nos proventos. Esta ação recalcula pelo histórico de transações até a data de cada pagamento. Execute após importar as negociações.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Section>

        {/* FAQ */}
        <Section icon={HelpCircle} title="Perguntas frequentes">
          <Accordion type="multiple" className="mt-2">
            <AccordionItem value="faq1">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">
                Posso usar em vários dispositivos?
              </AccordionTrigger>
              <AccordionContent className="text-sm pb-3">
                Sim. Faça backup no Google Drive em um dispositivo e restaure no outro. As senhas de cofre são independentes por dispositivo — pode usar senhas diferentes em cada um.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="faq2">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">
                Esqueci a senha do cofre. O que faço?
              </AccordionTrigger>
              <AccordionContent className="text-sm pb-3">
                Não há recuperação de senha — essa é a garantia de que ninguém além de você acessa os dados. Se tiver backup no Drive ou em arquivo, pode criar um novo cofre e restaurar o backup (o backup usa a senha que estava ativa quando foi gerado). Sem backup, os dados são irrecuperáveis.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="faq3">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">
                Por que o app pede acesso ao Google Drive?
              </AccordionTrigger>
              <AccordionContent className="text-sm pb-3">
                Apenas para salvar e restaurar backups na <em>sua</em> conta Drive. O app não acessa nenhum outro arquivo; o escopo solicitado é restrito à pasta de dados do próprio app.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="faq4">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">
                O app calcula o imposto de renda automaticamente?
              </AccordionTrigger>
              <AccordionContent className="text-sm pb-3">
                A tela de Impostos exibe o ganho/perda por ativo com base nas transações registradas, mas não substitui um declarante ou ferramenta homologada pela Receita Federal. Use como referência para preencher a sua declaração.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="faq5">
              <AccordionTrigger className="text-sm font-medium text-foreground py-2">
                Meus dados ficam nos servidores de vocês?
              </AccordionTrigger>
              <AccordionContent className="text-sm pb-3">
                Não. Os dados ficam no IndexedDB do seu navegador, criptografados com AES-256-GCM. O único tráfego externo são requisições de cotação (apenas tickers, sem dados pessoais) e o backup no Drive (seu próprio storage). Veja a <Link to="/privacy" className="underline hover:text-foreground">política de privacidade</Link>.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Section>

        <div className="pt-4 border-t border-border/50 text-xs text-muted-foreground">
          Dúvidas não respondidas aqui?{" "}
          <a href="mailto:gestaodegastosapp@gmail.com?subject=Cofre Investimentos - Dúvida" className="underline hover:text-foreground">
            gestaodegastosapp@gmail.com
          </a>
        </div>

      </div>
    </div>
  );
}
