# Estrutura técnica — SaaS DisparaZap

| | |
|---|---|
| **Data** | 2026-10-31 (fundação, Fase 4); atualizado em 2026-11-01 (autenticação, integração global, módulo WhatsApp e Envio de Mensagens) |
| **Escopo** | API, painel web e worker; autenticação com cadastro de empresa e três tipos de usuário; integração global com a Evolution Go; instâncias de WhatsApp das empresas; Envio de Mensagens com listas de contatos salvas. Sem fila nem campanhas no servidor |
| **Arquitetura de referência** | `docs/ARQUITETURA_SAAS.md` (raiz do repositório) |

> **Atualizações de 2026-11-01:**
> - a seção 8 descreve a autenticação; a 9, a integração global; a 10, o módulo WhatsApp; a 11, o Envio de Mensagens;
> - as seções 1 a 6 descrevem a fundação e continuam válidas, exceto onde as seções novas acrescentam peças;
> - a contagem de testes está atualizada na seção 7.

---

## 1. Visão geral

**Monólito modular** num monorepo com npm workspaces. Três aplicações compartilham dois pacotes:

```
            ┌──────────────────────┐      ┌──────────────────────┐
            │ apps/web (React)     │      │ apps/worker          │
            │ painel no navegador  │      │ processo de filas    │
            └─────────┬────────────┘      └─────────┬────────────┘
     GET /health/live │ (mesma origem;              │
                      │  proxy do Vite em dev)      │
            ┌─────────▼────────────┐                │
            │ apps/api (Fastify)   │                │
            └─────────┬────────────┘                │
                      │                             │
    ┌─────────────────▼─────────────┐   ┌───────────▼───────────────┐
    │ packages/contracts            │   │ packages/shared (servidor) │
    │ health check, erro RFC 9457   │   │ env, logger, encerramento  │
    │ (usado por API e painel)      │   │ (usado por API e worker)   │
    └───────────────────────────────┘   └────────────────────────────┘
```

Nenhuma aplicação acessa banco, Redis, Evolution Go, Zernio ou MyLinksss.

## 2. Responsabilidades

| Pasta | Responsabilidade | Não pode |
|---|---|---|
| `packages/contracts` | Formatos públicos trocados entre API e clientes (Zod + tipos). Roda no navegador e no Node | Importar código de servidor; antecipar modelos de negócio |
| `packages/shared` | `parseEnv` (validação de ambiente), `createLogger` (pino com redação), `handleShutdownSignals` | Ser importado pelo painel (é só de servidor) |
| `apps/api/src/config` | Schema das variáveis da API e `loadApiConfig` | Ler `process.env` fora daqui |
| `apps/api/src/app` | `buildApp`: monta o Fastify **sem abrir porta** (testável com `inject`) | — |
| `apps/api/src/plugins` | Erros (RFC 9457), logs, cabeçalhos de segurança, CORS | — |
| `apps/api/src/routes` | `health.ts` (`/health/live`, `/health/ready`), `v1.ts` (prefixo `/api/v1`, sem rotas), `auth.ts` (`/api/auth/*`), `internal.ts` (`/api/internal/signup` e `/me`), `platform.ts` (Super-Admin), `whatsapp.ts` (instâncias das empresas) e `messaging.ts` (listas e envio) | Expor rota sem autenticação, exceto health, entrar e criar conta |
| `apps/api/src/auth` | Better Auth, senhas, cadastro, sessão para o painel, Super-Admin (seção 8) e `member.ts` (empresa e papel de quem age) | Aceitar papel ou origem vindos do navegador |
| `apps/api/src/security` | Cofre de credenciais (`vault.ts`) e limite de tentativas (`rate-limiter.ts`) | Devolver segredos abertos fora da API |
| `apps/api/src/integrations` | Cliente HTTP da Evolution Go e adaptador `WhatsAppProvider` (seções 9 e 10) | Repassar o corpo das respostas da Evolution |
| `apps/api/src/platform` | Integração global da Evolution Go: ler, salvar, testar e abrir para uso (seção 9) | — |
| `apps/api/src/whatsapp` | Serviço das instâncias das empresas (seção 10) | Agir sobre instância que não esteja no banco do DisparaZap |
| `apps/api/src/messaging` | Listas de contatos e envio de texto (seção 11) | Gravar número ou texto de mensagem no log |
| `apps/api/src/testing` | Evolution Go simulada, usada só pelos testes; fora do build de produção | Ser importada pelo código da API |
| `packages/db` | Schema Drizzle (`identity`, `platform`, `app`), migrations e conexão (seção 8) | Ser importado pelo painel (é só de servidor) |
| `apps/api/src/modules` | Módulos de domínio (vazio; ver `README.md` da pasta) | Acessar tabelas de outro módulo |
| `apps/api/src/index.ts` | Lê a configuração, sobe o servidor, registra o encerramento | Conter lógica de negócio |
| `apps/worker/src` | `createWorker` (ciclo de vida), registro de filas (vazio), `index.ts` | Conectar ao Redis ou processar tarefas (nesta fase) |
| `apps/web/src/app` | `App` (rotas), `navigation.ts` (menu e permissões), cliente do health check | — |
| `apps/web/src/layouts` | `AppLayout`: menu lateral + cabeçalho + área de conteúdo | — |
| `apps/web/src/components` | `Sidebar`, `Header`, `Card`, `PageHeader`, `StatusBadge`, `UnderConstruction`, `EnvironmentStatus`, `BrandMark` | Simular dados |
| `apps/web/src/pages` | `OverviewPage`, `ModulePage` (genérica para módulos em desenvolvimento), `NotFoundPage` | — |
| `apps/web/src/styles` | `global.css`: tokens de cor, layout responsivo, componentes | — |
| `infra/docker` | Reservado para o Compose (só `README.md`) | — |

## 3. API

| Item | Implementação |
|---|---|
| Configuração | Zod: `NODE_ENV`, `LOG_LEVEL`, `API_HOST` (padrão `127.0.0.1`), `API_PORT` (padrão `3100`), `API_CORS_ORIGINS` (padrão vazio), `API_SHUTDOWN_TIMEOUT_MS`. Inválida → o processo sai com 1 e a mensagem cita a variável, nunca o valor |
| Rotas | `GET /health/live` → `{ status, service, timestamp }` (sem versão, host ou uptime). `/api/v1/*` → 404 (prefixo reservado) |
| Erros | `setErrorHandler` + `setNotFoundHandler`: sempre `application/problem+json` (RFC 9457) com título fixo por status e `requestId`. Mensagem original e stack ficam só no log |
| Logs | pino em JSON; `req` registrado só como `{ id, method, url sem query string }`; cabeçalhos nunca registrados; redação de `authorization`, `cookie`, `token`, `password`, `secret`, `apiKey` (até um nível de profundidade) |
| Segurança | `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, `cache-control: no-store`, `x-request-id` gerado no servidor (o do cliente é ignorado), sem `x-powered-by`, limite de corpo 1 MB, `trustProxy: false` |
| CORS | `@fastify/cors` com lista explícita de origens exatas; `*` é recusado na configuração; lista vazia = nenhuma origem externa |
| Encerramento | `SIGINT`/`SIGTERM` → `app.close()` com prazo; segundo sinal ou prazo esgotado → saída 1; `return503OnClosing` |

## 4. Worker

- Inicializa por conta própria (`npm run dev:worker`), com configuração validada e logs com redação.
- Estado: `idle → running → stopping → stopped`.
- Um `setInterval` mantém o processo vivo e registra "worker ativo" em nível `debug`. **Não executa tarefas.**
- `queues/index.ts` define o tipo `QueueDefinition` e a lista vazia `queues`: é o ponto de entrada das filas BullMQ (etapa 9).
- Encerramento controlado pelo mesmo `handleShutdownSignals` da API.

## 5. Painel web

- **Rotas:** `/` (Visão Geral) e os módulos `/whatsapp`, `/campanhas`, `/envio-de-mensagens`, `/contatos` (com `/contatos/:id`),
  `/agentes-ia`, `/automacoes`, `/redes-sociais`, `/integracoes` e `/configuracoes`. Qualquer outra rota mostra "Página não
  encontrada". Nas subpáginas, o topo mostra o nome do módulo e o item do menu continua marcado.
- **Navegação:** cada item tem `status` (`available` / `in_development`), `permission` (para a Fase 5), `summary` (escopo
  planejado) e `plannedFor` (etapa do roteiro). `visibleNavigation(items, canView)` filtra por permissão; hoje `canView` libera tudo.
- **Visão Geral:**
  - aviso "Plataforma em construção";
  - status do ambiente: a **API é consultada de verdade** em `/health/live`, validada pelo contrato; worker, banco e filas
    aparecem com descrições fixas e verdadeiras ("sem verificação", "não conectado");
  - próxima fase;
  - lista dos módulos planejados.
- **Módulos:** página "Em desenvolvimento" com o escopo e a etapa prevista. Sem dados, formulários, tabelas ou ações.
- **Sem estatísticas.** Desde 2026-11-01, todas as rotas do painel exigem login, e o cabeçalho mostra o usuário (seção 8).
- **Responsivo:** abaixo de 960 px, o menu lateral vira gaveta (botão com `aria-expanded`). Inclui link "Pular para o conteúdo".

## 6. Resolução de pacotes e build

| Situação | Como `@disparazap/*` é resolvido |
|---|---|
| Desenvolvimento (`npm run dev:*`) | Condição `source` do Node → `src/index.ts`, executado pelo suporte nativo do Node 24 a TypeScript |
| Testes (Vitest) | `resolve.alias` → `src/index.ts` (não exige build) |
| Painel (Vite e `tsc` do painel) | Alias do Vite / `customConditions: ["source"]` → `src` |
| Produção (`npm run start`) | `default` → `dist/index.js`, gerado por `tsc -b` |

- Os imports relativos usam a extensão `.ts`; o `tsc` reescreve para `.js` (`rewriteRelativeImportExtensions`).
- `erasableSyntaxOnly` garante que todo código possa ser executado pelo Node sem transpilar.

## 7. Testes

| Arquivo | Testes | Cobre |
|---|---:|---|
| `packages/contracts/src/contracts.spec.ts` | 4 | Contratos aceitam o formato público e recusam campos extras e stack |
| `packages/shared/src/shared.spec.ts` | 8 | `parseEnv` sem ecoar valores; redação de logs; encerramento (sucesso, segundo sinal, prazo, falha, remoção de ouvintes) |
| `packages/db/src/db.spec.ts` | 4 | Pasta-mãe inexistente e persistência entre aberturas; migrations no banco embutido (tabelas só nos esquemas `app`, `identity` e `platform`, nenhuma no `public`); reaplicar não faz nada (contagem lida do `_journal.json`); e-mail único sem diferenciar maiúsculas; `CHECK` de papel e origem |
| `apps/api/src/config/env.spec.ts` | 13 | Padrões seguros; campos vazios; `DATABASE_URL` exige certificado; URL não PostgreSQL; exigências de produção; segredo curto e e-mail inválido sem ecoar valores; origens CORS; porta e nível inválidos |
| `apps/api/src/app/build-app.spec.ts` | 11 | Health e cabeçalhos; id de requisição; 404/500/400/413/415 em RFC 9457 sem detalhes internos; `/api/v1`; CORS; logs sem segredos; escuta em 127.0.0.1 |
| `apps/api/src/auth/auth.spec.ts` | 24 | Schema compatível com o Better Auth; cadastro com empresa; hash argon2id; validação; recusas iguais (e-mail usado e reservado); cadastro direto desativado; cadastro desligado; login e sair; mesma resposta para senha errada e e-mail desconhecido; `/me` sem sessão; origem estranha recusada; papel não promovido pelo navegador; empresa não criada pelo navegador; Super-Admin; `/health/ready`; correções da auditoria: token fora das respostas (A1), limite no cadastro (A3), `localhost` em desenvolvimento (A4), convites desligados (A5) |
| `apps/api/src/startup.spec.ts` | 2 | Processo real sobe, abre o banco e responde (`/health/live` e `/health/ready`); configuração inválida impede o início |
| `apps/worker/src/worker.spec.ts` | 6 | Configuração; nenhuma fila; ciclo de vida sem timers pendentes; encerramento por sinal; processo real sobe e permanece ativo |
| `apps/web/src/app/App.spec.tsx` | 33 | Login exigido; tela de entrar conforme a referência; sem login social nem recuperação falsos; mostrar/ocultar senha; entrar e voltar à página pedida; login recusado; logado vai direto ao painel; API fora do ar; retorno só para caminhos internos; criar conta (validação, sucesso, recusa); painel de apresentação sem números; os três tipos de usuário; sair; layout; Visão Geral (WhatsApp "Disponível", os demais "Em desenvolvimento"); status real de API e banco; módulos; navegação; permissões |
| `packages/contracts/src/platform.spec.ts` | 13 | Endereço da Evolution Go (aceitos e recusados), barra final, campos extras |
| `apps/api/src/security/vault.spec.ts` | 3 | Cifra e abre; texto cifrado muda a cada vez; adulteração, contexto, chave e versão errados recusados |
| `apps/api/src/platform/platform.spec.ts` | 18 | Acesso só do Super-Admin; origem; validações; chave cifrada e nunca devolvida; manter e trocar a chave; teste de conexão (ok, chave recusada, redirecionamento, resposta estranha, servidor desligado); sem cofre |
| `apps/api/src/whatsapp/whatsapp.spec.ts` | 21 | Com e sem integração global; ciclo de vida contra o simulador nos formatos reais (criar com nome `dz_` e token cifrado, limite, QR, conectado com o número vindo do `/instance/info`, desconectar, pareamento com a regra de telefone, excluir revogando o token); a lista sincroniza com o servidor (conexão concluída depois do acompanhamento, queda); leitura de JID e classificação das falhas de envio; isolamento A×B (404); viewer só lê; sem login 401 e outro site 403; lista do Super-Admin; Super-Admin sem empresa; falhas da Evolution (criação falha sem gravar nada, ID buscado na lista, servidor fora do ar) |
| `apps/api/src/messaging/messaging.spec.ts` | 29 | Página Contatos: acrescentar sem repetir (os já na lista e os inválidos ficam de fora), renomear, editar nome e telefone (inválido 400, repetido 409, inexistente 404), remover de vez, busca em todas as listas (nome sem maiúsculas, parte do telefone, curingas como texto, busca curta 400), isolamento entre empresas e viewer só lê, limite de 10.000 ao acrescentar. Imagens: PNG verdadeiro aceito e sem duplicar, arquivo falso, outro formato e acima de 5 MB recusados, isolamento e viewer. Modelos: imagem, texto, CTA e variações; CTA sem link ou com `javascript:` recusado; nome único; imagem de outra empresa recusada; isolamento; atualizar e excluir. Envio com imagem em base64 puro e legenda com CTA; imagem inexistente (404). Listas: vazia e `canSend` por papel; criar validando telefones de novo, sem repetidos e na ordem; nome repetido (409) e curto (400); substituir; 10.000 contatos (mais de 1 MB) aceitos e 10.001 recusados; isolamento A×B; viewer só lê; exclusão definitiva; sem login, outro site e Super-Admin sem empresa. Envio: sucesso sem nada técnico na resposta; número sem WhatsApp; validações antes da Evolution; instância de outra empresa e viewer; instância desconectada (para e marca "Desconectado"); Evolution fora do ar; 60 por minuto |
| `apps/web/src/pages/SettingsPage.spec.tsx` | 7 | Campos, validação, salvar (a chave some da tela), teste de conexão, alteração pendente, cofre ausente, Admin-Empresa sem acesso |
| `apps/web/src/pages/WhatsAppPage.spec.tsx` | 9 | Lista vazia e contador; criar e respeitar o limite; QR até "Conectado" com o número; pareamento com validação do número; desconectar e excluir com confirmação; erro da API; integração ausente; viewer sem botões; Super-Admin só com a tabela geral e o subtítulo certo |
| `apps/web/src/pages/SendMessagesPage.spec.tsx` | 15 | Etapa Mensagem: campos Imagem, Mensagem e CTA nesta ordem, formato de imagem recusado sem chamar a API, pré-visualização com imagem, CTA e link; salvar modelo e carregar modelo salvo (com confirmação); disparo com imagem e CTA em cada envio. Menu e 5 etapas; instância conectada escolhida, desconectada não avança, sem instância aponta para WhatsApp; contatos à mão com a regra de telefone e lista salva; lista salva com confirmação antes de descartar alterações; Excel com colunas detectadas e motivos; mensagem, pré-visualização, variações e intervalo; disparo com texto personalizado e número recusado sem parar; instância desconectada para na hora; "Parar" no intervalo; viewer sem disparo; Super-Admin sem empresa |
| `apps/web/src/pages/ContactsPage.spec.tsx` | 12 | Contatos disponível no menu; listas com totais e filtro pelo nome sem acentos; busca em todas as listas abrindo a lista certa já filtrada (topo e menu continuam em Contatos); nova lista (nome curto recusado); excluir com confirmação; na lista: adicionar à mão (inválido e repetido sem chamar a API), importar planilha com resumo, editar, remover um e vários selecionados, renomear e excluir, busca e páginas de 50; viewer sem botões; sem empresa; lista inexistente |
| `apps/web/src/messaging/spreadsheet.spec.ts` | 4 | `.xlsx` gerado no teste: cabeçalho, colunas, telefones válidos, repetidos e motivos; planilha sem cabeçalho; números sem notação científica; formato recusado |
| `apps/web/src/messaging/message-format.spec.tsx` | 3 | `{nome}` com e sem nome; *negrito*/_itálico_/~riscado~ sem interpretar HTML; tempo e sorteio do intervalo |

**Total: 239 testes (20 arquivos).** O `npm test` da raiz (MVP) não os executa: os nomes `*.spec.*` ficam fora do padrão de descoberta do `node --test`.

## 8. Autenticação (2026-11-01)

| Peça | Onde | O que faz |
|---|---|---|
| Schema e conexão | `packages/db` | Esquema `identity` (Drizzle), migrations em `migrations/`, `openDatabase` (PostgreSQL com TLS verificado ou banco embutido PGlite com migrations automáticas) |
| Configuração | `apps/api/src/config/env.ts` | `DATABASE_*`, `AUTH_*`, `SUPER_ADMIN_EMAIL`; produção exige banco, segredo e https |
| Better Auth | `apps/api/src/auth/auth.ts` | Instância com argon2id, organizações (owner/admin/operator/viewer), cookies `dz.*`, origem/CSRF forçados, limite de tentativas, telemetria desligada |
| Cadastro | `apps/api/src/auth/signup.ts` | Conta + empresa + participação `owner` + empresa ativa na sessão; recusa genérica para e-mail usado ou reservado |
| Sessão para o painel | `apps/api/src/auth/session-info.ts` | Tipo de usuário e empresa, só com campos permitidos (contrato `sessionInfoSchema`) |
| Super-Admin | `apps/api/src/auth/super-admin.ts` e `src/cli/create-super-admin.ts` | Criação por comando de terminal (`npm run admin:create`), senha digitada e nunca gravada |
| Rotas | `apps/api/src/routes/auth.ts`, `internal.ts`, `health.ts` | `/api/auth/*` (Better Auth), `/api/internal/signup`, `/api/internal/me`, `/health/ready` |
| Painel | `apps/web/src/auth/`, `layouts/AuthLayout.tsx`, `pages/LoginPage.tsx`, `pages/SignupPage.tsx`, `components/AuthShowcase.tsx` | Cliente `fetch` (sem biblioteca no navegador), contexto de sessão, rotas protegidas, telas no estilo da referência |

**Fluxo:**
1. O painel chama `/api/internal/me`. Sem sessão (401), mostra `/entrar`.
2. O login vai para `/api/auth/sign-in/email`, e o Better Auth grava o cookie `HttpOnly`.
3. O cadastro vai para `/api/internal/signup`, que cria conta e empresa e devolve o cookie.
4. "Sair" chama `/api/auth/sign-out`.

## 9. Integração global com a Evolution Go (2026-11-01)

| Peça | Onde | O que faz |
|---|---|---|
| Tabelas | `packages/db/src/schema/platform.ts` (migration `0001_platform`) | `platform.provider_servers` (servidor) e `platform.integration_credentials` (cofre) |
| Cofre | `apps/api/src/security/vault.ts` | AES-256-GCM com `SECRETS_MASTER_KEY`; contexto autenticado; só os 4 últimos caracteres saem para a tela |
| Cliente HTTP | `apps/api/src/integrations/evolution-client.ts` | Teste de conexão só de leitura (`GET /instance/all`), TLS verificado, sem redirecionamentos |
| Serviço | `apps/api/src/platform/evolution-settings.ts` | Ler, salvar (cifrando e revogando a chave anterior) e testar |
| Rotas | `apps/api/src/routes/platform.ts` | `/api/internal/platform/evolution` (GET, PUT) e `/evolution/test` (POST), só Super-Admin, com verificação de origem |
| Tela | `apps/web/src/pages/SettingsPage.tsx`, `src/platform/platform-api.ts` | Cartão "Integração global · Evolution Go" para o Super-Admin; "Em desenvolvimento" para os demais |

**Uso pelo módulo WhatsApp:** `resolveEvolutionIntegration` devolve o servidor ativo e a chave aberta do cofre, ou o estado
`missing`/`disabled`. A chave só é usada dentro da API (seção 10).

## 10. Módulo WhatsApp das empresas (2026-11-01)

Plano: `PLANO_MODULO_WHATSAPP.md`. Decisões: `DECISOES_TECNICAS.md` D-29 a D-35. Implementado contra a Evolution **simulada**;
a homologação no servidor real (W3) depende de autorização.

| Peça | Onde | O que faz |
|---|---|---|
| Tabela | `packages/db/src/schema/app.ts` (migration `0002_whatsapp`) | `app.whatsapp_instances` (esquema `app`, o primeiro de dados de empresa) e o limite `max_whatsapp_instances` em `identity.organizations` |
| Contratos | `packages/contracts/src/whatsapp.ts`, `phone.ts` | Caminhos, status, esquemas das respostas (só campos permitidos) e a regra de telefone do MVP |
| Adaptador | `apps/api/src/integrations/whatsapp-provider.ts` | `WhatsAppProvider` e a implementação para a Evolution Go: criar, buscar ID, conectar, QR, parear, status, desconectar, excluir. Erros reduzidos a 5 tipos com mensagem fixa |
| Serviço | `apps/api/src/whatsapp/whatsapp-service.ts` | Regras: limite, nome `dz_…`, token cifrado por instância, compensação se o banco falhar, status, exclusão lógica com token revogado |
| Rotas | `apps/api/src/routes/whatsapp.ts` e `platform.ts` | `/api/internal/whatsapp/instances` (empresa da sessão; owner/admin gerenciam) e `/api/internal/platform/whatsapp/instances` (Super-Admin, só leitura); origem verificada; limites de tentativas |
| Tela | `apps/web/src/pages/WhatsAppPage.tsx`, `src/whatsapp/whatsapp-api.ts` | Cartões das instâncias, nova instância, painel de conexão (QR e código), desconectar, excluir, tabela do Super-Admin |

**Fluxo de conexão:**
1. "Conectar" chama `POST …/:id/connect`. A API inicia a conexão na Evolution e devolve a imagem do QR.
2. A cada 3 s, o painel pede `GET …/:id/qr`. Depois de 2 minutos sem conexão, para e oferece tentar de novo.
3. Quando a Evolution informa "conectado", a API grava o status e o número (do `myJid`) e devolve o QR vazio, e o painel mostra
   "Conectado".
4. Na aba "Código de pareamento", o número é validado no painel e na API. O código de 8 caracteres aparece como `ABCD-1234`.

**Nunca saem da API:** chave global, token da instância, nome técnico `dz_…`, ID na Evolution e corpo das respostas da Evolution.

**Status atualizado (desde o uso real de 2026-11-01, D-38):** as listas consultam `GET /instance/all` numa chamada só. O
número conectado vem do `jid` (`/instance/all` ou `/instance/info/{id}`), porque o `/instance/status` não o traz.

## 11. Envio de Mensagens e Contatos (2026-11-01)

Decisões: `DECISOES_TECNICAS.md` D-36 a D-44. Testado contra a Evolution **simulada**.

| Peça | Onde | O que faz |
|---|---|---|
| Tabelas | `packages/db/src/schema/app.ts` (migrations `0003_messaging` e `0004_templates`) | `app.contact_lists` e `app.contacts` (um número por lista, chave composta com a empresa, exclusão definitiva); `app.media_files` (imagens em `bytea`) e `app.message_templates` (modelos: texto, variações, imagem da mesma empresa, CTA) |
| Contratos | `packages/contracts/src/messaging.ts` | Caminhos, limites, listas, entrada e resultado do envio (motivos fixos de falha) |
| Listas | `apps/api/src/messaging/contact-lists.ts` | Listar, ler, criar, substituir e excluir, validando cada telefone de novo; para a página Contatos: renomear, acrescentar, alterar e remover contatos (lista travada na transação) e buscar em todas as listas |
| Imagens e modelos | `apps/api/src/messaging/media.ts`, `templates.ts` | Imagem conferida pelos primeiros bytes, sem duplicar, base64 em memória para o disparo; modelos com CTA validado |
| Envio | `apps/api/src/messaging/send-text.ts` | Confere empresa e papel, abre o token da instância no cofre, chama `/send/text` e devolve só o motivo fixo |
| Rotas | `apps/api/src/routes/messaging.ts` | `/api/internal/contact-lists[/:id]` (com `PATCH` para renomear), `/contact-lists/:id/contacts` (`POST` acrescenta, `PATCH` altera), `/contact-lists/:id/contacts/remove`, `/contacts/search?q=`, `/api/internal/media[/:id]` (corpo = arquivo de imagem, até 5 MB), `/api/internal/message-templates[/:id]` e `/api/internal/messaging/send`; origem verificada; limites de tentativas; corpo de até 3 MB nas listas |
| Contatos | `apps/web/src/pages/ContactsPage.tsx`, `ContactListPage.tsx` | `/contatos`: resumo, busca nas listas e nos contatos de todas as listas, nova lista, excluir. `/contatos/:id`: renomear, excluir, adicionar (à mão ou Excel, salvo na hora), busca, 50 por página, editar, remover um ou vários |
| Tela | `apps/web/src/pages/SendMessagesPage.tsx`, `src/messaging/` | Assistente de 5 etapas portado do MVP; `ContactsStep` (listas salvas), `ContactAdder` (Manual / Excel, comum com a página Contatos), `MessageStep` (modelo salvo, 1 Imagem, 2 Mensagem, 3 CTA, variações e pré-visualização ao vivo num celular), `spreadsheet.ts` (SheetJS sob demanda), `message-format.tsx`, `messaging-api.ts` |

**Fluxo do disparo:**
1. O navegador percorre a lista.
2. Para cada contato, troca o `{nome}`, sorteia a variação e acrescenta a linha do CTA (`composeMessage`). Depois chama
   `POST /api/internal/messaging/send` com o ID da imagem, se houver: a API manda texto (`/send/text`) ou imagem com legenda
   (`/send/media`, base64).
3. Depois, espera um tempo aleatório entre o mínimo e o máximo, em fatias de 250 ms, para o "Parar" responder rápido.
4. Quando o motivo da falha pede (instância desconectada ou credencial recusada), ou depois de 5 falhas seguidas, o disparo para.
   Sair da página também interrompe.

**Nunca sai da API:** o token da instância. O navegador só conhece o ID da instância, o número do contato e o texto.
