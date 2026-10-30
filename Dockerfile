# Production image: builds the web app and serves it from the API on port 4000.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0 DATABASE_URL=file:/data/farmledger.db
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 4000
CMD ["sh", "-c", "cd apps/api && npx prisma db push --skip-generate && npx tsx prisma/seed.ts && node dist/server.js"]
