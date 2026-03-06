FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-alpine
LABEL org.opencontainers.image.title="AFFiNE MCP Server" \
      org.opencontainers.image.description="MCP server for self-hosted AFFiNE instances — read, write, search, and manage docs, tables, diagrams, and comments" \
      org.opencontainers.image.vendor="Emmabyte Engineering" \
      org.opencontainers.image.license="MIT" \
      org.opencontainers.image.source="https://github.com/emmabyte-engineering/affine-mcp"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ dist/
ENTRYPOINT ["node", "dist/index.js"]
