# Base fijada por digest (node:22-alpine, re-pull 2026-10-31). Para actualizar: docker pull node:22-alpine
# y reemplazar el digest en ambas etapas; luego re-escanear con trivy image.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /app
ENV NODE_ENV=production
# apk upgrade: parches de seguridad de Alpine sobre la base.
# El runtime solo ejecuta "node server.js": se eliminan npm, npx, corepack y yarn (los 10 HIGH de Trivy
# venían del npm empaquetado en la imagen base, no de las dependencias de la app).
RUN apk upgrade --no-cache \
 && apk add --no-cache curl tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* /root/.npm /tmp/*
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p /app/data/catalogo && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","server.js"]
