# DisparaZap — SaaS (fundação técnica)

Fundação do futuro painel SaaS do DisparaZap: **monólito modular** com API, painel web e worker,
em TypeScript, num monorepo com npm workspaces.
- **Fase 4:** a fundação técnica.
- **Desde 2026-11-01:**
  - autenticação (cadastro com empresa, login, sair e três tipos de usuário);
  - integração global com a Evolution Go, configurada pelo Super-Admin;
  - módulo WhatsApp: cada empresa cria a sua instância e conecta o número por QR Code ou código de pareamento;
  - Envio de Mensagens: o disparador do MVP dentro do painel, com listas de contatos salvas por empresa.
  - Contatos: gestão das listas da empresa, com criação e busca.
- **Ainda não há** filas, campanhas no servidor nem as demais funcionalidades comerciais.
- **Só fala com a Evolution Go quando o Super-Admin configura a integração.** Ela é usada para criar, conectar, consultar e
  excluir instâncias e para enviar as mensagens que a empresa disparar. Nada aqui conecta a Zernio ou ao MyLinksss.

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
| `npm run dev:api` | API Fastify, reinicia ao salvar. **Uma janela só:** uma segunda API sobre o mesmo banco embutido é recusada (trava `saas/.data/pglite.lock`) | `http://127.0.0.1:3100/health/live` |
| `npm run dev:web` | Painel React (Vite) | `http://127.0.0.1:3000` |
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

- Os testes não acessam rede externa nem serviços reais. A Evolution Go é sempre um simulador local.
- Os testes de inicialização sobem os processos de verdade, só em `127.0.0.1`.
- Os testes do SaaS usam o sufixo `.spec.ts(x)`, para o `npm test` da raiz (MVP) não os executar.

## Estrutura

```text
saas/
├── apps/
│   ├── api/       # Fastify: config, plugins, autenticação, cofre, integração Evolution Go, rotas
│   ├── web/       # React + Vite: telas de entrar/criar conta, layout, menu, Configurações, WhatsApp, Envio de Mensagens, Contatos
│   └── worker/    # Processo de filas (vazio nesta fase)
├── packages/
│   ├── contracts/ # Contratos públicos (health, erros, sessão, plataforma, WhatsApp, mensagens, telefone) — API e painel
│   ├── db/        # Só servidor: schema Drizzle, migrations e conexão (PostgreSQL ou banco embutido)
│   └── shared/    # Só servidor: validação de ambiente, logger com redação, encerramento controlado
├── infra/docker/  # Reservado para o Docker Compose (ainda não criado)
├── infra/hostinger/ # Publicação no aplicativo Node.js da Hostinger (pacote, entrada, passo a passo)
└── docs/          # ESTRUTURA_TECNICA, DECISOES_TECNICAS, SUPABASE_CONFIGURACAO, PLANO_MODULO_WHATSAPP
```

Detalhes em [docs/ESTRUTURA_TECNICA.md](docs/ESTRUTURA_TECNICA.md); escolhas e alternativas em
[docs/DECISOES_TECNICAS.md](docs/DECISOES_TECNICAS.md).

## Variáveis de ambiente

Ver [.env.example](.env.example). Todas têm padrão seguro; valores inválidos impedem a inicialização com
uma mensagem que cita a variável, sem repetir o valor.

## Autenticação (desde 2026-11-01)

- **Primeiro acesso:**
  1. `npm run dev:api` e `npm run dev:web`;
  2. abra `http://127.0.0.1:3000`;
  3. use **Criar conta**, que cria a conta e a empresa (tipo Admin-Empresa).
- **Banco:**
  - sem `DATABASE_URL` no `saas/.env`, a API usa um **banco embutido** (PGlite) em `saas/.data/pglite`, ignorado pelo git;
  - para recomeçar do zero, pare a API e apague essa pasta;
  - com o Supabase configurado (`DATABASE_URL` + `DATABASE_CA_FILE`), o banco embutido não é usado.
- **Super-Admin:**
  1. preencha `SUPER_ADMIN_EMAIL` no `saas/.env`;
  2. **com a API parada**, rode `npm run admin:create`. Ele pede nome e senha no terminal; a senha não aparece nem fica gravada.

  Esse e-mail fica reservado: ninguém se cadastra com ele.
- **Tipos de usuário:** Super-Admin, Admin-Empresa e Admin-MyLinksss. O último ainda não tem caminho de entrada (pendente:
  "Entrar com MyLinksss").
- **Migrations:**
  - `npm run db:generate` gera o SQL a partir do schema;
  - `npm run db:check` confere o histórico;
  - `npm run db:migrate` aplica no banco de `DATABASE_MIGRATION_URL`, só com autorização;
  - nunca use `drizzle-kit push` em banco remoto.
- **Detalhes:** [docs/ESTRUTURA_TECNICA.md §8](docs/ESTRUTURA_TECNICA.md) e [docs/DECISOES_TECNICAS.md](docs/DECISOES_TECNICAS.md)
  (D-18 a D-24).

## WhatsApp (desde 2026-11-01)

1. **Super-Admin, em Configurações:** informa o endereço da Evolution Go e a chave global, salva e testa a conexão.
   - A chave fica cifrada no banco com a `SECRETS_MASTER_KEY` do `saas/.env` e nunca volta para a tela.
2. **Empresa, em WhatsApp** (dono ou administrador): cria a instância (limite padrão: 1) e conecta por **QR Code** ou **código
   de pareamento**.
   - Quem só visualiza vê o status, sem botões.
3. **Super-Admin, em WhatsApp:** vê todas as instâncias de todas as empresas, só leitura.

- **O que nunca vai ao navegador:** a chave global e o token de cada instância.
- **Instâncias de fora:** as instâncias criadas no MVP ou à mão não aparecem nem são alteradas.
- **Situação:** testado só contra a Evolution simulada. A homologação no servidor real depende de autorização.
- **Detalhes:** [docs/ESTRUTURA_TECNICA.md §9 e §10](docs/ESTRUTURA_TECNICA.md) e [docs/DECISOES_TECNICAS.md](docs/DECISOES_TECNICAS.md)
  (D-25 a D-35).

## Envio de Mensagens (desde 2026-11-01)

Menu **Envio de Mensagens**, um assistente de 5 etapas portado do disparador do MVP:
1. **Instância:** escolha uma das instâncias conectadas da empresa. O token fica no servidor.
2. **Contatos:** use uma lista salva ou monte uma nova (à mão ou por planilha Excel) e salve-a para a próxima vez.
3. **Mensagem:** imagem (opcional, uma por mensagem), texto com `{nome}`, CTA (texto + link no fim da mensagem) e variações
   (Teste A/B), com pré-visualização ao vivo. Dá para **salvar como modelo** e reutilizar.
4. **Intervalo:** tempo aleatório entre o mínimo e o máximo.
5. **Disparar:** com progresso, log, "Parar" e resumo.

- **Isolamento:** cada empresa vê só as suas instâncias, listas, imagens e modelos.
- **Quem envia:** dono, administradores e operadores. Quem só visualiza vê as listas, mas não envia nem altera.
- **O disparo roda nesta aba:** deixe a página aberta até o fim. Sair da página interrompe o envio.
- **Envio com a página fechada, fila e histórico:** vêm com o módulo Campanhas.
- **Situação:** testado contra a Evolution simulada. Com a integração apontando para o servidor real, **as mensagens são
  enviadas de verdade**.
- **Detalhes:** [docs/ESTRUTURA_TECNICA.md §11](docs/ESTRUTURA_TECNICA.md) e [docs/DECISOES_TECNICAS.md](docs/DECISOES_TECNICAS.md)
  (D-36 a D-42).

## Contatos (desde 2026-11-01)

Menu **Contatos**, com as mesmas listas que aparecem no Envio de Mensagens:
- **Listas:** resumo, **busca** (pelo nome da lista e, a partir de 2 letras, pelo nome ou telefone dos contatos de todas as
  listas), **Nova lista** e excluir.
- **Uma lista** (`/contatos/:id`): renomear, excluir, adicionar contatos à mão ou por planilha do Excel, buscar por nome ou
  telefone, 50 por página, editar e remover um ou vários contatos.
- **Cada alteração é salva na hora.** Exclusões são definitivas e pedem confirmação.
- **Quem altera:** dono, administradores e operadores. Quem só visualiza vê e busca.
- **Ainda não:** consentimento e descadastro (Etapa 8).
- **Detalhes:** [docs/ESTRUTURA_TECNICA.md §11](docs/ESTRUTURA_TECNICA.md) e [docs/DECISOES_TECNICAS.md](docs/DECISOES_TECNICAS.md)
  (D-43 e D-44).

## Integrações: Zernio (desde 2026-11-02)

Menu **Integrações**: reúne o **WhatsApp** (instâncias da Evolution Go, logo abaixo dos cards; antes ficava na página
WhatsApp, e o endereço `/whatsapp` leva para lá) e a **Zernio**. Na Zernio, cada empresa liga a **própria conta** e conecta as
redes sociais que quiser:
1. Crie a conta em zernio.com e uma chave em *API Keys*. Cole a chave em **Testar e salvar**: ela é testada, guardada cifrada
   e só o final aparece.
2. Clique em **Conectar** na rede: Instagram, Facebook, TikTok, LinkedIn, YouTube, Threads, Pinterest, Google Business
   ou X. Autorize na Zernio e na rede; você volta para Integrações com o resultado.
3. Acompanhe as redes conectadas e use **Reconectar** ou **Desconectar** quando precisar.

- **Quem altera:** dono e administradores. Os demais só veem.
- **Custo:** cobrado pela Zernio na conta da empresa.
  - As 2 primeiras redes são grátis, contando a conta Zernio inteira, inclusive o que foi conectado direto no painel da Zernio.
    A mesma rede em dois perfis conta duas vezes. A página Integrações mostra o total que a Zernio conta.
  - O X exige cartão desde a primeira conta e cobra por post.
  - Quando a Zernio pede pagamento, o painel diz o motivo e mostra o link da cobrança da Zernio.
- **Ainda não:** publicar e agendar (página Redes Sociais) e webhooks da Zernio.
- **Detalhes:** [docs/PLANO_MODULO_ZERNIO.md](docs/PLANO_MODULO_ZERNIO.md), [docs/REFERENCIA_ZERNIO.md](docs/REFERENCIA_ZERNIO.md) e
  D-46/D-47.

## Publicar na Hostinger (desde 2026-11-01)

Aplicativo Node.js do hPanel (Business ou Cloud), com o banco no Supabase. Um único processo entrega a API e o painel.
- `npm run producao:segredos`, `npm run producao:migrar` e `npm run producao:admin`: preparam o banco de produção a partir
  do seu computador. Leem `saas/.env.producao`, que fica fora do git.
- `npm run pacote:hostinger`: gera `saas/deploy/disparazap-hostinger.zip` para enviar no hPanel. Use Entry file
  `server.js` e Node.js 24.
- **Passo a passo completo:** [infra/hostinger/README.md](infra/hostinger/README.md). Decisões: D-45.

## Inbox (desde 2026-11-04)

Conversas do WhatsApp das empresas em três colunas (conversas, conversa, detalhes), no menu **Inbox**. Plano:
[docs/PLANO_MODULO_INBOX.md](docs/PLANO_MODULO_INBOX.md); peças: [docs/ESTRUTURA_TECNICA.md](docs/ESTRUTURA_TECNICA.md) §16.

- **O recebimento vem desligado:** `INBOX_EVENTS_ENABLED=false` e `INBOX_ACTIVATION_ENABLED=false` (padrão, também na
  produção). Com elas assim, a API não abre nenhuma conexão com a Evolution e o botão "Receber mensagens na Inbox" fica
  bloqueado.
- **Só ligue as duas na homologação autorizada,** com uma instância de teste
  ([docs/HOMOLOGACAO_I0_EVOLUTION.md](docs/HOMOLOGACAO_I0_EVOLUTION.md), seção 10).
- **Testes** só com a Evolution simulada, que tem WebSocket (`apps/api/src/testing/evolution-simulator.ts`).
- **Uma API por vez** no banco embutido (D-51). A Inbox mantém uma conexão aberta com a Evolution e outra com cada painel
  aberto.

## O que ainda não existe

- **Autenticação:** 2FA do Super-Admin, recuperação de senha, verificação de e-mail, convites e entrada pelo MyLinksss.
- **Banco:** conexão com o Supabase.
- **Infraestrutura:** filas e Docker Compose.
- **WhatsApp:** webhooks da Evolution e ajuste do limite de instâncias pela tela.
- **Inbox:** homologação com instância de teste, mídias (I2), etiquetas e notas (I3), equipe e transferência (I4), Instagram e
  Facebook (I5), comentários (I6), IA e automações (I7 a I9).
- **Mensagens:** campanhas no servidor (fila, histórico, agendamento), consentimento e descadastro.
- **Produto:** os demais módulos de negócio. O painel marca essas seções como **Em desenvolvimento**.
