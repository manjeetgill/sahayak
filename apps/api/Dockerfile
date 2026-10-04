FROM node:22-slim
RUN npm i -g pnpm@9.15.9 --registry=https://registry.npmjs.org
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
ENV NODE_ENV=production
EXPOSE 4000
# Migrate + seed demo data (seed is skipped if the demo clinic already exists), then start the API.
CMD ["sh", "-c", "pnpm db:migrate && pnpm db:seed && pnpm --filter @sahayak/api start"]
