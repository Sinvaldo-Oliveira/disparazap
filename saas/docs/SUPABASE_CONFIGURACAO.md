# Supabase — configuração planejada do banco do SaaS

| | |
|---|---|
| **Fase** | 5A.2: planejamento e documentação, sem alterações remotas |
| **Data** | 2026-11-01 |
| **Situação** | **Nada foi criado.** Nenhum projeto Supabase, nenhuma conexão, nenhuma dependência, nenhuma migration |
| **Fontes** | Documentação oficial consultada em 2026-11-01 (lista no fim). Preços, limites e recursos mudam: confirmar no painel antes de cada passo |

Termos usados: **papel** = *role* do PostgreSQL; **pooler** = Supavisor (o intermediário de conexões do Supabase);
**RLS** = *Row Level Security* (políticas por linha). O que as fontes não confirmam está marcado **a confirmar**.

---

## 1. Arquitetura aprovada

| Camada | Decisão |
|---|---|
| Banco | **PostgreSQL gerenciado pelo Supabase Cloud**, num **projeto novo e exclusivo** do DisparaZap |
| Acesso a dados | **Drizzle ORM** + drizzle-kit, só pelo backend (API e worker) |
| Multiempresa | `organization_id` nas tabelas de empresa + **RLS** no PostgreSQL |
| API / worker / painel | Fastify + TypeScript / Node.js independente / React + Vite, hospedados futuramente na VPS Hostinger |
| Fora desta etapa | Redis e BullMQ, Evolution Go, Zernio, agentes de IA |
| Não usar | O projeto Supabase do **MyLinksss** (nem para consulta) e o **PostgreSQL local do Windows** |

```
 Navegador (React)  ──HTTPS, mesma origem──►  API Fastify (VPS)  ──TLS verify-full──►  PostgreSQL do Supabase
   nenhuma chave                               papéis dz_app /                          (projeto exclusivo,
   nenhuma URL de banco                        dz_platform                               região São Paulo)
                                               Worker (VPS)  ───────TLS verify-full──►        ▲
                                               papel dz_app (fase de filas)                    │
 Máquina do operador ──── migrations revisadas, papel dz_migrator, execução manual ───────────┘
```

**Uso do Supabase:** só como PostgreSQL gerenciado. O backend conecta direto no PostgreSQL. **Não usamos** a Data API
(PostgREST/GraphQL), o Storage, o Realtime nem as Edge Functions. A autenticação depende da decisão da seção 7.

---

## 2. Criação manual do projeto (passo a passo)

Quem executa: **o dono do produto**, no painel oficial `https://supabase.com/dashboard`. O assistente não cria nada, e
nenhuma senha, *connection string* completa ou chave é colada no chat.

### 2.1 Antes de começar
1. Ative a **autenticação em dois fatores (MFA) na sua conta Supabase**. É a primeira recomendação do checklist de produção.
2. Tenha um **gerenciador de senhas**: ele guarda a senha do banco e as senhas dos papéis.

### 2.2 Organização
3. Crie uma **organização nova**, por exemplo "DisparaZap", **separada da organização do MyLinksss**.
   - **Cobrança:** o Supabase cobra por organização. O plano fica na organização; a capacidade de processamento (*compute*)
     é cobrada por projeto.
   - **Acesso:** membros e convites da organização do MyLinksss não ganham acesso ao DisparaZap, e vice-versa.
   - **Custo:** uma organização nova no plano Pro paga a própria mensalidade. Colocar o projeto numa organização existente
     custaria menos, mas misturaria acessos. Recomendação: organização separada.
   - **Segurança da organização:** exigir MFA de todos os membros e ter um segundo proprietário de confiança (recomendações do
     checklist de produção).

### 2.3 Plano e custos (consultados em 2026-11-01, **confirmar no painel**)
| Item | Valor de referência | Observação |
|---|---|---|
| Free | US$ 0 | 500 MB de banco; até 2 projetos ativos; **pausa após 1 semana sem uso**; **sem backups** |
| Pro | a partir de US$ 25/mês por organização | Inclui US$ 10/mês de crédito de *compute* (cobre um Micro); 8 GB de disco por projeto, depois US$ 0,125/GB; projeto não pausa |
| Compute Micro / Small / Medium | US$ 10 / 15 / 60 por mês | 1 / 2 / 4 GB de RAM |
| PITR (restauração a qualquer instante) | ~US$ 100/mês por 7 dias de retenção | Exige pelo menos Small; ao ativar, os backups diários deixam de ser feitos |
| Add-on de IPv4 | **a confirmar** (preço não consta na página) | Só Pro em diante; dá IPv4 fixo à conexão direta e ao pooler dedicado |
| Team | a partir de US$ 599/mês | Não é necessário agora |

**Recomendação de plano:**
- **Desenvolvimento, sem clientes:** Free é suficiente. As limitações são a pausa por inatividade e a falta de backup.
- **Antes de qualquer dado real:** Pro, com o limite de gastos (*spend cap*) ligado (vem ligado por padrão no Pro).

### 2.4 Projeto
4. Crie o projeto com o nome **`disparazap`**.
5. **Região:** escolha a região específica **South America (São Paulo), `sa-east-1`**, e não uma região genérica como
   "Americas". Motivos:
   - menor latência para usuários brasileiros;
   - a Hostinger tem VPS no Brasil (o datacenter de São Paulo será confirmado no levantamento I1);
   - os dados ficam no Brasil, o que facilita o atendimento à LGPD.

   A documentação não diz se a região pode ser trocada depois: trate como **definitiva**.
6. **Senha do banco** (é a senha do papel `postgres`, administrativo):
   - gerada pelo gerenciador de senhas, **exclusiva** e com **pelo menos 32 caracteres**;
   - **só letras e números**, porque caracteres especiais precisam de codificação na *connection string* e causam erros;
   - guardada só no gerenciador. Nunca em arquivo do projeto, chat, e-mail ou print;
   - usada **somente** na preparação inicial (seção 6.2), nunca pela API ou pelo worker.
7. **Versão do PostgreSQL:** as páginas consultadas não dizem qual versão os projetos novos recebem. Anote a versão que o painel
   mostrar e registre-a em `DECISOES_TECNICAS.md`. A arquitetura foi pensada para o PostgreSQL 17.

### 2.5 Segurança logo após a criação
| # | Configuração | Onde (nomes do painel podem mudar) | Por quê |
|---|---|---|---|
| 8 | **Desativar a Data API** ("Enable Data API" desligado) | Integrations → Data API | Não usamos o PostgREST. Com ela desligada, nenhuma rota REST automática responde, sejam quais forem as permissões. **A confirmar:** se o GraphQL também fica indisponível |
| 9 | **Exigir SSL** ("Enforce SSL on incoming connections") | Database → Settings → SSL | O padrão aceita conexões sem SSL. Ativar reinicia o banco rapidamente |
| 10 | **Baixar o certificado raiz** | Database → Settings → SSL | Para usar `sslmode=verify-full`. Guardar **fora do repositório** (o `.gitignore` da raiz já ignora `*.crt`/`*.pem`) |
| 11 | **Restrições de rede** (lista de IPs permitidos) | Database → Settings → Network Restrictions | Valem para a conexão direta e para o pooler. Em produção, só os IPs da VPS (IPv4 e IPv6). **A confirmar:** em quais planos existe. No desenvolvimento, o IP residencial muda: decidir caso a caso |
| 12 | **Cadastro no Supabase Auth** | Authentication → Settings | Se a decisão for não usar o Supabase Auth (seção 7), **desligar novos cadastros**, para ninguém criar contas no projeto |
| 13 | **Extensões** | Database → Extensions | Não ativar nada desnecessário. Em especial o `pg_net`: com ele, papéis criados por nós conseguem ler os cabeçalhos das requisições na fila (inclusive chaves) |
| 14 | **Chaves de API do Supabase** | Settings → API Keys | Não vão para o painel nem para o `.env`, a menos que a alternativa A da seção 7 seja escolhida. A chave secreta e a `service_role` **nunca** vão ao navegador |

### 2.6 Backups
| Plano | O que existe | Nosso complemento |
|---|---|---|
| Free | **Nenhum backup automático**; backups não podem ser baixados | Exportação lógica manual (`pg_dump` / `supabase db dump`) quando houver dados que importem; precisa de autorização |
| Pro | Backups diários com **7 dias** de retenção; restauração pelo painel (o projeto fica indisponível durante a restauração) ou duplicação para um projeto novo | Ensaio de restauração antes do lançamento (seção 9); cópia externa conforme a decisão I4 |
| Pro + PITR | Restauração a qualquer instante, com custo extra | Avaliar quando houver clientes pagantes |

**Cuidados:**
- **Senhas dos papéis próprios não entram nos backups:** depois de uma restauração, é preciso redefini-las.
- **Arquivos do Storage não entram nos backups.** O DisparaZap não usa Storage.

### 2.7 Projeto de testes (decisão pendente, recomendado)
- **Recomendação:** um segundo projeto, **`disparazap-test`**, na mesma organização e região, no plano Free.
  - É **descartável**: os testes de integração apagam e recriam o esquema a cada execução.
  - Assim, os testes nunca tocam os dados de `disparazap`.
- **Alternativas:**
  - *branching* do Supabase: pago, no Pro;
  - Supabase local pela CLI: exige Docker, inviável nesta máquina segundo a auditoria 5A.1.
- **Produção:** antes do lançamento, decidir se ela será o próprio `disparazap`, limpo e no plano Pro, ou um projeto novo.

### 2.8 O que registrar (e o que não registrar)
- **Registrar em `DECISOES_TECNICAS.md`:** região, plano, versão do PostgreSQL e data da criação.
- **Não registrar em nenhum arquivo versionado:**
  - a referência do projeto (*project ref*), que identifica o servidor e aparece nos endereços;
  - endereços de conexão, senhas e chaves.

  Tudo isso fica só no `saas/.env` (não versionado) e no gerenciador de senhas.

---

## 3. Estratégia de conexão

### 3.1 Modos oficiais (documentação de 2026-11-01)
| Modo | Endereço (modelo) | IP | Usuário | Prepared statements | Estado de sessão | Indicado para |
|---|---|---|---|---|---|---|
| **Direta** | `db.[PROJECT-REF].supabase.co:5432` | **IPv6**; IPv4 só com o add-on (Pro+) | o próprio papel | Sim | Sim | Servidores persistentes, migrations, `pg_dump` |
| **Pooler compartilhado, modo sessão** | `aws-[INDEX]-[REGION].pooler.supabase.com:5432` | **IPv4** (todos os planos) | `[PAPEL].[PROJECT-REF]` | Sim | Sim | Servidor persistente em rede só IPv4 |
| **Pooler compartilhado, modo transação** | mesmo host, porta `6543` | IPv4 | `[PAPEL].[PROJECT-REF]` | **Não** (`prepare: false`) | **Não** | *Serverless* e *edge* |
| **Pooler dedicado** | `db.[PROJECT-REF].supabase.co:6543` | IPv6; IPv4 com o add-on | o próprio papel | Sim (PgBouncer ≥ 1.21) | Não (só modo transação) | Alta carga, Pro+ |

**No modo transação, perde-se** entre uma transação e outra:
- `SET`/`RESET`;
- *advisory locks* de sessão;
- `LISTEN`/`NOTIFY`;
- tabelas temporárias;
- cursores `WITH HOLD`;
- *pipelining*.

**Limites do compute** (o *pool size* padrão é 15 por combinação de usuário, banco e modo):

| Compute | Conexões diretas | Clientes no pooler |
|---|---:|---:|
| Micro | 60 | 200 |
| Small | 90 | 400 |
| Medium | 120 | 600 |

A soma das conexões diretas com as do pooler precisa ficar **abaixo** do máximo do PostgreSQL, porque os serviços do próprio
Supabase também usam conexões.

### 3.2 Fatos do nosso ambiente
- **Esta máquina não tem IPv6** (verificado em 2026-11-01): a conexão direta não funciona daqui sem o add-on de IPv4.
- **IPv6 da VPS Hostinger:** **a confirmar** no levantamento I1. A Hostinger declara IPv6 de forma geral, mas não especificamente
  para a VPS no Brasil.

### 3.3 Recomendação por uso
| Uso | Desenvolvimento (esta máquina) | Produção (VPS) | Papel |
|---|---|---|---|
| **API Fastify** | Pooler, **modo sessão** | **Conexão direta** por IPv6. Sem IPv6: modo sessão ou add-on de IPv4 | `dz_app`; `dz_platform` num pool separado |
| **Worker** | Pooler, modo sessão | Igual à API | `dz_app` (papel próprio na fase de filas, se necessário) |
| **Migrations Drizzle** | Pooler, modo sessão | Conexão direta, a partir da máquina do operador ou de uma tarefa avulsa | `dz_migrator` |
| **Testes de integração** | Pooler, modo sessão, **no projeto de testes** | — | `dz_app` e `dz_migrator` do projeto de testes |
| **Preparação inicial (papéis e esquemas)** | Editor SQL do painel ou `psql` pelo modo sessão | — | `postgres`, só nesse momento |

**Por que não o modo transação para a API:** ele exige desligar os *prepared statements* e proíbe estado de sessão. Nossa API é um
servidor persistente, e a documentação indica a conexão direta, ou o modo sessão, para esse caso. O modo transação fica
reservado para um eventual uso *serverless*. O pooler dedicado é a opção se o número de conexões crescer.

**Orçamento de conexões no Micro:**
- **Pools no modo sessão:** cada cliente ocupa uma conexão do pool (15 por papel, por padrão). Os limites ficam assim: API
  (`dz_app`) até 10, plataforma (`dz_platform`) até 2, worker até 5, migrations 1.
- **Pools na conexão direta:** os mesmos números cabem no máximo de 60.

### 3.4 Parâmetros do driver
- **Driver:** a documentação do Drizzle para Supabase usa o **postgres.js**. A escolha final é feita na instalação.
- **TLS:** sempre `sslmode=verify-full`, com o certificado raiz do projeto, cujo caminho fica em `DATABASE_CA_FILE`. Nunca
  desligar a verificação de certificado: a mesma regra do MVP vale aqui.
- **Pool:** `max` por papel (acima), tempo limite de conexão, `application_name` por processo (`disparazap-api`,
  `disparazap-worker`).
- **Tempos-limite:** `statement_timeout` e `idle_in_transaction_session_timeout` definidos **no papel**
  (`ALTER ROLE ... SET ...`), não por `SET` de sessão.
- **`prepare: false`:** só se algum uso passar para o modo transação.

### 3.5 Variáveis de ambiente (sem valores)
Todas ficam no `saas/.env` (não versionado), são preenchidas **pelo próprio dono do produto** e validadas com Zod. Um erro cita
o nome da variável, nunca o valor nem a URL.

**Modelo:** os campos, vazios e comentados, estão no bloco "Banco de dados — Supabase Cloud" do `saas/.env.example`. O
`saas/.env` foi criado a partir dele em 2026-11-01.

**Desde a autenticação (2026-11-01):**
- a API lê `DATABASE_URL`, `DATABASE_CA_FILE` e `DATABASE_POOL_MAX`;
- com `DATABASE_URL` vazio, usa o banco embutido de desenvolvimento (PGlite, em `saas/.data/`);
- o `drizzle.config.ts` lê `DATABASE_MIGRATION_URL` e `DATABASE_CA_FILE` (`npm run db:migrate`);
- as demais variáveis de banco ainda não são lidas.

| Variável | Quem usa | Papel | Observação |
|---|---|---|---|
| `DATABASE_URL` | API | `dz_app` | Conexão normal da aplicação |
| `DATABASE_PLATFORM_URL` | API (módulo de plataforma) | `dz_platform` | Pool separado e pequeno; toda operação auditada |
| `DATABASE_AUTH_URL` | API (módulo de autenticação) | `dz_auth` | Só se a alternativa B da seção 7 for aprovada |
| `DATABASE_WORKER_URL` | Worker (fase de filas) | `dz_app` ou papel próprio | Ainda não usada |
| `DATABASE_MIGRATION_URL` | Operador, ao aplicar migrations | `dz_migrator` | **Nunca** presente no ambiente da API ou do worker em execução |
| `DATABASE_TEST_URL` | Testes de integração | `dz_app` do projeto de testes | Os testes recusam-se a rodar se o host for o mesmo de `DATABASE_URL` |
| `DATABASE_TEST_MIGRATION_URL` | Reset do banco de testes | `dz_migrator` do projeto de testes | Idem |
| `DATABASE_CA_FILE` | Todos | — | Caminho do certificado raiz, fora do repositório |
| `DATABASE_POOL_MAX` | API, worker | — | Tamanho do pool por processo |

**Modelo de endereço** (exemplo com marcadores):
`postgresql://[PAPEL].[PROJECT-REF]:[SENHA]@aws-[INDEX]-[REGION].pooler.supabase.com:5432/postgres?sslmode=verify-full`

**Regras:**
- Nenhuma variável de banco começa com `VITE_` ou `WEB_`. O Vite só repassa ao navegador as variáveis `VITE_*`, e o painel lê
  só `WEB_*`, e apenas no servidor de desenvolvimento.
- A API nunca usa `postgres` nem `service_role`.
- As senhas dos papéis próprios também usam **só letras e números**, com pelo menos 32 caracteres.
- Se a alternativa A da seção 7 for escolhida, entram as variáveis do Supabase Auth. A chave **publicável** pode ir ao navegador;
  a **secreta** só ao servidor.

---

## 4. Modelo multiempresa (conceitual — nenhuma tabela criada)

### 4.1 Conceitos
| Conceito | O que é | Onde vive |
|---|---|---|
| **Usuário da plataforma** | Uma pessoa com login (e-mail, nome, estado, MFA). Existe independentemente de empresas | Tabela de identidade (depende da seção 7) |
| **Organização** | A empresa cliente: nome, *slug*, estado (`active`/`suspended`), configurações | `organizations` |
| **Participação** | O vínculo de um usuário com uma organização, com **um papel** e um estado. Um usuário pode participar de várias | `memberships`, com chave única `(organization_id, user_id)` |
| **Papel administrativo global** | **Super Admin**: atributo do usuário na plataforma, não de uma empresa. Exige MFA. Toda ação em dados de empresa é auditada | Campo do usuário (ex.: `platform_role`) |
| **Papel na organização** | `owner`, `admin`, `operator`, `viewer` (ARQUITETURA_SAAS §4.2) | Campo da participação |
| **Permissão** | Ação concreta (`campaign:start`, `member:invite`…), derivada do papel **no código** e verificada em toda rota | Código (mapa papel → permissões) |
| **Convite** | Oferta de participação com papel, validade e uso único (o banco guarda só o hash do token) | `invitations` |
| **Sessão** | Login ativo; guarda a organização ativa | Depende da seção 7 |
| **Auditoria** | Quem fez o quê, onde e quando. Só aceita inclusão de registros | `audit_logs` |

### 4.2 Esquemas do PostgreSQL (proposta)
| Esquema | Conteúdo | Papel que acessa |
|---|---|---|
| `identity` | Usuários, sessões, contas, verificações, 2FA; organizações, participações e convites, se a biblioteca de autenticação cuidar deles | `dz_auth` (alternativa B) |
| `app` | Dados de negócio das empresas (contatos, campanhas… nas fases seguintes), todos com `organization_id` e RLS | `dz_app` |
| `audit` | `audit_logs` | Inclusão por `dz_app`, `dz_auth` e `dz_platform`; leitura restrita |
| `drizzle` | Registro das migrations aplicadas | `dz_migrator` |

**Esquemas que não usamos:**
- **`auth`:** pertence ao **Supabase Auth**. Por isso as tabelas da biblioteca de autenticação ficam em `identity`.
- **`public`:** os papéis criados por nós já herdam acesso a ele.

### 4.3 Regras do modelo
- **`organization_id uuid NOT NULL`** em toda tabela de empresa, com RLS.
- **Chaves compostas entre empresas:** cada tabela-mãe tem chave única `(organization_id, id)`, e cada tabela-filha referencia
  **`(organization_id, parent_id)`**. Assim, é impossível ligar um registro a outro de outra empresa.
- **Identificadores** `uuid` (v7) gerados na aplicação; datas em `timestamptz`; estados em `text` com `CHECK`.

### 4.4 Decisões pendentes do modelo
- Onde ficam organizações, participações e convites: nas tabelas do plugin de organizações (alternativa B) ou em tabelas
  próprias em `app`. Recomendação: **não duplicar**. Se a alternativa B for aprovada, usar o plugin com papéis próprios.
- Exclusão lógica e retenção, conforme a ARQUITETURA_SAAS §8.5.

---

## 5. Drizzle e migrations

| Item | Plano |
|---|---|
| **Pacote** | `saas/packages/db` (`@disparazap/db`), só de servidor, usado pela API e pelo worker |
| **Estrutura** | `src/schema/` (um arquivo por área: `identity`, `organizations`, `audit`); `src/client.ts` (pools por papel e `withOrgContext`); `migrations/` (SQL gerado e versionado); `sql/bootstrap/` (papéis e esquemas, **sem senhas**); `drizzle.config.ts` |
| **Versão** | A documentação atual do Drizzle já instala a linha **v1 em versão candidata** (`@rc`); a 0.x é a estável anterior. Escolher na instalação, **com versão exata travada** (sem `^`), e registrar em `DECISOES_TECNICAS.md` |
| **Gerar** | `drizzle-kit generate`: cria a pasta da migration com `migration.sql` e *snapshot* |
| **Validar** | Revisão do SQL contra um checklist (abaixo) e depois `drizzle-kit check` (consistência do histórico) |
| **Aplicar** | `drizzle-kit migrate`, **manual**, por uma pessoa com `DATABASE_MIGRATION_URL`. A ordem é sempre a mesma: (1) projeto de testes + suíte de integração; (2) `disparazap`; (3) produção, só com aprovação explícita e backup feito antes |
| **Registro** | Tabela `drizzle.__drizzle_migrations` (padrão da documentação) |
| **Proibido** | `drizzle-kit push` contra qualquer banco remoto; `--force` |
| **SQL manual** | `drizzle-kit generate --custom`, para o que o Drizzle não gera: `FORCE ROW LEVEL SECURITY`, funções auxiliares, `GRANT`/`REVOKE` |
| **Reversão** | O Drizzle **não tem migrations de volta**. Correções são **novas migrations**. Mudanças destrutivas em duas etapas (criar o novo, migrar, só depois remover o antigo). Antes da produção: backup e ensaio no projeto de testes |
| **Ambientes** | Testes, desenvolvimento e produção são projetos diferentes, com URLs diferentes; o `drizzle.config.ts` só lê `DATABASE_MIGRATION_URL` |
| **Papéis** | Gerenciados **fora** do Drizzle (`entities.roles` desligado), pelo SQL de preparação executado com `postgres`. O drizzle-kit fica restrito aos nossos esquemas |

**Checklist de revisão de cada migration:**
- toda tabela de empresa tem `organization_id NOT NULL`, RLS habilitada e forçada, e políticas para cada operação;
- as chaves estrangeiras entre tabelas de empresa são compostas;
- nada é concedido a `PUBLIC`, `anon`, `authenticated` ou `service_role`;
- toda função criada tem `EXECUTE` revogado de `PUBLIC`, e as funções `SECURITY DEFINER` (se houver) têm `search_path` fixo;
- não há perda de dados sem a etapa de transição.

**Privilégios do `dz_migrator`:**
- dono dos esquemas `identity`, `app`, `audit` e `drizzle`;
- sem superusuário, sem `BYPASSRLS`, sem `CREATEROLE` e sem `CREATEDB`;
- `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`.

---

## 6. Segurança e RLS

### 6.1 Papéis do Supabase (o que a documentação diz)
| Papel | Comportamento | Uso no DisparaZap |
|---|---|---|
| `postgres` | Privilégios de administrador; é o **dono padrão** dos objetos; tem **`BYPASSRLS`** | Só na preparação inicial. **Nunca** na API |
| `service_role` | Tem **`BYPASSRLS`**; é usado pela Data API para ignorar o RLS | **Nunca** |
| `anon` / `authenticated` | Papéis da Data API (sem login / com login). A documentação diz que, em geral, não se usa esses papéis na própria aplicação | Não usados; nenhum `GRANT` nos nossos esquemas |
| `supabase_admin` | Papel interno do Supabase | Não tocar |
| **Papéis próprios** | Sujeitos ao RLS nas tabelas de que **não** são donos, salvo `BYPASSRLS`. **Herdam** privilégios de `PUBLIC`: uso do esquema `public`, catálogos, tabelas temporárias e `EXECUTE` em funções | Revogar `EXECUTE` de `PUBLIC` nas nossas funções. Não revogar `CONNECT`, `TEMP` nem `USAGE` em `public`, porque os serviços do Supabase dependem deles |

**O RLS não protege conexões privilegiadas:** `postgres`, `service_role` e qualquer papel com `BYPASSRLS` ignoram as políticas.
O dono da tabela também ignora, a menos que o RLS seja **forçado**.

### 6.2 Nossos papéis (criados pelo SQL de preparação, executado com `postgres`)
| Papel | Atributos | Pode |
|---|---|---|
| `dz_migrator` | `LOGIN`, sem superusuário, sem `BYPASSRLS`, sem `CREATEROLE`, sem `CREATEDB` | Ser dono dos esquemas e aplicar migrations |
| `dz_app` | `LOGIN`, sem `BYPASSRLS`, sem `CREATEDB`, sem `CREATEROLE` | Ler e escrever dados de empresa, sempre sob RLS; nenhum DDL; nenhum `TRUNCATE`; em `audit_logs`, só inclusão |
| `dz_platform` | `LOGIN`, **sem `BYPASSRLS`** | Operações de Super Admin, por **políticas explícitas** `TO dz_platform`, sempre auditadas |
| `dz_auth` | `LOGIN`, sem `BYPASSRLS` | Só o esquema `identity`. Existe apenas se a alternativa B da seção 7 for aprovada |

**Senhas:**
- Ficam fora dos arquivos versionados.
- Podem ser definidas com o `\password` do `psql`, que envia a senha já em hash SCRAM, sem texto puro no SQL nem nos logs.
- O cliente `psql` desta máquina pode ser usado sem tocar no servidor PostgreSQL local, mas isso **depende de autorização**.

**Viabilidade:** a documentação mostra `CREATE ROLE ... LOGIN PASSWORD`, mas **não diz** se `postgres` consegue criar papéis com
todos esses atributos. Esse é o **primeiro item a confirmar** na preparação.

### 6.3 Políticas
- **Contexto ausente bloqueia tudo:** as funções auxiliares `app.current_org_id()` e `app.current_user_id()` leem
  `current_setting('app.org_id', true)`. Sem contexto, retornam `NULL`, e a política não libera nenhuma linha.
- **Uma política por operação** (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), sempre com `TO dz_app`, `USING` e `WITH CHECK`:
  `organization_id = app.current_org_id()`.
- **`ENABLE` e `FORCE ROW LEVEL SECURITY`** em toda tabela de empresa. Assim, nem o dono escapa das políticas. O Drizzle não gera
  o `FORCE`, que entra por SQL manual.
- **Índice** com `organization_id` como primeira coluna.
- **Views** com `security_invoker = true` (por padrão, uma view ignora o RLS).
- **Funções `SECURITY DEFINER`:** evitar. Se forem inevitáveis, com `SET search_path = ''`, fora de esquemas expostos e com
  `EXECUTE` revogado de `PUBLIC`.

### 6.4 Como a identidade e a organização chegam ao RLS
1. **Usuário:** a API autentica o usuário pela sessão (seção 7) e obtém o `user_id` no servidor.
2. **Pedido de organização:** a organização vem da rota (`/api/internal/orgs/:orgId/...`). **O `orgId` do navegador é só um
   pedido.**
3. **Verificação:** o servidor confere se o usuário participa da organização com um papel suficiente para a permissão da rota.
   Se não, responde 403 ou 404 e o banco nem é consultado.
4. **Contexto no banco:** só então abre uma transação e define o contexto **local da transação**:
   ```sql
   select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true);
   ```
   O `true` faz o valor valer só até o `COMMIT` ou o `ROLLBACK`.
5. **Repositórios:** recebem apenas essa transação. A função `withOrgContext(orgId, userId, fn)` é o único caminho.

**Sem vazamento entre conexões reaproveitadas:**
- O pool reaproveita conexões, por isso o contexto **nunca** é definido com `SET` de sessão nem com `set_config(..., false)`.
- Ao fim de cada transação, o valor some. A próxima transação na mesma conexão começa sem contexto e, portanto, sem acesso.
- Um teste automatizado procura usos de `SET` de sessão no código.

**Worker:** usa o mesmo mecanismo, com a organização gravada no job. Buscar jobs de todas as empresas exige uma política específica
e estreita, decidida na fase de filas.

**Alternativa A (Supabase Auth):**
- O backend continuaria conectando com os nossos papéis.
- O `sub` do JWT, verificado pela chave pública (JWKS), viraria o `app.user_id`, sem depender de `auth.uid()`.
- **Não** usar o padrão `set local role authenticated` + `request.jwt.claims` com a Data API desligada.

---

## 7. Autenticação — decisão pendente (D3)

> **Decidido e implementado em 2026-11-01: alternativa B (Better Auth).**
> - **Escolha:** o dono do produto delegou a escolha técnica.
> - **Implementação:** tabelas no esquema `identity`; o banco embutido é usado até a conexão com o Supabase.
> - **Detalhes:** DECISOES_TECNICAS D-18 a D-24 e ESTRUTURA_TECNICA §8.
> - **Requisito novo:** quem tem a licença do módulo no MyLinksss deve poder entrar com a mesma conta do MyLinksss (pendente).
>
> A comparação abaixo fica como registro.

| Critério | A. Supabase Auth | B. Better Auth no PostgreSQL do Supabase |
|---|---|---|
| **Login e sessões** | JWT de acesso (padrão 1 h) + *refresh token* de uso único. A sessão fica em `auth.sessions` | Sessão **no banco**, identificada por cookie. Expira em 7 dias por padrão, com renovação no uso |
| **Cookies** | Guias oficiais de cookie só para frameworks SSR (Next.js, SvelteKit), com `@supabase/ssr` ainda em beta. Para SPA + Fastify, os tokens ficariam no navegador ou exigiriam intermediação própria | Cookies `HttpOnly` e `Secure` em produção. Revogação imediata (o *cookie cache* tem atraso: deixar desligado) |
| **Recuperação de senha** | Nativa. O SMTP embutido envia **2 e-mails/hora**, só para endereços pré-autorizados, e não serve para produção: exige **SMTP próprio** | Fluxo nativo, mas o envio do e-mail é **função nossa**: exige provedor de e-mail |
| **MFA do Super Admin** | TOTP gratuito; telefone é add-on pago. Exigência por nível (`aal2`), verificada no backend. Códigos de recuperação **a confirmar** | Plugin de 2FA: TOTP, OTP e **códigos de recuperação**. Exigir só para Super Admin **não é nativo**: fica numa regra nossa nas rotas de plataforma, com cadastro obrigatório no primeiro acesso |
| **Convites para organizações** | Não há organizações nativas; tudo seria construído por nós. O convite por e-mail exige chave secreta no servidor e SMTP próprio | **Plugin de organizações:** convites (o e-mail é nosso), papéis, permissões personalizadas e organização ativa na sessão |
| **Fastify** | Sem guia oficial para Fastify. Verificação de JWT pela JWKS (chaves assimétricas ES256) | Integração com exemplo oficial na documentação (rota `/api/auth/*`) |
| **RLS** | Equivalente à B se o backend conectar com papéis próprios (seção 6.4) | Direto: o usuário vem da sessão no servidor |
| **Dependência externa** | O serviço de Auth do Supabase precisa estar no ar para haver login. Usuários em esquema gerenciado (`auth`). Cobrança por usuários ativos | Só o PostgreSQL. A biblioteca roda na nossa API, e o banco é portável |
| **Operação** | Menos código. Limites de taxa e atualizações de segurança por conta do Supabase | Nós atualizamos e configuramos a biblioteca: versão travada, `argon2id` (o padrão é `scrypt`), limite de taxa com armazenamento no banco |
| **Super Admin** | Construído por nós | Plugin de administração: papel global, bloqueio de usuário. A personificação deve ficar **desligada** ou auditada |

**Recomendação: B (Better Auth)**, com estas condições:
- versão exata travada, conferida na instalação. A versão e a licença não puderam ser confirmadas hoje (o npm recusou o acesso);
- tabelas no esquema `identity`, pelo papel `dz_auth`;
- senhas com `argon2id`;
- *cookie cache* desligado;
- 2FA obrigatório para Super Admin;
- personificação desligada;
- provedor de e-mail definido antes dos fluxos de convite e recuperação.

**Por quê:**
- sessão por cookie revogável, como a ARQUITETURA_SAAS §4.1 já previa;
- organizações e convites prontos, sem duplicar;
- nenhuma dependência além do banco.

A §4.1 recomendava uma implementação própria; a B reduz o código a manter. **A decisão é do dono do produto.**

Qualquer que seja a escolha, **um provedor de e-mail transacional será necessário** antes de convites e recuperação de senha.

---

## 8. Resumo de segurança
- Projeto e organização exclusivos; MFA na conta e na organização; senhas só no gerenciador.
- Data API desativada; tabelas fora do `public`; nenhum `GRANT` para `anon`, `authenticated`, `service_role` ou `PUBLIC`.
- SSL obrigatório com `verify-full`; restrição de rede em produção.
- Papéis próprios sem `BYPASSRLS`; `postgres` e `service_role` fora do código; URL de migration fora da API e do worker.
- RLS habilitado e forçado; contexto local da transação; chaves compostas; testes negativos A×B.
- Nenhuma credencial no painel React, em logs, em documentação ou no chat; erros sem URL nem valores.

---

## 9. Plano de testes (futuro — nada é executado nesta fase)

**Execução:**
- `npm run test:db`, **separado** do `npm test`, que continua sem rede.
- Só contra o **projeto de testes**, com duas organizações fictícias ("Empresa Teste A" e "Empresa Teste B") e nenhum dado real.

**Trava de segurança:** a suíte aborta se `DATABASE_TEST_URL` estiver vazio ou apontar para o mesmo host de `DATABASE_URL`.

| # | Teste | Esperado |
|---|---|---|
| 1 | **Conexão segura** | Conecta com `verify-full` e o certificado correto; falha com certificado errado e sem TLS (com o SSL obrigatório ligado) |
| 2 | **Credenciais inválidas** | Senha errada ou variável ausente: erro claro, sem URL, senha ou host na mensagem; a API não inicia |
| 3 | **Permissões mínimas** | `dz_app` com `rolsuper` e `rolbypassrls` falsos; não cria, altera nem apaga tabelas; não faz `TRUNCATE`; não acessa `identity`, `auth` nem `storage`; não troca de papel; não altera nem apaga `audit_logs` |
| 4 | **Isolamento A×B** | Com o contexto A, só aparecem linhas de A; `INSERT` com `organization_id` de B falha (`WITH CHECK`); `UPDATE`/`DELETE` em linhas de B afetam 0 linhas |
| 5 | **Acesso cruzado pela API** | Usuário de A pedindo `/orgs/B/...` recebe 403/404; `orgId` adulterado no corpo ou na rota não muda o contexto |
| 6 | **Contexto em conexões reaproveitadas** | Com pool de 1 conexão: a transação 1 (A) termina e a transação 2, sem contexto, vê 0 linhas; o mesmo após um erro (`ROLLBACK`); requisições paralelas A e B não se misturam; nenhum `SET` de sessão no código |
| 7 | **Chaves compostas** | Registro-filho de A apontando para registro-pai de B é recusado pela chave estrangeira |
| 8 | **Migrations repetíveis** | Do zero até a última; reaplicar não faz nada; `drizzle-kit check` limpo; consulta ao catálogo confirma RLS habilitado **e forçado** em toda tabela de empresa e as políticas esperadas |
| 9 | **Catálogo** | Nenhuma tabela dos nossos esquemas com permissão para `anon`, `authenticated`, `service_role` ou `PUBLIC`; nenhuma função nossa executável por `PUBLIC` |
| 10 | **Backup e restauração** | No Free, exportação lógica restaurada no projeto de testes. No Pro, restauração de backup diário num projeto duplicado. Nos dois casos: redefinir as senhas dos papéis, conferir a contagem de registros e as políticas, medir o tempo |

---

## 10. Limitações e pontos a confirmar
- **Preços e limites:** os valores da seção 2.3 são de 2026-11-01; o preço do add-on de IPv4 não consta na página.
- **No painel:** a versão do PostgreSQL, a região e a disponibilidade das restrições de rede por plano.
- **Na VPS:** se a VPS Hostinger em São Paulo tem IPv6 (levantamento I1).
- **Na preparação:** se `postgres` cria papéis com os atributos da seção 6.2.
- **Data API:** se desligá-la também desliga o GraphQL.
- **Bibliotecas:** a versão estável do Drizzle (v1 candidata × 0.x) e a versão e a licença do Better Auth, na instalação.
- **Plano Free:**
  - pausa após 1 semana sem uso e não tem backups;
  - o projeto de testes pode precisar ser reativado antes da suíte.
- **Senhas e backups:** as senhas dos papéis não entram nos backups.
- **Documentos desatualizados:** a ARQUITETURA_SAAS (§3.2 Testcontainers, §10) e o PLANO_IMPLANTACAO_HOSTINGER (PostgreSQL em
  contêiner na VPS, serviço de backup) ainda descrevem o banco antigo. A atualização deles **depende de autorização**.

---

## 11. Próximas autorizações necessárias (em ordem)
1. **Decisão de autenticação (D3):** A ou B (recomendada: B).
2. **Criação manual pelo dono do produto:** organização, projeto `disparazap` e, se aprovado, `disparazap-test`, seguindo a
   seção 2, com as configurações de segurança da seção 2.5.
3. **Dependências npm** em `saas/`: Drizzle, drizzle-kit e o driver do PostgreSQL (e Better Auth, se B), com versões travadas.
4. **SQL de preparação** (papéis e esquemas, sem senhas): revisado e executado pelo dono do produto no projeto de testes, depois
   no `disparazap`. Senhas definidas pelo próprio dono, direto no gerenciador de senhas e no `saas/.env`.
5. **Pacote `packages/db`:** a conexão com validação Zod, `withOrgContext` e a suíte `test:db`, primeiro contra o projeto de testes.
6. **Primeira migration** (identidade, organizações, participações e auditoria): no projeto de testes e, depois de aprovada, no
   `disparazap`.
7. **Atualização da ARQUITETURA_SAAS e do PLANO_IMPLANTACAO_HOSTINGER** para refletir o Supabase.

---

## Fontes (consultadas em 2026-11-01)
- Conexões: [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres),
  [Supavisor FAQ](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI),
  [Pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits),
  [Compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk),
  [IPv4 address](https://supabase.com/docs/guides/platform/ipv4-address)
- Papéis e RLS: [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles),
  [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security),
  [Custom role inherits privileges](https://supabase.com/kb/troubleshooting/custom-role-inherits-privileges-that-were-not-explicitly-granted),
  [Securing your API](https://supabase.com/docs/guides/api/securing-your-api),
  [Changelog: tabelas não expostas automaticamente](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- Plataforma: [Pricing](https://supabase.com/pricing), [Backups](https://supabase.com/docs/guides/platform/backups),
  [Regions](https://supabase.com/docs/guides/platform/regions),
  [Network restrictions](https://supabase.com/docs/guides/platform/network-restrictions),
  [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement),
  [Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod),
  [Billing](https://supabase.com/docs/guides/platform/billing-on-supabase)
- Supabase Auth: [Auth](https://supabase.com/docs/guides/auth), [Sessions](https://supabase.com/docs/guides/auth/sessions),
  [MFA](https://supabase.com/docs/guides/auth/auth-mfa), [Server-side](https://supabase.com/docs/guides/auth/server-side),
  [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Rate limits](https://supabase.com/docs/guides/auth/rate-limits),
  [Signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- Better Auth: [Fastify](https://www.better-auth.com/docs/integrations/fastify),
  [Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle),
  [Sessões](https://www.better-auth.com/docs/concepts/session-management),
  [E-mail e senha](https://www.better-auth.com/docs/authentication/email-password),
  [2FA](https://www.better-auth.com/docs/plugins/2fa), [Organizações](https://www.better-auth.com/docs/plugins/organization),
  [Admin](https://www.better-auth.com/docs/plugins/admin), [Rate limit](https://www.better-auth.com/docs/concepts/rate-limit)
- Drizzle: [Connect Supabase](https://orm.drizzle.team/docs/connect-supabase), [RLS](https://orm.drizzle.team/docs/rls),
  [Migrations](https://orm.drizzle.team/docs/migrations), [push](https://orm.drizzle.team/docs/drizzle-kit-push),
  [Custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations), [Mudanças da v1](https://orm.drizzle.team/docs/v0-v1-changes)
- Hostinger: [Localização dos servidores](https://www.hostinger.com/support/1583267-where-are-your-servers-located)
