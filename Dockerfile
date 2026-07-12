# Build stage
FROM hugomods/hugo:exts AS builder
WORKDIR /src
COPY . .
RUN hugo --gc --minify

# Serve stage
FROM nginx:alpine
COPY --from=builder /src/public /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
