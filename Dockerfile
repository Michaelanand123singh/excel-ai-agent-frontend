# syntax=docker/dockerfile:1

# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime stage: use Nginx to serve static files
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html

# Copy build output to Nginx web root
COPY --from=builder /app/dist ./

# Expose Cloud Run port
EXPOSE 8080

# Override default Nginx config to use 8080 (instead of 80)
RUN sed -i 's/listen       80;/listen 8080;/' /etc/nginx/conf.d/default.conf

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
