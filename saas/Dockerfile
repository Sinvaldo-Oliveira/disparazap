# DisparaZap: imagem da API, que também entrega o painel (Easypanel, a partir do GitHub).
# Contexto de build: a pasta saas/. Os segredos e o certificado do banco NÃO entram na imagem: entram como
# variáveis e arquivo montado no Easypanel (veja infra/docker/LEIA-ME.md).

# Etapa 1: instala tudo, compila a API, o painel e os pacotes e remove as dependências só de desenvolvimento
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund \
 && npm run build \
 && npm prune --omit=dev

# Etapa 2: só o JavaScript compilado e as dependências de produção
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    API_HOST=0.0.0.0 \
    API_PORT=3100 \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/packages ./packages

USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.API_PORT || 3100) + '/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
