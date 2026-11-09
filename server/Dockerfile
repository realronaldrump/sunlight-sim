# Multiplayer server image (build from the repository root: docker build -f server/Dockerfile .)
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY client/src/terrain/heightfield.ts client/src/terrain/codec.ts ./client/src/terrain/
COPY client/src/world/mountainGuestWorld.ts ./client/src/world/
COPY client/public/world/resort.json client/public/world/surface.bin.gz ./client/public/world/
COPY client/public/world/terrain/index.json ./client/public/world/terrain/index.json
COPY client/public/world/terrain/L0/ ./client/public/world/terrain/L0/
COPY client/public/world/trees/ ./client/public/world/trees/
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "server/src/index.ts"]
