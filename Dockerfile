# Blacktop Brawl: game files + multiplayer server in one small container.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js index.html CREDITS.md ./
COPY src ./src
COPY vendor ./vendor
COPY assets ./assets
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
