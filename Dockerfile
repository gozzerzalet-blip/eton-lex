# ETON LEX — imagen ligera para Suga Free (0.1 vCPU / 256 MiB)
# Los artefactos compilados se versionan en el repo; aquí solo se instalan
# dependencias de producción, se migran datos y se arranca la API.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data \
    DATABASE_PATH=/data/eton-lex.db \
    BACKUP_DIR=/data/backups \
    NODE_OPTIONS=--max-old-space-size=192 \
    HOME=/home/eton

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --omit=dev && npm cache clean --force

COPY apps/api/dist ./apps/api/dist
COPY apps/web/dist ./apps/web/dist
COPY scripts ./scripts

RUN addgroup -S eton \
 && adduser -S -G eton -h /home/eton eton \
 && mkdir -p /data /data/backups /home/eton \
 && chown -R eton:eton /data /home/eton /app

USER eton
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/system/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start:production"]
