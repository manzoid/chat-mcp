# --- Build stage ---
FROM node:20-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
RUN pnpm -r build

# --- Production deps stage ---
FROM node:20-slim AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
ENV CI=true
RUN pnpm install --frozen-lockfile --prod

# --- Runtime stage ---
FROM node:20-slim

# openssh-client needed for ssh-keygen (message signing)
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 chatmcp && useradd -u 1001 -g chatmcp -m chatmcp

WORKDIR /app

# Copy production deps (clean install, no dev deps)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=deps /app/package.json ./

# Copy built artifacts
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/

# Data directory for SQLite DB and attachments
RUN mkdir -p /data && chown chatmcp:chatmcp /data
VOLUME /data

USER chatmcp

ENV NODE_ENV=production
ENV PORT=8808
ENV DB_PATH=/data/chat.db
ENV ATTACHMENT_PATH=/data/attachments

EXPOSE 8808

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD node -e "fetch('http://localhost:8808/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
