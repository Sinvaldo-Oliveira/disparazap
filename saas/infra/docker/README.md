# Infraestrutura Docker (reservado)

Nenhum arquivo de Docker ou Docker Compose existe nesta fase, de propósito: PostgreSQL, Redis e Caddy
não foram instalados nem executados, e um Compose não testado seria só uma suposição.

Quando a infraestrutura for autorizada, esta pasta receberá o que está planejado em
`docs/PLANO_IMPLANTACAO_HOSTINGER.md` (raiz do repositório):
- `compose.dev.yml`: PostgreSQL e Redis locais para desenvolvimento;
- `compose.prod.yml`: Caddy, api, worker, PostgreSQL, Redis e backup, com redes privadas e limites de recursos;
- `Caddyfile` e scripts de backup e implantação.
