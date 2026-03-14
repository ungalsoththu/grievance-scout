# grievance-scout
# Containerized grievance monitoring system

FROM oven/bun:1-alpine AS base

WORKDIR /app

# Install SQLite for database operations
RUN apk add --no-cache sqlite

# Copy package files
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Create data directory
RUN mkdir -p /data/reports

# Environment variables
ENV AUDIT_DB_PATH=/data/audit.db
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD bun -e "const db = require('bun:sqlite').Database; new db(process.env.AUDIT_DB_PATH || '/data/audit.db'); console.log('OK')" || exit 1

# Default command: run audit in agent mode
CMD ["bun", "run", "scripts/audit.ts", "--agent-mode"]
