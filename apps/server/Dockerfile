# Build from the repository root:  docker build -f apps/server/Dockerfile -t magiali-server .
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN npm ci --workspace @magiali/server --workspace @magiali/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @magiali/server

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/apps/server/package.json apps/server/
RUN npm ci --omit=dev --workspace @magiali/server --ignore-scripts && npm cache clean --force
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/migrations apps/server/migrations
WORKDIR /app/apps/server
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
