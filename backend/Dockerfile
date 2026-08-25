FROM node:22-alpine AS api-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM api-deps AS api-build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=api-build /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
USER node
CMD ["node", "dist/worker.main.js"]

# Built from full deps on purpose: the migrate service needs drizzle-kit,
# which is a devDependency and absent from the runtime stage.
FROM api-deps AS dev
WORKDIR /app
COPY . ./
CMD ["npx", "tsx", "watch", "src/worker.main.ts"]
