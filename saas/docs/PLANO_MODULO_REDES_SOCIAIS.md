# Plano — Módulo Redes Sociais (operação diária pela Zernio)

| | |
|---|---|
| **Status** | ✅ **Aprovado** pelo dono do produto em 2026-11-03 ("pode criar as funcionalidades conforme o seu planejamento"), com as recomendações R1 a R10. **S1 a S5, S7 e a biblioteca de imagens implementados** contra a Zernio simulada (veja "Andamento"). Vídeo (S6), webhooks e interações (S8) ficam para as próximas etapas |
| **Data** | 2026-11-03 |
| **Pedido** | Transformar o item **Redes Sociais** do menu num módulo completo: visão geral, criar publicação, calendário editorial, biblioteca de mídia, histórico, resultados e interações |
| **Tipo** | Auditoria técnica e planejamento (sem implementação) |
| **Fonte da Zernio** | Só documentação oficial e pública, lida em 2026-11-03 sem chave e sem chamar rotas autenticadas: especificação OpenAPI (`https://zernio.com/openapi.json`, **versão 1.450.2**), `docs.zernio.com/llms.txt`, páginas `docs.zernio.com/platforms/<rede>`, `platforms/compare`, `guides/post-lifecycle`, `guides/rate-limits` e `zernio.com/pricing.md` |
| **Depende de** | Integração Zernio já implementada (etapa Z1 do PLANO_MODULO_ZERNIO): chave da empresa no cofre, perfil da empresa e redes conectadas na página **Integrações** |

## Andamento (2026-11-03)

| Etapa | Situação |
|---|---|
| S0 | ✅ Plano aprovado; decisões R1 a R10 seguem as recomendações da tabela "Decisões para o dono do produto" |
| S1 | ✅ Abas da seção e Visão Geral: contas e saúde, contagem por situação, próximas publicações, alertas, desempenho de 30 dias e fuso da empresa |
| S2 | ✅ Criar publicação (imagem e texto): Instagram (feed, carrossel e Story), Facebook (publicação e Story), LinkedIn, Threads, Pinterest (título, link e pasta), Google Business e X (aviso de custo); texto por rede, regras ao vivo, prévia aproximada, publicar agora (com confirmação) e rascunho; idempotência (Idempotency-Key, tentativa repetida no tempo esgotado) |
| S3 | ✅ Agendamento no fuso da empresa (`identity.organizations.timezone`), editar, reagendar só a data (`POST …/reschedule`) e cancelar |
| S4 | ✅ Histórico: filtros na URL, busca, páginas, detalhes por rede, motivo da falha em mensagem fixa, link da publicação, tentar de novo protegido, remover da rede (dono e administradores), sincronização incremental (`updatedSince`) |
| S5 | ✅ Calendário mês/semana/dia no fuso da empresa, filtros por rede e situação, detalhes e reagendar pelo painel lateral (arrastar fica para depois) |
| S6 | 🟨 Parcial: **biblioteca de imagens** pronta (lista, busca, tipo, envio, exclusão, aviso de imagem usada em modelo). **Vídeo** (Reels, Stories em vídeo, TikTok, YouTube) depende de conferir na homologação o endereço do armazenamento da Zernio (política de segurança) e da decisão de armazenamento (R5) |
| S7 | ✅ Resultados: períodos de 7, 30 e 90 dias, totais, por rede (com "—" onde a rede não informa) e publicações com mais engajamento; plano sem métricas mostra o aviso |
| S8 | ⬜ Webhooks e Interações: dependem do sistema publicado com HTTPS e de uma política de LGPD |
| Homologação real | ⬜ Pelo dono do produto, com a conta Zernio dele (R10): primeiro só leitura (Visão Geral), depois 1 publicação e 1 agendamento de teste |

> **Divisão de papéis (mantida):** a página **Integrações** conecta e desconecta as contas (chave da Zernio e redes). A seção
> **Redes Sociais** opera essas contas no dia a dia: publicar, agendar, acompanhar e medir. Nenhuma tela de conexão é
> duplicada em Redes Sociais; quando falta algo, ela leva a Integrações.

---

## Resumo das descobertas

1. **A Zernio faz o trabalho pesado de publicação:**
   - publica na hora, agenda (com fuso horário), guarda rascunhos e edita e cancela agendamentos;
   - tenta de novo só as redes que falharam e informa a situação por rede, com o link do post publicado;
   - tem métricas e comentários.
   - **Não precisamos de fila própria para agendar:** o agendamento é nativo da Zernio.
2. **Toda mídia precisa estar num endereço público HTTPS.**
   - A Zernio fornece o armazenamento: pedido de envio assinado, até 5 GB por arquivo.
   - Hoje o DisparaZap guarda só imagens de até 5 MB, dentro do banco, para o WhatsApp.
3. **A Zernio não tem uma "biblioteca de mídia" consultável,** e a mídia não usada **é apagada junto com o post excluído**.
   A biblioteca precisa ser do DisparaZap.
4. **Não existe hoje "agência alternando entre clientes":**
   - cada conta pertence a uma empresa só;
   - os convites estão desligados (auditoria A5) e o painel não tem seletor de empresa.
   - O filtro "por empresa" do calendário depende dessa decisão (R4).
5. **Não existe fuso horário por empresa** no banco. Ele é necessário para agendar e para o calendário (decisão R3).
6. **Os webhooks da Zernio exigem um endereço público com HTTPS,** ou seja, o sistema publicado na Hostinger. Até lá, a
   situação dos posts é atualizada consultando a Zernio de forma incremental (`updatedSince`).
7. **Limites importantes:**
   - 60 pedidos/min por conta Zernio com até 2 redes (6/s nas métricas);
   - 25 posts por hora por rede conectada;
   - limites diários por rede (Instagram 100, TikTok 15 vídeos + 15 fotos, Pinterest 25…).
8. **No painel publicado, a política de segurança (CSP) só permite imagens e conexões do próprio endereço.** Mostrar mídia
   hospedada na Zernio, ou enviar vídeo direto do navegador para ela, exige ajustar essa política com o endereço exato
   (etapa de vídeo).
9. **Primeira etapa recomendada: S1 — estrutura da seção e Visão Geral (só leitura).**
   - Contas e saúde, contagem de publicações por situação, próximas publicações e alertas, com dados reais da Zernio.
   - Sem migration e sem publicar nada.

---

## A. Arquitetura atual

### A.1 Tecnologias

| Camada | Tecnologia |
|---|---|
| Linguagem e execução | TypeScript 7 (só sintaxe "apagável"), Node.js 24 (executa o TypeScript direto em desenvolvimento; JavaScript compilado em produção) |
| API | Fastify 5 + Zod 4; erros em RFC 9457; logs pino com redação; CORS por lista; proteção de origem (CSRF) nas rotas do painel |
| Autenticação | Better Auth dentro da API: sessão em cookie `HttpOnly` no banco, senhas argon2id, plugin de organizações com papéis `owner`, `admin`, `operator`, `viewer` |
| Banco | PostgreSQL via Drizzle (esquemas `identity`, `platform`, `app`). Em desenvolvimento, banco embutido PGlite; em produção, Supabase (ainda não conectado). RLS previsto para quando o Supabase entrar; até lá, a API filtra pela empresa da sessão |
| Painel | React 19 + Vite 8 + React Router 8; CSS próprio (`global.css`) com componentes `Card`, `PageHeader`, `StatusBadge`, `UnderConstruction` |
| Worker | Aplicação `apps/worker` com ciclo de vida pronto, **sem filas** (decisão de fila D5 pendente); não há Redis |
| Publicação | Aplicativo Node.js da Hostinger: um processo serve a API e o painel (`npm run pacote:hostinger`). A publicação em si ainda é uma pendência do dono do produto |
| Testes | Vitest (298 testes em 23 arquivos), simuladores da Evolution Go e da Zernio, nunca serviços reais |

### A.2 Organização do projeto

Monorepo `saas/` com npm workspaces:

| Pasta | Papel |
|---|---|
| `apps/api` | Rotas, serviços, adaptadores, cofre, autenticação |
| `apps/web` | Painel |
| `apps/worker` | Futuras filas |
| `packages/contracts` | Formatos trocados entre API e painel (Zod) |
| `packages/db` | Schema e migrations |
| `packages/shared` | Configuração, logger e encerramento |

### A.3 Estrutura multiempresa

- **Empresa:** `identity.organizations`. **Participação e papel:** `identity.members`. **Empresa ativa:**
  `identity.sessions.active_organization_id`, gravada no cadastro.
- **Quem está agindo** (`apps/api/src/auth/member.ts`):
  - em toda rota de empresa, um `preHandler` lê a sessão;
  - pega a empresa ativa (ou a primeira participação) e o papel;
  - **nunca aceita empresa ou papel vindos do navegador**;
  - sem sessão dá 401; sem empresa (ex.: Super-Admin da plataforma) dá 403.
- **Permissões:**
  - `canManage` = `owner`/`admin`: configura integrações, instâncias, chave da Zernio;
  - `canOperate` = `owner`/`admin`/`operator`: listas, envio;
  - `viewer` só lê.
  - O item de menu `Redes Sociais` já tem a permissão `social:view`, mas o painel ainda libera todos os itens para todos.
- **Isolamento dos dados:**
  - toda tabela do esquema `app` tem `organization_id` e chave composta `(organization_id, id)`;
  - recurso de outra empresa responde 404.
- **Alternar entre clientes (agência): não existe.**
  - O cadastro cria uma empresa por conta, e criar empresas pelo navegador está desligado
    (`allowUserToCreateOrganization: false`).
  - Os convites estão desligados até existir verificação de e-mail (A5).
  - O Better Auth tem a rota de trocar a empresa ativa, mas hoje ninguém consegue pertencer a duas empresas, e o painel não
    tem seletor.

### A.4 Integração Zernio existente (2026-11-02)

| Peça | Onde | O que já faz |
|---|---|---|
| Adaptador | `apps/api/src/integrations/zernio-client.ts` | Endereço fixo `https://zernio.com/api/v1`, TLS verificado, sem seguir redirecionamentos, tempo-limite de 15 s. Erros classificados por `type`/`code`/status em motivos fixos, incluindo os motivos do 402. Rotas usadas: `GET /auth/verify`, `GET/POST /profiles`, `GET /profiles/{id}`, `GET /connect/{platform}`, `GET /accounts`, `GET /accounts/health`, `DELETE /accounts/{id}` |
| Serviço | `apps/api/src/zernio/zernio-service.ts` | Chave da empresa aberta do cofre (`readyClient`); perfil próprio da empresa na conta Zernio dela (`externalId` = id da empresa); contas filtradas pelo perfil; comprovante assinado na volta da autorização; conectar, reconectar e desconectar |
| Rotas | `apps/api/src/routes/zernio.ts` | `/api/internal/integrations/zernio/*`, com papel conferido antes do limite de tentativas (10/min para a chave, 30/min para as ações, por empresa) |
| Dados | `app.zernio_connections` + cofre `platform.integration_credentials` (`provider='zernio'`) | Uma ligação por empresa: perfil, nome da conta, situação. As contas de redes **não** são copiadas para o banco |
| Simulador | `apps/api/src/testing/zernio-simulator.ts` | Zernio de teste (fora do build) |
| Telas | `IntegrationsPage.tsx`, `ZernioReturnPage.tsx`, `integrations/zernio-api.ts` | Chave, redes conectadas (cards verdes), conectar, volta, desconectar |

**Modelo de conta (decisão Z1):**
- cada empresa usa a **própria conta Zernio e a própria chave**;
- com a chave de uma empresa, é fisicamente impossível ler os dados de outra;
- dentro da conta da empresa pode haver outros perfis (ex.: "Default", criado pela própria Zernio), e o DisparaZap se
  restringe ao perfil dele.

### A.5 Mídia e limites atuais

- **`app.media_files`:**
  - imagens JPEG, PNG e WebP de até 5 MB, guardadas no banco (`bytea`);
  - tipo conferido pelos primeiros bytes; sem duplicar (sha256);
  - usadas pelo Envio de Mensagens (WhatsApp).
- **Limite de corpo da API:** 1 MB por padrão e 5 MB na rota de imagem.
- **Política de segurança do painel publicado** (`web-panel.ts`): `img-src 'self' data: blob:` e `connect-src 'self'`.

---

## B. Matriz de funcionalidades da Zernio

**Legenda:**
- ✅ suportado e confirmado na documentação oficial;
- 🟨 suportado com condição (tipo de conta, permissão, plano, beta ou custo);
- ❌ indisponível na API.

**Valores de `platform`:**
- `instagram`, `facebook`, `tiktok`, `linkedin`, `youtube`, `threads`, `pinterest`, `googlebusiness`, `twitter` (X).
- Os mesmos 9 já conectáveis em Integrações.

### B.1 Funções comuns às 9 redes (mesmas rotas para todas)

| Função | Endpoint | Parâmetros e comportamento confirmados |
|---|---|---|
| **Publicação imediata** | `POST /v1/posts` com `publishNow: true` | Publica dentro do pedido. `201` = tudo publicado. **`207` = falha parcial ou total, mas é um código de sucesso (2xx)**: decidir pelo código e pelo `status`, nunca por "deu erro". Resposta traz `platformPostUrl` por rede |
| **Agendamento** | `POST /v1/posts` com `scheduledFor` (ISO 8601) + `timezone` (IANA) | Situação `scheduled`. Hora já passada publica na hora. Horário por rede possível (`platforms[].scheduledFor`). Sem `timezone`, a documentação diverge (UTC × fuso do perfil): **sempre mandar `timezone`** |
| **Rascunho** | `POST /v1/posts` com `isDraft: true` (ou sem nenhum campo de agendamento) | Rascunho pode não ter redes. Para virar agendado: `PUT` com `isDraft: false` + `scheduledFor` |
| **Aprovação antes de publicar** | `requiresApproval: true` + `POST /v1/posts/{id}/review` | Situação `pending_approval`; só publica se aprovado. Útil para agência × cliente (etapa futura) |
| **Legenda e mídia por rede** | `platforms[].customContent`, `platforms[].customMedia` | Substituem o texto e a mídia gerais naquela rede (ex.: versão curta para X e Threads) |
| **Opções por rede** | `platforms[].platformSpecificData` (+ `tiktokSettings` e `facebookSettings` na raiz) | Formato (Story, Reel), título, pasta do Pinterest, local do Google, visibilidade do YouTube etc. |
| **Upload de imagens e vídeos** | `POST /v1/media/presign` `{ filename, contentType, size }` | Devolve `uploadUrl` (envio por `PUT`, vale 1 hora) e `publicUrl` (endereço público usado no post). Até 5 GB. Tipos aceitos: JPEG, PNG, WebP, GIF, MP4, MPEG, MOV, AVI, WebM, M4V, PDF, áudio e legendas. A Zernio comprime acima do limite de cada rede (vídeos acima de 200 MB podem não ser comprimidos) |
| **Validação sem publicar** | `POST /v1/tools/validate/post` (mesmo corpo do post), `/validate/post-length`, `/validate/media` | Aponta mídia obrigatória ausente, limite de caracteres, hashtags, formato de sequência; avisa acima de 90% do limite |
| **Situação da publicação** | `GET /v1/posts/{id}` | `status` geral: `draft`, `pending_approval`, `scheduled`, `publishing`, `published`, `partial`, `failed`, `cancelled`. Por rede: `pending`, `processing`, `uploading`, `published`, `failed`, `cancelled`, com `platformPostUrl`, `publishedAt`, `errorMessage`, `errorCategory` (10 categorias) e `errorSource` (`user`, `platform`, `system`) |
| **Listar (calendário e histórico)** | `GET /v1/posts` | Filtros `profileId`, `status`, `platform`, `accountId`, `fromDate`/`toDate`, `search`, `tags`. Ordenação `sortBy` (ex.: `scheduled-asc`), `limit` até 500, `cursor`, `fields` (traz só os campos pedidos), **`updatedSince` para sincronização incremental**. `pagination.total` dá a contagem. Parâmetro desconhecido responde 400 |
| **Editar agendado** | `PUT /v1/posts/{id}` | Permitido em `draft`, `scheduled`, `failed`, `partial`, `cancelled`. Publicado: só a configuração de repostagem. Revalida as regras de cada rede (400) |
| **Cancelar ou excluir agendamento** | `DELETE /v1/posts/{id}` | Qualquer situação, menos `published`. Remove o registro na Zernio, **a mídia não usada por outro post** e as métricas já coletadas. Não remove o que já está na rede |
| **Tentar de novo** | `POST /v1/posts/{id}/retry` | Só `failed` e `partial`; **tenta de novo só as redes que falharam**. `409` se ainda estiver publicando; `402` com pagamento pendente |
| **Remover publicado da rede** | `POST /v1/posts/{id}/unpublish` `{ platform, accountId? }` | Ver a coluna "Remover da rede" em B.3 |
| **Editar publicado** | `POST /v1/posts/{id}/edit` `{ platform, content, accountId? }` | Só texto. Ver a coluna "Editar texto publicado" em B.3 |
| **Proteção contra duplicidade** | Cabeçalho `Idempotency-Key` em `POST /v1/posts` (até 255 caracteres, vale 24 h) | Repetir com a mesma chave devolve o post original, sem criar outro. Além disso, a Zernio recusa (`409`) o mesmo conteúdo na mesma conta em 24 h |
| **Saúde das contas** | `GET /v1/accounts/health?profileId` (já usado) | `canPost`, `needsReconnect`, `tokenValid`, `issues[]` |
| **Webhooks** (dependem de endereço público) | `POST /v1/webhooks/settings` `{ name, url, events[], secret, profileIds[] }` | Eventos úteis: `post.scheduled`, `post.published`, `post.failed`, `post.partial`, `post.cancelled`, `post.platform.published`, `post.platform.failed`, `post.platform.deleted`, `account.disconnected`, `account.permissions_changed`, `comment.received`, `review.new`, `analytics.synced`. Assinatura HMAC-SHA256 do corpo (`X-Zernio-Signature`), deduplicar por `X-Zernio-Event-Id`, responder em até 5 s |
| **Métricas** | `GET /v1/analytics` (por post ou lista com resumo), `/v1/analytics/daily-metrics`, `/v1/analytics/best-time`, `/v1/accounts/follower-stats` | Janela padrão de 90 dias (máx. 366); `202` enquanto sincroniza; **`402` em planos antigos sem o complemento de métricas** (incluído nos planos por uso, que são os atuais) |
| **Comentários** | `GET /v1/inbox/comments`, `GET/POST /v1/inbox/comments/{postId}`, ocultar, excluir, curtir | Lista com até 10 min de atraso (cache): para tempo real, o webhook `comment.received` |

**Horários fixos de fila:** `/v1/queue/slots` e `queuedFromProfile` permitem publicar no "próximo horário livre" do perfil.
É um recurso opcional, fora deste plano.

**Atenção a nomes parecidos:**
- o grupo **"Calendar"** da Zernio é agenda do Google e do Outlook (eventos e reuniões), **não** calendário editorial. O
  calendário editorial é construído sobre `GET /v1/posts`;
- o grupo **"Files"** é o Google Drive e o OneDrive de contas conectadas, **não** uma biblioteca de mídia.

### B.2 Formatos de publicação por rede

| Rede | Imagem no feed | Carrossel / várias imagens | Vídeo | Stories | Reels / Shorts | Só texto | Restrições principais |
|---|---|---|---|---|---|---|---|
| **Instagram** | ✅ JPEG/PNG, 8 MB (comprime acima) | ✅ até 10 itens (página da rede; o esquema diz 20, veja B.5) | ✅ vira Reel (`shareToFeed` controla o feed) | ✅ `contentType: "story"`; mídia obrigatória, sem legenda; vídeo até 60 s e 100 MB | ✅ Reels até 15 min e 300 MB | ❌ toda publicação exige mídia | Conta Business ou Creator; 100 posts por 24 h; legenda até 2.200 caracteres |
| **Facebook** | ✅ até 10 imagens; 4 MB na prática | ✅ várias imagens (até 10) e carrossel de links (2 a 10 cartões, só imagens) | ✅ até 240 min, 4 GB | ✅ `contentType: "story"`; 1 mídia, sem legenda, até 120 s | ✅ Reels 9:16 (60 s na página da rede; o esquema cita 3 a 90 s da Meta) | ✅ | Só Páginas (pessoa Admin ou Editor); tokens vencem com frequência; 100 por dia |
| **TikTok** | 🟨 como post de fotos | ✅ carrossel de fotos até 35 (JPEG/PNG/WebP, 20 MB) | ✅ 3 s a 10 min, 4 GB | ❌ | ✅ o próprio vídeo do TikTok | ❌ | Exige as confirmações legais `content_preview_confirmed` e `express_consent_given` e um nível de privacidade permitido ao criador (`creator-info`); 15 vídeos + 15 fotos por 24 h; moderação mais rígida pela API |
| **LinkedIn** | ✅ até 8 MB | ✅ até 20 imagens; documento PDF/PPT/DOC (1 por post, até 100 MB) | ✅ 10 min (perfil) ou 30 min (página) | ❌ | ❌ | ✅ até 3.000 | Um tipo de mídia por post; **recusa conteúdo repetido (422) mesmo semanas depois**; enquete e repost |
| **YouTube** | ❌ | ❌ | ✅ 1 vídeo por post (15 min em canal não verificado) | ❌ | ✅ Shorts automático (vertical ou quadrado com até 3 min; não há opção) | ❌ | Título 100, descrição 5.000; visibilidade pública, não listada ou privada; cota diária por canal; agendado sobe antes como privado |
| **Threads** | ✅ JPEG/PNG, 8 MB | ✅ até 10 imagens (sem vídeo no carrossel) | ✅ MP4 H.264, 5 min, 1 GB | ❌ | ❌ | ✅ até 500 | Exige Instagram Business ou Creator; 250 posts por 24 h; sequência de posts (`threadItems`) |
| **Pinterest** | ✅ 1 imagem por pin, 32 MB | ❌ | ✅ pin de vídeo, 4 s a 15 min | ❌ | ❌ | ❌ | Exige pasta (`boardId`, listada por `GET /v1/accounts/{id}/pinterest-boards`); link de destino; 25 por dia |
| **Google Business Profile** | ✅ 1 imagem JPEG/PNG, 5 MB, mínimo 400×300 | ❌ | ❌ | ❌ | ❌ | ✅ até 1.500 | Local verificado; tipos Novidade (`STANDARD`), Evento e Oferta, com botão; o post fica visível cerca de 7 dias |
| **X** | ✅ até 4 imagens ou 1 GIF | 🟨 até 4 imagens no mesmo post (não é carrossel) | ✅ 1 vídeo | ❌ | ❌ | ✅ 280 (25.000 no Premium) | **Cartão obrigatório na Zernio**; cobra por post (US$ 0,015; US$ 0,20 com link); recusa texto repetido; sequência e enquete |

**Funções comuns em todas as 9 redes** (sem diferença entre elas):
- agendamento e publicação imediata ✅;
- upload ✅ (presign);
- situação da publicação ✅;
- editar e cancelar agendado ✅;
- tentar de novo ✅.

### B.3 Depois de publicar: edição, remoção, métricas e interações

| Rede | Editar texto publicado | Remover da rede | Métricas por post | Métricas da conta | Comentários (listar, responder, moderar) | Mensagens diretas |
|---|---|---|---|---|---|---|
| **Instagram** | ❌ | ❌ | ✅ impressões, alcance, curtidas, comentários, compartilhamentos, salvamentos, visualizações (sem cliques) | ✅ insights, histórico de seguidores, demografia, Stories | 🟨 listar, responder, excluir e ocultar; curtir em liberação limitada; não cria comentário novo | ✅ (fora deste plano) |
| **Facebook** | 🟨 só texto e só posts criados pela Zernio | ✅ | ✅ impressões, curtidas, comentários, compartilhamentos, cliques, visualizações (sem alcance) | ✅ insights e demografia da Página | ✅ todas as ações; avaliações da Página | ✅ (fora deste plano) |
| **TikTok** | ❌ | ❌ | 🟨 limitado: curtidas, comentários, compartilhamentos, visualizações | ✅ insights da conta | 🟨 só contas conectadas pelo app TikTok Business; chegam por webhook | 🟨 só respostas, contas fora da UE, Suíça e Reino Unido |
| **LinkedIn** | ✅ só texto (3.000) | ✅ | ✅ (perfil pessoal: só posts feitos pela Zernio; salvamentos só no perfil pessoal; cliques só em página; visualizações só de vídeo) | ✅ páginas: agregado e demografia | 🟨 só páginas de empresa; sem ocultar | ❌ (o LinkedIn bloqueia) |
| **YouTube** | 🟨 descrição (título e tags por outra rota) | ✅ (exclusão permanente) | ✅ curtidas, comentários, compartilhamentos, visualizações | ✅ canal, visualizações diárias, retenção, demografia | ✅ (lidos por consulta periódica; sem curtir nem ocultar) | ❌ |
| **Threads** | ❌ | ✅ | ✅ impressões, curtidas, comentários, compartilhamentos, visualizações | — | ✅ responder, excluir, ocultar | ❌ |
| **Pinterest** | 🟨 descrição (beta fechado do Pinterest) | ✅ | ✅ impressões, salvamentos, cliques | — | ❌ (o Pinterest não tem API) | ❌ |
| **Google Business** | ✅ | ✅ | ❌ (o Google descontinuou métricas por post) | ✅ desempenho do local (impressões, cliques, ligações, rotas) e termos buscados | ❌ comentários; ✅ avaliações (listar, responder, apagar resposta) | ❌ |
| **X** | 🟨 X Premium, até 1 h depois, 5 edições | ✅ | 🟨 impressões, curtidas, comentários, compartilhamentos, cliques, visualizações; **cada leitura custa US$ 0,005** (métricas do X são opcionais) | — | 🟨 suportado, mas a leitura também custa | 🟨 exige os escopos de DM |

**Endpoints de B.3:**
- editar: `POST /v1/posts/{id}/edit`;
- remover: `POST /v1/posts/{id}/unpublish`;
- métricas por post: `GET /v1/analytics`;
- métricas da conta: `GET /v1/analytics/{rede}/…` e `GET /v1/accounts/follower-stats`;
- comentários: `/v1/inbox/comments…`;
- avaliações: `/v1/inbox/reviews…`.

**Crescimento de seguidores:** `GET /v1/accounts/follower-stats` (atualizado uma vez por dia; "requer o complemento de
métricas" nos planos antigos).

**Custos das interações:**
- comentários e avaliações são grátis;
- mensagens enviadas pela caixa de entrada: as primeiras 10.000 por mês são grátis.

### B.4 Fontes na documentação oficial

| Assunto | Endereço |
|---|---|
| Especificação completa | `https://zernio.com/openapi.json` (versão 1.450.2 em 2026-11-03) |
| Comparativo das redes (formatos, métricas, comentários, webhooks) | `https://docs.zernio.com/platforms/compare` |
| Página de cada rede | `https://docs.zernio.com/platforms/{instagram,facebook,tiktok,linkedin,youtube,threads,pinterest,google-business,twitter}` |
| Criar post | `https://docs.zernio.com/posts/create-post` |
| Ciclo de vida do post | `https://docs.zernio.com/guides/post-lifecycle` |
| Limites de pedidos e de publicação | `https://docs.zernio.com/guides/rate-limits` |
| Preços | `https://zernio.com/pricing.md` |
| Webhooks | `https://docs.zernio.com/webhooks` |
| Idempotência | `https://docs.zernio.com/guides/idempotency` |

### B.5 Divergências na documentação oficial (novas)

1. **Carrossel do Instagram:** a página da rede diz até 10 itens; o esquema `InstagramPlatformData` diz até 20.
   Usar **10** até a homologação confirmar.
2. **TikTok:** o comparativo lista só "Videos"; a página da rede e o esquema confirmam também o carrossel de fotos (até 35).
3. **Google Business:** a descrição cita o tipo `ALERT`, mas o campo `topicType` só aceita `STANDARD`, `EVENT` e `OFFER`.
4. **Duração do Reel do Facebook:** 60 s na página da rede; o esquema cita o guia da Meta, de 3 a 90 s.
5. **Comentários do TikTok:** suportados no comparativo (só app Business), mas ausentes da lista de preços "Comments +
   reviews".
6. **A especificação mudou de 1.444.0 para 1.450.2 em um dia.**
   - A REFERENCIA_ZERNIO continua válida para o que já usamos.
   - Cada etapa nova confere o `changelog` antes de começar.

### B.6 O que não existe ou depende de algo além da API

| Item | Situação |
|---|---|
| Stories fora do Instagram e do Facebook | ❌ |
| Post só de texto no Instagram, TikTok, YouTube e Pinterest | ❌ |
| Editar ou remover publicado no Instagram e no TikTok | ❌ (sem API das redes) |
| Métricas por post no Google Business | ❌ (descontinuado pelo Google) |
| Comentários no Pinterest e no Google Business (este tem avaliações) | ❌ |
| Biblioteca de mídia na Zernio | ❌ (só envio; mídia não usada some com o post excluído) |
| Hashtags automáticas | ❌. O campo `hashtags` é só registro: elas precisam estar no texto |
| Métricas em conta Zernio antiga | 🟨 exige o complemento de métricas (`402`) |
| Webhooks | 🟨 exigem endereço público HTTPS (DisparaZap publicado) |
| X | 🟨 cartão, custo por post e por leitura; texto longo e edição só no Premium |

---

## C. Funcionalidades já existentes

### C.1 Pode ser reutilizado como está

| Peça | Uso em Redes Sociais |
|---|---|
| `registerMemberContext`, `canManage`/`canOperate`, `sendProblem` | Empresa e papel sempre da sessão; 401/403/404 iguais aos outros módulos |
| `registerOriginGuard` e `RateLimiter` | Proteção de origem e limite por empresa nas rotas novas |
| Cofre e `readyClient` do serviço Zernio | Abrir a chave da empresa só dentro da API |
| Perfil da empresa (`zernio_connections.profile_id`) | Filtro de tudo que se lista e checagem das contas usadas num post |
| `listAccounts` + `accountsHealth` | Seletor de contas no "Criar publicação" e alertas da Visão Geral |
| Padrão de erros fixos (`ZernioError`, motivos do 402) | Mesmo tratamento nas novas chamadas |
| Componentes do painel (`Card`, `PageHeader`, `StatusBadge`, `UnderConstruction`) e o padrão de assistente e pré-visualização no celular do Envio de Mensagens | Telas com o mesmo visual |
| Verificação de imagem pelos primeiros bytes (`messaging/media.ts`) | Conferir imagens da biblioteca |

### C.2 Precisa ser adaptado

| Peça | Adaptação |
|---|---|
| `httpRequest` (usado pelo adaptador da Zernio) | Hoje só aceita `GET`/`POST`/`DELETE` com corpo JSON e não devolve cabeçalhos. Precisa de `PUT` (editar post e enviar arquivo ao endereço assinado), corpo binário, cabeçalho `Idempotency-Key` e leitura de `Retry-After`/`X-RateLimit-*` |
| `zernio-client.ts` | Novos métodos: posts (criar, ler, listar, editar, excluir, tentar de novo), presign e envio do arquivo, validação, métricas. Tratar o `207`. Tempo-limite maior na publicação imediata com vídeo |
| `app.media_files` | Hoje é só imagem do WhatsApp. Para a biblioteca: nome, tipo (imagem/vídeo), origem e o endereço público na Zernio. Vídeo não cabe no banco (veja R5) |
| Política de segurança do painel (`web-panel.ts`) | Só quando houver vídeo enviado direto do navegador ou mídia exibida a partir da Zernio: liberar o endereço exato do armazenamento (`connect-src`, `img-src`, `media-src`), conferido na homologação |
| `navigation.ts` | Item Redes Sociais passa a "Disponível" e ganha a navegação interna |
| Simulador da Zernio | Posts, presign, envio de arquivo, situação por rede, 207, 409, 429, métricas e 402 de métricas |

### C.3 Precisa ser desenvolvido

- **Fuso horário da empresa** (configuração e uso em agendamento e calendário).
- **Registro local das publicações** feitas pelo DisparaZap: quem criou, chave de idempotência, espelho da situação.
- **Regras de cada rede em `packages/contracts`:** formatos, limites de texto e mídia. As mesmas regras alimentam o
  formulário e são conferidas de novo na API.
- **Rotas `/api/internal/social/*`, serviços e telas** das subseções (seção D).
- **Mensagens fixas** para as 10 categorias de erro das redes.
- **Sincronização** com a Zernio: incremental agora, webhooks depois da publicação.

---

## D. Proposta de interface

### D.1 Organização

Um item no menu (**Redes Sociais**) e abas internas no topo da página, no mesmo visual das outras páginas:

| Aba | Endereço | Conteúdo |
|---|---|---|
| Visão Geral | `/redes-sociais` | Contas conectadas e saúde; publicadas, agendadas e com falha (contagem real); próximas publicações; alertas (reconectar, pagamento pendente, conta sem permissão de publicar); resumo de desempenho quando a conta Zernio tiver métricas |
| Criar publicação | `/redes-sociais/criar` (e `/criar/:id` para continuar rascunho ou editar agendado) | Formulário em etapas curtas (abaixo) |
| Calendário | `/redes-sociais/calendario` | Mês, semana e dia; cores por situação; filtros por rede, conta e situação; clique abre os detalhes |
| Biblioteca | `/redes-sociais/biblioteca` | Miniaturas, envio, busca e filtros (tipo, data), reutilizar num post |
| Histórico | `/redes-sociais/historico` | Tabela por publicação e por rede: conta, conteúdo, data, situação, motivo da falha, link, tentar de novo |
| Resultados | `/redes-sociais/resultados` | Métricas reais por período, rede e conta; "indisponível" quando a rede ou o plano não oferece |
| Interações | `/redes-sociais/interacoes` | "Em desenvolvimento" até a etapa S8 |

**Sem a Zernio configurada:** a seção mostra um aviso com o botão "Configurar em Integrações", como o Envio de Mensagens faz
quando falta WhatsApp.

**Quem não pode publicar** (`viewer`) vê tudo sem os botões de ação.

### D.2 Componentes

| Componente | Uso |
|---|---|
| `SocialTabs` | Abas internas |
| `AccountPicker` | Escolha de uma ou várias contas (ícone da rede, @, situação). Conta que precisa reconectar fica desabilitada com o link para Integrações |
| `FormatPicker` | Formatos permitidos por rede (feed, carrossel, Story, Reel, vídeo, pin, novidade do Google), conforme B.2 |
| `CaptionEditor` | Texto geral + abas por rede para personalizar; contador de caracteres por rede; aviso de hashtags no texto |
| `MediaPicker` | Da biblioteca ou envio novo; checa tipo, tamanho e quantidade por rede antes de enviar |
| `NetworkPreview` | Prévia aproximada por rede, com o rótulo "Prévia aproximada: a aparência final é da rede" |
| `ScheduleControl` | "Publicar agora", "Agendar" (data e hora no fuso da empresa, mostrado na tela) e "Salvar rascunho" |
| `PostStatusBadge` | Situação geral e por rede, com o mesmo `StatusBadge` |
| `PostDetailDrawer` | Painel lateral: situação por rede, link, motivo da falha e o que fazer, ações (editar, reagendar, cancelar, tentar de novo) |
| `CalendarGrid` | Grade mês/semana/dia feita no próprio painel, sem biblioteca nova (decisão técnica a registrar) |
| `MediaGrid` | Miniaturas da biblioteca |
| `MetricCards` | Indicadores de resultados |

### D.3 Fluxos principais

1. **Publicar agora:**
   1. Contas.
   2. Formato por rede.
   3. Texto (geral e por rede).
   4. Mídia.
   5. Prévia.
   6. **Confirmação** ("Publicar agora em 3 redes?").
   7. Resultado por rede, com o link do que saiu e o motivo do que falhou.
2. **Agendar:** mesmo caminho; na etapa final, data e hora no fuso da empresa. Vai para o calendário como "Agendada".
3. **Rascunho:** salvar a qualquer momento; reabrir pelo calendário ou pelo histórico.
4. **Editar ou reagendar um agendado:** pelos detalhes (calendário ou histórico). Só enquanto a situação permitir.
5. **Cancelar um agendado:** **confirmação** ("Cancelar e excluir esta publicação agendada? A mídia enviada para ela também
   será apagada na Zernio.").
6. **Tentar de novo:**
   - só em "Falhou" ou "Parcial";
   - **confirmação**, e o botão fica bloqueado enquanto o pedido roda;
   - a Zernio tenta de novo só as redes que falharam.
7. **Remover da rede um post publicado** (onde a rede permite): **confirmação** com o aviso de irreversível (no YouTube, a
   exclusão é permanente).

---

## E. Arquitetura técnica

### E.1 Serviços

| Peça | Onde | Responsabilidade |
|---|---|---|
| Adaptador | `apps/api/src/integrations/zernio-client.ts` (ampliado) | Novas rotas da Zernio (B.1), sempre no endereço fixo; o envio de arquivo só para o endereço assinado devolvido pela Zernio, exigindo HTTPS e o domínio conferido na homologação; sem seguir redirecionamentos |
| Regras das redes | `packages/contracts/src/social.ts` | Formatos, limites e mídia aceita por rede (B.2), esquemas de entrada e saída. Usado pelo painel e pela API |
| Publicações | `apps/api/src/social/social-posts.ts` | Montar o pedido, conferir que cada conta escolhida pertence ao perfil da empresa (relida na Zernio), idempotência, gravar o registro local, traduzir situações e erros |
| Mídia | `apps/api/src/social/social-media.ts` | Biblioteca da empresa, conferência dos bytes, envio à Zernio (presign) |
| Sincronização | `apps/api/src/social/social-sync.ts` | Atualizar o espelho local com `GET /v1/posts?profileId&updatedSince`, ao abrir as páginas. Webhooks e conferência periódica no worker na etapa S8 |
| Métricas | `apps/api/src/social/social-analytics.ts` | Leitura com cache curto por empresa; `402` vira "indisponível no seu plano da Zernio" |
| Rotas | `apps/api/src/routes/social.ts` | `/api/internal/social/*` (empresa e papel da sessão, origem verificada, limites por empresa) |
| Telas | `apps/web/src/pages/social/*`, `apps/web/src/social/social-api.ts` | Seção D |

### E.2 Dados propostos (migration `0006_social`, só com aprovação)

| Tabela ou coluna | Colunas principais | Por quê |
|---|---|---|
| `identity.organizations.timezone` | texto IANA, padrão `America/Sao_Paulo` | Agendar e mostrar o calendário no fuso da empresa (R3). O mesmo valor é mandado em todo post e gravado no perfil da Zernio |
| `app.social_posts` | `organization_id`, `id`, `zernio_post_id` (único por empresa), `idempotency_key` (UUID, único), `status`, `scheduled_for`, `timezone`, `content`, `targets` (JSON: rede, conta, situação, link, categoria de erro, data), `media_ids`, `created_by`, `created_at`, `updated_at`, `last_synced_at` | Espelho das publicações da empresa. A Zernio continua sendo a fonte da verdade da situação. O espelho guarda quem criou (a Zernio não conhece os usuários do DisparaZap) e a chave de idempotência (gravada **antes** de chamar a Zernio). Também deixa calendário, histórico e Visão Geral rápidos sem gastar o limite de 60 pedidos/min, e permite mostrar o último estado conhecido se a Zernio estiver fora do ar |
| `app.media_files` (ampliada) | + `kind` (imagem/vídeo), `file_name`, `origin` (whatsapp/social), `zernio_public_url`, `zernio_uploaded_at` | Uma biblioteca por empresa (WhatsApp e redes). Imagens continuam no banco; vídeos conforme R5 |
| `app.zernio_webhook_events` (etapa S8) | `event_id` (único), `organization_id`, `type`, `received_at` | Deduplicar eventos entregues "pelo menos uma vez" |

- Todas as tabelas novas seguem o padrão do esquema `app`: `organization_id`, chave composta e exclusão em cascata com a
  empresa.
- **Conteúdo de post não é dado pessoal** como os contatos, mas também não vai para o log.

### E.3 Publicação e agendamento

- **Agendamento nativo da Zernio** (`scheduledFor` + `timezone`):
  - nenhuma fila, Redis ou processo novo é necessário para agendar;
  - a decisão D5 (fila) continua aberta para Campanhas e não bloqueia este módulo.
- **Publicar agora:**
  1. O DisparaZap gera e grava a `idempotency_key`.
  2. Chama `POST /v1/posts` com `publishNow: true` e o cabeçalho `Idempotency-Key`.
  3. Trata `201` (tudo publicado), `207` (parcial ou falha, que é sucesso HTTP) e os erros.
  4. **Se o tempo-limite estourar** (vídeo grande), repete com a **mesma chave**: a Zernio devolve o post original em vez de
     criar outro.
- **Rascunho:** na Zernio (`isDraft: true`), para um lugar só (R8).
- **Atualização da situação:**
  - **Até a publicação (S2 a S7):** ao abrir Visão Geral, Calendário ou Histórico, a API pede só o que mudou desde a última
    vez (`updatedSince`) e atualiza o espelho. Abrir os detalhes relê aquele post.
  - **Depois da publicação na Hostinger (S8):**
    - webhooks `post.*` e `account.disconnected`, com assinatura conferida, deduplicação e resposta em até 5 s;
    - conferência periódica no worker para o que ficou pendente, um laço simples com o banco, sem Redis.
- **Duplicidade:**
  - idempotência na criação;
  - "tentar de novo" usa a rota própria (que só tenta de novo as redes com falha), nunca cria outro post;
  - botão bloqueado durante o pedido;
  - aviso quando a Zernio recusar conteúdo repetido (`409` em 24 h; no LinkedIn, `422` mesmo semanas depois).

### E.4 Segurança

- **A chave da Zernio nunca sai da API.**
  - Todas as chamadas são feitas pelo servidor com a chave da empresa.
  - Exceção prevista só para vídeo (R5): o navegador recebe o **endereço assinado de um único arquivo**, que vale 1 hora,
    nunca a chave.
- **Isolamento:**
  - a empresa vem da sessão;
  - só se listam posts do perfil da empresa;
  - editar, cancelar e tentar de novo exigem que o post esteja no perfil e no espelho da empresa (senão 404);
  - as contas de cada post são conferidas contra o perfil antes de publicar.
- **Mídia:**
  - tipo conferido pelos bytes e tamanho por rede;
  - nenhuma rota aceita "URL de mídia" digitada (evita usar o DisparaZap para buscar endereços arbitrários);
  - o envio só vai para o endereço assinado pela Zernio, em HTTPS.
- **Privacidade da mídia:** o `publicUrl` da Zernio é **público**. Imagem de rascunho ou de lançamento sigiloso fica
  acessível a quem tiver o endereço. O painel avisa isso no envio.
- **Respostas ao navegador:**
  - só pelos contratos de `packages/contracts`;
  - erros das redes viram mensagens fixas por categoria (R6);
  - o texto original da rede vai, no máximo, para o log técnico, sem conteúdo do post.
- **Proteções de sempre:** verificação de origem nas rotas que alteram, limite por empresa, texto de post fora do log.
- **TikTok:**
  - as confirmações legais (`content_preview_confirmed`, `express_consent_given`) vêm de **caixas marcadas pela pessoa** na
    tela, nunca preenchidas sozinhas pelo sistema;
  - a API recusa a publicação sem elas.
- **LGPD (etapa S8):**
  - comentários e avaliações têm nome e texto de terceiros;
  - são lidos na hora na Zernio e não copiados para o banco;
  - a decisão de guardar algo depende de política própria.

### E.5 Permissões (proposta, decisão R2)

| Ação | owner | admin | operator | viewer |
|---|:-:|:-:|:-:|:-:|
| Ver Visão Geral, Calendário, Histórico, Resultados, Biblioteca | ✅ | ✅ | ✅ | ✅ |
| Criar, publicar, agendar, editar, cancelar, tentar de novo | ✅ | ✅ | ✅ | ❌ |
| Enviar mídia para a biblioteca | ✅ | ✅ | ✅ | ❌ |
| Excluir mídia da biblioteca e remover publicado da rede | ✅ | ✅ | ❌ | ❌ |
| Fuso horário da empresa | ✅ | ✅ | ❌ | ❌ |
| Conectar e desconectar redes (continua em Integrações) | ✅ | ✅ | ❌ | ❌ |

### E.6 Tratamento de erros

| Situação | Origem | Mensagem e ação na tela |
|---|---|---|
| Rede precisa reconectar | `403 ACCOUNT_DISCONNECTED` ou `errorCategory: auth_expired` | "A conta @x precisa ser reconectada" + botão para Integrações |
| Conteúdo fora das regras da rede | `400` ou `user_content` | Motivo fixo por regra conhecida (texto longo, mídia obrigatória, formato) e campo destacado. A validação local e a `/tools/validate/post` evitam a maioria |
| Limite de publicação | `429` (25/h por conta, limites diários) ou `user_abuse` | "Limite da rede atingido; tente depois de HH:MM" (pelo `Retry-After`) |
| Conteúdo repetido | `409` (24 h) ou `422` (LinkedIn) | "Este mesmo conteúdo já foi publicado nesta conta recentemente" |
| Pagamento na Zernio | `402` (motivos já tratados) | Mesmo aviso de Integrações, com o link da cobrança |
| Política da rede | `platform_rejected` | "A rede recusou o conteúdo pelas regras dela" |
| Instabilidade | `platform_error`, `system_error`, `503`, sem resposta | "Instabilidade na rede ou na Zernio": tentar de novo; situação conferida antes |
| Falha parcial | `207` / `partial` | Resultado por rede; "tentar de novo" só nas que falharam |
| Métricas indisponíveis | `402` em métricas, `202` sincronizando | "Indisponível no seu plano da Zernio" / "Coletando dados da rede" |

---

## F. Plano de implementação

Cada etapa é pequena, testável sozinha contra a **Zernio simulada** e termina com `npm test`, `npm run typecheck`,
`npm run build`, CHANGELOG e documentação. A homologação real de cada etapa usa a conta Zernio do dono do produto, **só com
autorização explícita**.

**Ordem ajustada pela auditoria:**
- **Histórico e situação vêm antes do calendário,** porque publicar sem ver o resultado não é honesto com quem usa, e o
  calendário reaproveita a mesma lista e a mesma sincronização.
- **A biblioteca mínima de imagens entra junto com a publicação.**
- **A biblioteca completa e os vídeos ficam juntos,** porque dependem da decisão de armazenamento (R5).

| Etapa | Entrega | Rotas da Zernio | Migration? | Zernio real? | Critério de aceite |
|---|---|---|---|---|---|
| **S0** | Este plano; REFERENCIA_ZERNIO atualizada para a 1.450.2 (posts, mídia, métricas, comentários) | — | Não | Não (leitura pública) | Plano aprovado e decisões R1 a R10 respondidas |
| **S1** | Abas da seção + **Visão Geral** (só leitura): contas e saúde, contagem por situação, próximas 5 publicações, alertas; desempenho se a conta tiver métricas | `GET /v1/accounts`, `/accounts/health`, `GET /v1/posts` (`profileId`, `status`, `limit`, `sortBy`), `/v1/analytics/daily-metrics` | **Não** | Leitura, com autorização | Números iguais aos do painel da Zernio no perfil da empresa; sem Zernio configurada, aviso para Integrações; viewer vê; outra empresa não vê nada |
| **S2** | **Criar e publicar agora** (texto + imagens) e **rascunho**: seletor de contas, formatos de imagem (feed e carrossel do Instagram, Facebook, LinkedIn, Threads, Pinterest com pasta, Google Business, X com aviso de custo), texto por rede, prévia, resultado por rede; imagens da biblioteca mínima (`media_files`) | `POST /v1/media/presign` + envio, `POST /v1/tools/validate/post`, `POST /v1/posts` (`publishNow`, `isDraft`), `GET /v1/posts/{id}`, `GET /v1/accounts/{id}/pinterest-boards` | **Sim** (`social_posts`, colunas em `media_files`) | 1 post de teste numa rede do dono do produto, com autorização | Idempotência testada (tempo-limite não duplica); `207` mostra o resultado por rede; conta fora do perfil recusada; regras por rede conferidas no painel e na API |
| **S3** | **Agendamento**: fuso da empresa (configuração), agendar, editar e reagendar, cancelar com confirmação | `POST /v1/posts` (`scheduledFor`, `timezone`), `PUT` e `DELETE /v1/posts/{id}` | **Sim** (`organizations.timezone`) | 1 agendamento e 1 cancelamento de teste | Horário certo no fuso da empresa (inclusive na virada de dia); editar só nas situações permitidas; cancelar não deixa post órfão |
| **S4** | **Histórico e acompanhamento**: filtros, detalhes por rede, link, motivo da falha com o que fazer, **tentar de novo** protegido, sincronização incremental | `GET /v1/posts` (`updatedSince`, `cursor`), `POST /v1/posts/{id}/retry` | Não | Leitura + 1 nova tentativa, se houver falha real | Duplo clique não gera duas tentativas; situação atualizada ao abrir; erro mostrado só com mensagem fixa |
| **S5** | **Calendário editorial**: mês, semana, dia; cores por situação; filtros por rede, conta e situação; detalhes; reagendar pelo painel lateral (arrastar fica para depois) | `GET /v1/posts` (`fromDate`, `toDate`, `fields`), `PUT /v1/posts/{id}` | Não | Leitura | Posts no dia certo no fuso da empresa; navegação sem estourar o limite de pedidos (espelho local) |
| **S6** | **Biblioteca completa e vídeos**: busca, filtros, reutilização; vídeo (Reels, Stories, TikTok, YouTube/Shorts, vídeo no Facebook, LinkedIn, Threads, Pinterest e X); confirmações legais do TikTok | Presign com envio direto do navegador (R5); `tiktokSettings`; `GET /v1/accounts/{id}/tiktok/creator-info` | **Sim** (vídeo na biblioteca, conforme R5) | 1 vídeo de teste | Política de segurança só com o domínio exato; vídeo grande não passa pela Hostinger; TikTok sem as caixas marcadas é recusado |
| **S7** | **Resultados**: métricas reais por post e por período, por rede e conta, crescimento de seguidores; "indisponível" onde a rede não fornece (B.3) | `GET /v1/analytics`, `/daily-metrics`, `/accounts/follower-stats`, endpoints por rede | Não | Leitura | Nenhuma métrica inventada: rede sem o dado mostra "não fornecido pela rede"; `402` vira aviso de plano |
| **S8** | **Webhooks e Interações** (depois da publicação na Hostinger): webhooks de posts e contas; comentários (listar, responder, ocultar, excluir) e avaliações do Google e do Facebook | `/v1/webhooks/settings`, `/v1/inbox/comments…`, `/v1/inbox/reviews…` | **Sim** (`zernio_webhook_events`) | Sim, com autorização | Assinatura conferida em tempo constante; evento repetido ignorado; nada de comentário gravado no banco sem política de LGPD |

**Etapas futuras opcionais (fora deste plano):**
- aprovação do cliente antes de publicar (`requiresApproval`), útil para agência;
- horários fixos de fila (`queue/slots`);
- repostagem automática;
- anúncios;
- mensagens diretas.

### F.1 Testes de cada etapa (sem Zernio real)

- **API contra o simulador:**
  - formatos exatos dos parâmetros (a Zernio ignora em silêncio parâmetro com nome errado, exceto em `GET /v1/posts`);
  - isolamento entre empresas e por perfil; papéis;
  - idempotência e tempo-limite; `207`, `402`, `403`, `409`, `429` e `503`;
  - chave fora das respostas e do log; texto do post fora do log.
- **Painel:**
  - abas, estados vazios e sem Zernio;
  - regras por rede (bloqueios e contadores);
  - confirmações antes de publicar, cancelar e remover; viewer sem botões;
  - fuso horário na exibição; prévia com o rótulo de "aproximada".
- **Contratos:** regras de cada rede iguais às da tabela B.2.

---

## G. Riscos e limitações

| Risco | Detalhe | Como lidar |
|---|---|---|
| Limite de pedidos | 60/min por conta Zernio com até 2 redes (600/min com 3 a 2.000); métricas 6/s. É por equipe Zernio, ou seja, por empresa, porque cada uma tem a sua conta | Espelho local para calendário e histórico, sincronização incremental, cache curto nas métricas, respeitar `Retry-After` |
| Limites de publicação | 25 posts/h por conta; Instagram 100, Facebook 100, Threads 250, X 50, Pinterest 25, TikTok 15 + 15 por dia; demais 50 | Mostrar o limite e a hora de liberação; no TikTok, o post fica retido até liberar |
| Custos (pagos pela empresa, na conta Zernio dela) | 2 redes grátis; da 3ª à 10ª, US$ 6/mês cada. X: cartão, US$ 0,015 por post, US$ 0,20 com link, US$ 0,005 por leitura (métricas e caixa de entrada do X são opcionais). Mensagens diretas acima de 10.000/mês são cobradas | Avisos no painel antes de ações com custo (X) e métricas do X desligadas por padrão |
| Plano antigo da Zernio | Métricas e caixa de entrada podem exigir complemento (`402`) | Mostrar "indisponível no seu plano" |
| Dependência externa | Zernio fora do ar ou mudando rápido (1.444 → 1.450 em um dia); regras das redes mudam sem aviso | Leitura tolerante, simulador nos formatos oficiais, conferir o changelog a cada etapa, homologação real curta |
| Mídia pública | `publicUrl` é acessível a quem tiver o endereço, inclusive de rascunho | Aviso no envio; nada sigiloso na biblioteca |
| Mídia apagada | Excluir um post na Zernio apaga a mídia que só ele usava | A biblioteca guarda o original no DisparaZap e reenvia quando preciso |
| Vídeo e Hostinger | Vídeos de centenas de MB não devem passar pela API na Hostinger (memória, tempo-limite, corpo) | Envio direto do navegador para a Zernio com endereço assinado (R5); política de segurança com o domínio exato |
| Webhooks | Exigem o DisparaZap publicado com HTTPS | Sincronização incremental até lá (S8 depois da publicação) |
| Regras de conteúdo | A Zernio proíbe conteúdo idêntico repetido em várias contas e spam; LinkedIn e X recusam repetição | Incentivar o texto por rede; avisar quando o mesmo texto vai para várias contas |
| Marca | A tela de autorização das redes mostra "Zernio" | Já documentado em Integrações |
| Agência e clientes | Hoje não há como um usuário atuar em várias empresas | Decisão R4; não bloqueia o módulo |
| RLS | Ainda não há RLS no banco; o isolamento é feito pela API | Testes de isolamento em toda rota; RLS com o Supabase |
| TikTok | Exige consentimento explícito na tela; moderação mais rígida pela API; contas antigas pelo app de desenvolvedor podem cair no limite compartilhado | Caixas de confirmação; aviso para reconectar pelo app Business |
| LGPD (interações) | Comentários e mensagens são dados de terceiros, processados pela Zernio na Europa e nos EUA | Ler na hora, não copiar; política antes da S8 |

---

## Decisões para o dono do produto

| # | Decisão | Recomendação |
|---|---|---|
| **R1** | Ordem das etapas | **S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8** (seção F). Se os Reels forem prioridade, S6 pode vir logo depois de S3 |
| **R2** | Quem publica | **Dono, administradores e operadores** publicam e agendam; visualizadores só veem. Remover publicado da rede e excluir mídia: só dono e administradores (E.5) |
| **R3** | Fuso horário | **Configuração por empresa**, padrão `America/Sao_Paulo`, alterada por dono e administradores. Mandada em todo post e gravada no perfil da Zernio |
| **R4** | Agência alternando entre clientes | **Fora deste módulo.** Tratar no módulo "Empresas e membros" (convites com verificação de e-mail + seletor de empresa). Até lá, o filtro "por empresa" do calendário não existe, porque cada pessoa vê só a própria empresa |
| **R5** | Armazenamento de mídia | **Agora:** imagens no banco (até 5 MB, como hoje) e enviadas à Zernio na publicação. **Vídeos (S6):** enviados direto do navegador para a Zernio, sem passar pela Hostinger. A biblioteca guarda vídeos só quando houver armazenamento de objetos (Supabase Storage, com o Supabase conectado) |
| **R6** | Erros das redes na tela | **Mensagens fixas em português por categoria**, com o que fazer. O texto original da rede (em inglês, às vezes com detalhes técnicos) não vai para a tela, como nas outras integrações |
| **R7** | Redes da S2 (imagem e texto) | Instagram, Facebook, LinkedIn, Threads, Pinterest, Google Business e **X com aviso de custo**. TikTok e YouTube entram com vídeo (S6) |
| **R8** | Onde ficam os rascunhos | **Na Zernio**, com cópia no espelho local: um lugar só para rascunho, agendado e publicado |
| **R9** | Aprovação do cliente antes de publicar | **Depois** (etapa opcional), quando a agência atender clientes pelo sistema (depende de R4) |
| **R10** | Homologação real | **Por etapa e com autorização explícita:** S1 só leitura; S2 e S3 um post e um agendamento de teste numa rede sua; nada em contas de clientes |

---

## Primeira etapa recomendada

**S1 — Estrutura da seção Redes Sociais e Visão Geral (só leitura).**

- **O que entrega:**
  - as abas da seção (as ainda não feitas aparecem como "Em desenvolvimento");
  - a Visão Geral com contas e saúde, contagem de publicações por situação, próximas publicações e alertas;
  - resumo de desempenho quando a conta Zernio da empresa oferecer métricas.
- **Por que primeiro:**
  - não publica nada e não muda o banco;
  - usa só leitura na Zernio;
  - confere os formatos reais da lista de posts, que serão a base do histórico e do calendário.
- **O que precisa antes:** aprovação deste plano e as respostas a R1, R2 e R3 (R3 só afeta a exibição dos horários; na S1
  eles aparecem no horário de Brasília, identificado na tela).
