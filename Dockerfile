# Build stage — pin Hugo extended (hugo-book theme needs >= 0.158)
FROM debian:bookworm-slim AS builder
ARG HUGO_VERSION=0.164.0
# git 은 enableGitInfo(hugo.toml) 때문에 필요하다. Hugo 가 파일별 마지막 커밋
# 시각을 읽어 .Lastmod 를 채우는데, 바이너리가 없으면 그 값이 비어버린다.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git \
    && curl -sL "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz" \
       | tar -xz -C /usr/local/bin hugo \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
# Docker 안에서는 /src 의 소유자가 빌드 사용자와 달라 git 이 "dubious ownership"
# 으로 거부한다. 그러면 enableGitInfo 가 조용히 빈 값을 내므로 예외로 등록한다.
RUN git config --global --add safe.directory /src

RUN hugo --gc --minify

# Serve stage
FROM nginx:alpine
COPY --from=builder /src/public /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
