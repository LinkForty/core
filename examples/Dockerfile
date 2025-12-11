FROM node:22-alpine

WORKDIR /app

# Install curl and dumb-init for health checks and signal handling
# Split to avoid busybox trigger issues in ARM64 QEMU builds
RUN apk add --no-cache --no-scripts curl dumb-init && \
    /bin/busybox --install -s || true

# Create non-root user for security
RUN addgroup -g 1001 -S linkforty && \
    adduser -S linkforty -u 1001 -G linkforty

# Copy package files
COPY package*.json ./

# Install dependencies (skip prepare script since we already built in CI)
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# Copy source files
COPY dist ./dist
COPY examples/basic-server.ts ./

# Install tsx for running TypeScript
RUN npm install -g tsx

# Change ownership to non-root user
RUN chown -R linkforty:linkforty /app

# Switch to non-root user
USER linkforty

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/sdk/v1/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Run migrations on startup and then start server
CMD ["sh", "-c", "tsx dist/scripts/migrate.js && tsx basic-server.ts"]
