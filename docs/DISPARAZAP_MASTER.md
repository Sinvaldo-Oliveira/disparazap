# DisparaZap — Documento Mestre

> Fonte central de verdade sobre **o que o DisparaZap é, para onde vai e por que as decisões foram tomadas**.
> Atualize este arquivo sempre que uma decisão de produto ou arquitetura for tomada.
> Nunca registre aqui senhas, tokens, chaves de API, URLs privadas de servidores ou dados pessoais reais.

| | |
|---|---|
| **Fase atual** | MVP local (disparador de texto via Evolution Go) com correções de segurança da Fase 3 ([SEGURANCA_MVP.md](SEGURANCA_MVP.md)); git local com o original (`908ca2f`) e as correções em commits próprios |
| **Próxima fase** | Fase 2 — arquitetura do SaaS **proposta, aguardando aprovação** ([ARQUITETURA_SAAS.md](ARQUITETURA_SAAS.md)) |
| **Hospedagem** | VPS Hostinger ([PLANO_IMPLANTACAO_HOSTINGER.md](PLANO_IMPLANTACAO_HOSTINGER.md)) |
| **Última atualização** | 2026-10-31 |

---

## 1. Visão

O DisparaZap vai evoluir de um disparador local de WhatsApp para um **painel SaaS multiempresa** que reúne,
em um só lugar, comunicação por WhatsApp, redes sociais, agentes de IA e automações, com API para integrar
outras plataformas (como a MyLinksss).

## 2. Mapa da documentação

| Arquivo | Finalidade | Quando atualizar |
|---|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | Instruções permanentes para o Claude Code | Quando mudarem regras de trabalho, stack ou estrutura |
| `docs/DISPARAZAP_MASTER.md` (este) | Visão, módulos, arquitetura e decisões | A cada decisão de produto ou arquitetura |
| [`docs/AUDITORIA_INICIAL.md`](AUDITORIA_INICIAL.md) | Retrato do projeto em 2026-10-31: o que existe e o que falta | Não atualizar; é um registro histórico (errata do `.env.example` em ARQUITETURA_SAAS §1.1) |
| [`docs/ARQUITETURA_SAAS.md`](ARQUITETURA_SAAS.md) | Diagnóstico de segurança, stack, autenticação, multi-tenancy, modelo de dados e plano incremental do SaaS | Quando a arquitetura mudar ou uma decisão D1–D10 for tomada |
| [`docs/PLANO_IMPLANTACAO_HOSTINGER.md`](PLANO_IMPLANTACAO_HOSTINGER.md) | Containers, rede, HTTPS, segredos, backup, monitoramento, deploy e homologação na VPS | Quando a infraestrutura mudar ou uma decisão I1–I7 for tomada |
| [`docs/SEGURANCA_MVP.md`](SEGURANCA_MVP.md) | Correções de segurança do MVP, regra de telefone, riscos pendentes, proposta de limites de envio, testes e reversão | A cada mudança de segurança no MVP |
| [`docs/CHANGELOG_DESENVOLVIMENTO.md`](CHANGELOG_DESENVOLVIMENTO.md) | Registro cronológico das alterações | A cada alteração de código ou documentação |
| [`doc_evolution_go.md`](../doc_evolution_go.md) | Referência da API Evolution Go | Quando a API mudar |

---

## 3. Módulos planejados

| Módulo | Escopo | Situação |
|---|---|---|
| **Painel SaaS** | Super Admin, Empresas, Usuários, papéis e permissões | 📐 Arquitetura proposta |
| **WhatsApp** | Evolution Go: instâncias, QR Code/pareamento, status, envio e recebimento | 🟨 Parcial (listar instâncias + enviar texto, com TLS verificado) |
| **Redes sociais** | Zernio, conectada por conta de usuário (Instagram, Facebook, TikTok) | ⬜ Não iniciado |
| **Agentes de IA** | Personalidade, base de conhecimento e regras de atendimento | ⬜ Não iniciado |
| **Automações** | Campanhas, filas, agendamentos e acompanhamentos (follow-ups) | 🟨 Parcial (campanha manual no navegador) |
| **API REST + Webhooks** | Integração com MyLinksss e outras plataformas | ⬜ Não iniciado |

### Observações por módulo

- **WhatsApp e redes sociais são integrações independentes.** A Zernio **não** passa pelo Evolution Go e vice-versa.
  Cada uma tem suas próprias credenciais, conexão e regras.
- **Zernio:** o que é possível fazer (publicar, mensagens, comentários etc.) em cada rede **depende da documentação
  da Zernio e das permissões de cada plataforma**. Nada deve ser prometido ou construído antes de confirmar isso na
  documentação oficial, que ainda não está no repositório.
- **Agentes de IA** dependem de o sistema **receber** mensagens (webhooks/eventos do Evolution Go), o que ainda não existe.
- **Automações** precisam rodar **no servidor**: hoje o disparo roda na aba do navegador e para se ela for fechada.

---

## 4. Arquitetura atual (MVP)

```
Navegador (index.html)                 Servidor local (server.js)            Evolution Go
┌──────────────────────────┐   HTTP    ┌──────────────────────────┐  HTTPS  ┌──────────────┐
│ Assistente de 5 etapas   │ ────────► │ GET  /                   │         │              │
│ Contatos, Excel, A/B     │           │ GET  /api/instances  ────┼───────► │ /instance/all│
│ Loop de disparo + log    │           │ POST /api/send/text  ────┼───────► │ /send/text   │
│ Token no localStorage    │           │ GLOBAL_API_KEY no .env   │         │              │
└──────────────────────────┘           └──────────────────────────┘         └──────────────┘
```

- Um usuário, uma máquina, sem banco de dados e sem login.
- Detalhes, limitações e achados de segurança: [AUDITORIA_INICIAL.md](AUDITORIA_INICIAL.md).

## 5. Arquitetura alvo

> **Proposta detalhada (aguardando aprovação):** [ARQUITETURA_SAAS.md](ARQUITETURA_SAAS.md). Resumo da recomendação:
> monólito modular em Node.js 24 + TypeScript (Fastify), PostgreSQL 17 com Row Level Security, Redis + BullMQ com o banco
> como fonte da verdade, processo `worker` separado para campanhas, frontend React + Vite, Caddy com HTTPS e Docker Compose
> em VPS Hostinger. O diagrama abaixo é a visão conceitual.

```
                        ┌───────────────────────────────┐
  Usuários ───────────► │ Painel web (multiempresa)     │
                        └──────────────┬────────────────┘
                                       │
                        ┌──────────────▼────────────────┐       ┌─────────────────────┐
  MyLinksss e outras ─► │ API do DisparaZap             │ ────► │ Banco de dados      │
  (API REST pública)    │ autenticação · permissões     │       │ (isolado por        │
                  ◄──── │ webhooks de saída             │       │  empresa)           │
                        └──────┬───────────────┬────────┘       └─────────────────────┘
                               │               │
                 ┌─────────────▼───┐   ┌───────▼─────────────┐
                 │ Fila + workers  │   │ Agentes de IA       │
                 │ campanhas,      │   │ (provedor a definir)│
                 │ follow-ups      │   └─────────────────────┘
                 └──┬───────────┬──┘
                    │           │
          ┌─────────▼──┐   ┌────▼──────┐
          │ Evolution  │   │ Zernio    │      ◄── eventos/webhooks de entrada
          │ Go         │   │           │
          └────────────┘   └───────────┘
```

## 6. Princípios de arquitetura

1. **Isolamento por empresa:** todo dado (contatos, campanhas, instâncias, conversas) pertence a uma empresa,
   e nenhuma consulta pode cruzar empresas.
2. **Segredos só no servidor:** chave global do Evolution Go, tokens de instância, credenciais da Zernio e chaves de IA
   nunca chegam ao navegador, nunca entram em documentação e são guardados criptografados.
3. **Integrações como adaptadores independentes:** Evolution Go, Zernio e provedor de IA ficam atrás de módulos
   próprios, para que um possa mudar sem afetar os outros.
4. **Trabalho longo roda no servidor:** campanhas e automações vão para uma fila com retomada, nunca para a aba do navegador.
5. **Tudo rastreável:** cada envio, falha e ação administrativa fica registrado.
6. **Proteção contra banimento e LGPD por padrão:** intervalos mínimos, opt-out e consentimento fazem parte do produto.
7. **Construir sobre o que existe:** antes de criar algo, verificar a [auditoria](AUDITORIA_INICIAL.md#8-o-que-aproveitar-no-saas)
   e este documento para não duplicar funcionalidades.

## 7. Papéis de usuário (proposta, a confirmar)

| Papel | Alcance |
|---|---|
| Super Admin | Toda a plataforma: empresas, planos, servidores, saúde do sistema |
| Admin da empresa | Usuários, instâncias, integrações e configurações da própria empresa |
| Operador | Campanhas, contatos e atendimento dentro da própria empresa |

## 8. Glossário

| Termo | Significado |
|---|---|
| Empresa | Cliente do SaaS; unidade de isolamento de dados |
| Instância | Uma conexão WhatsApp no Evolution Go (um número) |
| Token da instância | Credencial que autoriza operações em uma instância específica |
| Chave global | Credencial administrativa do servidor Evolution Go |
| Campanha | Envio de uma ou mais mensagens para uma lista de contatos |
| Variação (A/B) | Versão alternativa de uma mensagem, sorteada a cada envio |
| Follow-up | Mensagem automática de acompanhamento após um evento ou prazo |
| Agente de IA | Atendente automático com personalidade, conhecimento e regras próprias |

---

## 9. Decisões registradas

| Data | Decisão | Motivo |
|---|---|---|
| 2026-10-30 | MVP com Node.js + Express e frontend em HTML/CSS/JS puro em um único arquivo | Entrega rápida e estrutura mínima |
| 2026-10-30 | Escopo do MVP limitado ao `CLAUDE.md`: só texto; criação/conexão de instância fora do sistema | Escolha do dono do produto |
| 2026-10-30 | Chave global só no servidor; campos sensíveis removidos da lista de instâncias | Segurança |
| 2026-10-30 | Servidor entrega só o `index.html` (sem pasta estática) | Não expor `.env` nem código |
| 2026-10-30 | Disparo interrompido no primeiro erro de token (`not authorized`) | Evitar falhar contato por contato |
| 2026-10-31 | Zernio tratada como integração independente do Evolution Go | Credenciais, regras e capacidades diferentes |
| 2026-10-31 | Planejamento do SaaS baseado na auditoria do código real, sem implementar antes | Evitar duplicação e decisões sem base |
| 2026-10-31 | **Hospedagem em VPS Hostinger** | Decisão do dono do produto |
| 2026-10-31 | Topologia do Evolution Go na VPS será **verificada, nunca presumida**; endpoints só são implementados após confirmação na versão instalada | Evitar integração construída sobre suposições |
| 2026-10-31 | O SaaS é independente e se integra à MyLinksss **apenas por API REST e webhooks**; a MyLinksss não é modificada | Baixo acoplamento entre produtos |
| 2026-10-31 | Zernio e agentes de IA ficam **fora do primeiro MVP SaaS** (apenas planejados) | Priorizar a fundação |
| 2026-10-31 | Repositório **git local**, sem remoto; commits só com aprovação; estado original em commit próprio (`908ca2f`) + cópia em `backup/` | Versionar sem expor nada e sem perder o original |
| 2026-10-31 | MVP escuta só em `127.0.0.1` (`HOST` opcional) | O dono do produto confirmou uso exclusivo nesta máquina; o MVP não tem login |
| 2026-10-31 | Verificação TLS obrigatória com o Evolution; certificado próprio só via `EVOLUTION_CA_FILE` | Certificado real verificado (Let's Encrypt, válido até 2027-01-14) |
| 2026-10-31 | Respostas ao navegador por **lista de campos permitidos** | A lista de proibidos deixava passar campos aninhados e credenciais de proxy |
| 2026-10-31 | Regra de telefone explícita em `phone.js`: sem `+` só Brasil (55); outros países com `+`; nunca acrescenta DDI | Evitar envio ao destinatário errado |
| 2026-10-31 | Testes versionados com `node:test` (+ jsdom e SheetJS 0.20.3 oficial como dependências de desenvolvimento) | Recomendação Q2 da auditoria |

## 10. Decisões pendentes

Estas decisões precisam ser tomadas antes de iniciar o SaaS. As recomendações estão em
[ARQUITETURA_SAAS §12](ARQUITETURA_SAAS.md#12-decisões-que-precisam-de-aprovação) (D1–D10) e
[PLANO_IMPLANTACAO_HOSTINGER §16](PLANO_IMPLANTACAO_HOSTINGER.md#16-decisões-de-infraestrutura-que-precisam-de-aprovação) (I1–I7).

- [x] Hospedagem: VPS Hostinger (2026-10-31)
- [ ] Topologia do Evolution Go na VPS (depende do levantamento I1) e servidor compartilhado ou por empresa (D4)
- [ ] Stack do SaaS (D1), local do código (D2), autenticação (D3), fila (D5)
- [ ] Política de consentimento (D6) e campanha de teste obrigatória (D7)
- [x] Correções rápidas de segurança no MVP (D8) — V1, V2, V3, V7 e `.env.example` em 2026-10-31 ([SEGURANCA_MVP.md](SEGURANCA_MVP.md))
- [x] Commits locais do estado original (`908ca2f`) e das correções da Fase 3 (2026-10-31)
- [ ] Limites de envio no servidor (propostas P1–P5) e correções pendentes V6, V8, V9 ([SEGURANCA_MVP §5–6](SEGURANCA_MVP.md#5-riscos-pendentes))
- [ ] Domínio, tamanho das VPS, backup externo, CI e monitoramento (I2–I7)
- [ ] Planos, limites e cobrança
- [ ] Operações necessárias da Zernio, confirmadas na documentação oficial
- [ ] Provedor de IA e quem arca com o custo (D9)
- [ ] Escopo da integração com a MyLinksss (do lado do DisparaZap: API + webhooks)
- [ ] Destino do MVP local após o lançamento do SaaS

## 11. Roteiro proposto (ordem de dependência, sem datas)

**Primeiro MVP SaaS** — etapas 0 a 10, detalhadas com critérios de aceite em
[ARQUITETURA_SAAS §11](ARQUITETURA_SAAS.md#11-plano-incremental-do-primeiro-mvp-saas):

| # | Etapa | # | Etapa |
|---|---|---|---|
| 0 | Base: git + correções de segurança do MVP — **concluída em 2026-10-31** | 6 | Conexão segura com o Evolution Go |
| 1 | Fundação técnica (`saas/`, TS, Compose, testes) | 7 | Instâncias e QR Code |
| 2 | Autenticação e Super Admin | 8 | Contatos autorizados (consentimento) |
| 3 | Empresas e membros | 9 | Fila persistente, histórico e campanhas de teste |
| 4 | Autorização no backend (RBAC + RLS) | 10 | API preparada para integração (API keys, webhooks) |
| 5 | Banco próprio consolidado (migrations, backup) | | |

**Depois do primeiro MVP SaaS** (ordem a confirmar):

| Fase | Entrega | Depende de |
|---|---|---|
| Automações avançadas | Agendamento recorrente, follow-ups, janelas de envio | Etapa 9 |
| Agentes de IA | Atendimento automático sobre as conversas recebidas | Recebimento de eventos (etapa 7) + D9 |
| Redes sociais | Contas conectadas via Zernio | Documentação oficial da Zernio no repositório |
| API pública completa | Disparo de campanhas via API, mais eventos de webhook | Etapa 10 |
| Planos e cobrança | Limites por plano | Decisão de negócio |

> A ordem final é decisão do dono do produto.
