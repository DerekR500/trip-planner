# Development image: runs `tsx watch`, with source bind-mounted from the host by
# docker-compose.yml. This is not a production build (no compile step, dev deps included).
#
# The build context is the REPO ROOT, not backend/, because the backend imports the
# shared/ protocol. Both end up under /app so that `../../shared` resolves the same way
# inside the container as it does on the host.
FROM node:24-alpine

WORKDIR /app/backend

# Copy manifests first so `npm install` is cached and only re-runs when deps change.
COPY backend/package.json backend/package-lock.json ./
RUN npm install

COPY backend ./
COPY shared /app/shared

EXPOSE 3000

CMD ["npm", "run", "dev"]
