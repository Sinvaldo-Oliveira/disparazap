# Changelog de Desenvolvimento — DisparaZap

Registro cronológico das alterações no projeto, da mais recente para a mais antiga.

**Como registrar:** uma entrada por dia ou fase de trabalho, com data absoluta (`AAAA-MM-DD`) e itens agrupados em
**Adicionado**, **Alterado**, **Corrigido**, **Segurança**, **Documentação**. Diga o que mudou e por quê, citando os arquivos.
Nunca registre senhas, tokens, chaves, URLs privadas de servidores ou dados pessoais reais.

---

## 2026-11-01 — Encerramento da Fase 4

Fase 4 registrada num **único commit local autorizado**, `feat: establish DisparaZap SaaS foundation`. O hash está no `git log`.
Sem remoto, push ou deploy. Nenhuma dependência nova, nenhum acesso a serviços reais ou à VPS.

### Corrigido
- **Teste intermitente de inicialização da API.**
  - **Sintoma:** a primeira tentativa de commit foi interrompida porque o teste "inicia de forma independente…" de
    `saas/apps/api/src/startup.spec.ts` falhou por tempo esgotado (suíte com 58/59).
  - **Causa:** o teste espera a API por até 15 s (`expect.poll`), mas o Vitest encerra cada teste em 5 s por padrão.
  - **Correção (opção A, aprovada):** limite explícito de 30 s só nos três testes que sobem processos reais: os dois de
    `saas/apps/api/src/startup.spec.ts` e o de processo de `saas/apps/worker/src/worker.spec.ts`.
  - **O que não mudou:** a espera interna de 15 s, o limite global do Vitest e o código da API e do worker.
  - **Comprovação:** com o limite global reduzido a 1 s pela linha de comando, os três testes passaram. O limite por teste,
    portanto, é aplicado.

### Documentação
- **`CLAUDE.md`:**
  - descreve os dois projetos do repositório (MVP na raiz, SaaS em `saas/`);
  - tem nova seção sobre o monorepo: estrutura, comandos de desenvolvimento, testes, typecheck e build, e regras de código;
  - as seções do MVP passaram a ter "do MVP" no título.
- **`CLAUDE.md`, regras obrigatórias novas:**
  - separação entre MVP e SaaS;
  - proibição de conectar serviços reais ou modificar a VPS sem autorização;
  - consulta e atualização da documentação a cada fase;
  - testes e builds dos dois projetos antes de concluir;
  - nomes de teste `.spec` no SaaS.
- **`docs/DISPARAZAP_MASTER.md`:** Fase 4 registrada em commit; `CLAUDE.md` atualizado.

### Verificações antes do commit (depois da correção)
Todas passaram na primeira tentativa de cada rodada, sem repetição.

| Verificação | Resultado |
|---|---|
| Testes de processo isolados, 3 rodadas | 3/3 em cada; a API levou 4,1 s, 3,1 s e 7,6 s para subir |
| Suíte completa do SaaS, 3 rodadas | 59/59 em cada; a API levou 11,1 s, 12,4 s e 11,6 s |
| Processos filhos dos testes | Nenhum ativo depois de cada rodada |
| `npm run typecheck` | 0 erros |
| `build:api`, `build:worker`, `build:web`, `build` | Concluídos |
| MVP, `npm test` | 42/42, sem executar testes do SaaS |
| Arquivos do MVP | Mesmo hash de antes do encerramento |
| Varredura de segredos | Sem ocorrências nos arquivos versionados |

### Observações
- **Correção do relatório da Fase 4:** o processo do worker compilado, iniciado no teste manual da Fase 4
  (`npm run start -w @disparazap/worker`), ficou ativo desde 2026-10-31.
  - Naquele dia só as portas foram conferidas, e o worker não abre porta.
  - Foi detectado nesta verificação. Não acessa rede nem dados.
  - O encerramento ficou a cargo do usuário, porque a ferramenta não teve permissão para encerrar processos.
- **Margem dos testes de processo:**
  - nas rodadas da suíte completa, a máquina estava com CPU em 100% e pouca memória livre, por causa de outros programas;
  - a subida da API (até 12,4 s) ficou perto da espera interna de 15 s;
  - se voltar a falhar, a mensagem indicará a espera esgotada;
  - medida possível: rodar os testes de processo num projeto Vitest separado e sequencial.

---

## 2026-10-31 — Fase 4: fundação técnica do SaaS

Tudo novo está em `saas/`. O MVP não foi alterado (`server.js`, `index.html`, `phone.js`, `tests/`, `package.json`/lock e
`.gitignore` da raiz intactos). Nenhuma conexão com Evolution Go, Zernio, MyLinksss, banco ou Redis. Nada instalado no sistema;
nenhum serviço Docker iniciado. Registrada em commit local em 2026-11-01, depois da correção de um teste intermitente (entrada acima).

### Adicionado
- `saas/`: monorepo npm workspaces (lockfile próprio) com `apps/api`, `apps/web`, `apps/worker`, `packages/contracts`, `packages/shared`.
- **API (Fastify 5):**
  - configuração validada com Zod;
  - escuta em `127.0.0.1:3100` por padrão;
  - `GET /health/live`;
  - prefixo `/api/v1` reservado, sem rotas;
  - erros centralizados em RFC 9457, sem stack;
  - logs pino sem cabeçalhos nem query string, com redação;
  - CORS por lista explícita (vazia por padrão);
  - cabeçalhos de segurança;
  - encerramento controlado.
- **Painel (React 19 + Vite 8 + React Router 8):**
  - identidade visual, menu lateral responsivo com as 9 seções e cabeçalho com "Em construção";
  - Visão Geral com status real da API e lista de módulos;
  - página "Em desenvolvimento" para os 8 módulos;
  - página 404;
  - sem login nem dados fictícios;
  - permissão declarada por item do menu.
- **Worker:** inicialização independente, configuração validada, ciclo de vida, registro de filas vazio, encerramento controlado.
  Sem Redis, sem tarefas.
- **Pacotes:** `contracts` (health check e erro RFC 9457) e `shared` (`parseEnv`, logger com redação, `handleShutdownSignals`).
- **Testes:** 59 testes Vitest (pacotes, API com `inject` e processo real, worker, painel em jsdom), todos aprovados.
- **Documentação:** `saas/README.md`, `saas/docs/ESTRUTURA_TECNICA.md`, `saas/docs/DECISOES_TECNICAS.md`, `saas/infra/docker/README.md`.
- `saas/.env.example` (só valores padrão) e `saas/.gitignore` (`dist/`, `*.tsbuildinfo`, `.env*`).

### Verificações
- TypeScript (`npm run typecheck`): 0 erros em pacotes, API, worker, painel e arquivos de teste.
- Builds de API, worker (`tsc -b`) e painel (`vite build`) concluídos.
- Os três processos iniciaram de forma independente; o painel consultou a API pelo proxy do Vite.
- `npm test` da raiz (MVP): 42/42, sem executar testes do SaaS.
- `npm audit` do SaaS: 0 vulnerabilidades.

### Observações
- O Node 24 está em Maintenance LTS desde 2026-10-20; o Node 26 virou Active LTS em 2026-10-28. A máquina usa 24.17.0 (o mais recente é 24.22.2).
- O worker passou a ser aplicação própria (`apps/worker`), diferente do previsto na ARQUITETURA_SAAS §3.3.
- Pendências: ESLint/Prettier; Docker Compose. O `CLAUDE.md` foi atualizado no encerramento da fase (2026-11-01).

---

## 2026-10-31 — Fase 3: git, preservação e correções de segurança do MVP

Nenhum envio real, nenhuma instância criada, nenhum acesso à VPS. Registrado em dois commits locais autorizados (seção Git).
Detalhes, riscos pendentes e reversão em `docs/SEGURANCA_MVP.md`.

### Git
- `908ca2f` `chore: preserve original DisparaZap MVP`: estado anterior à Fase 3 (12 arquivos), comprovado igual à cópia de preservação.
- Commit seguinte `fix: harden DisparaZap MVP security`: tudo o que está nesta entrada.
- **Correção:** o relatório da Fase 3 e a primeira versão destes documentos diziam que o original foi preparado no índice antes de
  qualquer mudança, mas o `.gitignore` já tinha sido revisado. A divergência foi detectada na verificação anterior ao commit.
  Com autorização, a entrada do `.gitignore` no índice foi trocada pela versão da cópia de preservação.

### Adicionado
- Repositório **git local** (`main`, sem remoto).
- Cópia de preservação em `backup/estado-original-2026-10-31/` com `MANIFESTO.sha256` (sem `.env`; ignorada pelo git).
- `phone.js`: regra única de telefone (formato internacional; sem `+` só Brasil; nunca acrescenta DDI), usada pelo servidor
  e pelo navegador; servida em `GET /phone.js`.
- `tests/`: 42 testes `node:test`:
  - telefone;
  - servidor contra Evolution simulado, incluindo TLS com certificado gerado na hora;
  - interface completa em jsdom.

  Script `npm test`. Dependências **só de desenvolvimento**: `jsdom` e SheetJS 0.20.3 (pacote oficial da SheetJS).
- `.env.example` recriado, com `HOST` e `EVOLUTION_CA_FILE` opcionais.
- `docs/SEGURANCA_MVP.md`.

### Segurança
- `server.js`:
  - escuta em `127.0.0.1` por padrão (uso exclusivo nesta máquina confirmado pelo dono do produto);
  - verificação TLS obrigatória (`rejectUnauthorized: true` explícito), com `EVOLUTION_CA_FILE` opcional;
  - redirects só para o mesmo host e nunca de HTTPS para HTTP;
  - respostas por lista de campos permitidos (`{ name, connected }` e `{ ok, messageId }`);
  - erros do Evolution reduzidos a texto curto e erros de rede/TLS com mensagens fixas, sem URL;
  - telefone revalidado no servidor;
  - mensagem clara para `HOST` inválido.
- Certificado do Evolution real conferido **só por handshake TLS** (autorizado): Let's Encrypt, válido até 2027-01-14.

### Alterado
- `index.html`:
  - validação de telefone pela regra de `phone.js`, com mensagem do motivo;
  - importação Excel informa os motivos das linhas ignoradas;
  - detecção de coluna de telefone por "parece telefone";
  - textos de ajuda sobre DDI.
- `.gitignore`: `.env.*` (exceto `.env.example`), chaves/certificados, logs, `backup/`, `coverage/`.
- `package.json`: script `test`, `engines` (Node ≥ 22), dependências de desenvolvimento.
- `CLAUDE.md`:
  - variáveis `HOST`/`EVOLUTION_CA_FILE`;
  - arquivos `phone.js`/`tests/`;
  - regras de TLS, rede, git e testes;
  - remoção da instrução antiga de aceitar certificado autoassinado;
  - regra de telefone.
- `docs/DISPARAZAP_MASTER.md`: decisões da Fase 3, pendências e etapa 0 do roteiro.

### Pendente (proposto, não implementado)
- Limites de envio no servidor (P1–P5), validação de `Host` (V6), SRI na CDN (V8), cabeçalhos de segurança (V9).

---

## 2026-10-31 — Auditoria inicial, arquitetura do SaaS e plano de implantação

Somente documentação e verificações locais. Nenhuma funcionalidade, dependência, banco, servidor ou VPS foi alterado;
nenhuma mensagem foi enviada.

### Documentação — Fase 2 (arquitetura)
- Criado `docs/ARQUITETURA_SAAS.md`:
  - diagnóstico de segurança atualizado com evidências (V1–V14);
  - monólito modular proposto (Node 24 + TS, Fastify, Drizzle, PostgreSQL 17 com RLS, Redis + BullMQ, React + Vite, Caddy);
  - autenticação por sessão com 2FA, RBAC e multi-tenancy;
  - adaptador Evolution Go com tabela de verificação de endpoints;
  - motor de campanhas, API `/v1` e webhooks assinados;
  - modelo de dados (sem migrations);
  - plano incremental (etapas 0–10) e decisões D1–D10.
- Criado `docs/PLANO_IMPLANTACAO_HOSTINGER.md`:
  - levantamento somente leitura da VPS (a executar com autorização) e topologias A/B/C do Evolution Go;
  - requisitos mínimos, containers e redes, portas e firewall, HTTPS com Caddy;
  - volumes, segredos, backup e restauração, health checks, logs e métricas, limites;
  - deploy/rollback, homologação separada e decisões I1–I7.
- `docs/DISPARAZAP_MASTER.md`: hospedagem na Hostinger registrada; novas decisões; mapa da documentação; resumo da arquitetura
  proposta; decisões pendentes ligadas a D1–D10 e I1–I7; roteiro substituído pelas etapas 0–10.
- `CLAUDE.md`: os dois novos documentos adicionados à tabela de documentação.

### Segurança — verificações (sem correção aplicada)
- Verificado localmente, com o servidor apontando para um Evolution **falso**:
  - o servidor escuta em todas as interfaces e responde pelo IP da rede local;
  - aceita `Host` forjado (risco de DNS rebinding);
  - não envia cabeçalhos de segurança;
  - não limita taxa (30/30 requisições repassadas).
- Funcionam: bloqueio de CORS, CSRF por formulário (401) e limite de corpo (413).
- `sanitizeInstance` só filtra campos de primeiro nível: campos aninhados, `proxy` com credenciais e `qrcode` chegam ao navegador.
- `normalizePhone` aceitou 8 de 9 entradas inválidas (sem DDI, zero de tronco, números colados).
- `npm audit`: 0 vulnerabilidades. O pacote `xlsx` do npm está na 0.18.5 (vulnerável); o MVP usa a 0.20.3 da CDN oficial.

### Errata
- `.env.example` **não existe** na pasta (a auditoria inicial o listou por engano; provavelmente foi renomeado para `.env`).
  A auditoria foi preservada como registro histórico; a recriação do arquivo está na etapa 0 do plano.

### Documentação — Fase 1 (auditoria)
- Criado `docs/AUDITORIA_INICIAL.md`: inventário, funcionalidades, achados de segurança, limitações, lacunas frente
  à visão SaaS, riscos, recomendações e perguntas em aberto.
- Criado `docs/DISPARAZAP_MASTER.md`: visão, módulos planejados, arquitetura atual e alvo, princípios, decisões e roteiro.
- Criado este `docs/CHANGELOG_DESENVOLVIMENTO.md`.
- `CLAUDE.md`: adicionadas as seções de documentação do projeto e de proteção de credenciais; comando `npm run dev`
  documentado; corrigida a resposta de `/instance/status` (`data.connected`/`data.loggedIn`, conforme a documentação
  da API); registrado que a regra de "editar só `index.html`/`server.js`" vale para a fase de MVP.

---

## 2026-10-30 — MVP do disparador

### Adicionado
- `server.js`: proxy Express para o Evolution Go com `proxyFetch` em módulos nativos (`http`/`https`), redirects
  (até 5 saltos), timeout de 30s e mensagens de erro em português. Rotas `GET /api/instances` e `POST /api/send/text`.
- `index.html`: assistente de 5 etapas (Instância, Contatos, Mensagem, Delay, Disparar) com importação de Excel
  (SheetJS 0.20.3 via CDN), `{nome}`, variações A/B, pré-visualização, intervalo aleatório, progresso, log e resumo.
- `package.json` (express + dotenv; scripts `start` e `dev` com `node --watch`), `.env.example` e `.gitignore`.

### Alterado
- `server.js`: só respostas 302/303 transformam a requisição em GET; 301/307/308 mantêm o método, para que um
  redirecionamento http → https não quebre o envio (conforme o `CLAUDE.md`).
- `server.js`: mensagem clara quando a porta já está em uso (`EADDRINUSE`), em vez de erro técnico.

### Segurança
- `GLOBAL_API_KEY` usada só no servidor; campos com `token`/`apikey`/`secret`/`password` removidos de cada instância
  em `/api/instances`.
- Servidor entrega só `GET /` (sem `express.static`), então `.env`, `server.js` e `node_modules` retornam 404.
- Escape de HTML (`esc()`) em tudo que é exibido; token da instância enviado no header `X-Instance-Token`.

### Corrigido (já nasceu corrigido, conforme os bugs conhecidos do `CLAUDE.md`)
- Status da instância lido de `connected` (booleano) com alternativa em `connectionStatus`/`status`.
- Pré-visualização exibida com `display = 'block'` explícito.
- Token recusado (`not authorized`/401) interrompe o disparo com orientação ao usuário.

### Validação
- Proxy testado contra um Evolution Go simulado (redirect, token certo/errado, validações, servidor fora do ar).
- Interface testada de ponta a ponta em navegador headless (jsdom): 59 verificações aprovadas.
- `GET /api/instances` confirmado contra o servidor Evolution Go real.
- Os scripts de teste ficaram fora do repositório (ver recomendação Q2 da auditoria).
