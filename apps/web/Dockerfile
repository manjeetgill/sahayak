FROM node:22-slim
RUN npm i -g pnpm@9.15.9 --registry=https://registry.npmjs.org
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @sahayak/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@sahayak/web", "start"]
