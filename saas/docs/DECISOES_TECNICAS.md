# Decisões técnicas — SaaS DisparaZap

Registro das escolhas da fundação técnica (Fase 4, 2026-10-31), com as alternativas consideradas.
Decisões de produto e arquitetura geral ficam em `docs/DISPARAZAP_MASTER.md` e `docs/ARQUITETURA_SAAS.md` (raiz).

## Versões efetivamente utilizadas

| Item | Versão | Onde |
|---|---|---|
| Node.js (máquina de desenvolvimento) | 24.17.0 | Exigido: ≥ 24.15.0 (`engines`) |
| npm | 11.13.0 | — |
| TypeScript | 7.0.2 | Raiz (dev) |
| Fastify | 5.12.7 | `apps/api` |
| @fastify/cors | 11.3.1 | `apps/api` |
| Zod | 4.6.7 | `contracts`, `shared`, `api`, `worker` |
| pino | 10.4.0 | `shared`, `worker` |
| React / React DOM | 19.3.1 | `apps/web` |
| React Router | 8.5.1 | `apps/web` |
| lucide-react | 1.66.0 | `apps/web` (ícones) |
| Vite | 8.3.5 | `apps/web` (dev) |
| @vitejs/plugin-react | 6.1.2 | `apps/web` e raiz (dev) |
| Vitest | 5.0.5 | Raiz (dev) |
| jsdom | 30.1.3 | Raiz (dev) |
| @testing-library/react / dom | 16.3.3 / 10.4.2 | Raiz (dev) |
| @types/node | 24.19.2 | Raiz (dev), alinhado ao Node 24 |
| @types/react / react-dom | 19.3.0 | `apps/web` (dev) |

O `npm audit` não encontrou vulnerabilidades em 2026-10-31. As versões exatas estão em `saas/package-lock.json`.

---

## D-01 · Node.js 24
- **Decisão:** Node 24 (`engines >= 24.15.0`, exigência do jsdom 30).
- **Contexto verificado no calendário oficial:**
  - o Node 24 está em *Maintenance LTS* desde 2026-10-20, com suporte até 2028-04-30;
  - o Node 26 virou *Active LTS* em 2026-10-28;
  - a máquina de desenvolvimento usa 24.17.0, e o 24.x mais recente é 24.22.2.
- **Alternativa:** Node 26. Adiada: é LTS há 3 dias, e a fase não precisa de nada dele.
- **Pendência:** atualizar a máquina para o 24.x mais recente e avaliar o Node 26 antes da primeira implantação.

## D-02 · Monorepo com npm workspaces, isolado em `saas/`
- **Decisão:** `saas/` é um projeto npm independente, com lockfile próprio. A raiz (MVP) não declara workspaces.
- **Por quê:** a fase proíbe alterar o `package.json` da raiz; o MVP continua instalável e testável sozinho.
- **Alternativas:** pnpm ou Turborepo (ferramentas extras sem ganho no tamanho atual); workspaces na raiz (alteraria o MVP).

## D-03 · Worker como aplicação separada (`apps/worker`)
- **Decisão:** processo próprio, em vez de um segundo ponto de entrada dentro de `apps/api`, como previa a ARQUITETURA_SAAS §3.3.
- **Por quê:** pedido explícito da Fase 4. Dependências e ciclo de vida independentes, e escala separada na VPS.
- **Consequência:** o código comum vai para `packages/shared`.

## D-04 · TypeScript 7 com project references
- **Decisão:** TypeScript 7.0.2 (implementação nativa, estável desde 2026-07-08). `tsc -b` compila `contracts → shared → api/worker`.
- **Alternativa:** TypeScript 6.0.3 (última versão em JavaScript), mantida como plano de recuo. Não foi necessária: o build com
  references funcionou de primeira.
- **Regras do `tsconfig.base.json`:** `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`
  e `rewriteRelativeImportExtensions`.

## D-05 · Execução de TypeScript em desenvolvimento pelo próprio Node
- **Decisão:** `node --conditions=source --watch src/index.ts`, com o suporte nativo do Node 24 a TypeScript (remoção de tipos).
  Em produção, roda o JavaScript compilado (`dist/`).
- **Alternativa:** `tsx`. Seria uma dependência a mais, sem necessidade.
- **Restrição:** só sintaxe "apagável" (sem `enum`, `namespace` ou propriedades de parâmetro), garantida por `erasableSyntaxOnly`.

## D-06 · Pacotes com condição de exportação `source`
- **Decisão:** cada pacote exporta `source → src/index.ts` (desenvolvimento) e `types`/`default → dist/` (build).
- **Por quê:** desenvolvimento e testes não exigem build prévio; produção usa o JavaScript compilado.
- **Alternativa:** `paths` do TypeScript. Só afeta a checagem de tipos, não a execução.

## D-07 · Fastify 5 + Zod
- **Decisão:** Fastify para HTTP; Zod para configuração e contratos.
- **Alternativas:**
  - Express 5: sem validação nem tipagem nativas;
  - NestJS: estrutura pesada para a equipe atual.
- **Ainda não usado:** o provedor de tipos Zod para rotas (`fastify-type-provider-zod`). Entra com as primeiras rotas que recebem dados,
  para evitar abstração prematura.

## D-08 · Erros em RFC 9457 desde o início
- **Decisão:** toda resposta de erro é `application/problem+json` com título fixo por status e `requestId`.
- **Por quê:** a ARQUITETURA_SAAS §3.4 já previa esse formato para a API pública, e o contrato precisa ser estável desde a primeira rota.

## D-09 · Segurança da fundação
- **Rede:** escuta em `127.0.0.1` por padrão (API, Vite dev e preview).
- **CORS:** lista vazia por padrão; `*` recusado; em desenvolvimento, o painel usa o proxy do Vite (mesma origem).
- **Logs:** URL sem query string, sem cabeçalhos, com redação de campos sensíveis.
- **Erros:** sem stack ou mensagem interna para o cliente.
- **Requisições:** id gerado no servidor, sem confiar no cliente; `trustProxy: false` até existir o Caddy na frente.
- **Configuração:** erro de configuração cita a variável, nunca o valor.
- **Cabeçalhos:** feitos à mão (4 cabeçalhos) em vez de `@fastify/helmet`. A API só devolve JSON; o helmet entra quando a API servir HTML.

## D-10 · Painel React + Vite + React Router
- **Decisão:** SPA servida como estáticos (futuramente pelo Caddy, na mesma origem da API).
- **Alternativa:** Next.js. A renderização no servidor não traz ganho num painel totalmente atrás de login.
- **Componentes e estilo:** CSS global com tokens, sem biblioteca de componentes; ícones `lucide-react`.
- **Permissões:** cada item do menu declara `permission`; `visibleNavigation(items, canView)` é o ponto de integração com a autenticação.

## D-11 · Honestidade da interface
- Módulos não implementados mostram "Em desenvolvimento", o escopo planejado e a etapa do roteiro.
- Nada de números, contas, campanhas ou mensagens fictícias. Os testes verificam isso.
- O único status dinâmico é o da API, consultado de verdade.
- Sem tela, botão ou campo de login enquanto não existir autenticação real.

## D-12 · Testes com Vitest, nomeados `*.spec.*`
- **Decisão:** Vitest com dois projetos: `node` (pacotes, API e worker) e `web` (jsdom).
- **Nome dos arquivos:** o `npm test` da raiz usa a descoberta padrão do `node --test`, que no Node 24 também acha `*.test.ts`.
  O sufixo `.spec` mantém as duas suítes separadas.
- **Testes de inicialização:** sobem os processos reais com ambiente mínimo (só `PATH`/`SystemRoot`) e sem ler `.env`.
- **Limite no Windows:** sinais não são entregues a processos filhos. O encerramento controlado é testado com uma fonte de sinais simulada.

## D-13 · O que ficou de fora de propósito
- **Infraestrutura:** Docker Compose, PostgreSQL, Redis, BullMQ, Drizzle e Caddy. Planejados, sem arquivo nesta fase para não versionar infraestrutura não testada.
- **Qualidade de código:** ESLint e Prettier. Pendência de qualidade; não foram pedidos nesta fase.
- **Recursos de produto:** autenticação, rotas de negócio e integrações. Fases seguintes.
