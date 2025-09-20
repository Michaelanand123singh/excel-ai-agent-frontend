# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

# Copy package.json & lock file from frontend
COPY frontend/package*.json ./
RUN npm ci

# Copy rest of frontend
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm pkg set scripts.start="vite preview --host 0.0.0.0 --port ${PORT} --strictPort" \
 && npm ci --omit=dev
EXPOSE 8080
CMD ["npm", "run", "start"]
