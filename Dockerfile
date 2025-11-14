FROM node:20-slim AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY public ./public

# ensure sqlite directory exists even in empty containers
RUN mkdir -p data

EXPOSE 3000

CMD ["npm", "start"]
