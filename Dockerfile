# Gatehouse web app (control room, client portal, mobile API). Build from the repo root.
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# next build does not need secrets: AUTH_SECRET/SMTP are read lazily at request time
RUN pnpm --filter @gatehouse/web build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@gatehouse/web", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
