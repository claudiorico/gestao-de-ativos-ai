# Peer Review & Analise de Falhas - InvestPro Vault

Este documento apresenta uma revisão por pares detalhada do projeto **InvestPro Vault**, avaliando a arquitetura, segurança, integridade de dados, regras de negócio fiscais e performance.

---

## 1. Falhas Fiscais Críticas (Imposto de Renda / DARF)

O motor fiscal (`tax-engine.ts`) e o importador da B3 contêm erros conceituais significativos sobre a legislação tributária brasileira, o que pode induzir o usuário a cometer irregularidades fiscais perante a Receita Federal ou pagar impostos incorretos.

### 1.1. Isenção Indevida para ETFs e BDRs (Swing Trade)
*   **Problema:** O motor agrupa Ações, ETFs e BDRs sob a categoria `B3_EQUITIES` e aplica a isenção de vendas mensais de até R$ 20.000,00 de forma indiscriminada (linha 457 em [tax-engine.ts](file:///c:/Users/User/GitHub/gestao-de-ativos-ai/src/lib/tax-engine.ts#L457-L463)):
    ```typescript
    if (cat === "B3_EQUITIES") {
      if (salesGross > 0 && salesGross <= config.exemptions.b3EquitiesMonthlySalesLimit) {
        isExempt = true;
        ...
      }
    }
    ```
*   **Impacto Fiscal:** Pela legislação brasileira, **ETFs, BDRs e Opções não gozam da isenção dos R$ 20.000,00**. Apenas vendas de **Ações** no mercado comum (swing trade) são isentas abaixo desse limite. Caso o usuário realize R$ 15.000,00 em vendas de ETFs (ex.: BOVA11) com lucro, o motor reportará imposto zero (isento), gerando um risco iminente de autuação na malha fina da Receita Federal.

### 1.2. Inexistência de Regras e Alertas para Day Trade
*   **Problema:** O motor assume que todas as transações são Swing Trade ("sem day trade").
*   **Impacto Fiscal:** Se o usuário comprar e vender o mesmo ativo no mesmo dia:
    1.  A alíquota correta seria de 20% (e não 15%).
    2.  Não há qualquer isenção (a regra dos R$ 20k não se aplica a Day Trade).
    3.  Prejuízos de Day Trade só podem compensar ganhos de Day Trade (não podem compensar Swing Trade).
    O sistema realiza o cálculo misturando tudo como Swing Trade, calculando impostos a menor e compensações indevidas.

### 1.3. Instabilidade na Ordenação de Operações do Mesmo Dia (Preço Médio Incorreto)
*   **Problema:** Em [tax-engine.ts](file:///c:/Users/User/GitHub/gestao-de-ativos-ai/src/lib/tax-engine.ts#L269-L276), as transações são ordenadas apenas por data:
    ```typescript
    const txs = input.transactions
      ...
      .sort((a, b) => a.date - b.date);
    ```
    No importador da B3 (`B3ImportTab.tsx`), as datas de negociação são normalizadas para as 12:00:00 do respectivo dia. Se houver uma compra e uma venda do mesmo ativo no mesmo dia, elas compartilham o mesmo timestamp.
*   **Consequência:** Como o `sort` não desempatará os registros de forma determinística (não prioriza compras antes de vendas em caso de empate), a venda pode ser processada antes da compra. Isso aciona o alerta de *"Venda maior que a quantidade em custódia (posição ficou negativa)"* e calcula o custo médio da venda como **zero** (assumindo 100% de lucro tributável), gerando um cálculo de imposto absurdamente inflacionado e incorreto.

---

## 2. Risco Crítico de Integridade de Dados (Perda Total)

### 2.1. Sobrescrita Destrutiva em Caso de Falha de Decifragem
*   **Problema:** Em [SecureStorageContext.tsx](file:///c:/Users/User/GitHub/gestao-de-ativos-ai/src/contexts/SecureStorageContext.tsx#L278-L287), se a decifragem de uma tabela falhar (ex.: corrupção leve do banco local, falha momentânea da API Web Crypto, ou chave inconsistente), a função captura o erro e retorna uma lista vazia `[]`:
    ```typescript
    try {
      const decrypted = await decrypt(encrypted, encryptionKey);
      return JSON.parse(decrypted);
    } catch (err) {
      console.error(`[SecureStorage] Failed to decrypt store "${store}"`, err);
      ...
      return []; // <--- Retorno silencioso de array vazio!
    }
    ```
*   **Consequência:** Se o usuário salvar *qualquer* item posterior nessa mesma tabela (ex.: adicionar uma nova transação), a função `saveEncryptedData` pegará esse array vazio `[]` retornado, adicionará a nova transação e **sobrescreverá a chave 'master' no IndexedDB**. 
    > [!CAUTION]
    > Isso causará a **perda permanente e irrecuperável de todo o histórico anterior de dados financeiros do usuário** para aquela tabela, sem qualquer aviso ou chance de recuperação. A função de erro deve obrigatoriamente relançar o erro (`throw`) para abortar qualquer escrita destrutiva subsequente.

---

## 3. Gargalos de Performance e Escalabilidade (UX / Arquitetura)

### 3.1. Serialização Monolítica dos Dados do Cofre (IndexedDB)
*   **Problema:** O cofre utiliza uma única chave `'master'` por tabela no IndexedDB para guardar o array completo criptografado (ex.: todas as transações em um único bloco de texto cifrado).
*   **Impacto:** Conforme a carteira cresce (usuários avançados ou com histórico longo importado via B3, ex.: 1.000+ transações):
    1.  Qualquer operação trivial de inserção ou atualização exige carregar o JSON gigante da tabela inteira, decifrá-lo via Web Crypto API (operação custosa em CPU), desserializar, alterar o item, reserializar, cifrar novamente e salvar de volta.
    2.  O consumo de memória crescerá exponencialmente no navegador, gerando gargalos perceptíveis de travamento de tela (lag de UI) em dispositivos móveis.
    3.  Aumenta significativamente a chance de corrupção do arquivo inteiro de transações em caso de fechamento do navegador ou queda de energia durante a escrita do bloco monolítico.

### 3.2. Conversão Ineficiente de Bytes em Strings no `crypto.ts`
*   **Problema:** Em [crypto.ts](file:///c:/Users/User/GitHub/gestao-de-ativos-ai/src/lib/crypto.ts#L76-L80), a conversão de base64 cifrado de volta para bytes é feita via:
    ```typescript
    const combined = new Uint8Array(
      atob(encryptedString).split('').map((c) => c.charCodeAt(0))
    );
    ```
*   **Impacto:** O uso de `.split('')` em uma string grande cria um array intermediário contendo um objeto string para cada caractere. Em arquivos de backup grandes (vários megabytes de transações), isso aloca milhões de strings curtas, estourando a pilha de memória (`Out of Memory`) e causando lentidão drástica. O correto é ler via loop convencional indexado diretamente no buffer ou usar APIs modernas como `Uint8Array.from()`.

---

## 4. Limitações Críticas de Infraestrutura (Supabase Edge Function)

### 4.1. Risco de Estouro de Memória (OOM) na Cotação de Fundos CVM
*   **Problema:** Para obter cotações de fundos de investimento baseados em CNPJ, a Edge Function `get-quotes` (`supabase/functions/get-quotes/index.ts`) baixa o arquivo ZIP mensal da CVM, descompacta em memória e realiza a decodificação de todo o arquivo CSV de informes diários via `TextDecoder`:
    ```typescript
    const csvBytes: Uint8Array = await (csvEntry as any).getData(new Uint8ArrayWriter());
    ...
    const csv = new TextDecoder('latin1').decode(csvBytes);
    ```
*   **Impacto:** O arquivo `inf_diario_fi_YYYYMM.csv` da CVM contém dados diários de cotas de **todos os fundos do Brasil** e seu tamanho descompactado costuma ultrapassar 150 MB (podendo chegar a 300 MB). Criptografar/Descompactar e alocar essa string gigante em UTF-16 consome de 300 MB a 600 MB de RAM.
    > [!WARNING]
    > O limite padrão de memória de Deno/Supabase Edge Functions na camada gratuita é de **150 MB** (e 256 MB na paga). Isso significa que consultas a fundos CVM causarão falhas constantes de **Out Of Memory (OOM)**, derrubando o runtime da function e impedindo a atualização de preços da carteira do usuário.

---

## 5. Pendências de Funcionalidade e Código Inativo

### 5.1. Funcionalidade Fantasma: Redução de Custo Médio por Proventos
*   **Problema:** A interface de configurações (`Settings.tsx`) exibe opções para o usuário escolher se o recebimento de dividendos de FIIs e Juros sobre Capital Próprio (JCP) deve abater/reduzir o preço médio de aquisição dos ativos.
*   **Impacto:** O mapeamento existe no estado e nos tipos de configuração (`fiiYieldReducesCost` e `jcpReducesCost`), contudo, a lógica de cálculo do preço médio real em `usePortfolios.ts` **ignora completamente esses campos** e não consome a tabela de dividendos para o cálculo. Trata-se de uma funcionalidade fantasma (código morto na interface).

---

## 6. Bugs no Algoritmo de Balanceamento (`rebalancing-engine.ts`)

### 6.1. Abortagem Prematura do Loop em `REBALANCE_ONLY`
*   **Problema:** No modo de rebalanceamento sem aporte (`REBALANCE_ONLY`), o motor tenta vender ativos sobrealocados para financiar a compra de subalocados. Se o ativo mais sobrealocado não puder ser vendido (ex.: a diferença é menor do que 1 lote mínimo da ação), o código dá um `break` e encerra todo o balanceamento (linha 196 em [rebalancing-engine.ts](file:///c:/Users/User/GitHub/gestao-de-ativos-ai/src/lib/rebalancing-engine.ts#L196-L199)):
    ```typescript
    if (sellQty <= 0) {
      // Nada vendável -> encerra
      break;
    }
    ```
*   **Consequência:** O rebalanceamento é interrompido imediatamente. Se houver outros ativos que poderiam ser vendidos com lotes válidos, ou se já houver caixa restante de vendas de iterações anteriores, esses recursos ficarão "presos" e o sistema falhará em sugerir rebalanceamentos para os demais ativos da carteira.

### 6.2. Imprecisão de Ponto Flutuante na Divisão de Lotes
*   **Problema:** Em criptomoedas ou frações de renda fixa, os lotes podem ser muito pequenos (ex.: `0.00000001`). Ao dividir valores fracionários por esses passos mínimos, imprecisões do padrão IEEE 754 de ponto flutuante em JS podem fazer divisões exatas (ex: `0.29 / 0.01` resultar em `28.999999999999996`). A função `floorToStep` aplica `Math.floor` direto, reduzindo indevidamente o lote a ser operado (`28` em vez de `29`) e gerando sobras de caixa desnecessárias.

---

## 7. Experiência do Usuário (UX) e Testes

### 7.1. Sensação de Perda de Dados ao Efetuar Login
*   **Problema:** O aplicativo possui dois modos: local (offline) e integrado com nuvem (Google Drive/Google login). Ao fazer o login com o Google, o banco de dados IndexedDB chaveia de `'local'` para o namespace hash do e-mail do usuário.
*   **Impacto:** Os ativos e carteiras criados localmente antes do login parecem sumir repentinamente da tela, dando a sensação de que o app deletou os dados do usuário. Não há ferramenta de migração automática do banco local para o banco da conta Google recém-conectada, nem um aviso educativo explicando a segmentação dos bancos.

### 7.2. Ausência Total de Testes Automatizados
*   **Problema:** O diretório `src/test` contém apenas um teste de exemplo vazio.
*   **Impacto:** Um sistema que lida com criptografia ponta-a-ponta, cálculo de imposto de renda e motor de rebalanceamento financeiro é extremamente crítico. A ausência de suítes de testes unitários impossibilita a refatoração segura de código e aumenta o risco de regressões graves em atualizações futuras.
