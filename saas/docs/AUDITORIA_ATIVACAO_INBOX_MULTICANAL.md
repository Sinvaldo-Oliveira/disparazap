# Auditoria: ativação da Inbox multicanal (WhatsApp, Instagram e TikTok)

| | |
|---|---|
| **Data** | 2026-11-04 |
| **Tipo** | Auditoria técnica. **Sem alteração de código, banco, integração ou credencial.** Sem chamadas reais à Zernio nem à Evolution Go |
| **Pedido** | Descobrir o que impede o recebimento e o envio de mensagens pelos canais da Inbox, e propor a correção por etapas |
| **Fontes** | Código do SaaS (`saas/`); `saas/docs/PLANO_MODULO_INBOX.md`; `saas/docs/HOMOLOGACAO_I0_EVOLUTION.md`; `saas/docs/REFERENCIA_ZERNIO.md`; documentação pública da Zernio lida em 2026-11-04 (páginas indicadas em cada ponto) |
| **Limite desta leitura** | As páginas da Zernio foram lidas por apoio de leitura, sem chave. Um trecho da página de webhooks de inbox veio truncado; os pontos que dependem dele estão marcados como **a confirmar** |

---

## A. Estado atual

**Já existe e funciona (contra o simulador):**
- Interface da Inbox em três colunas (`saas/apps/web/src/pages/inbox/InboxPage.tsx`), com filtros por canal, conta, busca e situação, histórico, respostas, recibos e aviso de recebimento.
- Ícones de canal. Cada ícone vem de uma conta da Zernio com estado `ok` (`socialApi.accounts`), ou seja, do id real da conta na Zernio. O WhatsApp vem das instâncias do banco.
- Banco da Inbox (`saas/packages/db/src/schema/inbox.ts`, migration `0007_inbox`): contatos, identidades, conversas, mensagens, recibos pendentes, lacunas de recebimento e eventos.
- Consumidor dos eventos da Evolution Go (`apps/api/src/inbox/evolution-events.ts`), com conexão WebSocket própria, filtro de instâncias, conferência de token e reconexão. Está **desligado por configuração** (`INBOX_EVENTS_ENABLED=false`).
- Gravação idempotente, envio de texto pela Evolution com `requestId`, trava das respostas automáticas (`canDeliverAutomated`).
- Testes: 48 na API da Inbox, 28 no painel, 421 no total, todos contra simuladores.

**Não existe:**
- Nenhum cliente de inbox da Zernio no código (busca por `inbox/conversations` sem resultado no código-fonte).
- Nenhum recebedor de webhook da Zernio, nem verificação de assinatura.
- Nenhum caminho para conversas de Instagram ou TikTok: `listChannels` lê só `whatsapp_instances`, e o envio só funciona para WhatsApp.

---

## B. Por que as mensagens aparecem na tela

### B.1 "O recebimento de mensagens ainda não foi ligado nesta plataforma..." (WhatsApp)

- **Causa:** o estado de recebimento é `disabled` porque `createServices`/`buildApp` só criam o consumidor com `INBOX_EVENTS_ENABLED=true` (`apps/api/src/app/build-app.ts`). Com o valor `false`, o `InboxReception` responde `disabled` e o painel mostra o aviso.
- **Tipo:** **bloqueio de homologação, intencional.** Não é bug nem falta de permissão.
- **Para liberar:** homologação H1 a H7 de `HOMOLOGACAO_I0_EVOLUTION.md`, seção 10, cada passo com autorização. Inclui P0 (confirmar se o proxy da Evolution grava a URL com a chave).

### B.2 "As conversas de [rede] chegam nesta tela em uma próxima etapa, depois da homologação com a conta na Zernio."

- **Causa:** texto fixo no código (`InboxPage.tsx`), mostrado para **qualquer** conta de rede, inclusive TikTok. Ele não consulta a Zernio nem verifica a capacidade da conta.
- **Tipo:** **funcionalidade ainda não implementada** (etapas I5 e I6 do plano). O texto está correto como estado atual, mas é genérico: não diz se a rede suporta mensagens.
- **Correção recomendada:** manter o aviso até a I5, e depois trocá-lo por um estado vindo do servidor, por conta: "mensagens ativas", "só comentários", "precisa reconectar" ou "conta sem suporte". Não remover o aviso antes disso.

---

## C. Diagnóstico por canal

### C.1 WhatsApp

| Item | Situação |
|---|---|
| Recebimento | Implementado, desligado. Falta H1 a H7 |
| Envio de texto | Implementado (`sendInboxMessage`), testado com simulador. Falta teste real |
| Recibos | Implementados (entregue e lida), a confirmar na homologação |
| Ativação por instância | Botão pronto, bloqueado por `INBOX_ACTIVATION_ENABLED=false` |
| Bloqueio principal | Autorização para homologação com número de teste |

### C.2 Instagram (mensagens diretas)

Fontes: `platforms/instagram/inbox` e `webhooks/inbox`.

| Item | Situação na documentação | Situação no DisparaZap |
|---|---|---|
| Listar conversas | `GET /v1/inbox/conversations` (com `profileId`, `platform`, `accountId`, `cursor`, `limit` até 100) | Sem cliente |
| Ler mensagens | `GET /v1/inbox/conversations/{id}/messages` (citado de passagem; a página não foi lida por completo — **a confirmar**) | Sem cliente |
| Responder | `POST /v1/inbox/conversations/{id}/messages` (corpo **a confirmar**) | Sem caminho |
| Marcar como lida | Não encontrada nas páginas lidas | Só local (zera o contador no DisparaZap) |
| Eventos novos | `message.received`, `message.sent`, `message.read`, `message.failed`, `conversation.started`, `reaction.received` | Sem recebedor |
| Janela de 24 h | Fora dela, só com `messageTag: "HUMAN_AGENT"` e `messagingType: "MESSAGE_TAG"` | Não modelada |
| `HUMAN_AGENT` | Só para respostas **digitadas por uma pessoa**; a Meta rejeita em mensagens automáticas, fluxos e transmissões. Vale até 7 dias após a última mensagem do cliente | Não modelado. **Limita I7 e I8**: IA e automação não podem usar essa tag |
| Add-on | Rotas de inbox respondem 403 `Inbox addon required` quando a conta não tem o recurso | **Não verificado nesta conta** |

**Diagnóstico:** a conexão da conta Instagram é necessária, mas não basta. Faltam o add-on da Zernio (a confirmar), o cliente de inbox, o recebedor de webhook e a modelagem do banco.

### C.3 TikTok

Fonte: `platforms/tiktok/inbox` (página completa).

| Item | Situação na documentação |
|---|---|
| Tipo de conta | DM exige **TikTok Business Account**. Contas pessoais são recusadas pelo TikTok |
| Região | Contas com cadastro **na EEA, Suíça ou Reino Unido não são suportadas**. Outras regiões não listadas (lista completa **não encontrada**) |
| Conexão | Conexão pelo app Business é o padrão. Conexão pelo app de desenvolvedor responde 400 `PLATFORM_LIMITATION` para DMs e comentários |
| Aceite de mensagens | A conta precisa aceitar DMs de todos ou por solicitação. Sem isso, o TikTok **não envia webhook** |
| Listar conversas | Sim |
| Buscar mensagens | Sim |
| Enviar texto | Sim, até 6.000 caracteres |
| Enviar imagem | Sim, uma imagem JPG ou PNG de até 3 MB |
| Texto e imagem juntos | **Não**: a Zernio responde 400 `PLATFORM_LIMITATION` |
| Iniciar conversa | **Não**: a empresa só responde |
| Janela | Até 10 mensagens em 48 h após a última mensagem do usuário. Fora disso, o envio falha |
| Comentários | Não exigem Business Account (ler, responder, curtir, ocultar, apagar os próprios, fixar) |
| Eventos | `comment.received`, `message.received`, `message.sent`; a página de webhooks lista também `reaction.received` |

**Diagnóstico:** o TikTok **só permite responder** conversas que o cliente iniciou, dentro de 48 h e com limite de 10 mensagens. A interface precisa mostrar isso. Não é possível tratar o TikTok como canal completo.

**Cuidado:** a tela atual mostra o aviso de "próxima etapa" para o TikTok sem qualquer verificação. Com a documentação lida, esse aviso passa a ser especialmente enganoso: a conta pode estar no estado `ok` e mesmo assim não receber DMs.

---

## D. Zernio: acesso, webhooks e limites

### D.1 Acesso e planos

- Chave: cifrada no cofre por empresa (`provider='zernio'`), nunca sai da API. Esta auditoria não leu nem imprimiu a chave.
- Contas: lidas ao vivo pela rota de Redes Sociais (`socialAccounts`), filtradas pelo perfil da empresa.
- **Add-on do inbox:** a página de webhooks diz que `POST /v1/webhooks/settings` recusa a assinatura com 403 `feature_not_available` sem o recurso. O texto se refere a um plano legado; a página de preços diz que o inbox está incluído. **Conflito a confirmar no painel da Zernio.**
- Não existe endpoint de diagnóstico de permissões identificado nas páginas lidas.

### D.2 Webhooks

Fonte: `webhooks` (página completa) e `webhooks/inbox` (truncada).

| Ponto | Documentação |
|---|---|
| Criação | `POST /v1/webhooks/settings` com `name`, `url`, `events`, `secret`. Até 50 endpoints |
| URL HTTPS pública | **Não encontrado** nas páginas. Os exemplos usam `https://`, sem regra explícita. **A confirmar** |
| Assinatura | Cabeçalho `X-Zernio-Signature`: HMAC-SHA256 em hexadecimal minúsculo do corpo bruto, com o `secret` |
| Identificador do evento | `X-Zernio-Event-Id` (usar para deduplicar) |
| Resposta | Responder `2xx` em até **5 s** |
| Retentativas | Até 7 tentativas, com espera crescente até 24 h. Depois, fila de mortos, com reenvio manual |
| Entrega | "Pelo menos uma vez": o receptor precisa ser idempotente |
| Desativação | Endpoint desativado após 3 dias sem entrega bem-sucedida, com e-mail ao dono |
| Teste | `POST /v1/webhooks/test` envia `webhook.test` uma vez |

**Consequências para o DisparaZap:**
- Sem endereço público HTTPS, não há como receber eventos. Em desenvolvimento, o recebimento real depende de um túnel, e a documentação **não diz se é aceito**. Não usar túnel sem autorização.
- A publicação na Hostinger (com HTTPS) é pré-requisito para webhooks da Zernio (D-45).
- O receptor precisa responder em 5 s: gravar em fila e responder depois. Como não há fila nem worker, isso é trabalho novo.

### D.3 Lista de bloqueios da Zernio

1. Add-on de inbox da conta (a confirmar).
2. Endereço público para o webhook (depende da publicação).
3. TikTok: conta Business, região fora de EEA, Suíça e Reino Unido, conexão pelo app Business, e aceite de mensagens.
4. Regra de 24 h do Instagram e de 48 h e 10 mensagens do TikTok.
5. `HUMAN_AGENT` restrito a respostas humanas.

---

## E. Evolution Go (WhatsApp)

| Item | Situação |
|---|---|
| Consumidor WebSocket | Implementado (`evolution-events.ts`, `ws-client.ts`), testado com simulador |
| Autenticação | Chave global na URL do WebSocket, nunca no log. Chave recusada: não insiste |
| Identificação da instância | Pelo `providerInstanceId`, só para instâncias com a Inbox ligada |
| Reconexão | Espera crescente, lacunas registradas |
| Recibos | `Receipt` com `Delivered` e `Read` |
| Botão de ativação | Pronto; bloqueado pelo flag |
| Requisitos pendentes | H1 a H7 (`HOMOLOGACAO_I0_EVOLUTION.md` §10). P0 antes de tudo |

Nenhuma instância real foi alterada, e nenhum evento real foi recebido.

---

## F. Banco e arquitetura

**Bloqueio estrutural:** as tabelas da Inbox amarram a conta a `whatsapp_instances`:
- `inbox_conversations.account_id` → FK para `whatsapp_instances`;
- `inbox_contact_identities.account_id` → FK para `whatsapp_instances`.

Por isso **não é possível gravar conversas de uma conta da Zernio** sem mudar o modelo.

**O que já serve:**
- `channel` (padrão `whatsapp`) e `kind` (`dm`, `comment_thread`, `review`) já existem.
- Contatos e mensagens são por empresa, com chaves compostas.
- Deduplicação por `(conversation_id, external_id)`.

**Mudanças propostas (não executadas):**

1. Trocar a referência fixa à instância por uma **conta genérica**: `channel` + `account_ref`, em que `account_ref` aponta para `whatsapp_instances` (WhatsApp) ou para a conta da Zernio (redes), com verificação por canal.
2. Adicionar `CHECK` no `channel` (`whatsapp`, `instagram`, `facebook`, `tiktok`, …).
3. Tabela de **eventos recebidos da Zernio**, para deduplicação por `X-Zernio-Event-Id` e para o modo "pelo menos uma vez".
4. Campos de janela: `last_inbound_at` (já existe) e um indicador de "pode responder livremente" calculado por canal (24 h no Instagram, 48 h e 10 mensagens no TikTok).

**Migração:** só depois da aprovação. Cópia do banco local antes; nada em produção.

---

## G. Plano de correção (em etapas)

Ordem por dependência real. Cada etapa tem critério de aprovação.

**Etapa 1 — WhatsApp: concluir o recebimento.**
- Testes locais já existem. Falta homologação (H1 a H7), com autorização a cada passo.
- Aprovação: uma mensagem real chega na Inbox sem recarregar, e a resposta sai pela instância certa.

**Etapa 2 — Zernio: confirmar o add-on e o acesso (sem código).**
- Confirmar no painel da Zernio se o inbox está ativo na conta. Se não estiver, decidir se contrata.
- Aprovação: resposta de confirmação do dono do produto, e leitura de conversas autorizada.

**Etapa 3 — Instagram: leitura do histórico.**
- Cliente de inbox da Zernio (`GET /v1/inbox/conversations`, mensagens), com teste contra simulador.
- Modelo de banco com conta genérica (F, itens 1 e 2).
- Aprovação: conversas de Instagram aparecem na Inbox, com o histórico, isoladas por empresa.

**Etapa 4 — Instagram: resposta.**
- Envio com `requestId`, respeitando a janela de 24 h. Fora dela, nenhum envio automático; `HUMAN_AGENT` só em resposta digitada por pessoa.
- Aprovação: envio de teste **somente com autorização expressa**, a cada envio.

**Etapa 5 — Webhooks e tempo real.**
- Receptor com assinatura HMAC, deduplicação, resposta em 5 s, fila simples.
- Pré-requisito: publicação com HTTPS.
- Aprovação: evento de teste (`webhook.test`) e uma mensagem recebida em tempo real.

**Etapa 6 — TikTok.**
- Só depois de confirmar: conta Business, região, conexão pelo app Business e aceite de mensagens.
- Interface mostra a limitação (só responder em 48 h, até 10 mensagens, texto ou imagem, nunca os dois).
- Aprovação: conta de teste do dono do produto recebe e responde.

**Etapa 7 — Filtros, contas e segurança.**
- Estado de capacidade por conta, no lugar do aviso genérico.
- Testes de isolamento entre empresas e de permissões.

---

## H. Matriz de testes

| Categoria | Teste | Critério |
|---|---|---|
| Local (simulador) | Recebimento, duplicado, fora de ordem, envio duplicado, recibos | Todos passam |
| Local (simulador) | Webhook com assinatura certa e errada; sem `2xx` em 5 s | Errada recusada; retentativa idempotente |
| Local (simulador) | TikTok: texto e imagem juntos; fora da janela de 48 h | Erro com mensagem fixa |
| Local (simulador) | Isolamento: conta da empresa A na Inbox da empresa B | 404 |
| Leitura real (com autorização) | Listar conversas de uma conta de teste | Resposta 200 com dados da conta |
| Escrita real (com autorização expressa) | Envio de teste | Mensagem chega ao destinatário autorizado |

---

## I. Operações que exigem autorização específica

Cada item precisa de autorização própria. Nenhum foi executado nesta auditoria.

1. **Consultar** o add-on da Zernio no painel da Zernio (feito pelo dono do produto).
2. **Leitura real** `GET /v1/inbox/conversations` para a conta da empresa, pela aplicação, sem envio.
3. **Criar** o endpoint de webhook na Zernio (`POST /v1/webhooks/settings`), depois da publicação com HTTPS.
4. **Envio de mensagem real** pelo Instagram ou TikTok, **uma autorização por envio**, com destinatário indicado.
5. **Ligar** `INBOX_EVENTS_ENABLED` e `INBOX_ACTIVATION_ENABLED`, e as etapas H1 a H7 do WhatsApp.
6. **Migração** do banco (local, com cópia; produção só com autorização).
7. **Alterar** conexões, permissões ou contas da Zernio.

---

## J. Conclusões

- A **Inbox já é uma base operacional** para WhatsApp. Falta a homologação, que depende de autorização.
- Os **avisos atuais são corretos como estado**, mas o do TikTok é genérico e não reflete a capacidade real da conta.
- O **Instagram** depende de três coisas: add-on da Zernio (a confirmar), cliente de inbox (não existe) e webhook com HTTPS (depende da publicação).
- O **TikTok** só permite responder dentro de regras estreitas. Não deve ser apresentado como canal completo.
- A **modelagem do banco** está presa ao WhatsApp e precisa de mudança antes de qualquer conversa de rede.
