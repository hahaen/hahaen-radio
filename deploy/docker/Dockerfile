FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS dependencies
WORKDIR /work
RUN npm install --global pnpm@12.5.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/config/package.json ./packages/config/
RUN --mount=type=cache,id=haen-pnpm-12,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY --chown=node:node . .

FROM dependencies AS server-build
RUN pnpm --filter @haen/contracts build && pnpm --filter @haen/server build

FROM dependencies AS web-build
ARG HAEN_WEB_BASE_PATH=/
ENV HAEN_WEB_BASE_PATH=$HAEN_WEB_BASE_PATH
RUN pnpm --filter @haen/contracts build && pnpm --filter @haen/web build && pnpm --filter @haen/web check:budget

FROM server-build AS portable
RUN pnpm --filter @haen/server --prod deploy /out/server

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS server
ARG VCS_REF=local
ARG BUILD_NUMBER=local
LABEL org.opencontainers.image.version="$VCS_REF-$BUILD_NUMBER"
LABEL org.opencontainers.image.title="HAEN server" org.opencontainers.image.revision=$VCS_REF io.haen.runtime-log="private-jsonl-v1"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
ENV HAEN_APPLICATION_REVISION=$VCS_REF
WORKDIR /app
COPY --from=portable --chown=node:node /out/server/ ./
RUN mkdir -p /var/lib/haen/recognition && chown node:node /var/lib/haen/recognition && chmod 700 /var/lib/haen/recognition
RUN mkdir -p /var/log/haen && chown node:node /var/log/haen && chmod 700 /var/log/haen
USER node
EXPOSE 3001
ENTRYPOINT ["node"]
CMD ["dist/entrypoints/api.js"]

FROM server-build AS migration
ARG VCS_REF=local
ARG BUILD_NUMBER=local
LABEL org.opencontainers.image.version="$VCS_REF-$BUILD_NUMBER"
LABEL org.opencontainers.image.title="HAEN migration tools" org.opencontainers.image.revision=$VCS_REF
ENV NODE_ENV=production
WORKDIR /work/apps/server
USER node
ENTRYPOINT ["node", "dist/entrypoints/migrate.js"]

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS web
ARG VCS_REF=local
ARG BUILD_NUMBER=local
LABEL org.opencontainers.image.version="$VCS_REF-$BUILD_NUMBER"
ARG HAEN_WEB_BASE_PATH=/
LABEL io.haen.web-base=$HAEN_WEB_BASE_PATH
LABEL org.opencontainers.image.title="HAEN web" org.opencontainers.image.revision=$VCS_REF
RUN command -v getcap && if [ -n "$(getcap /usr/bin/caddy)" ]; then setcap -r /usr/bin/caddy; fi \
    && addgroup -g 1000 haen && adduser -D -u 1000 -G haen haen && chown -R haen:haen /data /config
COPY --from=web-build --chown=haen:haen /work/apps/web/dist/ /srv/
COPY --chown=haen:haen deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --chown=haen:haen deploy/maintenance/index.html /srv/maintenance.html
USER haen
EXPOSE 8080 8443
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
