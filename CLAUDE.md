# Disparador WhatsApp — Evolution Go

Aplicação de disparos em massa via WhatsApp usando a API do Evolution Go. O repositório tem **dois projetos independentes**:

- **MVP** (raiz): servidor Node.js local que atua como proxy para a API externa, com frontend HTML/CSS/JS puro. É o que está em uso.
- **SaaS** (`saas/`): fundação técnica do futuro painel multiempresa. Tem API, painel web e worker em TypeScript, ainda **sem funcionalidades de negócio**.

**Fase atual:** MVP local com as correções de segurança da Fase 3 (ver `docs/SEGURANCA_MVP.md`) e fundação técnica do SaaS concluída na Fase 4 (ver `saas/docs/ESTRUTURA_TECNICA.md`). Repositório git com remoto `origin` no GitHub (`Sinvaldo-Oliveira/disparazap`), desde 2026-11-01. Fase 5 (banco de dados, autenticação e Super Admin) **em andamento**: a autenticação, a integração global com a Evolution Go, o módulo WhatsApp das empresas, o Envio de Mensagens e a página Contatos estão implementados (2026-11-01, banco embutido; testes com a Evolution simulada); a conclusão da homologação real do WhatsApp, a conexão ao Supabase e a entrada pelo MyLinksss dependem de autorização. O SaaS vai reunir WhatsApp, redes sociais via Zernio, agentes de IA, automações e API REST + webhooks; a visão e as decisões estão em `docs/DISPARAZAP_MASTER.md`.

---

## Documentação do projeto

| Arquivo | Finalidade |
|---|---|
| `CLAUDE.md` | Instruções permanentes para o Claude Code (este arquivo) |
| `docs/DISPARAZAP_MASTER.md` | Visão, módulos, arquitetura, decisões registradas e pendentes, roteiro |
| `docs/AUDITORIA_INICIAL.md` | Retrato do projeto em 2026-10-31 — registro histórico, não reescrever |
| `docs/CHANGELOG_DESENVOLVIMENTO.md` | Registro cronológico de todas as alterações |
| `docs/ARQUITETURA_SAAS.md` | Arquitetura do SaaS, modelo de dados e plano incremental (stack e local do código aplicados na Fase 4; demais etapas aguardando aprovação) |
| `docs/PLANO_IMPLANTACAO_HOSTINGER.md` | Plano de infraestrutura na VPS Hostinger (aguardando aprovação) |
| `docs/SEGURANCA_MVP.md` | Correções de segurança do MVP, regra de telefone, riscos pendentes e propostas |
| `saas/README.md` | Instalação, execução e testes do SaaS |
| `saas/docs/ESTRUTURA_TECNICA.md` | Arquitetura implementada do SaaS e responsabilidade de cada pasta |
| `saas/docs/DECISOES_TECNICAS.md` | Decisões técnicas do SaaS, alternativas consideradas e versões das dependências |
| `saas/docs/SUPABASE_CONFIGURACAO.md` | Preparação do projeto Supabase exclusivo (ainda não conectado) |
| `saas/docs/PLANO_MODULO_WHATSAPP.md` | Plano aprovado do módulo WhatsApp das empresas e andamento das etapas W1 a W4 |
| `doc_evolution_go.md` | Referência da API Evolution Go. Onde ela diverge do Swagger da versão instalada, vale o Swagger (ARQUITETURA_SAAS §5.2) |

## Regras obrigatórias

- **Nunca registre credenciais** em nenhum arquivo do projeto (Markdown, código, comentários, testes, commits): senhas, tokens de instância, `GLOBAL_API_KEY`, credenciais da Zernio, chaves de provedores de IA, URLs privadas de servidores ou dados pessoais reais (telefones, nomes de clientes). Use placeholders como `SUA_GLOBAL_API_KEY` ou `{EVOLUTION_URL}`. Não leia nem copie o conteúdo do `.env` (nem do `saas/.env`).
- **Documentação de cada fase:**
  - **Antes de começar**, consulte `docs/DISPARAZAP_MASTER.md` e `docs/AUDITORIA_INICIAL.md`. No SaaS, consulte também `saas/docs/ESTRUTURA_TECNICA.md` e `saas/docs/DECISOES_TECNICAS.md`. O objetivo é não duplicar o que existe nem contrariar uma decisão registrada.
  - **A cada alteração**, registre uma entrada em `docs/CHANGELOG_DESENVOLVIMENTO.md`. A cada decisão de produto ou arquitetura, atualize `docs/DISPARAZAP_MASTER.md`. No SaaS, atualize também `saas/docs/` quando a estrutura, uma decisão técnica ou uma versão de dependência mudar.
  - **Ao terminar a fase**, deixe o estado e as pendências registrados nesses documentos.
  - Não reescreva documentos históricos (`docs/AUDITORIA_INICIAL.md`).
- **MVP e SaaS são separados:**
  - mudança no SaaS fica dentro de `saas/`; mudança no MVP fica nos arquivos da raiz;
  - uma tarefa num projeto não altera o outro sem autorização explícita;
  - nenhum dos dois importa código do outro;
  - o SaaS tem `package.json`, `package-lock.json`, `.gitignore` e `.env` próprios: não declare workspaces nem dependências do SaaS no `package.json` da raiz.
- **Serviços reais e VPS:** sem autorização explícita da fase, não faça nenhuma destas coisas:
  - conectar a PostgreSQL, Redis, Evolution Go real, Zernio, MyLinksss ou qualquer banco ou serviço de produção;
  - instalar ou iniciar serviços (Docker incluído);
  - acessar ou modificar a VPS Hostinger;
  - criar instâncias WhatsApp ou enviar mensagens reais.
- **Não implemente módulos do SaaS** (login, empresas, banco, Zernio, IA, API pública) sem um plano aprovado pelo dono do produto.
- A Zernio é uma integração **independente** do Evolution Go. Não presuma o que ela suporta: confirme na documentação oficial antes de planejar.
- **Nunca desligue a verificação TLS** (`rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`) para contornar erro de certificado. Certificado próprio → `EVOLUTION_CA_FILE`.
- **Não mude a escuta para fora de `127.0.0.1`** no código: nem o MVP nem o SaaS têm login. Quem precisar de rede usa `HOST` no `.env` do MVP, ciente do risco. No SaaS, o padrão de `API_HOST`, do Vite e do preview continua sendo `127.0.0.1`.
- **Git:**
  - remoto `origin` no GitHub (`Sinvaldo-Oliveira/disparazap`), publicado a pedido do dono do produto em 2026-11-01;
  - nunca faça commit, push, novo remoto ou deploy sem aprovação explícita;
  - antes de cada push, confira que nenhum segredo, dado pessoal real ou endereço privado vai junto (inclusive no histórico);
  - nunca versione `.env`, `saas/.env`, `backup/`, `node_modules/`, `dist/` ou chaves.
- **Testes:** rode antes de concluir qualquer mudança de código:
  - **MVP:** `npm test` na raiz;
  - **SaaS:** `npm test`, `npm run typecheck` e `npm run build` dentro de `saas/`.

  Ao mexer num projeto, rode também a suíte do outro. Os testes usam só serviços simulados: nunca instâncias reais nem envios reais.

---

## SaaS — monorepo `saas/`

É um projeto npm independente (npm workspaces, lockfile próprio) em TypeScript. Em desenvolvimento, o Node 24 executa o TypeScript direto; em produção, roda o JavaScript compilado com `tsc`. A estrutura está em `saas/docs/ESTRUTURA_TECNICA.md`, e as decisões e versões em `saas/docs/DECISOES_TECNICAS.md`.

| Pasta | Papel |
|---|---|
| `apps/api` | API Fastify 5: configuração validada com Zod, `GET /health/live` e `/health/ready`, prefixo `/api/v1` (ainda sem rotas), erros em RFC 9457, logs com redação, CORS por lista explícita, cabeçalhos de segurança, **autenticação Better Auth** (`/api/auth/*`, `/api/internal/signup`, `/api/internal/me`), integração global com a Evolution Go do Super-Admin (`/api/internal/platform/*`) , **módulo WhatsApp** das empresas (`/api/internal/whatsapp/*`: instâncias, QR Code, pareamento, status) e **Envio de Mensagens** e **Contatos** (`/api/internal/contact-lists[/:id[/contacts[/remove]]]`, `/contacts/search`, `/media`, `/message-templates`, `/messaging/send`) |
| `apps/web` | Painel React 19 + Vite 8 + React Router 8: telas Entrar e Criar conta, rotas protegidas, layout, menu, Visão Geral, Configurações (integração global do Super-Admin), WhatsApp, Envio de Mensagens (assistente de 5 etapas portado do MVP, listas de contatos salvas, Excel via SheetJS sob demanda), Contatos (gestão das listas, criação e busca) e páginas "Em desenvolvimento" |
| `apps/worker` | Processo das filas: por enquanto só ciclo de vida e encerramento controlado; nenhuma fila |
| `packages/contracts` | Contratos públicos (Zod + tipos) usados pela API e pelo painel |
| `packages/db` | Só servidor: schema Drizzle (esquemas `identity`, `platform` e `app`), migrations e conexão (PostgreSQL com TLS verificado ou banco embutido PGlite no desenvolvimento) |
| `packages/shared` | Código só de servidor: `parseEnv`, logger com redação, `handleShutdownSignals` |
| `infra/docker` | Reservado; ainda não há Docker Compose |
| `docs` | `ESTRUTURA_TECNICA.md`, `DECISOES_TECNICAS.md`, `SUPABASE_CONFIGURACAO.md` e `PLANO_MODULO_WHATSAPP.md` |

Comandos (sempre dentro de `saas/`, com Node ≥ 24.15):

```bash
npm install
npm run dev:api        # API em http://127.0.0.1:3100 (reinicia ao salvar)
npm run dev:web        # painel em http://127.0.0.1:5173 (repassa /health e /api para a API)
npm run dev:worker     # worker (sem filas)
npm test               # Vitest: pacotes, API, worker e painel (jsdom)
npm run typecheck      # TypeScript em tudo, inclusive nos testes
npm run build          # tsc -b (pacotes, API, worker) + vite build (painel)
npm run build:api      # ou build:worker / build:web
npm run admin:create   # cria o Super-Admin (SUPER_ADMIN_EMAIL); com banco embutido, só com a API parada
npm run db:generate    # gera migration a partir do schema (db:check confere; db:migrate aplica, só com autorização)
```

- **Configuração:** o `.env` do SaaS é `saas/.env` (modelo em `saas/.env.example`), separado do `.env` do MVP. Todas as variáveis têm padrão seguro. Sem `DATABASE_URL`, a API usa o banco embutido em `saas/.data/` (ignorado pelo git); nunca aplique migrations em banco remoto nem use `drizzle-kit push` sem autorização.
- **Credenciais de integração** (ex.: chave global da Evolution Go, informada pelo Super-Admin em Configurações):
  - só no cofre `platform.integration_credentials`, cifradas com `SECRETS_MASTER_KEY`;
  - nunca devolvidas ao navegador (só os 4 últimos caracteres);
  - nunca em log;
  - testes usam só a Evolution simulada.
- **Autenticação:**
  - tipos de usuário Super-Admin, Admin-Empresa e Admin-MyLinksss;
  - `platformRole` e `origin` nunca vêm do navegador;
  - a proteção de origem/CSRF do Better Auth fica sempre ligada (`disableOriginCheck: false`);
  - o token de sessão só existe no cookie `HttpOnly`.
- **Módulo WhatsApp:**
  - a empresa vem sempre da sessão; instância de outra empresa responde 404;
  - só `owner` e `admin` alteram;
  - nomes técnicos `dz_…` e token próprio por instância, cifrado no cofre; nenhum dos dois vai ao navegador;
  - o módulo só age sobre instâncias registradas no banco do DisparaZap: nunca toque nas instâncias do MVP;
  - excluir na Evolution é pelo **ID** (`DELETE /instance/delete/{instanceId}`), conforme o Swagger da versão instalada;
  - criar instância real ou conectar número real (homologação W3) só com autorização explícita do dono do produto.
- **Envio de Mensagens:**
  - listas de contatos, imagens (`app.media_files`, tipo conferido pelos bytes, até 5 MB) e modelos de mensagem por empresa;
  - listas de contatos com exclusão definitiva (dado pessoal);
  - na página Contatos, cada alteração é gravada na hora (renomear, acrescentar, alterar, remover), com a lista travada na transação; o telefone vai no corpo, nunca no caminho da URL;
  - o CTA vai como link no fim do texto (`composeMessage` em `packages/contracts`); a imagem vai em base64 para `/send/media`, com o texto como legenda;
  - o telefone é validado de novo na API;
  - o envio usa o token da instância do cofre e devolve só um motivo fixo, nunca a resposta da Evolution;
  - número e texto de mensagem nunca vão para o log;
  - o disparo roda na aba do navegador (fila e histórico ficam para Campanhas);
  - nunca envie mensagens reais em testes nem em demonstrações: use o simulador `apps/api/src/testing/evolution-simulator.ts`, que fica fora do build de produção.
- **Testes:** os nomes terminam em `.spec.ts(x)`. Não use, dentro de `saas/`, `*.test.*`, `*-test.*`, `*_test.*`, `test-*.*`, `test.*` nem pastas `test/`, porque o `node --test` da raiz descobriria e executaria esses arquivos.
- **TypeScript:**
  - só sintaxe "apagável": sem `enum`, `namespace` nem propriedades de parâmetro (`erasableSyntaxOnly`);
  - imports relativos com extensão `.ts`.
- **Segurança:**
  - nenhum segredo no painel (o bundle é público);
  - respostas da API pelo formato definido em `packages/contracts`, nunca repassando dados internos.
- **Interface honesta:** o painel não mostra dados inventados nem login falso; módulo não implementado aparece como "Em desenvolvimento".
- **Ainda não existe:** conexão com o Supabase, entrada pelo MyLinksss, 2FA, recuperação de senha, convites, filas, Docker Compose, campanhas no servidor (fila, histórico, agendamento), consentimento e descadastro de contatos, webhooks da Evolution, conclusão da homologação do WhatsApp no servidor real e os demais módulos de negócio.

---

## Stack do MVP

- **Backend**: Node.js + Express + dotenv (`server.js`)
- **Frontend**: `index.html` com HTML, CSS e JS embutidos (sem frameworks)
- **Excel**: SheetJS via CDN (versão fixada `xlsx-0.20.3`)
- **Config**: variáveis em `.env` — nunca expor `GLOBAL_API_KEY` ao browser

---

## Variáveis de ambiente do MVP

Copie `.env.example` para `.env` e preencha os valores:

| Variável | Descrição |
|---|---|
| `EVOLUTION_URL` | URL base do servidor Evolution Go (sem barra no final) |
| `GLOBAL_API_KEY` | Chave API global — nunca exposta ao browser |
| `PORT` | Porta local do servidor (padrão: `3000`) |
| `HOST` | Opcional. Endereço de escuta (padrão: `127.0.0.1`, só esta máquina). Outro valor expõe o disparador na rede **sem login** |
| `EVOLUTION_CA_FILE` | Opcional. PEM de autoridade certificadora extra, se o Evolution usar certificado próprio; a verificação TLS continua obrigatória |

---

## Rodar o MVP

```bash
cp .env.example .env   # preencha com suas credenciais
npm install
npm start              # ou: npm run dev (reinicia sozinho ao salvar o server.js)
# Acesse http://localhost:3000
npm test               # testes contra o Evolution simulado (nenhum envio real)
```

- O site só funciona com o servidor ligado: fechar o terminal derruba a página (`ERR_CONNECTION_REFUSED`).
- O `.env` só é lido na inicialização — reinicie o servidor após alterá-lo. Mudanças no `index.html` só exigem recarregar a página.

---

## Arquivos principais do MVP

| Arquivo | Papel |
|---|---|
| `server.js` | Proxy para o Evolution Go + entrega de `index.html` e `phone.js` |
| `index.html` | Toda a UI e lógica do frontend (HTML + CSS + JS inline) |
| `phone.js` | Regra única de validação de telefone, usada pelo servidor (`require`) e pelo navegador (`/phone.js`) |
| `tests/` | Testes `node:test`: telefone, servidor (com Evolution simulado e TLS) e interface (jsdom) |
| `.env` | Credenciais reais — nunca commitado |
| `.env.example` | Modelo com os nomes das variáveis — commitado (copie, não renomeie) |
| `backup/` | Cópias de preservação locais — ignoradas pelo git |
| `doc_evolution_go.md` | Documentação completa da API Evolution Go |

---

## Como conectar uma instância ao WhatsApp (Evolution Go)

Antes de usar o disparador, é necessário ter uma instância criada e conectada no servidor Evolution Go.

### 1. Criar a instância (via curl ou Postman)

```bash
curl -X POST {EVOLUTION_URL}/instance/create \
  -H "Content-Type: application/json" \
  -H "apikey: SUA_GLOBAL_API_KEY" \
  -d '{
    "name": "minha-instancia",
    "token": "token-secreto-da-instancia"
  }'
```

- `name`: nome único da instância (sem espaços, ex: `vendas`, `suporte`)
- `token`: token livre — você define agora e vai usar no disparador

### 2. Conectar via QR Code

```bash
# Passo 1 — iniciar o processo de conexão
curl -X POST {EVOLUTION_URL}/instance/connect \
  -H "Content-Type: application/json" \
  -H "apikey: token-secreto-da-instancia"

# Passo 2 — buscar o QR Code (em base64)
curl {EVOLUTION_URL}/instance/qr \
  -H "apikey: token-secreto-da-instancia"
```

- O campo `data.code` retorna `data:image/png;base64,...` — cole numa tag `<img>` para renderizar o QR.
- No WhatsApp do celular: **Configurações → Aparelhos conectados → Conectar aparelho** → escaneie o QR.

### 3. Alternativa: conectar via código de pareamento (sem QR)

```bash
curl -X POST {EVOLUTION_URL}/instance/pair \
  -H "Content-Type: application/json" \
  -H "apikey: token-secreto-da-instancia" \
  -d '{"phone": "5511999999999"}'
# Retorna: {"data": {"code": "12345678"}}
```

- No WhatsApp: **Aparelhos conectados → Vincular com número de telefone** → informe o código de 8 dígitos.

### 4. Verificar se está conectado

```bash
curl {EVOLUTION_URL}/instance/status \
  -H "apikey: token-secreto-da-instancia"
# data.connected e data.loggedIn devem ser true (conforme doc_evolution_go.md)
```

### 5. Usar no Disparador

Após a instância estar conectada:
1. Acesse `http://localhost:3000`
2. Clique em **↺ Carregar** — a instância aparecerá no dropdown
3. Informe o `token-secreto-da-instancia` no campo **Token da Instância**
4. Clique em **💾** para salvar o token no `localStorage` (não precisa redigitar)
5. Se o indicador estiver **verde (Conectado)**, pode avançar para os próximos passos

---

## Funcionalidades completas do frontend (index.html)

O frontend é um wizard de 5 etapas com stepper visual animado.

### Etapa 1 — Instância
- Carrega a lista de instâncias via `GET /api/instances` (botão **↺ Carregar**)
- Exibe indicador de status (verde = conectado, vermelho = desconectado) para cada instância
- Campo de token da instância com toggle de visibilidade (👁)
- Salva o token no `localStorage` com chave `token:{nome-instancia}` — carregado automaticamente ao selecionar

### Etapa 2 — Contatos
- **Aba Manual**: adiciona contatos um a um (Nome + Telefone com DDI)
  - Validação pela regra de `phone.js` (detalhes em `docs/SEGURANCA_MVP.md`): formato internacional; sem `+` só Brasil (`55` + DDD válido + 8 ou 9 dígitos); outros países com `+`; recusa sem DDI, zero inicial, caracteres inválidos e números concatenados — nunca acrescenta DDI
  - Enter no campo de telefone dispara o botão Adicionar
- **Aba Excel**: importa planilha `.xlsx` ou `.xls` via drag-and-drop ou clique
  - Detecção automática das colunas de telefone e nome por expressão regular
  - Preview das primeiras 6 linhas antes de confirmar a importação
  - Seletor de colunas configurável antes de importar
  - Linhas sem telefone válido são ignoradas; o log informa a contagem e o motivo (ex.: `3 sem DDI, 1 vazio`)
- Tabela de contatos com número de linha e botão de remoção individual
- Botão **🗑 Limpar** remove todos os contatos (com confirmação)
- Badge com contagem total de contatos

### Etapa 3 — Mensagem
- Textarea para a mensagem principal
- Placeholder dinâmico `{nome}` substituído pelo nome do contato em cada envio
- Contador de caracteres em tempo real
- Botão **👁 Pré-visualizar**: renderiza a mensagem com o primeiro contato da lista (ou "Contato Exemplo")
- **Variações de mensagem (Teste A/B)**: toggle ativa múltiplas variações
  - O sistema escolhe uma variação aleatória a cada envio
  - Cada variação suporta `{nome}`
  - Variações adicionadas/removidas dinamicamente

### Etapa 4 — Delay
- Campos de **tempo mínimo** e **tempo máximo** em segundos
- O sistema aguarda um tempo aleatório entre `min` e `max` entre cada mensagem
- Preview visual: "Aguardará entre Xs e Ys entre cada envio"
- Aviso (banner amarelo) quando mínimo < 5s (risco de banimento)
- Validação: mínimo ≥ 1s; máximo ≥ mínimo

### Etapa 5 — Disparar
- Resumo pré-disparo: instância, quantidade de contatos, faixa de delay
- Botão **▶ Iniciar Disparo** — inicia o loop assíncrono
- Botão **⏹ Parar** — interrupção limpa via flag `stopRequested` (sem kill forçado)
- Barra de progresso animada com contador `X / total` e percentual
- **Painel de log** em tempo real (máx 500 entradas):
  - ✓ verde para envios bem-sucedidos
  - ✗ vermelho para erros com mensagem de erro inline
  - ◆ amarelo para eventos do sistema (início, interrupção, importação)
  - Auto-scroll desativado se o usuário rolar manualmente
- **Resumo pós-disparo**: enviados, erros, tempo total, delay médio
- Aviso de interrupção se parado pelo usuário
- Botão **🚀 Iniciar Novo Disparo** — limpa contatos e volta ao passo 2 (mantém instância e mensagem)

---

## API Evolution Go — Endpoints usados pelo disparador

| Rota local | Proxy para | Auth header | Descrição |
|---|---|---|---|
| `GET /api/instances` | `GET {EVOLUTION_URL}/instance/all` | `GLOBAL_API_KEY` (só no servidor) | Lista instâncias. Responde só `{ data: [{ name, connected }] }` |
| `POST /api/send/text` | `POST {EVOLUTION_URL}/send/text` | token da instância (vem do frontend) | Envia texto. Responde só `{ ok, messageId }` ou `{ error }` |

Payload de envio enviado ao Evolution Go:
```json
{ "number": "5511999999999", "text": "Olá João!", "delay": 0 }
```

Consulte `doc_evolution_go.md` para todos os 79 endpoints disponíveis.

---

## Decisões técnicas do MVP

As decisões do SaaS estão em `saas/docs/DECISOES_TECNICAS.md`.

- `proxyFetch` em `server.js` usa módulos nativos do Node (`http`/`https`) — sem `node-fetch`
- Segue redirects (até 5 saltos) **só para o mesmo host e nunca de HTTPS para HTTP**, porque a chave vai no header; POST vira GET em 302/303
- `httpsAgent` com `rejectUnauthorized: true` explícito: certificado do Evolution sempre verificado, mesmo com `NODE_TLS_REJECT_UNAUTHORIZED=0`. `EVOLUTION_CA_FILE` só acrescenta uma autoridade às padrão
- Servidor escuta em `127.0.0.1` por padrão (`HOST` no `.env` muda isso, com aviso no console)
- `GLOBAL_API_KEY` nunca chega ao browser — toda autenticação administrativa é feita no servidor
- Erros de rede/TLS viram mensagens fixas (sem URL nem detalhes internos); erros do Evolution são reduzidos a um texto curto — o corpo original nunca é repassado
- Validação de telefone única em `phone.js` (padrão UMD), aplicada no navegador e de novo no servidor
- Tokens de instância salvos no `localStorage` com chave `token:{nome-instancia}`
- Disparo é um loop `async/await` com flag `stopRequested` para interrupção limpa (sem Promise.race nem AbortController)
- Log limitado a 500 entradas para evitar degradação de performance em listas muito grandes
- Escape de HTML em todos os dados exibidos no log (`esc()`) para evitar XSS
- O frontend envia o token da instância no header `X-Instance-Token`; o servidor o repassa como `apikey`
- O servidor serve só `GET /` → `index.html` e `GET /phone.js` (sem `express.static(__dirname)`, que exporia `.env`, `server.js` e `node_modules`)
- `GET /api/instances` usa **lista de campos permitidos** (`toPublicInstance`): só `name` e `connected` saem; token, jid, qrcode, proxy e objetos aninhados nunca chegam ao navegador
- Erro `not authorized` (ou HTTP 401) no envio interrompe o disparo na hora, para não falhar contato por contato

---

## Bugs conhecidos e corrigidos do MVP

### 1. Status da instância sempre "Desconectado" (corrigido)
**Causa:** A resposta de `GET /instance/all` retorna `"connected": true/false` (booleano), mas o código buscava `connectionStatus` e `status` — campos que não existem nessa rota.  
**Correção:** Checar `inst.connected === true` como prioridade; manter fallback para `connectionStatus`/`status` para compatibilidade com outras versões da API.  
**Lição:** Ao parsear status de instância, sempre verificar o campo `connected` (booleano) primeiro.

### 2. Pré-visualização de mensagem não aparecia (corrigido)
**Causa:** A `.preview-box` tem `display: none` no CSS. O código fazia `box.style.display = ''` (string vazia), que remove o estilo inline mas mantém o `display: none` da classe CSS ativo — box continua invisível.  
**Correção:** Usar `box.style.display = 'block'` explicitamente ao exibir.  
**Lição:** Para mostrar elementos com `display: none` na classe CSS, sempre setar `'block'` (ou o valor correto) — nunca string vazia.

### 3. Erro `not authorized` no disparo
**Causa:** Token errado no campo "Token da Instância". O Evolution Go rejeita com `not authorized` quando o `apikey` enviado para `/send/text` não bate com o token definido na criação da instância.  
**Não é bug de código** — é erro de configuração do usuário.  
**Como resolver:** O token informado no campo deve ser exatamente o valor do campo `"token"` usado no `POST /instance/create`. Se o token foi perdido, recriar a instância com um token conhecido.

---

## Ao fazer mudanças

- **Onde mexer:**
  - **MVP:** `index.html` para UI/UX e lógica do frontend; `server.js` para proxy e rotas; `phone.js` para a regra de telefone (esta regra será revista com a arquitetura do SaaS);
  - **SaaS:** só dentro de `saas/`, na aplicação ou no pacote responsável (ver `saas/docs/ESTRUTURA_TECNICA.md`).
- **Estrutura mínima:** não criar arquivos desnecessários. `docs/`, `tests/` e `saas/` fazem parte da estrutura.
- **Respostas ao navegador:** sempre por lista de campos permitidos (MVP) ou pelo contrato de `packages/contracts` (SaaS), nunca repassando o corpo do Evolution nem dados internos.
- **Antes de concluir:**
  - **MVP:** `npm test`, rodar o servidor e verificar o fluxo completo;
  - **SaaS:** `npm test`, `npm run typecheck` e `npm run build` em `saas/`;
  - nos dois casos, rodar também a suíte do outro projeto.
- **Registro:** anotar a alteração em `docs/CHANGELOG_DESENVOLVIMENTO.md` e, no SaaS, atualizar `saas/docs/` quando a estrutura ou uma decisão mudar.
- **Chaves:** nunca expor `GLOBAL_API_KEY` (nem qualquer segredo) em respostas de API, no bundle do painel ou em logs do navegador.
