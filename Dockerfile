FROM node:22-alpine AS api-deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

FROM api-deps AS api-build
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=api-build /app/dist ./dist
COPY backend/drizzle ./drizzle
COPY backend/drizzle.config.ts ./
RUN mkdir -p public
USER node
CMD ["node", "dist/worker.main.js"]

FROM api-deps AS dev
WORKDIR /app
COPY backend/ ./
CMD ["npx", "tsx", "watch", "src/worker.main.ts"]
