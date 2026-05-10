FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ dist/
COPY src/db/schema.sql dist/src/db/schema.sql
EXPOSE 3000
# Override CMD at runtime: "node dist/src/worker.js" for worker
CMD ["node", "dist/src/server.js"]
