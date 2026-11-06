# Plano — módulo WhatsApp das empresas

| | |
|---|---|
| **Data** | 2026-11-01 |
| **Situação** | **Aprovado em 2026-11-01** com todas as recomendações da seção 8. W1, W2 e W4 concluídas; **W3 (homologação real) aguarda o momento que o dono do produto escolher** |
| **Base** | ARQUITETURA_SAAS §5.1 (adaptador), §5.2 (endpoints a verificar), §8.3 (`whatsapp_instances`); integração global já pronta (DECISOES_TECNICAS D-25 e D-26) |
| **Referência da API** | Swagger da versão instalada (W1). Ele diverge do `doc_evolution_go.md` em dois pontos (ver abaixo) |

> **2026-11-02:** a tela do WhatsApp passou para a página **Integrações** (seção logo abaixo dos cards), a pedido do dono do
> produto. O endereço `/whatsapp` leva para lá; a API e as regras não mudaram.

## Andamento (2026-11-01)

| Etapa | Situação |
|---|---|
| W1 | ✅ Swagger lido sem chave. Duas correções em relação à seção 5: **desconectar** é `DELETE /instance/logout`; **excluir** é `DELETE /instance/delete/{instanceId}`, pelo **ID** (não pelo nome). Tabela da ARQUITETURA §5.2 atualizada |
| W2 | ✅ Implementado contra a Evolution simulada: migration `0002_whatsapp`, adaptador, serviço, rotas, tela e 26 testes novos (17 da API e 9 da tela), além das correções A1, A3, A4 e A5 da auditoria do login (4 testes) |
| W3 | 🟨 **Em parte, pelo próprio dono do produto (2026-11-01):** criou instâncias reais pelo painel e conectou números. O uso mostrou o status preso em "Conectando" e o número ausente, corrigidos no mesmo dia (DECISOES_TECNICAS D-38). Falta conferir o status corrigido, desconectar e excluir |
| W4 | ✅ CHANGELOG, MASTER, DECISOES_TECNICAS (D-29 a D-35), ESTRUTURA_TECNICA (seção 10) e ARQUITETURA §5.2 |

As seções abaixo guardam o plano como foi aprovado. O que foi implementado está em `ESTRUTURA_TECNICA.md` §10.

---

## 1. Objetivo

Cada empresa (contas **Admin-Empresa** e **Admin-MyLinksss**) cria as próprias instâncias de WhatsApp e conecta os números por
**QR Code** ou por **código de pareamento**. Tudo passa pela integração global configurada pelo Super-Admin, sem que a empresa veja
a chave global, o endereço da Evolution Go ou os tokens das instâncias.

### Entra nesta etapa
- **Instâncias da empresa:**
  - listar as instâncias da própria empresa;
  - criar uma instância (nome de exibição);
  - conectar por QR Code: a imagem aparece na tela e é renovada até conectar;
  - conectar por código de pareamento: número com DDI, código de 8 dígitos na tela;
  - mostrar o status (conectado, aguardando, desconectado) e o número conectado;
  - desconectar e excluir.
- **Limite de instâncias por empresa.**
- **Super-Admin:** lista de todas as instâncias de todas as empresas, só leitura (decisão W5).

### Fica de fora (etapas seguintes)
- Enviar mensagens e campanhas pelo painel. O disparador atual (MVP) continua sendo o caminho de envio.
- Webhooks da Evolution Go (eventos em tempo real). Exigem a API num endereço público (VPS); até lá, o status é consultado
  periodicamente.
- Adotar as instâncias já existentes do MVP (ARQUITETURA_SAAS §5.1).
- Entrar com a conta do MyLinksss (pendência de autenticação). O módulo funciona igual para Admin-Empresa e Admin-MyLinksss.

---

## 2. Como funciona para a empresa (telas)

```
WhatsApp
├── Lista de instâncias (cartões): nome, número, status e ações
│     [+ Nova instância]  (desabilitado ao atingir o limite: "Seu plano permite N instâncias")
├── Nova instância: nome de exibição  →  criada como "Aguardando conexão"
├── Conectar
│     ├── Aba QR Code: imagem + "WhatsApp › Aparelhos conectados › Conectar aparelho";
│     │     renovada sozinha; contagem do tempo; ao conectar → "Conectado" e o número aparece
│     └── Aba Código: número com DDI (mesma regra de telefone do MVP) → código de 8 dígitos;
│           "WhatsApp › Aparelhos conectados › Conectar com número de telefone"
└── Ações: Desconectar (confirmação) · Excluir (confirmação digitando o nome)
```

- **Erros com mensagens claras e fixas:** "Integração global desativada: fale com o administrador", "O servidor de WhatsApp não
  respondeu", "Limite de instâncias atingido".
- **Integração global ausente ou desativada:** a tela explica isso e não oferece ações.

---

## 3. Regras de segurança

| Regra | Como |
|---|---|
| Chave global só no servidor | Usada apenas para criar e excluir instâncias, aberta do cofre na hora; nunca sai da API |
| Token próprio por instância | Gerado pelo DisparaZap (32 bytes aleatórios), guardado **cifrado** em `platform.integration_credentials` (`kind = instance_token`, com `organization_id`). Nunca vai ao navegador |
| Nomes no servidor compartilhado | `dz_<empresa>_<aleatório>` (ARQUITETURA §5.1): sem colisão entre empresas nem com as instâncias do MVP |
| Instâncias de fora não são tocadas | O módulo só age sobre instâncias registradas no banco do DisparaZap. Instâncias do MVP ou criadas à mão nunca aparecem para as empresas e nunca são alteradas |
| Isolamento entre empresas | Toda consulta filtra por `organization_id` da sessão. A empresa A não vê nem age sobre instâncias da empresa B (testes negativos obrigatórios). O RLS do banco entra com a conexão ao Supabase |
| Permissões | Criar, conectar, desconectar e excluir: papéis `owner` e `admin` da empresa. `operator` e `viewer`: só veem (decisão W2) |
| QR Code e código | Repassados só à empresa dona da instância, só enquanto ela aguarda conexão. Nunca gravados no banco nem no log |
| Respostas da Evolution | Nunca repassadas: a API devolve só campos permitidos (status, número, imagem do QR, código) |
| Rede | Mesmo cliente HTTP da integração global: TLS verificado, sem redirecionamentos, com tempo-limite |
| Limite e abuso | Limite de instâncias por empresa; limite de tentativas nas rotas de conexão (QR e pareamento) |

---

## 4. Dados (migration `0002_whatsapp`, só com aprovação)

**`app.whatsapp_instances`** (esquema `app`, o primeiro de dados de empresa):

| Coluna | Observação |
|---|---|
| `id`, `organization_id` | `organization_id NOT NULL`, chave composta `(organization_id, id)` |
| `provider_server_id` | Servidor da integração global (`platform.provider_servers`) |
| `provider_instance_name` | Nome na Evolution (`dz_…`), único por servidor |
| `display_name` | Nome escolhido pela empresa |
| `phone_e164` | Preenchido quando conecta (a partir do `myJid` do status) |
| `status` | `created`, `connecting`, `connected`, `disconnected` ou `error` (`text` + `CHECK`) |
| `credential_id` | Token da instância no cofre |
| `last_status_at`, `connected_at` | Datas de controle |
| `created_by`, `created_at`, `updated_at`, `deleted_at` | `deleted_at` para exclusão lógica |

**Limite:** coluna `max_whatsapp_instances` em `identity.organizations`. O padrão vem da decisão W1, e o Super-Admin poderá ajustar
depois.

---

## 5. Adaptador e API

**Adaptador `WhatsAppProvider`** (ARQUITETURA §5.1), implementado por `EvolutionGoProvider`. Cada operação depende de
confirmação na etapa W1:

| Operação | Evolution Go (segundo a documentação) | Credencial |
|---|---|---|
| `createInstance` | `POST /instance/create` `{ name, token }` | chave global |
| `startConnection` | `POST /instance/connect` (webhook omitido até haver endereço público) | token da instância |
| `getQrCode` | `GET /instance/qr` → `data.code` (imagem base64) | token da instância |
| `pairWithPhone` | `POST /instance/pair` `{ phone }` → `data.code` (8 dígitos) | token da instância |
| `getStatus` | `GET /instance/status` → `data.connected`, `data.loggedIn`, `data.myJid` | token da instância |
| `logout` | **Não aparece na documentação.** Confirmar no Swagger | token da instância |
| `deleteInstance` | `DELETE /instance/delete/{nome}` | chave global |

**Divergência já vista na documentação:** a criação mostra `webhook`/`webhookEvents`, e a conexão mostra
`webhookUrl`/`subscribe`. Só o Swagger da versão instalada decide.

**Rotas** (contratos em `packages/contracts`):

| Rota | Faz |
|---|---|
| `GET /api/internal/whatsapp/instances` | Lista as instâncias da empresa ativa |
| `POST /api/internal/whatsapp/instances` | Cria (respeitando o limite) |
| `POST …/:id/connect` | Inicia a conexão e devolve o QR |
| `GET …/:id/qr` | QR atual (enquanto aguarda conexão) |
| `POST …/:id/pair` | Código de pareamento para o número informado |
| `GET …/:id/status` | Status atualizado na Evolution |
| `POST …/:id/logout` | Desconecta |
| `DELETE …/:id` | Exclui |
| `GET /api/internal/platform/whatsapp/instances` | Super-Admin: todas as instâncias, só leitura |

- **Atualização do status:** o painel consulta a cada 3 s enquanto a instância aguarda conexão (máximo de 2 minutos) e ao
  abrir a tela. Webhooks substituem isso depois.
- **Proteção de origem:** igual às rotas atuais.

---

## 6. Testes (sem Evolution real)

- **Simulador da Evolution Go** ampliado: criar, conectar, QR, pareamento, status (aguardando → conectado), desconectar e
  excluir.
- **Isolamento A×B:** listar, conectar, desconectar e excluir instância de outra empresa → 404.
- **Permissões:**
  - `viewer`/`operator` não criam nem conectam;
  - Super-Admin só lê a lista geral;
  - sem login → 401.
- **Limite:** a instância além do limite é recusada.
- **Segredos:** o token da instância e a chave global nunca aparecem em resposta, log ou HTML; o QR não é gravado.
- **Nomes:** prefixo `dz_` e unicidade.
- **Falhas da Evolution:** fora do ar, chave recusada, resposta inesperada → mensagens fixas; nada fica pela metade (se a
  criação falhar na Evolution, o registro não fica no banco).
- **Painel:**
  - lista;
  - nova instância;
  - abas QR/Código;
  - atualização até "Conectado";
  - desconectar e excluir com confirmação;
  - estados de integração ausente e de limite.

---

## 7. Etapas

| # | Etapa | Toca a Evolution real? | Autorização |
|---|---|---|---|
| **W1** | Confirmar as rotas no **Swagger da versão instalada** (`/swagger/doc.json`): caminhos, campos, respostas e a rota de logout. Atualizar a tabela da ARQUITETURA §5.2 | Só leitura da documentação do servidor; nenhuma chave, nenhuma instância | Decisão W3 |
| **W2** | Backend, migration `0002`, adaptador, rotas, tela e testes, **contra o simulador** | Não | Aprovação deste plano |
| **W3** | **Homologação controlada:** criar 1 instância de teste (`dz_teste_…`), conectar um número de teste do dono do produto, conferir status, desconectar e excluir | Sim: cria e exclui 1 instância | Decisão W4 |
| **W4** | Documentação: CHANGELOG, MASTER, DECISOES e ESTRUTURA | Não | — |

**Recomendação:** antes de abrir o painel para empresas reais, aplicar as correções pendentes da auditoria de login (A1, A3, A4,
A5).

---

## 8. Decisões para o dono do produto

| # | Decisão | Recomendação |
|---|---|---|
| W1 | Limite de instâncias por empresa | **1 por padrão**, ajustável depois pelo Super-Admin |
| W2 | Quem cria, conecta e exclui | **Owner e Admin** da empresa; Operator e Viewer só veem |
| W3 | Ler o Swagger do servidor Evolution real (só leitura, sem chave) | **Autorizar**: a arquitetura exige essa confirmação antes de implementar |
| W4 | Homologação com 1 instância e 1 número de teste seus | **Autorizar** depois da W2 pronta |
| W5 | Super-Admin vê a lista de todas as instâncias nesta etapa | **Sim**, só leitura |
| W6 | Instâncias já existentes do MVP | **Não tocar** e não mostrar às empresas; adoção fica para depois |
