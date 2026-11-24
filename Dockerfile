# Backend image (Railway, Fly.io or any container host). No npm dependencies to install.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    TRUST_PROXY=true
# Mount a persistent volume on /data (database + uploaded media).
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
