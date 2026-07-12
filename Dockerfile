# Build stage — pin Hugo extended (hugo-book theme needs >= 0.158)
FROM debian:bookworm-slim AS builder
ARG HUGO_VERSION=0.164.0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -sL "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz" \
       | tar -xz -C /usr/local/bin hugo \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN hugo --gc --minify

# Serve stage
FROM nginx:alpine
COPY --from=builder /src/public /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
