FROM node:24.9.0-bookworm-slim@sha256:3e69116c924bfcba6c6979aff60d966c37aef56d488ce091c69d442ebec9f103 AS build
WORKDIR /work
ARG HAEN_WEB_BASE_PATH=/
ENV HAEN_WEB_BASE_PATH=$HAEN_WEB_BASE_PATH
RUN npm install --global pnpm@12.5.1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM build AS portable
RUN pnpm --filter @haen/server --prod deploy /out/server

FROM node:24.9.0-bookworm-slim@sha256:3e69116c924bfcba6c6979aff60d966c37aef56d488ce091c69d442ebec9f103 AS server
ARG VCS_REF=local
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

FROM build AS migration
ARG VCS_REF=local
LABEL org.opencontainers.image.title="HAEN migration tools" org.opencontainers.image.revision=$VCS_REF
ENV NODE_ENV=production
WORKDIR /work/apps/server
USER node
ENTRYPOINT ["node", "dist/entrypoints/migrate.js"]

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS web
ARG VCS_REF=local
ARG HAEN_WEB_BASE_PATH=/
LABEL io.haen.web-base=$HAEN_WEB_BASE_PATH
LABEL org.opencontainers.image.title="HAEN web" org.opencontainers.image.revision=$VCS_REF
RUN command -v getcap && if [ -n "$(getcap /usr/bin/caddy)" ]; then setcap -r /usr/bin/caddy; fi \
    && addgroup -g 1000 haen && adduser -D -u 1000 -G haen haen && chown -R haen:haen /data /config
COPY --from=build /work/apps/web/dist/ /srv/
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/maintenance/index.html /srv/maintenance.html
USER haen
EXPOSE 8080 8443
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
