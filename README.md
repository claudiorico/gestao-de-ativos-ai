# InvestPro Vault

Gestão de investimentos com cofre criptografado local e backup no Google Drive.
Acompanhe portfólio, balanceamento, movimentações, proventos, imposto de renda e analytics.

## Tecnologias

- **Vite** + **React 18** + **TypeScript**
- **shadcn-ui** + **Tailwind CSS**
- **React Router** (roteamento client-side)
- **Login com Google** via Google Identity Services (OAuth direto, sem Firebase)
- **Supabase** (Edge Functions de cotações) e backup no **Google Drive**

## Desenvolvimento local

Pré-requisito: Node.js & npm instalados ([instalar com nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
# 1. Clonar o repositório
git clone <YOUR_GIT_URL>

# 2. Entrar na pasta do projeto
cd gestao-de-ativos-ai

# 3. Instalar dependências
npm i

# 4. Subir o servidor de desenvolvimento (http://localhost:8080)
npm run dev
```

## Variáveis de ambiente

Crie um arquivo `.env` na raiz (ou configure no provedor de deploy) com:

```
VITE_GOOGLE_CLIENT_ID=...        # OAuth Client ID do app (login com Google)
VITE_SUPABASE_URL=...
VITE_SUPABASE_PROJECT_ID=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

> **Login com Google:** o app usa um único `VITE_GOOGLE_CLIENT_ID` (OAuth Web do Google Cloud).
> O usuário só clica em "Entrar com Google" e autentica na própria conta Google. Há também um
> modo avançado "usar meu próprio Client ID" para quem quiser OAuth próprio (zero-knowledge total).
> O Client ID OAuth de SPA é público por natureza — não é segredo.

> Como é um app Vite, as variáveis `VITE_*` são incorporadas no momento do **build**.
> No deploy, defina-as no provedor antes de buildar.

## Build

```sh
npm run build      # gera a versão de produção em dist/
npm run preview    # serve o build localmente para conferência
```

## Deploy (Vercel)

1. Faça push para o GitHub.
2. Em [vercel.com](https://vercel.com) → **Add New → Project** → importe este repositório.
3. Framework Preset **Vite** (build `npm run build`, output `dist`) — já coberto pelo `vercel.json`.
4. Cadastre as variáveis `VITE_*` em **Settings → Environment Variables**.
5. **Google Cloud Console → APIs & Services → Credentials**, no OAuth Client ID (tipo
   *Web application*) usado em `VITE_GOOGLE_CLIENT_ID`:
   - **Authorized JavaScript origins**: `http://localhost:8080` e `https://<app>.vercel.app`.
   - Configure a **OAuth consent screen** (test users ou publicado), senão o popup falha.
6. **Deploy**.

O `vercel.json` já inclui o rewrite de SPA, garantindo que rotas profundas (ex.: `/portfolio`)
funcionem ao recarregar a página.

## Backend (Supabase Edge Functions)

As cotações usam as functions `get-quotes` e `get-price-history`. Para atualizá-las:

```sh
supabase functions deploy get-quotes get-price-history
# opcional: liberar a origem do app por host
supabase secrets set ALLOWED_ORIGIN_HOSTS=seu-app.vercel.app
```
