FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
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
