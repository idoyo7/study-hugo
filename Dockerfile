# Build stage — pin Hugo extended (hugo-book theme needs >= 0.158)
FROM debian:bookworm-slim AS builder
ARG HUGO_VERSION=0.164.0
# git 은 선택이 아니다. enableGitInfo 가 켜져 있어 Hugo 가 파일별 최종 커밋일을
# git 에서 읽는다. 빠지면 빌드가 조용히 나빠지는 게 아니라 통째로 실패한다 —
# 실측: `failed to load Git data: binary with name "git" not found in PATH`.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git \
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
