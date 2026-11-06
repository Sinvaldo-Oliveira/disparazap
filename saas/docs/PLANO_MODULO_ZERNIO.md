# Plano — Integração com a Zernio (redes sociais das empresas)

| | |
|---|---|
| **Status** | ✅ **Aprovado** pelo dono do produto em 2026-11-02 ("Pode executar assim"), com as decisões Z1 a Z7 recomendadas. **Z1 implementada** contra a Zernio simulada; a homologação real (Z2) é feita pelo dono do produto com a conta Zernio dele |
| **Data** | 2026-11-02 |
| **Pedido** | "Que cada conta possa configurar a conta da Zernio e a API, para cadastrar as redes sociais desejadas", na página **Integrações** |
| **Referência técnica** | [REFERENCIA_ZERNIO.md](REFERENCIA_ZERNIO.md), lida só na documentação oficial (OpenAPI 1.444.0, 2026-11-02) |
| **Muda decisão anterior** | DISPARAZAP_MASTER, 2026-10-31: "Zernio fora do primeiro MVP SaaS". O dono do produto a trouxe para agora |

---

## Andamento (2026-11-02)

| Etapa | Situação |
|---|---|
| Z0 | ✅ Documentação oficial no repositório ([REFERENCIA_ZERNIO.md](REFERENCIA_ZERNIO.md)) |
| Z1 | ✅ Implementada contra a **Zernio simulada**: migration `0005_zernio`, adaptador, serviço, rotas, página Integrações, página de volta e 33 testes novos (16 da API, 16 do painel e 1 do cofre). O painel foi feito por um agente em paralelo; uma revisão de código automática apontou 7 ajustes, todos aplicados (DECISOES_TECNICAS D-46 e D-47) |
| Z2 | 🟨 **Em andamento, pelo dono do produto (2026-11-02):** chave salva e **Instagram conectado de verdade**. A segunda rede recebeu um pedido de pagamento da Zernio (402); o painel passou a mostrar o motivo exato e o link da cobrança (CHANGELOG). Na conta real (leitura autorizada), o **mesmo Instagram estava conectado duas vezes**: no perfil "Default" (início guiado da Zernio) e no do DisparaZap, somando 2 de 2 grátis. O painel passou a mostrar o total da conta e as redes fora do perfil. A cópia no "Default" foi desconectada pelo assistente a pedido do dono do produto, e a conta ficou com 1 rede. Falta conectar o TikTok e testar desconectar e reconectar pelo painel |
| Z3 | ✅ CHANGELOG, MASTER, DECISOES (D-46 e D-47), ESTRUTURA (seção 13), README e CLAUDE.md |
| Z-P | ⬜ Publicar e agendar (página Redes Sociais) e webhooks: plano próprio em [PLANO_MODULO_REDES_SOCIAIS.md](PLANO_MODULO_REDES_SOCIAIS.md) (auditoria de 2026-11-03, aguardando aprovação) |

## 1. Objetivo

Cada empresa do DisparaZap liga a **própria conta da Zernio** (com a própria chave de API) na página **Integrações**. Depois,
conecta as redes sociais que quiser: Instagram, Facebook, TikTok, LinkedIn etc.

### Entra nesta etapa
- **Página Integrações** com o catálogo:
  - **Zernio:** disponível;
  - **WhatsApp:** atalho para a página WhatsApp;
  - **API e webhooks (MyLinksss):** "Em desenvolvimento".
- **Conta Zernio da empresa:** colar a chave, testar, salvar cifrada, trocar e remover.
- **Perfil da empresa dentro da Zernio** (decisão Z4), criado ou reaproveitado pelo DisparaZap.
- **Conectar redes sociais** pelo fluxo oficial de autorização da Zernio, com volta para o painel.
- **Lista das redes conectadas:** situação (ok / precisa reconectar), **reconectar** e **desconectar**, com confirmação.
- **Testes contra uma Zernio simulada.** Nenhuma chamada real nos testes.

### Fica de fora (etapas seguintes)
- **Publicar e agendar posts** com texto, imagem e vídeo (página **Redes Sociais**, etapa Z-P).
- **Webhooks da Zernio** (conta desconectada, post publicado ou falhou): exigem endereço público com HTTPS, ou seja, a
  publicação na Hostinger.
- **Análises, inbox de comentários e mensagens diretas, anúncios.**
- **Bluesky e Telegram:** conectam por usuário e senha de aplicativo, não pelo fluxo de autorização. Ficam para depois.
- **Uma conta Zernio da plataforma** compartilhada entre empresas: modelo não escolhido (veja Z1).

## 2. Como funciona para a empresa (telas)

**Página Integrações** (`/integracoes`):

1. **Catálogo.** Um cartão por integração, com a situação:
   - Zernio: "Não configurada", "Conectada (n redes)" ou "Chave recusada";
   - WhatsApp: leva à página WhatsApp;
   - API/MyLinksss: "Em desenvolvimento".
2. **Conectar a conta Zernio** (cartão aberto):
   - **Passo a passo curto:**
     1. Crie a conta em zernio.com.
     2. Em *API Keys*, crie uma chave.
     3. **Recomendado:** desligue o que o DisparaZap não usa (cobrança, anúncios, dinheiro).
     4. Copie a chave: ela aparece uma vez só.
   - **Campo "Chave de API"** (oculto, com mostrar/ocultar) e o botão **Testar e salvar**:
     - a API confere a chave na Zernio (`GET /v1/auth/verify`);
     - só então guarda, cifrada;
     - mostra "Conta Zernio de *nome*" e o final da chave (`…a1b2`).
   - **Trocar chave** e **Remover integração:**
     - remover apaga a chave do DisparaZap;
     - não mexe na conta da Zernio, e as redes continuam conectadas lá.
3. **Redes sociais**, depois da chave salva:
   - **Grade de redes**, cada uma com **Conectar**: Instagram, Facebook, TikTok, LinkedIn, YouTube, Threads, Pinterest,
     Google Business e X (decisão Z5).
     - No X aparece o aviso: "cobra por post na sua conta Zernio e exige cartão".
   - **Ao clicar em Conectar:**
     1. O navegador vai para a Zernio e para a rede, onde a pessoa autoriza. A tela da rede mostra "Zernio".
     2. Ele volta para o painel em `/integracoes/zernio/retorno`.
     3. O painel mostra "Instagram @loja conectado" ou o motivo da falha. Exemplos: "você cancelou", "a conta do
        Facebook não tem Página".
   - **Facebook, LinkedIn, Pinterest e Google Business:** a Zernio mostra uma tela para escolher a página,
     organização, pasta ou local antes de voltar.
4. **Redes conectadas:**
   - tabela com rede, nome/@, situação e as ações **Reconectar** e **Desconectar**, com confirmação;
   - "Precisa reconectar" aparece quando a Zernio indica token vencido;
   - os dados são **lidos na hora da Zernio**; o DisparaZap não guarda cópia das contas nesta etapa.

**Quem pode:**
- **Dono e administradores:** configuram a chave, conectam e desconectam;
- **Operadores e visualizadores:** só veem (decisão Z3).

**Conta sem empresa** (Super-Admin puro): aviso, como nas outras páginas.

## 3. Regras de segurança

- **A chave da Zernio nunca chega ao navegador:**
  - fica no cofre `platform.integration_credentials` (AES-256-GCM, `SECRETS_MASTER_KEY`), com `provider = 'zernio'`,
    `kind = 'api_key'` e a empresa;
  - o painel só vê os 4 últimos caracteres;
  - nunca vai para o log (o logger já esconde `authorization`; a chave nunca entra em mensagem).
- **A empresa vem sempre da sessão.** Uma empresa nunca vê nem usa a chave ou as redes de outra (404).
- **Endereço fixo da Zernio** (`https://zernio.com/api/v1`) no código:
  - a empresa não informa URL, o que impede usar o DisparaZap para chamar outros endereços;
  - TLS sempre verificado;
  - tempo-limite em toda chamada.
- **Volta da autorização protegida:**
  - o `redirect_url` leva um **comprovante assinado pelo DisparaZap**, com empresa, usuário, rede e validade de 15
    minutos;
  - na volta, a API confere a assinatura, a sessão e a empresa;
  - a API **relê as contas na Zernio** em vez de confiar no que veio na URL;
  - o comprovante é curto, porque o X limita a URL de volta a 258 caracteres.
- **Respostas da Zernio nunca repassadas:**
  - a API converte cada erro em um **motivo fixo** (chave recusada, pagamento pendente na Zernio, limite de pedidos,
    rede indisponível, falha);
  - decide por `type`/`code`, nunca pelo texto.
- **Proteções de sempre:** verificação de origem nas rotas que alteram (CSRF) e limite de tentativas por empresa.
- **LGPD:**
  - o DisparaZap guarda só a chave (cifrada) e o id do perfil;
  - conteúdo e dados das redes ficam na Zernio, que é operadora da empresa (veja a seção 9).

## 4. Dados (migration `0005_zernio`, só com aprovação)

| Tabela | Colunas principais | Observações |
|---|---|---|
| `platform.integration_credentials` (já existe) | `provider='zernio'`, `kind='api_key'`, `organization_id` | Sem mudança de estrutura |
| `app.zernio_connections` (nova) | `organization_id` (único), `credential_id` → cofre, `profile_id`, `profile_name`, `zernio_user_name`, `status` (`active` / `invalid`), `last_check_at`, `last_check_status`, `created_by`, `created_at`, `updated_at` | Uma por empresa. Exclusão em cascata com a empresa |

- **As contas conectadas não são copiadas para o banco nesta etapa.** São lidas na Zernio a cada abertura da página.
  Copiá-las faz sentido quando houver publicação (histórico) ou webhooks.
- **O comprovante da volta não precisa de tabela:** é assinado e tem validade curta.

## 5. Adaptador e API

**Adaptador próprio** (`apps/api/src/integrations/zernio-client.ts`), no padrão do da Evolution:
- `fetch` com tempo-limite, `Authorization: Bearer`, endereço fixo;
- leitura defensiva das respostas;
- erros classificados por `type`/`code`/status: `unauthorized`, `payment_required`, `rate_limited`, `not_found`,
  `conflict`, `platform_unavailable`, `invalid`, `unreachable`, `failed`.
- **Por que não o SDK oficial `@zernio/node`:** veja D-46 proposta.
  - Usamos 8 rotas.
  - O SDK está na versão 0.2.1440 e muda quase todo dia.
  - O adaptador próprio mantém o mesmo controle de TLS, erros e logs da Evolution e é testado contra o simulador.

| Uso | Rota da Zernio |
|---|---|
| Testar e salvar a chave | `GET /v1/auth/verify` |
| Achar ou criar o perfil da empresa | `GET /v1/profiles?externalId=<id da empresa>` e `POST /v1/profiles` |
| Link de autorização | `GET /v1/connect/{platform}?profileId&redirect_url[&reconnectAccountId]` |
| Redes conectadas e situação | `GET /v1/accounts?profileId` e `GET /v1/accounts/health?profileId` |
| Desconectar | `DELETE /v1/accounts/{accountId}` |

**Rotas do DisparaZap** (`/api/internal/integrations/zernio`; empresa e papel da sessão; contratos em
`packages/contracts`):

| Rota | Quem | O que faz |
|---|---|---|
| `GET /` | todos da empresa | Situação: configurada?, final da chave, nome da conta, perfil, `canManage` |
| `PUT /key` | dono/admin | Testa e salva a chave (cifrada); acha ou cria o perfil |
| `DELETE /key` | dono/admin | Remove a chave e a ligação (não mexe na Zernio) |
| `GET /accounts` | todos da empresa | Redes conectadas + situação, lidas na Zernio |
| `POST /connect` `{ platform, reconnectAccountId? }` | dono/admin | Devolve o link de autorização (com o comprovante na volta) |
| `POST /connect/return` `{ dz, connected?, accountId?, error?, … }` | dono/admin | Confere o comprovante e relê as contas; devolve a mensagem para a tela |
| `DELETE /accounts/:accountId` | dono/admin | Desconecta (só contas do perfil da empresa) |

**Painel:**
- `IntegrationsPage` (catálogo + cartão Zernio);
- `ZernioReturnPage` (rota `/integracoes/zernio/retorno`);
- `zernio-api.ts`;
- o menu "Integrações" passa a "Disponível".

## 6. Testes (sem Zernio real)

- **Zernio simulada** (`apps/api/src/testing/zernio-simulator.ts`, fora do build):
  - nos formatos da documentação oficial: verify, perfis, connect, contas, saúde e exclusão;
  - nos erros 401, 402, 404, 409, 429 e 503;
  - aceita só a chave de teste.
- **API:**
  - chave recusada não é salva; chave válida fica cifrada e nunca volta inteira;
  - perfil criado uma vez só (externalId);
  - isolamento entre empresas; viewer e operador só leem;
  - comprovante da volta: vencido, de outra empresa ou de outro usuário é recusado;
  - desconectar conta de outro perfil dá 404;
  - erros da Zernio viram motivos fixos;
  - a chave não aparece em resposta nem no log.
- **Painel:**
  - catálogo e situações;
  - salvar e trocar a chave;
  - conectar (link) e página de volta, com sucesso e com erro;
  - desconectar com confirmação;
  - viewer sem botões; conta sem empresa.
- Testes, typecheck e build do SaaS, mais a suíte do MVP.

## 7. Etapas

| Etapa | O que | Acessa a Zernio real? | Depende de |
|---|---|---|---|
| **Z0** | Documentação oficial no repositório ([REFERENCIA_ZERNIO.md](REFERENCIA_ZERNIO.md)) e este plano | Não (só leitura pública) | ✅ feito |
| **Z1** | Backend, migration `0005`, adaptador, rotas, telas e testes, **contra o simulador** | Não | Aprovação deste plano |
| **Z2** | **Homologação** com a **sua** conta Zernio: salvar a chave, conectar 1 rede (as 2 primeiras são grátis), conferir a situação, desconectar | Sim, com a sua chave | Decisão Z6 |
| **Z3** | Documentação: CHANGELOG, MASTER, DECISOES (D-46 e seguintes), ESTRUTURA | Não | — |
| **Z-P** (depois) | Publicar e agendar na página **Redes Sociais** (mídia, posts, situação), e webhooks após a publicação na Hostinger | Sim | Novo plano |

## 8. Decisões para o dono do produto

| # | Decisão | Recomendação |
|---|---|---|
| Z1 | Modelo de conta | ✅ **Já decidido:** cada empresa usa a **própria conta Zernio e a própria chave**. A cobrança, o limite e o risco de suspensão ficam separados por empresa |
| Z2 | Onde fica | **Integrações** guarda a conexão (chave + redes). **Redes Sociais** fica para publicar e agendar (etapa Z-P) |
| Z3 | Quem configura | **Dono e administradores**; operadores e visualizadores só veem |
| Z4 | Perfil dentro da conta Zernio da empresa | O DisparaZap **cria ou reaproveita um perfil próprio** ("DisparaZap — *empresa*", com `externalId` = id da empresa). Os outros perfis da conta Zernio não são tocados |
| Z5 | Redes da primeira etapa | Instagram, Facebook, TikTok, LinkedIn, YouTube, Threads, Pinterest, Google Business e **X com aviso de custo**. Bluesky e Telegram depois. Reddit e Snapchat ficam fora (indisponíveis na Zernio). WhatsApp continua pela Evolution |
| Z6 | Homologação real (Z2) | **Autorizar depois da Z1 pronta**, com a sua conta Zernio e 1 rede de teste |
| Z7 | Super-Admin vê as integrações das empresas | **Não nesta etapa.** As chaves e as redes são da empresa |

## 9. Custos, limites e riscos

- **Custo:** cobrado pela Zernio **direto na conta de cada empresa**.
  - As 2 primeiras redes conectadas são grátis; da 3ª à 10ª, US$ 6 cada por mês.
  - O X cobra por post (US$ 0,015, ou US$ 0,20 com link) e exige cartão.
  - O DisparaZap não paga nem revende nada nesta etapa.
- **Limites da Zernio:** 60 pedidos/min por conta com até 2 redes. A página faz poucas chamadas; o limite atingido vira
  a mensagem "tente em instantes".
- **Marca:** a tela de autorização da rede mostra "Zernio", não "DisparaZap". Para mostrar o nosso nome, seria preciso ter
  aplicativos próprios na Meta, no TikTok etc. (opcional, depois).
- **Termos e conteúdo:** cada empresa aceita os termos da Zernio ao criar a conta. As regras da Zernio proíbem spam e
  conteúdo repetido em várias contas; o painel vai lembrar isso na publicação (Z-P).
- **LGPD:**
  - a Zernio processa os dados na Europa (Londres) e nos EUA (logs);
  - é operadora da empresa;
  - não cita a LGPD;
  - o DisparaZap guarda o mínimo (chave cifrada e id do perfil).
- **A documentação muda rápido** (versão 1.444 em 2026-11-02):
  - o adaptador lê as respostas com tolerância;
  - a homologação Z2 confere os formatos reais;
  - parâmetros desconhecidos são ignorados em silêncio pela Zernio, então os testes conferem os nomes exatos.
- **Volta passa por uma página da Zernio** ("continuar para o seu site"). É um clique a mais, documentado na tela.
