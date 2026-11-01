# DisparaZap — SaaS (fundação técnica)

Fundação do futuro painel SaaS do DisparaZap: **monólito modular** com API, painel web e worker,
em TypeScript, num monorepo com npm workspaces. Esta é a **Fase 4**:
- não há autenticação, banco de dados, filas nem funcionalidades comerciais;
- nada aqui envia mensagens nem conecta a Evolution Go, Zernio ou MyLinksss.

O MVP local (raiz do repositório: `server.js`, `index.html`) é independente e não depende desta pasta.

## Requisitos

- Node.js **24.15 ou superior** (testado em 24.17; recomenda-se o 24.x mais recente).
- npm 11.
- Nenhum serviço externo: PostgreSQL, Redis e Docker **não** são necessários nesta fase.

## Instalação

```bash
cd saas
npm install
cp .env.example .env    # opcional: os padrões já funcionam
```

O `.env` do SaaS fica em `saas/.env`, é separado do `.env` do MVP e não é versionado.

## Executar (cada um num terminal)

| Comando | O que sobe | Endereço |
|---|---|---|
| `npm run dev:api` | API Fastify, reinicia ao salvar | `http://127.0.0.1:3100/health/live` |
| `npm run dev:web` | Painel React (Vite) | `http://127.0.0.1:5173` |
| `npm run dev:worker` | Worker (sem filas: só registra que está vivo) | — |

- O painel em desenvolvimento repassa `/health` e `/api` para a API local (proxy do Vite). Sem a API, o card
  "Status do ambiente" mostra **Indisponível**.
- Tudo escuta só em `127.0.0.1`.
- `Ctrl+C` encerra de forma controlada.

Versão compilada: `npm run build` e depois `npm run start -w @disparazap/api` (ou `@disparazap/worker`).

## Testes e verificações

| Comando | Faz |
|---|---|
| `npm test` | Todos os testes (Vitest): pacotes, API, worker e painel (jsdom) |
| `npm run typecheck` | TypeScript em pacotes, API, worker, painel e arquivos de teste |
| `npm run build` | Compila pacotes, API e worker (`tsc -b`) e gera o painel (`vite build`) |
| `npm run build:api` / `build:worker` / `build:web` | Build de cada aplicação |
| `npm run clean` | Remove as saídas do `tsc -b` |

- Os testes não acessam rede externa nem serviços reais.
- Os testes de inicialização sobem os processos de verdade, só em `127.0.0.1`.
- Os testes do SaaS usam o sufixo `.spec.ts(x)`, para o `npm test` da raiz (MVP) não os executar.

## Estrutura

```text
saas/
├── apps/
│   ├── api/       # Fastify: config, plugins (erros, logs, segurança), rotas /health e /api/v1
│   ├── web/       # React + Vite: layout, menu, páginas e componentes
│   └── worker/    # Processo de filas (vazio nesta fase)
├── packages/
│   ├── contracts/ # Contratos públicos (health check, erro RFC 9457) — usados por API e painel
│   └── shared/    # Só servidor: validação de ambiente, logger com redação, encerramento controlado
├── infra/docker/  # Reservado para o Docker Compose (ainda não criado)
└── docs/          # ESTRUTURA_TECNICA.md e DECISOES_TECNICAS.md
```

Detalhes em [docs/ESTRUTURA_TECNICA.md](docs/ESTRUTURA_TECNICA.md); escolhas e alternativas em
[docs/DECISOES_TECNICAS.md](docs/DECISOES_TECNICAS.md).

## Variáveis de ambiente

Ver [.env.example](.env.example). Todas têm padrão seguro; valores inválidos impedem a inicialização com
uma mensagem que cita a variável, sem repetir o valor.

## O que ainda não existe

Autenticação, Super Admin, empresas, banco de dados, migrations, filas, Docker Compose, integrações e
qualquer módulo de negócio. O painel marca essas seções como **Em desenvolvimento**.
Próxima fase prevista: **Fase 5 — banco de dados, autenticação e Super Admin** (aguardando autorização).
