# Plano — Módulo Inbox (central de atendimento multicanal)

| | |
|---|---|
| **Status** | 🟨 **Decisões N1 a N8 aprovadas** em 2026-11-03 (N5: priorizar armazenamento privado de objetos; N6: sujeita a validação jurídica). **I0:** verificações sem serviço real concluídas em [HOMOLOGACAO_I0_EVOLUTION.md](HOMOLOGACAO_I0_EVOLUTION.md); procedimentos P0 a P7 aguardam autorização. **I1 implementada localmente em 2026-11-04** (ver "Andamento", abaixo da tabela F), testada só com a Evolution simulada; o recebimento fica desligado até a homologação |
| **Data** | 2026-11-03 |
| **Pedido** | "Etapa 01: auditoria e planejamento da Inbox multicanal": conversas de WhatsApp, Instagram, Facebook e demais canais com suporte comprovado, em três colunas, preparada para Agentes de IA, Automações e vários atendentes |
| **Tipo** | Auditoria técnica e planejamento (sem implementação) |
| **Fontes** | Código do DisparaZap (`saas/`); **código-fonte público e wiki oficial da Evolution Go** (`github.com/evolution-foundation/evolution-go`, ramo `main`, versão 0.7.2; lidos em 2026-11-03, sem tocar no servidor real); `doc_evolution_go.md`; **documentação oficial da Zernio** (especificação OpenAPI 1.450.2 e as páginas `docs.zernio.com/platforms/<rede>/inbox`, lidas em 2026-11-03 sem chave) |
| **Referência visual** | Imagem enviada pelo dono do produto: uma bandeja de atendimento de outro produto, em três colunas. Usada só como modelo de organização: o visual segue o design do DisparaZap |

---

## Resumo das descobertas

1. **Hoje o DisparaZap só envia; ele não recebe nada.**
   - Não existe webhook de entrada, fila, tempo real nem tabela de conversas ou mensagens.
   - A Inbox precisa de uma **camada própria de conversas** no banco.
2. **A Evolution Go entrega eventos por WebSocket, sem precisar de endereço público** (confirmado no código-fonte).
   - É a API do DisparaZap que se conecta ao servidor Evolution (`wss://…/ws`).
   - Com isso, dá para **receber mensagens de WhatsApp antes da publicação com HTTPS**.
   - O WebSocket exige a **chave global** (o `doc_evolution_go.md` diz "token da instância", mas o código só aceita a chave global).
   - Ele **não reenvia** o que chegou enquanto a API estava desligada.
3. **As instâncias criadas pelo painel não entregam evento nenhum hoje.**
   - Elas foram conectadas sem `subscribe` e sem WebSocket ou webhook (decisão D-31).
   - Para a Inbox, cada instância precisa ser reconfigurada com `POST /instance/connect`. Pelo código-fonte, isso atualiza as
     configurações **sem desconectar** o número (a confirmar na homologação).
4. **A Evolution Go não guarda o histórico das conversas** e não tem rota para listar mensagens.
   - O histórico existe só a partir do momento em que o DisparaZap começa a receber os eventos.
   - Há uma sincronização de histórico do próprio WhatsApp (`HISTORY_SYNC`, `POST /chat/history-sync`), a avaliar.
5. **As mídias recebidas no WhatsApp chegam dentro do evento, em base64.** Com MinIO/S3 configurado no servidor, chega um
   endereço. É preciso decidir onde guardá-las (decisão N5).
6. **Zernio: Instagram e Facebook têm mensagens diretas completas** (listar, ler, responder, anexos, eventos, controle de quem
   responde).
   - **Janela de 24 h da Meta:** depois de 24 h da última mensagem do cliente, só uma **pessoa** pode responder, com a etiqueta
     `HUMAN_AGENT`, por até 7 dias. **IA e automação não podem responder fora da janela.**
   - **TikTok:** só responde, só contas Business fora da Europa, até 10 mensagens em 48 h.
   - **X:** as conversas criptografadas não aparecem, e cada leitura custa.
   - **LinkedIn, YouTube e Threads:** só comentários.
   - **Google Business:** só avaliações.
   - **Pinterest:** nada.
7. **Equipe de atendimento:**
   - os papéis existentes (`owner`, `admin`, `operator`, `viewer`) cobrem administrador e atendente;
   - **"Supervisor" não existe** (decisão N3);
   - **não há como colocar atendentes numa empresa**: os convites estão desligados desde a auditoria A5. Vários atendentes
     dependem de um módulo de membros/convites.
8. **Tempo real no navegador não existe.** A proposta é um canal de eventos do servidor (SSE) com consulta periódica de reserva.
9. **Primeira etapa recomendada: I1, a base da Inbox com WhatsApp, recebendo por WebSocket.** Ela inclui:
   - banco de conversas e mensagens;
   - recebimento idempotente;
   - tela de três colunas;
   - resposta em texto pelo atendente;
   - tudo testado contra uma Evolution simulada.

---

## A. Diagnóstico da arquitetura

### A.1 Tecnologias (as mesmas dos outros módulos)

| Camada | Situação |
|---|---|
| Código | TypeScript 7 (só sintaxe "apagável"), Node.js 24, monorepo `saas/` com npm workspaces |
| API | Fastify 5 + Zod 4, erros RFC 9457, proteção de origem (CSRF), limite de tentativas em memória por empresa |
| Autenticação | Better Auth com plugin de organizações; sessão em cookie `HttpOnly`; empresa e papel sempre da sessão (`registerMemberContext`) |
| Banco | Drizzle; PGlite embutido no desenvolvimento (um processo por pasta, D-51); Supabase em produção (ainda não conectado); esquema `app` com `organization_id` e chave composta em toda tabela |
| Painel | React 19 + Vite 8 + React Router 8, CSS próprio com tokens; componentes `Card`, `StatusBadge`, `PageHeader`, `PlatformBadge`, painel lateral de detalhes (`PostDetail`), `segmented`, `tiles` |
| Processos | Um processo na Hostinger (API + painel, D-45). O `apps/worker` existe sem filas (D5 pendente). Não há Redis |
| Testes | Vitest, 342 testes, Evolution e Zernio simuladas (nunca serviços reais) |

### A.2 Organização dos módulos que a Inbox reaproveita

| Módulo | Onde | O que serve à Inbox |
|---|---|---|
| WhatsApp das empresas | `apps/api/src/whatsapp/`, `integrations/whatsapp-provider.ts`, `app.whatsapp_instances` | Instâncias da empresa (`provider_instance_id`), token de cada uma no cofre, envio de texto e imagem (`/send/text`, `/send/media`), classificação de falhas |
| Integração global Evolution | `apps/api/src/platform/`, `platform.provider_servers` | Endereço do servidor e **chave global** no cofre (necessária para o WebSocket) |
| Envio de Mensagens | `apps/api/src/messaging/send-text.ts`, `media.ts` | Envio pelo token da instância, regra de telefone, imagens da empresa |
| Contatos | `app.contact_lists`, `app.contacts` | Contatos **por lista** (telefone + nome). Não há um cadastro único de contato por empresa |
| Zernio | `zernio-client.ts`, `zernio-service.ts`, `app.zernio_connections` | Chave da empresa, perfil da empresa, contas conectadas e saúde, endereço fixo, erros classificados |
| Redes Sociais | `apps/api/src/social/` | Padrão de espelho local com sincronização incremental e idempotência (D-48), fuso da empresa (D-49) |
| Segurança | `vault.ts`, `rate-limiter.ts`, `origin-guard.ts`, logger com redação | Segredos cifrados, limites, CSRF, logs sem dados pessoais |

### A.3 Estrutura SaaS e isolamento

- A empresa vem **sempre da sessão**; recurso de outra empresa responde 404. Nenhuma rota confia em `organization_id` vindo do
  navegador.
- O RLS do banco entra com o Supabase. Até lá, o isolamento é feito na API e coberto por testes em todas as rotas.
- **Integrações por empresa:**
  - cada empresa tem as próprias instâncias de WhatsApp, num servidor Evolution compartilhado e com a chave global da
    plataforma;
  - cada empresa tem a própria conta e a própria chave da Zernio.

### A.4 Usuários e permissões (estado real)

| Papel existente | Hoje pode | Uso proposto na Inbox |
|---|---|---|
| `owner` / `admin` | Configurar integrações, instâncias, chave da Zernio; tudo o que o operador faz | **Administrador:** vê todas as conversas, distribui, transfere, configura canais e (futuramente) IA e automações |
| `operator` | Listas, envios, publicações | **Atendente:** conversas atribuídas a ele e a fila sem responsável; responde, assume, transfere, anota |
| `viewer` | Só vê | **Sem acesso à Inbox por padrão** (conversas são dados pessoais). Decisão N3 |
| Super-Admin (plataforma) | Sem empresa: recebe 403 nas rotas de empresa | Sem acesso às conversas das empresas |

**Lacunas:**
- não há papel de **supervisor** (decisão N3);
- **não há como adicionar membros**: a criação de empresas e os convites estão desligados (A5). Hoje cada empresa tem uma
  pessoa só. Para vários atendentes, é preciso o módulo "Empresas e membros", com convite e verificação de e-mail.

### A.5 Tempo real, filas, eventos e webhooks

| Item | Situação |
|---|---|
| Webhooks de entrada | **Não existem** (D-31: a Evolution foi deixada sem webhook; Zernio S8 pendente). Exigem endereço público HTTPS (Hostinger ainda não publicada) |
| WebSocket com a Evolution | **Não existe**, mas é viável sem endereço público (seção B.1) |
| Tempo real no navegador | **Não existe**. Hoje o painel consulta periodicamente (QR a cada 3 s) |
| Filas | Nenhuma. `apps/worker` sem filas; decisão D5 (fila) pendente |
| Eventos internos | Nenhum barramento de eventos |

---

## B. Diagnóstico das integrações

### B.1 Evolution Go (WhatsApp)

**Versão:** a do servidor real não está registrada no projeto. O Swagger foi lido na etapa W1 sem anotar a versão. O código
público atual é a 0.7.2. **Confirmar na homologação (I0):**
- a versão (`/swagger/doc.json`);
- a rota `/ws`;
- o comportamento do `/instance/connect` numa instância conectada.

| Recurso | Situação confirmada | Fonte |
|---|---|---|
| Instâncias da empresa | ✅ Já gerenciadas pelo painel (criar, QR/código, status, desconectar, excluir). Limite padrão: 1 por empresa (W1), ajustável pelo Super-Admin no futuro | Código do DisparaZap |
| **Receber mensagens** | 🟨 Evento `Message` (categoria `MESSAGE`). **Desligado nas instâncias atuais:** foram conectadas sem `subscribe`, e o padrão vira só `MESSAGE` sem nenhum canal de entrega ligado | `pkg/instance/service`, `pkg/whatsmeow/service` |
| Canais de entrega | **WebSocket** `GET /ws?token=<CHAVE_GLOBAL>&instanceId=<id da instância>`: a conexão parte do DisparaZap; uma conexão por instância (a última substitui a anterior); **sem reenvio**. **Webhook** HTTP POST: 5 tentativas a cada 30 s, **sem assinatura**, só `Content-Type`. Também RabbitMQ e NATS (não usados) | `cmd/evolution-go/main.go`, `pkg/events/*` |
| Ligar a entrega | `POST /instance/connect` com o token da instância: `{ "subscribe": ["MESSAGE","SEND_MESSAGE","READ_RECEIPT","CONNECTION"], "websocketEnable": "enabled" }` (e `webhookUrl` depois do HTTPS). Com o cliente já conectado, o código atualiza as configurações "sem reiniciar o cliente" | `instance_service.go` |
| Formato do evento | `{ event: "Message", data: { Info: { Chat, Sender, SenderAlt, IsFromMe, IsGroup, ID, Timestamp, PushName… }, Message: {…} }, instanceId, instanceName, instanceToken }`. **O próprio evento carrega o token da instância:** nunca pode ir para o log | `whatsmeow.go` |
| Mensagens enviadas pelo celular | ✅ Evento `Message` com `Info.IsFromMe = true` (categoria `MESSAGE`): o que o atendente digitar no próprio celular também entra na conversa. **Corrigido na I0:** `SendMessage` é o eco dos envios feitos pela API | `send_service.go`, `whatsmeow.go` |
| Entregue e lida | ✅ Evento `Receipt` com estado `Delivered`, `Read` ou `ReadSelf` | idem |
| Identificação | `Chat` e `Sender` como JID (`5511…@s.whatsapp.net`) ou **LID** (`…@lid`, identificador de privacidade). A Evolution troca para o número quando recebe os dois. A identidade do contato precisa guardar os dois | `CHANGELOG` 0.5.2, `whatsmeow.go` |
| Grupos e status | Chegam como `@g.us` e `@broadcast`. Podem ser ignorados no servidor (`ignoreGroups`, `ignoreStatus`). A Inbox começa só com conversas individuais | idem |
| Mídias recebidas | Imagem, vídeo, áudio, documento e figurinha baixados pela Evolution e postos **em base64 no evento** (ou `mediaUrl` com MinIO/S3 no servidor). Há também `POST /message/downloadmedia` | idem |
| Enviar | ✅ Texto e imagem já implementados. Também `/send/media` (vídeo, áudio, documento, inclusive base64 desde a 0.7.0), `/message/markread`, `/message/presence` (digitando), `/message/react`, `/message/edit`, `/message/delete` | `pkg/routes/routes.go` |
| Histórico | ❌ Sem rota para listar mensagens: a Evolution guarda só a situação de entrega (`Message`: id, data, status). 🟨 `HistorySync` (no pareamento e por `POST /chat/history-sync`) entrega histórico do próprio WhatsApp, em formato a avaliar | `message_model.go`, `routes.go` |
| Desconexão | Eventos `Connected`, `Disconnected`, `LoggedOut`, `TemporaryBan` (categoria `CONNECTION`). Hoje o status vem por consulta periódica (D-38) | `whatsmeow.go` |
| Várias instâncias por empresa | ✅ Suportado pela Evolution; o DisparaZap limita a 1 por padrão | — |

**Limitações:**
- WhatsApp por API **não oficial**: risco de bloqueio do número; não há janela de 24 h, mas há regras de uso do WhatsApp.
- WebSocket sem reenvio: se a API cair, mensagens podem ficar de fora.
- Webhook sem assinatura: será autenticado pelo segredo na URL e pelo token da instância (seção E.6).
- Base64 de vídeos grandes passa pela memória da API.

### B.2 Zernio (redes sociais)

**O que já existe no DisparaZap:**
- chave por empresa e perfil;
- contas conectadas e saúde;
- publicação, métricas e biblioteca (Redes Sociais).

**Mensagens, comentários e webhooks ainda não foram implementados.**

| Recurso da Zernio | Rotas | Observações |
|---|---|---|
| Conversas (DMs) | `GET /v1/inbox/conversations` (perfil, rede, conta, situação, `cursor`, até 100), `GET …/{conversationId}`, `PUT` (arquivar), `GET …/messages` (até 100, `cursor`, `sortOrder`), `POST …/messages` (texto, anexo por URL, botões, respostas rápidas, `messageTag`, `Idempotency-Key`), `POST …/read`, `POST …/typing`, `POST …/thread-control`, `POST …/accept` | A lista cobre Facebook, Instagram, X, Bluesky, Reddit, Telegram, WhatsApp, iMessage e SMS. **TikTok não está na lista desta rota**, embora a página do TikTok diga que lista (divergência) |
| Histórico anterior | Ao conectar Instagram ou Facebook, a Zernio recupera até 500 conversas que já existiam na Meta | Bom para começar a Inbox com histórico nas redes |
| Comentários | `GET /v1/inbox/comments` (posts com comentários, cache de até 10 min), `GET/POST/DELETE …/comments/{postId}`, ocultar, curtir, fixar, resposta privada (Instagram e Facebook) | Comentários e avaliações não são cobrados |
| Avaliações | `GET /v1/inbox/reviews`, responder e apagar resposta | Facebook e Google Business |
| Webhooks | `message.received`, `message.sent`, `message.edited`, `message.deleted`, `message.delivered`, `message.read`, `message.failed`, `conversation.started`, `conversation.control_changed`, `reaction.received`, `comment.received`, `review.new`, `review.updated` | Assinatura HMAC-SHA256 (`X-Zernio-Signature`), deduplicar por `X-Zernio-Event-Id`, responder em até 5 s, até 7 tentativas. O evento traz os perfis com o `externalId`, que no DisparaZap é o id da empresa |
| Plano e custo | Caixa de entrada incluída nos planos por uso; planos antigos pedem complemento (`402`) | Mensagens **enviadas** pela caixa de entrada: as primeiras 10.000 por mês são grátis, depois US$ 1 por 10.000. X cobra cada leitura e envio |
| Limites | 60 pedidos/min com até 2 redes (600 com 3 ou mais) | A consulta periódica precisa de intervalo e cache por empresa |

---

## C. Matriz de compatibilidade dos canais

**Legenda:**
- ✅ confirmado na documentação oficial;
- 🟨 com condição;
- ❌ indisponível.

| Canal (como conecta) | Receber mensagens | Enviar mensagens | Comentários | Responder comentários | Eventos (tempo real) | Mídias | Restrições | Permissões e requisitos | Referência |
|---|---|---|---|---|---|---|---|---|---|
| **WhatsApp** (Evolution Go, instância da empresa) | 🟨 Evento `Message`, depois de ligar `subscribe` e o WebSocket ou webhook na instância | ✅ Texto e imagem (já usados); vídeo, áudio e documento por `/send/media` | ❌ | ❌ | 🟨 WebSocket (sem endereço público, sem reenvio) ou webhook (HTTPS, 5 tentativas, sem assinatura) | ✅ Recebe em base64 (ou URL com MinIO); envia por base64 ou URL | API não oficial (risco de bloqueio); sem histórico guardado; LID; grupos fora do início | Token da instância (enviar) e chave global (WebSocket), ambos no cofre | Código e wiki da Evolution Go (`pkg/routes`, `pkg/events`, `pkg/whatsmeow`, `docs/wiki/recursos-avancados/events-system.md`) |
| **Instagram** (Zernio) | ✅ Listar, ler; webhook `message.received` | ✅ Texto, anexos por URL (imagem, vídeo, áudio), respostas rápidas (13), botões (3), carrossel | ✅ | ✅ Responder, excluir, ocultar; resposta privada (1 por comentário, 7 dias); curtir em liberação limitada | ✅ Mensagens, leitura, edição, exclusão, reações, comentários | ✅ Por URL pública (armazenamento da Zernio) | **Janela de 24 h**; fora dela só `HUMAN_AGENT` digitado por pessoa, até 7 dias. Pedidos de mensagem: só aceitar (a lista responde 400) | Conta Business ou Creator; conexão feita depois de agosto de 2026 já tem os eventos | `docs.zernio.com/platforms/instagram/inbox`, `/messages/*`, `/webhooks` |
| **Facebook** (Zernio, Página) | ✅ | ✅ Texto, anexos (imagem, vídeo, áudio, arquivo), botões, carrossel | ✅ | ✅ Tudo, inclusive curtir e ocultar | ✅ Inclusive entregue e lida | ✅ | **Janela de 24 h** e `HUMAN_AGENT` até 7 dias. Pedidos de mensagem: listar e aceitar. Avaliações da Página | Pessoa Admin ou Editor da Página | `platforms/facebook/inbox` |
| **TikTok** (Zernio) | 🟨 Só contas TikTok Business, conectadas pelo app Business, cadastradas fora da UE, Suíça e Reino Unido, e que aceitam DMs | 🟨 **Só responder**: até 10 mensagens em 48 h depois da última do cliente; texto (6.000) ou 1 imagem JPG/PNG de 3 MB | ✅ | ✅ Responder, ocultar, fixar; excluir só os próprios | 🟨 Comentários chegam por webhook (contas Business) | 🟨 Uma imagem por mensagem | A rota geral de conversas não lista TikTok (divergência na documentação) | Conta Business | `platforms/tiktok/inbox` |
| **X** (Zernio) | 🟨 DMs antigas; as conversas criptografadas ("X Chat") não aparecem; **sem webhook de mensagem** (só consulta) | ✅ Texto e anexos (até 25 MB) | ✅ | ✅ | 🟨 Só `comment.received` | ✅ | **Cada leitura custa US$ 0,005 e cada envio US$ 0,015** (repasse do X); cartão obrigatório | Escopos `dm.read` e `dm.write` | `platforms/twitter/inbox`, `pricing.md` |
| **LinkedIn** (Zernio) | ❌ (o LinkedIn fecha as DMs) | ❌ | 🟨 Só páginas de empresa | ✅ Responder, excluir | 🟨 Comentários lidos por consulta da Zernio (atraso) | — | Sem DMs | Escopos social-feed (conexões antigas reconectam) | `platforms/linkedin/inbox` |
| **YouTube** (Zernio) | ❌ | ❌ | ✅ | ✅ Responder, excluir | 🟨 Consulta da Zernio | — | Sem DMs | Canal da conta autorizada | `platforms/youtube/inbox` |
| **Threads** (Zernio) | ❌ | ❌ | ✅ (respostas ao post) | ✅ Responder, excluir, ocultar | 🟨 Consulta da Zernio | — | Sem DMs | — | `platforms/threads/inbox` |
| **Google Business** (Zernio) | ❌ | ❌ | ❌ (avaliações no lugar) | ✅ Responder avaliações e apagar a resposta | ✅ `review.new`, `review.updated` | — | — | Local verificado | `platforms/compare` (Reviews) |
| **Pinterest** (Zernio) | ❌ | ❌ | ❌ | ❌ | ❌ | — | O Pinterest não tem API de mensagens | — | `platforms/compare` |

**Telegram, Bluesky, Reddit, iMessage e SMS** existem na Zernio, mas não estão entre as redes do DisparaZap (decisão Z5).
**O WhatsApp continua pela Evolution Go**, não pela Zernio.

---

## D. Proposta visual

### D.1 Organização (três colunas, design do DisparaZap)

Novo item de menu **Inbox** (`/inbox`), com a permissão `inbox:view`. A página **Integrações** continua sendo o lugar de
conectar contas; a Inbox só tem o atalho **"Gerenciar conexões"**.

| Coluna 1: Conversas (≈ 320 px) | Coluna 2: Atendimento (o restante) | Coluna 3: Detalhes (≈ 300 px, recolhível) |
|---|---|---|
| Título "Inbox" e contador; **ícones dos canais conectados com o total de não lidas de cada um** (são filtros de visualização, não configuração); "Todos os canais"; filtro por conta (ex.: duas instâncias de WhatsApp ou duas Páginas) | Cabeçalho: nome, foto, canal e conta, **responsável**, situação, **quem responde agora (humano, IA, automação)** e o **tempo restante da janela** (Instagram e Facebook: "janela aberta, restam 23 h 59 min") | Contato: nome, foto, telefone ou usuário, canal de origem, conta vinculada |
| Busca por nome, telefone ou @ | Histórico em ordem: recebidas à esquerda, enviadas à direita, com quem enviou (atendente, IA, automação, celular) e a situação (enviada, entregue, lida, falhou) | Responsável e botão **Transferir** |
| Abas: **Abertas**, **Pendentes**, **Não lidas**, **Encerradas**; filtro **por atendente** (administrador) | Mídias suportadas (imagem com miniatura; áudio, vídeo e documento com botão para baixar pela API) | Situação do atendimento e **etapa** (configurável, como "Novo cliente" e "Agendado") |
| Item: foto ou iniciais, selo da rede (`PlatformBadge`), nome, prévia, hora, contador de não lidas, responsável e etiqueta de etapa | **Eventos no meio da conversa** ("Maria assumiu", "transferida para João", "janela de 24 h encerrada", "IA pausada") | **Etiquetas** e **notas internas** (nunca enviadas ao cliente) |
| — | Campo de resposta com anexo (quando o canal aceitar), aviso de janela fechada, aviso de custo no X; botões **Assumir atendimento**, **Transferir**, **Encerrar** | Histórico de transferências; **IA nesta conversa** (desligada até existir o módulo); automações executadas (futuro); "Excluir conversa" (só administrador, com confirmação) |

**Comentários e avaliações** aparecem como um tipo de conversa ("comentário no post X"), com o post de referência no topo. A
resposta é pública, com o aviso disso na tela.

### D.2 Responsividade

- **Desktop (≥ 1200 px):** três colunas; a terceira recolhe com um botão (estado lembrado no navegador).
- **Entre 960 e 1200 px:** duas colunas; os detalhes abrem como painel lateral, o mesmo padrão dos detalhes das Redes Sociais.
- **Celular:** uma coluna por vez, com navegação por endereço:
  - `/inbox` (lista);
  - `/inbox/:conversa` (atendimento, com "voltar");
  - `/inbox/:conversa/detalhes`.
  - O botão voltar do celular funciona naturalmente; nada é espremido.

### D.3 Componentes reutilizados e novos

- **Reutilizados:** `PlatformBadge`, `StatusBadge`, `Card`, `search-field`, `segmented`, `tiles`, padrão de painel lateral
  (`dialog`), padrão de confirmação (`instance__confirm`), estilo de balões da prévia do Envio de Mensagens (`phone__bubble`),
  `formatWhen`/fuso da empresa (`social-ui.tsx`, D-49).
- **Novos:**
  - `ConversationList` e `ConversationItem`;
  - `ChannelFilterBar`;
  - `ConversationView`, `MessageBubble`, `ConversationEvent` e `Composer` (com `WindowBadge`);
  - `ContactPanel`, `AssignControl`, `NotesPanel` e `TagsInput`;
  - `useInboxStream` (tempo real com reserva por consulta).

---

## E. Arquitetura proposta

### E.1 Camada central de conversas (independente dos provedores)

Novas tabelas no esquema `app`, todas com `organization_id`, chave composta e exclusão em cascata com a empresa (migration
só com aprovação):

| Tabela | Colunas principais | Para quê |
|---|---|---|
| `inbox_contacts` | id, nome, foto, telefone (quando houver), criado em | Pessoa atendida pela empresa, em qualquer canal |
| `inbox_contact_identities` | contato, canal, conta (instância ou conta Zernio), **id externo** (JID, LID, id da rede), @usuário | Uma pessoa com WhatsApp e Instagram vira um contato só (junção manual no início). Único por (empresa, canal, conta, id externo) |
| `inbox_conversations` | canal, conta, contato, **id externo da conversa** (JID ou `conversationId` da Zernio), tipo (`dm`, `comment_thread`, `review`), **situação** (`open`, `pending`, `closed`), **responsável** (usuário), **modo de controle** e `control_version` (E.5), etapa, última mensagem, última mensagem **do cliente** (janela), não lidas | Lista da coluna 1 e cabeçalho da coluna 2. Única por (empresa, conta, id externo) |
| `inbox_messages` | conversa, direção, **autor** (`contact`, `user`, `ai`, `automation`, `phone`, `system`), usuário, texto, anexos (JSON com tipo, tamanho, referência no armazenamento), **id externo** (único por conversa), `client_request_id` (idempotência do envio), situação (`pending`, `sent`, `delivered`, `read`, `failed`), categoria de erro, **hora do provedor** | Histórico; ordem pela hora do provedor, nunca pela de chegada |
| `inbox_events` | conversa, tipo (`assigned`, `transferred`, `taken_over`, `status_changed`, `window_closed`, `ai_paused`, `note`…), quem, de/para, quando | Eventos no meio da conversa, histórico de transferências, auditoria |
| `inbox_notes`, `inbox_tags`, `inbox_conversation_tags` | texto e autor; etiquetas da empresa | Coluna 3 |
| `provider_events` | provedor, **id do evento** (Zernio: `X-Zernio-Event-Id`; Evolution: instância + id da mensagem + tipo), empresa, situação, recebido e processado em | Deduplicação e reprocessamento. **Sem o corpo** do evento (LGPD); no máximo um resumo técnico |

- **Reaproveitamento:** a lista de contatos (Contatos) pode ganhar o atalho "adicionar à lista", e uma conversa nova pode
  mostrar se o telefone já está em alguma lista. As tabelas atuais não mudam.

### E.2 Fluxo de recebimento

```
Evolution Go ──WebSocket (wss, chave global)──►  Consumidor de eventos da API (um por instância da empresa)
Zernio ───────webhook HTTPS (depois) ou consulta periódica (antes)──►  Receptor de webhooks / Sincronizador
                                     │
                                     ▼
        Normalizador por canal → evento interno { empresa, canal, conta, contato externo, mensagem externa, … }
                                     │  (descarta grupos, status, instâncias que não são do DisparaZap)
                                     ▼
        Gravação idempotente numa transação: provider_events (único) → contato/identidade → conversa → mensagem
                                     │
                                     ▼
        Barramento interno (em memória) → SSE para os navegadores da empresa → (futuro) IA e automações
```

1. **WhatsApp:**
   - **corrigido na I0:** o consumidor abre **uma conexão em modo difusão por servidor** (sem `instanceId`), com TLS
     verificado, e filtra pelas instâncias registradas. O modo por instância tem uma falha da Evolution que pode silenciar a
     conexão depois de reconectar (HOMOLOGACAO_I0_EVOLUTION §5.1);
   - reconecta com espera crescente e marca "lacuna" se ficar desconectado;
   - só as instâncias com WebSocket ligado entregam eventos, e o DisparaZap liga só nas dele; mesmo assim, todo evento de
     instância não registrada é descartado pelo id, sem gravar nem registrar;
   - o `instanceToken` que vem no evento é conferido com o token do cofre e descartado (nunca gravado nem registrado).
2. **Zernio antes do HTTPS:**
   - consulta `GET /v1/inbox/conversations` por empresa a cada 30–60 s, só com a Inbox aberta, respeitando o limite;
   - lê as mensagens só das conversas que mudaram.
3. **Zernio depois do HTTPS:**
   - um webhook por empresa (`POST /v1/webhooks/settings` com a chave dela), com segredo próprio e só o perfil dela;
   - a assinatura é conferida em tempo constante sobre o corpo bruto;
   - responde em até 5 s e processa em seguida.
4. **Ordem e duplicidade:**
   - a ordem segue a hora do provedor;
   - repetição não cria nada (índices únicos);
   - recibo de leitura que chegar antes da mensagem fica pendente e é aplicado quando ela chegar;
   - edição e exclusão atualizam a mensagem, sem apagar o registro.

### E.3 Fluxo de envio

1. O atendente envia com um `requestId` (como nas Redes Sociais, D-48). A API grava a mensagem como `pending` **antes**,
   conferindo:
   - papel e responsável;
   - modo de controle;
   - janela do canal.
2. **WhatsApp:** usa o adaptador existente (token da instância). O id devolvido (`Info.ID`) é gravado; o eco `SendMessage` é
   reconhecido pelo id e não duplica.
3. **Zernio:**
   - `POST /v1/inbox/conversations/{id}/messages` com a `Idempotency-Key`;
   - fora da janela de 24 h, e só se o autor for humano, `messagingType: MESSAGE_TAG` + `messageTag: HUMAN_AGENT`;
   - comentários: `POST /v1/inbox/comments/{postId}`.
4. **Falhas:**
   - mensagem fixa por motivo, como nos outros módulos;
   - "tentar de novo" com a mesma chave;
   - nada é reenviado sozinho.

### E.4 Distribuição entre atendentes

- **Fila sem responsável + "Assumir":**
  - o primeiro a assumir vira o responsável;
  - a troca é feita no banco com condição, então dois atendentes ao mesmo tempo resultam num só.
- **Transferência:**
  - para um atendente ou para a fila;
  - o administrador transfere qualquer conversa; o atendente, só as dele;
  - cada transferência vira um evento.
- **Distribuição automática** (rodízio, por canal) fica para depois, com regra configurável.

### E.5 Estados do atendimento e preparação para IA

- **Modo de controle da conversa:** `automation`, `ai`, `waiting_human`, `human` e `closed`, com um número de versão
  (`control_version`) que muda a cada troca.
- **Trava de respostas automáticas:**
  - toda resposta de IA ou automação nasce com a versão em que foi gerada;
  - no envio, a API confere numa só operação no banco se o modo ainda é o mesmo e a versão é a mesma;
  - **quando um humano assume, a versão muda e qualquer resposta automática pendente é descartada**, mesmo que já esteja na fila.
- **Volta para a IA** só por ação explícita do atendente ("devolver para a IA") ou por regra da empresa, registrada como evento.
- **Encaminhamento para humano:**
  - o agente tem uma saída "não sei com segurança";
  - ela muda o modo para `waiting_human`, notifica a equipe e não responde nada inventado.
- **Regras do canal:**
  - no Instagram e no Facebook, IA e automação só respondem **dentro da janela de 24 h**;
  - `HUMAN_AGENT` é exclusivo de resposta humana (regra da Meta);
  - a Zernio tem `thread-control` (passar o controle da conversa entre aplicativos), a usar se a empresa também usar a caixa de
    entrada da Meta.
- **Configuração futura do agente** (módulo Agentes de IA, sem implementar agora):
  - nome, personalidade, instruções, base de conhecimento, regras, canais e critérios de transferência;
  - a Inbox só reserva os campos `ai_agent_id` e o modo `ai`.

### E.6 Preparação para automações

- **Barramento interno de eventos**, já usado pelo SSE: `message.received`, `comment.received`, `conversation.status_changed`,
  `conversation.assigned`, `contact.updated`, `human.requested`.
  - O futuro motor de automações assina esses eventos.
  - **Gatilhos possíveis:** mensagem, palavra-chave, comentário, interação, evento de contato, mudança de situação, pedido de
    humano.
- **Ações passam pela mesma porta de envio** (E.3 e E.5): respeitam janela, modo de controle e permissões, e nunca respondem
  com um humano no comando.
- **Registro de execução** por conversa (coluna 3, "automações executadas").
- **Antes de várias instâncias da API:** o barramento em memória serve com um processo (Hostinger). Com mais processos, passa
  a usar o banco (LISTEN/NOTIFY) ou a fila da decisão D5.

### E.7 Tempo real no painel

- **Canal SSE** `GET /api/internal/inbox/stream`:
  - empresa e papel da sessão; o atendente recebe só o que pode ver;
  - eventos pequenos ("conversa X mudou"), e o painel relê a conversa pela API.
- **Reserva:** consulta a cada 5 s se o SSE cair. A hospedagem pode cortar conexões longas; isso é conferido na homologação na
  Hostinger.
- **Sem biblioteca nova:** o SSE é feito com o próprio Fastify. Para a Evolution, o Node 24 já tem cliente WebSocket nativo.
  - Para os **testes**, a Evolution simulada precisa de um servidor WebSocket. Isso pede a dependência de desenvolvimento `ws`
    ou um servidor mínimo próprio (decisão N7).

### E.8 Segurança e LGPD

- **Isolamento:**
  - empresa sempre da sessão;
  - conversa, mensagem, anexo e nota de outra empresa respondem 404;
  - o atendente vê só as conversas atribuídas a ele e a fila (regra no servidor, testada).
- **Segredos:**
  - chave global e tokens só no servidor;
  - a URL do WebSocket (que leva a chave) nunca vai para o log;
  - o `instanceToken` dos eventos é descartado;
  - webhooks de entrada com segredo por empresa e conferência de assinatura (Zernio) ou de token (Evolution).
- **Anexos:** servidos só pela API, com a sessão e a empresa conferidas, nunca por endereço público. Limite de tamanho por tipo.
- **Logs:** nunca texto de mensagem, telefone, nome ou mídia (a regra que já vale no Envio de Mensagens).
- **LGPD:**
  - conversas são dados pessoais de terceiros;
  - **política de retenção** configurável (proposta: 12 meses, decisão N6);
  - exclusão de conversa e de contato a pedido do titular;
  - exportação dos dados do contato;
  - registro de quem abriu, transferiu e excluiu (`inbox_events`).
  - Mensagens são processadas pela Zernio (Europa e EUA) e pelo servidor Evolution da plataforma.
- **Respostas não autorizadas:** a porta única de envio (E.3, E.5) recusa respostas fora da janela, sem papel, em conversa de
  outro responsável, ou de IA/automação com humano no comando.

---

## F. Plano de implementação

Cada etapa é pequena, testada contra os simuladores, e termina com `npm test`, `npm run typecheck`, `npm run build`, CHANGELOG
e documentação. Contato com serviço real só na homologação, com autorização.

**Ajustes à ordem sugerida, conforme a auditoria:**
- **WhatsApp vem junto da estrutura básica:** é o único canal que dá para receber sem HTTPS, e a estrutura sem dados não teria
  o que mostrar (interface honesta).
- **Gestão de atendentes depende de existir mais de uma pessoa na empresa:** o módulo de membros/convites entra antes (etapa I4).
- **As redes sociais começam por consulta periódica,** e passam a webhook depois da publicação.

| Etapa | Entrega | Depende de | Serviço real? |
|---|---|---|---|
| **I0** | Este plano aprovado e decisões N1 a N8. **Homologação só de leitura:** versão da Evolution (`/swagger/doc.json`); `/ws` aceita a chave global; `/instance/connect` numa instância conectada não desconecta (testar com um número de teste do dono do produto); caixa de entrada incluída no plano Zernio | Autorização | Sim, só leitura e 1 instância de teste |
| **I1** | **Base da Inbox com WhatsApp:** tabelas (E.1); consumidor WebSocket com reconexão; ligar `subscribe` e WebSocket nas instâncias (por botão em Integrações, com confirmação); gravação idempotente; menu **Inbox**; três colunas; lista com filtros de canal, conta e não lidas; histórico; **responder texto**; recibos de entrega e leitura; SSE com reserva | I0 | Não (simulador); depois homologação com 1 número de teste |
| **I2** | **Mídias no WhatsApp:** receber imagem, áudio, vídeo e documento (armazenamento conforme N5); enviar imagem e documento; limites de tamanho | I1 e N5 | Não |
| **I3** | **Detalhes do contato, etiquetas, notas, etapas e situações** (abertas, pendentes, encerradas); excluir conversa; retenção (N6) | I1 | Não |
| **I4** | **Equipe:** membros por convite com verificação de e-mail (fora da Inbox: módulo "Empresas e membros"); depois **assumir, transferir, filtro por atendente, eventos na conversa**; regra de visibilidade do atendente; supervisor conforme N3 | Provedor de e-mail transacional (pendência do MASTER) | Não |
| **I5** | **Instagram e Facebook (DMs):** sincronização por consulta (antes do HTTPS), histórico já recuperado pela Zernio, envio com janela de 24 h e `HUMAN_AGENT`, aviso de pedido de mensagem, custo das mensagens | I1 | Homologação com a conta Zernio do dono do produto |
| **I6** | **Comentários e avaliações:** Instagram, Facebook, TikTok, LinkedIn, YouTube, Threads, X e Google Business como conversas do tipo comentário ou avaliação; responder, ocultar, excluir; resposta privada | I5 | Homologação |
| **I7** | **Estados e preparação para IA:** modo de controle, `control_version`, porta única de envio com a trava, "aguardando humano", eventos; a coluna 3 mostra "IA desligada" | I1 a I4 | Não |
| **I8** | **Preparação para automações:** barramento com eventos tipados e registro de execução, sem construtor de fluxos | I7 | Não |
| **I9** | **Webhooks, segurança e validação:** webhooks da Zernio e da Evolution depois da publicação com HTTPS (WebSocket continua como reserva); revisão de segurança; teste de carga leve; LGPD (exportar e excluir); TikTok e X por último (limites e custo) | Publicação na Hostinger | Sim, com autorização |

**Ordem de execução recomendada:** a da decisão N1 (I4 depois de I6, porque depende do módulo de membros).

### Andamento

| Etapa | Situação |
|---|---|
| **I0** | Verificações sem serviço real concluídas (2026-11-03). P0 a P7 aguardam autorização, um por um |
| **I1** | ✅ **Implementada localmente em 2026-11-04** (ESTRUTURA_TECNICA §16; DECISOES_TECNICAS D-52 a D-55). 48 testes da API contra a Evolution simulada com WebSocket e 25 do painel. **Recebimento desligado** (`INBOX_EVENTS_ENABLED` e `INBOX_ACTIVATION_ENABLED` = `false`): falta a homologação com uma instância de teste (HOMOLOGACAO_I0 §8) |

**O que a I1 já adianta das etapas seguintes:**
- os campos e a trava de controle da I7 (`control_mode`, `control_version`, `canDeliverAutomated`, eventos da conversa);
- a visibilidade do atendente da I4 (as dele e a fila sem responsável) e "quem responde assume";
- a reabertura de conversa encerrada.

Ficam para as próprias etapas: a tela para trocar o modo, assumir sem responder, transferir e encerrar.

**Limitações conhecidas da I1:**
- **Mídias:** aparecem só como "[Imagem]", "[Áudio]" etc., com a legenda. O arquivo não é guardado (I2, depois da N5).
- **Sem histórico anterior:** a Evolution não tem API de histórico. Só entra o que chegar depois de ligar.
- **Mensagens perdidas:** o que chegar com o consumidor fora do ar não volta. As quedas aparecem como períodos sem recebimento.
  Uma API desligada por inteiro (reinício, publicação) não registra período sem recebimento: não há quem registre.
- **Contato só com LID:** o envio usa o identificador da conversa; a confirmar na homologação (P5).
- **Um processo só** (D-45): o barramento do tempo real é em memória.
- **Sem encerrar ou transferir pela tela:** a conversa encerrada só existe pelos dados. Etapas I3 e I4.

### F.1 Testes de cada etapa (sem serviço real)

- **Evolution simulada:**
  - eventos `Message`, `SendMessage` e `Receipt` com JID e LID;
  - grupos, status e outra instância descartados;
  - eventos repetidos e fora de ordem;
  - queda e reconexão do WebSocket;
  - token do evento diferente do cofre.
- **Zernio simulada:** conversas, mensagens, envio com janela e `HUMAN_AGENT`, 409 de controle da conversa, webhooks com
  assinatura certa e errada, evento repetido.
- **API:**
  - isolamento entre empresas;
  - atendente sem ver conversa alheia;
  - dois atendentes assumindo ao mesmo tempo (um só fica);
  - resposta automática descartada depois do "assumir";
  - texto e telefone fora do log.
- **Painel:**
  - três colunas, recolher detalhes, navegação no celular;
  - filtros, envio e falha;
  - janela fechada;
  - visualizador sem acesso.

---

## G. Riscos técnicos

| Risco | Detalhe | Como lidar |
|---|---|---|
| WhatsApp não oficial | A Evolution Go usa o protocolo do WhatsApp Web (whatsmeow). Volume alto ou automação agressiva pode bloquear o número | Limites de envio, intervalo, sem disparo pela Inbox; aviso nos Termos da empresa |
| Perda de mensagens | WebSocket sem reenvio; webhook só 5 tentativas em 2,5 min | Reconexão rápida, alerta de lacuna, webhook + WebSocket juntos depois do HTTPS (com deduplicação), avaliação do `history-sync` |
| Configuração das instâncias | Reaplicar `/instance/connect` numa instância conectada; versão do servidor desconhecida; a documentação local diverge do código no token do WebSocket | Homologação I0 com número de teste antes de tudo; nunca nas instâncias do MVP |
| Chave global em uso contínuo | O WebSocket precisa da chave global (a mesma que cria e exclui instâncias) | TLS verificado, nunca em log, conexão só do servidor; pedir à Evolution um modo por token de instância (melhoria futura) |
| Mídia grande | Base64 no evento passa pela memória do único processo | Limite por tipo, descarte do excedente com aviso; MinIO/S3 no servidor Evolution (decisão N5) |
| Janela da Meta | Fora de 24 h, só humano até 7 dias; automação proibida | Regra no servidor, aviso na tela, IA bloqueada fora da janela |
| Limites da Zernio | 60 pedidos/min com até 2 redes; comentários com cache de 10 min | Consulta só com a Inbox aberta, cache por empresa, webhooks depois do HTTPS |
| Custos | Mensagens enviadas pela caixa de entrada da Zernio acima de 10.000/mês; X por leitura e envio; contas Zernio da 3ª em diante | Avisos na tela; X sem leitura automática; métricas de uso por empresa |
| Restrições por rede | TikTok (Business, fora da Europa, 10 em 48 h); X (conversas criptografadas invisíveis); LinkedIn só páginas; Pinterest nada | A matriz C vira regras no código, como em `SOCIAL_RULES` |
| Tempo real na Hostinger | O proxy do aplicativo Node.js pode encerrar conexões longas (SSE) | Reserva por consulta; teste na publicação |
| Um processo só | Consumidor WebSocket, SSE e API juntos; barramento em memória | Adequado ao volume inicial; plano de fila (D5) e LISTEN/NOTIFY para crescer |
| Equipe | Sem convites hoje, a Inbox fica de uma pessoa só | Etapa I4 depende do módulo de membros e do e-mail transacional |
| LGPD | Conversas com dados de terceiros; processamento na Zernio (UE/EUA) e no servidor Evolution | Retenção, exclusão, exportação, registro de acesso, nada em log; texto nos Termos da empresa |
| Dependências externas | Evolution Go (projeto comunitário, muda de endereço: o repositório passou para `evolution-foundation`) e Zernio (especificação muda toda semana) | Adaptadores próprios, simuladores, homologação curta a cada etapa |

---

## Decisões para o dono do produto

| # | Decisão | Recomendação |
|---|---|---|
| **N1** | Ordem das etapas | **I0 → I1 → I2 → I3 → I5 → I6 → I4 → I7 → I8 → I9.** As redes vêm antes da equipe porque a equipe depende do módulo de membros e do e-mail transacional |
| **N2** | Como receber o WhatsApp | **WebSocket já** (funciona sem HTTPS); **webhook também** depois da publicação, com deduplicação |
| **N3** | Papéis | **Sem papel novo agora:** dono e administradores = administrador/supervisor; operador = atendente; visualizador sem Inbox. Papel `supervisor` só se for preciso separar quem distribui de quem configura |
| **N4** | O que o atendente vê | **As conversas dele e a fila sem responsável**; o administrador vê todas |
| **N5** | Onde guardar as mídias recebidas | **Aprovado com ajuste:** priorizar **armazenamento privado de objetos** (a definir: Supabase Storage com o Supabase conectado, ou MinIO no servidor Evolution). Até lá, a I1 mostra "mídia recebida" sem guardar o conteúdo |
| **N6** | Retenção das conversas | **12 meses** sem atividade, depois exclusão automática, com exclusão manual a pedido do titular |
| **N7** | Simulador WebSocket nos testes | **Dependência de desenvolvimento `ws`** (só testes, fora do build); a API usa o WebSocket nativo do Node |
| **N8** | Homologação real | **Por etapa, com autorização:** I0 só leitura e 1 número de teste; nunca as instâncias do MVP; nas redes, só a conta Zernio do dono do produto |

---

## Respostas diretas ao pedido

- **O que já existe e pode ser reutilizado:**
  - empresas, papéis e isolamento;
  - cofre e chaves;
  - instâncias de WhatsApp com token, e envio de texto e imagem;
  - adaptador e perfil da Zernio, contas e saúde;
  - padrão de espelho, idempotência e fuso (Redes Sociais);
  - componentes do painel;
  - simuladores.
- **O que precisa ser desenvolvido:**
  - camada de conversas (tabelas da seção E.1);
  - consumidor WebSocket da Evolution;
  - sincronização e webhooks das DMs e comentários da Zernio;
  - porta única de envio com janela e trava;
  - SSE;
  - telas da Inbox;
  - módulo de membros/convites (para a equipe);
  - regras de retenção.
- **Canais:**
  - **WhatsApp** (Evolution);
  - **Instagram e Facebook** (DMs, comentários; avaliações no Facebook);
  - **TikTok** (com restrições);
  - **X** (com custo e sem conversas criptografadas);
  - **comentários** de LinkedIn, YouTube e Threads;
  - **avaliações** do Google Business;
  - Pinterest não.
- **Três colunas:** seção D, com recolhimento dos detalhes e navegação por endereço no celular.
- **Arquitetura SaaS:**
  - empresa sempre da sessão, 404 entre empresas;
  - conexões e webhooks por empresa;
  - atendente limitado no servidor;
  - segredos só na API;
  - nada pessoal em log.
- **IA e automações:**
  - modo de controle com versão;
  - porta única de envio;
  - barramento de eventos;
  - regras de janela por canal;
  - campos reservados.
  - Nenhum motor agora.
- **Primeira etapa:**
  - **I0**, homologação só de leitura, com autorização;
  - em seguida **I1**, a base da Inbox com WhatsApp (receber, listar, ler e responder texto), testada contra a Evolution
    simulada.

### Adendo (2026-11-04): ícones de canal das redes

A faixa de canais da Inbox mostra um ícone por conta de rede **ativa** na Zernio (estado "ok"), lida pela rota de Redes Sociais.
É só a seleção de canal: escolher uma rede mostra o aviso "chegam numa próxima etapa". **Nenhuma conversa de rede é carregada
ou criada nesta etapa.** As conversas de Instagram e Facebook seguem em I5, e os comentários em I6, depois da homologação.
