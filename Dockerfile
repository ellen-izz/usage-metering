
FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src

RUN npm run build

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/index.js"]
