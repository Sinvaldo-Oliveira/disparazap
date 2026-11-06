# Plano Z3 — Respostas humanas pelo Instagram

| | |
|---|---|
| **Status** | 🟨 **Z3.1 concluída (preparação).** Aprovados: ordenação confiável, janela de resposta, limite de 1.000 caracteres e rascunho da migração 0008 (não aplicada). **Bloqueados:** cliente de envio (texto da janela fechada e erros 409/422/429/502 não confirmados) e aplicação da migração (aplicação ainda não define `app.org_id`) |
| **Data** | 2026-11-04 (atualizado com a leitura da página de envio) |
| **Base** | Z2 a Z2.4. PLANO_MODULO_INBOX §E.3 e §E.5 |
| **Regra de ouro** | A resposta sai só por ação de uma pessoa, na conta da própria empresa, dentro das regras da Meta. Sem IA, sem automação, sem campanha |

---

## 1. Evidência da homologação Z2.4 (registrada)

Leitura real feita pelo administrador na interface, uma conversa, 10 mensagens. Só datas e campos.

| Verificação | Resultado |
|---|---|
| Mensagens consultadas | 10 |
| `sentAt` e `createdAt` | Coincidentes **nesta amostra**; diferença de 0 segundo |
| Última mensagem recebida do contato | 02/11/2026, 09:06:51 |
| Última atividade da conversa (lista) | 02/11/2026, 09:06 |

**Limitação:** a coincidência vale só para essa amostra. A documentação define `sentAt` como horário de envio para mensagens da empresa, e não define `createdAt` como horário de envio.

---

## 2. Auditoria da ordenação e da paginação (D3)

### 2.1 Como o código pede e ordena hoje
- Primeira carga: `sortOrder=desc` e `limit=50` (`apps/api/src/inbox/social-inbox.ts`, `listSocialMessages`). A Zernio devolve as mais recentes.
- A página é ordenada em ordem crescente pelo horário de envio (`sentAt`, ou `createdAt` se faltar) e exibida.
- "Ver mensagens anteriores" usa o `nextCursor` e coloca a página **antes** das já exibidas (`SocialInbox.tsx`, `loadOlder`). Isso só está correto se a Zernio mantiver a ordem `desc` entre as páginas.

### 2.2 Hipóteses testadas com a Zernio simulada

| Hipótese | Resultado nos testes | Situação |
|---|---|---|
| **H0**: a Zernio respeita `desc` | Primeira página = 50 mais recentes; "ver anteriores" traz páginas mais antigas; `sortOrderApplied = desc` | Correto |
| **H1**: a Zernio ignora `desc` e devolve `asc` | A página traz as 50 **mais antigas**; `sortOrderApplied = asc`; a tela não avisa; "ver anteriores" trará mensagens **mais novas** no topo | **Defeito latente**: a tela não verifica `sortOrderApplied` |
| **H2**: `sentAt` e `createdAt` com relógios diferentes | Não testável sem amostra real além da Z2.4 | Pendente |

### 2.3 Conclusão da auditoria
- A documentação diz que, para Instagram, a Zernio respeita o `sortOrder` pedido (H0). Por isso H1 é improvável, mas **o código não prova isso**: ele aceita qualquer ordem em silêncio.
- **Correção recomendada (não feita):** se `sortOrderApplied` for diferente de `desc`, a tela mostra "A ordem das mensagens não foi confirmada pela Zernio; o histórico pode estar incompleto" e desativa "ver anteriores".
- A captura anterior, com março como primeiras mensagens, continua sem explicação. Não há evidência de que seja H1: a Z2.4 registrou `sortOrderApplied`? **Não registrou** (o diagnóstico foi feito antes desse campo existir na tela). Uma nova leitura só com justificativa e autorização separada.

---

## 3. Contrato de envio (documentado parcialmente)

Fonte: `docs.zernio.com/messages/send-inbox-message.mdx`. A página veio truncada (cerca de 58% em texto original). O restante veio como resumo, e **não foi usado** como base.

### 3.1 Verbatim (confirmado)
- **Endpoint:** `POST /v1/inbox/conversations/{conversationId}/messages`. O `conversationId` é opaco.
- **Corpo, campos do texto:**
  - `accountId` (string, obrigatório, no corpo);
  - `message` (string). Limite: *"Text must be shorter than 10,000 characters."* Com botões no Instagram/Facebook: *"640 characters or less"*;
  - `messageTag` (valores `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`, `ACCOUNT_UPDATE`, `HUMAN_AGENT`);
  - `messagingType` (valores `RESPONSE`, `UPDATE`, `MESSAGE_TAG`; *"Required when using messageTag."*).
- **Idempotência:** cabeçalho `Idempotency-Key`. *"Keys are retained for 24 hours."* Mesma chave e mesmo corpo: devolve a resposta original com `Idempotent-Replayed: true`. Mesma chave e corpo diferente: **422**. Chave em processamento: **409**. Só respostas 2xx ficam guardadas.
- **Após falha 5xx ou tempo esgotado:** *"reconcile before retrying"* (listar as mensagens da conversa antes de reenviar).
- **Sucesso (200):** `success`, `data.messageId` (id da plataforma), `data.conversationId`, `data.attachments`, `data.messageIds`, `data.partialFailure`. **Não há `status` nem `id` no nível superior.**
- **HUMAN_AGENT:** *"To reply after the 24h window, send HUMAN_AGENT with messagingType MESSAGE_TAG: it works up to 7 days after the person's last message, for replies typed by a person only (Meta does not allow it on automated messages)."*

### 3.2 Não encontrado (bloqueia a implementação)
1. **Mensagem de erro com a janela de 24 horas fechada.** Sabe-se que a Meta rejeita com `code: platform_api_error`, `type: platform_error`, `platform` e `platformError`, mas o texto e o status exatos não estão no trecho original.
2. **Respostas 409 de envio, 422 e 429 detalhadas** (só há resumo).
3. **Resposta 502 de envio** (só resumo).
4. **Campo de identificação do cliente** para idempotência além do `Idempotency-Key`.

### 3.3 Decisão sobre o cliente
Não será implementado um cliente de envio enquanto os itens 3.2.1 e 3.2.2 não estiverem confirmados. O envio pode ser construído com simulador apenas para os caminhos já verbatim, com a janela e os erros desconhecidos tratados como **recusa fechada** (falha sem envio).

---

## 4. Regras de atendimento (D1)

| Janela (desde a última mensagem recebida do contato) | Envio |
|---|---|
| Até 24 horas | Resposta humana sem tag |
| Entre 24 horas e 7 dias | `messageTag: HUMAN_AGENT` e `messagingType: MESSAGE_TAG`, só para resposta digitada por uma pessoa |
| Mais de 7 dias | Bloqueado |
| Não é possível determinar a última mensagem do contato | Bloqueado |

- A janela é **revalidada no backend** imediatamente antes do envio.
- `HUMAN_AGENT` **nunca** é usado por IA, automação ou campanha. A API recusa qualquer pedido com origem diferente de `humano`.
- A documentação diz que a Zernio aplica a tag automaticamente às respostas do **painel dela**. Para a API, o DisparaZap envia a tag explicitamente. Não há garantia de que o comportamento seja igual; por isso a validação é nossa, não da Zernio.
- **Identificação da última mensagem recebida:** a mensagem com `direction = incoming` de maior horário (`sentAt`, ou `createdAt` se faltar). Se não houver mensagem do contato nas lidas, o envio é bloqueado (falha fechada). A leitura para validar a janela busca as mensagens mais recentes (`desc`), o que depende da correção da seção 2.3.

---

## 5. Limite de texto (D4)

- **Provisório: 1.000 caracteres**, na interface e no backend, só para mensagens de texto.
- O limite oficial documentado é **10.000 caracteres** (texto simples). Com botões, **640**.
- O limite de 640 não se aplica a mensagens simples: botões não fazem parte desta etapa.
- 1.000 é mais restritivo que o oficial, então não viola a regra. Se o limite oficial for confirmado menor, ele prevalece.

---

## 6. Registro local de envios (D2): proposta, sem migração

### 6.1 Reutilização
- `inbox_messages` **não é reutilizável**: a conversa pai (`inbox_conversations`) guarda só contas do WhatsApp (`whatsapp_instances`), e conversas do Instagram não existem no banco (leitura direta, D-57).

### 6.2 Esquema proposto (`app.inbox_social_sends`)

| Coluna | Tipo | Função |
|---|---|---|
| `id` | text, PK | Id interno |
| `organization_id` | text, FK `identity.organizations` | Isolamento |
| `account_ref` | text | Id da conta na Zernio |
| `conversation_ref` | text | Id da conversa na Zernio (opaco) |
| `client_request_id` | text | Id do pedido do painel (chave de idempotência local) |
| `actor_user_id` | text, FK `identity.users` | Quem respondeu |
| `text_length` | integer | Tamanho, **sem o texto** (privacidade) |
| `window_mode` | text: `none` ou `human_agent` | Tag usada |
| `status` | text: `pending`, `sent`, `failed`, `unknown` | Estado |
| `provider_message_id` | text, nullable | `data.messageId` |
| `error_category` | text, nullable | Motivo fixo, nunca o texto da Zernio |
| `created_at`, `updated_at` | timestamptz | Tempo |

- **Chave única:** `(organization_id, client_request_id)`.
- **Índices:** `(organization_id, created_at)`.
- **Check:** `status` e `window_mode` em lista fixa.
- **Isolamento:** toda consulta filtra pela empresa da sessão; chave estrangeira composta, como nas demais tabelas.

### 6.3 Estados e controle de duplicidade
- `pending`: gravado **antes** da chamada.
- `sent`: 2xx com `messageId`.
- `failed`: recusa definitiva (4xx com motivo fixo). Sem envio, pode ser tentado de novo com **novo** `client_request_id`.
- `unknown`: 5xx ou tempo esgotado. **Não reenvia sozinho.** Antes de qualquer nova tentativa, reconcilia listando as mensagens da conversa; só depois o administrador escolhe reenviar.
- Mesmo `client_request_id` devolve o registro existente (`replayed`), sem chamar a Zernio. A `Idempotency-Key` da Zernio usa o mesmo valor, válido por 24 horas.

### 6.4 Política de tentativas
- No máximo **uma** chamada por `client_request_id` automaticamente.
- Nenhuma tentativa automática em estado `unknown`.
- Pacing: a documentação de iMessage fala em intervalo entre envios; para Instagram, não encontrado. O painel mantém a fila por clique (uma mensagem por vez).

### 6.5 Migração e rollback
- Migração `0008_social_sends`, aditiva (uma tabela nova, nada alterado).
- **Rollback:** `DROP TABLE app.inbox_social_sends`. Nenhum dado existente depende dela.
- Aplicação em produção: só com autorização específica.

---

## 7. O que pode ser feito com simulador e o que está bloqueado

| Funcionalidade | Situação |
|---|---|
| Regras de janela e bloqueio (D1), com validação no backend | Pode ser feita com simulador |
| Limite de 1.000 caracteres (D4) | Pode ser feita |
| Registro local, estados e idempotência (D2) | Pode ser feita após aprovação da migração |
| Ordem e aviso de paginação (seção 2.3) | Pode ser feita |
| Cliente de envio | **Bloqueado** até confirmar 3.2.1 e 3.2.2 |
| Tela de resposta | Depende do cliente |

---

## 8. Pendências para aprovação

1. **Texto oficial da janela fechada e dos erros 409, 422, 429 e 502 de envio.** Cole o trecho da página `send-inbox-message.mdx` que estiver fora do texto original, ou autorize uma nova leitura com a página inteira.
2. **Migração `0008_social_sends`** (seção 6): aprovar o esquema e o rollback.
3. **Aviso de ordem não confirmada** (seção 2.3): aprovar a correção.
4. **Nova leitura real** para validar a ordem, só com justificativa e escopo separados (uma conversa, 10 mensagens, mostrando `sortOrderApplied`).
5. Confirmar D1 e D4 como descritos.

---

## 9. Testes necessários (com a Zernio simulada)

| Caso | Esperado |
|---|---|
| Última mensagem do contato há 2 h | Envio sem tag |
| Há 3 dias | Envio com `HUMAN_AGENT` e `MESSAGE_TAG` |
| Há 8 dias | Bloqueado |
| Sem mensagem do contato nas lidas | Bloqueado |
| Origem automática ou IA | Recusado pela API |
| Visualizador | 403 |
| Mesmo `client_request_id` duas vezes | Uma chamada à Zernio |
| 5xx ou tempo esgotado | `unknown`, sem reenvio automático |
| Texto acima de 1.000 caracteres | Recusado antes da Zernio |
| `sortOrderApplied` diferente de `desc` | Aviso na tela e "ver anteriores" desativado |
| Conta ou conversa de outra empresa | 404 |
| Log | Sem texto, sem chave, sem perfil |
