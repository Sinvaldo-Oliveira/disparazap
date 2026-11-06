# Homologação I0 — Evolution Go para a Inbox (WhatsApp)

| | |
|---|---|
| **Data** | 2026-11-03 |
| **Plano** | `PLANO_MODULO_INBOX.md`, etapa I0. Decisões N1 a N8 aprovadas pelo dono do produto nesta data (com as ressalvas na seção 1) |
| **Escopo** | Validar os requisitos da Inbox no WhatsApp **sem implementar nada** |
| **O que foi tocado** | Nada no sistema: nenhum código, banco, variável de ambiente, instância, configuração da Evolution ou mensagem. Nenhuma conexão com o servidor Evolution real |
| **Fontes** | Código-fonte oficial da Evolution Go (`github.com/evolution-foundation/evolution-go`), **comparado nas 4 versões publicadas: 0.6.1, 0.7.0, 0.7.1 e 0.7.2**; wiki oficial (`docs/wiki/recursos-avancados/events-system.md`); código do DisparaZap; teste local com servidor simulado (seção 7) |

---

## 1. Decisões aprovadas (registro)

| # | Decisão | Observação do dono do produto |
|---|---|---|
| N1 | Ordem I0 → I1 → I2 → I3 → I5 → I6 → I4 → I7 → I8 → I9 | — |
| N2 | WebSocket agora, webhook depois | Webhook sujeito a validação de segurança |
| N3 | Papéis existentes (dono/admin = administrador; operador = atendente; visualizador sem Inbox) | — |
| N4 | Atendente vê as conversas dele e a fila sem responsável | — |
| N5 | Mídias recebidas | **Revisar, priorizando armazenamento privado de objetos** (substitui a proposta "até 5 MB no banco") |
| N6 | Retenção de 12 meses | Sujeita à definição da política e à validação jurídica |
| N7 | `ws` só como dependência de desenvolvimento | Em etapa posterior; a seção 7 mostra que talvez nem seja preciso |
| N8 | Homologação só controlada | Cada passo no servidor real com autorização específica (seção 8) |

---

## 2. Resultado das 10 verificações

| # | Verificação | Resultado |
|---|---|---|
| 1 | Versão da Evolution Go configurada | ⏳ **Pendente.** O projeto nunca registrou a versão. O Swagger lido na W1 não teve a versão anotada, e a URL do servidor fica só no banco e no cofre. Ler `/swagger/doc.json` exige conectar ao servidor real (procedimento P1) |
| 2 | Ambiente de homologação isolado | ❌ **Não existe.** Há um só servidor Evolution, real, compartilhado com as instâncias do MVP e com as 2 instâncias que o dono do produto criou pelo painel (em uso). O isolamento possível é por **instância de teste com um número de teste**, nesse mesmo servidor (P3) |
| 3 | Autenticação do WebSocket | ✅ **Confirmada no código das 4 versões (0.6.1 a 0.7.2), idêntica:** `GET /ws?token=…&instanceId=…` aceita **só a chave global** (`token == GLOBAL_API_KEY`); token de instância é recusado com 401. O `doc_evolution_go.md` e a wiki dizem o contrário (divergência). Ainda falta confirmar a versão real do servidor (P1) |
| 4 | Eventos de recebidas, enviadas e recibos | ✅ Confirmados no código (seção 4) |
| 5 | Reconexão | ✅ Avaliada no código e testada localmente (seções 5 e 7). Há uma **falha da Evolution no modo por instância** que pode silenciar eventos depois de uma reconexão: a estratégia escolhida a evita |
| 6 | Identificar as instâncias de cada empresa | ✅ O evento traz `instanceId` = o ID da instância na Evolution (`cd.Instance.Id`), que o DisparaZap já guarda em `app.whatsapp_instances.provider_instance_id`, com a empresa (`organization_id`) |
| 7 | Segurança da chave global | ✅ Avaliada (seção 6). **Dois riscos novos:** a chave vai na URL (pode ir para logs de proxy) e um token **errado** é gravado em texto puro no log da Evolution |
| 8 | `/instance/connect` numa instância conectada | ✅ **Confirmado no código das 4 versões:** grava as novas configurações e, se o cliente está em execução, aplica na hora (`UpdateInstanceSettings`) **sem reiniciar nem desconectar**. Falta confirmar no servidor real com a instância de teste (P4) |
| 9 | Perda de mensagens em indisponibilidades | ✅ Riscos mapeados (seção 5.3) |
| 10 | Recursos para testar com Evolution simulada | ✅ **Testado localmente:** o cliente WebSocket nativo do Node 24 e um servidor mínimo próprio (sem nenhuma dependência) bastam. 7 de 7 verificações OK (seção 7) |

---

## 3. Compatibilidade do WebSocket

| Item | Comportamento (0.6.1 a 0.7.2, sem diferença entre versões) |
|---|---|
| Endereço | `GET /ws` no próprio servidor da Evolution (fora do Swagger). Com o servidor em HTTPS, a conexão é `wss://` (TLS verificado pela cadeia pública; o SaaS não tem certificado próprio para a Evolution) |
| Parâmetros | `token` (obrigatório, **chave global**); `instanceId` (opcional). Com `instanceId`, modo **por instância**; sem ele, modo **difusão** (todas as instâncias) |
| Formato das mensagens | Texto JSON `{ "queue": "<idInstância>.<evento em minúsculas>", "payload": "<JSON em texto>" }`. O `payload` é o mesmo do webhook: `{ event, data, instanceId, instanceName, instanceToken }` |
| Quando há entrega | **Só se a instância tiver `websocketEnable = "enabled"`** e o evento estiver no `subscribe` dela. Isso vale para os dois modos (a difusão também só recebe instâncias com WebSocket ligado) |
| Instâncias atuais do painel | Conectadas com corpo vazio (D-31): `subscribe` vazio vira `MESSAGE`, mas `websocketEnable` e `webhook` vazios → **nenhum evento é entregue hoje** |
| Do servidor para o cliente | Só envio; o servidor **não faz ping**. Mensagens do cliente são lidas e descartadas (servem como sinal de vida) |
| Reenvio | **Nenhum.** O que acontece com o cliente desligado é perdido |
| Várias conexões | Por instância: **uma por instância**, a última substitui a anterior. Difusão: várias, todas recebem |

---

## 4. Eventos disponíveis

**Categorias** usadas no `subscribe`: `MESSAGE`, `SEND_MESSAGE`, `READ_RECEIPT`, `PRESENCE`, `HISTORY_SYNC`, `CHAT_PRESENCE`,
`CALL`, `CONNECTION`, `LABEL`, `CONTACT`, `GROUP`, `NEWSLETTER`, `QRCODE`, `BUTTON_CLICK`, `PICTURE`, `USER_ABOUT` (ou `ALL`).

| Evento recebido | Categoria | O que é | Uso na Inbox |
|---|---|---|---|
| `Message` com `Info.IsFromMe = false` | `MESSAGE` | Mensagem **recebida** do contato | Entra na conversa como recebida |
| `Message` com `Info.IsFromMe = true` | `MESSAGE` | Mensagem enviada **pelo celular** ou outro aparelho do número | Entra como enviada, autor "celular" (**correção do plano:** não é `SendMessage`) |
| `SendMessage` | `SEND_MESSAGE` | Mensagem enviada **pela API da Evolution** (inclusive as do DisparaZap) | Confirma o envio do DisparaZap pelo id (`Info.ID`); envio de outro sistema na mesma instância também aparece |
| `Receipt` com `state` `Delivered`, `Read` ou `ReadSelf` | `READ_RECEIPT` | Entregue, lida pelo contato, lida pelo próprio número | Situação da mensagem enviada; `ReadSelf` zera as não lidas |
| `HistorySync` | `HISTORY_SYNC` | Histórico enviado pelo WhatsApp (no pareamento ou por `POST /chat/history-sync`) | Possível recuperação de lacunas (a homologar, P6) |
| `Connected`, `Disconnected`, `LoggedOut`, `TemporaryBan` | `CONNECTION` | Situação da conexão | Atualiza a instância sem consulta periódica; alerta na Inbox |

**Campos de `Message` usados pela Inbox:**
- `data.Info`: `Chat`, `Sender`, `SenderAlt`, `IsFromMe`, `IsGroup`, `ID`, `Timestamp`, `PushName`;
- `data.Message`: o conteúdo (`conversation`, `extendedTextMessage`, `imageMessage`…) e, em mídia, `base64` ou `mediaUrl` +
  `mimetype`.
- `Chat` pode vir como número (`…@s.whatsapp.net`) ou **LID** (`…@lid`); a Evolution troca para o número quando recebe os dois
  (desde a 0.5.2).
- Grupos (`@g.us`) e status (`@broadcast`) chegam se não forem ignorados.

---

## 5. Reconexão e perda de mensagens

### 5.1 O que o código mostra

- **O servidor não manda ping** e, quando a escrita falha, **não remove a conexão** ("não remove o cliente aqui"). Uma
  conexão morta sem aviso (queda de rede) fica registrada até o sistema operacional desistir dela, e os eventos desse período
  se perdem.
- **Falha no modo por instância:**
  - `RemoveClient(instanceId)` apaga o registro **pelo id da instância, sem conferir qual conexão**;
  - se o DisparaZap reconectar antes de o servidor perceber o fim da conexão antiga, a limpeza da antiga apaga a nova;
  - **a nova conexão fica aberta, mas não recebe mais nada**, e nada avisa.
- **No modo difusão** a remoção compara a conexão exata: essa falha não acontece.

### 5.2 Comportamento testado localmente (seção 7)

O cliente nativo do Node 24:
- percebe a queda do servidor (evento `close`);
- reconecta e volta a receber;
- trata a recusa da chave como erro, sem abrir a conexão.

### 5.3 Riscos de perda de mensagens

| Situação | Efeito | Mitigação proposta |
|---|---|---|
| API do DisparaZap desligada ou reiniciando (publicação, falha) | Eventos do período perdidos (WebSocket sem reenvio) | Reinício rápido; registro da lacuna por instância e aviso na Inbox; depois do HTTPS, **webhook também** (5 tentativas a cada 30 s) com deduplicação; avaliar `history-sync` (P6) |
| Queda de rede sem aviso | Perdas até a conexão ser dada como morta | Sinal de vida do cliente a cada 30 s; reconexão se não houver resposta de fechamento; reconexão periódica preventiva |
| Reconexão no modo por instância | Conexão "muda" (falha 5.1) | **Usar o modo difusão** (seção 6.2) |
| Servidor Evolution reiniciando | O WhatsApp guarda as mensagens do aparelho desconectado e as entrega na volta | Reconectar o WebSocket antes; nada a fazer além disso |
| Mídia que a Evolution não conseguiu baixar | Evento chega sem `base64` | Mensagem gravada com "mídia indisponível" e opção de baixar depois (`/message/downloadmedia`, a homologar) |
| Mensagem muito grande (vídeo em base64) | Uso de memória no único processo | Limite por tipo no consumidor; armazenamento privado de objetos (N5) |

---

## 6. Autenticação, segurança da chave global e estratégia de conexão

### 6.1 Requisitos e riscos

- **Chave global obrigatória.** É a mesma chave que cria e exclui instâncias, e fica no cofre do DisparaZap (Configurações do
  Super-Admin).
- **A chave vai na URL** (`?token=`):
  - servidores de proxy na frente da Evolution (Traefik, Nginx, Caddy) costumam registrar a URL inteira nos logs de acesso;
  - **é preciso confirmar com quem administra o servidor Evolution que esses logs não guardam a query** (ou aceitar trocar a
    chave depois da homologação).
- **Token errado vai para o log da Evolution em texto puro** (`Token inválido: %s`):
  - o DisparaZap **nunca pode insistir com uma chave antiga ou errada**;
  - recusa (401) suspende o consumidor até a chave ser trocada em Configurações, sem novas tentativas.
- **O evento traz o `instanceToken`:**
  - descartado na leitura; nunca gravado nem registrado;
  - conferido com o token do cofre (em tempo constante) como checagem adicional da instância.
- **No DisparaZap:**
  - a URL com a chave nunca vai para o log;
  - erros registrados só com o código classificado, como no adaptador atual (D-38), nunca com a mensagem crua do cliente
    WebSocket.

### 6.2 Estratégia de conexão recomendada

1. **Uma conexão em modo difusão por servidor Evolution** (não uma por instância).
   - Evita a falha 5.1.
   - Como a difusão só recebe instâncias com WebSocket ligado, e o DisparaZap só liga nas instâncias dele, o fluxo já chega
     restrito.
2. **Filtro obrigatório:**
   - todo evento é aceito só se `instanceId` corresponder a uma instância registrada no DisparaZap e não excluída;
   - qualquer outra (MVP, outro sistema) é descartada na hora, sem gravar nem registrar conteúdo;
   - grupos e status descartados no início.
3. **Ligar o WebSocket só nas instâncias do DisparaZap,** por ação explícita do administrador da empresa em Integrações:
   - com confirmação;
   - `POST /instance/connect` com o token da instância:
     `{ "subscribe": ["MESSAGE","SEND_MESSAGE","READ_RECEIPT","CONNECTION"], "websocketEnable": "enabled" }`.
   - **Nunca nas instâncias do MVP.**
4. **Um consumidor por processo**, criado na partida da API:
   - reconexão com espera crescente (1 s até 60 s, com variação aleatória);
   - sinal de vida a cada 30 s;
   - registro de lacuna;
   - suspensão em 401 (6.1).
   - Duas APIs ao mesmo tempo receberiam em dobro; a deduplicação e a trava de processo único (D-51) resolvem.
5. **Idempotência:**
   - chave por (instância, `Info.ID`, tipo do evento);
   - recibos que chegarem antes da mensagem ficam pendentes.

---

## 7. Testes realizados e resultados

| Teste | Onde | Resultado |
|---|---|---|
| Autenticação do `/ws` nas 4 versões publicadas | Código-fonte `cmd/evolution-go/main.go` de 0.6.1, 0.7.0, 0.7.1 e 0.7.2 | ✅ Só chave global, idêntico nas 4; token inválido gravado no log em texto puro |
| `/instance/connect` numa instância em execução | `pkg/instance/service/instance_service.go` e `whatsmeow.go` (`UpdateInstanceSettings`) | ✅ Atualiza `subscribe`, `websocketEnable` e `webhook` na hora, sem reiniciar; sobrescreve `webhookUrl` (hoje vazio) |
| Remoção de conexões WebSocket | `pkg/events/websocket/websocket_producer.go` (4 versões) | ⚠️ Remoção por id sem conferir a conexão no modo por instância (falha 5.1); difusão correta |
| Origem dos eventos de envio | `send_service.go` (`SendMessage` emitido após envio pela API) e `whatsmeow.go` (`Message` com `IsFromMe`) | ✅ Classificação da seção 4 |
| Identificação da instância | `whatsmeow.go` (`userID = Instance.Id`; `Produce(…, instance.Id, …)`) e `whatsapp-service.ts` (`providerInstanceId`) | ✅ Mapeamento direto para a empresa |
| **Prova local do WebSocket** (nenhum serviço real) | Script temporário (fora do projeto): servidor WebSocket mínimo no formato da Evolution (aperto de mão RFC 6455, quadros de texto, fechamento) e o cliente nativo do Node 24.17 | ✅ **7 de 7:** WebSocket nativo disponível; chave errada recusada sem abrir; evento `message` recebido; campos `Info.Chat`, `Info.ID`, `IsFromMe` e texto lidos; `instanceToken` presente (a descartar); queda percebida; reconexão recebe de novo |

**Aprendizado para o simulador definitivo** (etapa I1):
- o servidor simulado precisa responder ao pedido de fechamento do cliente, senão o cliente espera o tempo-limite (visto na
  prova);
- precisa também quadros grandes (mídia em base64) e a falha 5.1, para testar a estratégia.
- **Não é preciso nenhuma dependência nova:** um servidor mínimo próprio no simulador basta. O `ws` (N7) fica como alternativa
  se for preciso fragmentação ou ping.

---

## 8. Testes pendentes de autorização (procedimentos exatos)

Nenhum passo abaixo foi feito. **Cada um precisa de autorização específica.** Nenhum toca nas instâncias em uso nem nas do MVP.

| # | Procedimento | Tipo | Quem faz | Volta atrás |
|---|---|---|---|---|
| **P0** | Confirmar com quem administra o servidor Evolution se o proxy registra a URL completa (query) nos logs de acesso. Se registrar: desligar o registro da query ou aceitar **trocar a chave global** depois da homologação | Consulta | Dono do produto | — |
| **P1** | **Versão:** `GET {EVOLUTION_URL}/swagger/doc.json`, **sem chave**, lendo só `info.version`; e `GET {EVOLUTION_URL}/server/ok` | Leitura, sem credencial | Assistente, com autorização (a URL é lida do banco local, nunca escrita em arquivo) | Nada a desfazer |
| **P2** | **Aperto de mão do WebSocket:** abrir `wss://{servidor}/ws?token=<CHAVE_GLOBAL>` (modo difusão), por 30 s, só conferindo o código 101 e fechando. Nenhuma instância tem WebSocket ligado, então nada chega. **Nunca testar chave errada** (ela iria para o log da Evolution) | Leitura com a chave global | Assistente, com autorização, depois do P0 | Nada a desfazer |
| **P3** | **Instância de teste:** criar pelo painel uma instância nova (nome técnico `dz_…`) e conectar **um número de teste** (chip separado, nunca o de clientes ou o do MVP) | Escrita no servidor (nova instância) | Dono do produto, pelo painel | Excluir a instância pelo painel |
| **P4** | **Ligar eventos só na instância de teste:** conferir a situação (`/instance/status`); `POST /instance/connect` com o token **dessa** instância e `{ subscribe: [MESSAGE, SEND_MESSAGE, READ_RECEIPT, CONNECTION], websocketEnable: "enabled" }`; conferir de novo que segue conectada (`Connected` e `LoggedIn`) | Escrita só na instância de teste | Assistente, com autorização | Repetir o `/instance/connect` com `{}` (volta ao padrão) ou excluir a instância |
| **P5** | **Receber de verdade, sem enviar nada pelo DisparaZap:** com o WebSocket aberto (difusão + filtro), o dono do produto manda, **do celular dele**, uma mensagem para o número de teste e responde **pelo celular de teste**. Conferir `Message` (`IsFromMe` falso e verdadeiro), `Receipt` e a ausência de eventos de outras instâncias. Registrar só os tipos e campos, nunca texto ou número | Leitura de eventos | Assistente e dono do produto | Fechar o WebSocket |
| **P6** | **Lacuna e histórico:** fechar o WebSocket, receber 1 mensagem no número de teste, reabrir. Conferir que ela **não** é reenviada e, com autorização à parte, testar `POST /chat/history-sync` para recuperá-la. Esse pedido envia uma mensagem de sistema ao próprio aparelho de teste | Escrita (pedido de histórico) | Assistente, com autorização específica | — |
| **P7** | Encerrar: desligar o WebSocket na instância de teste (P4 com `{}`) ou excluí-la | Escrita só na instância de teste | Dono do produto ou assistente | — |

---

## 9. Recomendação técnica para a Etapa I1

1. **Antes de começar:** P0 a P2, com autorização, para confirmar a versão e o aperto de mão.
   - P3 a P5 podem ficar para o fim da I1 (homologação do que foi construído).
2. **Consumidor de eventos da Evolution** na API:
   - modo difusão, um por servidor;
   - filtro pelas instâncias registradas e descarte de grupos e status;
   - reconexão com espera crescente, sinal de vida, lacuna registrada e suspensão em 401;
   - cliente WebSocket nativo do Node (sem dependência);
   - URL e `instanceToken` fora de qualquer log.
3. **Botão "Receber mensagens na Inbox"** em Integrações (seção WhatsApp):
   - só dono e administradores, com confirmação;
   - aplica o `subscribe` + WebSocket na instância da empresa;
   - também passa a ser enviado nas conexões novas.
4. **Camada de conversas** do plano (E.1) e gravação idempotente por (instância, `Info.ID`, tipo).
   - `Message` com `IsFromMe` vira mensagem enviada pelo celular.
   - `SendMessage` confirma os envios do DisparaZap.
5. **Responder texto** pelo adaptador existente; recibos `Receipt`.
6. **Simulador:**
   - a Evolution simulada ganha o `/ws` (servidor mínimo próprio, com fechamento e quadros grandes);
   - eventos `Message`, `SendMessage`, `Receipt` e `Connected/Disconnected`;
   - a falha 5.1 para provar a estratégia;
   - instância alheia e token errado (401).
7. **Mídias (I2) aguardam a revisão do N5:**
   - armazenamento privado de objetos depende de definir onde: Supabase Storage com o Supabase conectado, ou MinIO no servidor
     Evolution;
   - na I1, mídia recebida aparece como "mídia recebida (disponível na próxima etapa)", sem guardar o conteúdo.
8. **Correções no plano** (aplicadas em `PLANO_MODULO_INBOX.md`):
   - as mensagens do celular chegam como `Message` com `IsFromMe`;
   - a conexão recomendada é a difusão.

> **Nota de 2026-11-04 (I1 implementada):** o item 2 acima previa o cliente WebSocket nativo do Node. A I1 usa um cliente
> próprio mínimo (`ws-client.ts`, DECISOES_TECNICAS D-52), porque o nativo não informa o código HTTP da recusa e não deixa
> fixar o TLS verificado. Sem o código da recusa, a chave recusada (401) não seria reconhecida, e o cliente insistiria. O resto
> da recomendação foi seguido.

---

## 10. Homologação da I1 com a instância de teste (procedimento exato)

**Nada abaixo foi executado.** Cada passo precisa de **autorização específica** do dono do produto, um por um. São os
procedimentos P0 a P7 da seção 8, agora feitos com o código da I1, que já existe.

**Quando esta homologação ainda não começou:**
- as duas chaves seguem `false` no `saas/.env` e na produção;
- nenhuma instância tem eventos ligados;
- nenhuma mensagem real é enviada.

**Antes de começar:**
- conferir que só uma API de desenvolvimento está rodando (D-51);
- fazer uma cópia da pasta `saas/.data/pglite`;
- ter a resposta do P0 (logs do proxy).

| # | Passo | O que muda | Quem faz | Como conferir | Volta atrás |
|---|---|---|---|---|---|
| **H1 (P1)** | Ler a versão da Evolution (`/swagger/doc.json`, sem chave) | Nada | Assistente, com autorização | Versão entre 0.6.1 e 0.7.2 (ou rever o I0 se for outra) | — |
| **H2 (P2)** | No `saas/.env`, `INBOX_EVENTS_ENABLED=true`; reiniciar a única API | A API abre **uma** conexão de saída `wss://…/ws` com a chave global | Dono do produto (o assistente não lê o `.env`) | Inbox sem o aviso "ainda não foi ligado"; nenhuma instância tem eventos ligados, então nada chega; log com `inbox.recebimento.conectado` e sem a URL | `INBOX_EVENTS_ENABLED=false` e reiniciar |
| **H3 (P3)** | Criar pelo painel (Integrações → WhatsApp) uma **instância nova de teste** e conectar um **número de teste** | Uma instância nova no servidor | Dono do produto | Instância "Conectado" | Excluir a instância |
| **H4 (P4)** | `INBOX_ACTIVATION_ENABLED=true`, reiniciar; em Integrações, **só na instância de teste**, "Receber mensagens na Inbox" → Confirmar | `POST /instance/connect` com `subscribe` e WebSocket **só nessa instância** | Dono do produto, pelo painel | Instância continua "Conectado" (`/instance/status`); a Inbox mostra "Recebendo mensagens" nela | "Parar de receber na Inbox" (envia `{}`) |
| **H5 (P5)** | Do celular do dono, mandar uma mensagem ao número de teste; responder **pelo celular de teste** | Nada no servidor | Dono do produto | A conversa aparece na Inbox sem recarregar; a resposta aparece como "Pelo celular"; o nome e o número do contato; se o contato vier só com LID, anotar | — |
| **H5b** | **Só com autorização à parte (é envio real):** responder pela Inbox **ao número do próprio dono** | Uma mensagem real enviada | Dono do produto | Chega no celular; ✓ enviada, ✓✓ entregue, ✓✓ lida; nenhuma mensagem repetida | — |
| **H6 (P6)** | Parar a API, mandar 1 mensagem ao número de teste, ligar a API | Nada | Dono do produto | Confirma a limitação: a mensagem do intervalo **não** aparece (a Evolution não reenvia). Uma queda de rede com a API ligada aparece como período sem recebimento | — |
| **H7 (P7)** | Encerrar: "Parar de receber na Inbox" na instância de teste; as duas chaves de volta a `false`; excluir a instância de teste, se quiser. Se o P0 indicar que o proxy grava a query, **trocar a chave global** | Volta ao estado inicial | Dono do produto | Inbox com o aviso de recebimento desligado; nenhuma instância com eventos | — |

**Em qualquer passo, parar** se aparecer: instância desconectada depois do H4, evento de instância que não é a de teste
gravado, erro 401 no WebSocket, ou mensagem duplicada. Nesses casos, voltar com H7 e revisar antes de seguir.

### 10.1 O que falta para ativar em ambiente real (produção)

1. **Homologação H1 a H7 concluída** e aprovada pelo dono do produto.
2. **Banco de produção:** aplicar a migration `0007_inbox`, com `npm run producao:migrar`, só pelo dono do produto ou com
   autorização explícita.
3. **Variáveis de produção** (Hostinger): `INBOX_EVENTS_ENABLED=true` e `INBOX_ACTIVATION_ENABLED=true`, também só com
   autorização.
4. **Tempo real atrás do proxy da Hostinger:**
   - o SSE não pode ser segurado pelo proxy (a API já manda `X-Accel-Buffering: no`);
   - o tempo de inatividade do proxy precisa ser maior que o sinal de vida (25 s).
   - Conferir na primeira publicação. Sem isso, o painel funciona pela consulta a cada 5 s.
5. **Um processo só** (D-45): mantido. Com mais processos, o barramento em memória precisa virar Redis ou `LISTEN/NOTIFY`.
6. **LGPD:** conversas são dados pessoais de terceiros. Antes de abrir para clientes:
   - retenção de 12 meses (N6), sujeita a validação jurídica;
   - aviso na política de privacidade;
   - exportar e excluir (etapa I9).
7. **Cada empresa liga o próprio número,** em Integrações, com confirmação. Nada é ligado sozinho nas instâncias existentes.
