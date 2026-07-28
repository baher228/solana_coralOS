# API image for the Freelance Escrow Platform. Build context = repo root:
#   docker build -f deploy/docker/api.Dockerfile -t txodds-api .
FROM node:20-slim AS build
WORKDIR /app
# agent-runtime is a file: dependency of the example; install + build it first.
COPY packages/agent-runtime/package.json packages/agent-runtime/
RUN cd packages/agent-runtime && npm install --no-audit --no-fund
COPY packages/agent-runtime packages/agent-runtime
RUN cd packages/agent-runtime && npm run build
# Example deps (links to ../../packages/agent-runtime).
COPY examples/txodds/package.json examples/txodds/
RUN cd examples/txodds && npm install --no-audit --no-fund
COPY examples/txodds examples/txodds

FROM node:20-slim
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/examples/txodds
ENV NODE_ENV=production
EXPOSE 8801
# The server runs schema migrations (CREATE TABLE IF NOT EXISTS) on startup.
CMD ["npm", "run", "proxy"]
