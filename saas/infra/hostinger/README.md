# DisparaZap na Hostinger (aplicativo Node.js do hPanel)

Passo a passo para colocar o painel do DisparaZap no ar num plano da Hostinger com **aplicativos Node.js**: Business Web
Hosting ou Cloud (Startup, Professional, Enterprise). Os comandos `npm run …` são digitados no seu computador, dentro da
pasta `saas/`.

**O que vai para o ar:** um único processo Node.js.
- Ele roda a API e também entrega o painel no mesmo endereço.
- O banco de dados é o seu projeto **Supabase**.
- O worker não vai, porque ainda não há filas. O disparador antigo (MVP) também não vai.

> **Nunca envie para o GitHub, por e-mail ou por chat** o arquivo `saas/.env.producao`, a senha do banco, o
> `AUTH_SECRET` nem a `SECRETS_MASTER_KEY`.

---

## O que você precisa antes

- **Plano da Hostinger com "Node.js web app"** e um domínio (ou subdomínio) nessa conta.
  - Exemplo: `painel.seudominio.com.br`.
  - A Hostinger cuida do HTTPS.
- **Um projeto Supabase só do DisparaZap** (o plano está em `saas/docs/SUPABASE_CONFIGURACAO.md`).
- **No seu computador:** Node.js 24, a pasta do projeto e `npm install` já feito dentro de `saas/`.

## Passo 1 — Supabase: conexão e certificado

1. **Crie o projeto.** Região sugerida: São Paulo. Anote a **senha do banco** num gerenciador de senhas.
2. **Pegue a string de conexão.**
   - Clique em **Connect** e escolha **Session pooler**: é a versão que funciona em IPv4, como na Hostinger.
   - Copie o endereço `postgresql://postgres.…@aws-…pooler.supabase.com:5432/postgres`.
   - Troque `[YOUR-PASSWORD]` pela senha do banco.
3. **Baixe o certificado.**
   - Vá em **Project Settings → Database → SSL Configuration → Download certificate**.
   - Salve o arquivo como `saas/certs/supabase-ca.crt`.
   - Ele é público e não é senha. A pasta `certs/` fica fora do git.
4. **Não exponha os esquemas do DisparaZap.** Em **Project Settings → Data API**, não acrescente `identity`, `platform`
   nem `app` aos "Exposed schemas". O painel fala só com a nossa API, nunca direto com o Supabase.

## Passo 2 — Arquivo de produção

1. Copie `saas/infra/hostinger/env.hostinger.example` para `saas/.env.producao`.
2. Rode `npm run producao:segredos` e cole os dois valores no arquivo.
   - Eles mudam a cada execução.
   - **Guarde uma cópia da `SECRETS_MASTER_KEY`.** Sem ela, a chave da Evolution guardada no cofre não pode mais ser
     lida.
3. Preencha:
   - `AUTH_BASE_URL`: o endereço do painel, exatamente como no navegador. Exemplo: `https://painel.seudominio.com.br`,
     sem barra no fim.
   - `SUPER_ADMIN_EMAIL`: o seu e-mail de Super-Admin.
   - `DATABASE_URL` e `DATABASE_MIGRATION_URL`: a string do Passo 1. Pode ser a mesma nas duas.
   - Deixe `DATABASE_CA_FILE=certs/supabase-ca.crt`.
   - `AUTH_SIGNUP_ENABLED`:
     - `true` deixa a tela **Criar conta** aberta a qualquer pessoa;
     - `false` fecha o cadastro (veja "Segurança").

## Passo 3 — Criar as tabelas no Supabase

```bash
npm run producao:migrar
```

- O comando mostra o servidor que vai receber as tabelas e pede que você digite `APLICAR`.
- Ele cria as tabelas do DisparaZap (esquemas `identity`, `platform` e `app`).
- Rodar de novo não repete nada: só aplica o que faltar.

## Passo 4 — Criar o Super-Admin

```bash
npm run producao:admin
```

- Digite o nome e a senha. A senha não aparece na tela.
- O e-mail é o de `SUPER_ADMIN_EMAIL`.

## Passo 5 — Gerar o pacote

```bash
npm run pacote:hostinger
```

- O comando compila tudo e cria:
  - `saas/deploy/disparazap-hostinger.zip`: este é o arquivo que vai para a Hostinger;
  - `saas/deploy/hostinger/`: a mesma coisa, em pasta, para conferir.
- O resumo no fim precisa mostrar o certificado do banco. Se aparecer "NENHUM", volte ao Passo 1.3.
- **O pacote não leva:** `node_modules` (a Hostinger instala), `.env`, senhas, mapas de código-fonte nem o banco
  local.

## Passo 6 — Publicar na Hostinger

1. No hPanel, vá em **Websites → Add Website → Node.js web app → Upload your files** e envie o
   `disparazap-hostinger.zip`.
2. Nas configurações:

   | Campo | Valor |
   |---|---|
   | Framework | Fastify (detectado) ou "Other" |
   | Node.js version | **24** |
   | Package manager | npm |
   | Build command | *(vazio)* |
   | Output directory | *(vazio)* |
   | Entry file | `server.js` |

3. Em **Environment variables**, clique em **Import .env** e escolha o seu `saas/.env.producao`. Confira os valores.
4. Clique em **Deploy** e ligue o domínio ao aplicativo, se o hPanel pedir.

## Passo 7 — Primeiro acesso

1. Abra `https://SEU-DOMINIO/health/ready`. Deve aparecer `"status":"ok"`.
2. Abra `https://SEU-DOMINIO` e entre com o Super-Admin.
3. Em **Configurações**, informe o endereço e a chave global da Evolution Go e clique em **Testar conexão**.
4. Crie a conta da sua empresa em **Criar conta**, com outro e-mail. Depois conecte o WhatsApp em **WhatsApp**.

## Atualizar para uma versão nova

1. Se a versão nova tiver migrations novas, rode **antes** `npm run producao:migrar`.
2. Rode `npm run pacote:hostinger`.
3. No hPanel, envie o `.zip` novo no mesmo aplicativo (novo deploy).
   - As variáveis de ambiente continuam lá.
   - Os arquivos antigos do servidor são trocados pelos novos.

## Se algo der errado

Veja primeiro o **Runtime log** do aplicativo no hPanel.

| Mensagem ou sintoma | O que fazer |
|---|---|
| `Configuração inválida — …` | A mensagem diz qual variável falta ou está errada. Corrija no hPanel e reinicie |
| `não foi possível abrir o PostgreSQL` | Confira a string do **Session pooler**, a senha e se `certs/supabase-ca.crt` foi junto (Passo 5) |
| O endereço não abre, mas o log não mostra erro | Confira `API_HOST=0.0.0.0` nas variáveis e se o domínio está ligado ao aplicativo |
| Login recusado com "verificação de origem" | `AUTH_BASE_URL` precisa ser **exatamente** o endereço do navegador (com ou sem `www`, sempre `https`) |
| As tabelas não existem | Rode o Passo 3 |

## Segurança

- **Cadastro aberto** (`AUTH_SIGNUP_ENABLED=true`):
  - qualquer pessoa pode criar uma empresa e conectar 1 número WhatsApp no **seu** servidor Evolution;
  - para fechar, mude para `false` no hPanel e reinicie o aplicativo.
- **As senhas e chaves ficam só** nas variáveis do hPanel e no seu `saas/.env.producao`. Nunca vão para o GitHub nem
  para o pacote.
- **Ainda não aplicado no Supabase:**
  - os papéis separados do plano (`dz_migrator`, `dz_app`);
  - o RLS.
  - Por enquanto a API usa o usuário da string de conexão. Esses reforços estão em `saas/docs/SUPABASE_CONFIGURACAO.md`.
- **Envio real:** as mensagens enviadas pelo painel online são de verdade.
