# Estrutura técnica — SaaS DisparaZap

| | |
|---|---|
| **Data** | 2026-10-31 (fundação, Fase 4); atualizado em 2026-11-01 (autenticação, integração global, módulo WhatsApp e Envio de Mensagens), 2026-11-02 (Zernio), 2026-11-03 (Redes Sociais, seção 15) e 2026-11-04 (Inbox com WhatsApp, seção 16) |
| **Escopo** | API, painel web e worker; autenticação com cadastro de empresa e três tipos de usuário; integração global com a Evolution Go; instâncias de WhatsApp das empresas; Envio de Mensagens com listas de contatos salvas. Sem fila nem campanhas no servidor |
| **Arquitetura de referência** | `docs/ARQUITETURA_SAAS.md` (raiz do repositório) |

> **Atualizações de 2026-11-01:**
> - a seção 8 descreve a autenticação; a 9, a integração global; a 10, o módulo WhatsApp; a 11, o Envio de Mensagens;
> - as seções 1 a 6 descrevem a fundação e continuam válidas, exceto onde as seções novas acrescentam peças;
> - a contagem de testes está atualizada na seção 7.

---

## 1. Visão geral

**Monólito modular** num monorepo com npm workspaces. Três aplicações compartilham dois pacotes:

```
            ┌──────────────────────┐      ┌──────────────────────┐
            │ apps/web (React)     │      │ apps/worker          │
            │ painel no navegador  │      │ processo de filas    │
            └─────────┬────────────┘      └─────────┬────────────┘
     GET /health/live │ (mesma origem;              │
                      │  proxy do Vite em dev)      │
            ┌─────────▼────────────┐                │
            │ apps/api (Fastify)   │                │
            └─────────┬────────────┘                │
                      │                             │
    ┌─────────────────▼─────────────┐   ┌───────────▼───────────────┐
    │ packages/contracts            │   │ packages/shared (servidor) │
    │ health check, erro RFC 9457   │   │ env, logger, encerramento  │
    │ (usado por API e painel)      │   │ (usado por API e worker)   │
    └───────────────────────────────┘   └────────────────────────────┘
```

Nenhuma aplicação acessa banco, Redis, Evolution Go, Zernio ou MyLinksss.

## 2. Responsabilidades

| Pasta | Responsabilidade | Não pode |
|---|---|---|
| `packages/contracts` | Formatos públicos trocados entre API e clientes (Zod + tipos). Roda no navegador e no Node | Importar código de servidor; antecipar modelos de negócio |
| `packages/shared` | `parseEnv` (validação de ambiente), `createLogger` (pino com redação), `handleShutdownSignals` | Ser importado pelo painel (é só de servidor) |
| `apps/api/src/config` | Schema das variáveis da API e `loadApiConfig` | Ler `process.env` fora daqui |
| `apps/api/src/app` | `buildApp`: monta o Fastify **sem abrir porta** (testável com `inject`) | — |
| `apps/api/src/plugins` | Erros (RFC 9457), logs, cabeçalhos de segurança, CORS | — |
| `apps/api/src/routes` | `health.ts` (`/health/live`, `/health/ready`), `v1.ts` (prefixo `/api/v1`, sem rotas), `auth.ts` (`/api/auth/*`), `internal.ts` (`/api/internal/signup` e `/me`), `platform.ts` (Super-Admin), `whatsapp.ts` (instâncias das empresas), `messaging.ts` (listas e envio), `social.ts` (Redes Sociais) e `inbox.ts` (Inbox, com o SSE) | Expor rota sem autenticação, exceto health, entrar e criar conta |
| `apps/api/src/auth` | Better Auth, senhas, cadastro, sessão para o painel, Super-Admin (seção 8) e `member.ts` (empresa e papel de quem age) | Aceitar papel ou origem vindos do navegador |
| `apps/api/src/security` | Cofre de credenciais (`vault.ts`) e limite de tentativas (`rate-limiter.ts`) | Devolver segredos abertos fora da API |
| `apps/api/src/integrations` | Cliente HTTP da Evolution Go, adaptador `WhatsAppProvider` (seções 9 e 10) e cliente WebSocket dos eventos (`ws-client.ts`, seção 16) | Repassar o corpo das respostas da Evolution; registrar a URL do WebSocket (leva a chave global) |
| `apps/api/src/inbox` | Inbox (seção 16): consumidor dos eventos da Evolution, gravação idempotente, serviço das conversas e barramento de avisos | Gravar ou avisar evento de instância não autorizada; registrar texto de mensagem ou número no log |
| `apps/api/src/platform` | Integração global da Evolution Go: ler, salvar, testar e abrir para uso (seção 9) | — |
| `apps/api/src/whatsapp` | Serviço das instâncias das empresas (seção 10) | Agir sobre instância que não esteja no banco do DisparaZap |
| `apps/api/src/messaging` | Listas de contatos e envio de texto (seção 11) | Gravar número ou texto de mensagem no log |
| `apps/api/src/social` | Redes Sociais (seção 15): espelho das publicações, sincronização, publicar/agendar, visão geral, métricas, biblioteca | Repassar texto de erro da Zernio ou da rede; gravar o texto das publicações no log |
| `apps/api/src/testing` | Evolution Go simulada, usada só pelos testes; fora do build de produção | Ser importada pelo código da API |
| `packages/db` | Schema Drizzle (`identity`, `platform`, `app`), migrations e conexão (seção 8) | Ser importado pelo painel (é só de servidor) |
| `apps/api/src/modules` | Módulos de domínio (vazio; ver `README.md` da pasta) | Acessar tabelas de outro módulo |
| `apps/api/src/index.ts` | Lê a configuração, sobe o servidor, registra o encerramento | Conter lógica de negócio |
| `apps/worker/src` | `createWorker` (ciclo de vida), registro de filas (vazio), `index.ts` | Conectar ao Redis ou processar tarefas (nesta fase) |
| `apps/web/src/app` | `App` (rotas), `navigation.ts` (menu e permissões), cliente do health check | — |
| `apps/web/src/layouts` | `AppLayout`: menu lateral + cabeçalho + área de conteúdo | — |
| `apps/web/src/components` | `Sidebar`, `Header`, `Card`, `PageHeader`, `StatusBadge`, `UnderConstruction`, `EnvironmentStatus`, `BrandMark` | Simular dados |
| `apps/web/src/pages` | `OverviewPage`, `ModulePage` (genérica para módulos em desenvolvimento), `NotFoundPage`; `pages/social/` (abas das Redes Sociais, seção 15); `pages/inbox/` (Inbox, seção 16) | — |
| `apps/web/src/inbox` | Cliente da API da Inbox (`inbox-api.ts`, com o `EventSource`) e peças comuns (`inbox-ui.tsx`) | Falar direto com a Evolution Go; simular dados |
| `apps/web/src/social` | Cliente da API das Redes Sociais (`social-api.ts`) e peças comuns (`social-ui.tsx`: situação, datas no fuso, detalhes da publicação) | Simular dados |
| `apps/web/src/styles` | `global.css`: tokens de cor, layout responsivo, componentes | — |
| `infra/docker` | Reservado para o Compose (só `README.md`) | — |
| `infra/hostinger` | Publicação no aplicativo Node.js da Hostinger: `server.js` (entrada), `empacotar.mjs` (`npm run pacote:hostinger` → `saas/deploy/`, ignorado pelo git), `producao.mjs` (segredos, migrations e Super-Admin no banco de produção, a partir do computador), `env.hostinger.example` e `README.md` (passo a passo) | Guardar segredos ou o certificado do banco (ficam em `saas/.env.producao` e `saas/certs/`, ignorados) |

## 3. API

| Item | Implementação |
|---|---|
| Configuração | Zod: `NODE_ENV`, `LOG_LEVEL`, `API_HOST` (padrão `127.0.0.1`), `API_PORT` (padrão `3100`), `API_CORS_ORIGINS` (padrão vazio), `API_SHUTDOWN_TIMEOUT_MS`. Inválida → o processo sai com 1 e a mensagem cita a variável, nunca o valor |
| Rotas | `GET /health/live` → `{ status, service, timestamp }` (sem versão, host ou uptime). `/api/v1/*` → 404 (prefixo reservado) |
| Erros | `setErrorHandler` + `setNotFoundHandler`: sempre `application/problem+json` (RFC 9457) com título fixo por status e `requestId`. Mensagem original e stack ficam só no log |
| Logs | pino em JSON; `req` registrado só como `{ id, method, url sem query string }`; cabeçalhos nunca registrados; redação de `authorization`, `cookie`, `token`, `password`, `secret`, `apiKey` (até um nível de profundidade) |
| Segurança | `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, `cache-control: no-store`, `x-request-id` gerado no servidor (o do cliente é ignorado), sem `x-powered-by`, limite de corpo 1 MB, `trustProxy: false` |
| CORS | `@fastify/cors` com lista explícita de origens exatas; `*` é recusado na configuração; lista vazia = nenhuma origem externa |
| Encerramento | `SIGINT`/`SIGTERM` → `app.close()` com prazo; segundo sinal ou prazo esgotado → saída 1; `return503OnClosing` |

## 4. Worker

- Inicializa por conta própria (`npm run dev:worker`), com configuração validada e logs com redação.
- Estado: `idle → running → stopping → stopped`.
- Um `setInterval` mantém o processo vivo e registra "worker ativo" em nível `debug`. **Não executa tarefas.**
- `queues/index.ts` define o tipo `QueueDefinition` e a lista vazia `queues`: é o ponto de entrada das filas BullMQ (etapa 9).
- Encerramento controlado pelo mesmo `handleShutdownSignals` da API.

## 5. Painel web

- **Rotas:** `/` (Visão Geral) e os módulos `/inbox` (com `/inbox/:id` e `/inbox/:id/detalhes`), `/campanhas`, `/envio-de-mensagens`, `/contatos` (com `/contatos/:id`),
  `/agentes-ia`, `/automacoes`, `/redes-sociais`, `/integracoes` e `/configuracoes`. Qualquer outra rota mostra "Página não
  encontrada". Nas subpáginas, o topo mostra o nome do módulo e o item do menu continua marcado.
- **Navegação:** cada item tem `status` (`available` / `in_development`), `permission` (para a Fase 5), `summary` (escopo
  planejado) e `plannedFor` (etapa do roteiro). `visibleNavigation(items, canView)` filtra por permissão; hoje `canView` libera tudo.
- **Visão Geral:**
  - aviso "Plataforma em construção";
  - status do ambiente: a **API é consultada de verdade** em `/health/live`, validada pelo contrato; worker, banco e filas
    aparecem com descrições fixas e verdadeiras ("sem verificação", "não conectado");
  - próxima fase;
  - lista dos módulos planejados.
- **Módulos:** página "Em desenvolvimento" com o escopo e a etapa prevista. Sem dados, formulários, tabelas ou ações.
- **Sem estatísticas.** Desde 2026-11-01, todas as rotas do painel exigem login, e o cabeçalho mostra o usuário (seção 8).
- **Responsivo:** abaixo de 960 px, o menu lateral vira gaveta (botão com `aria-expanded`). Inclui link "Pular para o conteúdo".

## 6. Resolução de pacotes e build

| Situação | Como `@disparazap/*` é resolvido |
|---|---|
| Desenvolvimento (`npm run dev:*`) | Condição `source` do Node → `src/index.ts`, executado pelo suporte nativo do Node 24 a TypeScript |
| Testes (Vitest) | `resolve.alias` → `src/index.ts` (não exige build) |
| Painel (Vite e `tsc` do painel) | Alias do Vite / `customConditions: ["source"]` → `src` |
| Produção (`npm run start`) | `default` → `dist/index.js`, gerado por `tsc -b` |

- Os imports relativos usam a extensão `.ts`; o `tsc` reescreve para `.js` (`rewriteRelativeImportExtensions`).
- `erasableSyntaxOnly` garante que todo código possa ser executado pelo Node sem transpilar.

## 7. Testes

| Arquivo | Testes | Cobre |
|---|---:|---|
| `packages/contracts/src/contracts.spec.ts` | 4 | Contratos aceitam o formato público e recusam campos extras e stack |
| `packages/shared/src/shared.spec.ts` | 8 | `parseEnv` sem ecoar valores; redação de logs; encerramento (sucesso, segundo sinal, prazo, falha, remoção de ouvintes) |
| `packages/db/src/db.spec.ts` | 5 | Pasta-mãe inexistente e persistência entre aberturas; um processo por pasta (trava `.lock`, D-51); migrations no banco embutido (tabelas só nos esquemas `app`, `identity` e `platform`, nenhuma no `public`); reaplicar não faz nada (contagem lida do `_journal.json`); e-mail único sem diferenciar maiúsculas; `CHECK` de papel e origem |
| `apps/api/src/config/env.spec.ts` | 13 | Padrões seguros; campos vazios; `DATABASE_URL` exige certificado; URL não PostgreSQL; exigências de produção; segredo curto e e-mail inválido sem ecoar valores; origens CORS; porta e nível inválidos |
| `apps/api/src/app/build-app.spec.ts` | 11 | Health e cabeçalhos; id de requisição; 404/500/400/413/415 em RFC 9457 sem detalhes internos; `/api/v1`; CORS; logs sem segredos; escuta em 127.0.0.1 |
| `apps/api/src/auth/auth.spec.ts` | 24 | Schema compatível com o Better Auth; cadastro com empresa; hash argon2id; validação; recusas iguais (e-mail usado e reservado); cadastro direto desativado; cadastro desligado; login e sair; mesma resposta para senha errada e e-mail desconhecido; `/me` sem sessão; origem estranha recusada; papel não promovido pelo navegador; empresa não criada pelo navegador; Super-Admin; `/health/ready`; correções da auditoria: token fora das respostas (A1), limite no cadastro (A3), `localhost` em desenvolvimento (A4), convites desligados (A5) |
| `apps/api/src/startup.spec.ts` | 2 | Processo real sobe, abre o banco e responde (`/health/live` e `/health/ready`); configuração inválida impede o início |
| `apps/worker/src/worker.spec.ts` | 6 | Configuração; nenhuma fila; ciclo de vida sem timers pendentes; encerramento por sinal; processo real sobe e permanece ativo |
| `apps/web/src/app/App.spec.tsx` | 32 | Login exigido; tela de entrar conforme a referência; sem login social nem recuperação falsos; mostrar/ocultar senha; entrar e voltar à página pedida; login recusado; logado vai direto ao painel; API fora do ar; retorno só para caminhos internos; criar conta (validação, sucesso, recusa); painel de apresentação sem números; os três tipos de usuário; sair; layout; Visão Geral (WhatsApp "Disponível", os demais "Em desenvolvimento"); status real de API e banco; módulos; navegação; permissões |
| `packages/contracts/src/platform.spec.ts` | 13 | Endereço da Evolution Go (aceitos e recusados), barra final, campos extras |
| `apps/api/src/security/vault.spec.ts` | 4 | Assinatura com subchave por finalidade (D-46); cifra e abre; texto cifrado muda a cada vez; adulteração, contexto, chave e versão errados recusados |
| `apps/api/src/platform/platform.spec.ts` | 18 | Acesso só do Super-Admin; origem; validações; chave cifrada e nunca devolvida; manter e trocar a chave; teste de conexão (ok, chave recusada, redirecionamento, resposta estranha, servidor desligado); sem cofre |
| `apps/api/src/whatsapp/whatsapp.spec.ts` | 24 | Exclusão recusada pela Evolution (3): nada apagado quando a instância ainda existe no servidor; nova tentativa; instância já removida no servidor não prende a empresa. Demais: | Com e sem integração global; ciclo de vida contra o simulador nos formatos reais (criar com nome `dz_` e token cifrado, limite, QR, conectado com o número vindo do `/instance/info`, desconectar, pareamento com a regra de telefone, excluir revogando o token); a lista sincroniza com o servidor (conexão concluída depois do acompanhamento, queda); leitura de JID e classificação das falhas de envio; isolamento A×B (404); viewer só lê; sem login 401 e outro site 403; lista do Super-Admin; Super-Admin sem empresa; falhas da Evolution (criação falha sem gravar nada, ID buscado na lista, servidor fora do ar) |
| `apps/api/src/messaging/messaging.spec.ts` | 29 | Página Contatos: acrescentar sem repetir (os já na lista e os inválidos ficam de fora), renomear, editar nome e telefone (inválido 400, repetido 409, inexistente 404), remover de vez, busca em todas as listas (nome sem maiúsculas, parte do telefone, curingas como texto, busca curta 400), isolamento entre empresas e viewer só lê, limite de 10.000 ao acrescentar. Imagens: PNG verdadeiro aceito e sem duplicar, arquivo falso, outro formato e acima de 5 MB recusados, isolamento e viewer. Modelos: imagem, texto, CTA e variações; CTA sem link ou com `javascript:` recusado; nome único; imagem de outra empresa recusada; isolamento; atualizar e excluir. Envio com imagem em base64 puro e legenda com CTA; imagem inexistente (404). Listas: vazia e `canSend` por papel; criar validando telefones de novo, sem repetidos e na ordem; nome repetido (409) e curto (400); substituir; 10.000 contatos (mais de 1 MB) aceitos e 10.001 recusados; isolamento A×B; viewer só lê; exclusão definitiva; sem login, outro site e Super-Admin sem empresa. Envio: sucesso sem nada técnico na resposta; número sem WhatsApp; validações antes da Evolution; instância de outra empresa e viewer; instância desconectada (para e marca "Desconectado"); Evolution fora do ar; 60 por minuto |
| `apps/web/src/pages/SettingsPage.spec.tsx` | 7 | Campos, validação, salvar (a chave some da tela), teste de conexão, alteração pendente, cofre ausente, Admin-Empresa sem acesso |
| `apps/web/src/pages/WhatsAppPage.spec.tsx` | 9 | Abre pelo endereço antigo `/whatsapp`, que leva à seção WhatsApp de Integrações; Lista vazia e contador; criar e respeitar o limite; QR até "Conectado" com o número; pareamento com validação do número; desconectar e excluir com confirmação; erro da API; integração ausente; viewer sem botões; Super-Admin só com a tabela geral e o subtítulo certo |
| `apps/web/src/pages/SendMessagesPage.spec.tsx` | 15 | Etapa Mensagem: campos Imagem, Mensagem e CTA nesta ordem, formato de imagem recusado sem chamar a API, pré-visualização com imagem, CTA e link; salvar modelo e carregar modelo salvo (com confirmação); disparo com imagem e CTA em cada envio. Menu e 5 etapas; instância conectada escolhida, desconectada não avança, sem instância aponta para WhatsApp; contatos à mão com a regra de telefone e lista salva; lista salva com confirmação antes de descartar alterações; Excel com colunas detectadas e motivos; mensagem, pré-visualização, variações e intervalo; disparo com texto personalizado e número recusado sem parar; instância desconectada para na hora; "Parar" no intervalo; viewer sem disparo; Super-Admin sem empresa |
| `apps/web/src/pages/ContactsPage.spec.tsx` | 12 | Contatos disponível no menu; listas com totais e filtro pelo nome sem acentos; busca em todas as listas abrindo a lista certa já filtrada (topo e menu continuam em Contatos); nova lista (nome curto recusado); excluir com confirmação; na lista: adicionar à mão (inválido e repetido sem chamar a API), importar planilha com resumo, editar, remover um e vários selecionados, renomear e excluir, busca e páginas de 50; viewer sem botões; sem empresa; lista inexistente |
| `apps/web/src/messaging/spreadsheet.spec.ts` | 4 | `.xlsx` gerado no teste: cabeçalho, colunas, telefones válidos, repetidos e motivos; planilha sem cabeçalho; números sem notação científica; formato recusado |
| `apps/api/src/zernio/zernio.spec.ts` | 30 | Cobrança (402): cada motivo com a sua mensagem e o motivo no log; total da conta inteira (`/v1/usage`), também quando a Zernio não informa; Contra a Zernio simulada: sem chave; formato errado e chave recusada não guardam nada; chave aceita cifrada e nunca devolvida, perfil com o id da empresa, trocar sem duplicar; conectar com os nomes exatos dos parâmetros e volta assinada (até 258 caracteres); volta com erro em motivo fixo; código de erro com nome especial; comprovante alterado, de outra empresa ou de outro usuário recusado; validade de 15 minutos; reconectar e desconectar só no perfil da empresa (mesmo com resposta vazando outros perfis); papéis; falhas 429/402/503 e chave revogada; gravações simultâneas; Zernio fora do ar; chave fora do log; remover; chave que não abre mais |
| `apps/web/src/pages/IntegrationsPage.spec.tsx` | 24 | Ordem dos cards (WhatsApp, Zernio, API) e da seção do WhatsApp antes da Zernio; redes conectadas em verde com "Conectado" e ✓, "Outra conta" com confirmação, aviso de rede em outro perfil e reconectar pelo card âmbar; Link da cobrança da Zernio no 402; total da conta e aviso de rede fora do perfil; Catálogo; chave validada no painel; salvar, trocar e remover; chave recusada; conectar e erro; situação relida depois das redes; botão Voltar do navegador; tabela de redes, reconectar e desconectar; volta (uma vez só no modo estrito, falha, vencida, sem comprovante, sessão vencida); viewer; sem empresa; cofre desligado |
| `apps/api/src/plugins/web-panel.spec.ts` | 18 | Painel servido pela API: `index.html` nas rotas do painel com CSP e sem cache; arquivo com hash com cache longo e 304; mapa de código-fonte, arquivo oculto, inexistente e tentativas de subir de pasta em 404; rotas da API e outros métodos nunca recebem o HTML; sem `WEB_DIST_DIR` nada é servido; pasta sem `index.html` impede o início; `API_TRUST_PROXY` (último salto) e padrão ignorando o cabeçalho; HSTS só em produção |
| `apps/api/src/social/social.spec.ts` | 24 | Contra a Zernio simulada: visão geral só com contas do perfil (TikTok sem publicar), sem Zernio, papéis, sem empresa, outro site; publicar com imagem (envio sem a chave, nomes exatos, Idempotency-Key), repetir o pedido sem chamar a Zernio, tempo esgotado com a mesma chave (um post só), falha parcial com mensagem fixa e nova tentativa só nas que falharam, remover da rede, Story e Pinterest (opções e pastas), regras antes da Zernio, WebP no Instagram, conta a reconectar, conta desconectada, 429 com Retry-After, conteúdo repetido; agendar no fuso (passado recusado), trocar o fuso, reagendar só a data, editar/excluir publicada recusado, rascunho sem contas publicado depois, cancelar; isolamento entre empresas, sincronização incremental (só o perfil da empresa, excluída lá some), calendário, filtros e busca, visão geral com números e métricas (e plano sem métricas); biblioteca (nome do arquivo, exclusão, imagem de modelo protegida); log sem chave e sem texto |
| `packages/contracts/src/social.spec.ts` | 7 | Fuso: horário local → instante (horário de verão), virada de dia, fusos válidos; regras de cada rede (imagem obrigatória, Story, 280 do X, texto por rede, tipo e tamanho, rascunho), pedido (agendar, contas, repetida, link do pin) |
| `apps/web/src/pages/social/SocialSection.spec.tsx` | 13 | Abas, visão geral (números, alertas, próximas, contas, desempenho), trocar o fuso, sem Zernio, visualizador e sem empresa; criar publicação (regras ao vivo, WebP no Instagram, biblioteca, texto por rede, prévia, confirmação, resultado por rede), X (custo e 280) e agendar, editar rascunho; histórico (filtros na URL, detalhes, tentar de novo e cancelar com confirmação), calendário no fuso (dia de hoje, reagendar, visão de dia); biblioteca (busca, envio, exclusão, sem permissão); resultados ("—" onde a rede não informa, período, plano sem métricas) |
| `apps/web/src/messaging/message-format.spec.tsx` | 3 | `{nome}` com e sem nome; *negrito*/_itálico_/~riscado~ sem interpretar HTML; tempo e sorteio do intervalo |
| `apps/api/src/inbox/inbox.spec.ts` | 48 | Contra a Evolution simulada com WebSocket: com as chaves desligadas nada liga (409, corpo vazio no `/instance/connect`); consumidor só com a chave global; evento de instância sem Inbox, desconhecida (MVP) ou com token adulterado descartado antes de gravar; mensagem inválida não derruba; ligar/desligar por papel e por empresa (404), reconectar pelo QR mantém a configuração; receber (contato, conversa, conta), repetido, fora de ordem, digitada no celular, mídia sem o arquivo, grupos e reações fora, lida no celular e no painel, filtros e busca; isolamento A×B; responder (assume o atendimento), mesmo pedido, dois cliques simultâneos, eco sem duplicar, eco antes da resposta, envio de outro sistema, validação, número desconectado, outra origem; recibos entregue/lida sem retroceder e recibo antes da mensagem; atendente vê a fila e as dele, visualizador sem acesso; trava das respostas automáticas (versão), reabertura; SSE (empresa certa, só ids, atendente, sinal de vida, prazo máximo, 401/403), consulta sem SSE; ping, queda e fechamento com reconexão e lacuna; chave recusada sem insistir e volta com a chave nova; log sem chave, URL, token, texto ou número |
| `apps/web/src/pages/inbox/InboxPage.spec.tsx` | 30 | Menu e três colunas; lista com canal, conta, não lidas e "Você:"; filtros (canal, conta, busca, situação); lista vazia e erro; histórico com autor, situação (enviada, entregue, lida, não enviada com motivo), mídia, dia; lida ao abrir; detalhes (contato, canal, conta, responsável, modo, "Em desenvolvimento"); conversa inexistente; celular (lista → conversa → detalhes pelo endereço); responder (pedido com id, mesmo id ao tentar de novo, Enter e Shift+Enter, botão desligado); tempo real (conversa aberta, outra conversa, recebimento, reconexão) e consulta periódica sem ele; avisos (desligado, chave recusada, lacuna, nenhum número); permissões; botão "Receber mensagens na Inbox" (bloqueado antes da homologação, confirmar, parar, atendente e visualizador) |

| `apps/api/src/automations/automations.spec.ts` | 33 | A4: atividade com texto fixo por situação, motivo e texto da Zernio fora da API; comentários que não casaram só para dono e administradores; automação de outra empresa e inexistente 404; log sem o texto do comentário. A6: comentário → perguntar antes: recusas antes da Zernio (trava, papel, Facebook, palavra-chave vazia, link sem https); grafo com comentário, pergunta sem botão, espera e saídas; recusa da Zernio. A5: QR code do link (PNG só de fluxo com link da empresa; sem código 400; outra empresa 404); link → conversa: lista só das contas da empresa com código e link; atendente só lê; trava, papéis, conta fora do Instagram, código inválido e nome ou código repetidos recusados antes da Zernio; criação pausada com o gatilho de referência, mensagem, etiqueta e fim; ativar e pausar só da própria empresa; excluir; recusa da Zernio com mensagem fixa. A3: só seguidores com a verificação documentada; fora do Instagram e verificação incompleta recusados; menção em story sem palavra-chave nem resposta pública; recusas da story; tirar a verificação, gatilho fixo e gatilho de fora não editado. A2: trava desligada sem chamar a Zernio; atendente e visualizador 403; criação pausada só com os campos documentados; nome repetido; regras por rede; resposta pública no TikTok; ativar, pausar, editar e excluir só da própria empresa; recusas da Zernio com mensagem fixa e resultado incerto; relê quando a resposta vem sem a automação. A1, contra a Zernio simulada: sessão e papéis (dono gerencia; atendente e visualizador só veem), trava desligada, automações de outra empresa e sem conta descartadas, capacidade por rede, totais, detalhe (TikTok sem DM; outra empresa, id inválido e inexistente 404), erros com mensagem fixa, empresa sem chave, log sem texto de DM |
| `apps/web/src/pages/automations/AutomationsPage.spec.tsx` | 27 | A4: atividade no detalhe com registros e comentários que não casaram para quem gerencia; quem só lê não os vê; intervalo de 15 s. A6: construtor da pergunta (palavras-chave por vírgula, criação pausada); recusas de palavra-chave e de link sem https; lista com a pergunta sem link. A5: QR code mostrado e escondido ao pedir; construtor de link só com contas do Instagram, prévia com o código em minúsculas e criação pausada; código curto recusado antes de enviar; seção de links com copiar e ativar com confirmação; quem não gerencia só lê. A3: modelo só seguidores com prévia da verificação; modelo story sem palavra-chave nem resposta pública; troca de conta; detalhe com a verificação e sem Editar para gatilho de fora. A2: construtor com prévia e trava desligada; validação antes de enviar e criação pausada; resposta pública no TikTok; ativar com confirmação, pausar, excluir com confirmação; ações desligadas pela trava; editar. A1: lista com frase, conta, repetição e situação; números; aviso da etapa; contas e modelos sem botões de criar; detalhe e volta; erro do servidor; lista vazia; texto das palavras-chave |

**Total: 563 testes (35 arquivos)** em 2026-11-05 (a tabela acima soma as linhas de cada arquivo; `db.spec.ts` ganhou o teste da trava de processo único, D-51, e confere as tabelas da Inbox). Os testes do painel usam `apps/web/vitest.setup.ts` (espera de 5 s, por causa da carga dos testes da API em paralelo). O `npm test` da raiz (MVP) não os executa: os nomes `*.spec.*` ficam fora do padrão de descoberta do `node --test`.

## 8. Autenticação (2026-11-01)

| Peça | Onde | O que faz |
|---|---|---|
| Schema e conexão | `packages/db` | Esquema `identity` (Drizzle), migrations em `migrations/`, `openDatabase` (PostgreSQL com TLS verificado ou banco embutido PGlite com migrations automáticas) |
| Configuração | `apps/api/src/config/env.ts` | `DATABASE_*`, `AUTH_*`, `SUPER_ADMIN_EMAIL`; produção exige banco, segredo e https |
| Better Auth | `apps/api/src/auth/auth.ts` | Instância com argon2id, organizações (owner/admin/operator/viewer), cookies `dz.*`, origem/CSRF forçados, limite de tentativas, telemetria desligada |
| Cadastro | `apps/api/src/auth/signup.ts` | Conta + empresa + participação `owner` + empresa ativa na sessão; recusa genérica para e-mail usado ou reservado |
| Sessão para o painel | `apps/api/src/auth/session-info.ts` | Tipo de usuário e empresa, só com campos permitidos (contrato `sessionInfoSchema`) |
| Super-Admin | `apps/api/src/auth/super-admin.ts` e `src/cli/create-super-admin.ts` | Criação por comando de terminal (`npm run admin:create`), senha digitada e nunca gravada |
| Rotas | `apps/api/src/routes/auth.ts`, `internal.ts`, `health.ts` | `/api/auth/*` (Better Auth), `/api/internal/signup`, `/api/internal/me`, `/health/ready` |
| Painel | `apps/web/src/auth/`, `layouts/AuthLayout.tsx`, `pages/LoginPage.tsx`, `pages/SignupPage.tsx`, `components/AuthShowcase.tsx` | Cliente `fetch` (sem biblioteca no navegador), contexto de sessão, rotas protegidas, telas no estilo da referência |

**Fluxo:**
1. O painel chama `/api/internal/me`. Sem sessão (401), mostra `/entrar`.
2. O login vai para `/api/auth/sign-in/email`, e o Better Auth grava o cookie `HttpOnly`.
3. O cadastro vai para `/api/internal/signup`, que cria conta e empresa e devolve o cookie.
4. "Sair" chama `/api/auth/sign-out`.

## 9. Integração global com a Evolution Go (2026-11-01)

| Peça | Onde | O que faz |
|---|---|---|
| Tabelas | `packages/db/src/schema/platform.ts` (migration `0001_platform`) | `platform.provider_servers` (servidor) e `platform.integration_credentials` (cofre) |
| Cofre | `apps/api/src/security/vault.ts` | AES-256-GCM com `SECRETS_MASTER_KEY`; contexto autenticado; só os 4 últimos caracteres saem para a tela |
| Cliente HTTP | `apps/api/src/integrations/evolution-client.ts` | Teste de conexão só de leitura (`GET /instance/all`), TLS verificado, sem redirecionamentos |
| Serviço | `apps/api/src/platform/evolution-settings.ts` | Ler, salvar (cifrando e revogando a chave anterior) e testar |
| Rotas | `apps/api/src/routes/platform.ts` | `/api/internal/platform/evolution` (GET, PUT) e `/evolution/test` (POST), só Super-Admin, com verificação de origem |
| Tela | `apps/web/src/pages/SettingsPage.tsx`, `src/platform/platform-api.ts` | Cartão "Integração global · Evolution Go" para o Super-Admin; "Em desenvolvimento" para os demais |

**Uso pelo módulo WhatsApp:** `resolveEvolutionIntegration` devolve o servidor ativo e a chave aberta do cofre, ou o estado
`missing`/`disabled`. A chave só é usada dentro da API (seção 10).

## 10. Módulo WhatsApp das empresas (2026-11-01)

Plano: `PLANO_MODULO_WHATSAPP.md`. Decisões: `DECISOES_TECNICAS.md` D-29 a D-35. Implementado contra a Evolution **simulada**;
a homologação no servidor real (W3) depende de autorização.

| Peça | Onde | O que faz |
|---|---|---|
| Tabela | `packages/db/src/schema/app.ts` (migration `0002_whatsapp`) | `app.whatsapp_instances` (esquema `app`, o primeiro de dados de empresa) e o limite `max_whatsapp_instances` em `identity.organizations` |
| Contratos | `packages/contracts/src/whatsapp.ts`, `phone.ts` | Caminhos, status, esquemas das respostas (só campos permitidos) e a regra de telefone do MVP |
| Adaptador | `apps/api/src/integrations/whatsapp-provider.ts` | `WhatsAppProvider` e a implementação para a Evolution Go: criar, buscar ID, conectar, QR, parear, status, desconectar, excluir. Erros reduzidos a 5 tipos com mensagem fixa |
| Serviço | `apps/api/src/whatsapp/whatsapp-service.ts` | Regras: limite, nome `dz_…`, token cifrado por instância, compensação se o banco falhar, status, exclusão lógica com token revogado |
| Rotas | `apps/api/src/routes/whatsapp.ts` e `platform.ts` | `/api/internal/whatsapp/instances` (empresa da sessão; owner/admin gerenciam) e `/api/internal/platform/whatsapp/instances` (Super-Admin, só leitura); origem verificada; limites de tentativas |
| Tela | `apps/web/src/pages/WhatsAppPage.tsx`, `src/whatsapp/whatsapp-api.ts` | Cartões das instâncias, nova instância, painel de conexão (QR e código), desconectar, excluir, tabela do Super-Admin |

**Fluxo de conexão:**
1. "Conectar" chama `POST …/:id/connect`. A API inicia a conexão na Evolution e devolve a imagem do QR.
2. A cada 3 s, o painel pede `GET …/:id/qr`. Depois de 2 minutos sem conexão, para e oferece tentar de novo.
3. Quando a Evolution informa "conectado", a API grava o status e o número (do `myJid`) e devolve o QR vazio, e o painel mostra
   "Conectado".
4. Na aba "Código de pareamento", o número é validado no painel e na API. O código de 8 caracteres aparece como `ABCD-1234`.

**Nunca saem da API:** chave global, token da instância, nome técnico `dz_…`, ID na Evolution e corpo das respostas da Evolution.

**Status atualizado (desde o uso real de 2026-11-01, D-38):** as listas consultam `GET /instance/all` numa chamada só. O
número conectado vem do `jid` (`/instance/all` ou `/instance/info/{id}`), porque o `/instance/status` não o traz.

## 11. Envio de Mensagens e Contatos (2026-11-01)

Decisões: `DECISOES_TECNICAS.md` D-36 a D-44. Testado contra a Evolution **simulada**.

| Peça | Onde | O que faz |
|---|---|---|
| Tabelas | `packages/db/src/schema/app.ts` (migrations `0003_messaging` e `0004_templates`) | `app.contact_lists` e `app.contacts` (um número por lista, chave composta com a empresa, exclusão definitiva); `app.media_files` (imagens em `bytea`) e `app.message_templates` (modelos: texto, variações, imagem da mesma empresa, CTA) |
| Contratos | `packages/contracts/src/messaging.ts` | Caminhos, limites, listas, entrada e resultado do envio (motivos fixos de falha) |
| Listas | `apps/api/src/messaging/contact-lists.ts` | Listar, ler, criar, substituir e excluir, validando cada telefone de novo; para a página Contatos: renomear, acrescentar, alterar e remover contatos (lista travada na transação) e buscar em todas as listas |
| Imagens e modelos | `apps/api/src/messaging/media.ts`, `templates.ts` | Imagem conferida pelos primeiros bytes, sem duplicar, base64 em memória para o disparo; modelos com CTA validado |
| Envio | `apps/api/src/messaging/send-text.ts` | Confere empresa e papel, abre o token da instância no cofre, chama `/send/text` e devolve só o motivo fixo |
| Rotas | `apps/api/src/routes/messaging.ts` | `/api/internal/contact-lists[/:id]` (com `PATCH` para renomear), `/contact-lists/:id/contacts` (`POST` acrescenta, `PATCH` altera), `/contact-lists/:id/contacts/remove`, `/contacts/search?q=`, `/api/internal/media[/:id]` (corpo = arquivo de imagem, até 5 MB), `/api/internal/message-templates[/:id]` e `/api/internal/messaging/send`; origem verificada; limites de tentativas; corpo de até 3 MB nas listas |
| Contatos | `apps/web/src/pages/ContactsPage.tsx`, `ContactListPage.tsx` | `/contatos`: resumo, busca nas listas e nos contatos de todas as listas, nova lista, excluir. `/contatos/:id`: renomear, excluir, adicionar (à mão ou Excel, salvo na hora), busca, 50 por página, editar, remover um ou vários |
| Tela | `apps/web/src/pages/SendMessagesPage.tsx`, `src/messaging/` | Assistente de 5 etapas portado do MVP; `ContactsStep` (listas salvas), `ContactAdder` (Manual / Excel, comum com a página Contatos), `MessageStep` (modelo salvo, 1 Imagem, 2 Mensagem, 3 CTA, variações e pré-visualização ao vivo num celular), `spreadsheet.ts` (SheetJS sob demanda), `message-format.tsx`, `messaging-api.ts` |

**Fluxo do disparo:**
1. O navegador percorre a lista.
2. Para cada contato, troca o `{nome}`, sorteia a variação e acrescenta a linha do CTA (`composeMessage`). Depois chama
   `POST /api/internal/messaging/send` com o ID da imagem, se houver: a API manda texto (`/send/text`) ou imagem com legenda
   (`/send/media`, base64).
3. Depois, espera um tempo aleatório entre o mínimo e o máximo, em fatias de 250 ms, para o "Parar" responder rápido.
4. Quando o motivo da falha pede (instância desconectada ou credencial recusada), ou depois de 5 falhas seguidas, o disparo para.
   Sair da página também interrompe.

**Nunca sai da API:** o token da instância. O navegador só conhece o ID da instância, o número do contato e o texto.

## 12. Publicação na Hostinger (2026-11-01)

Decisão: `DECISOES_TECNICAS.md` D-45. Passo a passo: `infra/hostinger/README.md`.

| Peça | Onde | O que faz |
|---|---|---|
| Painel pela API | `apps/api/src/plugins/web-panel.ts` | Com `WEB_DIST_DIR`: lê o painel compilado para a memória e o entrega na mesma origem (rotas do painel → `index.html`, CSP, cache, ETag) |
| Proxy e HTTPS | `apps/api/src/app/build-app.ts`, `plugins/security.ts` | `API_TRUST_PROXY` (1 salto) e HSTS em produção |
| Entrada | `infra/hostinger/server.js` | `PORT` → `API_PORT`, `NODE_ENV=production` por padrão, painel do pacote e certificado com caminho relativo |
| Pacote | `infra/hostinger/empacotar.mjs` | `saas/deploy/hostinger/` e `.zip`: `api/`, `lib/` (contracts, db com migrations, shared), `web/`, `server.js`, `package.json` + lockfile, `certs/`, `LEIA-ME.md` |
| Produção a partir do computador | `infra/hostinger/producao.mjs` | `producao:segredos`, `producao:migrar` (confirmação `APLICAR`), `producao:admin`; lê `saas/.env.producao` |

**Na Hostinger:**
- Node.js 24, Entry file `server.js`, sem Build command e sem Output directory.
- As variáveis são importadas do `saas/.env.producao`.
- O worker não vai: ainda não há filas.

## 13. Integrações: Zernio (2026-11-02)

Decisões: `DECISOES_TECNICAS.md` D-46 e D-47. Plano: `PLANO_MODULO_ZERNIO.md`. Referência da API: `REFERENCIA_ZERNIO.md`.
Testado contra a Zernio **simulada**.

| Peça | Onde | O que faz |
|---|---|---|
| Tabela | `packages/db/src/schema/app.ts` (migration `0005_zernio`) | `app.zernio_connections`: uma por empresa (perfil, nome da conta, situação, chave no cofre) |
| Contratos | `packages/contracts/src/zernio.ts` | Caminhos, redes da etapa, situação, contas, conexão e volta |
| Adaptador | `apps/api/src/integrations/zernio-client.ts` | Endereço fixo, TLS verificado, erros classificados em motivos fixos |
| Serviço | `apps/api/src/zernio/zernio-service.ts` | Chave, perfil, contas do perfil, comprovante assinado, conectar, voltar e desconectar |
| Rotas | `apps/api/src/routes/zernio.ts` | `/api/internal/integrations/zernio`: `GET /`, `PUT`/`DELETE /key`, `GET /accounts`, `POST /connect`, `POST /connect/return`, `DELETE /accounts/:accountId` |
| Cofre | `apps/api/src/security/vault.ts` | `sign()`: HMAC com subchave HKDF por finalidade |
| Simulador | `apps/api/src/testing/zernio-simulator.ts` | Zernio de teste, fora do build |
| Telas | `apps/web/src/pages/IntegrationsPage.tsx`, `ZernioReturnPage.tsx`, `src/integrations/zernio-api.ts` | Catálogo, cartão da Zernio, redes e volta da autorização |

## 14. Página Integrações com o WhatsApp (2026-11-02)

- **O WhatsApp das empresas (instâncias da Evolution Go)** é a seção `WhatsAppIntegration`
  (`apps/web/src/pages/WhatsAppPage.tsx`), mostrada na página Integrações logo abaixo dos cards.
- **Ordem da página:**
  - cards WhatsApp → Zernio → API;
  - seção `#whatsapp`;
  - seção `#zernio`;
  - redes sociais.
- **O endereço antigo `/whatsapp`** redireciona para `/integracoes#whatsapp`, e a página rola até a seção.
- **O menu não tem mais o item "WhatsApp".**
- **A API não mudou:** as rotas `/api/internal/whatsapp/*` são as mesmas.

## 15. Redes Sociais (2026-11-03)

Plano: `PLANO_MODULO_REDES_SOCIAIS.md`. Decisões: `DECISOES_TECNICAS.md` D-48 a D-51. Testado contra a Zernio **simulada**.

| Peça | Onde | O que faz |
|---|---|---|
| Tabelas | `packages/db/src/schema/app.ts` e `identity.ts` (migration `0006_social`) | `app.social_posts` (espelho das publicações); `identity.organizations.timezone`; `app.media_files.file_name`; `app.zernio_connections.posts_synced_at` |
| Contratos | `packages/contracts/src/social.ts`, `timezone.ts` | Caminhos e rotas do painel, regras de cada rede (`SOCIAL_RULES`, `socialRuleIssues`), entrada e saída, mensagens fixas por categoria de erro, métricas por rede, fuso |
| Adaptador | `apps/api/src/integrations/zernio-client.ts` (ampliado) | `uploadImage` (presign + PUT sem a chave), `createPost` (Idempotency-Key, 207), `getPost`, `updatePost`, `reschedulePost`, `deletePost`, `retryPost`, `unpublishPost`, `listPosts` (`updatedSince`, `fields`, `cursor`), métricas e pastas do Pinterest; `Retry-After` no 429 |
| Serviços | `apps/api/src/social/` | `social-common.ts` (espelho e formato público), `social-sync.ts` (sincronização incremental), `social-posts.ts` (publicar, agendar, editar, reagendar, cancelar, tentar de novo, remover da rede, listar), `social-overview.ts` (visão geral, contas, fuso, métricas, pastas), `social-media.ts` (biblioteca) |
| Rotas | `apps/api/src/routes/social.ts` | `/api/internal/social`: `GET /overview`, `GET /accounts`, `GET /accounts/:id/pinterest-boards`, `GET/POST /posts`, `GET/PUT/DELETE /posts/:id`, `POST /posts/:id/reschedule`, `/retry`, `/unpublish`, `GET/PUT /settings`, `GET /analytics?days=`, `GET /media`, `DELETE /media/:id`; origem verificada; 30 alterações/min por empresa |
| Simulador | `apps/api/src/testing/zernio-simulator.ts` (ampliado) | Posts, presign e armazenamento, nova tentativa, remoção, listagem com `updatedSince`, métricas (e 402), pastas; falhas por rede, atraso e falha numa rota |
| Telas | `apps/web/src/pages/social/`, `src/social/` | `SocialSection` (abas), `SocialOverviewTab`, `SocialComposer`, `SocialCalendarTab`, `SocialHistoryTab`, `SocialLibraryTab`, `SocialResultsTab`; `PostDetail` (painel lateral) e `PlatformBadge` (componente comum com Integrações) |

**Rotas do painel:** `/redes-sociais` (Visão Geral), `/criar` e `/criar/:id`, `/calendario`, `/historico` (filtros
`?status=&rede=&busca=&pagina=`), `/biblioteca`, `/resultados` e `/interacoes` ("em desenvolvimento").

**Fluxo de publicar agora:**
1. O painel confere as regras de cada rede e pede confirmação.
2. A API confere de novo, relê as contas no perfil da empresa e envia cada imagem à Zernio.
3. Ela chama `POST /v1/posts` com a `Idempotency-Key` e grava o espelho.
4. O painel mostra o resultado por rede (link ou motivo).

**Banco embutido:** só um processo por pasta (trava `.lock`, D-51).

## 16. Inbox, etapa I1: WhatsApp (2026-11-04)

Plano: `PLANO_MODULO_INBOX.md` (decisões N1 a N8). Base técnica: `HOMOLOGACAO_I0_EVOLUTION.md`. Decisões: `DECISOES_TECNICAS.md`
D-52 a D-55. Testado só contra a Evolution Go **simulada** (com WebSocket). **Recebimento desligado por padrão:** as variáveis
`INBOX_EVENTS_ENABLED` e `INBOX_ACTIVATION_ENABLED` ficam `false` até a homologação (procedimentos P0 a P7).

| Peça | Onde | O que faz |
|---|---|---|
| Tabelas | `packages/db/src/schema/inbox.ts` e `app.ts` (migration `0007_inbox`) | `inbox_contacts`, `inbox_contact_identities` (número e LID do mesmo contato), `inbox_conversations` (modo e versão de controle, responsável, não lidas, prévia), `inbox_messages` (únicas por id do canal e por pedido do painel), `inbox_pending_receipts` (recibo antes da mensagem), `inbox_reception_gaps` (períodos sem recebimento), `inbox_conversation_events` (quem assumiu, troca de modo, reabertura); `whatsapp_instances.inbox_enabled_at` |
| Contratos | `packages/contracts/src/inbox.ts` | Caminhos, rotas do painel, modos de controle com nomes, situações, limites, canais e recebimento, conversa, mensagem, filtros, envio (`requestId` + texto), aviso do tempo real |
| Cliente WebSocket | `apps/api/src/integrations/ws-client.ts` | RFC 6455 mínimo, só leitura: recusa 401/403 vira `auth_failed`, TLS sempre verificado, ping 30 s e prazo de pong, limite por mensagem, URL nunca registrada |
| Adaptador | `apps/api/src/integrations/whatsapp-provider.ts` (ampliado) | `configureInboxEvents(token, ligar)` → `POST /instance/connect` com `subscribe` e `websocketEnable` (ou `{}` para voltar ao padrão); `startConnection` mantém a configuração quando a Inbox está ligada |
| Consumidor | `apps/api/src/inbox/evolution-events.ts` | Uma conexão em modo difusão; aceita só instâncias do DisparaZap com a Inbox ligada (o resto é descartado antes de gravar); confere o `instanceToken` com o cofre; fila única de processamento; reconexão com espera crescente; lacunas; não insiste com chave recusada |
| Gravação | `apps/api/src/inbox/inbox-ingest.ts` | `Message`, `SendMessage` e `Receipt` → contato, conversa e mensagem, sem duplicar e sem retroceder com eventos fora de ordem; eco do envio casado com a mensagem pendente; mídia só com tipo e legenda |
| Serviço | `apps/api/src/inbox/inbox-service.ts` | Canais e recebimento, conversas com filtros e visibilidade por papel, histórico, lida, envio idempotente que assume o atendimento, ligar/desligar o recebimento, trava das respostas automáticas (`canDeliverAutomated`) |
| Avisos | `apps/api/src/inbox/inbox-bus.ts` | Barramento em memória por empresa (só ids), usado pelo SSE e, no futuro, por IA e automações |
| Rotas | `apps/api/src/routes/inbox.ts` | `/api/internal/inbox`: `GET /channels`, `POST/DELETE /channels/:id/activate`, `GET /conversations`, `GET /conversations/:id`, `POST /conversations/:id/read`, `POST /conversations/:id/messages`, `GET /stream` (SSE); origem verificada; 60 respostas/min e 10 ativações/min por empresa |
| Simulador | `apps/api/src/testing/evolution-simulator.ts` (ampliado) | `/ws` (só a chave global; 401 sem upgrade), entrega só com WebSocket ligado e evento assinado, `emit`, queda abrupta, fechamento combinado, ping, troca da chave, registro do `/instance/connect` |
| Telas | `apps/web/src/pages/inbox/InboxPage.tsx`, `src/inbox/` | Três colunas (conversas, conversa, detalhes); avisos de recebimento e lacunas; `inbox-api.ts` (HTTP e `EventSource`); `inbox-ui.tsx` (situação das mensagens, quem enviou, datas, ícone do canal); botão "Receber mensagens na Inbox" em `WhatsAppPage.tsx` (Integrações) |

**Rotas do painel:** `/inbox` (lista), `/inbox/:id` (conversa) e `/inbox/:id/detalhes` (detalhes do contato). Abaixo de 960 px,
uma coluna por vez, escolhida pelo endereço (`data-view`); entre 960 e 1279 px, os detalhes abrem por cima da conversa.

**Fluxo de recebimento:** Evolution `/ws` (difusão) → filtro de instância autorizada → conferência do token → gravação
idempotente → aviso no barramento → SSE para os painéis da empresa (o atendente só recebe as conversas dele e as sem responsável)
→ o painel relê pela API.

**Fluxo de resposta:** painel (`requestId`) → API grava "enviando" e assume o atendimento → `/send/text` com o token da
instância (cofre) → "enviada" com o id do WhatsApp → recibos mudam para "entregue" e "lida".

## 17. Automações de redes, etapa A1 (2026-11-05)

| Parte | Onde | O que faz |
|---|---|---|
| Contrato | `packages/contracts/src/automations.ts` | Caminhos, limites da Zernio, capacidade por rede, lista e detalhe |
| Cliente | `apps/api/src/integrations/zernio-client.ts` | `listCommentAutomations` e `getCommentAutomation`, com formato tolerante |
| Serviço | `apps/api/src/automations/automations-service.ts` | Chave e contas da empresa, conferência da conta de cada automação, totais |
| Rotas | `apps/api/src/routes/automations.ts` | `GET /api/internal/automations/overview` e `GET /api/internal/automations/comment/:id`, 120 leituras/min por empresa |
| Tela | `apps/web/src/pages/automations/`, `src/automations/` | Seção "Redes sociais" da página Automações: números, lista, contas, modelos e detalhe (`/automacoes/:id`) |
| Simulador | `apps/api/src/testing/zernio-simulator.ts` | Automações cruas, vazamento de outro perfil e modos de erro (403, 503, formato estranho) |

Sem tabela nem migração (D-65). Trava `AUTOMATIONS_WRITE_ENABLED` (padrão `false`).

**Etapa A2 (2026-11-05):** rotas `POST /api/internal/automations/comment`, `PUT` e `DELETE /comment/:id` e `POST /comment/:id/state` (30 alterações/min por empresa); construtor em `apps/web/src/pages/automations/AutomationBuilder.tsx` (`/automacoes/nova` e `/automacoes/:id/editar`); simulador com criar, alterar e excluir e as regras por rede da documentação oficial.

**Etapa A3 (2026-11-05):** o contrato ganha `trigger` (`comment` ou `story_mention`) e `followGate` na entrada, `followGate` no detalhe e `followGateSent`/`followGatePassed` nas estatísticas; o construtor ganha o seletor "O que dispara" e o cartão Verificação; o simulador recusa gatilhos de story fora do Instagram e verificação nas redes só de resposta pública.

**Etapa A5 (2026-11-05):** rotas `GET /api/internal/automations/flows`, `POST /flows` (201), `POST /flows/:id/state` e `DELETE /flows/:id`, na mesma trava e nos mesmos papéis dos comentários; serviço em `apps/api/src/automations/automations-service.ts` (seção "Link ou QR"); cliente com `listWorkflows`, `createWorkflow`, `setWorkflowActive` e `deleteWorkflow`; construtor `apps/web/src/pages/automations/FlowBuilder.tsx` (rota `nova-fluxo`) e a seção "Links de conversa" em `AutomationsPage.tsx`. O simulador guarda os fluxos em memória. QR code do link (`GET .../flows/:id/qr`, biblioteca `qrcode` no `apps/api`, aprovada pelo dono); sem a alternativa "envie MENU" nesta etapa.

**Etapa A6 (2026-11-05):** rota `POST /api/internal/automations/flows/question` (201), na mesma trava e nos mesmos papéis dos fluxos de link; serviço `createQuestionFlow` e grafo `questionBody` em `apps/api/src/automations/automations-service.ts`; cliente com nó `wait_for_reply` e `sourceHandle`; construtor `apps/web/src/pages/automations/QuestionFlowBuilder.tsx` (rota `nova-pergunta`). A lista de fluxos passa a ter `kind` (`link`, `question`, `other`).

**Etapa A4 (2026-11-05):** rota `GET /api/internal/automations/comment/:id/activity`; serviço `automationActivity` (textos fixos por situação; comentários que não casaram só para dono e administradores); cliente com `listCommentAutomationLogs`; painel `AutomationActivityPanel` no detalhe, atualizado a cada 15 s (`ACTIVITY_REFRESH_MS`). O simulador guarda registros por automação e os comentários que não casaram.
