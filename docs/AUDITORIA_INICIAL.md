# Auditoria Inicial — DisparaZap

| | |
|---|---|
| **Data** | 2026-10-31 |
| **Versão auditada** | `1.0.0` (MVP local, sem controle de versão git) |
| **Tipo** | Somente leitura e documentação — nenhuma funcionalidade foi alterada |
| **Próximo passo** | Usar este relatório para planejar a evolução para o painel SaaS (ver [DISPARAZAP_MASTER.md](DISPARAZAP_MASTER.md)) |

> Este documento é um **retrato do estado do projeto nesta data**. Não deve ser reescrito a cada mudança;
> as alterações posteriores vão para o [CHANGELOG_DESENVOLVIMENTO.md](CHANGELOG_DESENVOLVIMENTO.md).
> Nenhuma credencial, token, URL de servidor ou número de telefone real foi registrado aqui.

---

## 1. Resumo executivo

O DisparaZap hoje é um **disparador de mensagens de texto em massa para WhatsApp, de uso local e de um único usuário**.
Um servidor Node.js (`server.js`) funciona como proxy para a API Evolution Go e entrega uma única página (`index.html`)
com um assistente de 5 etapas: instância → contatos → mensagem → intervalo → disparo.

- **Funciona:** listar instâncias, importar contatos (manual e Excel), personalizar mensagens com `{nome}`, variações A/B,
  intervalo aleatório anti-bloqueio, disparo com progresso, log, parada e resumo final.
- **Validado:** proxy e interface testados contra um servidor Evolution Go simulado (59 verificações) e a listagem de
  instâncias foi confirmada contra o servidor Evolution Go real.
- **Não existe ainda:** usuários, login, empresas, banco de dados, fila no servidor, histórico, agendamento, recebimento de
  mensagens, agentes de IA, redes sociais (Zernio) e API pública.

**Conclusão:** o código atual é uma boa base de **lógica e experiência de disparo**, mas **não é uma base de arquitetura
para o SaaS**. A evolução exige backend com banco de dados, autenticação, multiempresa e um motor de campanhas no
servidor. Peças reaproveitáveis estão listadas na seção 8.

---

## 2. Escopo e método

| Item | Como foi verificado |
|---|---|
| Código-fonte | Leitura integral de `server.js`, `index.html`, `package.json`, `.env.example`, `.gitignore` |
| Documentação | Leitura de `CLAUDE.md` e `doc_evolution_go.md` |
| `.env` | **Não lido.** Apenas conferido que as 3 variáveis estão preenchidas (sem exibir valores) |
| Comportamento | Testes feitos durante a construção (2026-10-30): proxy contra Evolution simulado + interface completa em navegador headless (jsdom) |
| Servidor real | `GET /api/instances` respondeu com sucesso contra o Evolution Go real (instâncias listadas e conectadas) |
| Não verificado | Envio real de mensagem pelo servidor real; aparência visual no navegador; comportamento com listas grandes (milhares de contatos) |

---

## 3. Inventário

### Arquivos

| Arquivo | Linhas | Papel |
|---|---:|---|
| `server.js` | 189 | Proxy Express para o Evolution Go + entrega do `index.html` |
| `index.html` | 1.509 | Toda a interface: ~340 linhas de CSS e ~885 de JavaScript, embutidos |
| `CLAUDE.md` | — | Instruções permanentes para o Claude Code |
| `doc_evolution_go.md` | 936 | Referência da API Evolution Go (41 seções de endpoints) |
| `package.json` | — | Scripts `start` e `dev`; 2 dependências |
| `.env.example` | — | Modelo das variáveis `EVOLUTION_URL`, `GLOBAL_API_KEY`, `PORT` |
| `.gitignore` | — | Ignora `node_modules/` e `.env` |
| `.env` | — | Credenciais reais (fora do controle de versão; não auditado) |

### Dependências e ambiente

| Item | Versão |
|---|---|
| Node.js (máquina local) | 24.17 |
| express | 4.22.3 |
| dotenv | 16.6.1 |
| SheetJS (navegador, via CDN) | 0.20.3 |
| Banco de dados | nenhum |
| Testes automatizados no repositório | nenhum |
| Controle de versão (git) | **não inicializado** |

### Rotas do servidor local

| Rota | Destino no Evolution Go | Autenticação usada | Protegida por login? |
|---|---|---|---|
| `GET /` | — (entrega `index.html`) | — | Não |
| `GET /api/instances` | `GET /instance/all` | `GLOBAL_API_KEY` (só no servidor) | **Não** |
| `POST /api/send/text` | `POST /send/text` | Token da instância (header `X-Instance-Token`) | **Não** |

---

## 4. Funcionalidades existentes

| Etapa | Funcionalidade | Situação | Onde |
|---|---|---|---|
| 1 Instância | Carregar instâncias com indicador 🟢/🔴 | ✅ Pronto | `loadInstances`, `isConnected` |
| 1 Instância | Token com mostrar/ocultar e salvar no `localStorage` | ✅ Pronto | `saveToken`, `onInstanceChange` |
| 2 Contatos | Cadastro manual com validação (10–15 dígitos) e sem duplicados | ✅ Pronto | `addManualContact`, `normalizePhone` |
| 2 Contatos | Importação Excel com detecção automática de colunas, preview e seletor | ✅ Pronto | `handleFile`, `detectColumns`, `importExcel` |
| 2 Contatos | Tabela com remoção individual, limpar tudo e contador | ✅ Pronto | `renderContacts` |
| 3 Mensagem | Texto com `{nome}`, contador e pré-visualização estilo WhatsApp | ✅ Pronto | `renderMessage`, `showPreview` |
| 3 Mensagem | Variações A/B sorteadas a cada envio | ✅ Pronto | `getTemplates`, `addVariation` |
| 4 Intervalo | Mínimo/máximo aleatório, aviso abaixo de 5s, estimativa de duração | ✅ Pronto | `updateDelayUI`, `delayError` |
| 5 Disparo | Loop com progresso, contagem regressiva, parada limpa | ✅ Pronto | `startCampaign`, `waitInterruptible` |
| 5 Disparo | Log (máx. 500 linhas), resumo final, novo disparo | ✅ Pronto | `log`, `showPostSummary`, `newCampaign` |
| 5 Disparo | Interrupção automática em token recusado (`not authorized`) | ✅ Pronto | `startCampaign` |

### Integração Evolution Go

- **Usados:** 2 endpoints (`/instance/all`, `/send/text`) dos 79 que a documentação cita.
- A resposta real de `/instance/all` traz, além de `connected`, campos úteis para o futuro: `qrcode`, `events`, `webhook`,
  `disconnect_reason`, `alwaysOnline`, `rejectCall`, `readMessages`, `ignoreGroups`, `ignoreStatus`, `createdAt`.
- Criação de instância, QR Code e pareamento são feitos **fora do sistema** (curl/Postman), conforme o `CLAUDE.md`.

---

## 5. Segurança

| # | Achado | Severidade | Situação atual | Recomendação |
|---|---|---|---|---|
| S1 | O servidor escuta em **todas as interfaces de rede** (`app.listen(PORT)` sem host) e **não tem login** | 🔴 Alta | Qualquer pessoa na mesma rede que alcance a porta pode listar instâncias (usando a chave global no servidor) e disparar mensagens com um token | Escutar só em `127.0.0.1` enquanto for uso local; autenticação obrigatória no SaaS |
| S2 | Certificado TLS não é verificado (`rejectUnauthorized: false`) | 🟠 Média | Aceita qualquer certificado, inclusive de um intermediário malicioso | Tornar configurável e deixar a verificação ligada por padrão quando o servidor tiver certificado válido |
| S3 | Tokens de instância guardados em texto puro no `localStorage` | 🟡 Baixa (uso local) / 🔴 Alta (SaaS) | Aceitável para um usuário na própria máquina | No SaaS, tokens ficam só no servidor, criptografados e vinculados à empresa |
| S4 | SheetJS carregado de CDN sem verificação de integridade (SRI) | 🟡 Baixa | Uma CDN comprometida poderia injetar código na página | Adicionar `integrity` ou servir a biblioteca localmente |
| S5 | `GLOBAL_API_KEY` | ✅ OK | Nunca enviada ao navegador; campos sensíveis removidos de `/api/instances` | Manter |
| S6 | Arquivos do servidor | ✅ OK | Só `GET /` é servido; `.env`, `server.js` e `node_modules` retornam 404 | Manter |
| S7 | XSS | ✅ OK | Dados exibidos passam por `esc()`; testado com nome contendo HTML | Manter |
| S8 | CORS | ✅ OK | Não há cabeçalhos CORS liberados, então outros sites não leem as respostas | Manter fechado; liberar só para origens conhecidas na API pública |

---

## 6. Limitações funcionais

| # | Limitação | Impacto |
|---|---|---|
| L1 | O disparo roda **dentro da aba do navegador** | Fechar a aba, recarregar ou o computador hibernar interrompe a campanha, sem retomada |
| L2 | Contatos e mensagens **não são salvos** | Recarregar a página perde a lista (só token e última instância ficam no `localStorage`) |
| L3 | Sem histórico nem relatório exportável | Não há registro de quem recebeu o quê depois que a página fecha |
| L4 | Sem status de entrega/leitura | Nada escuta webhooks/eventos do Evolution Go |
| L5 | Só texto | Sem imagem, documento, áudio, enquete etc. |
| L6 | Número sem DDI é aceito se tiver 10–11 dígitos | Um número brasileiro sem `55` passa na validação e é enviado errado |
| L7 | Não verifica se o número tem WhatsApp antes de enviar | `/user/check` não é usado |
| L8 | Sem lista de bloqueio/descadastro (opt-out) | Risco de LGPD e de denúncias que levam a banimento |
| L9 | Uma instância por campanha | Sem rodízio entre números para distribuir volume |
| L10 | Sem agendamento | Disparo só começa com o clique |
| L11 | Status da instância é uma foto do momento do carregamento | Não acompanha quedas de conexão durante o disparo |

---

## 7. Qualidade e manutenção

| # | Ponto | Observação |
|---|---|---|
| Q1 | **Sem git** | Não há histórico nem como voltar atrás; o `CLAUDE.md` fala em "antes de commitar", mas não existe repositório |
| Q2 | Sem testes no repositório | Os testes da construção (simulador do Evolution + teste de interface) ficaram em pasta temporária e não foram versionados |
| Q3 | Frontend monolítico | 1.509 linhas em um só arquivo funcionam para o MVP, mas não para um painel com vários módulos |
| Q4 | Regra "editar apenas `index.html`/`server.js`" | Válida para o MVP; vai conflitar com a arquitetura SaaS e precisará ser revista quando ela for aprovada |
| Q5 | Inconsistência de documentação | O `CLAUDE.md` dizia que `/instance/status` retorna `data.status = "open"`, mas a `doc_evolution_go.md` mostra `data.connected` e `data.loggedIn` (corrigido no `CLAUDE.md` nesta auditoria) |
| Q6 | Sem README | O `CLAUDE.md` cumpre esse papel hoje |
| Q7 | Sem `engines` no `package.json` | O script `dev` usa `node --watch` (Node 18.11+) |
| Q8 | Pontos fortes | Código legível, funções pequenas e nomeadas, comentários só onde explicam o porquê, tratamento de erro com mensagens claras em português |

---

## 8. O que aproveitar no SaaS

| Peça | Onde está | Uso futuro |
|---|---|---|
| `proxyFetch` (HTTP nativo, redirects, timeout) | `server.js` | Cliente do Evolution Go no backend |
| `sanitizeInstance` | `server.js` | Filtrar dados sensíveis em qualquer resposta |
| Importação de Excel com detecção de colunas | `index.html` (`detectColumns`, `cellToString`) | Módulo de contatos/listas |
| Normalização de telefone | `normalizePhone` | Regra única de validação (com ajuste do DDI — L6) |
| Modelo de mensagem com `{nome}` e variações A/B | `renderMessage`, `getTemplates` | Motor de campanhas e automações |
| Intervalo aleatório + parada limpa | `waitInterruptible`, `startCampaign` | Regras do worker de fila no servidor |
| Experiência do assistente em 5 etapas | `index.html` | Fluxo de "Nova campanha" no painel |

---

## 9. Lacunas frente à visão SaaS

| Módulo planejado | Existe hoje | Falta |
|---|---|---|
| **Painel SaaS** (Super Admin, Empresas, Usuários) | Nada | Banco de dados, login, papéis e permissões, isolamento por empresa, limites/planos |
| **WhatsApp** (Evolution Go, instâncias, QR Code) | Listar instâncias e enviar texto | Criar/excluir instância, QR Code e pareamento na tela, status em tempo real, recebimento de eventos, tokens guardados no servidor por empresa, mídia, verificação de números |
| **Redes sociais** (Zernio por conta de usuário) | Nada; **sem documentação da Zernio no repositório** | Documentação oficial, modelo de conexão de contas, definição de quais operações a Zernio de fato suporta |
| **Agentes de IA** (personalidade, conhecimento, regras) | Nada | Recebimento de mensagens, base de conhecimento, escolha do provedor de IA, regras de transferência para humano |
| **Automações** (campanhas, filas, acompanhamentos) | Campanha manual no navegador | Fila no servidor, persistência, retomada, agendamento, follow-ups, histórico e relatórios |
| **API REST + Webhooks** (MyLinksss e outras) | 2 rotas internas sem autenticação | API pública versionada, chaves por empresa, webhooks de saída, documentação (OpenAPI) |

---

## 10. Riscos

| Risco | Comentário |
|---|---|
| Banimento de números no WhatsApp | Disparo em massa por API não oficial (Evolution Go/whatsmeow) sempre carrega esse risco; mitigação: intervalos, opt-out, aquecimento, rodízio |
| LGPD | Exige base legal para contato, opt-out e cuidado com dados pessoais (telefones, nomes, conversas) |
| Dependência da Zernio | Operações disponíveis e permissões de Instagram, Facebook e TikTok dependem da Zernio e das políticas de cada rede |
| Custo e privacidade de IA | Agentes enviam conversas de clientes a um provedor de IA; precisa de política clara por empresa |
| Migração | O MVP local deve continuar utilizável enquanto o SaaS é construído |

---

## 11. Recomendações (por prioridade, antes de construir o SaaS)

1. **Inicializar o git** e fazer o primeiro commit com o estado atual como linha de base.
2. **Corrigir S1** (escutar só em `127.0.0.1`): mudança de uma linha, sem impacto no uso local.
3. **Versionar os testes** (simulador do Evolution Go + teste da interface) em uma pasta `tests/`.
4. **Responder às perguntas da seção 12** e registrar as decisões no [DISPARAZAP_MASTER.md](DISPARAZAP_MASTER.md).
5. **Adicionar a documentação da Zernio** ao repositório, como foi feito com `doc_evolution_go.md`.
6. **Começar o SaaS pela fundação**: banco + autenticação + empresas/usuários + motor de campanhas no servidor.
   Os módulos de IA, redes sociais e API pública dependem dessa base.

---

## 12. Perguntas em aberto para o dono do produto

1. Onde o SaaS vai rodar (VPS, nuvem gerenciada)? No mesmo servidor do Evolution Go?
2. Todas as empresas vão usar **um servidor Evolution Go compartilhado**, ou cada empresa pode trazer o seu?
3. Há preferência de stack para o SaaS (manter Node.js? qual banco? frontend com framework?)
4. Haverá planos pagos/cobrança? Com quais limites (instâncias, mensagens, usuários)?
5. Quais operações são esperadas da Zernio: publicar posts, responder mensagens diretas, moderar comentários?
6. Qual provedor de IA para os agentes, e quem paga o uso (plataforma ou empresa cliente)?
7. O que a integração com a **MyLinksss** precisa fazer (sincronizar contatos, disparar campanhas por evento, outro)?
8. O MVP local deve continuar existindo depois que o SaaS estiver no ar?
