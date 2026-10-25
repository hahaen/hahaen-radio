FROM node:24.9.0-bookworm-slim@sha256:3e69116c924bfcba6c6979aff60d966c37aef56d488ce091c69d442ebec9f103
ARG VCS_REF
LABEL org.opencontainers.image.revision=$VCS_REF io.haen.project="radio" io.haen.runtime-log="private-jsonl-v1"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 HAEN_APPLICATION_REVISION=$VCS_REF
WORKDIR /app
COPY --chown=node:node server/ ./
RUN mkdir -p /var/lib/haen/recognition /var/log/haen && chown -R node:node /var/lib/haen /var/log/haen
USER node
EXPOSE 3001
ENTRYPOINT ["node"]
CMD ["dist/entrypoints/api.js"]
