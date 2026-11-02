# Changelog de Desenvolvimento — DisparaZap

Registro cronológico das alterações no projeto, da mais recente para a mais antiga.

**Como registrar:** uma entrada por dia ou fase de trabalho, com data absoluta (`AAAA-MM-DD`) e itens agrupados em
**Adicionado**, **Alterado**, **Corrigido**, **Segurança**, **Documentação**. Diga o que mudou e por quê, citando os arquivos.
Nunca registre senhas, tokens, chaves, URLs privadas de servidores ou dados pessoais reais.

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
