# Build from the repository root (workspace required for @poc/buyer):
#   docker build -f app/AgentBuyer/Dockerfile .
#
FROM node:20-slim AS builder
WORKDIR /repo
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/buyer ./packages/buyer
COPY app/AgentBuyer ./app/AgentBuyer

RUN pnpm install --frozen-lockfile
RUN pnpm --filter agent-buyer run build
RUN pnpm --filter agent-buyer deploy --legacy /deploy

FROM node:20-slim
WORKDIR /app
COPY --from=builder /deploy ./

RUN useradd -m -u 1000 bedrock_agentcore && chown -R bedrock_agentcore:bedrock_agentcore /app
USER bedrock_agentcore

EXPOSE 8080 8000 9000
CMD ["node", "dist/agent.js"]
