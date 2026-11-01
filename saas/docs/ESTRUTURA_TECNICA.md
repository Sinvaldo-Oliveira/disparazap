# Estrutura técnica — SaaS DisparaZap (Fase 4)

| | |
|---|---|
| **Data** | 2026-10-31 |
| **Escopo** | Fundação técnica: API, painel web e worker sem funcionalidades de negócio |
| **Arquitetura de referência** | `docs/ARQUITETURA_SAAS.md` (raiz do repositório) |

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
| `apps/api/src/routes` | `health.ts` (`/health/live`) e `v1.ts` (prefixo `/api/v1`, sem rotas) | Expor rota sem autenticação, exceto health |
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

- **Rotas:** `/` (Visão Geral) e os módulos `/whatsapp`, `/campanhas`, `/contatos`, `/agentes-ia`, `/automacoes`,
  `/redes-sociais`, `/integracoes` e `/configuracoes`. Qualquer outra rota mostra "Página não encontrada".
- **Navegação:** cada item tem `status` (`available` / `in_development`), `permission` (para a Fase 5), `summary` (escopo
  planejado) e `plannedFor` (etapa do roteiro). `visibleNavigation(items, canView)` filtra por permissão; hoje `canView` libera tudo.
- **Visão Geral:**
  - aviso "Plataforma em construção";
  - status do ambiente: a **API é consultada de verdade** em `/health/live`, validada pelo contrato; worker, banco e filas
    aparecem com descrições fixas e verdadeiras ("sem verificação", "não conectado");
  - próxima fase;
  - lista dos módulos planejados.
- **Módulos:** página "Em desenvolvimento" com o escopo e a etapa prevista. Sem dados, formulários, tabelas ou ações.
- **Sem login, área de usuário ou estatísticas.**
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
| `apps/api/src/config/env.spec.ts` | 8 | Padrões seguros; origens CORS (curinga, caminho, barra, esquema); porta e nível inválidos sem ecoar valor |
| `apps/api/src/app/build-app.spec.ts` | 11 | Health e cabeçalhos; id de requisição; 404/500/400/413/415 em RFC 9457 sem detalhes internos; `/api/v1`; CORS; logs sem segredos; escuta em 127.0.0.1 |
| `apps/api/src/startup.spec.ts` | 2 | Processo real sobe e responde; configuração inválida impede o início |
| `apps/worker/src/worker.spec.ts` | 6 | Configuração; nenhuma fila; ciclo de vida sem timers pendentes; encerramento por sinal; processo real sobe e permanece ativo |
| `apps/web/src/app/App.spec.tsx` | 20 | Layout e menu; sem login; Visão Geral sem dados inventados; status da API (online/indisponível); os 8 módulos em desenvolvimento; navegação; 404; menu móvel; permissões |

**Total: 59 testes.** O `npm test` da raiz (MVP) não os executa: os nomes `*.spec.*` ficam fora do padrão de descoberta do `node --test`.
