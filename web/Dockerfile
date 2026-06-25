# Build from repo root:
#   docker build -f web/Dockerfile -t web:latest .

FROM node:20-slim AS builder
WORKDIR /build

# SDK (used via @pay/coral-client alias in next.config.mjs)
COPY packages/coral-client/ ./packages/coral-client/

# web
COPY web/package*.json ./web/
RUN cd web && npm install
COPY web/ ./web/
ARG NEXT_PUBLIC_CORAL_SERVER=http://coral:5555
ARG NEXT_PUBLIC_API_SERVER=http://api-server:8081
ARG NEXT_PUBLIC_SELLER_WALLET=""
ARG NEXT_PUBLIC_PRICE_SOL=""
RUN cd web && npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /build/web/.next/standalone ./
COPY --from=builder /build/web/.next/static ./.next/static
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
