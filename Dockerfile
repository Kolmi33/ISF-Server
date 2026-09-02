# Multi-stage: build the frontend with Vite, then ship a lean, zero-dependency runtime.
# The runtime stage carries only the backend + the built frontend (no node_modules).

# ---- build stage: compile the frontend (vite) AND the backend (tsc) ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.ts tsconfig.json tsconfig.server.json ./
COPY web ./web
COPY server ./server
COPY shared ./shared
RUN npm run build        # -> /app/dist/public : index.html + hashed assets (Vite build)
RUN npm run build:server # -> /app/dist/server/{server,shared} : compiled backend, zero runtime deps

# ---- runtime stage: the zero-dependency Node server + built frontend ----
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/buchungen.db \
    IMPORT_JSON=/data/buchungen.json \
    BACKUP_DIR=/data/backups

WORKDIR /app

# Only what runs: the compiled backend, its shared pure modules, seed data, and the built
# frontend. The compiled server lives at /app/server so its `../public` and
# `../buchungen.json` paths resolve the same way regardless of source layout changes
# upstream; /app/shared sits alongside it (same relative layout as the source tree) so the
# compiled `../shared/dates.js` imports keep resolving (no env/path changes needed here
# when server/, shared/, or web/ get reorganized further).
COPY package.json ./
COPY buchungen.json ./
COPY --from=build /app/dist/server/server ./server
COPY --from=build /app/dist/server/shared ./shared
COPY --from=build /app/dist/public ./public

# /data is a mounted volume at runtime; make sure the unprivileged user owns it.
RUN mkdir -p /data && chown -R node:node /data /app

# Drop root: the app runs as the built-in unprivileged "node" user.
USER node

EXPOSE 3000

# Container-level liveness check (compose/orchestrator restarts on failure).
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
