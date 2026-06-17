# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY services/incident-engine/package.json ./services/incident-engine/

# Install all dependencies (including workspace links)
RUN npm ci

# Copy source code
COPY packages/shared-types/ ./packages/shared-types/
COPY packages/shared-utils/ ./packages/shared-utils/
COPY services/incident-engine/ ./services/incident-engine/

# Build all packages and the service
RUN npm run build --workspace=packages/shared-types && \
    npm run build --workspace=packages/shared-utils && \
    npm run build --workspace=services/incident-engine

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /app/packages/shared-types/dist/ ./packages/shared-types/dist/
COPY --from=builder /app/packages/shared-utils/package.json ./packages/shared-utils/
COPY --from=builder /app/packages/shared-utils/dist/ ./packages/shared-utils/dist/
COPY --from=builder /app/services/incident-engine/package.json ./services/incident-engine/
COPY --from=builder /app/services/incident-engine/dist/ ./services/incident-engine/dist/
COPY --from=builder /app/services/incident-engine/migrations/ ./services/incident-engine/migrations/

# Install production dependencies only
RUN npm ci --omit=dev --workspace=services/incident-engine

# Non-root user for security
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
USER appuser

EXPOSE 4000

CMD ["node", "services/incident-engine/dist/index.js"]
