# Referência — API da Zernio (o que o DisparaZap usa)

| | |
|---|---|
| **Fonte** | Só documentação oficial: [zernio.com](https://zernio.com/), [docs.zernio.com](https://docs.zernio.com), especificação OpenAPI [openapi.json](https://zernio.com/openapi.json) / [openapi.yaml](https://zernio.com/openapi.yaml) |
| **Versão lida** | OpenAPI 3.1, `info.version` **1.444.0**, lida em **2026-11-02** |
| **Como foi lida** | Sem cadastro, sem chave e sem chamar nenhuma rota autenticada |
| **Plano que usa esta referência** | [PLANO_MODULO_ZERNIO.md](PLANO_MODULO_ZERNIO.md) |
| **Conferida de novo** | **2026-11-03, versão 1.450.2**, para o módulo Redes Sociais. Publicação, mídia, situação dos posts, métricas, comentários e as capacidades de cada rede estão em [PLANO_MODULO_REDES_SOCIAIS.md](PLANO_MODULO_REDES_SOCIAIS.md), seção B. O que está abaixo continua valendo |

> A Zernio é **independente** do Evolution Go (DISPARAZAP_MASTER). Esta referência resume só o que interessa ao
> DisparaZap. A especificação completa tem 763 caminhos e 1.137 operações (posts, anúncios, inbox, SMS, comércio etc.).
> Quando a documentação e a especificação discordam, isso está marcado na seção 10. A especificação muda com frequência:
> confira o [changelog](https://docs.zernio.com/changelog) antes de cada etapa nova.

---

## 1. O que é

- **API REST para publicar, agendar e analisar conteúdo em redes sociais,** com inbox de comentários e mensagens,
  anúncios e webhooks ([zernio.com](https://zernio.com/)).
- **Redes para publicar:** Instagram, Facebook, TikTok, LinkedIn, YouTube, X, Threads, Pinterest, Bluesky,
  Google Business Profile, Telegram, Discord, Slack e WhatsApp.
  - Snapchat está em beta fechado: responde `403 PLATFORM_BETA_RESTRICTED`.
  - Reddit orgânico está desativado: responde `503 PLATFORM_DISABLED`.
  - Comparativo das redes: <https://docs.zernio.com/platforms/compare>.
- **Não é preciso criar aplicativos na Meta, no TikTok etc.:** as pessoas conectam pelas aplicações aprovadas da própria
  Zernio ([use-cases/saas-platforms](https://zernio.com/use-cases/saas-platforms)).
  - A tela de autorização da rede mostra o nome **Zernio**: é "co-branded", não marca própria.
  - Aplicativos próprios são opcionais (`/v1/connect/oauth-apps`).

## 2. Conta, chave e cobrança

- **Chave de API:**
  - formato `sk_` + 64 caracteres hexadecimais; as chaves restritas começam com `zrk_`;
  - criada no painel da Zernio (<https://zernio.com/dashboard/api-keys>) e mostrada **uma vez só**
    ([quickstart](https://docs.zernio.com/quickstart));
  - não expira, a não ser com `expiresIn`;
  - para revogar, use o painel ou `DELETE /v1/api-keys/{keyId}`.
- **Escopo da chave** ([create-api-key](https://docs.zernio.com/api-keys/create-api-key)):
  - `scope` `full` | `profiles` (com `profileIds`);
  - `permission` `read-write` | `read`;
  - `disabledResourceGroups`, uma lista do que a chave **não** acessa (ex.: billing, ads, money).
  - Por padrão, a chave alcança todos os perfis da equipe.
- **Cobrança por conta de rede social conectada, por mês** ([pricing](https://docs.zernio.com/pricing),
  [pricing.md](https://zernio.com/pricing.md)):
  - contas 1–2 grátis; 3–10 a US$ 6; 11–100 a US$ 3; 101+ a US$ 1;
  - perfis e posts não são cobrados;
  - o X repassa o custo dele: cartão obrigatório (`402 twitter_passthrough`), US$ 0,015 por post e US$ 0,20 por post
    com link;
  - equipe pausada recebe `402 PAYMENT_REQUIRED` em tudo.
- **Pedido de pagamento (`402 PAYMENT_REQUIRED`, resposta `PaymentRequired` da especificação):** o campo `reason` diz o
  motivo.
  - `free_tier_exceeded`: a **equipe** já tem as contas grátis, contando **todos os perfis** e o que foi conectado no painel
    da Zernio. `details.free_tier_account_limit` e `details.current_account_count` trazem os números.
  - `twitter_passthrough`: **o X exige cartão desde a 1ª conta.**
  - `card_verification_required`: o cartão precisa de verificação (`details.verification_amount_cents`, que vira crédito).
  - `enterprise_required`: o limite do contrato empresarial foi atingido.
  - **O que fazer:** levar a pessoa ao `dashboard_url`, a cobrança da Zernio.
- **Uso:** `GET /v1/usage` traz `usage.connectedAccounts`, que deveria ser o total de redes da conta.
  **Na conta real ele respondeu 0 com 2 redes ativas** (2026-11-02; veja a seção 10). O DisparaZap conta pela lista
  `GET /v1/accounts?status=connected` sem perfil.
- **Limites, sempre por equipe** ([rate-limits](https://docs.zernio.com/guides/rate-limits)):
  - 0–2 contas conectadas: 60 pedidos/min; 3–2.000: 600/min;
  - cabeçalhos `X-RateLimit-*`, e `Retry-After` no 429;
  - publicação: 25 posts/hora por conta, além de limites diários por rede.
- **Multiempresa** ([multi-tenant](https://docs.zernio.com/multi-tenant)):
  - "um perfil por cliente", com `externalId` = o id do cliente na sua plataforma;
  - cobrança, limite e suspensão valem para a **equipe** inteira.
  - **No DisparaZap cada empresa usa a própria conta Zernio** (PLANO_MODULO_ZERNIO, decisão Z1): a cobrança e a
    suspensão de uma não alcançam as outras.

## 3. Formato geral

- **Endereço base:** `https://zernio.com/api/v1`. A versão vai no caminho, e as mudanças que quebram compatibilidade só
  saem numa versão nova ([api-reference](https://docs.zernio.com/api-reference)).
- **Autenticação:** `Authorization: Bearer <chave>`.
- **Toda resposta traz `X-Request-Id`.**
- **Erros** ([error-handling](https://docs.zernio.com/guides/error-handling)):
  - formato `{ error, type, code, param?, details?, platform?, platformError?, docUrl? }`;
  - decidir por `type` (`invalid_request_error`, `authentication_error`, `permission_error`, `not_found`,
    `rate_limit_error`, `platform_error`, `api_error`) e por `code`, **nunca** pelo texto de `error`;
  - algumas respostas antigas trazem só `error`.
- **Parâmetros desconhecidos são ignorados em silêncio** (ex.: `scheduled_for` em vez de `scheduledFor`). A exceção é
  `GET /v1/posts`, que responde 400.
- **Idempotência:** cabeçalho `Idempotency-Key` em `POST /v1/posts`, `POST /v1/profiles` e no envio de mensagens
  ([idempotency](https://docs.zernio.com/guides/idempotency)).

## 4. Verificar a chave

`GET /v1/auth/verify`: confere a chave sem ler dados ([verify-credential](https://docs.zernio.com/api-keys/verify-credential)).
- **200:** `valid`, `userId`, `name`, `email`, `authType` (`api_key` | `oauth` | `session`), `scope`.
- **401:** `code` `missing_credentials` | `invalid_credentials`.

## 5. Perfis (o "contêiner" das contas de uma marca)

Objeto: `_id`, `name`, `description`, `color`, `timezone`, `externalId`, `isDefault`, `isOverLimit`, `accountCount`,
`createdAt` ([guides/profiles](https://docs.zernio.com/guides/profiles)).

| Operação | Rota | Observações |
|---|---|---|
| Listar | `GET /v1/profiles?externalId=&name=&limit=&skip=` | `externalId` busca exata |
| Criar | `POST /v1/profiles` `{ name*, description, color, timezone, externalId }` | 201 `{ message, profile }`. 409 `profile_name_conflict` / `profile_external_id_conflict` com `details.existingProfileId` |
| Ler / alterar / excluir | `GET`/`PUT`/`DELETE /v1/profiles/{profileId}` | Excluir dá 400 se ainda houver contas ativas |

## 6. Conectar redes sociais

- **`GET /v1/connect/{platform}?profileId=…&redirect_url=…`** ([get-connect-url](https://docs.zernio.com/connect/get-connect-url),
  [guia](https://docs.zernio.com/guides/connecting-accounts)):
  - `platform`: `facebook`, `instagram`, `linkedin`, `twitter`, `tiktok`, `youtube`, `threads`, `pinterest`, `bluesky`,
    `googlebusiness`, `telegram`, `snapchat`, `discord`, `slack`, `whatsapp`, `reddit` (e `google`/`microsoft`);
  - `redirect_url` precisa ser **absoluto**; relativo dá `400 INVALID_REDIRECT_URL`;
  - opcionais: `reconnectAccountId`, `headless`, `scopes`, `welcome` + `brandName`/`logoUrl`/`primaryColor`, `handoff`
    (QR para terminar no celular), `loginMethod` (Instagram) e `language` (`pt-BR` só na página do WhatsApp);
  - resposta `{ authUrl, state }`;
  - erros: `402 PAYMENT_REQUIRED` (`free_tier_exceeded`, `twitter_passthrough`, …), `403 PLATFORM_BETA_RESTRICTED` e
    404 para perfil inexistente.
- **Volta para o `redirect_url`:**
  - com sucesso: `connected={platform}&profileId=…&accountId=…&username=…` (+ `request_id` e `stage`);
  - com falha: `error` e `platform`, e às vezes `error_message`, `is_user_fixable`, `reason` e `missing_scopes`. A lista
    de erros não é fechada (ex.: `oauth_denied`, `no_facebook_pages`, `account_mismatch`).
  - Um `redirect_url` de outro site passa antes por uma página da Zernio (`/connect/continue`), que pede um clique para
    continuar.
- **Seleção depois da autorização** (página do Facebook, organização do LinkedIn, pasta do Pinterest, local do Google
  Business):
  - no modo padrão, a Zernio mostra a tela;
  - no `headless=true`, quem mostra somos nós (rotas `/v1/connect/{platform}/select-…`).
- **Reconectar:** a mesma rota com `reconnectAccountId`, que mantém o id e o histórico.
- **Bluesky e Telegram** conectam por credenciais (`/v1/connect/bluesky/credentials`, `/v1/connect/telegram`), não por
  OAuth.

## 7. Contas conectadas

- **Listar:** `GET /v1/accounts?profileId=&platform=&status=` ([list-accounts](https://docs.zernio.com/accounts/list-accounts)).
  - Campos: `_id`, `platform`, `profileId`, `isActive`, `username`, `displayName`, `profilePicture`, `profileUrl`,
    `needsReconnection`, `enabled`, `followersCount`.
  - **Não existe** `GET /v1/accounts/{id}`: use `search=<id>`.
- **Saúde:** `GET /v1/accounts/health?profileId=` ([accounts-health](https://docs.zernio.com/accounts/get-all-accounts-health)).
  - Resposta: `summary {total, healthy, warning, error, needsReconnect}` e, por conta, `status`, `canPost`, `tokenValid`,
    `tokenExpiresAt`, `needsReconnect`, `issues[]` e `disconnectReason`.
- **Desconectar:** `DELETE /v1/accounts/{accountId}`, que responde `{ message }`.
  - Reconectar a mesma conta em até 1 hora mantém o id.
  - Repetir a chamada dá 404.

## 8. Publicação (etapa seguinte do plano)

- **Imagens e vídeos:** `POST /v1/media/presign` `{ filename, contentType, size }` responde `{ uploadUrl, publicUrl }`;
  depois é um `PUT` do arquivo. Também se pode passar uma URL pública HTTPS.
- **Posts:** `POST /v1/posts` `{ content, mediaItems[], platforms[{platform, accountId, …}], scheduledFor, timezone,
  publishNow, isDraft }`:
  - 201 cria; **207** é falha parcial ou total ao publicar na hora; 409 é post repetido;
  - status: `draft`, `scheduled`, `publishing`, `published`, `partial`, `failed`, `cancelled`;
  - sempre mande `timezone` (ex.: `America/Sao_Paulo`).
  - Guia: [create-post](https://docs.zernio.com/posts/create-post); ciclo de vida:
    [post-lifecycle](https://docs.zernio.com/guides/post-lifecycle).
- **Limites por rede:** Instagram só contas Business/Creator; Facebook só Páginas; TikTok exige mídia.
  Detalhes nas páginas `docs.zernio.com/platforms/<rede>`.

## 9. Webhooks (dependem de endereço público)

- **Configuração:** `POST /v1/webhooks/settings` `{ name, url, events[], secret, profileIds[] }`. Há também `GET`,
  `PUT`, `DELETE`, `POST /v1/webhooks/test` e os logs ([webhooks](https://docs.zernio.com/webhooks)).
- **Assinatura:** `X-Zernio-Signature` = HMAC-SHA256 em hexadecimal minúsculo **do corpo bruto**, com o `secret` que
  nós definimos.
  - Não tem carimbo de tempo.
  - A Zernio nunca gera o segredo.
  - Comparar em tempo constante.
- **Entrega:**
  - "pelo menos uma vez": deduplicar por `X-Zernio-Event-Id`;
  - responder 2xx em até 5 s;
  - até 7 tentativas.
- **Eventos úteis:** `account.connected`, `account.disconnected` (com `disconnectionType` e `reason`),
  `account.permissions_changed`, `post.published`, `post.failed`, `post.partial`, `post.platform.*`, `comment.received` e
  `message.received`.

## 10. Divergências na documentação oficial

1. **Fuso padrão sem `timezone`:** o guia diz UTC; a especificação diz o fuso do perfil.
2. **`DELETE /v1/accounts/{id}`:** o guia cita `gracePeriodEndsAt`, que não está na especificação.
3. **Faixa de 1.200 pedidos/min:** automática segundo o guia; "fale com o suporte" segundo o `llms.txt`.
4. **"Requires Inbox addon"** nas rotas de inbox, contra "inbox incluído" na página de preços (provavelmente planos
   antigos).
5. **`bearerFormat: JWT`** na especificação, mas a chave é um `sk_` opaco.
6. **`/v1/usage` → `usage.connectedAccounts`** respondeu **0** numa conta com 2 redes ativas (observado em 2026-11-02, cobrança
   por uso). Para contar, use a lista de contas.

## 11. Termos, dados e LGPD

- **Termos** ([tos](https://zernio.com/tos)):
  - lei espanhola;
  - "abuso da API" pode suspender a conta;
  - **não tratam de revenda nem de embutir em outro SaaS.** Com cada empresa usando a própria conta, é a empresa que aceita
    os termos.
- **Regras de conteúdo** ([content-guidelines](https://zernio.com/content-guidelines)): proíbem conteúdo idêntico
  repetido em várias contas, propaganda não solicitada em excesso e spam automatizado.
- **Dados** ([dpa](https://zernio.com/dpa), [subprocessors](https://zernio.com/subprocessors)):
  - a Zernio é **operadora** (o cliente é o controlador);
  - empresa na Espanha; banco em Londres (AWS eu-west-2); logs nos EUA;
  - SOC 2 Type 2 ([trust](https://trust.zernio.com)).
  - **A LGPD não é citada** nos documentos da Zernio.
- **O que o DisparaZap guarda:** a chave (cifrada) e identificadores (id do perfil). O conteúdo das redes fica na Zernio
  e nas próprias redes.

## 12. TikTok: mensagens diretas (lidas em 2026-11-05)

Fontes: `docs.zernio.com/platforms/tiktok` e `docs.zernio.com/platforms/tiktok/inbox` (a página `docs.zernio.com/inbox` deu 404).

- Só contas **TikTok Business**, conectadas pelo app *TikTok for Business*. Contas no app de desenvolvedor retornam `400 PLATFORM_LIMITATION`.
- Região de cadastro fora do EEA, Suíça e Reino Unido. A conta precisa aceitar mensagens diretas; senão não chegam webhooks.
- **Só responder:** não é possível iniciar conversa.
- Janela: até 10 mensagens em 48 h depois da última mensagem do usuário. Fora dela, falha com erro do próprio TikTok (sem código documentado).
- Texto até 6.000 caracteres, ou uma imagem JPG/PNG até 3 MB. Texto e imagem juntos retornam `400 PLATFORM_LIMITATION`.
- Listar e buscar mensagens são citados como suportados. **Não encontrado na documentação:** os parâmetros de `GET /v1/inbox/conversations` para o filtro `platform=tiktok` (o cliente já envia `platform` como nas outras redes; a confirmação é a primeira leitura real) e a referência de `POST .../messages` além de texto e imagem.

Situação no DisparaZap: a lista de conversas do TikTok foi liberada no código (somente leitura). Mensagens, diagnóstico e envio continuam só no Instagram.
