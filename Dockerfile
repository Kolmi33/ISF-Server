# Security-first, non-root, minimal. No build step, no dependencies to install.
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/buchungen.db \
    IMPORT_JSON=/data/buchungen.json \
    BACKUP_DIR=/data/backups

WORKDIR /app

# Copy only what runs. package.json first for layer caching.
COPY package.json ./
COPY src ./src
COPY public ./public
# Startdaten: seedet die DB beim Erststart (Fallback, wenn /data leer ist)
COPY buchungen.json ./

# /data is a mounted volume at runtime; make sure the unprivileged user owns it.
RUN mkdir -p /data && chown -R node:node /data /app

# Drop root: the app runs as the built-in unprivileged "node" user.
USER node

EXPOSE 3000

# Container-level liveness check (compose/orchestrator restarts on failure).
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.mjs"]
