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

# 텍스트 자산 사전 압축 — nginx gzip_static 이 이 .gz 를 그대로 낸다.
# 빌드 시점에 -9 로 압축해 두면 요청마다 CPU 를 쓰지 않으면서 런타임 기본값(-6)
# 보다 압축률이 높다. 원본은 -k 로 남겨 gzip 을 못 받는 클라이언트에 대응한다.
# 1KB 미만은 건너뛴다 — 헤더 오버헤드가 이득을 먹는다.
RUN find /src/public -type f \
      \( -name '*.html' -o -name '*.css'  -o -name '*.js'   -o -name '*.json' \
      -o -name '*.xml'  -o -name '*.txt'  -o -name '*.svg'  -o -name '*.md'   \
      -o -name '*.webmanifest' \) \
      -size +1k -exec gzip -9 -k -f {} +

# Serve stage
FROM nginx:alpine
# 기본 설정을 덮는다. 기본값으로 서빙하는 동안 압축·캐시·404·리다이렉트 스킴이
# 전부 깨져 있었다 — 자세한 근거는 nginx/default.conf 주석.
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /src/public /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
