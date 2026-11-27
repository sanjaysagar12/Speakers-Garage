# Game server image (build from the repository root):
#   docker build -f apps/server/Dockerfile -t speakers-garage .
#   docker run -p 8787:8787 -e ALLOWED_ORIGINS=https://play.example.com speakers-garage

# ---- build: install the workspace, bundle the server (tsup inlines @speakersgarage/shared)
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @speakersgarage/server...
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @speakersgarage/server build \
 && pnpm --filter @speakersgarage/server deploy --prod --legacy /out \
 && cp -r apps/server/dist /out/dist

# ---- run: production dependencies + the bundle, as a non-root user
FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
