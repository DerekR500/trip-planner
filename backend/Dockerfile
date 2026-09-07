# Development image: runs `tsx watch`, with source bind-mounted from the host by
# docker-compose.yml. This is not a production build (no compile step, dev deps included).
FROM node:24-alpine

WORKDIR /app

# Copy manifests first so `npm install` is cached and only re-runs when deps change.
COPY package.json package-lock.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
