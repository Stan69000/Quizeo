FROM node:22-alpine

WORKDIR /app

# Install exactly what the lockfile pins: a build never resolves a newer,
# unreviewed version of a dependency.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY server.js ./
COPY public/ ./public/

ENV PORT=3010
EXPOSE 3010

USER node

CMD ["node", "server.js"]
