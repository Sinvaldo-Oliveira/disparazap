# Changelog de Desenvolvimento — DisparaZap

Registro cronológico das alterações no projeto, da mais recente para a mais antiga.

**Como registrar:** uma entrada por dia ou fase de trabalho, com data absoluta (`AAAA-MM-DD`) e itens agrupados em
**Adicionado**, **Alterado**, **Corrigido**, **Segurança**, **Documentação**. Diga o que mudou e por quê, citando os arquivos.
Nunca registre senhas, tokens, chaves, URLs privadas de servidores ou dados pessoais reais.

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
