# Disparador WhatsApp — Evolution Go

Plataforma SaaS multiempresa de disparos e integrações: WhatsApp (Evolution Go), Envio de Mensagens, Contatos e redes sociais (Zernio). O repositório tem **um único sistema**, o SaaS em `saas/`.

**O MVP foi removido da raiz em 2026-11-03** (decisão do dono do produto). Cópia de preservação em `backup/mvp-removido-2026-11-03/` (ignorada pelo git) e histórico completo nos commits anteriores (`908ca2f`, `32e84e8`).

**Fase atual:** Fase 5 (banco de dados, autenticação e Super Admin), com o SaaS como único produto. A fundação técnica foi concluída na Fase 4 (ver `saas/docs/ESTRUTURA_TECNICA.md`). Repositório git com remoto `origin` no GitHub (`Sinvaldo-Oliveira/disparazap`), desde 2026-11-01. Fase 5 (banco de dados, autenticação e Super Admin) **em andamento**: a autenticação, a integração global com a Evolution Go, o módulo WhatsApp das empresas, o Envio de Mensagens, a página Contatos, a integração com a Zernio (Integrações, 2026-11-02) e a página Redes Sociais (publicar, agendar, calendário, histórico, biblioteca e resultados, 2026-11-03) e a Inbox com WhatsApp (etapa I1, 2026-11-04, recebimento desligado até a homologação) estão implementados (2026-11-01, banco embutido; testes com a Evolution simulada); a conclusão da homologação real do WhatsApp, a conexão ao Supabase e a entrada pelo MyLinksss dependem de autorização. O SaaS vai reunir WhatsApp, redes sociais via Zernio, agentes de IA, automações e API REST + webhooks; a visão e as decisões estão em `docs/DISPARAZAP_MASTER.md`.

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
| `saas/docs/REFERENCIA_ZERNIO.md` | Resumo da documentação oficial da Zernio (OpenAPI 1.444.0, lida em 2026-11-02) nas partes que o DisparaZap usa |
| `saas/docs/PLANO_MODULO_ZERNIO.md` | Plano da integração com a Zernio (conta própria por empresa, em Integrações), aguardando aprovação |
| `saas/docs/PLANO_MODULO_REDES_SOCIAIS.md` | Auditoria e plano do módulo Redes Sociais (publicar, agendar, calendário, biblioteca, histórico, resultados, interações pela Zernio; etapas S1 a S8). Aprovado em 2026-11-03; S1 a S5, S7 e a biblioteca de imagens implementados |
| `saas/docs/PLANO_MODULO_INBOX.md` | Auditoria e plano da Inbox multicanal (WhatsApp pela Evolution Go e redes pela Zernio, três colunas, atendentes, preparação para IA e automações; etapas I0 a I9). Decisões N1 a N8 aprovadas em 2026-11-03; I1 implementada localmente em 2026-11-04 |
| `saas/docs/HOMOLOGACAO_I0_EVOLUTION.md` | Etapa I0 da Inbox: WebSocket e eventos da Evolution Go confirmados no código das versões 0.6.1 a 0.7.2, riscos, estratégia de conexão e procedimentos P0 a P7 que aguardam autorização; seção 10: homologação da I1 (H1 a H7) e o que falta para a produção |
| `saas/docs/PLANO_MODULO_AUTOMACOES.md` | Plano das automações de redes pela Zernio na página Automações (comentário → DM, só seguidores, menção em story, link ou QR, regras de repetição; etapas A1 a A6 e homologação H1 a H3). Aprovado em 2026-11-05 (A1 a A9); etapas A1 (consulta), A2 (Comentário → DM e → resposta pública), A3 (só seguidores e menção em story) A5 (link → conversa, só Instagram, com QR code) A6 (comentário → perguntar antes do link, só Instagram) e A4 (atividade no detalhe, com comentários que não casaram só para dono e administradores) implementadas |
| `doc_evolution_go.md` | Referência da API Evolution Go. Onde ela diverge do Swagger da versão instalada, vale o Swagger (ARQUITETURA_SAAS §5.2) |

## Regras obrigatórias

- **Nunca registre credenciais** em nenhum arquivo do projeto (Markdown, código, comentários, testes, commits): senhas, tokens de instância, `GLOBAL_API_KEY`, credenciais da Zernio, chaves de provedores de IA, URLs privadas de servidores ou dados pessoais reais (telefones, nomes de clientes). Use placeholders como `SUA_GLOBAL_API_KEY` ou `{EVOLUTION_URL}`. Não leia nem copie o conteúdo do `.env` (nem do `saas/.env`).
- **Documentação de cada fase:**
  - **Antes de começar**, consulte `docs/DISPARAZAP_MASTER.md` e `docs/AUDITORIA_INICIAL.md`. No SaaS, consulte também `saas/docs/ESTRUTURA_TECNICA.md` e `saas/docs/DECISOES_TECNICAS.md`. O objetivo é não duplicar o que existe nem contrariar uma decisão registrada.
  - **A cada alteração**, registre uma entrada em `docs/CHANGELOG_DESENVOLVIMENTO.md`. A cada decisão de produto ou arquitetura, atualize `docs/DISPARAZAP_MASTER.md`. No SaaS, atualize também `saas/docs/` quando a estrutura, uma decisão técnica ou uma versão de dependência mudar.
  - **Ao terminar a fase**, deixe o estado e as pendências registrados nesses documentos.
  - Não reescreva documentos históricos (`docs/AUDITORIA_INICIAL.md`).
- **Projeto único:**
  - todo código novo fica dentro de `saas/`;
  - a raiz guarda só a documentação, o `CLAUDE.md`, o `doc_evolution_go.md` (referência da API), o `.gitignore` e o `.env` local (não versionado);
  - não crie `package.json` na raiz.
- **Serviços reais e VPS:** sem autorização explícita da fase, não faça nenhuma destas coisas:
  - conectar a PostgreSQL, Redis, Evolution Go real, Zernio, MyLinksss ou qualquer banco ou serviço de produção;
  - instalar ou iniciar serviços (Docker incluído);
  - acessar ou modificar a VPS Hostinger;
  - criar instâncias WhatsApp ou enviar mensagens reais.
- **Não implemente módulos do SaaS** (login, empresas, banco, Zernio, IA, API pública) sem um plano aprovado pelo dono do produto.
- A Zernio é uma integração **independente** do Evolution Go. Não presuma o que ela suporta: confirme na documentação oficial antes de planejar.
- **Nunca desligue a verificação TLS** (`rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`) para contornar erro de certificado. Certificado próprio → `EVOLUTION_CA_FILE`.
- **Não mude a escuta para fora de `127.0.0.1`** no código: o SaaS só tem login pelo banco; em desenvolvimento a escuta fica local. Quem precisar de rede usa `HOST` no `.env` do MVP, ciente do risco. No SaaS, o padrão de `API_HOST`, do Vite e do preview continua sendo `127.0.0.1`.
- **Git:**
  - remoto `origin` no GitHub (`Sinvaldo-Oliveira/disparazap`), publicado a pedido do dono do produto em 2026-11-01;
  - nunca faça commit, push, novo remoto ou deploy sem aprovação explícita;
  - antes de cada push, confira que nenhum segredo, dado pessoal real ou endereço privado vai junto (inclusive no histórico);
  - nunca versione `.env`, `saas/.env`, `backup/`, `node_modules/`, `dist/` ou chaves.
- **Testes:** rode antes de concluir qualquer mudança de código:
  - **SaaS:** `npm test`, `npm run typecheck` e `npm run build` dentro de `saas/`.

  Ao mexer num projeto, rode também a suíte do outro. Os testes usam só serviços simulados: nunca instâncias reais nem envios reais.

---

## SaaS — monorepo `saas/`

É um projeto npm independente (npm workspaces, lockfile próprio) em TypeScript. Em desenvolvimento, o Node 24 executa o TypeScript direto; em produção, roda o JavaScript compilado com `tsc`. A estrutura está em `saas/docs/ESTRUTURA_TECNICA.md`, e as decisões e versões em `saas/docs/DECISOES_TECNICAS.md`.

| Pasta | Papel |
|---|---|
| `apps/api` | API Fastify 5: configuração validada com Zod, `GET /health/live` e `/health/ready`, prefixo `/api/v1` (ainda sem rotas), erros em RFC 9457, logs com redação, CORS por lista explícita, cabeçalhos de segurança, **autenticação Better Auth** (`/api/auth/*`, `/api/internal/signup`, `/api/internal/me`), integração global com a Evolution Go do Super-Admin (`/api/internal/platform/*`) , **módulo WhatsApp** das empresas (`/api/internal/whatsapp/*`: instâncias, QR Code, pareamento, status) e **Envio de Mensagens** e **Contatos** (`/api/internal/contact-lists[/:id[/contacts[/remove]]]`, `/contacts/search`, `/media`, `/message-templates`, `/messaging/send`) e **Integrações/Zernio** (`/api/internal/integrations/zernio/*`: chave da empresa, redes conectadas, conectar, volta e desconectar) e **Redes Sociais** (`/api/internal/social/*`: visão geral, publicar, agendar, editar, reagendar, cancelar, tentar de novo, remover da rede, fuso da empresa, métricas, biblioteca) e **Automações** (`/api/internal/automations/*`: visão geral, detalhe, criar pausada, alterar, ativar ou pausar e excluir automações de comentário na Zernio, com a trava `AUTOMATIONS_WRITE_ENABLED`) e **Inbox** (`/api/internal/inbox/*`: canais e recebimento, conversas, histórico, lida, responder, ligar o recebimento por instância, SSE `/stream`; consumidor dos eventos da Evolution por WebSocket, desligado por padrão) |
| `apps/web` | Painel React 19 + Vite 8 + React Router 8: telas Entrar e Criar conta, rotas protegidas, layout, menu, Visão Geral, Configurações (integração global do Super-Admin), Envio de Mensagens (assistente de 5 etapas portado do MVP, listas de contatos salvas, Excel via SheetJS sob demanda), Contatos (gestão das listas, criação e busca), Integrações (WhatsApp: instâncias da Evolution Go, que antes ficavam na página /whatsapp, agora redirecionada; e Zernio: chave e redes sociais da empresa), Redes Sociais (abas Visão Geral, Criar publicação, Calendário, Histórico, Biblioteca, Resultados e Interações), Inbox (três colunas: conversas, conversa e detalhes; no celular, uma por vez), Automações (seção "Redes sociais": lista, detalhe, construtor com prévia, ativar com confirmação) e páginas "Em desenvolvimento" |
| `apps/worker` | Processo das filas: por enquanto só ciclo de vida e encerramento controlado; nenhuma fila |
| `packages/contracts` | Contratos públicos (Zod + tipos) usados pela API e pelo painel |
| `packages/db` | Só servidor: schema Drizzle (esquemas `identity`, `platform` e `app`), migrations e conexão (PostgreSQL com TLS verificado ou banco embutido PGlite no desenvolvimento) |
| `packages/shared` | Código só de servidor: `parseEnv`, logger com redação, `handleShutdownSignals` |
| `infra/docker` | Reservado; ainda não há Docker Compose |
| `infra/hostinger` | Publicação no aplicativo Node.js da Hostinger: `server.js`, empacotador, operações de produção e passo a passo |
| `docs` | `ESTRUTURA_TECNICA.md`, `DECISOES_TECNICAS.md`, `SUPABASE_CONFIGURACAO.md`, `PLANO_MODULO_WHATSAPP.md`, `REFERENCIA_ZERNIO.md`, `PLANO_MODULO_ZERNIO.md`, `PLANO_MODULO_REDES_SOCIAIS.md`, `PLANO_MODULO_INBOX.md` e `HOMOLOGACAO_I0_EVOLUTION.md` |

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
npm run pacote:hostinger  # compila e gera saas/deploy/disparazap-hostinger.zip (aplicativo Node.js da Hostinger)
npm run producao:migrar   # (e producao:admin, producao:segredos) banco de PRODUÇÃO, lendo saas/.env.producao
```

- **Configuração:** o `.env` do SaaS é `saas/.env` (modelo em `saas/.env.example`), Todas as variáveis têm padrão seguro. Sem `DATABASE_URL`, a API usa o banco embutido em `saas/.data/` (ignorado pelo git); nunca aplique migrations em banco remoto nem use `drizzle-kit push` sem autorização. **Um processo por banco embutido:** nunca deixe duas `npm run dev:api` rodando ao mesmo tempo (já corrompeu o banco local em 2026-11-03); a trava `saas/.data/pglite.lock` recusa a segunda. Antes de mexer na pasta do banco, faça uma cópia.
- **Publicação (Hostinger, D-45):**
  - a API entrega o painel quando `WEB_DIST_DIR` está preenchido (em desenvolvimento, vazio);
  - `API_TRUST_PROXY` só atrás de proxy;
  - os comandos `producao:*` acessam o banco de produção: só o dono do produto os executa, ou o assistente com autorização
    explícita;
  - nunca leia nem copie `saas/.env.producao`;
  - o pacote nunca leva `.env`, chave privada nem mapa de código-fonte (o empacotador recusa).
- **Zernio (Integrações, D-46):**
  - cada empresa usa a própria conta e a própria chave Zernio, cifrada no cofre (`provider='zernio'`), que nunca volta ao
    navegador nem vai para o log;
  - endereço fixo da Zernio no código;
  - só dono e administradores alteram;
  - a volta da autorização é conferida pelo comprovante assinado e as contas são relidas na Zernio (só as do perfil da
    empresa);
  - testes e demonstrações só com `apps/api/src/testing/zernio-simulator.ts`;
  - chamadas reais só com a chave do dono do produto, por ele, ou com autorização explícita.
- **Redes Sociais (D-48 a D-51):**
  - publica só nas contas do perfil da empresa (relidas na Zernio a cada publicação); dono, administradores e operadores
    publicam; visualizadores só veem; remover da rede e excluir imagem da biblioteca só dono e administradores;
  - todo `POST /v1/posts` leva a `Idempotency-Key` (o `requestId` do painel); repetir só com a mesma chave;
  - as imagens vão da biblioteca (`app.media_files`) para a Zernio pelo servidor (presign + `PUT` sem a chave);
  - erros das redes só como mensagens fixas por categoria; o texto das publicações não vai para o log;
  - horários no fuso da empresa (`identity.organizations.timezone`);
  - testes e demonstrações só com o simulador; publicação real só pelo dono do produto ou com autorização explícita.
- **Inbox (D-52 a D-55):**
  - `INBOX_EVENTS_ENABLED` e `INBOX_ACTIVATION_ENABLED` ficam `false` no `saas/.env` e na produção; só o dono do produto as
    liga, na homologação autorizada (HOMOLOGACAO_I0 §10, passos H1 a H7, um por um). Com elas ligadas, a API de
    desenvolvimento conecta ao servidor Evolution **real** configurado em Configurações;
  - nada é ligado sozinho nas instâncias: o recebimento é ligado por instância, pelo dono ou administrador, com confirmação;
  - eventos de instância que não esteja no banco do DisparaZap com a Inbox ligada são descartados antes de gravar ou avisar;
  - a URL do WebSocket (leva a chave global), o texto e o número das mensagens nunca vão para o log; o SSE só leva ids;
  - o atendente (operador) vê as conversas dele e as sem responsável; o visualizador não usa a Inbox;
  - toda resposta leva o `requestId` do painel (repetir nunca envia duas vezes); quem responde assume a conversa e a
    `control_version` sobe; resposta automática futura só sai pela trava `canDeliverAutomated`;
  - testes só com o simulador (`testing/evolution-simulator.ts`, que tem `/ws`); nenhuma mensagem real.
- **Automações de redes (D-65):**
  - a Zernio guarda as automações (sem tabela); toda leitura confere se a conta é do perfil da empresa;
  - dono e administradores gerenciam; atendentes e visualizadores só veem;
  - `AUTOMATIONS_WRITE_ENABLED` fica `false` no `saas/.env` e na produção até a homologação H1 a H3, autorizada pelo dono;
  - automações ativas enviam DMs reais sozinhas: criar sempre pausada, ativar com confirmação; testes só com o simulador;
  - o texto das DMs e das respostas nunca vai para o log; erros só como mensagens fixas.
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
- **Ainda não existe:** conexão com o Supabase, entrada pelo MyLinksss, 2FA, recuperação de senha, convites, filas, Docker Compose, campanhas no servidor (fila, histórico, agendamento), consentimento e descadastro de contatos, vídeo e interações (comentários e avaliações) nas redes sociais, webhooks da Zernio, webhooks da Evolution, conclusão da homologação do WhatsApp no servidor real, recebimento real da Inbox (homologação H1 a H7), mídias, etiquetas, transferência e outros canais na Inbox e os demais módulos de negócio.

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

---

## Ao fazer mudanças

- **Onde mexer:** só dentro de `saas/`, na aplicação ou no pacote responsável (ver `saas/docs/ESTRUTURA_TECNICA.md`).
- **Estrutura mínima:** não criar arquivos desnecessários. `docs/` e `saas/` fazem parte da estrutura.
- **Respostas ao navegador:** sempre pelo contrato de `packages/contracts`, nunca repassando o corpo do Evolution, da Zernio nem dados internos.
- **Antes de concluir:** `npm test`, `npm run typecheck` e `npm run build` em `saas/`.
- **Registro:** anotar a alteração em `docs/CHANGELOG_DESENVOLVIMENTO.md` e, no SaaS, atualizar `saas/docs/` quando a estrutura ou uma decisão mudar.
- **Chaves:** nunca expor `GLOBAL_API_KEY`, chave da Zernio ou qualquer segredo em respostas de API, no bundle do painel ou em logs do navegador.
