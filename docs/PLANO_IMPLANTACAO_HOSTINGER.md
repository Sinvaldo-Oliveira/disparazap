# Plano de Implantação — VPS Hostinger

| | |
|---|---|
| **Status** | 🟡 Proposta — **aguardando aprovação**; nada foi instalado, acessado ou alterado na VPS |
| **Data** | 2026-10-31 |
| **Arquitetura** | [ARQUITETURA_SAAS.md](ARQUITETURA_SAAS.md) |

> Nomes de domínio aparecem como `<dominio>`; segredos aparecem apenas pelo **nome** da variável, nunca pelo valor.
> Especificações e nomes de planos da Hostinger mudam: confirme no painel antes de contratar.

---

## 1. Premissas

- Produção em **VPS Hostinger** (virtualização KVM), com Linux LTS (ex.: Ubuntu 24.04) e Docker + Docker Compose.
- O **Evolution Go já faz parte do ambiente previsto**, mas **onde e como** está instalado ainda não foi verificado (seção 2).
- O **MVP local** (no computador do usuário) acessa hoje o Evolution Go por uma URL pública HTTPS. Enquanto ele existir,
  essa URL precisa continuar acessível (ver I6 na seção 16).
- **Homologação separada da produção** é obrigatória.

## 2. Levantamento da VPS (somente leitura — executar só com autorização)

Antes de qualquer implantação, é preciso descobrir a topologia real. Comandos **somente leitura**, a serem executados pelo
dono do servidor ou com autorização expressa:

| Pergunta | Comando (somente leitura) | Por quê |
|---|---|---|
| Sistema e recursos | `lsb_release -a; nproc; free -h; df -h` | Dimensionamento |
| Docker instalado? | `docker version; docker compose version` | Base da implantação |
| O que está rodando | `docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'` | Descobrir o Evolution Go e serviços existentes |
| Como o Evolution foi instalado | `docker inspect <container> --format '{{.Config.Image}} {{json .Mounts}} {{json .NetworkSettings.Networks}}'` | Imagem/versão, volumes e redes. **Não usar `docker inspect` sem `--format`**: a saída completa inclui variáveis de ambiente com segredos |
| Portas abertas | `sudo ss -tlnp` | O que está exposto à internet |
| Firewall | `sudo ufw status verbose` + firewall do painel da Hostinger | Regras atuais |
| Proxy existente | `docker ps` e `systemctl status nginx caddy traefik` | Evitar conflito nas portas 80/443 |
| Banco do Evolution | `docker ps` (container do Postgres do Evolution) | Backup das sessões do WhatsApp |
| Domínios | DNS dos domínios apontando para a VPS | Certificados |
| Backups existentes | Painel da Hostinger (backups/snapshots do plano) e `crontab -l` | O que já está protegido |
| Versão da API | Swagger do Evolution (`/swagger/index.html`, conforme documentação) | Confirmar endpoints (ARQUITETURA 5.2) |

**Nunca colar** em chats, documentos ou tickets a saída de comandos que mostrem variáveis de ambiente, `.env` ou chaves.

## 3. Topologias possíveis (escolhida depois do levantamento)

| | Situação encontrada | Como o DisparaZap se conecta |
|---|---|---|
| **A** | Evolution Go em Docker **na mesma VPS** | Rede Docker privada compartilhada (`backend`); o worker chama o Evolution por HTTP interno; webhooks voltam pela rede interna, sem passar pela internet |
| **B** | Evolution Go **em outro servidor** | HTTPS com certificado válido e verificação TLS ligada; firewall do Evolution liberado só para o IP da VPS do DisparaZap; webhooks chegam por `https://app.<dominio>/hooks/...` com segredo |
| **C** | Evolution Go **ainda não instalado** | Instalar como serviço do Compose, com Postgres próprio e versão fixa (topologia A) |

---

## 4. Requisitos mínimos

| Ambiente | Mínimo | Recomendado | Observação |
|---|---|---|---|
| **Produção** (DisparaZap + Evolution Go na mesma VPS) | 2 vCPU · 8 GB RAM · 100 GB NVMe | 4 vCPU · 16 GB · 200 GB | O recomendado dá folga para agentes de IA e mais instâncias |
| **Produção** (Evolution Go em outro servidor) | 2 vCPU · 4 GB · 80 GB | 2 vCPU · 8 GB | — |
| **Homologação** (VPS separada) | 1–2 vCPU · 4 GB · 50 GB | 2 vCPU · 8 GB | Mesma configuração de software da produção |

Orçamento de memória estimado da produção mínima (topologia A). O consumo do Evolution Go precisa ser **medido**:

| Serviço | RAM | | Serviço | RAM |
|---|---:|---|---|---:|
| Sistema + Docker | 0,7 GB | | PostgreSQL (DisparaZap) | 1,5 GB |
| Caddy | 0,1 GB | | Redis | 0,5 GB |
| api | 0,5 GB | | Evolution Go | ~1 GB (medir) |
| worker | 0,5 GB | | PostgreSQL (Evolution) | 1 GB |
| backup (eventual) | 0,25 GB | | **Folga** | ~2 GB |

---

## 5. Containers e serviços

```
                       Internet
                 80/443 │      (SSH 22 restrito)
                 ┌──────▼──────┐
   rede "edge"   │   caddy     │  HTTPS automático, estáticos do painel
                 └──────┬──────┘
                        │
                 ┌──────▼──────┐        ┌──────────────┐
  rede "backend" │    api      │◄──────►│ evolution-go │ (topologia A/C)
  (com saída     ├─────────────┤        └──────────────┘
   p/ internet)  │   worker    │──► webhooks de saída / Evolution externo (B)
                 └──────┬──────┘
                        │
  rede "data"    ┌──────▼──────┬─────────────┬────────────┐
  (internal:     │  postgres   │    redis    │   backup   │──► armazenamento externo
   true)         └─────────────┴─────────────┴────────────┘
```

| Serviço | Imagem | Redes | Porta publicada | Volume | Health check | Limite |
|---|---|---|---|---|---|---|
| `caddy` | `caddy:2` (com os estáticos do painel embutidos) | edge | **80, 443** | `caddy_data`, `caddy_config` | `wget` em `/health/live` via proxy | 0,25 CPU · 128 MB |
| `api` | `disparazap-api:<commit>` | edge, backend, data | — | — | `/health/ready` | 1 CPU · 512 MB |
| `worker` | mesma imagem, comando `worker` | backend, data | — | — | heartbeat no Redis | 1 CPU · 512 MB |
| `migrate` (execução única) | mesma imagem, comando `migrate` | data | — | — | — | — |
| `postgres` | `postgres:17` (versão fixa) | data | — | `pg_data` | `pg_isready` | 1,5 CPU · 1,5 GB |
| `redis` | `redis:7` (versão fixa) | data | — | `redis_data` | `redis-cli ping` | 0,5 CPU · 512 MB |
| `backup` | imagem com `pg_dump` + ferramenta de backup cifrado | data, backend | — | `backup_tmp` | resultado do último job | 0,5 CPU · 256 MB |
| `evolution-go` (A/C) | imagem oficial, versão fixa | backend | — (ver I6) | conforme instalação | a definir no levantamento | ~1–2 GB |

- Uma rede marcada `internal: true` **não tem saída para a internet**: por isso `postgres` e `redis` ficam isolados em `data`.
- `api` e `worker` precisam de saída (Evolution externo, webhooks), então também participam de `backend`.

## 6. Rede, portas e firewall

- **Portas públicas, só estas:**
  - `443/tcp` (HTTPS);
  - `80/tcp` (redirecionamento para HTTPS e validação de certificado);
  - `22/tcp` (SSH), restrita ao IP do administrador quando possível.
- **Nunca publicar** PostgreSQL (5432), Redis (6379) ou a porta do Evolution Go.
- **Duas camadas de firewall:** o firewall do painel da Hostinger e o `ufw` no sistema.
- ⚠ **Pegadinha do Docker:** portas publicadas com `ports:` **ignoram as regras do `ufw`**. Por isso nenhum serviço interno usa `ports:`.
  Se for preciso acessar o banco para manutenção, use túnel SSH ou publique em `127.0.0.1`.
- **Endurecimento do servidor:**
  - SSH só com chave, sem senha e sem login de `root`;
  - usuário `deploy` dedicado;
  - `fail2ban`;
  - atualizações de segurança automáticas;
  - relógio sincronizado (NTP) e fuso UTC no servidor (o painel mostra o fuso de cada empresa);
  - swap modesto (ex.: 2 GB) para evitar o encerramento de processos por falta de memória;
  - rotação de logs do Docker configurada globalmente.

## 7. Proxy reverso e HTTPS

- **Caddy** emite e renova certificados Let's Encrypt automaticamente.
- **Domínios propostos:**
  - `app.<dominio>`: painel + `/api/*` na **mesma origem** (sem CORS, cookies first-party);
  - `staging.<dominio>`: homologação, com autenticação básica adicional na frente;
  - `api.<dominio>`: opcional no futuro, se a API pública precisar de host próprio.
- **Configuração no Caddy:**
  - cabeçalhos de segurança (HSTS, CSP, `nosniff`, `Referrer-Policy`, `frame-ancestors`);
  - compressão;
  - limite de corpo;
  - timeouts;
  - repasse de `X-Request-Id`.
- **Webhooks do Evolution:**
  - topologia A: chamam `http://api:<porta>/hooks/...` pela rede interna, sem passar pelo Caddy;
  - topologia B: entram via HTTPS.

Exemplo **ilustrativo** (não é arquivo do projeto):

```caddyfile
app.<dominio> {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
    handle /api/* {
        reverse_proxy api:3000
    }
    handle {
        root * /srv/web
        try_files {path} /index.html
        file_server
    }
}
```

## 8. Volumes persistentes

| Volume | Conteúdo | Backup |
|---|---|---|
| `pg_data` | Banco do DisparaZap | **Sim** (seção 10) |
| `redis_data` | Filas (AOF) | Não: reconstruível a partir do Postgres |
| `caddy_data` | Certificados | Opcional (são reemitidos, mas há limite de emissões) |
| Dados do Evolution Go + Postgres dele | Sessões do WhatsApp | **Sim**, se forem administrados por nós; perdê-los obriga a reconectar todos os números |
| `backup_tmp` | Arquivos temporários de backup | Não |
| Arquivos da base de conhecimento (futuro) | Documentos dos agentes | Preferir armazenamento de objetos compatível com S3 |

Os dados ficam em `/opt/disparazap/<ambiente>/` (`compose.yml`, `secrets/` e volumes nomeados). O uso de disco é monitorado (seção 12).

## 9. Gerenciamento de segredos

| Segredo (nome) | Uso |
|---|---|
| `POSTGRES_PASSWORD`, `DZ_APP_DB_PASSWORD`, `DZ_PLATFORM_DB_PASSWORD` | Superusuário e papéis da aplicação no banco |
| `REDIS_PASSWORD` | Acesso ao Redis |
| `ENCRYPTION_MASTER_KEY` | Cofre de credenciais (AES-256-GCM) |
| `PHONE_HASH_PEPPER`, `API_KEY_PEPPER` | HMAC de telefones suprimidos e de API keys |
| `EVOLUTION_GLOBAL_API_KEY` | Chave global do Evolution Go (uma por servidor) |
| `BACKUP_ENCRYPTION_KEY`, credenciais do armazenamento externo | Backups cifrados |

- **Onde ficam:** arquivos em `/opt/disparazap/<ambiente>/secrets/`, dono `root`, permissão `600`. São montados com
  `secrets:` do Compose em `/run/secrets/` e lidos pela aplicação via variáveis `*_FILE`.
- **Onde nunca ficam:** git, imagem Docker, documentação, logs ou chat.
- **Por ambiente:** homologação e produção têm segredos **diferentes**.
- **Cópia offline** com o dono do produto (ex.: gerenciador de senhas) de `ENCRYPTION_MASTER_KEY` e `BACKUP_ENCRYPTION_KEY`:
  - perder a primeira = perder todas as credenciais de integração;
  - perder a segunda = backups inutilizáveis.
- **Rotação:** procedimento documentado por segredo. A chave mestra tem `key_version`, o que permite recifrar aos poucos.

## 10. Backup e restauração

| O quê | Como | Frequência | Retenção | Destino |
|---|---|---|---|---|
| Banco do DisparaZap | `pg_dump -Fc`, cifrado | Diário + antes de toda migration | 7 diários · 4 semanais · 6 mensais | Armazenamento externo (outro provedor) + 3 dias local |
| Banco/sessões do Evolution (se nosso) | Igual ao acima | Diário | Igual | Igual |
| Segredos | Cópia offline | A cada mudança | — | Fora da VPS (dono do produto) |
| Configuração (`compose`, Caddyfile) | Git | A cada mudança | Histórico do git | Repositório privado |
| VPS inteira | Snapshot do painel da Hostinger (confirmar o que o plano inclui) | Antes de mudanças grandes | Conforme o plano | Hostinger |

- **Metas iniciais:** RPO de 24 h (perda máxima de dados) e RTO de 4 h (tempo para voltar).
  Fase seguinte: arquivamento contínuo de WAL (ex.: pgBackRest) para RPO de minutos.
- **Procedimento de restauração:**
  1. subir `postgres` vazio;
  2. baixar e decifrar o backup;
  3. `pg_restore`;
  4. rodar `migrate` (no-op se a versão bater);
  5. subir `api`/`worker`;
  6. conferir health e contagens.
- **Teste de restauração mensal** em homologação; falha de backup gera alerta.

## 11. Health checks

| Serviço | Verificação | Falha significa |
|---|---|---|
| `api` | `/health/live` (processo) e `/health/ready` (Postgres + Redis) | Não recebe tráfego / reinicia |
| `worker` | Heartbeat no Redis a cada 30 s | Filas paradas → alerta |
| `postgres` | `pg_isready` | Dependentes aguardam |
| `redis` | `redis-cli ping` | Dependentes aguardam |
| Evolution Go | Consulta periódica de status pelo adaptador | Instâncias marcadas como degradadas; campanhas pausadas, sem derrubar a API |
| Externo | Monitor de disponibilidade **fora da VPS** em `https://app.<dominio>/health/live` | Site fora do ar → alerta |

O Compose usa `depends_on: condition: service_healthy` e `restart: unless-stopped`.

## 12. Logs, métricas e alertas

- **Logs:**
  - JSON (pino) na saída padrão → driver do Docker com rotação (ex.: 10 MB × 5 arquivos);
  - `request_id`, `organization_id` e `user_id` em cada linha;
  - redação de segredos; **corpo de mensagens nunca é registrado**.
- **Métricas (fase 1, enxuta):**
  - profundidade das filas;
  - envios por minuto por instância;
  - taxa de falhas;
  - instâncias desconectadas;
  - falhas de webhook;
  - CPU, RAM e disco.

  Endpoint `/metrics` só na rede interna; painel das filas acessível apenas ao Super Admin.
- **Fase 2:** Prometheus + Grafana + Loki, se a VPS comportar (~1 GB de RAM), ou serviço externo.
- **Alertas** (e-mail ou mensageiro):
  - serviço fora do ar;
  - instância desconectada;
  - taxa de falhas acima do limite;
  - disco acima de 80%;
  - backup com falha;
  - certificado perto de expirar.

## 13. Limites de recursos

- `deploy.resources.limits` e `reservations` (CPU/memória) em todos os serviços do Compose.
- Node com `--max-old-space-size` abaixo do limite do container.
- PostgreSQL com `shared_buffers` ≈ 25% do limite dele.
- Redis com `maxmemory` abaixo do limite do container, `maxmemory-policy noeviction` (exigência do BullMQ) e AOF ligado.
- Rotação de logs e alerta de disco evitam que o servidor pare por disco cheio.

## 14. Implantação e rollback

**Pré-requisitos:**
- git com repositório privado;
- CI que gera a imagem marcada com o **hash do commit** e a envia a um registro privado (ou build na própria VPS no início).

**Implantação:**
1. Backup do banco (e snapshot da VPS se houver migration relevante).
2. Baixar a imagem da nova versão.
3. Rodar `migrate` (migrations **compatíveis com a versão anterior** — padrão *expand/contract*).
4. `docker compose up -d api worker`.
5. Conferir health checks + teste rápido (login, listar instâncias).
6. Registrar no [CHANGELOG](CHANGELOG_DESENVOLVIMENTO.md).

**Rollback:**
1. Voltar a tag da imagem anterior e rodar `docker compose up -d` (segundos).
2. Como as migrations só adicionam (*expand*), a versão anterior continua funcionando com o banco novo.
   Remoções (*contract*) ficam para uma versão posterior.
3. Restaurar o backup só em último caso.
4. Manter as 5 últimas imagens.

**Fluxo:** toda versão passa primeiro pela homologação. A produção só recebe **a mesma imagem** já validada, com aprovação explícita.

## 15. Homologação

| Opção | Prós | Contras |
|---|---|---|
| **VPS separada (recomendada)** | Isolamento real: um erro em homologação não derruba a produção | Custo de uma segunda VPS (menor) |
| Mesma VPS, projeto Compose separado | Mais barato | Disputa CPU, RAM e disco com a produção |

Regras:
- domínio próprio com autenticação adicional;
- segredos próprios;
- **Evolution Go e números de teste próprios**;
- **nenhum dado real de produção** (só dados fictícios ou anonimizados);
- mesmas imagens da produção;
- envios reais apenas para números de teste e com autorização.

## 16. Decisões de infraestrutura que precisam de aprovação

| # | Decisão | Recomendação |
|---|---|---|
| I1 | Autorizar o levantamento somente leitura da VPS (seção 2) | Executar antes de qualquer outra etapa de infraestrutura |
| I2 | Domínio e subdomínios | `app.<dominio>` e `staging.<dominio>` |
| I3 | Tamanho da VPS de produção e homologação separada | Produção ≥ 2 vCPU · 8 GB; homologação em VPS separada |
| I4 | Armazenamento externo para backups | Provedor diferente da Hostinger, compatível com S3 |
| I5 | Repositório, CI e registro de imagens | Repositório privado + CI gerando imagens por commit |
| I6 | Exposição pública do Evolution Go | Manter a URL HTTPS pública só enquanto o MVP local existir, com certificado válido; depois, fechar e usar só a rede interna (topologia A) |
| I7 | Monitoramento externo e canal de alertas | Serviço de uptime fora da VPS + alerta por e-mail/mensageiro |

## 17. Checklist antes de ir ao ar

- [ ] Levantamento da VPS concluído e topologia definida (A, B ou C)
- [ ] Endpoints do Evolution Go confirmados na versão instalada
- [ ] Apenas as portas 80/443 (e 22 restrita) abertas; banco e Redis sem porta publicada
- [ ] HTTPS ativo com cabeçalhos de segurança
- [ ] Segredos fora do git, com cópia offline das chaves mestras
- [ ] Backup diário funcionando **e restauração testada**
- [ ] Health checks e alertas ativos; monitor externo configurado
- [ ] Teste de isolamento entre empresas aprovado
- [ ] Super Admin com 2FA; nenhum usuário padrão
- [ ] Campanha de teste concluída em homologação
- [ ] Plano de rollback ensaiado
