# Speaker's Garage: one image, one port: the web app, the HTTP API and the game WebSocket.
# Build from the repository root:
#   docker build -f apps/server/Dockerfile -t speakers-garage .
#   docker run -p 8787:8787 speakers-garage            # then open http://localhost:8787

# ---- build: install the workspace, build shared -> web -> server (turbo), keep the server's prod deps
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json prettier.config.js ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @speakersgarage/server... --filter @speakersgarage/web...
COPY packages packages
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm turbo run build --filter=@speakersgarage/server \
 && pnpm --filter @speakersgarage/server deploy --prod --legacy /out \
 && cp -r apps/server/dist /out/dist \
 && cp -r apps/web/dist /out/web

# ---- run: production dependencies, the server bundle and the built site, as a non-root user
FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 WEB_DIST_PATH=/app/web SERVE_WEB=on
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/web ./web
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
