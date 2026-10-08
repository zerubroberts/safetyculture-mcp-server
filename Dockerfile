# safetyculture-mcp container: Streamable HTTP by default, stdio with `docker run -i ... stdio`.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npx tsup && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    SC_DATA_DIR=/data \
    SC_HTTP_HOST=0.0.0.0 \
    SC_HTTP_PORT=8787
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json LICENSE README.md SECURITY.md ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
# Binding 0.0.0.0 requires SC_HTTP_BEARER_TOKEN; the server refuses to start without it.
ENTRYPOINT ["node", "dist/index.js"]
CMD ["http"]
