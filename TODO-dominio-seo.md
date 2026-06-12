# To-Do: Domínio cofreinvestimentos.com.br + SEO

## 1. DNS no Registro.br

> Acesse: https://registro.br → Meus Domínios → cofreinvestimentos.com.br → Editar Zona DNS

- [ ] Adicionar registro **A** (apex):
  - Nome: `@`
  - Tipo: `A`
  - Valor: `76.76.21.21`  ← IP atual do Vercel (confirme em Vercel → Domains → seu domínio → "A Record")

- [ ] Adicionar registro **CNAME** (www):
  - Nome: `www`
  - Tipo: `CNAME`
  - Valor: `cname.vercel-dns.com.`  ← com o ponto final

- [ ] Aguardar propagação (Registro.br: até 24 h, normalmente < 2 h)
  - Verificar propagação: https://dnschecker.org/#A/cofreinvestimentos.com.br

---

## 2. Vercel — Configurar domínio no projeto

> Acesse: https://vercel.com → projeto gestao-de-ativos-ai → Settings → Domains

- [ ] Adicionar `cofreinvestimentos.com.br`
- [ ] Adicionar `www.cofreinvestimentos.com.br`
- [ ] Definir redirect: `www` → `cofreinvestimentos.com.br` (canonical sem www)
- [ ] Verificar que ambos aparecem com status **Valid** (pode demorar até 48 h para o SSL emitir)

---

## 3. Google Cloud Console — OAuth Origins

> Acesse: https://console.cloud.google.com → APIs & Services → Credentials → seu OAuth 2.0 Client ID

- [ ] Em **Authorized JavaScript origins**, adicionar:
  - `https://cofreinvestimentos.com.br`
  - `https://www.cofreinvestimentos.com.br`

- [ ] Em **Authorized redirect URIs**, adicionar (se usar redirect flow):
  - `https://cofreinvestimentos.com.br/auth/callback`
  - `https://www.cofreinvestimentos.com.br/auth/callback`

- [ ] Salvar e aguardar até 5 min para propagar

### OAuth Consent Screen (se ainda estiver em "Testing")

> APIs & Services → OAuth consent screen

- [ ] Mudar status de **Testing** → **In production** (clique em "Publish App")
- [ ] Preencher campos obrigatórios:
  - Nome do app: `Cofre Investimentos`
  - E-mail de suporte: `gestaodegastosapp@gmail.com`
  - Domínio autorizado: `cofreinvestimentos.com.br`
  - Link privacidade: `https://cofreinvestimentos.com.br/privacy`
  - Link termos: `https://cofreinvestimentos.com.br/ajuda`
- [ ] Verificar domínio no Google (pode pedir verificação via Search Console — ver seção 4)

---

## 4. Google Search Console — Indexação

> Acesse: https://search.google.com/search-console

### Adicionar propriedade
- [ ] Clique em **Adicionar propriedade** → escolha **Domínio** (não URL prefix)
- [ ] Inserir: `cofreinvestimentos.com.br`
- [ ] Copiar o registro TXT fornecido, ex: `google-site-verification=xxxxxxxx`
- [ ] No Registro.br → Zona DNS → adicionar registro:
  - Tipo: `TXT`
  - Nome: `@`
  - Valor: `google-site-verification=xxxxxxxx`
- [ ] Clicar em **Verificar** no Search Console (propagação TXT: até 1 h)

### Enviar Sitemap
- [ ] Após verificação, ir em **Sitemaps** → adicionar:
  - `https://cofreinvestimentos.com.br/sitemap.xml`
- [ ] Verificar se aparece como "Sucesso" (pode levar 1–2 dias)

### Solicitar indexação manual (acelera)
- [ ] Ir em **Inspeção de URL** → inspecionar `https://cofreinvestimentos.com.br/`
- [ ] Clicar em **Solicitar indexação**
- [ ] Repetir para `/privacy` e `/ajuda`

---

## 5. og:image — Imagem de compartilhamento

> O `index.html` já aponta para `/og-image.png` (1200×630 px)

- [ ] Criar uma imagem 1200×630 px com:
  - Logo / nome "Cofre Investimentos"
  - Frase curta (ex: "Gerencie seus investimentos com privacidade total")
  - Fundo consistente com o tema do app
- [ ] Salvar em `public/og-image.png`
- [ ] Fazer deploy e testar em: https://developers.facebook.com/tools/debug/ e https://cards-dev.twitter.com/validator

---

## 6. Bing Webmaster Tools (opcional, amplia alcance)

> Acesse: https://www.bing.com/webmasters

- [ ] Adicionar site `cofreinvestimentos.com.br`
- [ ] Verificar via XML file ou DNS TXT (mesmo TXT do Google funciona em alguns casos)
- [ ] Enviar sitemap: `https://cofreinvestimentos.com.br/sitemap.xml`

---

## 7. Variáveis de ambiente — Produção no Vercel

> Vercel → projeto → Settings → Environment Variables

- [ ] Confirmar que `VITE_GOOGLE_CLIENT_ID` está setado para produção
- [ ] Confirmar que `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` estão corretos
- [ ] Confirmar `EDGE_FUNCTIONS_API_KEY` está configurado nos secrets do Supabase:
  > Supabase → projeto → Settings → Edge Functions → Secrets → adicionar `EDGE_FUNCTIONS_API_KEY`

---

## Ordem sugerida

```
Dia 1: DNS (Registro.br) + Vercel domains + Google OAuth origins
Dia 2: Search Console (verificação TXT) + Sitemap
Dia 3: og:image + Solicitar indexação manual + Bing (opcional)
```

> **Nota:** O domínio pode levar até 72 h para aparecer nas buscas pela primeira vez, mesmo após indexação. Sites novos com poucas backlinks costumam demorar 1–4 semanas para ranquear.
