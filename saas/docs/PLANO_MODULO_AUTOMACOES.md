# Plano — Módulo Automações (comentário → DM e fluxos pela Zernio)

**Situação:** aprovado pelo dono do produto em 2026-11-05, com as recomendações A1 a A9 como estão. **Etapas A1, A2 e A3 implementadas** (2026-11-05, testadas com o simulador; trava desligada). Nenhuma chamada real foi feita.

## Andamento

- **A1 (2026-11-05):** lista e detalhe das automações de comentário da empresa, com a conta de cada uma conferida no perfil da empresa; números (ativas, DMs enviadas, cliques); contas com o que cada rede permite; modelos apresentados como "Próxima etapa". Trava `AUTOMATIONS_WRITE_ENABLED` criada (padrão `false`).
  - Ajustes de escopo: a leitura da **atividade** (registros) fica na A4, como na tabela da seção 6; a lista de **fluxos** fica na A5, porque o índice oficial não traz `GET /v1/workflows` (só criar, ativar, pausar e execuções) e não presumimos o endpoint.
  - O formato da resposta de `GET /v1/comment-automations` não está completo na documentação: o cliente aceita `id` ou `_id` e a conta como texto ou objeto, e descarta o que vier sem id ou sem conta. Conferir na H1.
- **A2 (2026-11-05):** Comentário → DM (Instagram e Facebook) e Comentário → resposta pública (TikTok, Threads, LinkedIn e YouTube). Construtor com cartões Quando, Então e Com que frequência, prévia de celular (`{{first_name}}` vira um nome de exemplo), salvar sempre pausada, ativar com confirmação, pausar, editar e excluir com confirmação.
  - Regras por rede no contrato (`automationInputProblem`), iguais na tela e na API. Pelo menos uma palavra-chave (sem ela, a Zernio responderia a qualquer comentário).
  - Sem `Idempotency-Key` documentada para criar: o nome é único por conta, então repetir o pedido não cria outra automação; resultado incerto pede para conferir a lista.
  - Ajustes de escopo: "qualquer publicação" apenas (escolher uma publicação fica para depois); `alsoMatchInDms` sempre `false` e fora da tela (decisão A4); a conta não muda na edição.
  - A confirmar na H2: se a Zernio aceita `commentReply: null` para remover a resposta pública numa edição.
- **A3 (2026-11-05):** Só seguidores e Menção em story → DM, só no Instagram.
  - Só seguidores: cartão Verificação no construtor (mensagem, rótulo do botão e mensagem para quem ainda não segue); envia `audience: { followerStatus: "follower", whenUnknown: "verify" }`, `followGate` e `publicReplyPolicy: "always"`; tirar a verificação numa edição envia `audience: { followerStatus: "any", whenUnknown: "send" }`. A página da automação mostra a verificação e os números dela (`followGateSent`, `followGatePassed`).
  - Menção em story: `trigger: "story_mention"`, sem palavra-chave, sem resposta pública e, por padrão, uma resposta a cada 24 h por pessoa.
  - O gatilho não muda depois de criado; automações com gatilhos criados no painel da Zernio (resposta a story, live) são mostradas, ativadas, pausadas e excluídas, mas não editadas.
  - Divergência: a documentação oficial lista `audience` e `followGate` também para o Facebook; a skill e o plano aprovado dizem só Instagram. Seguimos o plano (só Instagram) até a homologação mostrar o contrário.
- **A5 (2026-11-05):** Link → conversa, só no Instagram. Cria um fluxo de referência (`referral`, ref exato, intervalo de repetição) com mensagem de texto, etiqueta e fim; nasce pausado e ativar ou pausar pede confirmação. O código do link vai na descrição do fluxo (a lista da Zernio não traz o gatilho); o link completo `ig.me/m/<usuário>?ref=…` aparece com botão de copiar. QR code adicionado depois, com a biblioteca `qrcode` aprovada pelo dono (decisão A6, gerado no servidor). Sem a alternativa "envie MENU" (depende de A4). Documentação de `workflows`, `create`, `list`, `pause` e `executions` lida em 2026-11-05; a listagem existe. Decisão D-68.
- **A6 (2026-11-05):** Comentário → perguntar antes do link, só no Instagram. Fluxo com gatilho `comment` (palavras-chave), pergunta em texto, espera de 1440 min e botão com o link só depois da resposta; sem resposta, termina. Nasce pausado. Sem condição (formato não confirmado na documentação). Decisão D-69.
- **A4 (2026-11-05):** atividade no detalhe da automação: quem recebeu, quem foi pulado e por quê (texto fixo por situação), e, para dono e administradores, os comentários que não casaram. Atualiza a cada 15 s enquanto a página está aberta. A regra de repetição já existia (A2); a A4 mostra o efeito dela. Decisão D-70.
- **Próximas (cada uma com aprovação):** a homologação H1 a H3. Etapas do plano concluídas: A1 a A6 (A6 com o QR da A5 e a pergunta antes do link).

**Pedido:** criar, na página **Automações**, um "ManyChat próprio" para cada empresa, usando a Zernio: comentário com palavra-chave gera DM, recompensa só para seguidores, resposta a menção em story, link ou QR que inicia uma conversa, regras de repetição e atividade ao vivo.

**Fontes:**
- skill `white-label-automations` (repositório `Enriquemarq1/zernio-library-skills`, de terceiros, não oficial; revisada e instalada em 2026-11-05);
- documentação oficial lida em 2026-11-05: `guides/manychat-patterns`, `comment-automations/*` (criar, listar, alterar, excluir, registros), `workflows`, `workflows/*` (criar, ativar, pausar, execuções) e `pricing`, em `docs.zernio.com`.

---

## 1. Resumo das descobertas

1. **A Zernio guarda as automações.** Não é preciso tabela nova no DisparaZap: a tela lê e altera direto na Zernio, como já fazemos com as conversas do Instagram. Sem migração.
2. **Duas peças da Zernio fazem tudo:**
   - **Automações de comentário** (`/v1/comment-automations`): palavra-chave → DM, botões, resposta pública, só seguidores, menção em story, regras de repetição e registro de cada disparo;
   - **Fluxos** (`/v1/workflows`): passos em sequência (enviar, esperar resposta, condição, etiqueta), usados para link ou QR e para "perguntar antes".
3. **As redes têm limites diferentes:**
   - **Instagram:** tudo (DM, botões, só seguidores, menção e resposta a story);
   - **Facebook:** DM e botões; sem story;
   - **TikTok, Threads, LinkedIn e YouTube:** só resposta pública ao comentário, sem DM;
   - **X:** não suportado.
4. **Isso envia mensagens reais, automaticamente.** Cada automação ativa responde a pessoas reais sem ninguém clicar. Por isso o plano cria tudo **pausado** por padrão, pede confirmação para ativar e mantém uma trava geral desligada até a homologação.
5. **O conceito atual da página Automações é outro.** O `DISPARAZAP_MASTER` prevê ali campanhas, filas e acompanhamentos no servidor (etapa 9). Este plano acrescenta uma seção "Redes sociais" à página, sem substituir esse plano (decisão A1).

## 2. O que a Zernio oferece (documentação oficial, 2026-11-05)

| Modelo | Peça da Zernio | Redes | Limites principais |
|---|---|---|---|
| Comentário → DM | automação de comentário, `trigger: comment` | Instagram, Facebook | DM até 640 caracteres com botões (cerca de 1.000 sem); 1 a 3 botões, rótulo até 20 |
| Comentário → resposta pública | automação de comentário, só `commentReply` | TikTok (Business), Threads, LinkedIn, YouTube | Campos de DM retornam `400 invalid_field_value` |
| Só seguidores | `audience` + `followGate` | Instagram | Quem nunca falou com a conta recebe primeiro o botão "Estou seguindo" |
| Menção em story | `trigger: story_mention` | Instagram | Sem palavra-chave; toda menção conta |
| Resposta a story | `trigger: story_reply` | Instagram | `alsoMatchInDms` é recusado |
| Link ou QR → fluxo | fluxo com gatilho `referral` | Instagram, Facebook | O Instagram nem sempre repassa o `ref`; alternativa: "escaneie e envie MENU" |
| Comentário → perguntar antes | fluxo com gatilho `comment` + `wait_for_reply` | Instagram, Facebook | Para quem ainda não segue: texto simples primeiro, botões depois |
| Repetição | `repeatPolicy` | Todas | `once` (padrão) ou `every_comment` com espera de 1 a 8.760 h |
| Atividade | `GET .../logs` e `GET /workflows/{id}/executions` | Todas | Situações: `pending`, `sent`, `failed`, `skipped`, `gated` |

**Regras da Meta e da Zernio que valem para todos:**
- cada comentário aceita **uma única resposta privada**: se a automação usar, ela acabou;
- o Instagram **recusa botões** na primeira DM a quem não segue a conta, e mesmo assim gasta a resposta;
- fluxos só enviam até 24 h depois da última mensagem da pessoa;
- comentários chegam por webhook da Zernio para ela mesma, e ela relê os recentes a cada 10 min (não precisamos de webhook);
- criar com `platformPostId` de uma postagem que já tem automação ativa retorna `409`;
- fluxos sem acesso ao inbox retornam `403 INBOX_REQUIRED` (planos antigos).

**Custo:** toda conta inclui todos os recursos; 10.000 mensagens de saída por mês incluídas, depois US$ 1 a cada 10.000. A documentação não diz se as DMs de automação entram nessa cota (a skill de terceiros diz que sim).

**Dados pessoais:** os registros trazem nome e @ de quem comentou, e os "comentários que não casaram" (`misses`) trazem o texto do comentário.

## 3. Regras do DisparaZap que prevalecem sobre a skill

A skill foi escrita para outro modelo (uma agência com uma chave única no `.env`). No DisparaZap:

- **Empresa sempre da sessão.** A chave é a da empresa, cifrada no cofre; o perfil é o da empresa (`zernio-service`, mesmo `scope` da Inbox).
- **Toda leitura, alteração e exclusão confere** se a conta da automação pertence ao perfil da empresa (relida na Zernio). Automação de outra conta responde 404.
- **Erros só como mensagens fixas por categoria.** A tela nunca mostra o texto da Zernio.
- **Log:** nunca o texto de DM, de comentário, nome ou @. Auditoria só com ids e contagens.
- **Testes e demonstrações só com o simulador** (`zernio-simulator.ts`, ampliado). Nenhuma automação real sem autorização.
- **Sem API para agente de IA nem servidor MCP neste plano.** Isso faz parte do módulo "API pública e IA", com plano próprio.

## 4. Proposta de interface

**Página Automações → seção "Redes sociais"** (a parte de campanhas e filas continua prevista para a etapa 9):

- **Topo:** quatro números: automações ativas, DMs enviadas, cliques em links e fluxos iniciados (vêm das estatísticas da Zernio).
- **Lista:** uma linha por automação, com ícone do tipo, nome, uma frase "Quando … → então …", conta, regra de repetição, números e chave Ativa/Pausada.
- **Sem automações:** os modelos para começar (Comentário → DM, Só seguidores, Menção em story, Link ou QR, Perguntar antes). Contas TikTok e outras mostram só "Comentário → resposta pública".
- **Construtor:** cartões **QUANDO** (conta, postagem ou todas, palavras-chave, modo de busca), **VERIFICAÇÃO** (só seguidores), **ENTÃO** (texto com `{{first_name}}` e `{{username}}`, até 3 botões, resposta pública), **COM QUE FREQUÊNCIA** (uma vez por pessoa ou sempre, com espera). À direita, uma prévia de celular. Botões "Salvar pausada" e "Ativar" (este com confirmação).
- **Página da automação:** números, "Como funciona", "O que a pessoa recebe", atividade recente, Editar, Pausar e Excluir.
- **Avisos honestos na tela:** uma resposta privada por comentário; o Instagram pode recusar botões; o TikTok só responde em público.

## 5. Arquitetura técnica

- **Contratos:** `packages/contracts/src/automations.ts` (Zod), com os limites da documentação (640/1.000 caracteres, 3 botões, rótulo 20, espera 1 a 8.760 h).
- **Cliente Zernio:** novas funções para automações de comentário, registros e fluxos, com formato de resposta conferido.
- **Serviço e rotas:** `apps/api/src/automations/` e `/api/internal/automations/*`, com a mesma regra de empresa, papéis e limite de pedidos por empresa.
- **Simulador:** rotas de automação, registros, fluxos, ativar e pausar, além dos erros 400, 409, 403 e 503.
- **Tela:** `apps/web/src/pages/automations/`, substituindo a página "Em desenvolvimento" só na seção de redes.
- **Trava geral:** `AUTOMATIONS_WRITE_ENABLED=false` por padrão (desenvolvimento e produção). Com ela desligada, a tela lista e simula, mas não cria nem ativa nada na Zernio.
- **Idempotência:** a documentação não cita `Idempotency-Key` para criar automações. Para não duplicar: botão bloqueado durante o pedido e, se o resultado for incerto, a lista é relida antes de qualquer nova tentativa.
- **Sem migração de banco.**

## 6. Etapas (cada uma com aprovação)

| Etapa | Entrega | Chamada real? |
|---|---|---|
| A0 | Este plano | Não |
| A1 | Fundação: contratos, cliente, simulador, leitura (lista, detalhes, atividade) com a regra de empresa, e página com lista, números e modelos | Não |
| A2 | Comentário → DM (Instagram e Facebook) e Comentário → resposta pública (TikTok e outras): construtor, prévia, salvar pausada, ativar, pausar, editar e excluir | Não |
| A3 | Só seguidores e Menção em story (Instagram) | Não |
| A4 | Regras de repetição e atividade (registros e comentários que não casaram) | Não |
| A5 | Link ou QR → fluxo, com a alternativa "envie MENU" e o QR code | Não |
| A6 | Comentário → perguntar antes (fluxo) | Não |
| H1 | Primeira leitura real da lista de automações da empresa | Sim, com autorização |
| H2 | Primeira automação real, criada **pausada** numa postagem de teste | Sim, com autorização |
| H3 | Ativar, comentar de outra conta, conferir a DM e a atividade, pausar e excluir | Sim, com autorização |

## 7. Decisões pendentes

| # | Decisão | Recomendação |
|---|---|---|
| A1 | Pôr as automações da Zernio na página Automações agora, como seção "Redes sociais", antes da etapa 9 (campanhas e filas) | Sim |
| A2 | Quem gerencia: criar, editar, ativar, pausar e excluir | Dono e administradores. Atendentes e visualizadores só veem |
| A3 | Redes da primeira entrega | Instagram completo; Facebook quando houver conta; TikTok só resposta pública |
| A4 | "Também responder quando a pessoa mandar a palavra por DM" (`alsoMatchInDms`) | Desligado por padrão, com aviso: pode responder conversas que um atendente está cuidando na Inbox |
| A5 | Trava geral `AUTOMATIONS_WRITE_ENABLED` | `false` em desenvolvimento e produção até a homologação |
| A6 | QR code: nova dependência (`qrcode`) | **Aprovado pelo dono (2026-11-05)**; implementado no servidor, com a A5 |
| A7 | Comentários que não casaram (trazem nome e texto) | Mostrar só para dono e administradores, nunca no log |
| A8 | Custos de mensagens de saída | Mostrar a contagem de DMs do mês na página |
| A9 | Frequência da atividade ao vivo | A cada 15 s (a skill usa 4 s; nosso limite é 120 leituras/min por empresa) |

## 8. Riscos

- **Mensagens em massa:** uma palavra-chave genérica pode gerar muitas DMs. As regras de conteúdo da Zernio proíbem spam automatizado, com risco de suspensão da conta. Mitigação: criar pausada, repetir "uma vez por pessoa" por padrão, confirmar ao ativar e um botão "Pausar todas".
- **Resposta privada única:** se a automação usar a resposta, o atendente não consegue mais responder em privado àquele comentário.
- **Botões recusados** para quem não segue: o modelo "perguntar antes" existe por isso.
- **Duplicidade na criação:** a documentação não cita `Idempotency-Key`; ver a seção 5.
- **Documentação de terceiros:** a skill não é da Zernio; cada endpoint foi conferido na documentação oficial e deve ser conferido de novo na H1.
- **LGPD:** os registros da Zernio guardam nome e texto de quem comenta. A Zernio é operadora; a empresa é a controladora.

## 9. Verificação

Em cada etapa: `npm test`, `npm run typecheck` e `npm run build` em `saas/`, só com o simulador, e registro em `docs/CHANGELOG_DESENVOLVIMENTO.md`.
