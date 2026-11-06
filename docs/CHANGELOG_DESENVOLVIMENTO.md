# Changelog de Desenvolvimento — DisparaZap

Registro cronológico das alterações no projeto, da mais recente para a mais antiga.

**Como registrar:** uma entrada por dia ou fase de trabalho, com data absoluta (`AAAA-MM-DD`) e itens agrupados em
**Adicionado**, **Alterado**, **Corrigido**, **Segurança**, **Documentação**. Diga o que mudou e por quê, citando os arquivos.
Nunca registre senhas, tokens, chaves, URLs privadas de servidores ou dados pessoais reais.

---

## 2026-11-06 — Implantação: Dockerfile para o Easypanel

### Adicionado
- `saas/Dockerfile`: duas etapas. A primeira instala tudo, compila a API, o painel e os pacotes e remove as dependências de desenvolvimento; a segunda leva só o JavaScript compilado. Roda `apps/api/dist/index.js` na porta 3100, com verificação de saúde em `/health/live`. O painel é servido pela própria API (`WEB_DIST_DIR`).
- `saas/.dockerignore`: fica fora da imagem `node_modules`, `dist`, `.data`, `certs`, `deploy`, `.env*`, zip, logs e cache do TypeScript.
- `saas/infra/docker/LEIA-ME.md`: passo a passo no Easypanel (fonte no GitHub, caminho `/saas`, variáveis, certificado do Supabase montado em `/app/certs`, `API_TRUST_PROXY=true`, e a regra de não rodar migrações automaticamente).

### Verificado
- Os passos de compilação do Dockerfile foram reproduzidos numa cópia limpa (instalar, compilar, remover dependências de desenvolvimento). A API compilada subiu com `/health/live` ok e o painel respondeu HTTP 200 com o título DisparaZap.
- O Docker não está instalado nesta máquina, então a imagem não foi construída aqui. Isso precisa ser testado no Easypanel.
- Durante o teste apareceu um problema de cópia: cache do TypeScript (`*.tsbuildinfo`) sem as pastas `dist` faz o compilador pular a geração. O cache é ignorado pelo git e agora também está no `.dockerignore`.

### Não alterado
- Nenhum deploy foi feito. Nenhum segredo foi criado no repositório. A escuta continua em `127.0.0.1` no código; o contêiner define `API_HOST=0.0.0.0` só dentro da imagem.

---

## 2026-11-05 — Automações, etapa A4: atividade (quem recebeu, quem foi pulado e por quê)

### Adicionado
- Cliente Zernio: `listCommentAutomationLogs` (GET /v1/comment-automations/{id}/logs, 50 registros por leitura), lendo só o que a tela usa. O texto do comentário e o nome de quem comentou são lidos, mas só saem para dono e administradores.
- Contrato: `automationActivitySchema`, o caminho `GET /api/internal/automations/comment/:id/activity` e `ACTIVITY_REFRESH_MS` (15 s, decisão A9).
- Serviço `automationActivity`: cada registro sai com um texto fixo por situação (DM enviada, na fila, aguardando a confirmação de quem segue, falha no envio, não enviada, situação não reconhecida). Para "não enviada", o motivo da Zernio é só classificado (repetição ou intervalo) e o texto não sai da API. Os comentários que não casaram (`misses`) saem só para dono e administradores (A7).
- Painel: seção "Atividade" no detalhe da automação, atualizada a cada 15 s enquanto a página estiver aberta (`AutomationActivityPanel` em `AutomationsPage.tsx`).
- Simulador: registros por automação e comentários que não casaram, com paginação e a retenção simulada de 7 dias.

### Documentação verificada
- `list-comment-automation-logs` lido em 2026-11-05: status `pending`, `sent`, `gated`, `skipped`, `failed`; motivos de "pulado" em texto livre (repeatPolicy, cooldown, dedupeSameTextHours); `misses` na própria resposta de registros, com retenção curta (o número de dias não está na página).
- Não verificado: limite máximo de `limit`, parâmetros válidos de `status` e limite de leituras do endpoint.

### Testes
- `automations.spec.ts`: 3 testes novos (33 no total). `AutomationsPage.spec.tsx`: 3 testes novos (27 no total).

### Não alterado
- Trava desligada; nenhuma chamada real à Zernio feita pelo assistente. A regra de repetição já existia desde a A2 e não mudou.

---

## 2026-11-05 — Automações, etapa A6: comentário → perguntar antes do link (Instagram, criado pausado)

### Adicionado
- Contrato: `questionFlowInputSchema` (conta, nome, palavras-chave até 5, pergunta até 1000, mensagem do link, texto do botão até 20, link https), caminho `POST /api/internal/automations/flows/question`, e o tipo `kind` (`link`, `question` ou `other`) na lista de fluxos.
- Cliente Zernio: nó `wait_for_reply` e `sourceHandle` nas arestas (saídas `reply` e `timeout`).
- Serviço: `createQuestionFlow`, com o grafo comentário (palavras-chave, `contains`, sem post) → pergunta em texto → espera 1440 min → botão com o link → fim; a resposta de qualquer tipo libera o link (sem condição). Mesmas regras de papel, trava, conta do Instagram e nome único do fluxo de link.
- Painel: `QuestionFlowBuilder.tsx` (rota `nova-pergunta`), modelo "Comentário → perguntar antes" habilitado, seção de links com o texto próprio da pergunta (sem link para copiar nem QR).

### Documentação verificada
- Guia `manychat-patterns` (exemplo "ask-first") e `workflows.mdx` lidos em 2026-11-05. O exemplo oficial é o desenho usado: pergunta em texto, botão só depois da resposta, porque a resposta privada a quem não segue não aceita botões.
- Não verificado: campos obrigatórios do gatilho `comment` além de `keywords`/`matchType`; formato de condições (por isso não usamos condição). Se a Zernio recusar a criação, a mensagem é a fixa de recusa, e nada fica criado.

### Testes
- `automations.spec.ts`: 3 testes novos (30 no total), com API própria. `AutomationsPage.spec.tsx`: 3 testes novos (24 no total). Ajustes: modelos agora todos com ação.
- Suíte completa: 563 testes passando; typecheck e build sem erro.

### Não alterado
- Trava desligada; nenhum fluxo real criado; nenhuma chamada real à Zernio feita pelo assistente.

---

## 2026-11-05 — Automações, etapa A5: link → conversa (Instagram, criado pausado, com QR code)

### Adicionado
- Cliente Zernio: `listWorkflows` (GET /v1/workflows), `createWorkflow` (POST), `setWorkflowActive` (POST /activate ou /pause) e `deleteWorkflow` (DELETE), com leitura tolerante do fluxo; o código do link fica na descrição do fluxo (a lista não traz o gatilho).
- Contrato: `flowInputSchema` (conta, nome, código do link em minúsculas, mensagem até 1000, etiqueta, intervalo de 1 a 720 h), `flowSummarySchema`, `flowsListSchema` e os caminhos `/api/internal/automations/flows`.
- API: `GET /flows`, `POST /flows` (201, sempre rascunho), `POST /flows/:id/state` e `DELETE /flows/:id`, com a mesma trava (`AUTOMATIONS_WRITE_ENABLED`), papéis e escopo por conta do perfil; o link sai como `https://ig.me/m/<usuário>?ref=<código>`.
- Grafo criado: gatilho `referral` (ref exato, intervalo), mensagem de texto, etiqueta e fim. Nome único e código único por conta, conferidos antes de chamar a Zernio.
- Simulador: fluxos em memória (criar, listar, ativar, pausar, excluir), com as recusas de conta e de plataforma.
- Painel: modelo "Link ou QR → conversa" passa a abrir o construtor (`apps/web/src/pages/automations/FlowBuilder.tsx`, rota `nova-fluxo`); a página ganha a seção "Links de conversa" com estado, link, copiar, ativar/pausar (com confirmação) e excluir (com confirmação).

### QR code do link (aprovado pelo dono)
- Dependência nova no `saas/apps/api`: `qrcode` 1.5.4 e `@types/qrcode` 1.5.6 (dev). O QR é gerado no servidor como PNG em data URL, só com o link público (nada da mensagem, da etiqueta ou da Zernio).
- `GET /api/internal/automations/flows/:id/qr` (mesmas regras de empresa e conta; fluxo sem código responde 400). Contrato `flowQrSchema`; botão "Ver QR code" na seção de links.

### Não feito nesta etapa
- Alternativa "envie MENU": depende da opção "também responder por DM" (decisão A4, desligada).
- Edição de fluxo existente: a tela só cria, ativa, pausa e exclui.

### Documentação verificada
- `workflows`, `create-workflow`, `list-workflows`, `update-workflow`, `pause-workflow` e `list-workflow-executions` lidas em docs.zernio.com em 2026-11-05. A listagem existe (a skill estava certa; o índice do plano é que estava incompleto).
- Divergência na documentação: a página de atualização diz que o grafo pode ser editado em qualquer status; a visão geral diz que só em rascunho ou pausado. Não usamos edição de grafo nesta etapa.

### Testes
- `automations.spec.ts`: 6 testes novos (27 no total), com API própria para o limite de alterações. `AutomationsPage.spec.tsx`: 5 testes novos (21 no total). Ajustes de contagem do A3 (o modelo Link ou QR agora tem ação).
- Suíte completa: 557 testes passando; typecheck e build sem erro.

### Não alterado
- Trava desligada; nenhum fluxo real criado; nenhuma chamada real à Zernio feita pelo assistente.

---

## 2026-11-05 — Automações, etapa A3: só seguidores e menção em story (Instagram)

### Adicionado
- Contrato: `trigger` (`comment` ou `story_mention`, padrão `comment`) e `followGate` na entrada; `followGate` no detalhe; `followGateSent` e `followGatePassed` nas estatísticas; regras novas em `automationInputProblem` (D-67).
- API: corpo da Zernio para menção em story (sem palavra-chave, sem resposta pública) e para só seguidores (`audience` com `verify`, `followGate`, resposta pública sempre); tirar a verificação numa edição a desliga; gatilho fixo depois de criado; gatilhos criados no painel da Zernio não são editados.
- Construtor: seletor "O que dispara" (só Instagram), cartão Verificação com textos iniciais, prévia com o botão de confirmação antes da recompensa e "mencionou você num story"; trocar para outra rede volta ao comentário.
- Página da automação: verificação de seguidor, mensagem para quem não segue e números da verificação; sem Editar para gatilhos de fora.
- Modelos "Só seguidores" e "Menção em story → DM" passam a abrir o construtor.
- Simulador: gatilhos de story só no Instagram; verificação recusada nas redes só de resposta pública.

### Testes
- `automations.spec.ts`: 5 testes novos (21 no total), com API própria para não esbarrar no limite de 30 alterações/min por empresa. `AutomationsPage.spec.tsx`: 4 testes novos (16 no total).
- Suíte completa: 546 testes passando; typecheck e build sem erro.

### Não alterado
- Trava desligada; nenhuma automação real criada; nenhuma chamada real feita pelo assistente.

## 2026-11-05 — Automações, etapa A2: Comentário → DM e Comentário → resposta pública

### Adicionado
- `packages/contracts/src/automations.ts`: entrada para criar e editar (nome, palavras-chave, modo de busca, DM, até 3 botões `https://`, resposta pública, repetição), ativar ou pausar, e `automationInputProblem` com as regras por rede (as mesmas na tela e na API). O detalhe passa a informar a trava e se a pessoa gerencia.
- `apps/api/src/integrations/zernio-client.ts`: `createCommentAutomation`, `updateCommentAutomation` e `deleteCommentAutomation`, só com os campos documentados.
- `apps/api/src/automations/automations-service.ts` e `routes/automations.ts`: `POST /comment` (sempre pausada), `PUT /comment/:id`, `POST /comment/:id/state` e `DELETE /comment/:id`. Dono e administradores; trava `AUTOMATIONS_WRITE_ENABLED`; conta do perfil da empresa; nome único por conta (a Zernio não documenta chave de idempotência); erros fixos e resultado incerto com orientação para conferir a lista; 30 alterações/min por empresa; log só com ids (D-66).
- `apps/web/src/pages/automations/AutomationBuilder.tsx`: construtor com cartões Quando, Então e Com que frequência, prévia de celular com nome de exemplo, contador de caracteres, botões de link e "Salvar pausada" (desligado sem a trava ou para quem não gerencia).
- `AutomationsPage.tsx`: "Nova automação" e "Usar modelo" para dono e administradores; na automação, Editar, Ativar com confirmação ("são mensagens reais"), Pausar e Excluir com confirmação.
- Simulador: criar, alterar e excluir com as regras por rede da documentação oficial e modos de recusa, conflito, indisponibilidade e resposta fora do formato.

### Testes
- `automations.spec.ts`: 9 testes novos (16 no total). `AutomationsPage.spec.tsx`: reescrito, 12 testes.
- Suíte completa: 537 testes passando; typecheck e build sem erro.

### Não alterado
- Trava desligada: nenhuma automação foi criada, alterada ou ativada na Zernio. Nenhuma chamada real feita pelo assistente.
- Escolher uma publicação específica e responder também por DM (`alsoMatchInDms`) ficam fora desta etapa.

## 2026-11-05 — Automações, etapa A1: consulta das automações de redes pela Zernio

### Decisão
- Plano `saas/docs/PLANO_MODULO_AUTOMACOES.md` aprovado pelo dono do produto, com as recomendações A1 a A9 (D-65).

### Adicionado
- `packages/contracts/src/automations.ts`: caminhos, limites da documentação, capacidade por rede (Instagram completo; Facebook DM; TikTok, Threads, LinkedIn e YouTube só resposta pública), lista e detalhe.
- `apps/api/src/integrations/zernio-client.ts`: `listCommentAutomations` e `getCommentAutomation`, com formato tolerante (a documentação não traz a resposta completa).
- `apps/api/src/automations/automations-service.ts` e `apps/api/src/routes/automations.ts`: `GET /api/internal/automations/overview` e `/comment/:id`. Só automações de contas do perfil da empresa; papéis (dono e administradores gerenciam); erros fixos; log só com ids e contagens.
- `apps/web/src/pages/automations/AutomationsPage.tsx` e `src/automations/`: seção "Redes sociais" com números, lista ("Quando … → então …"), contas e o que cada rede permite, modelos marcados "Próxima etapa" e página de detalhe.
- Simulador: automações cruas, vazamento de outro perfil e modos de erro.
- Trava `AUTOMATIONS_WRITE_ENABLED` (padrão `false`) em `config/env.ts` e `saas/.env.example`.

### Corrigido
- `saas/.env.example` passa a documentar `INBOX_SOCIAL_SEND_ENABLED` (estava só no código).

### Testes
- `automations.spec.ts` (7) e `AutomationsPage.spec.tsx` (6). `App.spec.tsx`: Automações sai da lista de módulos sem página (continua "Em desenvolvimento" no menu).
- Suíte completa: 522 testes passando; typecheck e build sem erro.

### Não alterado
- Nenhuma chamada real à Zernio e nenhuma automação criada. Criar, editar, ativar e pausar ficam para a A2 em diante.
- Sem tabela nem migração.

## 2026-11-05 — Plano do módulo Automações (redes sociais pela Zernio)

### Documentação
- `saas/docs/PLANO_MODULO_AUTOMACOES.md` (novo): plano para um "ManyChat próprio" por empresa na página Automações, com automações de comentário e fluxos da Zernio. Inclui matriz por rede, regras do DisparaZap que prevalecem sobre a skill de terceiros, interface, arquitetura sem migração, etapas A1 a A6, homologação H1 a H3, decisões pendentes A1 a A9 e riscos.
- Endpoints conferidos na documentação oficial da Zernio em 2026-11-05 (automações de comentário, registros, fluxos, execuções e preços).
- `CLAUDE.md` (tabela de documentos) e `docs/DISPARAZAP_MASTER.md` (linha do módulo Automações) atualizados.

### Não alterado
- Nenhum código, nenhuma chamada real à Zernio e nenhuma automação criada. Implementação só depois da aprovação do plano.

## 2026-11-05 — Inbox: lista de conversas do TikTok (somente leitura) e skill para novos canais

### Adicionado
- Skill `zernio-novo-canal` em `C:\Users\USER\.claude\skills\zernio-novo-canal\SKILL.md`: processo para habilitar um canal pela Zernio (documentação, probe, leitura sem gravação, envio com trava, primeiro envio real com autorização).
- `saas/docs/REFERENCIA_ZERNIO.md`, seção 12: regras do TikTok (Business, região, só responder, janela de 48 h, texto ou imagem) confirmadas na documentação em 2026-11-05.

### Alterado
- `apps/api/src/inbox/social-inbox.ts`: a lista de conversas aceita Instagram e TikTok (`LIST_PLATFORMS`). Mensagens, diagnóstico e envio continuam aceitando só o Instagram (`accountOf` com a regra padrão).
- `apps/web/src/pages/inbox/InboxPage.tsx`: a conta TikTok aparece no filtro e na lista. Ao escolher uma conversa do TikTok, a tela não abre o chat, não mostra o diagnóstico e não tem caixa de resposta.

### Testes
- `social-inbox.spec.ts`: lista do TikTok funciona; mensagens do TikTok recusadas (400). Mensagem de erro da listagem atualizada.
- `InboxPage.spec.tsx`: TikTok lista sem abrir o chat nem permitir resposta.
- Suíte completa: 510 testes passando; typecheck e build sem erro.

### Não alterado
- Nenhuma chamada real à Zernio foi feita por mim. A primeira leitura real do TikTok acontece quando a conta TikTok é aberta na tela, com a chave da empresa.
- Envio pelo TikTok continua desligado; exige autorização própria.

## 2026-11-05 — Inbox: layout em altura de tela (computador)

### Corrigido
- `apps/web/src/layouts/AppLayout.tsx`: na rota `/inbox`, a área da página recebe a classe `layout--fill`.
- `apps/web/src/styles/global.css`: em telas acima de 960 px, a Inbox ocupa exatamente a altura da janela. O cabeçalho e o aviso ficam no topo, e as três colunas rolam por dentro. Antes, a página inteira rolava e sobrava espaço vazio embaixo quando a altura fixa não batia com o cabeçalho.
- Tablet e celular mantêm o comportamento anterior.

### Testes
- Typecheck e build sem erro; 77 testes das telas de layout e da Inbox passando. O ajuste de altura é visual e não tem teste automatizado; conferência no navegador necessária.

## 2026-11-05 — Inbox do Instagram: atualização automática e campo com foco

### Corrigido
- `apps/web/src/inbox/SocialInbox.tsx`: a conversa aberta é atualizada sozinha a cada 15 segundos (só com a aba visível), sem precisar recarregar a página. As mensagens novas entram embaixo e o histórico já carregado é mantido.
- A rolagem só acompanha o fim da conversa quando a pessoa está perto do fim; quem lê o histórico antigo não é puxado para baixo.
- Depois do envio, a conversa é atualizada na hora (sem apagar a lista) e o cursor volta para o campo de resposta, pronto para a próxima mensagem.

### Testes
- `apps/web/src/inbox/SocialInbox.spec.tsx` (novo, 2): junção das mensagens novas com o histórico e preservação da lista quando não há mudança.
- A atualização automática e a rolagem não têm teste de tela (o ambiente de testes não calcula layout nem tempo real); conferência visual necessária.
- Typecheck e build sem erro; 45 testes da Inbox passando.

### Pendências
- A lista de conversas (coluna da esquerda) ainda não se atualiza sozinha; só a conversa aberta.

## 2026-11-05 — Inbox do Instagram: migração 0008 no banco local e preparação do envio real

### Adicionado
- `saas/packages/db/migrations/0008_social_sends.sql` e entrada 8 no `_journal.json`: tabela `app.inbox_social_sends` no banco embutido de desenvolvimento. As partes que dependem dos papéis `dz_app` e `dz_migrator` só são aplicadas se esses papéis existirem (o banco local não os cria). Em produção, a tabela já foi criada manualmente em 2026-11-05 com o mesmo desenho; por isso `producao:migrar` não deve rodar esta migração sem antes marcá-la como aplicada.

### Testes
- `packages/db/src/db.spec.ts`: lista de tabelas inclui `app.inbox_social_sends`.
- `apps/api/src/inbox/social-send.spec.ts`: mesmo ajuste (recria a tabela com o rascunho). Suíte: 507 testes passando, typecheck e build sem erro.
- `packages/db/src/tenant.spec.ts`: o teste de RLS recria a tabela com o rascunho (que traz os papéis do teste), porque a migração local não cria esses papéis.

### Pendências
- Envio real: só com `INBOX_SOCIAL_SEND_ENABLED=true` no `saas/.env` (dono edita o arquivo) e uma única ação do dono na conversa confirmada. Nenhum envio real ainda.

## 2026-11-05 — Inbox do Instagram: conversa abre na última mensagem

### Corrigido
- `apps/web/src/inbox/SocialInbox.tsx`: ao abrir uma conversa, o histórico desce para a última mensagem (embaixo), como num chat. Ao enviar e recarregar, a rolagem também vai para o fim.
- Ao carregar "Ver mensagens anteriores", a posição de leitura é mantida (as mensagens antigas entram em cima sem o histórico pular).

### Testes
- Typecheck e build sem erro; 43 testes da Inbox passando. A rolagem não é coberta por teste automatizado (o ambiente de testes não calcula o layout); conferência visual necessária.

## 2026-11-05 — Inbox do Instagram: caixa de resposta no estilo de chat

### Alterado
- `apps/web/src/inbox/SocialInbox.tsx` e `apps/web/src/styles/global.css`: a caixa de resposta passou a ser uma barra arredondada, com o botão de enviar circular dentro dela, a contagem de caracteres embaixo e a janela de 24 horas acima. Não usa mais a classe `social-composer`, que era da tela de Redes Sociais e causava o layout confuso (campo e botão lado a lado).
- Botão de envio com o nome acessível "Enviar" e estado "carregando" enquanto o envio acontece.

### Testes
- Typecheck e build sem erro; 43 testes da Inbox passando.

## 2026-11-05 — Inbox do Instagram: campo de resposta ligado e migração 0008 aplicada em produção

### Aplicado em produção (autorizado pelo dono do produto)
- Migração `0008_social_sends` aplicada no Supabase via ferramenta de migração: cria `app.inbox_social_sends` (registro local de envios, só metadados), com RLS ligado e forçado, 3 políticas para `dz_app` e sem DELETE para a aplicação.
- Dono da tabela transferido para `dz_migrator` na mesma execução (padrão das demais tabelas; desvio pequeno em relação ao rascunho, que deixava o dono como `postgres`).
- Verificado por leitura: dono `dz_migrator`; RLS ativo e forçado; 3 políticas; `postgres` continua com BYPASSRLS (a conexão atual não foi afetada).

### Alterado
- `apps/web/src/inbox/inbox-api.ts`: novo método `socialSend` (POST `SOCIAL_SEND_PATH`, resposta validada pelo contrato).
- `apps/web/src/inbox/SocialInbox.tsx`: campo de resposta e botão Enviar ligados. Dono, administrador e atendente podem responder; a janela de 24 horas continua travando o envio. O `requestId` é mantido enquanto o texto não muda, então repetir após falha de rede não gera segunda mensagem. Confirmação e erro aparecem na própria caixa.
- `apps/web/src/pages/inbox/InboxPage.tsx`: passa a permissão de resposta ao chat.

### Testes
- `InboxPage.spec.tsx`: envio com confirmação, falha de rede com repetição do mesmo pedido, atendente pode responder, campo com texto ligado e botão só com texto.
- Typecheck e build sem erro. Suíte completa: 507 testes passando (uma execução teve falha intermitente em `SocialSection.spec.tsx`, que passou sozinha e na segunda execução completa).

### Não alterado
- `INBOX_SOCIAL_SEND_ENABLED` continua `false`. Nenhuma mensagem real foi enviada ao Instagram. Ligar a flag e o primeiro envio real dependem de autorização específica, com conversa de teste escolhida pelo dono.
- Recebimento continua sob demanda (sem webhook da Zernio).

## 2026-11-05 — Auditoria do banco de produção e rascunho de RLS por empresa (não aplicado)

### Achados (consulta só de leitura feita pelo dono)
- 23 tabelas em `identity`, `app` e `platform`, todas com dono `postgres`; RLS ligado e não forçado; nenhuma política.
- Esquemas `identity`, `app` e `platform` já existiam com dono `postgres`; `audit` e `drizzle` com `dz_migrator`.
- Papéis `dz_app` e `dz_migrator` criados corretamente (sem superusuário, sem BYPASSRLS).
- 17 tabelas têm `organization_id` (texto); as outras 6 são globais ou da plataforma.

### Adicionado
- `saas/docs/MIGRACAO_RLS_EMPRESAS_RASCUNHO.sql`: transfere donos para `dz_migrator`, cria `app.current_org_id()`, políticas `*_tenant` nas 17 tabelas de empresa para `dz_app`, e concessões mínimas. Não usa FORCE RLS; deixa login, sessões e plataforma para etapa própria.

### Testes
- PGlite em memória, com migrations 0000 a 0007, RLS ligado sem políticas (estado de produção) e o rascunho aplicado: 23 donos `dz_migrator`, 17 políticas, `dz_app` vê só a própria empresa e nada sem contexto.

### Aplicado em produção (2026-11-05, pelo dono do produto, com autorização explícita)
- Script `MIGRACAO_RLS_EMPRESAS_RASCUNHO.sql` executado no SQL editor (retorno: "Success. No rows returned").
- Verificado por leitura: 23 tabelas com dono `dz_migrator`; RLS ativo e não forçado; 17 políticas `*_tenant` só para `dz_app`.
- Advisor de segurança do Supabase: 6 avisos INFO (`rls_enabled_no_policy`) nas tabelas globais (`identity.accounts`, `organizations`, `sessions`, `users`, `verifications`, `platform.provider_servers`). Esperado: são tabelas sem política por desenho, sem acesso para `dz_app` e a serem tratadas na etapa de login (`dz_auth`).

### Pendente
- Parte da API: `app.org_id` em cada requisição de empresa, antes da troca de conexão para `dz_app`. Sem ela, `dz_app` não enxerga nada.
- FORCE RLS: só depois da troca de conexão e de testes com `dz_app`.

## 2026-11-04 — Z3.2 (preparação dos papéis): rascunho de SQL para o banco, ainda não executado

### Adicionado
- `saas/docs/PREPARACAO_PAPEIS_RASCUNHO.sql`: cria os papéis `dz_app` (aplicação) e `dz_migrator` (dono dos esquemas), sem superusuário e sem BYPASSRLS, cria os esquemas `identity`, `app`, `audit`, `drizzle` e `platform` com esse dono e restringe o acesso a PUBLIC, anon, authenticated e service_role. As senhas são placeholders e não ficam no repositório.

### Testes
- Executado em PGlite em memória, com os papéis anon, authenticated e service_role criados no teste (o Supabase já os fornece): atributos dos papéis conferidos e segunda execução sem erro.

### Não alterado
- Nenhum banco real foi acessado. A migração 0008 continua sem aplicação e o precheck dela continua exigindo `dz_app`.

## 2026-11-04 — Z3.2: isolamento transacional, migração revisada e cliente de envio com simulador

**Pedido do dono do produto:** auditoria de isolamento, migração 0008 revisada, cliente de envio testado com a Zernio simulada. **Sem envio real, sem migração aplicada, sem leitura real.**

### Auditoria (Fase A)
- A empresa vem da sessão (`member.organizationId`), validada no servidor. Nenhum `organization_id` do navegador.
- A conexão de produção usa `pg.Pool` com a URL configurada. **Não verificado no código** qual papel a URL usa: se for superusuário ou com BYPASSRLS, a RLS não protege nada. Exigência: a aplicação conecta como `dz_app`.
- `app.org_id` é definido por transação com `set_config(..., true)` (`packages/db/src/tenant.ts`): desfaz ao fim da transação, sem vazamento entre requisições. Identificador de empresa fora do formato não executa.

### Migração 0008 (revisada, não aplicada)
- **Defeito encontrado e corrigido na revisão:** a função `app.current_org_id()` tinha `EXECUTE` revogado de `PUBLIC`, e a política RLS a chama. Sem concessão ao `dz_app`, a leitura falha. Corrigido em `docs/MIGRACAO_0008_SOCIAL_SENDS_RASCUNHO.sql`.
- Arquivo final: `saas/docs/MIGRACAO_0008_SOCIAL_SENDS_RASCUNHO.sql`.

### Testes de RLS (`packages/db/src/tenant.spec.ts`, 5)
- Com empresa definida, o papel da aplicação vê só as próprias linhas.
- Sem empresa, nenhuma linha.
- Inserção de outra empresa é recusada.
- O contexto não vaza para a transação seguinte.
- Identificador fora do formato não executa nada.

### Cliente de envio (Fase B)
- `sendInboxMessage`: `POST /v1/inbox/conversations/{id}/messages` com `accountId`, `message`, `messageTag`/`messagingType` só para resposta humana fora de 24 h, e `Idempotency-Key` = requestId da intenção.
- `sendSocialReply`: só origem humana; janela revalidada com histórico lido na hora; registro gravado antes da chamada; sem reenvio automático.
- Classificação: 4xx definitivos viram `failed`; 409 em processamento, 5xx, tempo esgotado e resposta sem id viram `unknown`.
- Flag `INBOX_SOCIAL_SEND_ENABLED`, **desligada por padrão**. Enquanto desligada, a rota responde 409.
- Simulador: modos de resposta 200, 409, 422, 429, 500, 502, sem id, janela (403) e replay de idempotência.

### Testes
- `social-send.spec.ts`: 21 (janela, tag, bloqueios, idempotência, pedidos simultâneos, registro no banco, erros, privacidade e log).
- Total: **504 testes**, typecheck e build sem erros.
- Ajuste de estabilidade: limite de 20 s nos testes do painel (carga da suíte completa).

### Pendências
- Painel: o campo de resposta **continua desativado**. Não foi ligado ao envio, conforme o pedido de não habilitar chamadas reais.
- Aplicação de `app.org_id` em todas as rotas de empresa e migração das tabelas 0002 a 0006 para RLS.
- Timeout real de envio não simulado (só 5xx e 409).
- Homologação do primeiro envio humano: plano separado, com autorização.

---

## 2026-11-04 — Z3.1: ordenação corrigida, janela de resposta, rascunho da migração 0008

**Pedido do dono do produto:** investigação documental do envio, correção da ordenação, rascunho da migração e regras de janela, tudo com simulador. **Sem envio, sem leitura real, sem migração aplicada.**

### Documentação do envio
- Página `messages/send-inbox-message.mdx` lida em duas partes, cobrindo o texto inteiro.
- **Confirmado:** corpo (`accountId`, `message`, `messageTag`, `messagingType`), `Idempotency-Key` com validade de 24 horas (mesma chave e mesmo corpo devolvem a resposta original; corpo diferente dá 422; em processamento dá 409), sucesso com `data.messageId`, erro no formato `error`/`type`/`code`/`platform`/`platformError`.
- **Não encontrado:** o texto da janela de 24 horas fechada (a Meta rejeita com `platform_error`/`platform_api_error`, sem texto fixo); `new_contact_limit`; corpo do 502. Por isso o cliente de envio **continua bloqueado**.

### Ordenação (aprovada)
- A tela só usa o histórico como confiável quando a Zernio confirma `sortOrderApplied = desc`. Caso contrário: aviso, "ver anteriores" desativado e janela bloqueada.
- Testes com a Zernio simulada: H0 (confiável) e H1 (não confiável).

### Janela de resposta e limite (aprovados)
- `socialReplyWindow` em `packages/contracts`: até 24 h sem tag; 24 h a 7 dias com `HUMAN_AGENT`; mais de 7 dias bloqueado; sem data confiável ou sem histórico confirmado, bloqueado.
- Estados visuais na conversa e campo de resposta desativado (sem envio), limite de 1.000 caracteres.

### Migração 0008 (rascunho, não aplicada)
- `saas/docs/MIGRACAO_0008_SOCIAL_SENDS_RASCUNHO.sql`: tabela `app.inbox_social_sends`, RLS habilitada e forçada, três políticas, sem texto de mensagem nem credencial, rollback documentado.
- Validada num banco de teste em memória: restrições, `requestId` único, limite de texto, estado `sent` exige id do provedor e rollback.
- **Bloqueio para produção:** a aplicação ainda não define `app.org_id` por requisição. Com RLS forçada, sem isso ela não enxerga dados.
- **Pendência existente:** as tabelas de empresa das migrações 0002 a 0006 ainda não têm RLS.

### Testes
- Total: **478 testes**, typecheck e build sem erros.

### Não alterado
- Nenhum envio, nenhuma leitura real, nenhum webhook, nenhuma migração aplicada, nenhuma alteração de produção.

---

## 2026-11-04 — Z3 (pré-implementação): auditoria da ordem, contrato de envio e plano

**Pedido do dono do produto:** decisões D1 a D5 para a preparação da Z3, sem envio, sem consulta real e sem migração.

### Auditoria da ordem e da paginação (D3)
- Testes com a Zernio simulada: H0 (a Zernio respeita `desc`) funciona; H1 (a Zernio ignora `desc`) mostra as mensagens mais antigas **sem aviso** e "ver anteriores" pode trazer mais novas no topo.
- Defeito latente registrado: a tela não verifica `sortOrderApplied`. Correção proposta no plano, ainda não feita.
- A captura de março continua sem explicação. A Z2.4 não registrou `sortOrderApplied`.

### Contrato de envio (D5)
- `POST /v1/inbox/conversations/{conversationId}/messages`: campos `accountId`, `message`, `messageTag`, `messagingType` e `Idempotency-Key` (24 horas) confirmados no texto original.
- Página lida em cerca de 58%. Janela fechada, erros 409, 422, 429 e 502 **não confirmados**. Cliente de envio **bloqueado**.

### Decisões (D1 a D4)
- D1: janela de 24 horas, `HUMAN_AGENT` até 7 dias só para resposta humana, validação no backend, bloqueio sem data confiável.
- D2: tabela `app.inbox_social_sends` proposta (sem migração), com estados, idempotência, política de reconciliação e rollback.
- D4: limite provisório de 1.000 caracteres para texto simples.

### Documentado
- `saas/docs/PLANO_MODULO_Z3_RESPOSTAS_INSTAGRAM.md`: pendências 1 a 5 para aprovação.

### Testes
- API: 23 no arquivo da inbox social (2 de auditoria: H0 e H1). Total da suíte: 471 testes, typecheck e build sem erros.

### Não alterado
- Nenhum envio, nenhuma consulta real, nenhum webhook, nenhuma migração, nenhuma alteração de produção.

---

## 2026-11-04 — Z2.4: evidência da homologação das datas e plano da Z3

**Pedido do dono do produto:** registrar o resultado da homologação das datas (feita pelo administrador na interface) e preparar a Z3 sem implementar envio.

### Evidência registrada
- Uma conversa, 10 mensagens, lidas pelo administrador. Só datas e campos.
- `sentAt` e `createdAt` coincidentes **nesta amostra**; diferença de 0 segundo.
- Última mensagem recebida do contato: 02/11/2026, 09:06:51. Última atividade da conversa: 02/11/2026, 09:06.
- **Limitação:** a coincidência vale só para essa amostra. A documentação define `sentAt` como horário de envio apenas de mensagens da empresa.
- **Pendência:** a captura anterior, com mensagens de março como primeiras da página, continua sem explicação. Confirmar antes da Z3 que a Inbox mostra as mensagens mais recentes.

### Pesquisa para a Z3
- Janela de 24 horas e tag `HUMAN_AGENT` (até 7 dias, só para respostas digitadas por pessoa): verificadas na documentação do Instagram.
- **Não encontrado:** a página de envio de mensagens (404 no endereço testado, sem entrada no índice nos trechos lidos). Sem ela, não há formato do pedido, erro de janela fechada, resposta de sucesso nem idempotência.

### Documentado
- `docs/PLANO_MODULO_Z3_RESPOSTAS_INSTAGRAM.md`: arquitetura, regras, testes com a Zernio simulada e cinco pendências para aprovação.

### Não alterado
- Nenhum código de envio. Nenhuma chamada real. Nenhuma mensagem enviada. Nenhum webhook. Nenhuma alteração de produção.

---

## 2026-11-04 — Z2.4: ferramenta temporária de diagnóstico das datas do Instagram

**Pedido do dono do produto:** homologar `sentAt`, `createdAt` e a ordem das mensagens, com uma única leitura real de até 10 mensagens, escolhida pelo administrador na interface. **Nenhuma leitura real foi feita pela IDE.**

### Adicionado (temporário, para remover depois da homologação)
- `POST /api/internal/inbox/social/diagnostico-datas`: só dono e administradores; uma conversa; no máximo 10 mensagens. Devolve datas, presença de texto (sim/não, nunca o texto), tipos de anexo e a ordem. Não grava nada.
- Botão **"Diagnosticar datas"** na lista de conversas do Instagram, visível só para dono e administradores. A leitura começa ao escolher a conversa, sem abrir o histórico (que carregaria 50 mensagens, acima da autorização).

### Testes
- API: 21 (5 novos: papéis, limite de 10, sem texto na resposta, mensagem só com anexo, isolamento e log).
- Painel: 38 (2 novos: botão para o dono, sem botão para o atendente, e nenhuma página de mensagens lida).
- Total: **469 testes**, typecheck e build sem erros.

### Pendências
- Homologação real: o administrador escolhe uma conversa e clica em "Diagnosticar datas". Depois remover a rota e o botão.

---

## 2026-11-04 — Z2.3: estabilização das conversas do Instagram na Inbox

**Pedido do dono do produto:** corrigir mensagens "sem texto", o layout da coluna de conversas e o subtítulo da Inbox, antes do envio de respostas. **Nenhuma chamada real à Zernio.**

### Causas encontradas
- **"Mensagem sem texto":** a Zernio devolve `message` vazio em mensagens com anexo, e o DisparaZap descartava o tipo do anexo. A prévia "[Attachment]" vem do próprio texto da Zernio.
- **Datas:** a documentação não define `createdAt` como horário de envio; o horário de envio é `sentAt`. As datas exibidas vieram de `createdAt`. A origem exata das datas de março não foi confirmada sem uma leitura real.
- **Layout da coluna:** os itens eram botões com a borda e o fundo padrão do navegador (as bordas escuras), e a largura não tinha `min-width: 0` (a rolagem horizontal).

### Corrigido
- `zernio-client.ts`: tipo de cada anexo (imagem, vídeo, áudio, arquivo, figurinha, compartilhamento, modelo ou não suportado), e `sentAt`.
- `social-inbox.ts`: horário de envio (`sentAt` ou `createdAt`) como chave de ordem; a ordem da página deixou de ser assumida.
- `SocialInbox.tsx`: anexos com rótulo por tipo, sem URL (que expira). Mensagem só com anexo não ganha texto inventado. "Mensagem sem conteúdo de texto" só quando não há nada.
- `InboxPage.tsx`: subtítulo novo, conforme o pedido.
- `global.css`: itens da lista sem bordas padrão, seleção clara, sem rolagem horizontal, rodapé de "carregar mais" separado.

### Testes
- API: 16 (2 novos: tipos de anexo e tipo desconhecido; ordem pelo horário de envio).
- Painel: 36 (ajustados ao novo formato).
- Total: **462 testes**, typecheck e build sem erros.

### Limitações
- Não confirmado: se `createdAt` ou `sentAt` determina a janela das mensagens mais recentes. Isso exige uma leitura real autorizada.
- Mídia não é exibida (URLs expiram; visualização fica para outra etapa).

---

## 2026-11-04 — Z2.2: correções da Inbox multicanal (canais, filtros, avisos e identificação)

**Pedido do dono do produto:** cinco correções da auditoria Z2.1 e a visão unificada "Todos os canais". Autorizado só para desenvolvimento. **Nenhuma chamada real à Zernio.**

### Corrigido
- **TikTok e outras redes:** não chamam mais a API de conversas. Mostram "Leitura de conversas de TikTok ainda não habilitada nesta etapa" com o rótulo de conta conectada.
- **Instagram:** a lista e o histórico vêm da Zernio, como na Z2.
- **Filtros:** com uma rede escolhida, a busca, o filtro por conta e as abas somem. Em "Todos", o filtro por conta lista também as contas do Instagram.
- **Aviso do WhatsApp:** só aparece em "Todos" e "WhatsApp".
- **Identificação:** o cabeçalho diz "Conta conectada" com a rede e o nome. Conversas aparecem como "Conversa com cliente · conta".
- **Backend:** removido o fallback que trocava o identificador de conta ausente. Conversas que não batem com a conta ou a rede pedida são descartadas.

### Adicionado
- **"Todos os canais":** reúne as conversas do WhatsApp e as do Instagram, em ordem de atividade. A leitura das contas do Instagram acontece só quando essa visão está aberta.

### Arquivos
- `apps/api/src/inbox/social-inbox.ts`: validação de conta e rede; sem fallback.
- `apps/api/src/testing/zernio-simulator.ts`: rede por conversa e modo que devolve conversas de outras contas.
- `apps/web/src/pages/inbox/InboxPage.tsx`: visão unificada, filtros e avisos.
- `apps/web/src/inbox/SocialInbox.tsx`: estado de rede sem leitura, rótulo de conta e entrada unificada.

### Testes
- API: **14** (1 novo: conversa de outra conta ou rede é descartada, sem trocar o identificador).
- Painel: **36** (6 novos: TikTok sem chamada, filtros, aviso do WhatsApp, visão unificada, filtro por conta e conversa do Instagram).
- Total: **460 testes**, typecheck e build sem erros.

### Pendências
- Consulta real à lista do Instagram, uma única vez, com autorização do administrador.
- Respostas pelo Instagram e webhooks: etapas seguintes.

---

## 2026-11-04 — Z2: conversas do Instagram na Inbox (leitura direta da Zernio)

**Pedido do dono do produto:** mostrar as conversas do Instagram na Inbox existente, só para leitura, sem gravar no banco e sem enviar mensagens.

### Adicionado
- `packages/contracts/src/inbox.ts`: rotas e formatos das conversas e mensagens de redes (`/social/conversations`, mensagens por conversa, paginação de 50).
- `apps/api/src/integrations/zernio-client.ts`: `listInboxConversations` e `listInboxMessages`, com os formatos verificados na documentação da Zernio.
- `apps/api/src/inbox/social-inbox.ts`: leitura com verificação de conta, papel e erros fixos. Nada é gravado.
- `apps/api/src/routes/inbox.ts`: `GET /social/conversations` e `GET /social/conversations/:id/messages`, para atendentes, dono e administradores.
- `apps/web/src/inbox/SocialInbox.tsx`: lista, histórico e detalhes nas três colunas existentes, com "somente leitura".

### Alterado
- `zernio-simulator.ts`: conversas de teste (`inboxThreads`) e leitura de mensagens no formato verificado.
- `InboxPage.tsx`: ao escolher o ícone do Instagram, a Inbox mostra as conversas da Zernio, no lugar do aviso de "próxima etapa".

### Testes
- `social-inbox.spec.ts`: 13 (API). `InboxPage.spec.tsx`: 30 (painel, com 3 novos).
- Total: **453 testes**, typecheck e build sem erros.

### Pendências
- Leitura real de uma conversa, só com autorização do administrador, depois da confirmação do add-on do inbox.
- Respostas pelo Instagram (próxima etapa) e webhooks (dependem da publicação com HTTPS).

---

## 2026-11-04 — Z1.1: investigação do diagnóstico inconclusivo do teste de acesso à Inbox

**Pedido do dono do produto:** descobrir por que o teste retornou "Diagnóstico inconclusivo" (12:48, horário de Brasília) e corrigir apenas defeito comprovado. **Nenhuma consulta real foi feita.**

### Diagnóstico
- **Registro existente:** `zernio.inbox.teste` com `resultado: inconclusive` e `status_servidor: null`. O status só é registrado quando a Zernio responde com erro, então a resposta chegou como **sucesso (2xx)** com um formato que o código não reconheceu.
- **Causa comprovada no DisparaZap:** o cliente esperava a lista na chave `conversations`. A documentação oficial (messages/list-inbox-conversations) diz que a lista vem em `data`, com `pagination` e `meta`. A suposição veio de mim, e o simulador a reproduzia.
- **Limitação:** o corpo da resposta real não foi registrado, então a confirmação exata depende de nova consulta, com autorização.
- **Ressalva da leitura:** a página de documentação tem um resumo gerado por modelo que contradiz o texto literal sobre a listagem. Foi usado o texto literal.

### Corrigido
- `apps/api/src/integrations/zernio-client.ts`: `inboxProbe` lê a lista em `data` e devolve também só os nomes das chaves de topo.
- `apps/api/src/zernio/zernio-service.ts` e `routes/zernio.ts`: quando o formato não bate, o log registra `forma` com os nomes das chaves (nunca valores).
- `apps/api/src/testing/zernio-simulator.ts`: resposta no formato da documentação.

### Testes
- `zernio.spec.ts`: **31** (1 novo: o log registra só os nomes das chaves).
- Total: **438** testes, typecheck e build sem erros.

### Pendências
- Repetir **uma** consulta real pelo botão, com confirmação do administrador. Se ainda der inconclusivo, o log mostrará `forma` e a causa poderá ser confirmada.

---

## 2026-11-04 — Z1: teste de acesso à Inbox da Zernio (sem consulta real)

**Pedido do dono do produto:** botão administrativo para verificar, por leitura, se a Inbox da Zernio está liberada para a empresa. **Nenhuma consulta real foi feita.** Ela só ocorre quando um administrador clicar e confirmar.

### Adicionado
- `packages/contracts/src/zernio.ts`: rota `POST /integracoes/zernio/inbox-access`, confirmação obrigatória e resultado com 5 situações.
- `apps/api/src/integrations/zernio-client.ts`: `inboxProbe` (só a contagem de conversas, com 1 de limite).
- `apps/api/src/zernio/zernio-service.ts`: `testInboxAccess`, que traduz cada erro da Zernio e não altera a integração.
- `apps/api/src/routes/zernio.ts`: rota só para dono e administradores, com limite de tentativas e log sem segredos.
- `apps/api/src/testing/zernio-simulator.ts`: `GET /v1/inbox/conversations` com 8 modos de resposta.
- `apps/web`: botão "Testar acesso à Inbox" na seção Zernio, com confirmação e resultado.

### Testes
- `zernio.spec.ts`: 30 (12 novos). `IntegrationsPage.spec.tsx`: 24 (4 novos). Total: **437**, com typecheck e build sem erros.

### Pendências
- Executar a consulta real pelo administrador, depois de confirmar o add-on do inbox na Zernio.

---

## 2026-11-04 — Auditoria da ativação da Inbox multicanal (sem alteração de código)

**Pedido do dono do produto:** auditoria de WhatsApp, Instagram e TikTok na Inbox, sem alterar código, banco ou integrações.

### Documentação
- **Novo:** `saas/docs/AUDITORIA_ATIVACAO_INBOX_MULTICANAL.md`, com o diagnóstico de cada aviso da tela, os bloqueios da Zernio, o modelo de banco que impede conversas de rede, o plano em 7 etapas e as operações que precisam de autorização.

### Principais achados
- O aviso do WhatsApp é correto: o recebimento está desligado por configuração (homologação H1 a H7 pendente).
- O aviso de rede é um texto fixo, mostrado para qualquer conta, inclusive TikTok, sem consultar a capacidade da conta.
- As tabelas da Inbox estão presas a `whatsapp_instances`: não cabe conversa da Zernio sem mudança de modelo.
- Não existe cliente de inbox nem recebedor de webhook da Zernio no código.
- O TikTok só permite responder (até 10 mensagens em 48 h, sem iniciar conversa, texto ou imagem, nunca os dois).
- O webhook exige endereço público (provavelmente HTTPS; a confirmar) e resposta em 5 s; depende da publicação.

### Verificação
- Nenhuma chamada real à Zernio ou à Evolution. Nenhuma alteração de código, banco ou variável.
- A leitura da documentação pública da Zernio foi feita por apoio de leitura; um trecho da página de webhooks veio truncado e está marcado como a confirmar.

### Pendências
- Confirmar no painel da Zernio se o add-on do inbox está ativo.
- Autorizar, uma a uma, as operações da seção I do relatório.

---

## 2026-11-04 — Inbox: ícones de canal com as redes ativas na Zernio

**Pedido do dono do produto:** mostrar na Inbox os canais das redes sociais ativas na Zernio, com ícones para trocar de canal.

### Adicionado
- `apps/web/src/pages/inbox/InboxPage.tsx`: a faixa de canais virou ícones:
  - "Todos" (texto), WhatsApp (com contador de não lidas) e **um ícone por conta de rede ativa** (estado "ok" na Zernio);
  - o selo de cada rede é o mesmo de Redes Sociais (`PlatformBadge`, letras e cor, sem logotipo externo);
  - contas que precisam reconectar ficam de fora.
- Escolher uma rede mostra o aviso: as conversas chegam numa próxima etapa, depois da homologação com a conta na Zernio.
  **Nenhuma conversa de rede social é inventada ou carregada.**
- `App.tsx`: a Inbox recebe a API de redes (`socialApi`).
- `global.css`: estilo dos ícones (`channel-button`).

### Testes
- `InboxPage.spec.tsx`: **28** (3 novos): ícones das contas ativas; escolher a rede mostra o aviso e voltar ao WhatsApp traz as
  conversas; sem a Zernio configurada, só o WhatsApp.
- Total: **421 testes**, typecheck e build sem erros.

### Pendências
- Conversas do Instagram e do Facebook (DMs) e comentários continuam nas etapas I5 e I6, com homologação da conta Zernio.
  O aviso na tela diz isso.

---

## 2026-11-04 — Auditoria da exclusão de instância (erro "não aceitou o pedido")

**Pedido do dono do produto:** auditar e corrigir o erro ao excluir/atualizar a instância ("O servidor de WhatsApp não aceitou o pedido").

### Achados da auditoria
- O log da API mostrou que a Evolution **respondeu em ~100 ms com erro (502)**. Não foi tempo esgotado nem falta de conexão.
- O código **descartava o status e a resposta** da Evolution. Por isso não havia como saber a causa.
- O ID enviado na exclusão é o gravado na criação, conforme a rota pelo ID do Swagger (DECISOES_TECNICAS, W1). Não foi
  encontrado erro de montagem da rota.
- A causa exata continua **pendente**: depende do status que a Evolution devolve, e ele agora fica registrado (abaixo).

### Corrigido
- `apps/api/src/whatsapp/whatsapp-service.ts`:
  - `deleteInstance` confere a lista do servidor quando a Evolution recusa. Se a instância já não existe lá, a exclusão
    segue no DisparaZap, sem deixar a empresa presa.
  - Se ela ainda existe, nada é apagado no DisparaZap e a tela recebe a mensagem específica: "O servidor de WhatsApp não
    conseguiu excluir a instância agora. Nada foi apagado aqui".
  - `WhatsAppError` passa a guardar o status da Evolution, só para o log.
- `apps/api/src/routes/whatsapp.ts`: registra `whatsapp.exclusao.recusada` com o status recebido, e a exclusão feita com o
  campo `ja_removida_no_servidor`. Não registra chave, URL nem resposta da Evolution.

### Testes
- `whatsapp.spec.ts`: **24** (3 novos). Cobrem a recusa com a instância ainda no servidor (nada apagado, mensagem sem o texto
  da Evolution), a nova tentativa que exclui de vez e a recusa com a instância já removida no servidor.
- `testing/evolution-simulator.ts`: `failNextDelete` (a próxima exclusão responde 500).

### Pendências
- Com o status registrado, confirmar a causa na Evolution real (resposta 4xx/5xx e mensagem de erro do servidor).
  Sem autorização, não há chamada à Evolution real daqui.

---

## 2026-11-04 — Inbox, etapa I1: implementação local com WhatsApp (Evolution simulada)

**Pedido do dono do produto:** "Etapa I1: implementação local da Inbox multicanal", só WhatsApp, testada com a Evolution
simulada, sem tocar no servidor real, sem ativar o recebimento nas instâncias existentes e sem executar P0 a P7.

### Adicionado
- **Banco** (`packages/db/src/schema/inbox.ts`, migration `0007_inbox`):
  - contatos, identidades (número e LID), conversas (modo e versão de controle, responsável, não lidas), mensagens;
  - recibos pendentes, períodos sem recebimento e eventos da conversa;
  - `whatsapp_instances.inbox_enabled_at`.
- **Contratos** (`packages/contracts/src/inbox.ts`): caminhos, rotas do painel, modos de controle (humano, IA, automação,
  aguardando humano, encerrada), situações, filtros, envio e avisos do tempo real.
- **API:**
  - `integrations/ws-client.ts`: cliente WebSocket próprio, só leitura, TLS verificado, recusa 401 reconhecida;
  - `inbox/evolution-events.ts`: consumidor em modo difusão, com:
    - filtro das instâncias autorizadas antes de gravar e conferência do token com o cofre;
    - reconexão com espera crescente e períodos sem recebimento;
    - sem insistir com chave recusada;
  - `inbox/inbox-ingest.ts`: gravação idempotente, eventos fora de ordem, eco do envio, recibos;
  - `inbox/inbox-service.ts`: canais, conversas, histórico, lida, envio idempotente que assume o atendimento, ligar/desligar o
    recebimento, trava das respostas automáticas;
  - `inbox/inbox-bus.ts`: avisos em memória;
  - `routes/inbox.ts`: `/api/internal/inbox/*` e o SSE `/stream`.
- **Variáveis** `INBOX_EVENTS_ENABLED` e `INBOX_ACTIVATION_ENABLED`, **`false` por padrão** (`config/env.ts`,
  `saas/.env.example`).
- **Simulador** (`testing/evolution-simulator.ts`): WebSocket `/ws` como o da Evolution 0.6.1 a 0.7.2, com:
  - só a chave global;
  - entrega só com WebSocket ligado;
  - queda, fechamento, ping e troca de chave;
  - registro do `/instance/connect`.
- **Painel:**
  - menu **Inbox** e página `pages/inbox/InboxPage.tsx`, em três colunas: conversas com filtros, conversa com histórico e
    resposta, detalhes do contato com "Em desenvolvimento" para etiquetas, notas, IA e automações;
  - no celular, uma coluna por vez pelo endereço;
  - `inbox/inbox-api.ts` (HTTP e `EventSource`) e `inbox/inbox-ui.tsx`;
  - botão **"Receber mensagens na Inbox"** em Integrações → WhatsApp, com confirmação, bloqueado até a homologação.

### Alterado
- `whatsapp-provider.ts`: `configureInboxEvents`. O `startConnection` mantém a configuração de eventos quando a Inbox está
  ligada: reconectar pelo QR Code desligaria a Inbox sem aviso.
- `build-app.ts`: registra a Inbox. O consumidor só existe com `INBOX_EVENTS_ENABLED`.
- `navigation.ts` e `App.tsx`: item e rota `inbox/*`. `IntegrationsPage.tsx` e `WhatsAppPage.tsx`: botão da Inbox por
  instância.
- `ContactsPage.spec.tsx`: um teste pesado (120 linhas) ganhou prazo de 20 s. Ele passava sozinho, mas estourava 5 s com a
  suíte inteira.

### Corrigido
- **Migration `0007_inbox`:** o `drizzle-kit` gerou as chaves estrangeiras compostas antes dos índices únicos de que dependem,
  e a migration falhava.
  - Era uma transação só, então nada ficou pela metade, e o banco local estava íntegro (conferido numa cópia).
  - A ordem foi corrigida à mão, como na `0004`, testada numa cópia do banco local e aplicada pela API de desenvolvimento.
- **Envio pela Inbox** voltava marcado como repetido (200) na primeira vez; agora responde 201.

### Segurança
- A empresa vem sempre da sessão. Conversa de outra empresa ou de outro atendente responde 404, e o visualizador recebe 403.
- **A chave global só sai na conexão de saída:**
  - a URL do WebSocket nunca vai para o log;
  - o token de cada instância só é lido do cofre.
- **Evento de instância desconhecida** (MVP, outros sistemas) **é descartado antes de gravar ou avisar.**
- **Texto e número das mensagens não vão para o log.** O SSE só leva ids.
- O painel nunca fala com a Evolution.
- Mídia: o base64 do evento é descartado.

### Testes
- `apps/api/src/inbox/inbox.spec.ts`: **48**.
- `apps/web/src/pages/inbox/InboxPage.spec.tsx`: **25**.
- `db.spec.ts` e `App.spec.tsx` atualizados.
- **Total: 415 testes em 28 arquivos.** Todos passam, assim como `npm run typecheck` e `npm run build`.
- Nenhum serviço real, nenhuma credencial real, nenhuma mensagem real.

### Documentação
- `saas/docs/ESTRUTURA_TECNICA.md`: seção 16 e testes.
- `saas/docs/DECISOES_TECNICAS.md`: D-52 a D-55.
- `saas/docs/PLANO_MODULO_INBOX.md`: andamento e limitações.
- `saas/docs/HOMOLOGACAO_I0_EVOLUTION.md`: seção 10, com a homologação H1 a H7 e o que falta para a produção.
- `docs/DISPARAZAP_MASTER.md`, `CLAUDE.md` e `saas/README.md`.

### Verificação
- A API de desenvolvimento aplicou a `0007` e segue respondendo.
- Com as duas chaves em `false`, ela **não abriu conexão com a Evolution real**: nenhum `inbox.recebimento` no log.
- **Incidente sem dano:** um vigia antigo do `npm run dev:api`, deixado pelo assistente numa tarefa encerrada, continuou vivo.
  Ele tentou abrir uma segunda API a cada alteração, e a trava da D-51 recusou todas as vezes.
  - O encerramento desse processo pelo assistente foi bloqueado pela verificação de permissões.
  - Fica para o dono do produto fechar.

### Pendências
- Homologação H1 a H7, cada passo com autorização específica.
- Para a produção: migration `0007` e as duas chaves, só com autorização.
- Próximas etapas: mídias (I2, depende da N5) e etiquetas, notas e situações (I3).

---

## 2026-11-03 — Inbox, etapa I0: homologação controlada da Evolution Go (sem serviço real)

**Pedido do dono do produto:** validar os requisitos da Inbox no WhatsApp, sem implementar. Decisões N1 a N8 aprovadas:
- N5 passa a priorizar armazenamento privado de objetos;
- N6 fica sujeita a validação jurídica.

### Documentação
- **Novo:** `saas/docs/HOMOLOGACAO_I0_EVOLUTION.md`, com:
  - as 10 verificações;
  - compatibilidade do WebSocket e eventos;
  - reconexão e perda de mensagens;
  - segurança da chave global e estratégia de conexão;
  - testes feitos e procedimentos P0 a P7 para autorização;
  - recomendação para a I1.
- **Atualizado:** `saas/docs/PLANO_MODULO_INBOX.md`:
  - situação e decisões aprovadas;
  - **correções:** mensagens do celular chegam como `Message` com `IsFromMe`, e o `SendMessage` é o eco dos envios pela API;
  - conexão recomendada em modo difusão, com filtro.

### Principais achados
- **Versão do servidor:** nunca foi registrada no projeto. Fica pendente (P1, leitura do Swagger com autorização).
- **WebSocket:** nas 4 versões publicadas (0.6.1 a 0.7.2), o `/ws` aceita **só a chave global**.
  - Um token errado é **gravado em texto puro no log da Evolution**.
  - A chave vai na URL, e pode ir para logs de proxy (P0).
- **`/instance/connect`** numa instância em execução aplica `subscribe` e WebSocket **sem desconectar** (pelo código).
- **Falha da Evolution no modo por instância:** a remoção da conexão antiga pode apagar a nova, e a conexão fica "muda". O modo
  difusão não tem a falha.
- **Ambiente isolado:** não existe. A homologação será por instância de teste com número de teste.

### Testes
- Prova local (script temporário, fora do projeto, nenhum serviço real): servidor WebSocket mínimo no formato da Evolution e o
  cliente nativo do Node 24.
- **7 de 7 verificações OK:** recusa da chave errada, evento lido, queda percebida e reconexão.
- Sem dependência nova.

### Verificação
- Nenhum código, banco, instância, configuração da Evolution, variável de ambiente ou mensagem alterado ou enviado.

### Pendências
- **Autorização dos procedimentos P0 a P7** (P0 e P1 antes de tudo).
- **Aprovação da I1.**

---

## 2026-11-03 — Auditoria e plano do módulo Inbox (sem código)

**Pedido do dono do produto:** "Etapa 01", auditoria e planejamento da Inbox multicanal em três colunas (WhatsApp, Instagram,
Facebook e demais canais com suporte comprovado), preparada para Agentes de IA, Automações e vários atendentes.

### Documentação
- **Novo:** `saas/docs/PLANO_MODULO_INBOX.md`, com:
  - diagnóstico da arquitetura, das permissões e das integrações;
  - matriz de compatibilidade dos canais (10 redes);
  - proposta das três colunas (e do celular);
  - camada de conversas, fluxos de recebimento e envio, distribuição entre atendentes;
  - estados de controle para IA e automações;
  - segurança e LGPD;
  - etapas I0 a I9, riscos e decisões N1 a N8.
- **Fontes:**
  - código-fonte e wiki oficial da Evolution Go (repositório público `evolution-foundation/evolution-go`, 0.7.2), lidos sem
    tocar no servidor real;
  - documentação oficial da Zernio (OpenAPI 1.450.2 e páginas de inbox de cada rede), sem chave.

### Principais achados
- **Recebimento:** o DisparaZap ainda não recebe nada (sem webhooks, fila, tempo real ou tabela de conversas).
- **Evolution Go:**
  - entrega eventos por **WebSocket** que parte da API (funciona sem HTTPS), mas **exige a chave global** (a documentação local
    diz o contrário) e não reenvia;
  - as instâncias atuais foram conectadas **sem assinatura de eventos**;
  - não há histórico guardado;
  - a mídia chega em base64.
- **Zernio:**
  - Instagram e Facebook com mensagens diretas completas e **janela de 24 h** (fora dela, só humano com `HUMAN_AGENT` até
    7 dias);
  - TikTok só responde, com restrições;
  - X sem conversas criptografadas e com custo;
  - LinkedIn, YouTube e Threads só comentários; Google Business só avaliações; Pinterest nada.
- **Equipe:** papéis atuais cobrem administrador e atendente; **não há supervisor nem convites**. Vários atendentes dependem do
  módulo de membros.

### Verificação
- Nenhum código, banco, migration, variável de ambiente ou serviço alterado; nenhuma chamada a servidor real.

### Pendências
- Aprovação do plano e decisões N1 a N8.
- Primeira etapa recomendada: **I0** (homologação só de leitura, com autorização), seguida de **I1** (base da Inbox com
  WhatsApp).

---

## 2026-11-03 — Módulo Redes Sociais (S1 a S5, S7 e biblioteca de imagens) e incidente do banco local

**Pedido do dono do produto:** "pode criar as funcionalidades conforme o seu planejamento" (aprovação do
`saas/docs/PLANO_MODULO_REDES_SOCIAIS.md`, com as recomendações R1 a R10).

### Adicionado
- **Página Redes Sociais** (`/redes-sociais`), com as abas:
  - **Visão Geral:** contas e situação, publicadas, agendadas, com falha e rascunhos; próximas publicações; alertas;
    desempenho de 30 dias; fuso horário da empresa.
  - **Criar publicação:**
    - redes: Instagram (feed, carrossel e Story), Facebook (publicação e Story), LinkedIn, Threads, Pinterest (título, link e
      pasta), Google Business e X (aviso de custo);
    - texto por rede, regras de cada rede ao vivo e prévia aproximada;
    - publicar agora (com confirmação), agendar ou salvar rascunho; editar rascunho e agendada.
  - **Calendário:** mês, semana e dia no fuso da empresa; filtros; detalhes; reagendar.
  - **Histórico:** filtros e busca; motivo da falha em português; link do post; tentar de novo; cancelar; remover da rede.
  - **Biblioteca:** as imagens da empresa (as mesmas do Envio de Mensagens), com busca pelo nome, envio e exclusão.
  - **Resultados:** 7, 30 ou 90 dias; totais; por rede, com "—" onde a rede não informa; publicações com mais
    engajamento.
  - **Interações:** "em desenvolvimento".
- **API `/api/internal/social/*`:** visão geral, contas, pastas do Pinterest, publicações (criar, ler, editar, reagendar, excluir,
  tentar de novo, remover da rede), fuso, métricas e biblioteca.
  - A empresa e o papel vêm da sessão; a origem é verificada; o limite é de 30 alterações/min por empresa.
- **Adaptador da Zernio:** presign + envio do arquivo (sem a chave), posts com `Idempotency-Key` e resposta 207, listagem
  incremental (`updatedSince`), métricas e pastas do Pinterest.
  - O cliente HTTP passou a aceitar `PUT`/`PATCH` e corpo binário e a devolver os cabeçalhos (`Retry-After`).
- **Banco** (migration `0006_social`, aplicada automaticamente só no banco embutido):
  - `app.social_posts` (espelho das publicações);
  - `identity.organizations.timezone` (padrão `America/Sao_Paulo`);
  - `app.media_files.file_name`;
  - `app.zernio_connections.posts_synced_at`.
- **Contratos:** `social.ts` (regras de cada rede, entrada e saída, mensagens fixas por categoria de erro, métricas por rede)
  e `timezone.ts` (fuso só com `Intl`).
- **Zernio simulada:** posts, armazenamento, nova tentativa, remoção, listagem, métricas, pastas e falhas por rede ou rota.
- **Testes:** 24 da API, 7 dos contratos e 13 do painel, mais 1 do banco. **Total: 342 testes em 26 arquivos.**

### Alterado
- O menu **Redes Sociais** passa a "Disponível".
- O selo de cada rede virou o componente comum `PlatformBadge` (Integrações e Redes Sociais).
- `POST /api/internal/media` aceita `?name=` (nome do arquivo para a busca da biblioteca).

### Corrigido / Segurança
- **Incidente no banco de desenvolvimento** (`saas/.data/pglite`):
  - **Causa:** duas APIs de desenvolvimento, iniciadas pelo assistente em sessões diferentes, abriram o mesmo banco ao mesmo
    tempo. A segunda abria o banco antes de falhar na porta. Depois de reinícios automáticos, o banco não abriu mais
    ("could not locate a valid checkpoint record").
  - **Recuperação, com autorização do dono do produto:**
    - cópia de segurança antes de tudo;
    - `pg_resetwal` do PostgreSQL 18 portátil (pacote oficial, sem instalar nada no Windows), numa cópia;
    - conferência das contagens: 2 usuários, 2 empresas, 2 instâncias, a integração Zernio, listas e modelos;
    - `REINDEX` sem erros;
    - troca da pasta.
  - **O que ficou guardado:**
    - a pasta danificada, em `saas/.data/pglite-danificado-2026-11-03` (ignorada pelo git);
    - a cópia original, na pasta temporária do assistente.
  - **O que pode ter se perdido:** alterações feitas no painel em 2026-11-03 depois das 10h58.
  - O pacote baixado foi apagado depois.
- **Proteção:** o banco embutido agora só abre com a trava `saas/.data/pglite.lock` (PID do processo).
  - Outra API viva → mensagem "outra API já está usando o banco embutido", sem tocar nele (DECISOES_TECNICAS D-51).

### Verificação
- `npm test` (342/342), `npm run typecheck` e `npm run build` aprovados.
- API de desenvolvimento no ar com o banco recuperado e a migration `0006` aplicada.
- Uma segunda API foi recusada pela trava, como esperado.

### Pendências
- **Homologação real** pelo dono do produto, com a conta Zernio dele:
  - primeiro a Visão Geral (só leitura);
  - depois 1 publicação e 1 agendamento de teste numa rede dele.
- **Próximas etapas:**
  - vídeo (S6), conferindo o endereço do armazenamento da Zernio;
  - webhooks e interações (S8), depois da publicação com HTTPS;
  - arrastar no calendário.
- **Commit:** nada foi para o git; só com a aprovação do dono do produto.

---

## 2026-11-03 — Auditoria e plano do módulo Redes Sociais (sem código)

**Pedido do dono do produto:** transformar o item **Redes Sociais** do menu num módulo completo (visão geral, criar publicação,
calendário editorial, biblioteca de mídia, histórico, resultados e interações), começando só por auditoria e planejamento.

### Documentação
- **Novo:** `saas/docs/PLANO_MODULO_REDES_SOCIAIS.md`, com:
  - arquitetura atual, multiempresa e a integração Zernio existente;
  - matriz das funções da Zernio por rede (9 redes), com endpoints, restrições, fontes e divergências da documentação;
  - o que reutilizar, adaptar e criar; proposta de interface e arquitetura técnica;
  - plano em etapas S0 a S8; riscos; decisões R1 a R10.
- **Fonte:** só documentação pública da Zernio, lida em 2026-11-03 (especificação OpenAPI **1.450.2**, páginas das redes,
  comparativo, ciclo de vida do post, limites e preços), sem chave e sem chamar a API de nenhuma conta.
- **Atualizados:**
  - `saas/docs/REFERENCIA_ZERNIO.md`: conferida na 1.450.2, com ponteiro para a seção B do novo plano;
  - `saas/docs/PLANO_MODULO_ZERNIO.md`: etapa Z-P aponta para o novo plano;
  - `docs/DISPARAZAP_MASTER.md`: módulo Redes sociais e pendência Z-P;
  - `CLAUDE.md`: tabela de documentos.

### Principais achados
- **Agendamento:** a Zernio agenda de forma nativa, sem fila própria. Ela também publica na hora, guarda rascunhos e edita e
  cancela agendados. Tentar de novo só refaz as redes que falharam.
- **Mídia:**
  - precisa estar em endereço público HTTPS;
  - a Zernio não tem biblioteca consultável;
  - a mídia não usada some quando o post é excluído. A biblioteca precisa ser do DisparaZap.
- **Lacunas no DisparaZap:**
  - não existe fuso horário por empresa;
  - não existe forma de uma pessoa atuar em várias empresas (agência);
  - a política de segurança do painel publicado bloqueia mídia de outros endereços.
- **Webhooks** só depois da publicação com HTTPS; até lá, sincronização incremental (`updatedSince`).

### Verificação
- Nenhum código, banco, migration ou serviço alterado. Nenhuma chamada à Zernio com chave.

### Pendências
- Aprovação do plano e respostas às decisões R1 a R10.
- Primeira etapa recomendada: **S1**, a Visão Geral só de leitura, sem migration.

---

## 2026-11-03 — Auditoria do login e do logout (porta 3000)

**Relato do dono do produto:** senha recusada no Super-Admin e outros usuários; ao sair, a página fechava mas a sessão continuava ativa.

### Causas encontradas
- **Origem recusada (configuração):** a API só aceita pedidos vindos do endereço em `AUTH_BASE_URL` (5173). O painel agora roda na 3000, então login e logout voltavam com `Invalid origin` (403) e a senha nem era conferida. O `saas/.env` não tinha sido alterado (última gravação em 01/11).
- **Logout falso (bug de código):** o painel saía da tela mesmo quando o servidor recusava o logout. A sessão antiga continuava válida no servidor e voltava ao abrir a página.

### Corrigido
- Sair só limpa a sessão depois da confirmação do servidor. Se o servidor recusar, a pessoa continua logada e vê o aviso no cabeçalho.
- Teste novo: logout recusado mantém a sessão e mostra o aviso.

### Pendências
- Ajustar `AUTH_BASE_URL` no `saas/.env` é recomendado para deixar a configuração coerente, mas já não é obrigatório em desenvolvimento.
- Testar o login com o Super-Admin depois dessa troca. Se a senha for recusada com a origem aceita, a senha cadastrada é diferente da digitada.
- **Correção aplicada:** fora de produção, a API passa a aceitar o painel de desenvolvimento (`http://127.0.0.1:3000` e `localhost:3000`) mesmo que o `AUTH_BASE_URL` do `.env` aponte para outro endereço. Em produção, nada muda. Sem isso, o logout e o login ficavam recusados até editar o `.env`.
- Verificações: SaaS 298/298, typecheck e build aprovados.

---

## 2026-11-03 — MVP removido: o sistema passa a ser só o SaaS

**Pedido e confirmação do dono do produto:** o MVP (disparador local na porta 3000) serviu para construir o disparador. Como o
disparador já está no SaaS, com as funções do MVP e mais, o sistema deve ficar só com o SaaS.

### Removido da raiz
- `index.html`, `server.js`, `phone.js`, `tests/`, `package.json`, `package-lock.json` e `.env.example` (todos do MVP).
- `node_modules/` da raiz (dependências só do MVP).
- **Preservado antes de remover:** cópia em `backup/mvp-removido-2026-11-03/` (ignorada pelo git, conferida byte a byte) e
  histórico nos commits `908ca2f`, `32e84e8` e `d936402`.
- **Não tocado:** o `.env` da raiz (local, não versionado; pode ser apagado por você quando quiser) e `doc_evolution_go.md`
  (referência da API, usada pelo SaaS).

### Alterado
- `CLAUDE.md`: o projeto passa a ser único. Saíram as seções de stack, variáveis, execução, arquivos, funções, decisões e bugs
  do MVP. Ficaram o guia de conexão da Evolution Go (passos 1 a 4) e a seção "Ao fazer mudanças", agora só para o SaaS.
- Regra "MVP e SaaS são separados" substituída por "Projeto único".

### Verificação
- SaaS: 295/295 testes, typecheck e build aprovados, sem nenhuma dependência de arquivo da raiz (checado antes de remover).
- O pacote da Hostinger já não tinha o MVP (só `saas/` entra no pacote).

### Pendências
- **Instâncias criadas pelo MVP:** se alguma ainda estiver em uso, ela precisa ser cadastrada pelo SaaS (decisão W6). Remover o
  código do MVP não apaga instâncias no servidor Evolution.
- **Commit:** as remoções ainda não estão em commit; o commit só com a sua aprovação.
- **Dois comandos no SaaS:** `dev:api` e `dev:web` continuam separados; pode ser unificado depois.

---

## 2026-11-02 — WhatsApp (Evolution Go) passa para a página Integrações

**Pedido do dono do produto:**
- levar a integração com a Evolution Go, que estava na página WhatsApp, para a página **Integrações**;
- cards na ordem **WhatsApp, Zernio, API**;
- a integração da Evolution Go logo **abaixo dos cards**.

### Alterado
- **Página Integrações, de cima para baixo:**
  - cards na ordem WhatsApp → Zernio → API e webhooks (MyLinksss), com os links "Ver instâncias" (`#whatsapp`) e
    "Ver redes sociais" (`#zernio`);
  - seção **"WhatsApp · Evolution Go"**, com as mesmas instâncias, QR Code, pareamento, desconectar, excluir, a tabela
    do Super-Admin e as mesmas regras;
  - depois, a Zernio.
- **Conta sem empresa (Super-Admin da plataforma):** vê a tabela do WhatsApp de todas as empresas e um aviso de que a Zernio
  é de cada empresa.
- **Menu:** o item **"WhatsApp" saiu**.
  - O endereço antigo `/whatsapp` leva a `/integracoes#whatsapp`, e a tela rola até a seção.
  - Os links do Envio de Mensagens ("Crie e conecte uma em Integrações") apontam para lá.
- **Código:**
  - `WhatsAppPage` virou o componente `WhatsAppIntegration` (mesmo arquivo, que continua exportando `formatPhone`);
  - o item Integrações do menu descreve as duas conexões.

### Verificações
- SaaS 295/295 (duas vezes seguidas), typecheck e build ok; MVP 42/42.
- **Testes atualizados:**
  - o WhatsApp abre pelo endereço antigo e cai na seção;
  - a ordem dos cards e das seções;
  - o menu com 9 itens;
  - Super-Admin sem empresa.
- Demonstração com a Zernio simulada: página na ordem pedida, sem erros.

---

## 2026-11-02 — Integrações: redes já conectadas em verde, com "Conectado" e ✓

**Pedido do dono do produto:** para não repetir o erro de conectar a mesma conta duas vezes, os cards das redes já
conectadas devem ficar em outra cor (verde), com a etiqueta "Conectado" e um ícone ✓.

### Alterado
- **Card de rede conectada no perfil do DisparaZap:**
  - verde, com a etiqueta **"✓ Conectado"** e o nome da conta;
  - o botão vira **"Outra conta"**, com confirmação: "Você já tem … conectado. Para renovar a mesma conta, use Reconectar…".
- **Card que precisa reconectar:** âmbar, com "Precisa reconectar"; o botão do card já **reconecta** a mesma conta.
- **Rede conectada em outro perfil da conta Zernio:** o card avisa ("Já conectado na sua conta Zernio em outro perfil
  ("Default"): conectar aqui conta como mais uma rede") e pede confirmação antes de conectar.

### Verificações
- 3 testes novos do painel (cores, etiqueta e ícone; confirmação de outra conta; aviso de outro perfil; reconectar pelo
  card).
- SaaS 295/295; MVP 42/42.

---

## 2026-11-02 — Zernio: diagnóstico na conta real e total pela lista de contas

**Autorização:** o dono do produto colou no chat uma chave da conta Zernio dele e pediu para o assistente olhar a conta.
- **Uso:** só leitura (`/v1/usage`, `/v1/profiles`, `/v1/accounts`). Nada foi alterado na conta.
- **A chave não foi gravada em nenhum arquivo:** passou só por variável de ambiente, e a busca confirmou que não está em
  arquivo nenhum.
- **Ela ficou no histórico do chat:** a recomendação é revogá-la.

### Diagnóstico confirmado
- **O mesmo Instagram está conectado duas vezes:**
  - no perfil "Default", pelo início guiado da Zernio;
  - no perfil "DisparaZap — empresa", pelo painel.
- **A Zernio conta 2 de 2 redes grátis**, por isso pediu cartão para o TikTok, também no painel dela.
- Ter 2 chaves de API não consome vaga: a cobrança é por rede conectada.

### Corrigido
- **O `/v1/usage` respondeu `connectedAccounts: 0` com 2 redes ativas.**
  - O total da conta passa a vir de `GET /v1/accounts?status=connected`, sem perfil, que respondeu 2.
  - A resposta da API agora traz `outsideAccounts`: rede, @ e nome do perfil das redes fora do perfil do DisparaZap.
  - O aviso amarelo do painel lista essas redes, ex.: "Instagram @… — perfil "Default"".
  - A Zernio simulada passou a responder 0 no `/v1/usage`, como a real.

### Verificações
- SaaS 292/292 (duas vezes seguidas). Typecheck e build ok.
- MVP 42/42.
- A consulta nova, conferida só com leitura na conta real, respondeu 2.

### Ação na conta real (pedido explícito do dono do produto)
- **Cópia desconectada:** o assistente desconectou a cópia do Instagram no perfil "Default" (`DELETE /v1/accounts/{id}`).
  - Antes, o script conferiu: o perfil padrão sem `externalId`, exatamente 1 cópia nele e a conexão do perfil do DisparaZap
    presente.
  - Resultado: a conta Zernio ficou com **1 rede conectada**, o Instagram no perfil "DisparaZap — (empresa do dono do produto)".

### Pendências
- **Dono do produto:**
  - conectar o TikTok pelo DisparaZap;
  - revogar a "Chave padrão" que foi colada no chat. O DisparaZap usa a outra chave.

---

## 2026-11-02 — Zernio: total de redes da conta inteira na tela; testes do painel estáveis

**Relato do dono do produto:** no painel da Zernio aparece só o Instagram dele. Mesmo assim, o painel da própria Zernio pediu
cartão para conectar o TikTok.

### Diagnóstico
- **O log da API registrou a recusa:** `motivo: free_tier_exceeded · limite: 2 · contas: 2`. A Zernio conta **2 redes** na
  conta dele.
- **O DisparaZap cria um perfil próprio** na conta Zernio da empresa ("DisparaZap — empresa", decisão Z4). O painel da Zernio
  mostra um perfil por vez.
- **Explicação mais provável:** o Instagram está conectado **duas vezes**. Uma vez no início guiado da Zernio, no perfil
  padrão, e outra pelo DisparaZap, no perfil do DisparaZap. Cada conexão conta.
- **Ainda falta o dono do produto confirmar.**

### Adicionado
- **Total da conta inteira:**
  - a lista de redes conectadas traz `teamAccountCount`, o total da conta Zernio em todos os perfis, lido em `GET /v1/usage`
    (o mesmo número que a Zernio usa na cobrança);
  - o painel mostra "Na sua conta Zernio inteira (todos os perfis): N redes conectadas. As 2 primeiras são grátis…";
  - quando há rede fora do perfil do DisparaZap, aparece um aviso em amarelo com a orientação de desconectar a cópia;
  - se a Zernio não informar o total, a lista sai mesmo assim.
- **Mensagens e log:** a mensagem de `free_tier_exceeded` explica que a mesma rede em dois perfis conta duas vezes, e o log da
  recusa passa a dizer a rede que se tentava conectar.

### Corrigido
- **Testes do painel instáveis na suíte inteira:** quando rodavam junto com os da API, a espera padrão de 1 s às vezes acabava
  antes da tela (um teste diferente falhava a cada vez). Agora há `apps/web/vitest.setup.ts` com espera de 5 s. A suíte
  inteira passou 3 vezes seguidas.

### Verificações
- SaaS 292/292 (3 vezes seguidas). Typecheck e build ok.
- MVP 42/42.
- O pacote da Hostinger foi gerado de novo.

---

## 2026-11-02 — Zernio: mensagem certa para cada pedido de pagamento (402)

**Relato do dono do produto:** no teste real (Z2), o Instagram dele conectou. Ao conectar outra rede, o painel mostrou a
mensagem geral "A Zernio pediu pagamento ou cartão…", embora o plano grátis permita 2 redes.

### Causa (documentação oficial, especificação 1.444.0, resposta `PaymentRequired`)
- **A Zernio responde 402 por 4 motivos (`reason`):**
  - `free_tier_exceeded`: a **conta Zernio inteira** já tem as 2 redes grátis. A contagem inclui redes conectadas direto no
    painel da Zernio e em outros perfis.
  - `twitter_passthrough`: **o X exige cartão desde a primeira conta.**
  - `card_verification_required`: o cartão cadastrado precisa de verificação.
  - `enterprise_required`: o contrato empresarial atingiu o limite.
- **A resposta traz também os números:** `free_tier_account_limit` e `current_account_count`.
- **O DisparaZap descartava tudo isso** e mostrava a mesma mensagem para os quatro casos.

### Corrigido
- **Adaptador:** guarda o `reason` da Zernio (só códigos curtos), além dos `details`.
- **API:**
  - responde **402 "Pagamento necessário"**, com uma mensagem própria para cada motivo e os números da Zernio (ex.: "permite 2
    redes conectadas na conta Zernio inteira, e a sua já tem 2");
  - o motivo vai para o log do servidor (`zernio.recusa`: tipo, status, código, motivo, limite e contas), sem chave nem dado
    pessoal.
- **Painel:** nesses avisos aparece o link **"Abrir a cobrança na Zernio"**, que abre a página oficial em outra aba. O endereço
  é fixo no código (`ZERNIO_BILLING_URL`); nenhum endereço que veio da Zernio é usado.
- **Zernio simulada:** regras de cobrança ligáveis nos testes (X sem cartão; mais de 2 redes sem cartão).

### Verificações
- SaaS 290/290 (novos: 1 da API com os quatro motivos e o log; o teste do painel confere o link). Typecheck e build ok.
- MVP 42/42.
- A API de desenvolvimento do dono do produto reiniciou com a correção.

### Pendências
- **Z2:** com a correção, o painel diz qual motivo a Zernio deu. Se for `free_tier_exceeded`, confira no painel da Zernio
  quantas redes a conta tem (todas contam).

---

## 2026-11-02 — Integração com a Zernio (Z1): página Integrações, conta Zernio por empresa e conexão de redes

**Pedido do dono do produto:** "Pode executar assim", aprovando o [plano](../saas/docs/PLANO_MODULO_ZERNIO.md) com as decisões
recomendadas Z1 a Z7. Ele também pediu para usar agentes e skills.

### Como foi feito
- **API, banco, adaptador e simulador:** feitos pelo assistente principal.
- **Telas do painel:** feitas em paralelo por um agente com o mesmo contexto. Os dois trabalharam em arquivos separados, sobre
  os contratos escritos antes.
- **Revisão automática** (skill de revisão de código, nível alto): 10 apontamentos.
  - 7 corrigidos (abaixo).
  - 2 eram da documentação, atualizada aqui.
  - 1 é sugestão de reaproveitar código entre módulos, deixada para depois.
  - A skill de revisão de segurança não serviu: ela compara commits, e as mudanças ainda não estão em commit.

### Adicionado
- **Banco (migration `0005_zernio`):** `app.zernio_connections`, uma por empresa.
  - Guarda o perfil na Zernio, o nome da conta, a situação (ativa ou recusada) e a última verificação.
  - A chave fica cifrada no cofre (`platform.integration_credentials`, `provider='zernio'`, `kind='api_key'`).
- **Contratos** (`packages/contracts/src/zernio.ts`): caminhos, as 9 redes da etapa (decisão Z5) com nomes e avisos,
  situação, contas, conexão e volta.
- **Adaptador** (`apps/api/src/integrations/zernio-client.ts`):
  - endereço fixo `https://zernio.com/api/v1`, TLS verificado, sem seguir redirecionamentos, tempo-limite;
  - erros classificados por status, `type` e `code` em motivos fixos;
  - leitura tolerante das respostas;
  - rotas: `/auth/verify`, `/profiles`, `/connect/{platform}`, `/accounts`, `/accounts/health` e
    `DELETE /accounts/{id}`.
- **Serviço e rotas** (`apps/api/src/zernio/`, `/api/internal/integrations/zernio`): situação, salvar, trocar e remover a
  chave, redes conectadas, conectar e reconectar, volta da autorização e desconectar.
  - A chave é testada na Zernio antes de ser guardada.
  - O perfil "DisparaZap — empresa" é criado ou reaproveitado pelo `externalId` (decisão Z4).
  - A volta leva um **comprovante assinado** (subchave do cofre, empresa + usuário + rede + 15 minutos), e as contas são
    relidas na Zernio.
  - **Só o dono e os administradores alteram** (decisão Z3).
  - **Limites por empresa:** chave 10/min; conectar, voltar e desconectar 30/min. O papel é conferido antes: quem não pode
    alterar não gasta o limite.
- **Cofre:** `vault.sign()`, HMAC-SHA256 com subchave HKDF por finalidade.
- **Zernio simulada** (`apps/api/src/testing/zernio-simulator.ts`, fora do build), nos formatos oficiais.
  - Simula a pessoa autorizando ou cancelando na rede.
  - Inclui a resposta "vazando" contas de outros perfis.
- **Painel:**
  - página **Integrações** com catálogo: Zernio, WhatsApp (atalho) e API/MyLinksss "Em desenvolvimento";
  - cartão da Zernio: passo a passo, chave, resumo, trocar e remover;
  - grade das redes com avisos, e tabela das redes conectadas com situação, reconectar e desconectar;
  - página de volta `/integracoes/zernio/retorno`;
  - o menu Integrações passa a "Disponível".

### Corrigido pela revisão
- **Situação da chave na tela desatualizada:** ler as redes pode mudar a situação guardada (recusada ↔ ativa). Agora a tela relê
  a situação depois das redes.
- **Duas gravações da chave ao mesmo tempo:** dava erro interno. Agora insere, ou trava a linha e troca a chave.
- **Código de erro com nome especial na volta** (`constructor`, `__proto__`): quebrava a resposta. Agora só valem as chaves
  do próprio mapa.
- **Conta sem perfil informado** passava como da empresa. Agora só contam as contas do perfil da empresa, também ao
  reconectar e desconectar.
- **Chamada extra à Zernio** nas conferências de conta. Agora só a tela pede a saúde das contas.
- **Botão Voltar do navegador** depois de "Conectar" deixava os botões travados. Agora são destravados quando a página é
  restaurada do cache.
- **`API_TRUST_PROXY` (afeta o pacote da Hostinger):** com `true`, o `X-Forwarded-For` só vale quando quem conecta é um
  endereço interno (loopback ou rede privada).
  - Também aceita a lista exata de IPs/CIDRs do proxy.
  - Antes, quem chegasse direto na porta podia escolher o próprio IP e escapar dos limites de login e cadastro.
- **Chave guardada que não abre mais** (chave-mestra trocada): virou uma mensagem pedindo para cadastrar de novo, em vez de
  erro interno.

### Verificações
- **SaaS: 289/289 testes (23 arquivos).** Typecheck, build e `db:check` aprovados.
- **MVP: 42/42.**
- **Demonstração ponta a ponta** (API real com a Zernio simulada, banco temporário, dados fictícios):
  - chave salva e ausente da página;
  - Instagram e LinkedIn conectados pela volta;
  - Facebook com "não administra nenhuma Página";
  - LinkedIn "Precisa reconectar";
  - celular de 390 px sem rolagem lateral;
  - nenhum erro de JavaScript.
- **Servidores de desenvolvimento do dono do produto:** a API reiniciou sozinha e criou a tabela nova no banco local.

### Pendências
- **Z2, homologação real com a conta Zernio do dono do produto** (autorizada).
  - Com o servidor de desenvolvimento, a volta é para `http://127.0.0.1:5173`, então funciona nesta máquina.
  - Gere de novo o pacote da Hostinger antes de publicar (`npm run pacote:hostinger`).
- **Publicar e agendar** (Z-P) e webhooks da Zernio (precisam de endereço público).
- **Reaproveitar o tratamento de erros das rotas** entre módulos (sugestão da revisão).

---

## 2026-11-02 — Integração com a Zernio: documentação oficial e plano (sem código)

**Pedido do dono do produto:**
- criar o sistema de **Integrações** com a Zernio (<https://zernio.com/>);
- cada conta (empresa) configura **a própria conta e a chave de API da Zernio** e conecta as redes sociais que quiser.

### Pesquisa (só leitura da documentação oficial; sem cadastro, sem chave, sem chamada autenticada)
- Dois agentes leram, em paralelo, o site, a documentação e a especificação OpenAPI 3.1 (versão 1.444.0) da Zernio.
- **O que ela é:** API de redes sociais (publicar, agendar, analisar, inbox, webhooks).
- **Modelo multiempresa:** um perfil por cliente, com `externalId`.
- **Conexão das redes:** link de autorização com volta para o painel; não é preciso criar aplicativos na Meta ou no TikTok.
- **Cobrança:** por conta de rede conectada; as 2 primeiras são grátis.
- **Webhooks:** HMAC-SHA256 do corpo bruto.

### Documentação
- **`saas/docs/REFERENCIA_ZERNIO.md` (novo):** resumo da documentação oficial, com links, nas partes que o DisparaZap
  usa.
  - Atende à regra de ter a documentação da Zernio no repositório antes de planejar (AUDITORIA_INICIAL, ARQUITETURA
    §5.4).
  - Registra as divergências entre o guia e a especificação.
- **`saas/docs/PLANO_MODULO_ZERNIO.md` (novo), aguardando aprovação:**
  - **Telas:** página Integrações com catálogo; cartão da Zernio com a chave e a conexão das redes; volta da
    autorização.
  - **Segurança:** chave no cofre; endereço fixo da Zernio; comprovante assinado na volta; erros como motivos fixos.
  - **Dados:** migration `0005_zernio`, com uma ligação por empresa e as contas lidas na hora.
  - **Técnica:** adaptador próprio em vez do SDK; simulador e testes.
  - **Etapas:** Z0 a Z3, e publicação (Z-P) depois.
  - **Decisões:** Z1 a Z7, com recomendações.
- **DISPARAZAP_MASTER:** a Zernio sai de "fora do primeiro MVP SaaS" (decisão de 2026-10-31) a pedido do dono do
  produto, no modelo de conta própria por empresa.
- **ARQUITETURA_SAAS §5.4:** aponta para a referência e o plano.

### Pendências
- **Aprovação do plano e das decisões Z2 a Z7** antes de qualquer código.
- Homologação com a conta Zernio do dono do produto (Z2), só depois da Z1.

---

## 2026-11-01 — Pacote para a Hostinger (aplicativo Node.js do hPanel)

**Pedido do dono do produto:** preparar a "pasta dist" para publicar na Hostinger.

**Escolhas do dono do produto** (perguntadas):
- **Hostinger:** hospedagem com hPanel e aplicativo Node.js (Business ou Cloud). A VPS fica para depois.
- **Banco:** Supabase.
- **Cadastro:** aberto (`AUTH_SIGNUP_ENABLED=true`). O risco ficou registrado no passo a passo.

### Pesquisa (documentação oficial da Hostinger, só leitura)
- Node.js 18, 20, 22 e 24.
- A Hostinger recebe um arquivo compactado, roda o `npm install` e inicia um "Entry file".
- A porta vem em `PORT`.
- Os arquivos são trocados a cada publicação.
- Não há terminal para rodar comandos.

### Adicionado
- **A API pode entregar o painel** (`plugins/web-panel.ts`), ligado só com `WEB_DIST_DIR`:
  - o painel é lido para a memória na inicialização; cada pedido recebe só um arquivo da lista, por comparação exata do
    caminho;
  - rotas do painel (ex.: `/contatos/123`) recebem o `index.html`;
  - mapas de código-fonte, arquivos ocultos e caminhos de API ficam fora;
  - política de conteúdo (CSP) no HTML;
  - cache longo nos arquivos com hash; `no-cache` no `index.html`;
  - ETag com resposta 304.
- **`API_TRUST_PROXY`:** atrás do proxy da Hostinger, o IP do visitante vem do `X-Forwarded-For`, confiando só em 1 salto.
  Sem isso, todos os visitantes teriam o mesmo IP e os limites de login e de cadastro seriam divididos por todos.
- **HSTS** em produção.
- **`saas/infra/hostinger/`:**
  - `server.js`: entrada na Hostinger (porta, painel e certificado do banco com caminho relativo);
  - `empacotar.mjs` (`npm run pacote:hostinger`): gera `saas/deploy/hostinger/` e `disparazap-hostinger.zip`:
    - API e pacotes internos compilados, com os imports internos trocados por caminhos relativos (sem workspaces no
      servidor);
    - dependências reais nas versões instaladas, com `package-lock.json`;
    - o painel sem mapas de código-fonte;
    - o certificado do banco, se estiver em `saas/certs/`;
    - recusa `.env`, chaves privadas e mapas de código-fonte;
  - `producao.mjs`:
    - `npm run producao:segredos`: gera os dois segredos no terminal;
    - `npm run producao:migrar`: aplica as migrations no Supabase a partir do seu computador. Mostra só o servidor e
      pede que se digite `APLICAR`;
    - `npm run producao:admin`: cria o Super-Admin;
  - `env.hostinger.example`: modelo das variáveis, só com placeholders;
  - `README.md`: passo a passo; vai no pacote como `LEIA-ME.md`.

### Alterado
- O painel liga o modo `jitless` do Zod (`apps/web/src/zod-setup.ts`, primeiro import). Sem ele, o teste de `eval` do
  Zod gerava um aviso de CSP no console. O `zod` passou a ser dependência declarada do painel, na mesma versão.
- `.gitignore` do SaaS: `deploy/` e `certs/`.

### Verificações
- **Testes do SaaS: 255/255 (21 arquivos).** Novos: 16 em `web-panel.spec.ts`.
- Typecheck e build aprovados; MVP 42/42.
- **Ensaio do pacote nesta máquina,** com banco embutido temporário e dados fictícios:
  - `npm ci --omit=dev`, como na Hostinger, em 29 s;
  - sem variáveis, a API recusa subir e lista o que falta;
  - Super-Admin criado pelo `producao.mjs`;
  - `/health/ready` ok;
  - login no painel, Contatos com importação de planilha e Envio de Mensagens funcionando sob a CSP;
  - mapa de código-fonte e rota de API desconhecida em 404;
  - console do navegador sem bloqueios (só o 401 esperado da verificação de sessão antes do login).

### Pendências
- **Conferir no servidor real:**
  - a publicação na Hostinger e a conexão com o Supabase são feitas pelo dono do produto;
  - o certificado do Supabase com o Session pooler só é verificado de verdade nessa hora.
- **Supabase:** papéis separados (`dz_migrator`, `dz_app`) e RLS ainda não aplicados (SUPABASE_CONFIGURACAO).
- **Worker:** fica fora até existirem filas.

---

## 2026-11-01 — Publicação no GitHub

**Pedido do dono do produto:** fazer o commit e enviar o projeto para o repositório `Sinvaldo-Oliveira/disparazap` no GitHub.

### Alterado
- **Commit da Fase 5 até aqui:**
  - autenticação;
  - integração global com a Evolution Go;
  - módulo WhatsApp;
  - Envio de Mensagens com imagem, CTA e modelos;
  - página Contatos;
  - documentação.
- Remoto `origin` acrescentado e branch `main` enviada com o histórico (`908ca2f`, `32e84e8`, `d936402` e este commit).
- `CLAUDE.md` e `docs/DISPARAZAP_MASTER.md` deixam de dizer "repositório só local". A decisão de 2026-10-31 fica no histórico
  de decisões.

### Segurança (antes do envio)
- **Fora do repositório (`.gitignore`):** `.env`, `saas/.env`, `backup/`, o banco embutido `saas/.data/`, `node_modules/` e
  `dist/`. Nenhum `.env` aparece no histórico.
- **Varredura dos 176 arquivos e dos commits anteriores:** URLs, e-mails, telefones, IPs e sequências parecidas com chaves.
  - Só apareceram exemplos, documentação pública e números fictícios de teste.
  - O e-mail do autor aparece apenas nos metadados dos commits (configuração do git), não no conteúdo.
  - Os `.env` não foram abertos.
- **Testes antes do commit:** SaaS 239/239, typecheck e build aprovados; MVP 42/42.

---

## 2026-11-01 — Página Contatos: gestão das listas, criação e busca

**Pedido do dono do produto:** criar a página **Contatos** do painel, onde toda lista salva possa ser gerenciada, onde dê para
**criar listas** e com **campos de busca**.

### Adicionado
- **Painel, menu Contatos** (deixa de ser "Em desenvolvimento"):
  - **`/contatos`, listas da empresa:**
    - resumo com o número de listas (de 100), o total de contatos e a última alteração;
    - **busca** que filtra as listas pelo nome (sem diferenciar acentos nem maiúsculas) e, a partir de 2 caracteres, procura
      **contatos em todas as listas** (nome ou parte do telefone);
    - cada resultado leva à lista certa, já filtrada pelo número;
    - **Nova lista:** só o nome; depois abre a página da lista para adicionar os contatos;
    - excluir lista com confirmação (exclusão definitiva).
  - **`/contatos/:id`, gestão de uma lista:**
    - renomear e excluir;
    - **adicionar contatos à mão ou por planilha do Excel** (o mesmo componente do Envio de Mensagens), **salvos na hora**;
    - tabela com **busca por nome ou telefone**, 50 contatos por página;
    - **editar** nome e telefone de um contato (mesma regra de telefone);
    - **remover** um contato ou vários selecionados, com confirmação.
  - Quem só visualiza vê e busca, sem botões de alteração. Conta sem empresa vê um aviso.
- **API (`/api/internal`), uma alteração por vez:**
  - `PATCH /contact-lists/:id`: renomear;
  - `POST /contact-lists/:id/contacts`: acrescentar no fim. Telefone validado de novo; repetidos e números já na lista ficam de
    fora; respeita o limite de 10.000. A resposta diz quantos entraram e por que os outros não;
  - `PATCH /contact-lists/:id/contacts`: alterar nome e telefone de um contato;
  - `POST /contact-lists/:id/contacts/remove`: remover os escolhidos (até 1.000 por pedido), de vez;
  - `GET /contacts/search?q=`: busca em todas as listas da empresa, até 50 resultados.
  - Cada alteração trava a lista durante a transação, para duas pessoas não se atrapalharem.
  - Limites: 30 gravações em lote e 120 alterações de contato avulso por minuto por empresa.
- **Contratos:** caminhos, entradas e respostas novas em `packages/contracts/src/messaging.ts`.

### Alterado
- `ContactAdder` (`apps/web/src/messaging/ContactAdder.tsx`): a parte "Manual / Excel" saiu do `ContactsStep` para um
  componente comum, usado no Envio de Mensagens e na página Contatos.
- A etapa Contatos do Envio de Mensagens ganhou o link "use a página Contatos" para buscar, editar ou organizar as listas.
- O topo do painel mostra o nome do módulo também nas subpáginas (ex.: "Contatos" em `/contatos/:id`).

### Segurança
- **Empresa sempre da sessão:** lista de outra empresa responde 404 em todas as rotas novas.
- **Papéis:** `owner`, `admin` e `operator` alteram; `viewer` só lê e busca.
- **Telefones fora de URLs e do log:**
  - o número vai sempre no corpo do pedido;
  - na busca, a query string não é registrada (o log grava só o caminho);
  - entre as páginas do painel, o número vai no estado da navegação, não no endereço.
- Os curingas `%` e `_` digitados na busca valem como texto comum.

### Verificações
- **Testes do SaaS: 239/239 (20 arquivos).** Novos:
  - API: 7 (acrescentar sem repetir, renomear, editar com 400/409/404, remover de vez, busca com curingas, isolamento A×C e viewer,
    limite de 10.000 ao acrescentar);
  - página: 12 (`ContactsPage.spec.tsx`).
- O `App.spec` tem um teste a menos: Contatos saiu da lista de módulos "Em desenvolvimento".
- Typecheck e builds aprovados. Nenhuma tabela nova (`db:check` sem diferenças).
- **MVP: 42/42,** nenhum arquivo do MVP alterado.
- **Demonstração isolada** (API própria em outra porta, banco temporário, dados fictícios):
  - listas, busca em todas as listas, nova lista, seleção e edição na tabela;
  - celular de 390 px sem rolagem lateral.

### Pendências
- **Consentimento e descadastro (D6):** continuam pendentes (Etapa 8).
- **Busca no servidor:** ainda diferencia acentos ("joao" não acha "João"); a busca dentro da lista, no painel, não diferencia.
- **Busca em listas muito grandes:** sem índice de texto. Avaliar `pg_trgm` no Supabase.
- **Exportar lista para Excel:** não pedido; fica como sugestão.

---

## 2026-11-01 — Envio de Mensagens: imagem, CTA e modelos de mensagem salvos

**Pedido do dono do produto:**
- trabalhar o UI/UX da etapa Mensagem;
- deixar três campos, nesta ordem: **upload de imagem**, **mensagem** e **CTA**;
- poder **salvar a mensagem como modelo** no banco, para reutilizar.

**Escolhas do dono do produto** (perguntadas, com o que a Evolution Go permite):
- **CTA como link no fim do texto,** numa mensagem só. O botão clicável da Evolution (`/send/button`, `cta_url`) não aceita imagem
  junto e pode não aparecer em alguns aparelhos.
- **1 imagem por mensagem,** com o texto como legenda.

### Pesquisa (só leitura; nenhum acesso ao servidor)
- **Swagger da versão instalada:**
  - `/send/media` `{ number, type, url, caption, filename }`;
  - `/send/button` com botões `reply`, `copy`, `url`, `call` e `pix`, e as regras de combinação.
- **Código-fonte público:**
  - em `/send/media`, um `url` que não começa com http(s) é lido como **base64 puro**: a imagem pode sair do nosso banco, sem
    endereço público;
  - formatos aceitos: JPEG, PNG e WebP;
  - um "data:…;base64," seria recusado;
  - a imagem de cabeçalho do botão só vale para botões de resposta.

### Adicionado
- **Banco (migration `0004_templates`):**
  - `app.media_files`: imagem em `bytea`, tipo conferido, tamanho, sha256, empresa;
  - `app.message_templates`:
    - nome único por empresa;
    - texto, variações (`jsonb`) e imagem, com chave composta: só imagem da mesma empresa;
    - CTA (texto e link juntos ou nenhum).
- **API:**
  - `POST /api/internal/media`:
    - o corpo é o próprio arquivo, até 5 MB;
    - o tipo é conferido pelos primeiros bytes, não pelo que o navegador declara;
    - o mesmo arquivo não duplica;
    - até 200 imagens por empresa;
  - `GET /api/internal/media/:id`: só a empresa dona, para a pré-visualização;
  - `GET/POST /api/internal/message-templates` e `PUT/DELETE /api/internal/message-templates/:id`:
    - CTA validado (só http/https, sem espaços);
    - até 100 modelos por empresa;
  - `POST /api/internal/messaging/send` aceita `mediaId`: a API manda a imagem em base64 para `/send/media`, com o texto (já com o
    CTA) como legenda. As imagens mais usadas ficam em memória durante o disparo.
- **Adaptador:** `sendImage` (`/send/media`, `type: image`, 60 s de tempo-limite); as falhas são classificadas como as do texto.
- **Contratos:** `composeMessage` e `ctaLine`. O texto final, com a linha `👉 Texto: link`, é montado num lugar só, e a
  pré-visualização mostra exatamente o que será enviado.
- **Painel, etapa Mensagem redesenhada:**
  - **à esquerda, o editor:**
    - **Modelo salvo:** escolher, salvar, salvar alterações, excluir, com confirmação antes de descartar alterações;
    - **1 Imagem:** arrastar ou clicar; trocar ou remover;
    - **2 Mensagem;**
    - **3 CTA:** texto e link;
    - **Variações (Teste A/B);**
  - **à direita, pré-visualização ao vivo** num celular estilo WhatsApp: imagem, texto formatado, link destacado, uma bolha por
    variação.
  - O resumo da etapa 5 mostra "Imagem + Texto + CTA".
  - Abaixo de 960 px, o editor e a pré-visualização ficam um embaixo do outro.

### Verificações
- **Testes do SaaS: 221/221.** Novos:
  - API: 6 (imagem verdadeira e falsa, mais de 5 MB, isolamento, modelos com CTA validado, envio com imagem em base64 puro);
  - página: 3 (ordem dos campos e pré-visualização, salvar e carregar modelo, disparo com imagem e CTA).
- Typecheck e builds aprovados; sem `jsxDEV`.
- **Demonstração isolada** (Evolution simulada, imagem desenhada pelo próprio navegador, contatos fictícios):
  - modelo carregado;
  - 3 imagens recebidas pela Evolution simulada, sem prefixo `data:` e com o CTA na legenda;
  - token e chave global fora do HTML.
- **Migration 0004:** o `drizzle-kit` gerou de novo a chave estrangeira composta antes do índice. A ordem foi corrigida antes de a
  API de desenvolvimento aplicá-la no banco local.

### Pendências
- **Envio real com imagem:** testar com um número do dono do produto. O código-fonte não mostra limite de tamanho no servidor
  Evolution.
- **Imagens sem uso:** ainda não há limpeza automática (há só o limite de 200 por empresa).
- **Botão clicável:** opção futura. Exige título e rodapé e não aceita imagem junto.

---

## 2026-11-01 — Envio de Mensagens no painel e correções do WhatsApp vistas no uso real

**Pedido do dono do produto:**
- criar no menu o botão "Envio de Mensagens", depois de "Campanhas";
- trazer para dentro do painel o disparador do MVP (`http://localhost:3000`), no modelo SaaS;
- cada empresa com as suas instâncias e as suas listas de contatos salvas, sem ver as das outras.

**Uso real que antecedeu o pedido:**
- O dono do produto criou instâncias reais pelo painel (uma em cada uma de duas contas do banco local) e conectou números.
- Nos prints, a página mostrava "Conectando" e sem número, enquanto o gerenciador da Evolution mostrava "Conectado".
- Nenhuma instância foi criada nem mensagem enviada pelo assistente. O MVP não foi alterado e não houve commit.

### Corrigido (módulo WhatsApp)
- **Status preso em "Conectando":**
  - **Causa:** o código foi digitado no celular depois dos 2 minutos em que o painel acompanha a conexão, e a lista mostrava só o
    último status gravado.
  - **Correção:** as listas (empresa e Super-Admin) consultam `GET /instance/all` numa chamada só e gravam o status atual.
    - Se a Evolution estiver fora do ar, aparece o último status conhecido.
    - Fora da conexão em andamento, "não conectado" vira "Desconectado".
- **Número não aparecia:**
  - **Causa:** o `/instance/status` não traz o número. O código-fonte da Evolution Go confirma: `StatusStruct` tem `Connected`,
    `LoggedIn` e `Name`.
  - **Correção:** o número vem do `jid` de `/instance/info/{id}` (no acompanhamento da conexão) e de `/instance/all` (nas listas).
- **Leitura das respostas conferida no código-fonte da Evolution Go** (repositório público, sem tocar no servidor):
  - QR em `data.qrcode`/`data.code`: a imagem é a que começa com `data:image/`;
  - pareamento em `data.PairingCode`;
  - envio em `data.Info.ID`.
- **Simulador dos testes** passou a responder nesses formatos. Os testes antigos passavam com um `myJid` que o servidor real não
  manda.
- **"Conectar" chamado duas vezes** em desenvolvimento (efeito duplo do React): o painel trava a segunda chamada.
- **Página WhatsApp:** o aviso "envio pelo painel nas próximas etapas" virou um link para Envio de Mensagens.

### Adicionado (Envio de Mensagens)
- **Menu:** "Envio de Mensagens" depois de "Campanhas", disponível (`/envio-de-mensagens`). Campanhas continua reservado para os
  disparos no servidor, com fila.
- **Assistente de 5 etapas, portado do `index.html` do MVP:**
  1. **Instância:** só as da empresa, com status atualizado. Precisa estar conectada. **O token fica no servidor:** o campo de
     token do MVP não existe mais.
  2. **Contatos:**
     - listas salvas da empresa (escolher, salvar, salvar alterações, excluir);
     - adicionar à mão com a regra de telefone do MVP;
     - importar Excel com detecção de cabeçalho e de colunas, pré-visualização e motivo das linhas ignoradas.
  3. **Mensagem:** `{nome}`, contador, pré-visualização com *negrito*/_itálico_/~riscado~ e variações (Teste A/B).
  4. **Intervalo:** mínimo e máximo, aviso abaixo de 5 s e estimativa de duração.
  5. **Disparar:**
     - resumo e confirmação;
     - "Parar" (inclusive no meio do intervalo);
     - barra de progresso e log (até 500 linhas);
     - resumo final e "Iniciar novo disparo".
- **Banco (migration `0003_messaging`):**
  - `app.contact_lists`: nome único por empresa, sem diferenciar maiúsculas;
  - `app.contacts`: um número por lista, `CHECK` de só dígitos, chave composta `(organization_id, list_id)`;
  - exclusão definitiva (contato é dado pessoal);
  - limites: 10.000 contatos por lista e 100 listas por empresa.
- **API:**
  - `GET/POST /api/internal/contact-lists`;
  - `GET/PUT/DELETE /api/internal/contact-lists/:id`;
  - `POST /api/internal/messaging/send`.
- **Regras da API:**
  - empresa e papel vêm da sessão; lista ou instância de outra empresa responde 404;
  - dono, administrador e operador salvam e enviam; quem só visualiza só vê;
  - o telefone é validado de novo no servidor;
  - o envio usa o token cifrado da instância e devolve só um motivo fixo, nunca a resposta da Evolution:
    - **interrompe o disparo:** `instance_disconnected` e `instance_unauthorized`;
    - **o disparo segue:** `invalid_number`, `unreachable` e `failed`;
  - limites de tentativas: 60 envios por minuto por instância e 30 gravações de lista por minuto;
  - número e texto das mensagens não vão para o log.
- **Peça comum `apps/api/src/auth/member.ts`:** "quem está agindo" (empresa e papel da sessão), usada pelo WhatsApp e pelo Envio de
  Mensagens.
- **Regra de telefone (`packages/contracts/src/phone.ts`):** voltou a devolver `code` e `reason`, como a do MVP, para resumir as
  linhas ignoradas da planilha.
- **Dependência:** SheetJS `xlsx` 0.20.3 no painel, do endereço oficial (o mesmo do MVP).
  - É carregado só quando alguém importa uma planilha, num arquivo separado de 492 kB.
  - O painel principal passou de 408 kB para 453 kB.
  - O `npm audit` não acusa nada novo.

### Decisão (tomada pelo assistente, pedido do dono do produto)
- **O disparo roda na aba do navegador, como no MVP:** uma chamada à API por mensagem.
  - Fechar ou sair da página interrompe o envio. A tela avisa disso, e fechar a aba pede confirmação.
- **Disparos que continuam com a página fechada,** com fila, histórico e agendamento, ficam para o módulo **Campanhas** (etapa 9),
  que precisa de fila (D5).

### Verificações
- **Testes do SaaS: 212/212** (19 arquivos). Novos:
  - API do Envio de Mensagens: 16;
  - página Envio de Mensagens: 12;
  - planilha: 4;
  - formatação da mensagem: 3;
  - WhatsApp: mais 4 (sincronização da lista e leitura das respostas).
- Typecheck e builds aprovados; sem `jsxDEV`; o simulador fica fora do build de produção (`apps/api/src/testing`).
- MVP: 42/42, arquivos sem alteração.
- **Demonstração isolada** (banco temporário, portas 3200/5174, Evolution simulada, contatos fictícios):
  - lista salva carregada;
  - pré-visualização;
  - disparo de 5 contatos: 4 enviados e 1 número recusado, sem interromper;
  - página WhatsApp com "Conectado" e o número.
  - O token e a chave global não aparecem no HTML; nenhum processo ficou aberto.
- **Banco local do dono do produto:** a migration `0003` foi aplicada pela API de desenvolvimento ao reiniciar.
  - Uma primeira versão gerada pelo `drizzle-kit` criava a chave estrangeira composta antes do índice único que ela usa.
  - A transação foi desfeita sem alterar nada, e a ordem foi corrigida antes de valer.

### Pendências
- **Teste com envio real:** pelo painel, para um número de teste do dono do produto, quando ele quiser.
- **Campanhas no servidor:** fila, histórico, agendamento e envio com a página fechada.
- **Contatos:** consentimento e descadastro (D6). A página Contatos continua "Em desenvolvimento"; as listas ficam dentro de
  Envio de Mensagens.

---

## 2026-11-01 — Módulo WhatsApp das empresas (etapas W1, W2 e W4) e correções da auditoria do login

O dono do produto aprovou o `saas/docs/PLANO_MODULO_WHATSAPP.md` com todas as recomendações ("aprovado continuar"):
- **W1:** 1 instância por empresa;
- **W2:** dono e administradores gerenciam, os demais só veem;
- **W3:** leitura do Swagger do servidor real autorizada;
- **W4:** homologação real autorizada para depois, no momento que o dono escolher;
- **W5:** o Super-Admin vê todas as instâncias, só leitura;
- **W6:** as instâncias do MVP não são tocadas;
- e mais as correções A1, A3, A4 e A5 da auditoria do login.

Tudo foi feito dentro de `saas/`; o MVP não foi alterado. **Nenhuma instância real foi criada**, nenhuma mensagem foi enviada e
não houve commit.

### W1 — Rotas confirmadas no Swagger da versão instalada
- **Só leitura do documento `/swagger/doc.json` do servidor:** nenhuma chave enviada, nada criado. Versão declarada: "1.0".
- **Confirmado:**
  - `POST /instance/create` `{ name, token, instanceId?, advancedSettings?, proxy? }`, com a chave global;
  - `POST /instance/connect` `{ webhookUrl, subscribe, immediate, phone, … }`;
  - `GET /instance/qr`;
  - `POST /instance/pair` `{ phone, subscribe }`;
  - `GET /instance/status`;
  - `GET /instance/all`.
- **Diferenças em relação ao `doc_evolution_go.md`:**
  - **desconectar existe:** `DELETE /instance/logout` (a documentação não mostrava). Há também `POST /instance/disconnect` e
    `POST /instance/reconnect`;
  - **excluir é pelo ID:** `DELETE /instance/delete/{instanceId}`, não pelo nome.
- **Respostas não tipadas no Swagger** (`gin.H`): o adaptador lê os campos com tolerância (camelCase ou PascalCase) e recusa
  formatos inesperados.
- **ARQUITETURA_SAAS §5.2:** nova coluna "Swagger da versão instalada" na tabela de verificação.

### Adicionado (W2, contra a Evolution simulada)
- **Banco (migration `0002_whatsapp`):**
  - esquema `app` e tabela `app.whatsapp_instances`;
  - status por `CHECK`;
  - nome técnico obrigatoriamente com prefixo `dz_`, único por servidor;
  - chave composta `(organization_id, id)`;
  - exclusão lógica;
  - coluna `max_whatsapp_instances` em `identity.organizations` (padrão 1, de 0 a 100).
- **Adaptador `WhatsAppProvider` (`apps/api/src/integrations/whatsapp-provider.ts`):**
  - implementação para a Evolution Go com as rotas confirmadas na W1;
  - mesmo cliente HTTP da integração global: TLS verificado, sem redirecionamentos, 15 s de tempo-limite, até 1 MB;
  - erros reduzidos a 5 tipos com mensagem fixa;
  - o QR só é aceito se for uma imagem (`data:image/…`);
  - se a Evolution não devolver o ID na criação, ele é buscado em `/instance/all`.
- **Serviço (`apps/api/src/whatsapp/whatsapp-service.ts`):**
  - **criar:** nome técnico `dz_<empresa>_<aleatório>` e token próprio de 32 bytes guardado **cifrado** no cofre
    (`instance_token`, com o ID da instância no contexto). Se o banco falhar depois da criação, a instância é excluída na
    Evolution e nada fica pela metade;
  - **conectar por QR**, **código de pareamento** (número validado pela regra de telefone do MVP, portada para
    `packages/contracts`), **status** (número tirado do `myJid`), **desconectar** e **excluir** (exclusão lógica e token
    revogado);
  - o QR e o código **nunca são gravados** no banco nem no log.
- **Rotas `/api/internal/whatsapp/instances`** (listar, criar, conectar, QR, parear, status, desconectar e excluir):
  - empresa sempre tirada da sessão;
  - instância de outra empresa responde 404;
  - owner e admin gerenciam; operator e viewer só leem;
  - verificação de origem;
  - limites de tentativas: QR 60/min por instância, pareamento 5 a cada 10 min, criação 10/hora por empresa.
- **Super-Admin:** `GET /api/internal/platform/whatsapp/instances`, com todas as instâncias e a empresa de cada uma, só leitura.
  Sem empresa, ele não usa as rotas das empresas (403).
- **Contratos (`packages/contracts`):** `whatsapp.ts` (caminhos, status, esquemas) e `phone.ts` (regra de telefone).
- **Painel, página WhatsApp:**
  - cartões das instâncias com status e número, e o contador "n de limite";
  - "Nova instância";
  - painel de conexão com abas QR Code (imagem renovada a cada 3 s, até 2 minutos) e Código de pareamento (código exibido como
    `ABCD-1234`);
  - desconectar com confirmação; excluir exigindo digitar o nome;
  - aviso de integração ausente ou desativada;
  - quem só visualiza não vê botões;
  - tabela do Super-Admin.
  - No menu e na Visão Geral, o WhatsApp passou de "Em desenvolvimento" a "Disponível".
  - Para o Super-Admin sem empresa, o subtítulo da página fala de "todas as empresas", não de "sua empresa".

### Segurança — correções da auditoria do login
- **A1:** `/api/auth/get-session` e `/api/auth/list-sessions` foram desligadas, porque devolviam o token da sessão. Além disso, a
  rota `/api/auth/*` retira o campo `token` do primeiro nível das respostas JSON (ex.: a do login).
- **A3:** o cadastro aceita no máximo 10 tentativas a cada 10 minutos por IP; a 11ª recebe 429.
- **A4:** em desenvolvimento, `http://localhost:<porta>` passa a ser origem confiável junto com `127.0.0.1`. Em produção, só a
  lista configurada vale.
- **A5:** as rotas de convite do plugin de organizações foram desligadas até existir verificação de e-mail.

### Corrigido
- **`DELETE` com corpo vazio:**
  - **Erro:** o cliente do painel enviava `content-type: application/json` sem corpo, e o Fastify respondia 400;
  - **Correção:** o cabeçalho agora só vai quando há corpo.
- **Teste de migrations:** a contagem esperada deixou de ser fixa e passou a vir do `_journal.json`.
- **Primeiro teste do `build-app.spec.ts`:** sozinho leva cerca de 1 s, mas estourava 5 s com a suíte inteira em paralelo.
  - **Correção:** aquecimento num `beforeAll`;
  - o tempo-limite global não mudou.

### Verificações
- **Testes do SaaS: 173/173** (15 arquivos), em duas execuções seguidas. Novos:
  - rotas do WhatsApp: 17;
  - tela do WhatsApp: 9;
  - auditoria do login: 4.
- Typecheck e builds aprovados; o bundle não contém `jsxDEV`.
- MVP: 42/42, arquivos sem alteração.
- **Demonstração isolada** (banco temporário, portas 3200/5174, Evolution simulada, QR ilustrativo):
  - lista;
  - QR Code;
  - "Conectado" com o número;
  - tabela do Super-Admin.
  - O token da instância e a chave global não aparecem no HTML; nenhum processo ficou aberto.

### Pendências
- **W3, homologação real:**
  - criar 1 instância de teste no servidor real, conectar um número de teste do dono do produto, conferir o status, desconectar
    e excluir;
  - **só no momento que o dono do produto autorizar.**
- **Webhooks da Evolution:** exigem a API num endereço público (VPS); até lá, o status é consultado periodicamente.
- **Adiado:**
  - ajuste do limite de instâncias pelo Super-Admin na tela;
  - adoção das instâncias do MVP;
  - envio de mensagens pelo painel.
- **Isolamento no banco:** o RLS entra com a conexão ao Supabase. Hoje o isolamento é garantido pela API e pelos testes A×B.

---

## 2026-11-01 — Plano do módulo WhatsApp das empresas

Pedido do dono do produto: planejar o módulo em que cada empresa (Admin-Empresa e Admin-MyLinksss) cria as próprias instâncias e
conecta os números por QR Code ou código de pareamento. **Só planejamento:** nenhum código, nenhuma migration, nenhum acesso à
Evolution Go real.

### Documentação
- **Novo `saas/docs/PLANO_MODULO_WHATSAPP.md`:**
  - escopo, fluxo das telas e regras de segurança;
  - tabela `app.whatsapp_instances` e adaptador `WhatsAppProvider`;
  - rotas, testes e etapas W1 a W4;
  - decisões W1 a W6 para o dono do produto.
- **`docs/DISPARAZAP_MASTER.md`:** pendência do módulo aponta para o plano.

### Constatações
- `doc_evolution_go.md` não mostra rota de desconectar (logout) e usa nomes diferentes para o webhook na criação e na conexão.
- A ARQUITETURA §5.2 exige confirmar as rotas no Swagger da versão instalada antes de implementar: o plano trata isso como a
  etapa W1.

---

## 2026-11-01 — Configurações do Super-Admin: integração global com a Evolution Go

Pedido do dono do produto: campos de integração global com a API da Evolution Go na página Configurações do Super-Admin. Essa
conexão será usada pelas contas das empresas (Admin-Empresa e Admin-MyLinksss) para criar instâncias e conectar números. Nenhum
teste tocou na Evolution Go real (simulador local); nenhuma chave real foi lida, copiada ou gravada.

### Adicionado
- **Banco:**
  - migration `0001_platform`, com o esquema `platform`;
  - `integration_credentials`: cofre com valores cifrados, vetor, etiqueta, versão da chave e 4 últimos caracteres;
  - `provider_servers`: servidor da Evolution Go, já preparado para vários.
- **Cofre de credenciais (`apps/api/src/security/vault.ts`):**
  - AES-256-GCM com chave-mestra `SECRETS_MASTER_KEY` fora do banco;
  - contexto autenticado (`evolution_go:global_api_key`);
  - dado adulterado ou chave trocada nunca abre.
- **Teste de conexão (`apps/api/src/integrations/evolution-client.ts`):**
  - `GET /instance/all` com a chave global (a mesma chamada do MVP), só leitura;
  - TLS sempre verificado, sem seguir redirecionamentos, com tempo-limite;
  - devolve só um resultado fixo e a contagem de instâncias.
- **Rotas `/api/internal/platform/evolution` (GET, PUT e `POST /test`), só para o Super-Admin:**
  - a chave nunca volta na resposta;
  - trocar a chave revoga a anterior;
  - mudar o endereço ou a chave zera o último teste;
  - a ação fica registrada no log, sem a chave.
- **Proteção de origem nas rotas `/api/internal/*` que alteram dados:** exige `Origin` confiável, inclusive no cadastro.
- **Contratos:** caminhos, esquemas e a regra de endereço da Evolution Go.
  - Aceita só http/https, sem usuário/senha, parâmetros ou âncora.
  - Exige https, salvo para esta máquina ou para um nome interno do Docker.
- **Painel, página Configurações do Super-Admin:**
  - cartão "Integração global · Evolution Go" com nome do servidor, URL da API, chave global (campo sempre vazio; mostra só o
    final da chave guardada) e situação ativa/desativada;
  - botões "Salvar integração" e "Testar conexão";
  - situação e último teste;
  - aviso de cofre não configurado.
  - Para os demais tipos de usuário, a página continua "Em desenvolvimento".
- **Configuração:** `SECRETS_MASTER_KEY` no `.env.example`. No `saas/.env`, uma chave aleatória foi gerada sem ser exibida.

### Corrigido
- **Build do painel saía em modo de desenvolvimento:**
  - **Causa:** o `loadEnv` do Vite aplicava o `NODE_ENV=development` do `saas/.env` ao `vite build`.
  - **Correção:** o `vite.config.ts` agora lê só as variáveis `WEB_*` com `util.parseEnv`.
  - **Resultado:** o bundle voltou de 603 kB para 389 kB, sem `jsxDEV`.
  - **Correção de registro:** a entrada da autenticação atribuiu o crescimento ao zod, mas a causa era esta.

### Verificações
- Testes do SaaS: **144/144** (13 arquivos). Novos: cofre 3, contratos da plataforma 13, rotas da plataforma 18, tela de
  Configurações 7.
- Typecheck e builds aprovados.
- Demonstração isolada, com banco temporário, portas 3200/5174 e Evolution simulada:
  - salvar → 200, sem a chave na resposta;
  - testar → "Conectado", 3 instâncias;
  - a chave não aparece no HTML da página.

### Decisão revista
- A ARQUITETURA_SAAS §8.4 previa a chave global da Evolution "somente em segredo do servidor; nunca no banco".
- A pedido do dono do produto, ela passa a ser informada na tela e guardada **cifrada** no banco, com a chave-mestra fora dele
  (a mesma proteção prevista para os tokens das instâncias).
- Registro em DECISOES_TECNICAS D-25.

### Pendências
- **Módulo WhatsApp das empresas:** criar instâncias, QR Code ou pareamento, usando esta integração.
- **Infraestrutura da chave:** cópia de segurança da `SECRETS_MASTER_KEY` e rotação de versão.
- **Registro de auditoria:** tabela `audit_logs` (hoje as ações vão só para o log).
- **Menu:** mostra "Em desenvolvimento" em Configurações também para o Super-Admin.

---

## 2026-11-01 — Super-Admin definido (banco local de desenvolvimento)

Pedido do dono do produto: tornar a conta dele Super-Admin.
- **`saas/.env`:** `SUPER_ADMIN_EMAIL` preenchido com o e-mail do dono do produto (arquivo fora do git; o e-mail não é registrado
  na documentação).
- **Conta:** já existia no banco embutido, criada pelo próprio dono do produto na tela "Criar conta". O `admin:create` não
  promove contas existentes, por segurança. Com o pedido explícito do dono e sendo a única conta do banco local, ela foi
  promovida diretamente (`platform_role = 'super_admin'`). Senha e empresa foram mantidas.
- **Verificado:** novo cadastro com esse e-mail é recusado (409).
- **Atenção:** vale só para o banco local. Ao conectar o Supabase, o Super-Admin precisará ser criado lá (`npm run admin:create`).

---

## 2026-11-01 — Auditoria do login e correção do banco local

Pedido do dono do produto: auditar o login com o Supabase e apresentar a página de login. Sem conexão com o Supabase (não
configurado) e sem usar as chaves do `.env` da raiz.

### Corrigido
- **A API não abria no uso normal:** `npm run dev:api` falhava em projeto recém-baixado. O PGlite não cria as pastas-mãe e
  `saas/.data` não existia.
  - `packages/db/src/client.ts` agora cria a pasta-mãe.
  - A mensagem de erro em `apps/api/src/index.ts` passou a indicar o banco certo (embutido ou PostgreSQL), só com o código do
    erro.
  - Novo teste em `db.spec.ts` (pasta-mãe inexistente e persistência entre aberturas).

### Constatações da auditoria (não corrigidas: aguardam autorização)
- **A1:** `GET /api/auth/get-session` e `GET /api/auth/list-sessions` devolvem o **token da sessão** no corpo. Isso anula a
  proteção do cookie `HttpOnly`.
- **A3:** o cadastro (`/api/internal/signup`) **não tem limite de tentativas**: 15 contas foram criadas em sequência. O login tem
  limite e bloqueia na 11ª tentativa.
- **A4:** abrir o painel por `http://localhost:5173` impede o login (403 "Invalid origin"); só `http://127.0.0.1:5173` é origem
  confiável.
- **A5:** os convites do plugin de organizações funcionam sem verificação de e-mail. Quem criar conta com o e-mail convidado pode
  aceitar o convite.
- **Conferido como correto:** limite no login; empresa não criada pelo navegador; cookie `HttpOnly`, `SameSite=Lax`, 7 dias e
  `Secure` só em produção; cabeçalhos de segurança; página de login no computador e no celular (390 px, sem rolagem lateral).
- **Supabase:** **não conectado** (`DATABASE_URL` vazio no `saas/.env`); o sistema usa o banco embutido.
- **`.env` da raiz:** contém um **token de acesso pessoal do Supabase** (prefixo `sbp_`) e a chave `service_role`, que não são
  usados pelo DisparaZap.

### Verificações
- Testes do SaaS: 103/103; typecheck e build da API aprovados.
- MVP sem alteração.

---

## 2026-11-01 — Autenticação do SaaS: cadastro, login e três tipos de usuário

Pedido do dono do produto: autenticação no modelo SaaS, com três tipos de usuário e telas no estilo de uma imagem de referência.
Tudo dentro de `saas/`; o MVP não foi alterado. Não houve conexão com o Supabase, o MyLinksss ou o Evolution Go, nem commit.

### Decisões (tomadas pelo assistente a pedido do dono do produto, que delegou a escolha técnica)
- **Autenticação (D3):** Better Auth 1.7.15, dentro da API, com sessão em cookie `HttpOnly` guardada no banco.
- **Tipos de usuário:**
  - **Super-Admin:** papel global, sem empresa;
  - **Admin-Empresa:** cadastrado direto no DisparaZap;
  - **Admin-MyLinksss:** empresa que chega pelo MyLinksss.
- **Super-Admin:** o e-mail fica em `SUPER_ADMIN_EMAIL`. A conta é criada pelo comando `npm run admin:create`, com a senha digitada
  no terminal e nunca gravada em arquivo. O e-mail fica reservado: ninguém se cadastra com ele.
- **Banco embutido (PGlite):** usado no desenvolvimento e nos testes, enquanto o `DATABASE_URL` do Supabase não estiver configurado.

### Adicionado
- **`packages/db` (novo):**
  - Drizzle 0.45.4 e esquema `identity` (users, sessions, accounts, verifications, organizations, members, invitations);
  - migration `0000_identity`;
  - conexão PostgreSQL com TLS sempre verificado (`DATABASE_CA_FILE` obrigatório), ou banco embutido com migrations automáticas;
  - `drizzle.config.ts` com TLS verificado.
- **API, autenticação:**
  - Better Auth em `/api/auth/*`;
  - senhas em argon2id (`@node-rs/argon2`);
  - plugin de organizações com os papéis owner/admin/operator/viewer;
  - cadastro direto pela biblioteca desativado;
  - criação de empresa pelo navegador bloqueada;
  - limite de tentativas no login;
  - telemetria desligada.
- **API, rotas:** `POST /api/internal/signup` (conta, empresa e sessão), `GET /api/internal/me` e `GET /health/ready`.
- **Contratos:** caminhos de autenticação, tipos de usuário, esquema do cadastro e da sessão, `healthReadySchema`.
- **Painel:**
  - telas "Entrar" e "Criar conta" no estilo da referência (formulário à esquerda, painel verde com ilustração à direita);
  - rotas protegidas e retorno à página pedida;
  - cabeçalho com nome, tipo de usuário e "Sair";
  - espaço de trabalho no menu;
  - status real do banco;
  - sem login social nem recuperação de senha, que ainda não funcionam.
- **Comandos:** `npm run admin:create` e `npm run db:generate` / `db:check` / `db:migrate`.
- **Configuração:**
  - `.env.example`: `DATABASE_EMBEDDED_DIR`, `AUTH_SECRET`, `AUTH_BASE_URL`, `AUTH_TRUSTED_ORIGINS`, `AUTH_SIGNUP_ENABLED` e
    `SUPER_ADMIN_EMAIL`;
  - `saas/.env`: as chaves que faltavam, com um `AUTH_SECRET` aleatório gerado sem ser exibido;
  - `saas/.gitignore`: `.data/`.

### Segurança
- **Proteção contra requisições de outros sites (origem/CSRF) sempre ligada.** O Better Auth a desliga sozinho em ambiente de teste;
  um teste detectou isso, e a configuração agora força a proteção.
- **Token de sessão:** sai só no cookie `HttpOnly`; a API o remove do corpo das respostas.
- **IP:** usado no limite de tentativas, vem do socket e nunca de um cabeçalho enviado pelo cliente.
- **Campos privilegiados:** `platformRole` e `origin` não são aceitos do navegador. Um teste confirma que atualizar o perfil não
  muda o tipo de usuário.
- **Recusas iguais:** e-mail já usado e e-mail reservado recebem a mesma resposta; senha errada e e-mail desconhecido também.

### Verificações
| Verificação | Resultado |
|---|---|
| Testes do SaaS | **102/102** em 3 rodadas seguidas; nenhum processo de teste remanescente |
| Novos testes | Banco 3, autenticação 20, configuração +5, painel 35 (reescrito) |
| `npm run typecheck` e os quatro builds | Aprovados; o bundle do painel não contém código de servidor nem segredos |
| Teste de ponta a ponta (API + Vite reais, banco temporário) | Cadastro, sessão, sair, login, Super-Admin, e-mail reservado e origem estranha recusada |
| MVP | 42/42; arquivos sem alteração |

### Observações
- **Teste de inicialização da API:** a espera passou de 15 s para 90 s (limite do teste: 120 s).
  - A API agora abre o banco embutido e carrega o Better Auth antes de escutar.
  - Nesta máquina, com a CPU em 100%, isso levou de 20 a 50 s; o teste também passou a conferir `/health/ready`.
- **Bundle do painel:** cresceu de 359 kB para 603 kB (180 kB compactado). Na época, o crescimento foi atribuído ao zod.
  **Diagnóstico corrigido mais tarde, no mesmo dia:** a causa era o build sair em modo de desenvolvimento, e com a correção o
  bundle voltou a 389 kB (ver a entrada da integração com a Evolution Go).
- **`npm audit`:** 1 alerta moderado (GHSA-67mh-4wv8-2f99, servidor de desenvolvimento do esbuild) dentro do `drizzle-kit`,
  ferramenta só de desenvolvimento. A "correção" sugerida rebaixaria o `drizzle-kit` para a 0.18, por isso não foi aplicada.
- **`package-lock.json` da raiz:** está alterado (campo `engines`) por um `npm install` feito fora desta tarefa; não foi mexido.
- **`.env` da raiz:** contém chaves do Supabase (inclusive a `service_role`), um provável token de acesso pessoal e dados do
  Super-Admin do MyLinksss. Nada disso é usado pelo DisparaZap; o dono do produto foi orientado a remover e, se necessário, revogar.

### Pendências
- **Supabase:** conexão (endereço PostgreSQL e certificado no `saas/.env`) e SQL de preparação dos papéis.
- **MyLinksss:** "Entrar com MyLinksss" e verificação da licença do módulo. Depende de como o MyLinksss autentica e expõe a
  licença.
- **Recursos pendentes:** 2FA obrigatório do Super-Admin, recuperação de senha e verificação de e-mail (exigem provedor de
  e-mail), convites e permissões por tipo de usuário.

---

## 2026-11-01 — Campos do Supabase no ambiente do SaaS

Pedido do dono do produto: preparar os campos para cadastrar o Supabase. Nenhuma credencial foi escrita, lida ou copiada.

### Adicionado
- **`saas/.env.example`:** bloco "Banco de dados — Supabase Cloud" com os campos **vazios**, as regras de preenchimento e o
  modelo de endereço com marcadores. Os campos são:
  - `DATABASE_URL`, `DATABASE_PLATFORM_URL`, `DATABASE_MIGRATION_URL`;
  - `DATABASE_TEST_URL`, `DATABASE_TEST_MIGRATION_URL`;
  - `DATABASE_CA_FILE`, `DATABASE_POOL_MAX`;
  - `DATABASE_AUTH_URL`, comentado, só se a autenticação for Better Auth.
- **`saas/.env`:** criado como cópia do modelo. É ignorado pelo git.

### Observações
- Os campos ficam no `saas/.env`, não no `.env` da raiz, que é do MVP: os dois projetos têm ambientes separados.
- O código ainda não lê essas variáveis. A configuração da API e do worker continua válida com o novo arquivo (verificado).
- **Documentação:** `saas/docs/SUPABASE_CONFIGURACAO.md` §3.5 aponta para o modelo.

---

## 2026-11-01 — Fase 5A.2: plano do banco no Supabase Cloud exclusivo

Só planejamento e documentação. Nenhum projeto Supabase criado, nenhuma conexão com banco remoto, nenhuma dependência instalada,
nenhuma migration, nenhum commit. O código da API, do painel, do worker e do MVP não foi alterado, por isso os testes não foram
executados.

### Decisão
- **O PostgreSQL local foi substituído pelo Supabase Cloud** (decisão do dono do produto).
  - É um projeto novo e exclusivo do DisparaZap, separado do MyLinksss.
  - O plano do PostgreSQL local da auditoria 5A.1 (entrada abaixo, mantida como registro) não será executado.

### Documentação
- **Novo `saas/docs/SUPABASE_CONFIGURACAO.md`:**
  - arquitetura aprovada e passo a passo de criação manual (organização separada, região São Paulo, senha, segurança, backups);
  - estratégia de conexão por papel e por uso, e variáveis de ambiente sem valores;
  - modelo multiempresa conceitual;
  - Drizzle;
  - RLS e papéis do Supabase;
  - comparação Supabase Auth × Better Auth;
  - plano de testes, limitações, custos a confirmar e próximas autorizações;
  - fontes oficiais consultadas em 2026-11-01.
- **`saas/docs/DECISOES_TECNICAS.md`:** D-14 (Supabase, aprovada) e as propostas D-15 a D-19 (conexões, papéis e RLS, Drizzle,
  autenticação pendente, testes num projeto de testes).
- **`docs/DISPARAZAP_MASTER.md`:** situação da fase, mapa da documentação, arquitetura alvo, decisões registradas e pendências.

### Constatações relevantes
- **Esta máquina não tem IPv6.** No desenvolvimento, a conexão será pelo pooler no modo sessão, porque a conexão direta do Supabase
  é só IPv6 sem o add-on.
- **Papéis privilegiados:** `postgres` e `service_role` têm `BYPASSRLS`. A aplicação usará papéis próprios, sem esse atributo.
- **Documentos desatualizados:** a ARQUITETURA_SAAS e o PLANO_IMPLANTACAO_HOSTINGER ainda descrevem o PostgreSQL em contêiner e o
  Testcontainers; a atualização deles depende de autorização.

---

## 2026-11-01 — Fase 5A.1: auditoria do ambiente e plano do PostgreSQL local

Somente leitura. Nada foi instalado, iniciado, configurado ou removido. Não houve conexão com nenhum banco, nem commit.

### Documentação
- **`docs/DISPARAZAP_MASTER.md`:** decisões pendentes da Fase 5A.2.

### Constatações
- **PostgreSQL:** **PostgreSQL 17.11 nativo** já instalado em 2026-10-20 (instalador da EDB, com pgAdmin 4).
  - É a versão 17 mais recente: a 17.11 saiu em 2026-08-13.
  - Funciona como serviço do Windows com início automático e está vazio (só os bancos padrão).
  - Autenticação `scram-sha-256` só para `127.0.0.1` e `::1`.
  - Escuta em todas as interfaces (`listen_addresses = '*'`). O `pg_hba.conf` e o firewall impedem conexões de fora.
  - Tem `citext`, `pgcrypto`, `pg_trgm`, `unaccent` e ICU. Não tem `pgvector`.
- **Docker, WSL e Redis:** não instalados. O WSL e a Plataforma de Máquina Virtual estão desativados; a edição Home não tem Hyper-V.
- **Disco:** o disco do sistema tem pouco espaço livre (cerca de 6 GB, quase todo ocupado pelo cache do npm). O segundo disco tem
  bastante espaço, mas é mecânico.
- **Memória:** 16 GB, com pouca memória livre durante o uso normal da máquina.
- **Windows:** Windows 10 22H2. O programa de atualizações estendidas (ESU) para uso pessoal vai até 2027-10-12. O Docker Desktop só é
  suportado nas versões do Windows dentro do calendário de manutenção da Microsoft.

### Plano
- **Recomendação para a 5A.2:** cluster PostgreSQL 17 dedicado ao DisparaZap, usando os binários já instalados.
  - Fora do repositório, só em `127.0.0.1`, numa porta própria.
  - Colação `builtin` `C.UTF-8`, igual em desenvolvimento e produção.
  - Sem serviço do Windows e sem mexer no servidor existente.
- **Docker Compose:** fica para quando houver espaço e suporte. A produção continua com `postgres:17` em contêiner.
- **Pendente:** decisão do dono do produto.

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
