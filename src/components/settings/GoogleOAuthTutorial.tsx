import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HelpCircle, ExternalLink, ChevronRight, ChevronLeft, CheckCircle2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

const steps = [
  {
    title: "Acessar o Google Cloud Console",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Acesse o Google Cloud Console para criar seu projeto e configurar as credenciais OAuth.
        </p>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => window.open("https://console.cloud.google.com/", "_blank")}
        >
          <ExternalLink className="h-4 w-4" />
          Abrir Google Cloud Console
        </Button>
        <div className="bg-muted/50 p-4 rounded-lg space-y-2">
          <p className="text-sm font-medium">Importante:</p>
          <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
            <li>Use uma conta Google pessoal ou da empresa</li>
            <li>Você precisará aceitar os termos de uso na primeira vez</li>
            <li>É gratuito para uso pessoal</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    title: "Criar um Novo Projeto",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Crie um projeto dedicado para gerenciar suas credenciais de backup.
        </p>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">1</span>
            <span>Clique no seletor de projetos no topo da página (ao lado do logo do Google Cloud)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">2</span>
            <span>Clique em <strong>"Novo Projeto"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">3</span>
            <span>Digite um nome como <strong>"Investidor360 Backup"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">4</span>
            <span>Clique em <strong>"Criar"</strong> e aguarde a criação</span>
          </li>
        </ol>
        <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg">
          <p className="text-sm text-amber-600 dark:text-amber-400">
            💡 Certifique-se de que o projeto criado está selecionado antes de continuar.
          </p>
        </div>
      </div>
    ),
  },
  {
    title: "Configurar a Tela de Consentimento OAuth",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Configure como os usuários verão a solicitação de permissão.
        </p>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">1</span>
            <span>No menu lateral, vá em <strong>"APIs e Serviços"</strong> → <strong>"Tela de consentimento OAuth"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">2</span>
            <span>Selecione <strong>"Externo"</strong> e clique em <strong>"Criar"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">3</span>
            <span>Preencha os campos obrigatórios:</span>
          </li>
        </ol>
        <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Nome do app:</span>
            <span className="font-mono">Investidor360 Backup</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email de suporte:</span>
            <span className="font-mono">seu-email@gmail.com</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email do desenvolvedor:</span>
            <span className="font-mono">seu-email@gmail.com</span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Clique em <strong>"Salvar e Continuar"</strong> nas próximas etapas até finalizar.
        </p>
      </div>
    ),
  },
  {
    title: "Adicionar Escopos (Permissões)",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Defina as permissões que o app precisará para acessar o Google Drive.
        </p>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">1</span>
            <span>Na etapa "Escopos", clique em <strong>"Adicionar ou Remover Escopos"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">2</span>
            <span>Procure e selecione os seguintes escopos:</span>
          </li>
        </ol>
        <div className="bg-muted/50 p-4 rounded-lg space-y-2">
          <code className="text-xs block text-primary">../auth/drive.appdata</code>
          <p className="text-xs text-muted-foreground">Permite ao app criar e acessar arquivos apenas na pasta oculta do app (seus outros arquivos ficam seguros)</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-lg">
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            ✓ Este escopo garante que o app só pode acessar seus próprios arquivos de backup, nunca outros arquivos do seu Drive.
          </p>
        </div>
      </div>
    ),
  },
  {
    title: "Adicionar Usuários de Teste",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Como o app está em modo de teste, você precisa adicionar seu email como usuário autorizado.
        </p>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">1</span>
            <span>Na etapa "Usuários de teste", clique em <strong>"Add Users"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">2</span>
            <span>Digite seu email Gmail e clique em <strong>"Adicionar"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">3</span>
            <span>Clique em <strong>"Salvar e Continuar"</strong></span>
          </li>
        </ol>
        <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg">
          <p className="text-sm text-amber-600 dark:text-amber-400">
            ⚠️ Enquanto o app estiver em modo de teste, apenas os emails adicionados aqui poderão usar a sincronização.
          </p>
        </div>
      </div>
    ),
  },
  {
    title: "Criar Credenciais OAuth",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Agora vamos criar as credenciais que o app usará para autenticar.
        </p>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">1</span>
            <span>No menu lateral, vá em <strong>"APIs e Serviços"</strong> → <strong>"Credenciais"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">2</span>
            <span>Clique em <strong>"+ Criar Credenciais"</strong> → <strong>"ID do Cliente OAuth"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">3</span>
            <span>Tipo de aplicativo: <strong>"Aplicativo da Web"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">4</span>
            <span>Nome: <strong>"Investidor360"</strong></span>
          </li>
        </ol>
      </div>
    ),
  },
  {
    title: "Configurar URLs Autorizadas",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Configure as URLs onde o app pode ser executado.
        </p>
        
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">Origens JavaScript Autorizadas:</p>
            <CopyableUrl url={window.location.origin} />
          </div>
          
          <div>
            <p className="text-sm font-medium mb-2">URIs de Redirecionamento Autorizados:</p>
            <CopyableUrl url={`${window.location.origin}/auth/google/callback.html`} />
          </div>
        </div>

        <div className="bg-muted/50 p-4 rounded-lg">
          <p className="text-sm text-muted-foreground">
            💡 Cole exatamente essas URLs nos campos correspondentes no Google Cloud Console.
          </p>
        </div>
      </div>
    ),
  },
  {
    title: "Copiar o Client ID",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Após criar as credenciais, copie o Client ID gerado.
        </p>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">1</span>
            <span>Clique em <strong>"Criar"</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">2</span>
            <span>Uma janela aparecerá com seu <strong>Client ID</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">3</span>
            <span>Copie o <strong>ID do Cliente</strong> (termina em .apps.googleusercontent.com)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">4</span>
            <span>Cole na seção "Backup & Sincronização" nas configurações do app</span>
          </li>
        </ol>
        
        <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Configuração Completa!</span>
          </div>
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            Seus dados serão criptografados localmente antes de serem enviados ao Google Drive. 
            Nem o Google nem terceiros podem ler seus dados.
          </p>
        </div>
      </div>
    ),
  },
];

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("URL copiada!");
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg">
      <code className="text-xs flex-1 break-all">{url}</code>
      <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={handleCopy}>
        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

interface GoogleOAuthTutorialProps {
  trigger?: React.ReactNode;
}

export function GoogleOAuthTutorial({ trigger }: GoogleOAuthTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [open, setOpen] = useState(false);
  
  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };
  
  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };
  
  const handleOpenChange = (open: boolean) => {
    setOpen(open);
    if (!open) {
      setCurrentStep(0);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="gap-2">
            <HelpCircle className="h-4 w-4" />
            Como configurar?
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xs font-normal text-muted-foreground">
              Passo {currentStep + 1} de {steps.length}
            </span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Progress dots */}
          <div className="flex justify-center gap-1.5">
            {steps.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentStep(index)}
                className={`w-2 h-2 rounded-full transition-colors ${
                  index === currentStep
                    ? "bg-primary"
                    : index < currentStep
                    ? "bg-primary/40"
                    : "bg-muted-foreground/20"
                }`}
              />
            ))}
          </div>
          
          {/* Step title */}
          <h3 className="text-lg font-semibold text-center">
            {steps[currentStep].title}
          </h3>
          
          {/* Step content */}
          <ScrollArea className="h-[300px] pr-4">
            {steps[currentStep].content}
          </ScrollArea>
          
          {/* Navigation */}
          <div className="flex justify-between pt-4 border-t">
            <Button
              variant="outline"
              onClick={handlePrev}
              disabled={currentStep === 0}
              className="gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            
            {currentStep < steps.length - 1 ? (
              <Button onClick={handleNext} className="gap-2">
                Próximo
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={() => handleOpenChange(false)} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Concluir
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
