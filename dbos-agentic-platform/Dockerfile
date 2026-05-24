FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
COPY scripts/ scripts/
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache git curl \
    && curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ dist/
COPY src/db/schema.sql dist/src/db/schema.sql
EXPOSE 3000
# Override CMD at runtime:
#   "node dist/src/worker.js"          for worker
#   "node dist/scripts/seed-sales.js"  for one-shot seed
CMD ["node", "dist/src/server.js"]
