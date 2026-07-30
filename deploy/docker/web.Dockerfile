# Web image: build the Vite dashboard and serve it with nginx (which reverse-proxies
# /api and /mcp to the API container). Build context = repo root:
#   docker build -f deploy/docker/web.Dockerfile -t txodds-web .
FROM node:26-slim AS build
WORKDIR /app
COPY packages/agent-runtime packages/agent-runtime
RUN cd packages/agent-runtime && npm ci --no-audit --no-fund
COPY examples/txodds/package.json examples/txodds/package-lock.json examples/txodds/
RUN cd examples/txodds && npm ci --no-audit --no-fund
COPY examples/txodds examples/txodds
RUN cd examples/txodds && npm run web:build

FROM nginx:1.27-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/examples/txodds/web/dist /usr/share/nginx/html
EXPOSE 80
