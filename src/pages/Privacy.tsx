import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-8">
        {/* Header */}
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 -ml-2 text-muted-foreground"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>

          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Política de Privacidade</h1>
              <p className="text-sm text-muted-foreground">Cofre Investimentos · Última atualização: junho de 2026</p>
            </div>
          </div>
        </div>

        {/* Destaque: local-first */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <h2 className="font-semibold text-foreground mb-2">Princípio fundamental: seus dados ficam com você</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            O Cofre Investimentos foi projetado como um app <strong className="text-foreground">local-first</strong>: todos os
            seus dados financeiros são armazenados exclusivamente no seu próprio dispositivo (IndexedDB do navegador),
            criptografados com sua senha. Nenhum servidor nosso armazena seu portfólio, transações ou proventos.
          </p>
        </div>

        {/* Seções */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">1. Dados que coletamos</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Não coletamos nem armazenamos dados pessoais ou financeiros em nossos servidores.
            O único dado processado externamente é o seu endereço de e-mail, fornecido pelo Google no momento do login,
            utilizado somente como identificador para separar cofres de usuários diferentes no mesmo dispositivo.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">2. Armazenamento local</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Todos os dados de portfólio (ativos, transações, proventos, configurações) são salvos no
            <strong className="text-foreground"> IndexedDB do seu navegador</strong>, cifrados com AES-256-GCM usando
            uma chave derivada da sua senha via PBKDF2. Apenas você, com sua senha, pode acessar esses dados.
            Limpar os dados do navegador apaga o cofre permanentemente.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">3. Backup no Google Drive (opcional)</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Se você optar por fazer backup, o arquivo é enviado diretamente para a sua conta pessoal do Google Drive.
            Nós não temos acesso a esse arquivo — ele é criado e gerenciado exclusivamente pela API do Google Drive
            autenticada com sua conta. O arquivo de backup mantém a mesma criptografia do cofre local:
            sem sua senha, ele é ilegível.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">4. Cotações de mercado</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Para buscar preços de ativos, o app envia apenas os <strong className="text-foreground">tickers</strong> (ex.: PETR4, BTC)
            para nossas Edge Functions hospedadas no Supabase, que consultam fontes públicas como Yahoo Finance, CoinGecko,
            CVM e B3. Nenhuma informação pessoal ou financeira é enviada nessas requisições.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">5. Autenticação Google</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            O login é feito via Google Identity Services (OAuth 2.0). Ao fazer login, o Google compartilha
            conosco seu nome, e-mail e foto de perfil. Essas informações são usadas apenas para exibição
            na interface e como chave de namespace do cofre. Consulte a
            {" "}<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              Política de Privacidade do Google
            </a>{" "}
            para entender como o Google trata seus dados no processo de autenticação.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">6. Cookies e rastreamento</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            O app não usa cookies de rastreamento, analytics de terceiros ou ferramentas de publicidade.
            Não há coleta de dados comportamentais.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">7. Retenção e exclusão</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Como os dados ficam no seu dispositivo, você os controla inteiramente.
            Para excluir tudo, basta limpar os dados do site no seu navegador (Configurações → Privacidade → Dados do site).
            Se você fez backup no Google Drive, exclua o arquivo manualmente na sua conta do Drive.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">8. Código aberto</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            O Cofre Investimentos é software de código aberto (licença MIT). Você pode inspecionar, auditar e contribuir
            com o código no GitHub. A transparência do código é a melhor garantia de que esta política é cumprida.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">9. Alterações nesta política</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Qualquer alteração relevante será publicada nesta página com nova data de atualização.
            Como não coletamos e-mails, não enviamos notificações — recomendamos revisitar esta página ocasionalmente.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">10. Contato</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Dúvidas, sugestões ou solicitações relacionadas à privacidade:{" "}
            <a
              href="mailto:gestaodegastosapp@gmail.com?subject=Cofre Investimentos - Privacidade"
              className="underline hover:text-foreground"
            >
              gestaodegastosapp@gmail.com
            </a>
          </p>
        </section>

        <div className="pt-4 border-t border-border/50 text-xs text-muted-foreground">
          Cofre Investimentos · Software livre sob licença MIT · Não é um serviço de consultoria financeira
        </div>
      </div>
    </div>
  );
}
