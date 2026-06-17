# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY services/notification-service/package.json ./services/notification-service/

# Install all dependencies (including workspace links)
RUN npm ci

# Copy source code
COPY packages/shared-types/ ./packages/shared-types/
COPY packages/shared-utils/ ./packages/shared-utils/
COPY services/notification-service/ ./services/notification-service/

# Build all packages and the service
RUN npm run build --workspace=packages/shared-types && \
    npm run build --workspace=packages/shared-utils && \
    npm run build --workspace=services/notification-service

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /app/packages/shared-types/dist/ ./packages/shared-types/dist/
COPY --from=builder /app/packages/shared-utils/package.json ./packages/shared-utils/
COPY --from=builder /app/packages/shared-utils/dist/ ./packages/shared-utils/dist/
COPY --from=builder /app/services/notification-service/package.json ./services/notification-service/
COPY --from=builder /app/services/notification-service/dist/ ./services/notification-service/dist/

# Install production dependencies only
RUN npm ci --omit=dev --workspace=services/notification-service

# Non-root user for security
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
USER appuser

EXPOSE 4001

CMD ["node", "services/notification-service/dist/index.js"]
