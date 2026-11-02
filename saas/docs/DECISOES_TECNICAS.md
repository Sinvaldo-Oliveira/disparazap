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
