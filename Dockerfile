# syntax=docker/dockerfile:1

# ----------------
# Build stage
# ----------------
FROM node:20-alpine AS builder
WORKDIR /app

# Accept API base URL at build time
ARG VITE_API_BASE
ENV VITE_API_BASE=$VITE_API_BASE

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build React/Vite app with API base injected
RUN npm run build

# ----------------
# Runtime stage
# ----------------
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html

# Copy built app to Nginx web root
COPY --from=builder /app/dist ./

# Expose Cloud Run port
EXPOSE 8080

# Update Nginx config: listen on 8080 & handle SPA routes
RUN sed -i 's/listen       80;/listen 8080;/' /etc/nginx/conf.d/default.conf \
 && sed -i '/index  index.html index.htm;/a \\ttry_files $uri /index.html;' /etc/nginx/conf.d/default.conf

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
