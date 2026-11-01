# Segurança do MVP — DisparaZap

| | |
|---|---|
| **Fase** | 3 — preservação do MVP, git e correções de segurança |
| **Data** | 2026-10-31 |
| **Base** | Achados V1–V14 de [ARQUITETURA_SAAS.md §1.2](ARQUITETURA_SAAS.md#12-verificação-de-segurança) |
| **Escopo** | Só o MVP local (`server.js`, `index.html`, `phone.js`). O SaaS não foi iniciado |

> **Isto não é uma declaração de segurança completa.** As correções reduzem riscos comprovados e os testes cobrem os
> cenários descritos aqui, mas há riscos pendentes (seção 5) e o MVP continua sem login, por desenho.

---

## 1. Resumo

| Situação | Itens |
|---|---|
| ✅ Corrigido | Escuta de rede (V1), verificação TLS (V2), redirecionamentos que levariam a chave para outro host, exposição de dados ao navegador (V3), validação de telefone (V7), `.env.example` ausente |
| 🟡 Pendente, com proposta | Limites de envio no servidor (V4/V5), DNS rebinding (V6), CDN sem SRI (V8), cabeçalhos de segurança (V9), registro de envios |
| ⚪ Aceito por desenho | Sem login (uso local de um operador); token da instância em `localStorage` (contrato atual do MVP) |

## 2. Estado original preservado

- **Repositório git local** criado em 2026-10-31, **sem remoto**. Dois commits, autorizados pelo dono do produto:
  - `908ca2f` `chore: preserve original DisparaZap MVP`: o estado anterior à Fase 3, comprovado arquivo a arquivo
    contra a cópia de preservação (12/12);
  - o commit seguinte, `fix: harden DisparaZap MVP security`: as correções, os testes e a documentação desta fase.
- **Correção de registro:** a primeira versão deste documento dizia que o original tinha sido preparado no índice "antes de
  qualquer mudança". Não era exato: o `.gitignore` já tinha sido revisado antes do `git add`. A divergência foi detectada
  na verificação anterior ao commit. Com autorização, a entrada do `.gitignore` no índice foi trocada pela versão da cópia de preservação.
- O git guarda `CLAUDE.md` e `doc_evolution_go.md` com fim de linha LF (`core.autocrlf=true`); o conteúdo é idêntico ao original.
- **Cópia de preservação** em `backup/estado-original-2026-10-31/`, com `MANIFESTO.sha256` (sem `.env` e sem `node_modules`):
  - a pasta é ignorada pelo git;
  - para conferir a integridade: `sha256sum -c MANIFESTO.sha256`.
- `.gitignore` revisado: `.env`, `.env.*` (exceto `.env.example`), chaves e certificados (`*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx`),
  logs, `backup/`, `coverage/`, `node_modules/`.
- Varredura antes de preparar o índice: nenhum dado real do ambiente. Os únicos valores parecidos com chaves são exemplos
  da documentação (`token-secreto-da-instancia` e o UUID de exemplo da documentação do Evolution).

## 3. Correções aplicadas

| # | Problema | Correção | Onde | Teste |
|---|---|---|---|---|
| V1 | Servidor escutava em todas as interfaces, sem login | Escuta em `127.0.0.1` por padrão; `HOST` no `.env` abre para a rede, com aviso no console. Uso exclusivo nesta máquina confirmado pelo dono do produto em 2026-10-31 | `server.js` | `server.test.js`: responde por `localhost`, recusa pelo IP da rede |
| V2 | `rejectUnauthorized: false` em todas as chamadas HTTPS | Verificação obrigatória, com `rejectUnauthorized: true` explícito (vale mesmo com `NODE_TLS_REJECT_UNAUTHORIZED=0`). `EVOLUTION_CA_FILE` opcional **acrescenta** uma autoridade, sem desligar nada | `server.js` | Certificado autoassinado recusado sem a chave sair; variável global ignorada; CA própria aceita; arquivo de CA ilegível impede a inicialização |
| — | Redirecionamento levava o header `apikey` para qualquer host | Redirect só para o **mesmo host** e **nunca de HTTPS para HTTP** | `server.js` | Outro host bloqueado (a chave não chega lá); rebaixamento para HTTP bloqueado; mesmo host continua funcionando |
| V3 | Filtro por lista de proibidos deixava passar campos aninhados, `proxy` com senha, `qrcode` e `jid` | **Lista de permitidos**: `/api/instances` devolve só `{ data: [{ name, connected }] }`; `/api/send/text` devolve só `{ ok, messageId }` | `server.js` (`toPublicInstance`) | Resposta comparada campo a campo; nenhum dos 8 valores sensíveis do Evolution simulado aparece |
| V3 | Corpo de erro do Evolution e mensagens de rede repassados ao navegador (podiam conter URL ou HTML interno) | Erro do Evolution reduzido a texto curto (até 200 caracteres); erros de rede/TLS viram mensagens fixas; detalhes só no console do servidor | `server.js` (`upstreamError`, `upstreamErrorMessage`) | Página HTML de erro vira mensagem genérica; erro de conexão não mostra endereço nem porta |
| V7 | Telefone aceitava qualquer coisa com 10–15 dígitos | Regra explícita (seção 4) em módulo único, aplicada no navegador **e** no servidor | `phone.js`, `index.html`, `server.js` | `phone.test.js` (10 grupos de casos) + servidor recusando com 400 + interface |
| — | `.env.example` havia sumido (provavelmente renomeado para `.env`) | Recriado, com `HOST` e `EVOLUTION_CA_FILE` comentados e o aviso "copie, não renomeie" | `.env.example` | — |

### Certificado do servidor Evolution real

Com autorização do dono do produto, foi feito **apenas o handshake TLS** (sem chave e sem chamada à API) em 2026-10-31:
emitido por Let's Encrypt, TLS 1.3, confiável pelo Node, cobrindo o domínio configurado, **válido até 2027-01-14**.
A verificação ligada, portanto, não quebra o MVP. A renovação automática do certificado é responsabilidade do servidor:
se ela falhar, o disparador **para de conectar** e mostra "Certificado HTTPS do servidor Evolution não é confiável".
Nesse caso, corrija o certificado no servidor; não desligue a verificação.

## 4. Regra de telefone

Implementada em `phone.js`, aplicada igualmente no navegador e no servidor.

| Regra | Detalhe |
|---|---|
| Formato | Internacional: DDI + número nacional, **10 a 15 dígitos**, sem zero inicial |
| Separadores aceitos | Espaço, hífen, ponto, parênteses; `+` apenas no início. São removidos, e nenhum dígito é alterado |
| **Sem `+`** | Só números brasileiros: `55` + DDD válido + 8 dígitos (fixo ou celular antigo, primeiro dígito 2–9) ou 9 dígitos (celular, começando com 9) |
| **Com `+`** | Outros países; `+1` (EUA/Canadá) exige código de área e prefixo que não comecem com 0 ou 1 |
| Nunca | Acrescentar DDI, remover zeros, completar o 9 ou separar números colados |

| Entrada | Resultado | Motivo |
|---|---|---|
| `5511988887777`, `+55 (11) 98888-7777` | ✅ `5511988887777` | — |
| `55 21 3333-4444` | ✅ `552133334444` | Fixo |
| `+1 202 555 0123` | ✅ `12025550123` | Outro país com `+` |
| `11988887777`, `(11) 98888-7777` | ❌ sem DDI | Parece número brasileiro sem o 55 (a mensagem sugere o formato, mas não corrige sozinha) |
| `55988887777` | ❌ sem DDI | DDD 55 sem o DDI 55 |
| `12025550123` | ❌ sem DDI | Outro país sem `+` |
| `011988887777`, `0055…` | ❌ zero inicial | Zero de tronco ou prefixo de discagem |
| `5511abc…`, `… ramal 2`, `#`, dígitos de largura total | ❌ caracteres inválidos | — |
| `5511988887777 5511977776666`, `…/…`, `…, …` | ❌ mais de um número / caracteres inválidos | Números concatenados |
| `''`, espaços, célula vazia | ❌ vazio | — |
| `123456789`, 16+ dígitos, `5511988887` | ❌ tamanho inválido / número brasileiro inválido | — |
| `5520988887777`, `5511888877776` | ❌ número brasileiro inválido | DDD inexistente; celular de 9 dígitos sem começar com 9 |

**Limitações conhecidas:**
- Números estrangeiros (exceto `+1`) têm validação só estrutural.
- Números internacionais de 10–11 dígitos cujo início coincide com um DDD brasileiro são recusados por ambiguidade.
- Celular brasileiro no formato antigo (12 dígitos, sem o 9) é aceito, porque o WhatsApp ainda o resolve.

No SaaS, a proposta é usar `libphonenumber-js` ([ARQUITETURA_SAAS §8.1](ARQUITETURA_SAAS.md#81-convenções)).

**Impacto para o operador:**
- Listas antigas com números sem o 55 agora são **recusadas** com o motivo, e o operador precisa corrigir a planilha.
- O log de importação mostra a contagem por motivo (ex.: `3 linha(s) ignorada(s) (2 sem DDI, 1 vazio)`).

## 5. Riscos pendentes

| # | Risco | Situação | Recomendação |
|---|---|---|---|
| V4/V5 | **Envio sem limite no servidor** | Ver seção 6 | Aprovar a proposta da seção 6 |
| — | Sem login | Qualquer programa ou usuário **desta máquina** pode chamar a API local | Aceito para o MVP; o SaaS terá autenticação |
| — | Token da instância em `localStorage`, em texto puro | Contrato do MVP mantido (o operador informa o token) | Aceito para uso local. Com `HOST` aberto, o token trafega em HTTP pela rede: evitar |
| V6 | DNS rebinding (o `Host` não é validado) | Exposição reduzida: um site malicioso só leria nomes e status das instâncias, e não consegue enviar sem o token | Validar o `Host` (aceitar só `localhost`/`127.0.0.1`) |
| V8 | SheetJS via CDN sem SRI | Mantido | Adicionar `integrity` (hash SHA-384 do arquivo 0.20.3) ou servir cópia local |
| V9 | Sem cabeçalhos de segurança (CSP, `nosniff`, `frame-ancestors`) | Mantido | Adicionar `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`; CSP depois de testar a página com scripts inline |
| — | Nenhum registro de envios no servidor | Mantido | Proposta P4 (seção 6) |
| — | Intervalos aleatórios **não garantem** proteção contra bloqueio | O WhatsApp pode bloquear números por denúncias, volume, conteúdo ou padrão de uso, com qualquer intervalo | Opt-out, consentimento e volume moderado (previstos no SaaS) |
| — | Renovação do certificado do Evolution | Válido até 2027-01-14 | Monitorar a renovação no servidor |
| — | Firewall do Windows | Não verificado (exige administrador) | Com a escuta em `127.0.0.1`, deixou de ser relevante para este servidor |
| — | Dependências | express 4 e dotenv 16 sem vulnerabilidades conhecidas (`npm audit`: 0); versões maiores disponíveis | Atualizar em fase própria, com testes |

## 6. Envio: ausência de limites no servidor — auditoria e proposta (NÃO implementada)

**Situação auditada:**
- `/api/send/text` aceita qualquer ritmo: 30 de 30 requisições seguidas foram repassadas na Fase 2.
- O intervalo mínimo/máximo existe **só no navegador**; quem chama a rota direto ignora o intervalo.
- Duas abas abertas podem rodar duas campanhas na mesma instância ao mesmo tempo, o que dobra o ritmo.
- O único limite de tamanho é o corpo de 1 MB; não há teto de caracteres para o texto.
- Nenhum registro no servidor de quem enviou o quê.

**Proposta para aprovação.** Nenhuma muda as regras comerciais: o mínimo de 1 s já é a regra da interface.

| # | Proteção | Efeito no fluxo atual | Risco de quebra |
|---|---|---|---|
| P1 | Intervalo mínimo **por token** no servidor: recusar (HTTP 429) um envio feito menos de 1 s depois do anterior com o mesmo token | Nenhum: a interface já espera pelo menos 1 s | Baixo |
| P2 | **Um envio por vez por token**: segundo envio simultâneo recebe 429 | Duas abas na mesma instância passam a falhar uma delas, em vez de dobrar o ritmo | Baixo; a interface mostraria o erro no log |
| P3 | Teto de tamanho do texto (ex.: 4.096 caracteres) | Mensagens muito longas seriam recusadas | **Precisa de decisão**: definir o teto |
| P4 | Registro local de envios (arquivo JSON por linha): data/hora, instância, número **mascarado** (`5511*****7777`), resultado. Sem o texto da mensagem | Nenhum | Baixo; o arquivo seria ignorado pelo git (`logs/`) |
| P5 | Teto opcional de envios por dia, configurável no `.env` (desligado por padrão) | Nenhum se não configurado | Baixo |

## 7. Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `HOST` | `127.0.0.1` | Só esta máquina. `0.0.0.0` abre para a rede **sem login**. Usar apenas em rede confiável e ciente de que o token trafega sem criptografia |
| `EVOLUTION_CA_FILE` | — | PEM de uma autoridade extra, só se o Evolution usar certificado próprio. **Não** é necessário hoje (certificado Let's Encrypt válido) |

## 8. Testes

`npm test`: 42 testes, cerca de 20 s, sem rede externa.
- O servidor de teste roda num diretório temporário, então o `.env` real **não é lido**.
- Um bloqueio impede apontar para um Evolution que não seja local.

| Arquivo | Cobre |
|---|---|
| `tests/phone.test.js` | Brasileiro válido, sem DDI, zero de tronco, caracteres inválidos, concatenados, vazios, comprimentos, DDD, internacional, não alteração de dígitos |
| `tests/server.test.js` | Escuta local; arquivos internos não servidos; listagem só com campos permitidos e fallback de status; envio (normalização, UTF-8, resposta mínima); telefone e mensagem inválidos; token ausente/recusado; CSRF; erros do Evolution sem vazamento; redirects; servidor fora do ar; configuração ausente; TLS (autoassinado, variável global, CA própria, rebaixamento, CA ilegível) |
| `tests/ui.test.js` | Fluxo Instância → Contatos → Mensagem → Delay → Disparar no jsdom: instâncias e token, contatos manuais, Excel com motivos, pré-visualização e A/B, validação do intervalo, disparo completo, parada durante o intervalo, token recusado, HTML em nomes |

**Limites dos testes:**
- jsdom não é um navegador real: aparência e comportamento visual não são verificados.
- Não houve envio real nem chamada ao servidor Evolution real.
- O teste de TLS depende do `openssl` (incluído no Git for Windows) e é pulado se ele não existir.
- O teste de rede local é pulado em máquina sem interface de rede.

## 9. Como reverter

| Para | Faça |
|---|---|
| Ver o que a Fase 3 mudou | `git log --oneline` para achar o commit `fix: harden…`; depois `git diff 908ca2f <esse commit>` |
| Voltar um arquivo ao original | `git restore --source 908ca2f -- server.js` (ou copiar de `backup/estado-original-2026-10-31/`) |
| Abrir o disparador para a rede de novo | `HOST=0.0.0.0` no `.env` (não recomendado) |
| Confiar em certificado próprio do Evolution | `EVOLUTION_CA_FILE=<caminho do PEM>` no `.env` |
