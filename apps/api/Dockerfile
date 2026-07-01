FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/integrations/package.json packages/integrations/
COPY services/voice/package.json services/voice/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace packages/shared --workspace packages/integrations --workspace services/voice --workspace apps/api --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/voice ./services/voice
COPY apps/api ./apps/api
RUN npm run build -w packages/shared && npm run build -w packages/integrations && npm run build -w services/voice && npm run build -w apps/api

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/voice ./services/voice
COPY --from=build /app/apps/api ./apps/api
EXPOSE 4100
CMD ["node", "apps/api/dist/index.js"]
