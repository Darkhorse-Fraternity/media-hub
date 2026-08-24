# syntax=docker/dockerfile:1

# ============================================
# Stage 1: Alpine base with libc compatibility
# ============================================
FROM node:22-alpine AS alpine
RUN apk add --no-cache libc6-compat

# ============================================
# Stage 2: Base with pnpm and turbo
# ============================================
FROM alpine AS base
RUN corepack enable && corepack prepare pnpm@10.19.0 --activate
RUN npm install -g turbo@^2

# ============================================
# Stage 3: Prune monorepo for media-hub
# ============================================
FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @acme/media-hub --docker

# ============================================
# Stage 4: Install dependencies and build
# ============================================
FROM base AS builder
WORKDIR /app

# Copy pruned lockfile and package.json files
COPY --from=pruner /app/out/json/ .

# Install dependencies
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy pruned source code
COPY --from=pruner /app/out/full/ .

# Build the application
RUN turbo run build --filter=@acme/media-hub

# ============================================
# Stage 5: Production runner
# ============================================
FROM alpine AS runner
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init ffmpeg

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/apps/media-hub/.output ./.output

USER nodejs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", ".output/server/index.mjs"]
