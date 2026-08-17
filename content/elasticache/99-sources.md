---
title: "출처"
weight: 99
---

# 출처 — Redis · Valkey · Memcached 조사 자료

이 페이지는 [2009 첫 커밋부터 6.2 까지]({{< relref "01-origins-and-design/index.md" >}}), [memcached — 같은 문제를 다르게 푼 6년 선배]({{< relref "02-memcached/index.md" >}}), [왜 찢어졌나 — Commons Clause 부터 AGPL 복귀까지]({{< relref "03-license-and-fork.md" >}}), [Redis 7.0 → 8.10 — 그리고 9 는 왜 없나]({{< relref "04-redis-7-to-8.md" >}}), [Valkey 8.0 → 9.1 — 엔진이 갈라진 지점]({{< relref "05-valkey-8-to-9/index.md" >}}), [cluster mode — 16384 슬롯이 강제하는 것]({{< relref "06-cluster-mode/index.md" >}}), [AWS 에서 엔드포인트는 어떻게 바뀌나]({{< relref "07-aws-endpoints/index.md" >}}), [무엇을 고를 것인가]({{< relref "08-choosing.md" >}}) 여덟 페이지가 인용한 1차 조사 문서의 근거 표기에서 URL 부분만 모은 목록입니다. 근거 표기는 URL·`gh api`·로컬 클론 `git show` 세 형태였는데 그중 URL 만 뽑아 중복을 제거하고 주제별로 분류했습니다.

그 1차 조사 문서가 다룬 범위는 Redis 첫 커밋(2009-03-22)부터 6.2 까지의 설계 연쇄, Redis 7.0\~8.10 의 버전별 신기능·breaking change·"9 가 없다"는 사실 확인, memcached 의 23년치 slab/LRU/영속성 진화(2003-05-27 첫 커밋 기산), 2018\~2025 라이선스 변경과 Valkey·Redict 등 포크 계보, Valkey 8.x 의 내부 자료구조 교체(dict entry 키 임베딩 → `hashtable.c`)와 비동기 I/O 스레딩, Valkey 9.x 와 atomic slot migration, cluster mode 내부 구조(16384 슬롯·MOVED/ASK·슬롯 마이그레이션), AWS ElastiCache·MemoryDB 엔드포인트·버전 지원입니다.

조사 기준일은 문서마다 갈립니다. 엔진을 다룬 조사 문서는 **2026-08-05**, AWS 를 다룬 `08-aws-endpoints` 와 갭 리포트 `07-gap-2`(ElastiCache cluster mode 전환 시 엔드포인트가 어떻게 바뀌는가)는 **2026-08-06**, 갭 리포트 `07-gap-3`(Valkey 모듈 생태계 전수조사)은 2026-08-05 입니다. 집필 착수 전 최종 게이트의 판정일은 **2026-08-06** 입니다.

개별 URL 의 등급(확인됨/추정/미확인)은 원 조사 문서 본문의 인라인 태그를 따릅니다 — 이 표 자체는 출처 목록이며 등급을 재판정하지 않습니다.

## Redis 공식

redis.io 의 기술 문서·블로그입니다. 라이선스·거버넌스 관련은 아래 `라이선스·포크` 절로 분리했습니다.

- **프로토콜 스펙(RESP1/2/3 원문)** — [redis.io/.../protocol-spec](https://redis.io/docs/latest/develop/reference/protocol-spec/)
- **Functions 소개(7.0)** — [redis.io/.../functions-intro](https://redis.io/docs/latest/develop/programmability/functions-intro/)
- **Redis 8 GA 블로그** — [redis.io/blog/redis-8-ga](https://redis.io/blog/redis-8-ga/)
- **Vector sets 자료형 문서** — [redis.io/.../vector-sets](https://redis.io/docs/latest/develop/data-types/vector-sets/)
- **8.8 성능 개선 블로그(MGET/MSET/Streams)** — [redis.io/blog/redis-88-performance-improvements-...](https://redis.io/blog/redis-88-performance-improvements-faster-mget-mset-streams-and-more/)
- **버전 관리 정책 문서(Standard/Extended)** — [redis.io/.../version-mgmt](https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/)
- **Redis Enterprise product lifecycle 문서** — [redis.io/.../product-lifecycle](https://redis.io/docs/latest/operate/rs/installing-upgrading/product-lifecycle/)
- **8.10 What's New 문서** — [redis.io/.../whats-new/8-10](https://redis.io/docs/latest/develop/whats-new/8-10/)
- **8.0 What's New 문서(Vector Set 이 아직 beta 로 표기돼 vector-sets 페이지와 불일치하는 근거)** — [redis.io/.../whats-new/8-0](https://redis.io/docs/latest/develop/whats-new/8-0/)
- **Enterprise capabilities 문서(Stack 모듈 번들 근거)** — [redis.io/.../enterprise-capabilities](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/enterprise-capabilities/)
- **Redis Enterprise Flash(Auto Tiering) 문서** — [redis.io/.../databases/flash](https://redis.io/docs/latest/operate/rs/databases/flash/)
- **8.0-M01 발표 블로그("one Redis for every use case")** — [redis.io/blog/redis-8-0-m01-...](https://redis.io/blog/redis-8-0-m01-released-one-redis-for-every-use-case/)
- **Streams 소개(5.0.0 릴리스노트가 인용한 구 경로)** — [redis.io/topics/streams-intro](https://redis.io/topics/streams-intro)
- **`EVAL` 커맨드 구 경로(2.6.0 릴리스노트 원문 인용)** — [redis.io/commands/eval](http://redis.io/commands/eval)
- **Atomic Slot Migration 블로그(성능 수치·설계 근거)** — [redis.io/blog/atomic-slot-migration](https://redis.io/blog/atomic-slot-migration/)
- **`CLUSTER MIGRATION` 커맨드 문서(since 8.4.0)** — [redis.io/.../cluster-migration](https://redis.io/docs/latest/commands/cluster-migration/)
- **공식 클라이언트 5종 발표 블로그** — [redis.io/blog/five-official-redis-clients](https://redis.io/blog/five-official-redis-clients/)
- **Lettuce 공식 클라이언트 편입 블로그** — [redis.io/blog/lettuce-joins-redis-official-client-family](https://redis.io/blog/lettuce-joins-redis-official-client-family/)
- **Sentinel 문서** — [redis.io/.../management/sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)

## Valkey 공식

valkey.io 의 기술 문서·블로그입니다. 라이선스·포크 서사 쪽은 아래 절에 따로 두었습니다.

- **Unlock One Million RPS 블로그(io-threads 벤치마크 조건 원문)** — [valkey.io/blog/unlock-one-million-rps](https://valkey.io/blog/unlock-one-million-rps/)
- **메모리 효율 8.0 블로그(kvstore·임베디드 엔트리)** — [valkey.io/blog/valkey-memory-efficiency-8-0](https://valkey.io/blog/valkey-memory-efficiency-8-0/)
- **8.1.0 GA 블로그(hashtable 교체)** — [valkey.io/blog/valkey-8-1-0-ga](https://valkey.io/blog/valkey-8-1-0-ga/)
- **8.0.0-rc1 블로그(RDMA 실험 지원)** — [valkey.io/blog/valkey-8-0-0-rc1](https://valkey.io/blog/valkey-8-0-0-rc1/)
- **마이그레이션 가이드(Redis→Valkey 절차 원문)** — [valkey.io/topics/migration](https://valkey.io/topics/migration/)
- **릴리스·지원 정책 표(버전별 initial release 기산일)** — [valkey.io/topics/releases](https://valkey.io/topics/releases/)
- **Introducing Valkey 9 블로그** — [valkey.io/blog/introducing-valkey-9](https://valkey.io/blog/introducing-valkey-9/)
- **9.1 발표 블로그(보안·성능·기능)** — [valkey.io/blog/valkey-9-1-delivers-improvements-...](https://valkey.io/blog/valkey-9-1-delivers-improvements-in-security-performance-and-more/)
- **다운로드/릴리스 목록 페이지** — [valkey.io/download/releases](https://valkey.io/download/releases/)
- **2025 연말 회고 블로그(ValkeyConf 2026·9.2 로드맵)** — [valkey.io/blog/2025-year-end](https://valkey.io/blog/2025-year-end/)
- **`CLUSTER MIGRATESLOTS` 커맨드 문서(since 9.0.0)** — [valkey.io/commands/cluster-migrateslots](https://valkey.io/commands/cluster-migrateslots/)
- **공식 클라이언트 목록(valkey-glide 버전 표)** — [valkey.io/clients](https://valkey.io/clients/)
- **Cluster 튜토리얼** — [valkey.io/topics/cluster-tutorial](https://valkey.io/topics/cluster-tutorial/)
- **다운로드 페이지** — [valkey.io/download](https://valkey.io/download/) — 조회했으나 코어 릴리스(9.1.1/8.1.9/7.2.14)만 있고 모듈 카탈로그는 없음(`07-gap-3` §3.2)
- **모듈 개발 가이드(topics/modules-intro)** — [valkey.io/topics/modules-intro](https://valkey.io/topics/modules-intro/) — 개발 가이드일 뿐 공식 모듈 카탈로그가 아님(`07-gap-3` §3.2)

## memcached 공식

memcached.org·docs.memcached.org 와 메인테이너 dormando 의 공식 채널입니다.

- **memcached.org 홈(최신 릴리스 공지)** — [memcached.org](https://memcached.org/)
- **memcached.org/about(라이선스·거버넌스 고지)** — [memcached.org/about](https://memcached.org/about)
- **dormando 블로그 "NVM caching"(2018, Optane 벤치마크)** — [memcached.org/blog/nvm-caching](https://memcached.org/blog/nvm-caching/)
- **extstore(flash storage) 기능 문서** — [docs.memcached.org/features/flashstorage](https://docs.memcached.org/features/flashstorage/)
- **proxy 기능 문서** — [docs.memcached.org/features/proxy](https://docs.memcached.org/features/proxy/)
- **restartable cache 기능 문서** — [docs.memcached.org/features/restart](https://docs.memcached.org/features/restart/)
- **meta 프로토콜 문서** — [docs.memcached.org/protocols/meta](https://docs.memcached.org/protocols/meta/)
- **dormando 메일링리스트 발언(거버넌스·연간 커밋 집계 대조용)** — [groups.google.com/g/memcached/c/KzyS3dG7XqI](https://groups.google.com/g/memcached/c/KzyS3dG7XqI)
- **GitHub wiki `ReleaseNotes`(1.4 중반 이후 도입 버전의 정본 — `ChangeLog.txt` 는 2009-04-10 에서 끊긴다)** — [github.com/memcached/memcached/wiki/ReleaseNotes](https://github.com/memcached/memcached/wiki/ReleaseNotes)
- **Judy 라이브러리(SourceForge, memcached 최초 커밋 README 가 인용한 의존성 — 링크 사멸 추정)** — [judy.sf.net](http://judy.sf.net/)

## 라이선스·포크 1차 자료

Redis 라이선스 변경사(2018 Commons Clause → 2025 AGPLv3 복귀)와 Valkey·Redict·KeyDB·Garnet 등 포크·거버넌스를 다룬 1차 자료입니다. redis.io·valkey.io 도메인이라도 이 주제인 것은 여기로 모았습니다.

- **antirez "Redis will remain BSD licensed"(2018-08-22)** — [antirez.com/news/120](https://antirez.com/news/120)
- **antirez 스텝다운 공표(2020-06-30)** — [antirez.com/news/133](https://antirez.com/news/133)
- **antirez 복귀 공표(2024-12-10)** — [antirez.com/news/144](https://antirez.com/news/144)
- **antirez 글(AGPL 관련, 2025)** — [antirez.com/news/151](https://antirez.com/news/151)
- **antirez 글(AGPL 관련, 2025)** — [antirez.com/news/152](https://antirez.com/news/152)
- **Redis 블로그 "License will remain BSD"(2018-08-22, 모듈만 Commons Clause)** — [redis.io/blog/redis-license-bsd-will-remain-bsd](https://redis.io/blog/redis-license-bsd-will-remain-bsd/)
- **Redis 블로그 "modules license changes"(2019-02-21, Commons Clause → RSAL)** — [redis.io/blog/redis-labs-modules-license-changes](https://redis.io/blog/redis-labs-modules-license-changes/)
- **Redis 블로그 "new governance"(2020, BDFL 종료·light-governance)** — [redis.io/blog/new-governance-for-redis](https://redis.io/blog/new-governance-for-redis/)
- **Redis 블로그 "core team update"(2020-07-09, Madelyn Olson/AWS 영입)** — [redis.io/blog/redis-core-team-update](https://redis.io/blog/redis-core-team-update/)
- **Redis 프레스 "Redis Labs becomes Redis"(2021-08-11)** — [redis.io/press/redis-labs-becomes-simply-redis](https://redis.io/press/redis-labs-becomes-simply-redis/)
- **Redis 블로그 "adopts dual source-available licensing"(2024-03-20, RSALv2+SSPLv1, OSI 정의상 오픈소스 아님을 자인)** — [redis.io/blog/redis-adopts-dual-source-available-licensing](https://redis.io/blog/redis-adopts-dual-source-available-licensing/)
- **Redis 프레스 "CEO succession"(Rowan Trollope, 2022-12 발표/2023-02 발효)** — [redis.io/press/redis-ceo-succession](https://redis.io/press/redis-ceo-succession/)
- **Redis 블로그 "AGPLv3 추가"(2025-05-01, 트라이 라이선스화)** — [redis.io/blog/agplv3](https://redis.io/blog/agplv3/)
- **Redis 블로그 "welcome back antirez"(2024-12-10)** — [redis.io/blog/welcome-back-to-redis-antirez](https://redis.io/blog/welcome-back-to-redis-antirez/)
- **Linux Foundation 프레스 — Valkey 발표(2024-03-28, BSD-3 유지)** — [linuxfoundation.org/press/.../open-source-valkey-community](https://www.linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community)
- **Redict 발표문(Drew DeVault, 2024-03-22, LGPL-3.0-only)** — [redict.io/posts/2024-03-22-redict-is-an-independent-fork](https://redict.io/posts/2024-03-22-redict-is-an-independent-fork/)
- **Codeberg API — redict/redict 릴리스 목록(Redict 릴리스 케이던스 확인용)** — [codeberg.org/api/v1/repos/redict/redict/releases](https://codeberg.org/api/v1/repos/redict/redict/releases)
- **Valkey 블로그 — Harbor(CNCF graduated) 가 Redis→Valkey 교체** — [valkey.io/blog/harbor-chose-valkey](https://valkey.io/blog/harbor-chose-valkey/)
- **Valkey 블로그 "2024: The Year of Valkey"(배포판·클라우드 채택 정리)** — [valkey.io/blog/2024-year-of-valkey](https://valkey.io/blog/2024-year-of-valkey/)
- **Valkey 블로그 "investment in open source"(커뮤니티 기여 통계)** — [valkey.io/blog/valkey-investment-in-open-source](https://valkey.io/blog/valkey-investment-in-open-source/)
- **Fedora wiki — "Replace Redis With Valkey"(F41, SSPL 비허용 사유 명시)** — [fedoraproject.org/wiki/Changes/Replace_Redis_With_Valkey](https://fedoraproject.org/wiki/Changes/Replace_Redis_With_Valkey)
- **Fedora src API — redis 패키지 git 브랜치 목록(f13~f40 확인, f41+ 없음)** — [src.fedoraproject.org/api/0/rpms/redis/git/branches](https://src.fedoraproject.org/api/0/rpms/redis/git/branches)
- **Fedora packages — valkey 패키지 정보** — [packages.fedoraproject.org/pkgs/valkey/valkey](https://packages.fedoraproject.org/pkgs/valkey/valkey/)
- **Debian sources API — redis 소스 패키지 메타데이터** — [sources.debian.org/api/src/redis](https://sources.debian.org/api/src/redis/)
- **Debian sources API — valkey 소스 패키지 메타데이터** — [sources.debian.org/api/src/valkey](https://sources.debian.org/api/src/valkey/)
- **Debian sources — redis 8.0.6-2 copyright 파일** — [sources.debian.org/src/redis/.../copyright](https://sources.debian.org/src/redis/5%3A8.0.6-2/debian/copyright/)
- **Debian ftp-master — redis 8.0.6-2 changelog** — [metadata.ftp-master.debian.org/.../redis_8.0.6-2_changelog](https://metadata.ftp-master.debian.org/changelogs/main/r/redis/redis_8.0.6-2_changelog)
- **Debian bug #1136392(Debian redis 가 Valkey CVE 패치를 그대로 붙였다가 새 DoS 유발)** — [bugs.debian.org/1136392](https://bugs.debian.org/1136392)
- **Google Cloud 블로그 — Memorystore for Valkey GA(2025-04-18, 99.99% SLA — 날짜는 검색 요약 경유로 확인해 등급이 낮음)** — [cloud.google.com/blog/.../memorystore-for-valkey](https://cloud.google.com/blog/products/databases/announcing-general-availability-of-memorystore-for-valkey/)

## AWS 공식(ElastiCache·MemoryDB)

AWS What's New 공지와 ElastiCache/MemoryDB 개발자 가이드·API·CLI 레퍼런스입니다.

**What's New 공지**

- **ElastiCache Memcached 1.6.17 지원(2023-01)** — [aws.amazon.com/.../memcached-1-6-17](https://aws.amazon.com/about-aws/whats-new/2023/01/amazon-elasticache-supports-memcached-1-6-17)
- **ElastiCache Memcached 1.6.22 지원(2024-01-11, 웹 확인 가능한 최신)** — [aws.amazon.com/.../memcached-1-6-22](https://aws.amazon.com/about-aws/whats-new/2024/01/amazon-elasticache-memcached-1-6-22/)
- **ElastiCache for Valkey 출시(2024-10-08)** — [aws.amazon.com/.../amazon-elasticache-valkey](https://aws.amazon.com/about-aws/whats-new/2024/10/amazon-elasticache-valkey/)
- **MemoryDB for Valkey 출시(2024-10-08)** — [aws.amazon.com/.../amazon-memorydb-valkey](https://aws.amazon.com/about-aws/whats-new/2024/10/amazon-memorydb-valkey/)
- **ElastiCache 8.0 for Valkey(2024-11-21, 스케일링·메모리 효율)** — [aws.amazon.com/.../elasticache-version-8-0-for-valkey-...](https://aws.amazon.com/about-aws/whats-new/2024/11/elasticache-version-8-0-for-valkey-scaling-memory-efficiency/)
- **ElastiCache 8.1 for Valkey(2025-07-24)** — [aws.amazon.com/.../amazon-elasticache-valkey-8-1](https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-elasticache-valkey-8-1/)
- **ElastiCache 8.2 for Valkey — 벡터 검색(2025-10-13)** — [aws.amazon.com/.../amazon-elasticache-vector-search](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-elasticache-vector-search/)
- **ElastiCache Valkey 9.0(2026-05-05)** — [aws.amazon.com/.../valkey-amazon-elasticache](https://aws.amazon.com/about-aws/whats-new/2026/05/valkey-amazon-elasticache/)
- **ElastiCache for Valkey durability GA(2026-06-02)** — [aws.amazon.com/.../durability-amazon-elasticache](https://aws.amazon.com/about-aws/whats-new/2026/06/durability-amazon-elasticache/)
- **ElastiCache Valkey 9.1(2026-06-23)** — [aws.amazon.com/.../amazon-elasticache-valkey-9-1](https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-elasticache-valkey-9-1/)

**개발자 가이드 — ElastiCache**

- **엔드포인트 개요** — [docs.aws.amazon.com/.../dg/Endpoints.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Endpoints.html)
- **Replication 엔드포인트** — [docs.aws.amazon.com/.../dg/Replication.Endpoints.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Replication.Endpoints.html)
- **클라이언트 설정(Replication Group)** — [docs.aws.amazon.com/.../dg/ClientConfig.ReplicationGroup.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/ClientConfig.ReplicationGroup.html)
- **cluster mode 전환(modify-cluster-mode)** — [docs.aws.amazon.com/.../dg/modify-cluster-mode.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/modify-cluster-mode.html)
- **Replication 수정 절차(콘솔/CLI)** — [docs.aws.amazon.com/.../dg/Replication.Modify.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Replication.Modify.html)
- **Multi-AZ 자동 failover** — [docs.aws.amazon.com/.../dg/AutoFailover.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/AutoFailover.html)
- **엔진 버전 관리 방법(마이너/메이저 업그레이드 절차)** — [docs.aws.amazon.com/.../dg/VersionManagement.HowTo.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VersionManagement.HowTo.html)
- **엔진 버전 지원 정책·EOL 일정** — [docs.aws.amazon.com/.../dg/engine-versions.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/engine-versions.html)
- **읽기 복제본(Read Replicas)** — [docs.aws.amazon.com/.../dg/ReadReplicas.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/ReadReplicas.html)
- **cluster mode enabled 스케일링(온라인 리샤딩)** — [docs.aws.amazon.com/.../dg/scaling-redis-cluster-mode-enabled.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/scaling-redis-cluster-mode-enabled.html)
- **온라인 리샤딩 베스트 프랙티스** — [docs.aws.amazon.com/.../dg/best-practices-online-resharding.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/best-practices-online-resharding.html)
- **TLS 연결(connect-tls)** — [docs.aws.amazon.com/.../dg/connect-tls.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/connect-tls.html)
- **전송 중 암호화(in-transit encryption)** — [docs.aws.amazon.com/.../dg/in-transit-encryption.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/in-transit-encryption.html)
- **노드 연결(nodes-connecting)** — [docs.aws.amazon.com/.../dg/nodes-connecting.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/nodes-connecting.html)
- **Python 모범사례(TLS 전환 시 DNS 처리 대조군)** — [docs.aws.amazon.com/.../dg/enable-python-best-practices.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/enable-python-best-practices.html)
- **Lettuce 클라이언트 베스트 프랙티스** — [docs.aws.amazon.com/.../dg/BestPractices.Clients-lettuce.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/BestPractices.Clients-lettuce.html)
- **클라이언트 DNS 설정(ClientConfig.DNS)** — [docs.aws.amazon.com/.../dg/ClientConfig.DNS.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/ClientConfig.DNS.html)
- **문제해결 — WWE(worker writes error) 등** — [docs.aws.amazon.com/.../dg/wwe-troubleshooting.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/wwe-troubleshooting.html)
- **초기 설정(set-up)** — [docs.aws.amazon.com/.../dg/set-up.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/set-up.html)
- **IAM 인증(auth-iam)** — [docs.aws.amazon.com/.../dg/auth-iam.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html)
- **MemoryDB vs Redis OSS 선택 가이드** — [docs.aws.amazon.com/.../related-services-choose-between-memorydb-and-redis.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/related-services-choose-between-memorydb-and-redis.html)
- **내구성(Multi-AZ transactional log)** — [docs.aws.amazon.com/.../dg/durability.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/durability.html)
- **컴포넌트 개요(VPC 전용 등)** — [docs.aws.amazon.com/.../dg/WhatIs.Components.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.Components.html)
- **제한 커맨드 목록(ClientConfig.RestrictedCommands)** — [docs.aws.amazon.com/.../dg/ClientConfig.RestrictedCommands.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/ClientConfig.RestrictedCommands.html)

**API/CLI 레퍼런스 — ElastiCache**

- **API — DescribeReplicationGroups** — [docs.aws.amazon.com/.../API_DescribeReplicationGroups.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/APIReference/API_DescribeReplicationGroups.html)
- **API — ModifyReplicationGroup** — [docs.aws.amazon.com/.../API_ModifyReplicationGroup.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/APIReference/API_ModifyReplicationGroup.html)
- **API — ReplicationGroup 응답 스키마** — [docs.aws.amazon.com/.../API_ReplicationGroup.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/APIReference/API_ReplicationGroup.html)
- **API — NodeGroup 응답 스키마** — [docs.aws.amazon.com/.../API_NodeGroup.html](https://docs.aws.amazon.com/AmazonElastiCache/latest/APIReference/API_NodeGroup.html)
- **CLI — modify-replication-group** — [docs.aws.amazon.com/cli/.../modify-replication-group.html](https://docs.aws.amazon.com/cli/latest/reference/elasticache/modify-replication-group.html)
- **CLI — create-replication-group** — [docs.aws.amazon.com/cli/.../create-replication-group.html](https://docs.aws.amazon.com/cli/latest/reference/elasticache/create-replication-group.html)

**개발자 가이드 — MemoryDB**

- **MemoryDB 란 무엇인가** — [docs.aws.amazon.com/MemoryDB/.../what-is-memorydb.html](https://docs.aws.amazon.com/MemoryDB/latest/devguide/what-is-memorydb.html)
- **MemoryDB 엔드포인트** — [docs.aws.amazon.com/memorydb/.../endpoints.html](https://docs.aws.amazon.com/memorydb/latest/devguide/endpoints.html)
- **MemoryDB 엔진 버전** — [docs.aws.amazon.com/memorydb/.../engine-versions.html](https://docs.aws.amazon.com/memorydb/latest/devguide/engine-versions.html)
- **MemoryDB 노드 연결** — [docs.aws.amazon.com/memorydb/.../nodes-connecting.html](https://docs.aws.amazon.com/memorydb/latest/devguide/nodes-connecting.html)
- **MemoryDB 컴포넌트** — [docs.aws.amazon.com/memorydb/.../components.html](https://docs.aws.amazon.com/memorydb/latest/devguide/components.html)
- **MemoryDB 클러스터 요구사항 결정** — [docs.aws.amazon.com/memorydb/.../cluster-create-determine-requirements.html](https://docs.aws.amazon.com/memorydb/latest/devguide/cluster-create-determine-requirements.html)
- **MemoryDB 클러스터 개요** — [docs.aws.amazon.com/memorydb/.../clusters.html](https://docs.aws.amazon.com/memorydb/latest/devguide/clusters.html)
- **MemoryDB 제한 커맨드 목록** — [docs.aws.amazon.com/memorydb/.../restrictedcommands.html](https://docs.aws.amazon.com/memorydb/latest/devguide/restrictedcommands.html)

**참고 — 타 클라우드 벤더 공식문서(비교용, AWS 아님)**

- **GCP Memorystore for Memcached 지원 버전·폐기 공지(2029-01-31 종료)** — [docs.cloud.google.com/.../memcached/supported-versions](https://docs.cloud.google.com/memorystore/docs/memcached/supported-versions)
- **GCP Memorystore for Valkey — cluster mode enabled/disabled 문서** — [docs.cloud.google.com/.../valkey/cluster-mode-enabled-and-disabled](https://docs.cloud.google.com/memorystore/docs/valkey/cluster-mode-enabled-and-disabled)
- **Microsoft Azure Cache for Redis 아키텍처 문서** — [learn.microsoft.com/.../azure/redis/architecture](https://learn.microsoft.com/en-us/azure/redis/architecture)

## GitHub — 릴리스·PR·설계 문서

redis/redis · valkey-io · memcached 조직의 이슈·PR·커밋 중 URL 로 직접 인용한 것만 모았습니다.

- **redis/redis discussions #13464(버전 넘버링 규칙 논의)** — [github.com/redis/redis/discussions/13464](https://github.com/redis/redis/discussions/13464)
- **redis/redis issues #2576(antirez, 2015-05-12, 16384 슬롯 이유 설명 — 댓글 anchor `#issuecomment-101546151`)** — [github.com/redis/redis/issues/2576](https://github.com/redis/redis/issues/2576)
- **redis/redis pull #13732 "Rdb channel replication"(본문이 `valkey-io/valkey#60` 을 명시 참조)** — [github.com/redis/redis/pull/13732](https://github.com/redis/redis/pull/13732)
- **redis/redis pull #13806(`kvobj` — "adopts Valkey's packing layout" 명시)** — [github.com/redis/redis/pull/13806](https://github.com/redis/redis/pull/13806)
- **redis/redis pull #14414(Redis atomic slot migration, 머지 2025-10-22Z)** — [github.com/redis/redis/pull/14414](https://github.com/redis/redis/pull/14414)
- **valkey-io/valkey pull #1949(Valkey atomic slot migration, 머지 2025-08-12Z)** — [github.com/valkey-io/valkey/pull/1949](https://github.com/valkey-io/valkey/pull/1949)
- **valkey-io/valkey pull #1186(`hashtable.c` — dict 교체)** — [github.com/valkey-io/valkey/pull/1186](https://github.com/valkey-io/valkey/pull/1186)
- **redis/redis pull #12109 "Rdb channel for full sync"(머지되지 않은 선행 PR — Redis #13732 이 자기 기반으로 명시한 둘 중 하나)** — [github.com/redis/redis/pull/12109](https://github.com/redis/redis/pull/12109)
- **redisearch/redisearch(Redis Stack 검색 모듈 리포)** — [github.com/redisearch/redisearch](https://github.com/redisearch/redisearch)
- **valkey-io/valkey pull #60(dual channel replication 원 PR)** — [github.com/valkey-io/valkey/pull/60](https://github.com/valkey-io/valkey/pull/60)
- **valkey-io/valkey commit 3eb8314(Redis PR #13806 이 채용했다고 명시한 packing 레이아웃 커밋)** — [github.com/valkey-io/valkey/commit/3eb8314...](https://github.com/valkey-io/valkey/commit/3eb8314be6af0777e69f852b65f933dd9186d30b)
- **valkey-io/valkey-glide(공식 클라이언트 리포)** — [github.com/valkey-io/valkey-glide](https://github.com/valkey-io/valkey-glide)
- **valkey-io/valkey-ldap issues #73** — [github.com/valkey-io/valkey-ldap/issues/73](https://github.com/valkey-io/valkey-ldap/issues/73)
- **valkey-io/valkey-search issues #473(ASM 지원 요청)** — [github.com/valkey-io/valkey-search/issues/473](https://github.com/valkey-io/valkey-search/issues/473)
- **valkey-io/valkey-json issues #84(ASM 호환 테스트 요청)** — [github.com/valkey-io/valkey-json/issues/84](https://github.com/valkey-io/valkey-json/issues/84)
- **redis/redis-benchmarks-specification(8.8 성능 주장의 재현 스펙)** — [github.com/redis/redis-benchmarks-specification](https://github.com/redis/redis-benchmarks-specification)
- **valkey-io/valkey issues #4218 "Valkey 9.2 Release Plan"(rc1 2026-09-15 / GA 2026-11-15 목표)** — [github.com/valkey-io/valkey/issues/4218](https://github.com/valkey-io/valkey/issues/4218)
- **valkey-io/valkey issues #2957(dual-channel atomic slot migration — 2026-08-06 기준 open, 9.2 계획)** — [github.com/valkey-io/valkey/issues/2957](https://github.com/valkey-io/valkey/issues/2957)
- **valkey-io/valkey issues #2392 · #3538(`CLUSTER MIGRATESLOTS` AUTH/AUTH2 — 둘 다 open)** — [issues/2392](https://github.com/valkey-io/valkey/issues/2392) · [issues/3538](https://github.com/valkey-io/valkey/issues/3538)
- **valkey-io/valkey issues #2755(valkey-cli 의 ASM 경로 지원 — 9.1.0 에 실림)** — [github.com/valkey-io/valkey/issues/2755](https://github.com/valkey-io/valkey/issues/2755)
- **valkey-io/valkey issues #2618(작은 hash + field expiration 메모리 갭, 9.2 계획)** — [github.com/valkey-io/valkey/issues/2618](https://github.com/valkey-io/valkey/issues/2618)
- **Valkey security advisory GHSA-53mc-f3m3-99vh(CVE-2026-56684, TLS use-after-free)** — [github.com/valkey-io/valkey/security/advisories/GHSA-53mc-f3m3-99vh](https://github.com/valkey-io/valkey/security/advisories/GHSA-53mc-f3m3-99vh)
- **Valkey security advisory GHSA-mvcj-73cw-22m4(CVE-2026-63639, stream PEL use-after-free)** — [github.com/valkey-io/valkey/security/advisories/GHSA-mvcj-73cw-22m4](https://github.com/valkey-io/valkey/security/advisories/GHSA-mvcj-73cw-22m4)
- **twitter/twemproxy(프록시 계열 정지 확인 — 마지막 push 2024-03-29)** — [github.com/twitter/twemproxy](https://github.com/twitter/twemproxy)
- **CodisLabs/codis(마지막 push 2024-04-15)** — [github.com/CodisLabs/codis](https://github.com/CodisLabs/codis)
- **memcached/memcached pull #484(dormando, meta 커맨드 제안 원 PR)** — [github.com/memcached/memcached/pull/484](https://github.com/memcached/memcached/pull/484)

## 로컬 레포 체크아웃

URL 이 아니라 로컬 blobless 클론에서 `git show <tag|sha>:path`·`git log`·`for-each-ref`로 직접 실측한 근거입니다. 클론 위치는 8개 조사 문서가 공통으로 씁니다 — AWS 를 다룬 `08-aws-endpoints` 도 self-host 대조군 절에서 `valkey 9.1.1:valkey.conf` 를 같은 클론에서 읽었습니다.

- **클론 위치**: `~/evejuni/redis`, `~/evejuni/valkey`, `~/evejuni/memcached`
- **실측 기준일**: **2026-08-05**(AWS 문서 기반 절과 `07-gap-2` 는 2026-08-06)
- **판정 수단**: `git show <tag>:<path>`(소스 실측) · `git log --diff-filter=A`(신규 파일 도입 커밋 특정) · `git for-each-ref refs/tags/<tag>`(태그 생성일) · `git merge-base --is-ancestor`(공통 조상 판정) · `git ls-tree <tag> <path>`(존재 여부) — `gh api`(GitHub REST, 릴리스 `published_at`·PR `merged_at` 대조용)는 URL 이 아니므로 이 목록에서 제외
- **인용에 쓴 대표 태그·커밋** — Redis: `2.0.0`, `2.2.0`, `2.4.0`, `2.6.0`(`-rc1` 포함), `2.8.0`, `3.0.0`, `3.2.0`, `4.0.0`, `5.0.0`, `6.0.0`, `6.2.0`/`6.2.23`, `7.0.0`, `7.2.0`/`7.2.4`/`7.2.15`, `7.4.0`, `8.0.0`, `8.2.0`, `8.4.0`, `8.6.0`, `8.8.0`/`8.8.1`, `8.10.0`, 커밋 `ed9b544e1`(첫 커밋)·`44b38ef43`(AOF)·`e8a74421b`(멀티불크)·`8cd62f82`(kvstore 공통 조상)·`d65102861`(AGPLv3 추가)·`266835659`(LICENSE.txt GPLv3→AGPLv3 정정)
- Valkey: `7.2.4`, `7.2.5`, `8.0.0`, `8.1.0`, `9.0.0`, `9.1.0`, `9.1.1`, 커밋 `38632278f`(첫 커밋)·`d7993b78d`(ASM 머지)
- memcached: `1.6.44`, `1.6.45`, 커밋 `32f382b`(첫 커밋)·`0c3b47f`(GPL→BSD)·`4c56c8d`(slab mover 재작성)

## 2차 자료(요약·기사)

1차 출처를 찾지 못해 요약·저널리즘·벤더 코멘터리에 의존한 항목만 분리했습니다.

- **LWN — 2018 Commons Clause 보도** — [lwn.net/Articles/763179](https://lwn.net/Articles/763179/)
- **LWN — Garnet 오픈소스화 등 포크 동향 보도(2024)** — [lwn.net/Articles/966631](https://lwn.net/Articles/966631/)
- **blog.remirepo.net — Redis 8.0 패키징 노트(rpm 관점)** — [blog.remirepo.net/.../Redis-version-8.0](https://blog.remirepo.net/post/2025/07/25/Redis-version-8.0)
- **Percona 블로그 — 라이선스 변경 이후 커뮤니티 침식 정량화** — [percona.com/blog/community-erosion-...](https://www.percona.com/blog/community-erosion-post-license-change-quantifying-the-power-of-open-source/)
- **The Register — "A year on, Valkey charts path to v9 after break from Redis"(2025-05-15)** — [theregister.com/2025/05/15/a_year_of_valkey](https://www.theregister.com/2025/05/15/a_year_of_valkey/)
- **ScyllaDB 블로그 — "ScyllaDB and memcached"(벤더 코멘터리)** — [scylladb.com/2024/10/08/scylladb-and-memcached](https://www.scylladb.com/2024/10/08/scylladb-and-memcached/)
- **AWS re:Post 지식센터 — CME→CMD 전환 절차("AWS OFFICIAL" 배지이나 원 조사문서(`07-gap-2` R1)가 2차로 표기)** — [repost.aws/knowledge-center/elasticache-update-cme-to-cmd](https://repost.aws/knowledge-center/elasticache-update-cme-to-cmd)
