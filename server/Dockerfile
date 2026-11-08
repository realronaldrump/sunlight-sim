# Multiplayer server image (build from the repository root: docker build -f server/Dockerfile .)
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY client/public/world/resort.json ./client/public/world/resort.json
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "server/src/index.ts"]
