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
| Zod | 4.6.7 | `contracts`, `shared`, `api`, `worker`, `web` (modo `jitless` no navegador, D-45) |
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
| better-auth / @better-auth/drizzle-adapter | 1.7.15 (exata) | `apps/api` — desde 2026-11-01 |
| @node-rs/argon2 | 2.2.2 (exata) | `apps/api` |
| drizzle-orm | 0.45.4 (exata) | `packages/db` |
| drizzle-kit | 0.31.11 (exata) | `packages/db` (dev) |
| pg (node-postgres) / @types/pg | 8.23.1 (exata) | `packages/db` |
| @electric-sql/pglite | 0.5.14 (exata) | `packages/db` (banco embutido de desenvolvimento e testes) |
| xlsx (SheetJS) | 0.20.3, do endereço oficial `cdn.sheetjs.com` (a mesma do MVP) | `apps/web` — importação de planilhas, desde 2026-11-01 (D-39) |

O `npm audit` não encontrou vulnerabilidades em 2026-10-31. Em 2026-11-01, ele aponta um alerta moderado
(GHSA-67mh-4wv8-2f99, servidor de desenvolvimento do esbuild) vindo do `drizzle-kit`, ferramenta só de desenvolvimento que não
usa esse servidor. A "correção" sugerida rebaixaria o `drizzle-kit` para a 0.18, por isso não foi aplicada. As versões exatas estão
em `saas/package-lock.json`.

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
  O banco passou a ser o Supabase Cloud (D-14).
- **Qualidade de código:** ESLint e Prettier. Pendência de qualidade; não foram pedidos nesta fase.
- **Recursos de produto:** autenticação, rotas de negócio e integrações. Fases seguintes.

---

## Fase 5A.2 (2026-11-01): banco no Supabase — planejamento

Detalhes, fontes e passo a passo em [SUPABASE_CONFIGURACAO.md](SUPABASE_CONFIGURACAO.md). **Nada foi criado nem instalado.**

## D-14 · PostgreSQL gerenciado pelo Supabase Cloud, em projeto exclusivo — **aprovada pelo dono do produto**
- **Decisão:** um **projeto Supabase novo e exclusivo** do DisparaZap, numa organização separada da do MyLinksss.
  - Região recomendada: `sa-east-1` (São Paulo).
  - O projeto do MyLinksss não é reutilizado, consultado nem modificado.
- **Substitui:**
  - o PostgreSQL local do Windows, avaliado na auditoria 5A.1;
  - o contêiner `postgres:17` previsto para a VPS no PLANO_IMPLANTACAO_HOSTINGER.
- **Uso do Supabase:** só como PostgreSQL. A Data API fica **desativada**; Storage, Realtime e Edge Functions não são usados.
- **Consequências:**
  - backups conforme o plano do Supabase;
  - conexões cobradas e limitadas pelo *compute*;
  - a ARQUITETURA_SAAS e o PLANO_IMPLANTACAO precisam ser atualizados (pendente de autorização).

## D-15 · Conexões por papel e por uso — proposta
- **API e worker:** **conexão direta** em produção, se a VPS tiver IPv6 (a confirmar). Sem IPv6, **pooler no modo sessão** ou
  add-on de IPv4.
- **Desenvolvimento:** **modo sessão**, porque a máquina de desenvolvimento não tem IPv6.
- **Migrations:** conexão direta ou modo sessão, nunca o modo transação.
- **Modo transação:** reservado para um eventual uso *serverless*. Exigiria `prepare: false` e proíbe estado de sessão.
- **Uma URL por papel:**
  - `DATABASE_URL` (`dz_app`);
  - `DATABASE_PLATFORM_URL` (`dz_platform`);
  - `DATABASE_MIGRATION_URL` (`dz_migrator`, nunca no ambiente da API);
  - `DATABASE_TEST_URL` e `DATABASE_TEST_MIGRATION_URL` (projeto de testes).
- **TLS:** sempre `sslmode=verify-full`, com o certificado em `DATABASE_CA_FILE`.

## D-16 · Papéis próprios e RLS forçado — proposta
- **Papéis:** `dz_migrator` (dono dos esquemas), `dz_app` e `dz_platform`, todos **sem `BYPASSRLS`**. `dz_auth` só se a D-18 for
  pela alternativa B.
- **Papéis do Supabase:** `postgres` (que tem `BYPASSRLS`) só na preparação inicial; `service_role` nunca.
- **RLS:** `ENABLE` e `FORCE ROW LEVEL SECURITY` em toda tabela de empresa, com políticas por operação `TO dz_app` e chaves
  estrangeiras compostas `(organization_id, id)`.
- **Contexto:** só por `set_config(..., true)` dentro de transação, pelo `withOrgContext`. Nunca `SET` de sessão, porque o pool
  reaproveita conexões.
- **Esquemas:** `identity`, `app`, `audit` e `drizzle`. Nunca `public` nem `auth` (este pertence ao Supabase Auth).

## D-17 · Drizzle num pacote próprio, com migrations manuais — proposta
- **Pacote:** `packages/db` (`@disparazap/db`), só de servidor.
- **Fluxo das migrations:**
  - SQL gerado por `drizzle-kit generate`, revisado e versionado;
  - aplicado manualmente com `drizzle-kit migrate` (testes → `disparazap` → produção);
  - `drizzle-kit push` proibido contra bancos remotos.
- **Reversão:** o Drizzle não tem migrations de volta, então correções entram como migrations novas.
- **SQL manual:** `FORCE RLS` e `GRANT`/`REVOKE` entram por `generate --custom`.
- **Versão:** a documentação atual instala a v1 candidata (`@rc`). Escolher na instalação, com versão exata travada.

## D-18 · Autenticação (D3 da ARQUITETURA_SAAS) — **decidida em 2026-11-01: Better Auth** (implementada; ver D-20 a D-24)
- **Comparação:** Supabase Auth × Better Auth, em SUPABASE_CONFIGURACAO §7.
- **Recomendação: Better Auth**, porque oferece:
  - sessão em cookie `HttpOnly`, revogável;
  - exemplo oficial com Fastify;
  - plugins de organização, 2FA com códigos de recuperação e administração;
  - dados no nosso PostgreSQL (esquema `identity`).
- **Condições:**
  - `argon2id`;
  - *cookie cache* desligado;
  - 2FA obrigatório para Super Admin, por regra nossa;
  - personificação desligada;
  - versão e licença conferidas na instalação.
- **Em qualquer alternativa:** é preciso um provedor de e-mail transacional.

## D-19 · Testes de integração num projeto Supabase de testes — proposta
- **Onde:** projeto descartável `disparazap-test` (Free).
- **Como:**
  - suíte `npm run test:db` separada; o `npm test` continua sem rede;
  - trava que impede rodar contra o banco de `DATABASE_URL`.
- **Substitui o Testcontainers** previsto na ARQUITETURA_SAAS §3.2/§10, que exige Docker, inviável nesta máquina.
- **Cobertura:** isolamento A×B, contexto em conexões reaproveitadas, permissões mínimas, chaves compostas, migrations
  repetíveis e ensaio de restauração.

---

## Autenticação (2026-11-01): implementação

O dono do produto pediu o sistema de autenticação com três tipos de usuário e deixou as escolhas técnicas a cargo do assistente.

## D-20 · Três tipos de usuário
- **Super-Admin** (`super_admin`):
  - papel global em `identity.users.platform_role`, sem empresa;
  - nunca vem do navegador (campo com `input: false` e `CHECK` no banco).
- **Admin-Empresa** (`company_admin`):
  - quem se cadastra pela tela "Criar conta";
  - a empresa nasce junto, com ele como `owner`.
- **Admin-MyLinksss** (`mylinksss_admin`):
  - conta e empresa com `origin = 'mylinksss'`;
  - existe no modelo, mas ainda não há como entrar por esse caminho (depende da integração de login com o MyLinksss).
- **Papéis dentro da empresa:** `owner`, `admin`, `operator`, `viewer` (ARQUITETURA_SAAS §4.2), no plugin de organizações do
  Better Auth.

## D-21 · Super-Admin criado por comando, com e-mail reservado
- **Como:** `npm run admin:create` lê `SUPER_ADMIN_EMAIL` e pede nome e senha no terminal. A senha não aparece na tela e só fica
  como hash.
- **E-mail reservado:** o cadastro público recusa esse e-mail, com a mesma mensagem dada a um e-mail já usado.
- **Conta comum existente:** não é promovida, porque quem a criou pode não ser o dono do e-mail.
- **Pedido "mesmo Super-Admin do MyLinksss":** atendido usando o mesmo e-mail. A senha do MyLinksss **não** é copiada para o
  DisparaZap. Entrar com a própria conta do MyLinksss depende da integração de login (pendente).

## D-22 · Banco embutido (PGlite) no desenvolvimento e nos testes
- **Decisão:**
  - sem `DATABASE_URL`, a API usa o PGlite (PostgreSQL 17 em WASM, dentro do processo), em `saas/.data/pglite`, ignorada pelo git;
  - os testes o usam em memória;
  - só ele recebe migrations automáticas.
- **Por quê:** permite desenvolver e testar a autenticação sem serviço externo e sem tocar no Supabase. Não é o PostgreSQL local
  do Windows, cujo uso foi descartado na 5A.2.
- **Limites:**
  - aceita um processo por vez (por isso o comando do Super-Admin se recusa a rodar com a API ligada);
  - inicialização lenta numa máquina sobrecarregada (de 12 a 20 s medidos);
  - proibido em produção, onde a configuração exige `DATABASE_URL`.

## D-23 · Driver `pg` com TLS sempre verificado
- **Driver:** node-postgres (`pg` 8.23.1), maduro e suportado pelo Better Auth. Em vez dele, o postgres.js 4.0 tinha acabado de
  sair.
- **TLS:**
  - com `DATABASE_URL`, `DATABASE_CA_FILE` é obrigatório, com `rejectUnauthorized: true`;
  - os parâmetros `sslmode` da URL são removidos para não sobrescreverem o certificado;
  - o `drizzle.config.ts` faz o mesmo nas migrations.
- **Erros:** se a abertura do banco falhar, a mensagem não traz detalhes do driver, que podem conter o endereço.

## D-24 · Segurança da sessão
- **Cookie:**
  - `dz.session_token`, `HttpOnly` e `SameSite=Lax`;
  - `Secure` e prefixo `__Secure-` em produção;
  - sem *cookie cache*, para que a revogação valha na hora;
  - validade de 7 dias, renovada uma vez por dia de uso.
- **Proteção de origem/CSRF:** forçada com `disableOriginCheck: false` e `disableCSRFCheck: false`, porque a biblioteca a desliga
  sozinha em ambiente de teste.
- **Token de sessão:** removido do corpo das respostas; o painel não usa o cliente JavaScript do Better Auth (usa `fetch`).
- **IP para o limite de tentativas:** cabeçalho interno preenchido pela API a partir do socket. O valor enviado pelo cliente é
  descartado.
- **Senhas:** argon2id, com 19 MiB de memória, 2 iterações e 1 linha de execução (OWASP); mínimo de 12 caracteres.
- **Ainda não feito (D-24):**
  - 2FA do Super-Admin;
  - recuperação de senha e verificação de e-mail (dependem de um provedor de e-mail);
  - papel `dz_auth` separado no Supabase;
  - a origem da requisição atrás do Caddy (`trustProxy`) será ajustada na implantação.

---

## Integração global com a Evolution Go (2026-11-01)

## D-25 · Chave global da Evolution Go informada na tela e guardada cifrada no banco — **revê a ARQUITETURA_SAAS §8.4**
- **Antes:** a §8.4 previa a chave global "somente em segredo do servidor; nunca no banco".
- **Agora:**
  - o dono do produto pediu os campos da integração na página Configurações do Super-Admin;
  - a chave é guardada em `platform.integration_credentials`, **cifrada com AES-256-GCM**;
  - a chave-mestra (`SECRETS_MASTER_KEY`) fica fora do banco, no `saas/.env`, e é obrigatória em produção;
  - é a mesma proteção já prevista para tokens de instância e credenciais da Zernio.
- **Garantias:**
  - quem tiver só o banco não lê a chave;
  - a chave nunca volta para o navegador (só os 4 últimos caracteres);
  - trocar a chave revoga a anterior;
  - o contexto autenticado impede usar o valor cifrado como outro tipo de credencial.
- **Riscos assumidos:** perder a chave-mestra torna as credenciais ilegíveis (é preciso informá-las de novo); a rotação de
  versão da chave-mestra ainda não foi implementada.

## D-26 · Teste de conexão só de leitura e sem repassar a resposta
- **Chamada:** `GET {URL}/instance/all` com a chave global, a mesma chamada que o MVP já usa. Não cria nem altera nada na
  Evolution Go.
- **Rede:**
  - HTTP nativo do Node, com `rejectUnauthorized: true`;
  - sem seguir redirecionamentos (a chave vai no cabeçalho);
  - 10 s de tempo-limite e resposta de até 1 MB.
- **Resposta à tela:** só um estado (`ok`, `unauthorized`, `unreachable`, `invalid_response`, `error`), uma mensagem fixa e a
  contagem de instâncias. Nunca o corpo da Evolution, a URL ou a chave.
- **Endereço aceito:** http/https, sem usuário/senha, parâmetros ou âncora. Exige https, salvo para esta máquina ou para um
  nome interno sem ponto (serviço do Docker), porque a chave trafega no cabeçalho.

## D-27 · Verificação de origem nas rotas do painel
- **Regra:** pedidos que alteram dados em `/api/internal/*` (cadastro e plataforma) exigem cabeçalho `Origin` da lista
  confiável (`AUTH_BASE_URL` + `AUTH_TRUSTED_ORIGINS`).
- **Por quê:** complementa o `SameSite=Lax` do cookie. As rotas do Better Auth já tinham verificação própria; as nossas não.

## D-28 · O `vite.config.ts` não usa o `loadEnv` do Vite
- **Motivo:** o `loadEnv` aplica o `NODE_ENV` do `saas/.env` (`development`) ao `vite build`, que passou a gerar build de
  desenvolvimento.
- **Solução:** a configuração lê só as variáveis `WEB_*`, com `util.parseEnv` do Node, que não altera o ambiente do processo.
- **Conferência:** depois de cada build, verificar que o bundle não contém `jsxDEV`.

---

## Módulo WhatsApp das empresas (2026-11-01)

Plano aprovado: `PLANO_MODULO_WHATSAPP.md`. Implementado contra a Evolution **simulada**; a homologação real (W3) depende de
autorização.

## D-29 · Rotas da Evolution Go confirmadas no Swagger da versão instalada
- **Fonte:** `/swagger/doc.json` do servidor, lido sem chave (etapa W1). O `doc_evolution_go.md` diverge em dois pontos:
  - **desconectar** existe como `DELETE /instance/logout` (a documentação não mostrava);
  - **excluir** é `DELETE /instance/delete/{instanceId}`, **pelo ID**. Por isso o ID devolvido na criação é guardado
    (`provider_instance_id`). Se ele não vier, é buscado em `/instance/all`.
- **Respostas não tipadas** (`gin.H`): o adaptador aceita camelCase ou PascalCase, só usa os campos de que precisa e trata o
  resto como "resposta inesperada".
- **Alternativa descartada:** seguir só a documentação em Markdown. O delete por nome falharia no servidor real.

## D-30 · Nome técnico e token próprio por instância
- **Nome na Evolution:** `dz_<8 caracteres da empresa>_<10 hexadecimais aleatórios>`.
  - Não colide entre empresas nem com as instâncias do MVP.
  - O banco recusa nomes sem o prefixo `dz_` (`CHECK`) e repetidos no mesmo servidor (índice único).
- **Token da instância:**
  - 32 bytes aleatórios gerados pelo DisparaZap;
  - guardado cifrado no cofre (`kind = instance_token`, com a empresa), com o ID da instância no contexto autenticado
    (`evolution_go:instance_token:<id>`): o valor cifrado de uma instância não serve para outra;
  - nunca sai da API.
- **Sem meio-termo:** se a gravação no banco falhar depois de a Evolution criar a instância, a API a exclui na Evolution
  (compensação).

## D-31 · Status por consulta periódica, sem webhooks nesta etapa
- **Motivo:** webhooks exigem a API num endereço público (VPS), que ainda não existe. A conexão é iniciada com corpo vazio, sem
  `webhookUrl`.
- **Como funciona:**
  - enquanto aguarda conexão, o painel consulta o QR ou o status a cada 3 s, por no máximo 2 minutos;
  - o status também é atualizado ao abrir a tela.
- **QR e código de pareamento:** repassados só à empresa dona e só enquanto ela aguarda conexão. Nunca são gravados no banco
  nem no log.
- **Depois:** com a VPS, webhooks assinados substituem a consulta (ARQUITETURA_SAAS §5.3).

## D-32 · Permissões, isolamento e limite
- **Empresa:** sempre a da sessão (empresa ativa ou a primeira participação), nunca enviada pelo navegador.
  - Instância de outra empresa responde **404**, igual a uma inexistente.
- **Papéis:**
  - `owner` e `admin` criam, conectam, desconectam e excluem;
  - `operator` e `viewer` só listam e consultam o status.
- **Super-Admin:** lista geral só de leitura. Sem empresa própria, recebe 403 nas rotas das empresas.
- **Limite:** `identity.organizations.max_whatsapp_instances`, padrão 1 (decisão W1), de 0 a 100. Ainda não há tela para
  ajustá-lo.
- **Isolamento no banco:** o RLS entra com o Supabase (D-16). Até lá, o isolamento depende da API e é coberto pelos testes A×B.

## D-33 · Limites de tentativas em memória
- **Classe:** `RateLimiter` (janela deslizante, por chave), em memória.
- **Limites:**
  - QR: 60 por minuto por instância;
  - pareamento: 5 a cada 10 minutos por instância;
  - criação: 10 por hora por empresa;
  - cadastro: 10 a cada 10 minutos por IP.
- **Limitação aceita:** vale por processo e zera ao reiniciar. Com mais de um processo da API, passa para o Redis (D5,
  pendente).
- **Alternativa:** `@fastify/rate-limit`. Não adotada para não acrescentar dependência por quatro contadores simples.

## D-34 · Correções da auditoria do login (A1, A3, A4, A5)
- **A1:**
  - `/get-session` e `/list-sessions` do Better Auth ficam desligadas (devolviam o token da sessão);
  - o proxy `/api/auth/*` retira `token` do primeiro nível das respostas JSON;
  - o painel usa `/api/internal/me`.
- **A3:** limite de tentativas no cadastro (D-33).
- **A4:** em desenvolvimento, se `AUTH_BASE_URL` usa `127.0.0.1`, o equivalente `localhost` na mesma porta também é confiável.
  Em produção, só a lista configurada vale.
- **A5:** as rotas de convite do plugin de organizações ficam desligadas até existir verificação de e-mail (provedor de e-mail
  pendente).

## D-35 · Regra de telefone copiada do MVP para `packages/contracts`
- **Motivo:** o pareamento exige o número com DDI, e a regra já validada é a do `phone.js` do MVP. Como os projetos não
  importam código um do outro, ela foi portada fielmente para `packages/contracts/src/phone.ts`, usada pela API e pelo painel.
- **Risco aceito:** duas cópias da mesma regra. Mudanças futuras precisam ser feitas nas duas, até o MVP ser desativado.
- **Atualização (2026-11-01):** a cópia voltou a devolver `code` e `reason` como a do MVP, usados para resumir as linhas ignoradas
  de uma planilha.

---

## Envio de Mensagens e uso real do WhatsApp (2026-11-01)

## D-36 · O disparo roda na aba do navegador, uma chamada à API por mensagem
- **Pedido:** trazer o disparador do MVP para dentro do painel, no modelo SaaS.
- **Como funciona:**
  - o laço de envio, os intervalos e o "Parar" ficam no navegador, como no MVP;
  - cada mensagem é um `POST /api/internal/messaging/send` com instância, número e texto;
  - a API confere a empresa e o papel, valida o número de novo, abre o token da instância no cofre e chama
    `POST /send/text` da Evolution.
- **Por quê:** é o comportamento que o dono do produto já usa e pediu para trazer; não depende de fila (D5, pendente) nem de
  serviço novo.
- **Limitações aceitas:**
  - sair da página ou fechar a aba interrompe o envio (a tela avisa e o navegador pede confirmação para fechar);
  - não há histórico gravado dos envios.
- **Proteções no servidor:**
  - 60 envios por minuto por instância (o intervalo mínimo do painel é 1 s);
  - falhas da Evolution viram um motivo fixo:
    - `instance_disconnected` e `instance_unauthorized` interrompem o disparo;
    - `invalid_number`, `unreachable` e `failed` deixam seguir, mas o painel para depois de 5 falhas seguidas;
  - número e texto não vão para o log.
- **Alternativa adiada:** disparo no servidor (worker e fila), que continua com a página fechada e guarda histórico. É o módulo
  **Campanhas** (etapa 9 da ARQUITETURA_SAAS).
- **Tempo de resposta incerto:** se a Evolution não responder a tempo, o envio conta como `unreachable` e **não é repetido**. A
  mensagem pode ter saído (ARQUITETURA_SAAS §5.1).

## D-37 · Listas de contatos por empresa
- **Tabelas:**
  - `app.contact_lists`: nome único por empresa, sem diferenciar maiúsculas;
  - `app.contacts`:
    - chave primária `(list_id, phone_e164)`: um número por lista;
    - chave estrangeira composta `(organization_id, list_id)`: o contato só aponta para lista da mesma empresa;
    - `CHECK` de 10 a 15 dígitos.
- **Gravação:** o painel envia a lista inteira (criar ou substituir). A API valida cada telefone de novo, tira repetidos e
  informa quantas linhas descartou.
  - Inserção em blocos de 1.000, por causa do limite de parâmetros do PostgreSQL.
  - Limite de corpo de 3 MB só nessas rotas (o geral da API é 1 MB).
- **Limites:** 10.000 contatos por lista, 100 listas por empresa, nome do contato até 120 caracteres.
- **Exclusão definitiva** (sem `deleted_at`): contato é dado pessoal (LGPD).
- **Papéis:** `owner`, `admin` e `operator` salvam e enviam; `viewer` só vê.
- **Ainda não:** consentimento e descadastro (D6). Ficam com o módulo Contatos.
- **Migration `0003_messaging`:** o `drizzle-kit` gerou a chave estrangeira composta antes do índice único que ela referencia. A
  ordem foi corrigida à mão no SQL; no PostgreSQL, a versão gerada falharia.

## D-38 · Status das instâncias sincronizado com o servidor; formatos lidos no código-fonte da Evolution Go
- **Problema visto no uso real:** a conexão concluída depois dos 2 minutos de acompanhamento ficava "Conectando" para sempre, e
  o número nunca aparecia.
- **Status:** as listas (empresa e Super-Admin) consultam `GET /instance/all` numa chamada só e gravam o que mudou.
  - Falha da Evolution não quebra a lista: fica o último status conhecido.
  - Fora de uma conexão em andamento, "não conectado" vira "Desconectado". "Aguardando conexão" (nunca conectada) não muda.
- **Número:** sai do `jid` do modelo `Instance`, em `/instance/all` e `/instance/info/{id}`. O `/instance/status` só tem
  `Connected`, `LoggedIn` e `Name`.
- **Formatos confirmados no código-fonte público (pkg/instance e pkg/sendMessage), sem tocar no servidor:**
  - status `{ data: { Connected, LoggedIn, Name } }`;
  - QR `{ data: { qrcode, code } }`;
  - pareamento `{ data: { PairingCode } }`;
  - envio `{ data: { Info: { ID } } }`;
  - falhas de envio como HTTP 500 com `{"error": "..."}`, por exemplo "no active session found" e
    "… is not registered on WhatsApp".
  - O adaptador classifica esse texto e nunca o repassa.
- **Simulador dos testes:** passou a usar esses formatos, num arquivo comum (`apps/api/src/testing/evolution-simulator.ts`) fora
  do build de produção.

## D-39 · SheetJS no painel, carregado sob demanda
- **Versão:** a mesma do MVP, 0.20.3, do endereço oficial `cdn.sheetjs.com`. O npm público só tem a 0.18.5, com falhas
  conhecidas.
- **Integridade:** o hash fica no `package-lock.json`.
- **Carregamento:** `import('xlsx')` só quando alguém importa uma planilha, num arquivo separado (≈ 490 kB). O painel principal
  não cresce por isso.
- **A leitura acontece no navegador,** como no MVP. A API recebe só nome e telefone e valida tudo de novo.
- **Limites:** só `.xlsx`/`.xls`, até 10 MB.
- **Alternativa descartada:** carregar o script do CDN a cada uso, como o MVP. Isso pôs código de terceiros sem verificação de
  integridade dentro de um painel com sessão.

## D-40 · "Quem está agindo" numa peça comum
- **Peça:** `apps/api/src/auth/member.ts`, que resolve empresa e papel a partir da sessão (sem empresa → 403) e define
  `canManage` (owner, admin) e `canOperate` (owner, admin, operator).
- **Usada por:** WhatsApp e Envio de Mensagens.
- **Por quê:** a mesma regra estava escrita dentro das rotas do WhatsApp; módulos novos não devem copiá-la.

## D-41 · Imagem da mensagem guardada no banco e enviada em base64
- **Fonte:** código-fonte da Evolution Go. Em `/send/media`, um `url` que não começa com http(s) é lido como base64 puro.
- **Consequência:** a imagem não precisa de endereço público. A API local (127.0.0.1) não seria alcançável pelo servidor
  Evolution, e não há armazenamento de arquivos configurado.
- **Tabela:** `app.media_files` (`bytea`, coluna personalizada no Drizzle), até 5 MB, JPEG/PNG/WebP (os formatos de imagem que a
  Evolution aceita).
- **Recebimento:**
  - o corpo é o próprio arquivo (`image/*`, interpretado só nas rotas de mensagens);
  - o tipo é conferido pelos primeiros bytes;
  - o mesmo arquivo (sha256) não duplica;
  - até 200 por empresa.
- **Envio:**
  - uma imagem por mensagem, com o texto como legenda (escolha do dono do produto);
  - as 8 imagens mais recentes ficam em memória em base64, já que a imagem gravada nunca muda;
  - 60 s de tempo-limite.
- **Alternativa adiada:** armazenamento de objetos (ex.: Supabase Storage) com endereço assinado, quando houver servidor público.
- **Pendente:** limpeza das imagens que nenhum modelo usa.

## D-42 · CTA como link no fim do texto; modelos de mensagem por empresa
- **CTA:**
  - texto + link, acrescentados como última linha (`👉 Texto: link`) por `composeMessage`, em `packages/contracts`;
  - a mesma função serve à pré-visualização e ao envio;
  - link só http/https, sem espaços.
- **Por que não botão:**
  - o `/send/button` (`cta_url`) não aceita imagem junto: a imagem só vale como cabeçalho de botões de resposta;
  - exige título e rodapé;
  - pode não aparecer em alguns aparelhos;
  - o dono do produto escolheu o link no texto.
- **Modelos (`app.message_templates`):**
  - texto, variações (`jsonb`), imagem e CTA;
  - nome único por empresa;
  - a imagem só pode ser da mesma empresa (chave estrangeira composta, `ON DELETE RESTRICT`);
  - CTA completo ou ausente (`CHECK`);
  - até 100 por empresa;
  - `owner`, `admin` e `operator` gravam; `viewer` só usa.
- **Migration `0004_templates`:** a ordem gerada pelo `drizzle-kit` (chave composta antes do índice) foi corrigida à mão, como na
  0003.

## Página Contatos (2026-11-01)

## D-43 · Gestão das listas por alterações pequenas, gravadas na hora
- **Por quê:** na página Contatos a pessoa adiciona, corrige e remove um contato de cada vez. Mandar a lista inteira a cada
  mudança (como no Envio de Mensagens) gastaria o limite de gravações, pesaria em listas de 10.000 contatos e apagaria a
  mudança de outra pessoa feita ao mesmo tempo. Um botão "Salvar alterações" arriscaria perder trabalho ao trocar de página,
  porque o roteador declarativo do painel não bloqueia a navegação.
- **Como:**
  - rotas próprias para renomear, acrescentar, alterar e remover;
  - cada uma trava a lista (`SELECT … FOR UPDATE`) durante a transação;
  - acrescentar ignora conflitos (`ON CONFLICT DO NOTHING`) e continua as posições depois da última;
  - a substituição completa (`PUT`) continua para o Envio de Mensagens.
- **Telefone:** sempre no corpo do pedido, nunca no caminho da URL, que vai para o log. A busca usa `GET ?q=` porque o log
  descarta a query string (`pathOnly`).
- **Limites:** gravações em lote (criar, substituir, renomear, acrescentar, excluir) seguem em 30 por minuto por empresa.
  Alterar ou remover contatos avulsos tem um limite próprio, de 120 por minuto.

## D-44 · Busca de contatos
- **No servidor, em todas as listas:**
  - parte do nome sem diferenciar maiúsculas (`ILIKE`) ou, a partir de 3 dígitos, parte do telefone;
  - `%`, `_` e `\` escapados;
  - a consulta parte das listas da empresa (com índice) e junta os contatos pela chave da lista;
  - até 50 resultados, com aviso quando há mais.
- **No painel:**
  - dentro de uma lista, a busca é local (a lista já está carregada) e não diferencia acentos;
  - o filtro das listas pelo nome também é local.
- **Ainda não:**
  - busca sem acentos no servidor (`unaccent`) e índice de texto (`pg_trgm`), a decidir com o Supabase;
  - no banco embutido, essas extensões não estão ligadas.
- **Componente comum:** `ContactAdder` (Manual / Excel) serve ao Envio de Mensagens e à página Contatos. Ele valida a regra de
  telefone e tira repetidos antes de entregar os contatos; quem o usa decide se grava na hora ou só na tela.

## Publicação na Hostinger (2026-11-01)

## D-45 · Um processo só no aplicativo Node.js da Hostinger
- **Contexto:**
  - o dono do produto escolheu o aplicativo Node.js do hPanel (Business ou Cloud), com Supabase;
  - a documentação oficial: Node 24 disponível, entrada por um arquivo, porta em `PORT`, arquivos trocados a cada publicação
    e nenhum terminal.
- **API e painel no mesmo processo e na mesma origem:**
  - `WEB_DIST_DIR` liga a entrega do painel pela API;
  - em desenvolvimento continua vazio (o Vite serve o painel).
- **Arquivos do painel em memória, sem `@fastify/static`:**
  - o plugin oficial traz o `glob`, com alerta moderado no `npm audit`;
  - o painel são poucos arquivos fixos: lidos na inicialização e entregues por comparação exata do caminho;
  - assim não há como sair da pasta, e o painel não precisa de dependência nova.
- **CSP do painel:**
  - `default-src 'self'`, `script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`;
  - imagens também de `data:` (ícone) e `blob:` (pré-visualização);
  - estilos com `'unsafe-inline'`, por segurança dos estilos do React;
  - o Zod roda em modo `jitless` no navegador para não tentar `eval`.
- **Proxy:**
  - `API_TRUST_PROXY=true` aceita o `X-Forwarded-For` só de endereços internos (revisto em D-47): vale o IP que o proxy
    viu, não o que o visitante escreveu;
  - HSTS em produção.
- **Escuta:**
  - o padrão do código continua `127.0.0.1`;
  - no modelo da Hostinger, `API_HOST=0.0.0.0` vem como variável, porque a documentação não diz por qual interface o proxy
    deles chega;
  - o painel tem login e o acesso de fora passa pelo HTTPS da Hostinger.
- **Pacote (`npm run pacote:hostinger`):**
  - código já compilado; os imports `@disparazap/*` viram caminhos relativos, sem workspaces nem links no servidor;
  - dependências descobertas pelos imports do código, nas versões instaladas, com `package-lock.json`;
  - o empacotador falha se alguma dependência não estiver declarada, se as partes discordarem de versão ou se aparecer
    `.env`, chave privada ou mapa de código-fonte.
- **Operações de produção a partir do computador do dono do produto:** sem terminal na Hostinger, `producao:migrar` e
  `producao:admin` leem `saas/.env.producao` (ignorado pelo git).
  - Mostram só o servidor, nunca usuário, senha ou string de conexão.
  - As migrations pedem a confirmação `APLICAR`.
  - As migrations continuam manuais (SUPABASE_CONFIGURACAO §5); a API nunca as aplica sozinha num PostgreSQL.
- **Certificado do banco:** vai dentro do pacote (`certs/`, só certificado público), porque os arquivos do servidor são
  trocados a cada publicação.
- **Fica para depois:**
  - papéis separados e RLS no Supabase;
  - o worker (sem filas);
  - VPS (PLANO_IMPLANTACAO_HOSTINGER), se a escala pedir.

## Integração com a Zernio (2026-11-02)

## D-46 · Conta Zernio própria por empresa, com adaptador próprio
- **Modelo (decisão Z1 do dono do produto):** cada empresa liga a **própria** conta Zernio com a própria chave. A cobrança, o
  limite de pedidos e o risco de suspensão da Zernio ficam separados por empresa (REFERENCIA_ZERNIO §2).
- **Adaptador próprio, sem o SDK `@zernio/node`:**
  - usamos 8 rotas;
  - o SDK está na versão 0.2.x e muda quase todo dia;
  - o adaptador reaproveita o `httpRequest` do projeto (TLS sempre verificado, sem redirecionamento, limite de tamanho e
    tempo).
- **Endereço fixo:** a empresa informa só a chave, nunca uma URL. O DisparaZap não vira ponte para outros endereços.
- **Perfil:** um por empresa na conta Zernio dela, com `externalId` = id da empresa.
  - É reaproveitado se já existir; o conflito de nome ganha um sufixo.
  - Os outros perfis da conta não são tocados (decisão Z4).
- **Contas lidas na hora:** nada das redes é copiado para o banco nesta etapa.
  - Só contam as contas do perfil da empresa, mesmo que a resposta traga outras.
  - A saúde (`/accounts/health`) só é pedida para a tela.
- **Volta da autorização:**
  - o `redirect_url` leva `dz=<rede>.<validade>.<assinatura>`;
  - a assinatura é HMAC-SHA256 com subchave HKDF do cofre (`vault.sign`), sobre empresa + usuário + rede + validade de 15
    minutos;
  - é curto por causa do limite de 258 caracteres do X;
  - na volta, a API confere com a sessão e **relê as contas na Zernio**;
  - o texto de erro que vem na URL é ignorado: só o código vira uma mensagem fixa (`Object.hasOwn`).
- **Chave guardada:**
  - cofre com contexto `zernio:api_key:<empresa>`;
  - trocar a chave apaga a anterior;
  - gravações simultâneas não dão erro (inserir ou travar a linha);
  - a recusa da Zernio marca a integração como `invalid`, e ela volta a `active` quando a chave funciona;
  - remover a chave não mexe na conta da Zernio.
- **Papéis e limites:**
  - dono e administradores alteram; os demais veem;
  - o papel é conferido antes do limite de tentativas, então quem não pode alterar não gasta o limite da empresa.

## D-47 · `API_TRUST_PROXY` só confia em proxy interno (revê D-45)
- **Problema** (apontado pela revisão de código): confiar no último salto valia para qualquer conexão. Com
  `API_HOST=0.0.0.0`, quem chegasse direto na porta podia escolher o próprio IP e escapar dos limites de login e cadastro.
- **Agora:**
  - `true` aceita o `X-Forwarded-For` só quando quem conecta é um endereço interno (`loopback`, `linklocal`,
    `uniquelocal`), onde fica o proxy da hospedagem;
  - também aceita a lista exata de IPs/CIDRs do proxy;
  - `false` continua o padrão.
- **Se a hospedagem usar proxy em endereço público:** os visitantes apareceriam todos com o IP do proxy. Nesse caso, informe
  o IP do proxy na lista.

## Redes Sociais (2026-11-03)

Plano aprovado: `PLANO_MODULO_REDES_SOCIAIS.md` (decisões R1 a R10 com as recomendações). Nenhuma dependência nova.

## D-48 · Espelho local das publicações, com a Zernio como fonte da verdade
- **Tabela `app.social_posts`** (migration `0006_social`): uma linha por publicação da empresa na Zernio.
  - Guarda situação, texto, horários, redes de destino (`targets`, JSON) e imagens (`media`, JSON).
  - Guarda também quem criou pelo painel (a Zernio não conhece os usuários do DisparaZap) e a chave de idempotência.
- **Por que espelhar:**
  - calendário, histórico e Visão Geral leem do banco, sem gastar o limite da Zernio (60 pedidos/min com até 2 redes);
  - se a Zernio estiver fora do ar, a tela mostra o último estado conhecido, com aviso.
- **Sincronização incremental:** `GET /v1/posts?profileId&updatedSince` ao abrir as telas.
  - No máximo uma a cada 30 s por empresa (5 s com "Atualizar"), com folga de 1 min contra relógios diferentes.
  - A primeira janela cobre 90 dias.
  - A marca fica em `zernio_connections.posts_synced_at`.
  - Publicações criadas direto na Zernio, no perfil da empresa, entram como "criadas fora do DisparaZap".
  - Publicação excluída lá some daqui ao abrir os detalhes (a Zernio não devolve excluídas no `updatedSince`).
- **Idempotência:** o painel gera um `requestId` (UUID) por formulário, e ele vira a `Idempotency-Key` do `POST /v1/posts`.
  - O mesmo pedido de novo responde com a publicação já gravada, sem chamar a Zernio.
  - Erro de passagem (rede, 5xx, tempo esgotado) repete uma vez com a mesma chave, e a Zernio devolve o post original.
  - Se ainda falhar, a tela pede para conferir o Histórico antes de tentar de novo.
- **Mensagens fixas por categoria de erro** (`errorCategory` da Zernio → `SOCIAL_ERROR_MESSAGES`, decisão R6). O
  `errorMessage` da rede nunca é lido.
- **Isolamento:**
  - cada empresa usa a própria chave;
  - as listas são filtradas pelo perfil da empresa;
  - toda ação exige a publicação no espelho da empresa (404);
  - as contas de cada post são relidas na Zernio e conferidas contra o perfil antes de publicar.

## D-49 · Fuso horário da empresa e datas sem biblioteca
- **Coluna `identity.organizations.timezone`** (IANA, padrão `America/Sao_Paulo`), alterada por dono e administradores (R3).
- **Contrato `packages/contracts/src/timezone.ts`** (só `Intl`, no navegador e no Node): converte "AAAA-MM-DDTHH:mm" no fuso da
  empresa para o instante e o contrário, inclusive na mudança de horário de verão.
- **O painel manda a hora local; a API converte e manda à Zernio** o instante com `Z` e também o `timezone`. A documentação
  da Zernio diverge sobre o fuso padrão sem `timezone` (REFERENCIA_ZERNIO §10).
- **Calendário próprio** (grade de mês, semana e dia em CSS), sem biblioteca nova. Os dias são chaves "AAAA-MM-DD"; o fuso
  só entra ao converter para instantes.
- **Reagendar só a data** (`POST /posts/:id/reschedule`) manda à Zernio apenas `scheduledFor` e `timezone`. Um `PUT` completo
  poderia apagar opções que o painel não tem (ex.: pasta do Pinterest de um post criado na Zernio).

## D-50 · Imagens: biblioteca no banco, envio à Zernio pelo servidor; vídeo depois
- **A biblioteca é a mesma `app.media_files` do Envio de Mensagens** (JPG, PNG e WebP até 5 MB, tipo pelos bytes).
  - Ganhou `file_name` para a busca, enviado em `POST /api/internal/media?name=` e limpo de pastas e caracteres de controle.
- **Na publicação, a API envia cada imagem à Zernio:** `POST /v1/media/presign` e depois `PUT` do arquivo no endereço assinado.
  - O `PUT` vai **sem a chave da empresa** (é outro servidor, de armazenamento).
  - Endereços só `https` (a exceção é a origem configurada da Zernio simulada).
  - O envio é refeito a cada publicação, porque a Zernio apaga a mídia não usada quando o post é excluído.
- **Política de segurança do painel inalterada:** as miniaturas vêm da própria API.
- **Vídeo (S6) fica para depois:** exige envio direto do navegador e liberar o domínio exato do armazenamento na política de
  segurança, conferido na homologação.
- **Regras de cada rede em `packages/contracts/src/social.ts`** (`SOCIAL_RULES`, `socialRuleIssues`): as mesmas para os avisos
  do painel e a conferência da API.
  - Instagram só JPG/PNG.
  - Facebook até 4 MB.
  - O X conta 280 caracteres.
  - Story só no Instagram e no Facebook, com 1 imagem.
  - Pinterest com 1 imagem.
- **Métricas que cada rede informa** (`SOCIAL_METRIC_SUPPORT`): a tela de Resultados mostra "—" onde a rede não informa, nunca
  zero.

## D-51 · Um processo por banco embutido (trava `saas/.data/pglite.lock`)
- **Incidente de 2026-11-03:**
  - duas APIs de desenvolvimento ficaram rodando ao mesmo tempo, deixadas pelo assistente em sessões diferentes;
  - a segunda abria o banco antes de falhar na porta (EADDRINUSE);
  - as duas gravaram no mesmo PGlite e o banco não abriu mais ("could not locate a valid checkpoint record").
- **Recuperação, autorizada pelo dono do produto:**
  - cópia de segurança antes de tudo;
  - `pg_resetwal` do PostgreSQL 18 portátil (pacote oficial da EDB, sem instalar nada), numa cópia;
  - conferência das contagens e `REINDEX` dos esquemas;
  - troca da pasta, com a danificada guardada em `saas/.data/pglite-danificado-2026-11-03` (ignorada pelo git).
- **Proteção no código** (`packages/db/src/client.ts`, `lockEmbeddedDir`):
  - o banco embutido só abre se o processo conseguir criar `<pasta>.lock` com o próprio PID;
  - outro processo vivo com a trava → erro `DZ_DB_LOCKED`, e a API sai com a mensagem "outra API já está usando o banco
    embutido", sem tocar no banco;
  - trava de processo encerrado à força é substituída.

## Inbox com WhatsApp, etapa I1 (2026-11-04)

Plano: `PLANO_MODULO_INBOX.md` (decisões N1 a N8 aprovadas). Base: `HOMOLOGACAO_I0_EVOLUTION.md`. **Nenhuma dependência nova.**

## D-52 · Eventos da Evolution: cliente WebSocket próprio, modo difusão, desligado por padrão
- **Cliente próprio** (`apps/api/src/integrations/ws-client.ts`, RFC 6455 mínimo, só leitura), em vez de:
  - o `WebSocket` nativo do Node, que não informa o código HTTP da recusa. Sem ele, não dá para distinguir a chave recusada (401)
    e o cliente insistiria; e a Evolution grava cada token recusado no log em texto puro. Ele também não permite fixar o TLS
    verificado nem limitar o tamanho das mensagens;
  - o pacote `ws`, que pela decisão N7 só entra como dependência de desenvolvimento.
- **Modo difusão** (`/ws?token=<chave global>`, sem `instanceId`), com filtro no DisparaZap. O modo por instância tem a falha
  da remoção da conexão antiga, que deixa a conexão "muda" (HOMOLOGACAO_I0 §5.1).
- **Filtro antes de gravar ou avisar:** só instâncias registradas no banco, do mesmo servidor, não excluídas e com
  `inbox_enabled_at` preenchido. O `instanceToken` do evento é comparado em tempo constante com o token do cofre. Evento de
  instância desconhecida (MVP, outros sistemas) é contado e descartado, sem registrar nada do conteúdo.
- **Chave recusada:** guarda só o hash da chave, não tenta de novo enquanto ela for a mesma e mostra "chave recusada" na Inbox.
  Volta sozinho quando o Super-Admin troca a chave em Configurações.
- **Reconexão** com espera crescente (1 s a 60 s, com variação). Sinal de vida a cada 30 s, prazo de 10 s para o pong.
  Cada queda abre um período sem recebimento (`inbox_reception_gaps`), fechado ao reconectar e mostrado na Inbox. Não há
  reenvio do que se perdeu: a Evolution não guarda eventos.
- **Processamento em fila única**, na ordem de chegada (um processo, D-45).
- **Duas chaves, `false` por padrão em todos os ambientes:**
  - `INBOX_EVENTS_ENABLED` liga o consumidor (conexão de saída com a chave global);
  - `INBOX_ACTIVATION_ENABLED` libera o botão "Receber mensagens na Inbox".
  Só a homologação autorizada (P2 a P4) as liga. Nada é ativado sozinho nas instâncias existentes.
- **A URL (que leva a chave) e o conteúdo dos eventos nunca vão para o log.**

## D-53 · Modelo da Inbox e gravação idempotente
- **Migration `0007_inbox`:** sete tabelas no esquema `app` e `whatsapp_instances.inbox_enabled_at`.
  - Chaves estrangeiras compostas `(organization_id, id)`, como nas outras tabelas da empresa: uma conversa nunca aponta para
    contato ou instância de outra empresa.
  - O `drizzle-kit` gerou as chaves compostas antes dos índices únicos de que elas dependem. A ordem foi corrigida à mão, como
    na `0004_templates`; sem isso, a migration falha e não é aplicada.
- **Idempotência:**
  - mensagem única por `(conversation_id, external_id)`: evento repetido não duplica;
  - envio do painel único por `(organization_id, client_request_id)`.
- **Fora de ordem:**
  - a ordem da conversa segue a hora do WhatsApp, não a de chegada;
  - a prévia e a última mensagem não retrocedem;
  - recibo que chega antes da mensagem fica em `inbox_pending_receipts` e é aplicado quando ela chegar;
  - a situação só avança (enviando → enviada → entregue → lida).
- **Contato:** o mesmo contato pode chegar pelo número ou pelo LID (`inbox_contact_identities`). A conversa prefere o
  identificador por número, que é por onde o envio sai.
- **Mídia (I2 depende da N5):** só o tipo e a legenda. O conteúdo em base64 que vem no evento é descartado.
- **Só conversas individuais:** grupos, status, reações e mensagens de controle ficam de fora.

## D-54 · Responder pela Inbox: sem duplicar, assumindo o atendimento
- **Pedido único:** o painel gera um `requestId` (UUID) e o repete ao tentar de novo depois de uma falha de rede. O mesmo
  pedido devolve o registro já gravado (`replayed`), sem chamar a Evolution, mesmo com dois cliques simultâneos.
- **A mensagem é gravada "enviando" antes de chamar a Evolution.**
  - O eco `SendMessage` casa com ela pelo texto e ganha o id do WhatsApp.
  - Se o eco chegar antes da resposta, a resposta só completa o que faltava.
  - Sem resposta da Evolution, a mensagem fica "enviando", com aviso de que pode ter saído.
- **Respostas da Evolution:** só motivos fixos chegam à tela (desconectado, número recusado…), nunca o corpo da resposta.
- **Quem responde assume:**
  - a conversa vai para o modo `human`, e a `control_version` sobe se o modo mudou;
  - sem responsável, ela passa a ser de quem respondeu;
  - encerrada, ela reabre;
  - tudo fica em `inbox_conversation_events`.
- **Trava das respostas automáticas** (`canDeliverAutomated`): uma resposta de IA ou automação só sai se o modo e a versão
  ainda forem os mesmos de quando ela foi gerada. Fica pronta para as etapas I7 a I9. Nenhum motor de IA ou automação nesta
  etapa.
- **Papéis (N3/N4):**
  - dono e administradores veem todas as conversas;
  - o atendente (operador) vê as dele e as sem responsável; a de outro atendente responde 404;
  - o visualizador não tem Inbox (403).
- **Destino:** o número do contato; contato só com LID usa o identificador da conversa. A confirmar na homologação (P5).
- **Reconectar o número pelo QR Code mantém a configuração de eventos**, porque o `/instance/connect` a regrava. Sem isso, a
  Inbox pararia de receber sem aviso.

## D-55 · Tempo real no painel: SSE só com ids, consulta periódica de reserva
- **`GET /api/internal/inbox/stream` (SSE)**, com `reply.hijack()`:
  - avisos `{ type, conversationId }`, sem conteúdo;
  - filtrados pela empresa da sessão e pela visibilidade do atendente;
  - sinal de vida a cada 25 s;
  - duração máxima de 15 min: o navegador reconecta sozinho e a sessão é conferida de novo;
  - no máximo 50 conexões por empresa;
  - encerrados no `preClose`.
- **Barramento em memória** (`InboxBus`): serve a um processo só (Hostinger, D-45). Com mais processos, troca por Redis ou
  `LISTEN/NOTIFY`.
- **No painel (`EventSource`):**
  - sem o canal, consulta a cada 5 s;
  - com o canal, ainda confere tudo a cada minuto;
  - ao reconectar, relê o que pode ter chegado no intervalo.
- **Responsivo pelo endereço** (`/inbox`, `/inbox/:id`, `/inbox/:id/detalhes`): o CSS mostra uma coluna por vez abaixo de
  960 px, pelo atributo `data-view`. Sem `matchMedia` no código: o botão Voltar do navegador funciona e a tela é testável.

## D-56 · Teste de acesso à Inbox da Zernio (Z1, 2026-11-04)
- **Botão administrativo** em Integrações → Zernio, com confirmação. Nunca roda sozinho ao abrir a página.
- **Só leitura:** `GET /v1/inbox/conversations` com o perfil da própria empresa e `limit=1`. O servidor só conta as conversas e nunca lê nem guarda o conteúdo.
- **Só dono e administradores**, pela sessão. A rota exige `{ "confirmed": true }` no corpo e tem limite de tentativas.
- **Sem efeito colateral:** o resultado não muda a situação da integração (uma chave recusada não fica marcada como inválida por causa do teste).
- **Resultados:** acesso confirmado, recurso indisponível, falha de autenticação, falha temporária e diagnóstico inconclusivo. Um 403 **não** é tomado como falta de add-on: a tela mostra o código que a Zernio devolveu.
- **Log:** `zernio.inbox.teste` com o resultado e o status, sem chave, perfil, conversa ou texto.
- **Testado contra a Zernio simulada** (`inboxMode`: 200, 403 com código e sem código, 402, 401, 429, 500 e formato inesperado). A consulta real não foi executada.

## D-57 · Conversas do Instagram lidas direto da Zernio, sem gravar (Z2, 2026-11-04)
- **Sem migração de banco:** a leitura é feita a cada pedido, pela API do DisparaZap, direto na Zernio. Nada é gravado e nada das mensagens vai para o log.
  - Motivo: as tabelas da Inbox estão presas a `whatsapp_instances` (AUDITORIA §F). Gravar exigiria a migração que ainda aguarda aprovação.
- **Endpoints verificados** em docs.zernio.com (leitura de 2026-11-04):
  - lista: `GET /v1/inbox/conversations` (`profileId`, `accountId`, `platform`, `limit` até 100, `cursor`, `sortOrder`);
  - mensagens: `GET /v1/inbox/conversations/{conversationId}/messages`, com `accountId` **obrigatório**, `sortOrder` (`desc` = mais recentes primeiro) e `pagination.nextCursor`;
  - texto em `message`; sentido em `direction` (`incoming` = contato, `outgoing` = empresa).
- **Escopo por conta:** toda leitura passa pelas contas do perfil da empresa. Conta de outra empresa responde 404, e conta que não é do Instagram responde 400 (esta etapa lê só o Instagram).
- **Erros fixos:** 401 vira "trocar a chave"; 403 vira "não liberou a Inbox" (sem concluir sozinho que é add-on); 429 pede pausa; resposta fora do formato vira mensagem geral (502).
- **Sem envio:** a resposta pelo Instagram fica para a etapa seguinte, com `HUMAN_AGENT` apenas em resposta digitada por pessoa.
- **Limite conhecido da Meta:** o histórico de Instagram é reenviado só até 500 mensagens recentes por conversa (`platforms/instagram/inbox`).
- **Testado contra a Zernio simulada** (`inboxThreads`): ordem cronológica, paginação em 50 com "ver anteriores", isolamento, falhas e log sem texto.

## D-58 · Visão unificada e validação de conta nas redes (Z2.2, 2026-11-04)
- **"Todos os canais"** reúne WhatsApp (servidor) e Instagram (Zernio, lido ao abrir a visão). Ordem por atividade, no painel.
- **Só o Instagram é lido** nesta etapa. TikTok e as outras redes mostram o estado "não habilitada" e não chamam a Zernio.
- **Sem fallback de conta:** conversa que não traz a conta pedida, ou que não é do Instagram, é descartada. O identificador nunca é trocado.
- **Filtros que não se aplicam à rede somem** quando uma rede está aberta (busca, filtro por conta e abas).

## D-59 · Horário de envio e tipos de anexo nas mensagens de rede (Z2.3, 2026-11-04)
- **Horário:** `sentAt` (horário de envio, documentado) quando a Zernio informa, senão `createdAt` (não documentado como envio). A tela ordena por esse horário, e não pela ordem da página.
- **Anexos:** mostrados pelo tipo documentado (`image`, `video`, `audio`, `file`, `sticker`, `share`, `template`, `unsupported_type`). Tipo fora da lista vira `unsupported_type`. A URL do arquivo não é lida (expira).
- **Texto:** `message` vazio fica vazio. Não se inventa texto para mensagem com anexo.
- **Pendência:** confirmar com uma leitura real autorizada se a janela de mensagens recentes segue `sentAt` ou `createdAt`.

## D-60 · Diagnóstico temporário das datas do Instagram (Z2.4, 2026-11-04)
- Rota só para dono e administradores, com no máximo 10 mensagens por leitura. Devolve datas e campos, nunca o texto.
- Disparada pela lista, sem abrir a conversa, porque abrir carrega a página de mensagens (50 por vez).
- **Removível:** rota `/social/diagnostico-datas`, botão "Diagnosticar datas" e `SocialDateDiagnosticPanel`, depois da homologação.

## D-61 · Histórico confiável e janela de resposta do Instagram (Z3.1, 2026-11-04)
- O histórico só é confiável quando a Zernio confirma `sortOrderApplied = desc`. Sem isso: aviso, "ver anteriores" desativado e janela bloqueada.
- A janela (24 h sem tag; 24 h a 7 dias com `HUMAN_AGENT` para resposta humana; mais de 7 dias bloqueado) fica em um único lugar: `socialReplyWindow`.
- Limite provisório de 1.000 caracteres para texto simples.

## D-62 · Registro de envios com RLS (Z3.1, rascunho, 2026-11-04)
- Tabela `app.inbox_social_sends` em rascunho (`saas/docs/MIGRACAO_0008_SOCIAL_SENDS_RASCUNHO.sql`), fora de `packages/db/migrations` para não ser aplicada pelo servidor de desenvolvimento.
- Segue o padrão de SUPABASE_CONFIGURACAO: RLS habilitada e forçada, políticas por operação, sem DELETE para a aplicação, nada concedido a PUBLIC, anon, authenticated ou service_role.
- **Bloqueio:** a aplicação precisa definir `app.org_id` por transação antes de aplicar em produção.

## D-63 · Contexto de empresa por transação (Z3.2, 2026-11-04)
- `withTenant(db, organizationId, fn)` define `app.org_id` com `set_config(..., true)`: escopo da transação, sem persistir no pool.
- A empresa vem sempre da sessão. Identificador fora do formato não executa.
- Testes com papel que não é superusuário (`dz_app`), conforme a exigência de RLS.

## D-64 · Envio de resposta humana pelo Instagram com registro antes da chamada (Z3.2, 2026-11-04)
- Só origem humana. Janela revalidada com histórico lido na hora. Sem histórico confirmado ou sem data confiável, bloqueia.
- Registro `pending` antes da chamada. A mesma intenção (requestId) nunca chega duas vezes à Zernio.
- Resultado incerto (409, 5xx, tempo esgotado, resposta sem id) fica `unknown` e não é reenviado sozinho.
- Desligado por `INBOX_SOCIAL_SEND_ENABLED` (padrão `false`). O registro usa a tabela `app.inbox_social_sends`, que só existe depois da migração 0008 aprovada; sem ela, o envio não deve ser habilitado.

## D-65 · Automações de redes pela Zernio, sem cópia no banco (PLANO_MODULO_AUTOMACOES, 2026-11-05)
- A Zernio guarda as automações. O DisparaZap lê e (nas próximas etapas) altera direto nela, com a chave e o perfil da empresa. Sem tabela nem migração.
- Toda leitura confere se a conta da automação é do perfil da empresa, relido na Zernio. O resto é descartado; no detalhe, 404 sem dizer se existe em outro lugar.
- Formato tolerante (`id` ou `_id`, conta como texto ou objeto), porque a documentação não traz a resposta completa. Sem id ou sem conta, descarta.
- Dono e administradores gerenciam; atendentes e visualizadores só veem (decisão A2).
- Trava `AUTOMATIONS_WRITE_ENABLED` (padrão `false`, também na produção) até a homologação H1 a H3.
- Erros só como mensagens fixas; o texto das DMs e das respostas nunca vai para o log.
- Alternativa considerada: espelhar as automações numa tabela. Descartada: duplicaria a fonte da verdade e guardaria texto sem necessidade.

## D-66 · Escrita das automações: pausada, confirmação e nome único (PLANO_MODULO_AUTOMACOES A2, 2026-11-05)
- Toda automação é criada com `isActive: false`. Ativar é outra ação, com confirmação que diz que as mensagens são reais.
- A Zernio não documenta `Idempotency-Key` para `POST /v1/comment-automations`. O DisparaZap recusa nome repetido na mesma conta (maiúsculas e minúsculas contam iguais), então repetir o pedido não duplica. Resultado incerto (5xx, tempo esgotado, resposta fora do formato) devolve uma mensagem para conferir a lista antes de tentar de novo.
- Regras por rede num só lugar do contrato (`automationInputProblem`): Instagram e Facebook exigem a DM (até 640 caracteres com botões, 1.000 sem); TikTok, Threads, LinkedIn e YouTube só aceitam resposta pública; botões só com `https://`.
- O corpo enviado leva só os campos documentados; `alsoMatchInDms` vai sempre `false` (decisão A4) e nenhuma postagem específica é vinculada nesta etapa.
- Alternativa considerada: guardar uma tabela local de pedidos para idempotência (como o envio do Instagram, D-64). Descartada nesta etapa: o nome único resolve a repetição sem migração.

## D-67 · Só seguidores e menção em story, só no Instagram (PLANO_MODULO_AUTOMACOES A3, 2026-11-05)
- As duas automações só aparecem e só são aceitas para contas do Instagram (capacidade `full`), na tela e na API.
- Só seguidores usa a verificação documentada (`whenUnknown: "verify"`), porque o Instagram só informa quem segue depois de a pessoa mandar uma mensagem; a resposta pública sai sempre (`publicReplyPolicy: "always"`).
- Menção em story não aceita palavra-chave, resposta pública nem verificação. A repetição padrão é uma resposta a cada 24 h.
- O gatilho é fixo depois de criado. Gatilhos que a tela não cria (`story_reply`, `live_comment`) não são editados pelo DisparaZap.
- Alternativa considerada: liberar a verificação também no Facebook, como diz a documentação oficial. Adiada: a skill e o plano aprovado dizem só Instagram; conferir na homologação.

## D-68 · Link → conversa: fluxo de referência, só Instagram, criado pausado (PLANO_MODULO_AUTOMACOES A5, 2026-11-05)
- O link é um fluxo da Zernio (`/v1/workflows`) com gatilho `referral` (ref exato) e intervalo de repetição; sem tabela no banco (D-65).
- Só Instagram nesta etapa. O Instagram nem sempre repassa o `ref`; por isso a tela avisa e a alternativa "envie MENU" fica para depois.
- Nasce sempre pausado (`POST /v1/workflows` cria rascunho). Ativar e pausar são ações separadas, com confirmação na tela.
- A lista da Zernio não traz o gatilho. O código do link vai na descrição do fluxo (`DisparaZap link: <código>`) e é lido de volta; o link completo só sai para contas com `username` conhecido. Fluxo sem essa descrição aparece sem link.
- Unicidade conferida antes de chamar a Zernio: nome por conta (como nos comentários) e código por conta (dois fluxos com o mesmo `ref` seriam ambíguos).
- Documentação: a página de atualização de fluxo diz que o grafo pode mudar em qualquer status; a visão geral diz que só em rascunho ou pausado. Esta etapa não edita grafo.
- QR code: aprovado pelo dono depois (decisão A6 do plano). Gerado no servidor com a biblioteca `qrcode` (1.5.4, em `apps/api`; tipos `@types/qrcode` 1.5.6), como PNG em data URL. Alternativa descartada: gerar no navegador, que levaria a biblioteca ao bundle público. O QR leva só o link público.

## D-69 · Comentário → perguntar antes do link: pergunta em texto, botão depois da resposta (PLANO_MODULO_AUTOMACOES A6, 2026-11-05)
- Fluxo da Zernio com gatilho `comment` (palavras-chave, `contains`, qualquer publicação), pergunta em texto, `wait_for_reply` de 1440 min e botão com o link só na saída `reply`. Sem resposta, a saída `timeout` termina o fluxo.
- Por que a pergunta vai sem botão: a documentação oficial diz que o Instagram recusa botões numa resposta privada a quem não segue e ainda gasta a única resposta privada do comentário. Por isso a pergunta é texto e o botão vai na mensagem seguinte, como no exemplo oficial.
- Sem condição: qualquer resposta libera o link. Escolhido porque o formato das condições e os campos obrigatórios do gatilho `comment` não foram confirmados na documentação; a aplicação de regras de resposta fica para depois da homologação.
- Conflito: uma automação de comentário com a mesma palavra responde primeiro e o fluxo não inicia (documentação). O aviso aparece no construtor; a checagem automática fica para a homologação.
- Nasce pausado, com as mesmas regras do link (D-68): só Instagram, ativar com confirmação, sem edição de grafo.

## D-70 · Atividade das automações: texto fixo, sem comentário para quem só lê, atualização de 15 s (PLANO_MODULO_AUTOMACOES A4, 2026-11-05)
- Os registros vêm de `GET /v1/comment-automations/{id}/logs` na Zernio (sem tabela local, D-65). A tela mostra só um texto fixo por situação; o motivo e a mensagem de erro da Zernio são texto livre e não saem da API.
- Os comentários que não casaram (`misses`) trazem nome e texto de outras pessoas: saem só para dono e administradores (decisão A7). Atendentes e visualizadores recebem `misses: null`.
- A atividade se atualiza a cada 15 s enquanto a página do detalhe estiver aberta (decisão A9). Com 120 leituras por minuto por empresa, a conta cabe com folga.
- Regra de repetição: já existe desde a A2 (uma vez por pessoa ou com intervalo). A A4 só mostra o efeito dela nos registros.
- Não verificado na documentação: o limite máximo de `limit` e os valores aceitos em `status`. A leitura usa 50 registros e não filtra por status.

## D-71 · Imagem Docker para o Easypanel: construção a partir do GitHub, segredos fora da imagem (2026-11-06)
- O `saas/Dockerfile` constrói dentro da própria imagem (instalação, compilação e remoção das dependências de desenvolvimento), a partir do código do GitHub. Assim, a imagem não depende de pastas geradas localmente (como `deploy/` ou `dist/`), que não vão para o git.
- Segredos, `.env*`, certificados e o cache do TypeScript ficam de fora (`saas/.dockerignore`). O certificado do Supabase e as variáveis entram no Easypanel, como indicado em `saas/infra/docker/LEIA-ME.md`.
- O contêiner define `API_HOST=0.0.0.0` apenas dentro da imagem. No código, o padrão continua `127.0.0.1` (D-45 e a regra de escuta local do projeto).
- Não verificado ainda: a construção real da imagem, porque o Docker não está instalado nesta máquina. Ela deve ser testada no Easypanel antes de publicar.
