# DisparaZap — Documento Mestre

> Fonte central de verdade sobre **o que o DisparaZap é, para onde vai e por que as decisões foram tomadas**.
> Atualize este arquivo sempre que uma decisão de produto ou arquitetura for tomada.
> Nunca registre aqui senhas, tokens, chaves de API, URLs privadas de servidores ou dados pessoais reais.

| | |
|---|---|
| **Fase atual** | MVP local (disparador de texto via Evolution Go) com correções de segurança da Fase 3 ([SEGURANCA_MVP.md](SEGURANCA_MVP.md)); git local com o original (`908ca2f`) e as correções em commits próprios. **Fase 4 concluída:** fundação técnica do SaaS em `saas/`, registrada em commit local (2026-11-01) |
| **Próxima fase** | Fase 5 — banco de dados, autenticação e Super Admin. 5A.1 (auditoria) e 5A.2 (plano do **Supabase Cloud exclusivo**, [SUPABASE_CONFIGURACAO.md](../saas/docs/SUPABASE_CONFIGURACAO.md)) concluídas. **Autenticação implementada em 2026-11-01** (Better Auth: cadastro com empresa, login, três tipos de usuário), rodando com banco embutido. Também em 2026-11-01: integração global com a Evolution Go, **módulo WhatsApp das empresas** (instâncias e conexão por QR Code ou código; já usado pelo dono do produto com o servidor real) e **Envio de Mensagens** (disparador do MVP dentro do painel, com listas de contatos salvas por empresa; testado contra a Evolution simulada). Falta conectar ao Supabase, concluir a homologação do WhatsApp e testar um envio real pelo painel |
| **Hospedagem** | VPS Hostinger ([PLANO_IMPLANTACAO_HOSTINGER.md](PLANO_IMPLANTACAO_HOSTINGER.md)) |
| **Última atualização** | 2026-11-01 |

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
| [`saas/README.md`](../saas/README.md) | Instalação, execução e testes do SaaS | Quando mudarem comandos ou requisitos |
| [`saas/docs/ESTRUTURA_TECNICA.md`](../saas/docs/ESTRUTURA_TECNICA.md) | Arquitetura implementada do SaaS e responsabilidades de cada pasta | A cada mudança estrutural no `saas/` |
| [`saas/docs/DECISOES_TECNICAS.md`](../saas/docs/DECISOES_TECNICAS.md) | Decisões técnicas do SaaS, alternativas e versões utilizadas | A cada decisão técnica ou atualização de dependência |
| [`saas/docs/SUPABASE_CONFIGURACAO.md`](../saas/docs/SUPABASE_CONFIGURACAO.md) | Banco no Supabase: criação manual do projeto, conexões, papéis, RLS, Drizzle, autenticação pendente e testes | A cada mudança no banco ou nas configurações do Supabase |
| [`docs/CHANGELOG_DESENVOLVIMENTO.md`](CHANGELOG_DESENVOLVIMENTO.md) | Registro cronológico das alterações | A cada alteração de código ou documentação |
| [`doc_evolution_go.md`](../doc_evolution_go.md) | Referência da API Evolution Go | Quando a API mudar |

---

## 3. Módulos planejados

| Módulo | Escopo | Situação |
|---|---|---|
| **Painel SaaS** | Super Admin, Empresas, Usuários, papéis e permissões | 🟨 Parcial: fundação (Fase 4) + autenticação (2026-11-01). Já tem cadastro com empresa, login, sair e os tipos Super-Admin, Admin-Empresa e Admin-MyLinksss. Faltam 2FA, convites, recuperação de senha, permissões por tipo e entrada pelo MyLinksss |
| **WhatsApp** | Evolution Go: instâncias, QR Code/pareamento, status, envio e recebimento | 🟨 Parcial. **MVP:** lista instâncias e envia texto, com TLS verificado. **SaaS (2026-11-01):** integração global configurada pelo Super-Admin (endereço + chave cifrada + teste de conexão); cada empresa cria a sua instância e conecta o número por QR Code ou código de pareamento (já usado pelo dono do produto com o servidor real); o Super-Admin vê todas (só leitura); **Envio de Mensagens** no painel, com listas de contatos salvas por empresa (envio testado só contra a Evolution simulada) |
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

> **Implementado na Fase 4 (2026-10-31):**
> - monorepo `saas/` com API Fastify, painel React + Vite e worker em TypeScript;
> - pacotes `contracts` e `shared`;
> - sem banco, filas, autenticação ou integrações.
>
> Ver [ESTRUTURA_TECNICA.md](../saas/docs/ESTRUTURA_TECNICA.md) e [DECISOES_TECNICAS.md](../saas/docs/DECISOES_TECNICAS.md).
>
> **Banco (decisão de 2026-11-01):** PostgreSQL gerenciado pelo **Supabase Cloud**, num projeto exclusivo, separado do MyLinksss.
> Acesso só pelo backend, com Drizzle e RLS. A Data API do Supabase fica desativada. Isso substitui o PostgreSQL em contêiner na VPS
> descrito no resumo abaixo e na ARQUITETURA_SAAS. Ver [SUPABASE_CONFIGURACAO.md](../saas/docs/SUPABASE_CONFIGURACAO.md).
>
> **Proposta detalhada:** [ARQUITETURA_SAAS.md](ARQUITETURA_SAAS.md). Resumo da recomendação:
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
| 2026-10-31 | SaaS em `saas/`, monorepo npm workspaces independente da raiz; worker como aplicação própria (`apps/worker`); pacotes `contracts` e `shared` | Fase 4; não altera o MVP |
| 2026-10-31 | Node 24 mantido (Maintenance LTS desde 2026-10-20, suporte até 2028-04-30); avaliar Node 26 antes da primeira implantação | Calendário oficial do Node verificado |
| 2026-10-31 | TypeScript 7.0.2, Fastify 5, Zod 4, React 19 + Vite 8 + React Router 8, Vitest 5 | Versões estáveis mais recentes; detalhes em `saas/docs/DECISOES_TECNICAS.md` |
| 2026-10-31 | Erros da API em RFC 9457 desde a primeira rota; CORS por lista explícita (vazia por padrão); escuta em `127.0.0.1` | Segurança desde a fundação |
| 2026-11-01 | **Banco no Supabase Cloud**, projeto novo e exclusivo, em organização separada da do MyLinksss; substitui o PostgreSQL local e o contêiner na VPS | Decisão do dono do produto (Fase 5A.2) |
| 2026-11-01 | Supabase só como PostgreSQL: Data API desativada, acesso só pelo backend com papéis próprios sem `BYPASSRLS`; `postgres` e `service_role` fora da aplicação | Evitar que o RLS seja contornado por papéis privilegiados |
| 2026-11-01 | **Autenticação: Better Auth** (D3), dentro da API, com sessão em cookie `HttpOnly` no banco e senhas em argon2id | Escolha técnica delegada pelo dono do produto ao assistente; recomendação da 5A.2 |
| 2026-11-01 | **Três tipos de usuário:** Super-Admin (papel global), Admin-Empresa (cadastro direto, dono da empresa) e Admin-MyLinksss (empresa vinda do MyLinksss) | Pedido do dono do produto |
| 2026-11-01 | **Cadastro público** pela tela "Criar conta", que cria a conta e a empresa juntas | Pedido do dono do produto ("o usuário pode fazer o cadastro e entrar") |
| 2026-11-01 | **Super-Admin inicial = o mesmo do MyLinksss**, pelo mesmo e-mail (`SUPER_ADMIN_EMAIL`). Criado por comando de terminal; a senha do MyLinksss não é copiada | Pedido do dono do produto, sem guardar senhas de outro sistema |
| 2026-11-01 | **Entrar com a conta do MyLinksss** (quem tem a licença do módulo DisparaZap): requisito registrado, implementação pendente | Depende de como o MyLinksss autentica e expõe a licença; muda a decisão da 5A.2 de não tocar no projeto do MyLinksss (ver pendências) |
| 2026-11-01 | **Integração global com a Evolution Go configurada pelo Super-Admin** na página Configurações. A chave global fica **cifrada no banco** (AES-256-GCM, chave-mestra `SECRETS_MASTER_KEY` fora do banco). Revê a ARQUITETURA_SAAS §8.4, que previa a chave só como segredo do servidor | Pedido do dono do produto; mesma proteção já prevista para os tokens das instâncias (DECISOES_TECNICAS D-25) |
| 2026-11-01 | **Módulo WhatsApp das empresas** aprovado ([plano](../saas/docs/PLANO_MODULO_WHATSAPP.md)): **1 instância por empresa** (ajustável depois); **dono e administradores** gerenciam, operadores e visualizadores só veem; o **Super-Admin vê todas as instâncias, só leitura**; as **instâncias do MVP não são tocadas** nem mostradas às empresas | Decisões W1, W2, W5 e W6 do dono do produto |
| 2026-11-01 | Rotas da Evolution Go confirmadas no **Swagger da versão instalada** (só leitura, sem chave) antes de implementar; a **homologação real** (1 instância e 1 número de teste) fica para quando o dono do produto escolher | Decisões W3 e W4; ARQUITETURA_SAAS §5.2 |
| 2026-11-01 | **Envio de Mensagens** no menu, depois de Campanhas: o disparador do MVP trazido para o painel. Cada empresa usa as suas instâncias e as suas **listas de contatos salvas**, sem ver as das outras | Pedido do dono do produto |
| 2026-11-01 | Repositório **publicado no GitHub** (`origin`: `Sinvaldo-Oliveira/disparazap`). Commit e push continuam só com aprovação, sempre depois de uma varredura de segredos e dados reais | Pedido do dono do produto; substitui o "sem remoto" de 2026-10-31 |
| 2026-11-01 | Página **Contatos**: gestão das listas salvas da empresa (criar, renomear, excluir; adicionar à mão ou por Excel, editar e remover contatos), com **busca** nas listas e nos contatos de todas as listas. Cada alteração é **gravada na hora**. Consentimento e descadastro continuam para a Etapa 8 | Pedido do dono do produto; DECISOES_TECNICAS D-43 e D-44 |
| 2026-11-01 | Mensagem com **1 imagem** (o texto vai como legenda) e **CTA como link no fim do texto**; **modelos de mensagem** salvos por empresa para reutilizar | Escolhas do dono do produto entre as opções da Evolution Go (o botão clicável não aceita imagem junto e pode não aparecer em alguns aparelhos); DECISOES_TECNICAS D-41 e D-42 |
| 2026-11-01 | O disparo do Envio de Mensagens **roda na aba do navegador**, como no MVP (uma chamada à API por mensagem; sair da página interrompe). Disparo no servidor, com fila e histórico, fica para o módulo **Campanhas** | Escolha técnica do assistente; não depende de fila (D5) nem de serviço novo (DECISOES_TECNICAS D-36) |

## 10. Decisões pendentes

Estas decisões precisam ser tomadas antes de iniciar o SaaS. As recomendações estão em
[ARQUITETURA_SAAS §12](ARQUITETURA_SAAS.md#12-decisões-que-precisam-de-aprovação) (D1–D10) e
[PLANO_IMPLANTACAO_HOSTINGER §16](PLANO_IMPLANTACAO_HOSTINGER.md#16-decisões-de-infraestrutura-que-precisam-de-aprovação) (I1–I7).

- [x] Hospedagem: VPS Hostinger (2026-10-31)
- [ ] Topologia do Evolution Go na VPS (depende do levantamento I1) e servidor compartilhado ou por empresa (D4)
- [x] Stack do SaaS (D1) e local do código (D2) — aplicados na Fase 4 (2026-10-31)
- [x] Autenticação (D3): **Better Auth**, implementada em 2026-11-01 (comparação em
  [SUPABASE_CONFIGURACAO §7](../saas/docs/SUPABASE_CONFIGURACAO.md#7-autenticação--decisão-pendente-d3))
- [ ] Fila (D5)
- [ ] **Entrar com o MyLinksss:**
  - definir como o MyLinksss autentica (Supabase Auth?);
  - definir onde fica a licença do módulo DisparaZap;
  - autorizar a configuração do lado do MyLinksss (provedor OAuth/OIDC). Isso revê a regra da 5A.2 de não tocar no projeto do MyLinksss.
- [x] **Módulo WhatsApp das empresas** (Admin-Empresa e Admin-MyLinksss): criar instâncias e conectar números (QR Code ou
  pareamento) pela integração global. Aprovado e implementado em 2026-11-01 contra a Evolution simulada
  ([PLANO_MODULO_WHATSAPP.md](../saas/docs/PLANO_MODULO_WHATSAPP.md), etapas W1, W2 e W4).
- [x] Correções A1, A3, A4 e A5 da auditoria do login (2026-11-01).
- [ ] **Homologação real do módulo WhatsApp (W3):**
  - **feito pelo dono do produto em 2026-11-01:** criou instâncias reais pelo painel e conectou números. O uso mostrou o status
    preso em "Conectando" e o número ausente, corrigidos no mesmo dia (DECISOES_TECNICAS D-38);
  - **falta:** conferir o status corrigido, desconectar e excluir pelo painel.
- [ ] **Teste de envio real pelo Envio de Mensagens:** texto e imagem com CTA, para um número de teste do dono do produto, quando
  ele quiser.
- [ ] Imagens de mensagem sem uso: limpeza automática; armazenamento de objetos quando houver servidor público.
- [x] Envio de mensagens pelo painel: **Envio de Mensagens**, com listas de contatos salvas por empresa (2026-11-01).
- [ ] Módulo WhatsApp, próximos passos:
  - tela do Super-Admin para ajustar o limite de instâncias por empresa;
  - webhooks da Evolution (depois da VPS);
  - adoção das instâncias do MVP.
- [ ] **Campanhas no servidor:** fila (D5), histórico, agendamento e envio com a página fechada.
- [x] Página **Contatos** com gestão das listas, criação e busca (2026-11-01).
- [ ] **Contatos, próximos passos:**
  - consentimento e descadastro (D6);
  - busca sem acentos no servidor e índice de texto (com o Supabase);
  - exportar lista para Excel, se o dono do produto quiser.
- [ ] Cofre e auditoria:
  - cópia de segurança da `SECRETS_MASTER_KEY` no gerenciador de senhas;
  - rotação da chave-mestra;
  - tabela `audit_logs`.
- [ ] Menu: Configurações aparece como "Em desenvolvimento" também para o Super-Admin, que já tem a integração global ali.
- [ ] Autenticação, próximos passos:
  - 2FA obrigatório do Super-Admin;
  - provedor de e-mail transacional (recuperação de senha, verificação de e-mail, convites);
  - permissões por tipo de usuário;
  - papel `dz_auth` no Supabase.
- [ ] **Segurança local:** tirar do `.env` da raiz do MVP a chave `service_role`, o provável token de acesso pessoal do Supabase e os
  dados do Super-Admin do MyLinksss. O DisparaZap não usa nenhum deles; revogar se tiverem sido compartilhados.
- [x] Banco de dados: **Supabase Cloud exclusivo** (2026-11-01). Encerra a pendência aberta na auditoria 5A.1 (PostgreSQL local ×
  Docker); o PostgreSQL local do Windows não será usado.
- [ ] Supabase: criação manual da organização e do projeto `disparazap` e, se aprovado, do projeto `disparazap-test`
  (passo a passo em [SUPABASE_CONFIGURACAO §2](../saas/docs/SUPABASE_CONFIGURACAO.md#2-criação-manual-do-projeto-passo-a-passo)).
  O `.env` da raiz já tem a URL de um projeto: falta confirmar se é o projeto exclusivo do DisparaZap.
- [ ] Supabase: conectar a API. Para isso:
  - endereço PostgreSQL (modo sessão) e certificado no `saas/.env`;
  - SQL de preparação dos papéis;
  - aplicar a migration `0000_identity` com `npm run db:migrate`.
- [ ] Supabase: plano (Free no desenvolvimento, Pro antes de dados reais); IPv6 da VPS ou add-on de IPv4; provedor de e-mail
  transacional
- [ ] Atualizar a ARQUITETURA_SAAS (§3.2, §10) e o PLANO_IMPLANTACAO_HOSTINGER para o banco no Supabase
- [x] Registrar a Fase 4 em commit local (`feat: establish DisparaZap SaaS foundation`, 2026-11-01), depois de corrigir o tempo-limite dos testes de processo (ver [CHANGELOG](CHANGELOG_DESENVOLVIMENTO.md))
- [x] Descrever o `saas/` e a separação MVP/SaaS no `CLAUDE.md` (2026-11-01)
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
| 1 | Fundação técnica (`saas/`, TS, testes) — **concluída em 2026-10-31 (Fase 4)**; Docker Compose adiado para a fase de banco | 7 | Instâncias e QR Code |
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
