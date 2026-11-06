# DisparaZap no Easypanel (a partir do GitHub)

A imagem é construída pelo `saas/Dockerfile`. Ela contém a API e o painel compilados, e nenhum segredo.

## 1. Criar o serviço

1. No Easypanel, crie um **projeto** e um serviço do tipo **App**.
2. Em **Source**, escolha **GitHub**: repositório `Sinvaldo-Oliveira/disparazap`, ramo `main`.
3. Em **Build**, escolha **Dockerfile** e informe:
   - **Build path:** `/saas`
   - **Dockerfile:** `Dockerfile` (fica dentro de `saas/`)
4. Em **Port**, informe `3100`.

## 2. Variáveis de ambiente

Cadastre no painel do serviço (**Environment**). Use os mesmos nomes e significados de `saas/infra/hostinger/env.hostinger.example`, com os valores de produção:

| Variável | Valor |
|---|---|
| `AUTH_BASE_URL` | o endereço do painel, com `https://` e sem barra no fim |
| `AUTH_SECRET`, `SECRETS_MASTER_KEY` | gerados com `npm run producao:segredos` (guarde uma cópia da `SECRETS_MASTER_KEY`) |
| `SUPER_ADMIN_EMAIL` | seu e-mail de Super-Admin |
| `DATABASE_URL` e `DATABASE_MIGRATION_URL` | a string **Session pooler** do Supabase |
| `DATABASE_CA_FILE` | `/app/certs/supabase-ca.crt` |
| `API_TRUST_PROXY` | `true` (o Easypanel fica atrás de um proxy interno) |
| `AUTH_SIGNUP_ENABLED` | `true` ou `false`, conforme a política de cadastro |

Já vêm definidas na imagem e **não** precisam ser cadastradas: `NODE_ENV=production`, `API_HOST=0.0.0.0` (o contêiner escuta em todas as interfaces, dentro da rede do Easypanel), `API_PORT=3100` e `WEB_DIST_DIR`.

## 3. Certificado do banco (não vai para o git)

Baixe o certificado do Supabase em **Project Settings → Database → SSL Configuration**. No Easypanel, em **Mounts / Files**, monte o arquivo no caminho `/app/certs/supabase-ca.crt`.

## 4. Antes de subir

- **Não** rode as migrações automaticamente. Elas devem ser conferidas antes, porque o banco de produção já tem parte delas aplicada à mão (a migração 0008). Veja `docs/DISPARAZAP_MASTER.md` e `saas/docs/DECISOES_TECNICAS.md`.
- O Super-Admin é criado uma vez, depois que as tabelas existirem.

## 5. Conferir

- `https://<seu-domínio>/health/live` deve responder `ok`.
- `https://<seu-domínio>/health/ready` confirma o banco.
- A página de entrada do painel deve abrir no endereço principal.

## Segredos

Nunca commite o `.env.producao`, a senha do banco, `AUTH_SECRET`, `SECRETS_MASTER_KEY` nem o certificado. O `saas/.dockerignore` já impede que eles entrem na imagem.
