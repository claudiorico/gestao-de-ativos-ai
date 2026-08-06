# Deploy da IA do Portifolio

Esta secao usa o Worker `cofre-investimentos-functions` e o endpoint `/analyze-portfolio`.

## Publicar Worker

No PowerShell, carregue o token da Cloudflare apenas na sessao atual:

```powershell
$env:CLOUDFLARE_API_TOKEN = "NOVO_TOKEN_AQUI"
npm run worker:deploy
```

Se quiser conferir antes de publicar:

```powershell
npm run worker:deploy -- --dry-run
```

O dry-run deve listar:

- `env.AI`
- `env.AI_ANALYSIS_EMAILS`
- `env.WORKERS_AI_MODEL ("@cf/zai-org/glm-4.7-flash")`

## Configuracao Esperada

O Worker usa Workers AI como provedor principal:

```toml
[ai]
binding = "AI"
```

Modelo atual:

```text
@cf/zai-org/glm-4.7-flash
```

`OPENAI_API_KEY` e opcional e fica apenas como fallback.

## Validacao Manual

Depois do deploy, acesse o app com uma conta em `AI_ANALYSIS_EMAILS`, abra:

```text
/ai-portfolio
```

Marque a autorizacao de envio do resumo agregado e clique em `Analisar com IA`.

Resultado esperado:

- diagnostico local aparece sem depender da IA;
- leitura da IA aparece no bloco `Leitura da IA`;
- se Workers AI falhar, a tela mostra mensagem de indisponibilidade sem quebrar o restante da pagina.
