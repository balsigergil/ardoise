# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-only
# Single Ardoise image; the process role is chosen with ARDOISE_ROLE (ARCHITECTURE §2).
ARG NODE_IMAGE=node:26.13.1-trixie-slim

FROM ${NODE_IMAGE} AS build
RUN npm install -g pnpm@12.21.0
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@ardoise/server --filter=@ardoise/web
# Self-contained server: production dependencies + built workspace packages.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm --filter @ardoise/server deploy --prod /out \
 && cp -r apps/web/dist /out/web \
 && cp LICENSE /out/LICENSE

FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="Ardoise" \
      org.opencontainers.image.description="Self-hosted collaborative workspace" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production \
    ARDOISE_ROLE=all \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out /app
COPY --chmod=755 docker/ardoise /usr/local/bin/ardoise
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["ardoise"]
CMD ["serve"]
