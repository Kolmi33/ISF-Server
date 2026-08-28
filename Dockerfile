# Multi-stage: build the frontend with Vite, then ship a lean, zero-dependency runtime.
# The runtime stage carries only the backend + the built frontend (no node_modules).

# ---- build stage: compile the frontend ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.ts tsconfig.json ./
COPY web ./web
RUN npm run build        # -> /app/dist/public : index.html + hashed assets + legacy.js

# ---- runtime stage: the zero-dependency Node server + built frontend ----
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/buchungen.db \
    IMPORT_JSON=/data/buchungen.json \
    BACKUP_DIR=/data/backups

WORKDIR /app

# Only what runs: backend, seed data, and the built frontend (served from /app/public,
# unchanged from the server's point of view — no server code change needed).
COPY package.json ./
COPY src ./src
COPY buchungen.json ./
COPY --from=build /app/dist/public ./public

# /data is a mounted volume at runtime; make sure the unprivileged user owns it.
RUN mkdir -p /data && chown -R node:node /data /app

# Drop root: the app runs as the built-in unprivileged "node" user.
USER node

EXPOSE 3000

# Container-level liveness check (compose/orchestrator restarts on failure).
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.mjs"]
