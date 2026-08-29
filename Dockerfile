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

# --enableGitInfo 를 hugo.toml 이 아니라 여기 둔다. 이 옵션은 빌드 환경에
# 의존한다 — 빌더에 git 바이너리가 있어야 하고(위 apt 목록), /src 가
# safe.directory 여야 하고(바로 위), CI checkout 이 full clone 이어야 한다
# (.github/workflows 의 fetch-depth: 0). 그 전제들과 같은 자리에 두는 편이
# 읽기 쉽다.
#
# 그리고 hugo.toml 에 두면 위험하다. enableGitInfo 는 최상위 키인데 [outputs]
# 같은 테이블 헤더 뒤로 밀리면 TOML 이 그 테이블의 하위 키로 파싱해 조용히
# 무효가 된다 — hugo 는 경고 한 줄만 낸다:
#   WARN  Unknown kind "enablegitinfo" in outputs configuration.
# 형제 브랜치가 hugo.toml 의 같은 영역에 [outputs] 를 추가하고 있어서 머지 후
# 정확히 그 사고가 났다(통합 머지에서 실제로 밟았다). CLI 플래그는 그 위험이
# 없고, hugo.toml 쪽 충돌 표면도 [params] 한 줄로 줄어든다.
RUN hugo --gc --minify --enableGitInfo

# Serve stage
FROM nginx:alpine
COPY --from=builder /src/public /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
