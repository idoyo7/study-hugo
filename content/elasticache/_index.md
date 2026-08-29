---
title: "Redis · Valkey · Memcached"
weight: 11
cascade:
  type: docs
comments: false
---

# Redis · Valkey · Memcached — 17년치 설계 결정의 연쇄

{{< callout type="info" >}}
이 챕터에서 하나만 가져간다면 이것입니다.

- **Redis 에 9 는 없습니다.** 태그·숫자 브랜치·마일스톤이 모두 없고 8.10 GA 이후에도 `unstable` 은 `8.9.241` 에 머물러 있습니다. 9.x 를 가진 쪽은 **Valkey**(9.0.0 = 2025-10-21)이고 홀짝 케이던스는 두 진영이 정반대입니다 `✓` → [04]({{< relref "04-redis-7-to-8.md" >}})
- **2026-08-06 기준 최신** — Redis **8.10.0**(2026-07-29) · Valkey **9.1.1**(2026-07-21) · memcached **1.6.45**(2026-07-09) `✓`
- **포크는 봉합되지 않았습니다.** Redis 는 2025-05 에 AGPLv3 를 추가해 OSI 승인 라이선스로 복귀했는데도 Valkey 는 따라 돌아가지 않았습니다 — 늘어난 것은 라이선스 옵션의 개수뿐이고 그 개수를 정하는 주체(CLA)는 그대로입니다 `✓` → [03]({{< relref "03-license-and-fork.md" >}})
- **마이그레이션은 RDB 숫자가 정합니다.** Valkey 8.x 는 Redis 7.4+ (RDB 12)를 거부합니다. Valkey 9.x(RDB 80 / `VALKEY080`)는 8.x 로 되돌아가지 못하고 Redis 는 8.6·8.8·8.10 에서 릴리스마다 숫자가 올라가 롤백 창이 닫혔습니다 `✓`
- **양 진영 모두 `io-threads` 기본값은 1(비활성)** 이고 Redis 는 8.10.0 까지 이 값이 `IMMUTABLE_CONFIG` 입니다. 벤더가 내세우는 "2배"·"1.19M rps" 는 전부 8 스레드 조건입니다 `Ⓥ`
- **atomic slot migration 은 양쪽에 다 있고 방향이 반대입니다** — Valkey 는 source push(`CLUSTER MIGRATESLOTS`), Redis 는 destination pull(`CLUSTER MIGRATION IMPORT`). 리샤딩 자동화가 진영 간 호환되지 않는 첫 사례입니다 `✓` → [06]({{< relref "06-cluster-mode/index.md" >}})
- **ElastiCache 의 Redis OSS 는 7.1 에서 멈췄습니다** — 그 위는 전부 Valkey 입니다. ElastiCache 에 Redis 8 은 없습니다 `✓` → [07]({{< relref "07-aws-endpoints/index.md" >}})
- **memcached 는 멈춘 소프트웨어가 아닙니다.** segmented LRU·extstore·meta 프로토콜·내장 proxy·slab mover 재작성이 전부 Redis 등장 이후에 들어왔습니다 `✓` → [02]({{< relref "02-memcached/index.md" >}})
{{< /callout >}}

> 릴리스노트는 "무엇이 추가됐다"까지만 말합니다. **"왜 이렇게 생겼고 · 지금 무엇을 골라야 하나"** 는 말해주지 않습니다. 인메모리 데이터스토어에서는 그 간격이 특히 큽니다 — 2009년에 "값은 blob 이 아니라 자료구조다"라고 정한 결정이 단일 스레드를 불렀습니다. 단일 스레드는 원자성을 공짜로 줬고 그 대가를 17년째 갚고 있습니다. 그 사이 라이선스가 한 번 바뀌면서 엔진이 둘로 갈라졌고 두 진영은 같은 기능을 다른 이름·반대 방향으로 구현하기 시작했습니다. 이 챕터의 축은 이렇습니다 — **왜 이렇게 생겼나(설계 연쇄) · 왜 갈라졌나(거버넌스) · 지금 무엇을 고르나(판단)**.

이 챕터는 인메모리 데이터스토어를 한자리에 모은 **버킷**입니다. 디렉토리 이름이 `elasticache` 인 것은 우리가 실제로 굴리는 형태에서 따왔고 8개 문서 중 AWS 를 다루는 것은 [07]({{< relref "07-aws-endpoints/index.md" >}}) 하나뿐입니다. 나머지는 엔진 자체의 역사·설계·포크·cluster입니다.

## 왜 이걸 정리하는가

질문은 여섯 개였습니다 — Redis 가 첫 커밋부터 버전업하며 어떻게 발전해왔나, memcached 와는 무엇이 다르고 memcached 자체는 어떻게 변했나, Valkey 는 왜 찢어졌나, 7·8·9 에 무엇이 추가되나, cluster mode 는 어떤 구조인가, AWS 에서 엔드포인트가 어떻게 바뀌나.

그런데 **네 번째 질문은 전제부터 틀려 있습니다. Redis 에 9 는 없습니다.** `redis/redis` 에 `9*` 태그가 하나도 없고 숫자 브랜치는 `8.10` 이 끝입니다. 마일스톤 목록에도 `9.0` 이 없습니다. 8.10 GA(2026-07-29) 이후에도 `unstable` 의 `src/version.h` 는 여전히 `8.9.241` 입니다 `✓`. 9.x 를 가진 쪽은 **Valkey** 입니다(9.0.0 = 2025-10-21). 두 진영의 버전 규칙도 정반대입니다. Redis 의 홀수 마이너는 건너뛴 번호가 아니라 **프리릴리스 전용 번호**입니다(8.10-RC1 = `8.9.240`). Valkey 는 홀수 마이너를 **정식 GA** 로 씁니다(8.1 · 9.1) `✓`.

이 한 가지 사실이 나머지 질문의 성격을 바꿉니다. 버전을 물었을 때 실제로 답해야 하는 것은 "9 에 무엇이 들어오나"가 아니라 **"지금 8.x 안에서 무엇을 고르나, 아니면 진영을 옮기나"** 입니다. 진영을 옮기는 판단은 기능 목록으로 서지 않습니다. RDB 버전 숫자가 마이그레이션을 단방향으로 막습니다(Redis 7.4+ 의 RDB 12 는 Valkey 8.x 가 거부합니다). 같은 이름의 기능이 반대 방향으로 구현돼 자동화 스크립트가 호환되지 않고 관리형에서 만나는 버전은 업스트림과 번호부터 다릅니다(ElastiCache 의 Redis OSS 는 **7.1 에서 멈췄습니다** — ElastiCache 에 Redis 8 은 없습니다) `✓`.

그래서 이 챕터는 각 문서에서 같은 형식으로 묻습니다 — **무엇이 언제 들어왔나요, 그 대가로 무엇이 막혔나요, 우리 워크로드에서 득일까요 실일까요.** 원 질문과 문서의 대응은 이렇습니다.

| 원 질문 | 어디서 답하나 | 전제가 틀린 지점 |
|---|---|---|
| Redis 는 초기 구현부터 어떻게 발전했나 | [01]({{< relref "01-origins-and-design/index.md" >}})(1.0\~6.2) → [04]({{< relref "04-redis-7-to-8.md" >}})(7.0\~8.10) | "기능이 쌓였다"가 아니라 **제약이 먼저 정해지고 그 대가를 갚아왔다** |
| memcached 와는 어떻게 다르고, memcached 자체는 어떻게 변했나 | [02]({{< relref "02-memcached/index.md" >}}) | memcached 는 **2003년에 멈추지 않았다** |
| Valkey 는 왜 찢어졌나 | [03]({{< relref "03-license-and-fork.md" >}}) | 원인은 라이선스가 아니라 **그 라이선스를 혼자 바꿀 수 있는 구조**였다 |
| 7·8·9 에 무엇이 추가되나 | [04]({{< relref "04-redis-7-to-8.md" >}})(Redis) · [05]({{< relref "05-valkey-8-to-9/index.md" >}})(Valkey) | **Redis 에 9 는 없다** |
| cluster mode 의 구조 | [06]({{< relref "06-cluster-mode/index.md" >}}) | 켜지는 것은 샤딩이 아니라 **애플리케이션 계약의 변경**이다 |
| AWS 에서 엔드포인트가 어떻게 바뀌나 | [07]({{< relref "07-aws-endpoints/index.md" >}}) | 엔드포인트는 별칭이 아니라 **토폴로지를 DNS 로 노출한 결과물**이다 |
| 그래서 무엇을 고르나 | [08]({{< relref "08-choosing.md" >}}) | — |

**근거 배지.** 이 챕터의 모든 문서가 문장 끝에 근거의 종류를 표시합니다 — `✓` 1차 출처(태그별 소스·릴리스노트·라이선스 원문)로 직접 확인 · `≈` 계산·추정 · `Ⓥ` 벤더·프로젝트 자체 주장(검증 안 됨, **측정 조건을 반드시 병기**) · `Ⓑ` 퍼블릭·3자 벤치마크 · `?` 미확인 · `Σ` 여러 사실을 묶은 종합 판단. 소스 인용은 `redis 8.10.0:src/rdb.h:21` 처럼 **레포:태그:경로:줄** 형식으로 적고 릴리스일은 GitHub `published_at` 기준입니다. `git log -1 <tag>` 의 author date 를 릴리스일로 쓰면 Redis 7.4 이후 구간에서 최대 이틀 어긋납니다 — 태그 자체는 6.2.0 이후 전부 lightweight 이고 벌어지는 것은 author date 와 committer date 입니다 `✓`.

## 참고 — 세 프로젝트 타임라인

결정적 사건만 남겼습니다. 릴리스일은 GitHub `published_at` 기준이고 시각이 걸린 사건은 UTC입니다 `✓`.

| 연도 | Redis | Valkey | memcached |
|---|---|---|---|
| **2003** | — | — | 첫 커밋 **05-27**(LiveJournal, Brad Fitzpatrick) — `malloc()` + Judy 트라이 + 전역 단일 LRU. 05-30 **slab allocator**. **06-15 GPL → BSD-3**(이후 23년 무변경). 06-20 Judy 제거·자체 해시 테이블 |
| **2006** | — | — | 1.2.0(09-09) — UDP 인터페이스·해시 테이블 동적 확장. **11-22 멀티스레드**(`--enable-threads`, Steven Grimm) — 릴리스 이후에 들어와 2007-04 에 기본 경로가 된다 |
| **2009** | **첫 커밋 03-22 `ed9b544e1`** — 자료형 3종·커맨드 45개·RDB 스냅샷·`SYNC`. AOF 는 7개월 뒤(10-30) | (공통 조상) | 1.4.0(07-09) — binary protocol 정식 라인 |
| **2010** | 2.0.0(09-03) — RESP2·hash·pub/sub·`MULTI`. **Virtual Memory 등장** | 〃 | — |
| **2012** | 2.6.0(10-22) — Lua `EVAL`, **Virtual Memory 제거** | 〃 | 1.4.11(01-16) — `slab_reassign`/`slab_automove`(calcification 첫 해법) |
| **2013** | 2.8.0(11-22) — **PSYNC** · `SCAN` 계열 · Sentinel 재구현 | 〃 | — |
| **2015** | **3.0.0(04-01) — Cluster GA** | 〃 | 1.4.23(04-19) — **segmented LRU**(HOT/WARM/COLD) |
| **2017** | 4.0.0(07-14) — **모듈 API** · PSYNC2 (cluster 버스 비호환) | 〃 | **1.5.0(07-21) — `modern` 기본값 승격** · 1.5.4(12-20) **extstore** |
| **2018** | 5.0.0(10-17) — Streams. **08-21 Commons Clause(모듈만)** | 〃 | — |
| **2019** | **02-21 RSAL(모듈만)** · 03-18 MANIFESTO v2(`7 - Threading is not a silver bullet`) | 〃 | 1.5.13(04-15) TLS · 1.5.18(09-17) restartable cache · 1.5.19(09-30) **meta 실험** |
| **2020** | 6.0.0(04-30) — RESP3(opt-in)·ACL·TLS·**threaded I/O**. 06-30 antirez 스텝다운 · **07-09 Core Team 에 Madelyn Olson(AWS) 초청** | 〃 | **1.6.0(03-08) — meta 정식 + binary protocol 공식 deprecated** |
| **2021** | 6.2.0(02-22) — 커맨드 대량 보강, `FAILOVER`. 08-11 Redis Labs → Redis | 〃 | — |
| **2022** | 7.0.0(04-27) — Functions·ACLv2·**sharded pub/sub**·listpack·multi-part AOF. 11-15 모듈 RSALv2+SSPL | 〃 | 1.6.13(01-12) — **내장 proxy**(non-production) |
| **2023** | 7.2.0(08-15) — `WAITAOF`. **BSD-3 로 출발한 마지막 마이너 라인** | 〃 | — |
| **2024** | 7.2.4(01-09) 마지막 BSD 릴리스 → **relicense `0b3439692` 03-20 22:38:24Z**(RSALv2+SSPLv1) → 7.4.0(**07-29**) hash field TTL, RDB **12** | **첫 커밋 `38632278f` 03-22 02:00:46Z**(+27h22m) · **LF 발표 03-28** · 7.2.5(**04-16**) · **8.0.0(09-15)** 비동기 I/O 스레딩·dual channel | 1.6.23(01-09) proxy API v2 · **1.6.34(12-22) slab mover 재작성** — "페이지를 옮기면 아이템을 잃는다"가 사라진다 |
| **2025** | **8.0.0(05-02)** — **AGPLv3 추가**(트라이)·Stack 모듈 번들·Vector Set beta·"Open Source" 개명 · 8.2.0(08-04) · 8.4.0(11-18) `CLUSTER MIGRATION IMPORT` | 8.1.0(03-31) — `dict` → **캐시라인 버킷 hashtable** · **9.0.0(10-21)** — cluster multi-DB·HFE·`CLUSTER MIGRATESLOTS`·**RDB 80 / `VALKEY080`** | 1.6.38·1.6.39 안정화 · 1.6.40(12-16) `mg` 조건부 CAS 페치 |
| **2026** | 8.6.0(02-10) RDB **13** · 8.8.0(05-25) RDB **14** · **8.10.0(07-29, 최신)** compact hashes, RDB **15** · **9.x 없음** | 9.1.0(05-19) DB 단위 ACL·Lua 모듈화 · **9.1.1(07-21, 최신)** · 9.2 GA 목표 **11-15** | 1.6.42~1.6.44 보안 릴리스 · **1.6.45(07-09, 최신)** — 신기능 없음, 단독 메인테이너 |

### 2026-08-06 시점의 좌표

타임라인의 마지막 행을 판단에 쓸 수 있는 형태로 접으면 이렇습니다. 근거는 각 문서가 소유하고 여기서는 어느 문서로 가야 하는지만 표시합니다.

| 축 | Redis | Valkey | memcached |
|---|---|---|---|
| 최신 GA | **8.10.0**(2026-07-29) | **9.1.1**(2026-07-21) | **1.6.45**(2026-07-09) |
| 라이선스 | **트라이** — RSALv2 / SSPLv1 / AGPLv3 중 **사용자 선택**. 6.2·7.2 유지보수 라인은 여전히 BSD-3 | **BSD-3** | **BSD-3**(2003-06-15 이후 23년 무변경) |
| OSI 승인 | AGPLv3 를 고르면 승인, 나머지 둘은 비승인 | 승인 | 승인 |
| 기여 계약·거버넌스 | **CLA** + 회사 단독 결정 | **DCO** + Linux Foundation TSC, 한 조직 **1/3 상한**, 거버넌스 변경은 2/3 super-majority | dormando **단독**(2026년 커밋 60/76) |
| 마이너 케이던스 | **짝수만 GA.** 홀수는 프리릴리스 번호 | **홀수도 GA**(8.1 · 9.1) | 1.6.x 패치 라인만 |
| 지원 정책 | LTS 없음 — Standard(다음 마이너 후 6개월) / Extended(5년). **8.x 중 Extended 는 8.2 뿐**(EOL 2030-09-01), 8.0 은 **2026-12-01** 종료, 8.10 은 **미등재** | LTS 없음 — maintenance 3년 + **각 major 의 최신 minor 에만** security 5년 | 날짜 박힌 EOL 캘린더 **없음** |
| 다음 릴리스 | **공표된 계획 없음** | 9.2 rc1 2026-09-15 / GA 2026-11-15 목표 | 없음 |
| RDB / 파일 포맷 | RDB **15**(8.6 이후 매 릴리스 상승) | RDB **80** / magic `VALKEY080` | 해당 없음(영속성 자체가 없다) |
| 검색·JSON·벡터·시계열 | 배포에 **번들**(빌드 시 clone → `.so` → `loadmodule`) | 코어에 없음 — 별도 모듈 4개, TimeSeries 계열은 **공식 릴리스 없음** | 없음 |
| ElastiCache 지원 | **없다** — Redis OSS 는 7.1 에서 멈췄다 | 9.1 / 9.0 / 8.2 / 8.1 / 8.0 / 7.2.6 (버전 번호가 업스트림과 1:1 아님) | 확인 가능한 최신 발표가 **1.6.22**(2024-01-11) |
| 어느 문서 | [04]({{< relref "04-redis-7-to-8.md" >}}) · [03]({{< relref "03-license-and-fork.md" >}}) | [05]({{< relref "05-valkey-8-to-9/index.md" >}}) · [03]({{< relref "03-license-and-fork.md" >}}) | [02]({{< relref "02-memcached/index.md" >}}) |

`✓` (전 항목 태그별 소스·릴리스노트·라이선스 원문·AWS 문서 확인. 관리형 지원 버전은 발표문 기준이고 실계정으로 교차검증하지 않았습니다 `?`)

세 열을 나란히 놓으면 이런 것이 보입니다. **memcached 는 2003년에 멈춘 소프트웨어가 아닙니다** — 최신 릴리스가 2026-07 이고 segmented LRU·extstore·meta·proxy·slab mover 재작성이 전부 Redis 등장 이후입니다. **Redis 의 라이선스 변경은 2018년부터 다섯 번 있었지만 core 가 넘어간 것은 2024-03-20 하루뿐입니다** — 2018-08 · 2019-02 · 2022-11 은 전부 모듈에만 적용됐고 2025-05 는 core 에 AGPLv3 를 **더한** 것입니다. **포크 이후 두 열의 항목이 서로를 참조하지 않는 방향으로 벌어집니다** — 8.1 의 hashtable 교체와 8.0 의 Stack 번들은 되돌릴 수 있는 종류의 차이가 아닙니다 `Σ`.

## 문서 지도

- **[01 · 2009 첫 커밋부터 6.2 까지]({{< relref "01-origins-and-design/index.md" >}})** · 설계 연쇄의 출발점 — 값이 자료구조라는 첫 결정이 왜 락을 없애고 단일 스레드를 불렀나, 그 계약을 6.0 threaded I/O 가 어디까지만 건드렸나(워커는 `writeToClient()`/`readQueryFromClient()` 둘 중 하나뿐이다). 첫 커밋 실측치, MANIFESTO 두 판본, 그리고 **되돌린 유일한 설계인 Virtual Memory**.
- **[02 · memcached — 같은 문제를 다르게 푼 6년 선배]({{< relref "02-memcached/index.md" >}})** · 대비군이자 독립된 선택지 — slab allocator 의 대가(calcification)를 21년에 걸쳐 갚은 연대기, 4단 segmented LRU, 워커 N개가 각자 이벤트 루프를 돌려 한 프로세스로 N 코어를 먹는 구조, extstore·restartable cache 가 **영속성이 아닌** 이유, meta 프로토콜의 stampede 방어. Redis 와의 구조 대비표가 결론입니다.
- **[03 · 왜 찢어졌나 — Commons Clause 부터 AGPL 복귀까지]({{< relref "03-license-and-fork.md" >}})** · 거버넌스 축의 본문 — 2018·2019·2022 의 변경은 전부 모듈이었고 core 는 커밋 하나로 넘어갔습니다. RSALv2(금지형)와 SSPLv1(조건형 copyleft)의 조항 원문, 포크 기점 두 개, Valkey 의 1/3 조직 상한·2/3 super-majority, 그리고 **2025-05 에 AGPLv3 가 추가됐는데도 봉합되지 않은 이유**. 마지막 절이 "우리에게 실제로 금지되는 것"의 판정표입니다.
- **[04 · Redis 7.0 → 8.10 — 그리고 9 는 왜 없나]({{< relref "04-redis-7-to-8.md" >}})** · 한쪽 진영의 버전 서사 — 9 의 부재를 전수 확인으로 확정한 과정, 7.0 의 네 겹 파괴적 변경, 8.0 의 "core 통합"이 실제로는 **빌드 시 clone → `.so` → `loadmodule` 번들**이라는 사실, 8.2~8.10 의 릴리스별 신기능·breaking·**운영자가 할 일**, 짝수 케이던스와 Standard/Extended 지원선(8.x 중 Extended 는 8.2 하나뿐).
- **[05 · Valkey 8.0 → 9.1 — 엔진이 갈라진 지점]({{< relref "05-valkey-8-to-9/index.md" >}})** · 반대쪽 진영의 버전 서사 — 8.0 의 비동기 I/O 스레딩이 6.0 방식의 튜닝이 아니라 **교체**인 이유, dual channel replication 이 무엇을 고치고 그 아픔을 어디로 옮겼나, 8.1 이 `dict` 를 버리고 얻은 키당 20~30바이트, 9.0 의 RDB 80 이 만든 영구 차단선, 그리고 Redis 8.x 대비 기능 매트릭스와 마이그레이션 사실관계.
- **[06 · cluster mode — 16384 슬롯이 강제하는 것]({{< relref "06-cluster-mode/index.md" >}})** · 구조 문서 — 프록시를 두지 않기로 한 결정이 왜 smart client 를 필수로 만드나, `MOVED`/`ASK`/`TRYAGAIN` 의 조건이 각각 무엇인가, 16384 가 **gossip 헤더 2048바이트 예산**인 이유, cluster 를 쓰면 잃는 것 표, 11년간 가장 아팠던 슬롯 마이그레이션을 양 진영이 **반대 방향으로** 고친 결과, `cluster_state:ok` 가 거짓 안심을 주는 세 가지 방식.
- **[07 · AWS 에서 엔드포인트는 어떻게 바뀌나]({{< relref "07-aws-endpoints/index.md" >}})** · 관리형 운영 문서 — CMD/CME/Serverless/MemoryDB 의 엔드포인트 종류와 DNS 로 판별하는 규칙, 모드 전환이 **단방향**이고 `compatible` 이 중간에 끼어 있는 절차, failover 시간을 만드는 것은 엔진이 아니라 **클라이언트 DNS 캐시**라는 사실, TLS 켜기가 설정 토글로 보이지만 실제로는 엔드포인트 마이그레이션인 이유, 관리형이 막는 커맨드와 k8s self-host 대조군.
- **[08 · 무엇을 고를 것인가]({{< relref "08-choosing.md" >}})** · 판단 문서 — Redis/Valkey/memcached 3자 판단표, managed vs self-host, 8.x 안에서 하는 버전 선택, 마이그레이션 경로 판정. 근거는 위 일곱 문서가 소유하고 여기서는 결론만 모읍니다.
- **[99 · 출처]({{< relref "99-sources.md" >}})** · 위 여덟 문서가 인용한 URL 을 주제별로 모은 목록. 로컬 클론에서 `git show` 로 실측한 태그·커밋도 함께 적었습니다.

## 공통 핵심

- **9 를 기다리는 것은 근거 없는 유예입니다.** Redis 에 `9*` 태그·숫자 브랜치·마일스톤이 없고 `unstable` 은 8.10 GA 이후에도 `8.9.241` 입니다. 9.x 를 가진 쪽은 Valkey 이고 두 진영의 홀짝 케이던스는 정반대입니다 — 같은 숫자가 전혀 다른 의미를 갖습니다. → [04]({{< relref "04-redis-7-to-8.md" >}}), [05]({{< relref "05-valkey-8-to-9/index.md" >}})
- **RDB 버전 숫자 하나가 롤백과 마이그레이션 계획 전체를 결정합니다.** Redis 는 7.4~8.4 가 모두 12 였다가 8.6=13 · 8.8=14 · 8.10=15 로 매 릴리스 올라가 롤백 창이 닫혔습니다. Redis 7.4+ (RDB 12)는 Valkey 8.x 가 foreign 으로 예약해 거부하고 Valkey 9.x(RDB 80 / `VALKEY080`)는 8.x 로 되돌릴 수 없습니다. "가볍게 올려보고 안 되면 내리자"가 성립하는 구간이 어디까지인지를 먼저 확인합니다. → [04]({{< relref "04-redis-7-to-8.md" >}}), [05]({{< relref "05-valkey-8-to-9/index.md" >}})
- **켜지 않은 기능은 빨라지지 않습니다.** 양 진영 모두 `io-threads` 기본값이 1(비활성)이고 Redis 는 8.10.0 까지 `IMMUTABLE_CONFIG` 라 재시작 없이는 켜지지도 않습니다. Valkey 의 dual channel replication 도 기본 `no` 이고 prefetch 배치는 `io-threads` 가 꺼져 있으면 무의미합니다. 벤더의 "2배"·"1.19M rps" 는 전부 8 스레드 조건의 수치이므로 **업그레이드만으로는 얻지 못합니다** — Redis 8.0 의 "2x ops/sec" 은 `io-threads=8` + multi-core Intel 에서 최대 +112% 이고 Valkey 8.0 의 1.19M rps 는 c7g.16xlarge(64 vCPU) + `io-threads 8` + 3M keys × 512B + 650 clients + sequential SET 입니다(파이프라인 깊이는 어느 1차 출처에도 없습니다) `Ⓥ`. → [01]({{< relref "01-origins-and-design/index.md" >}}), [05]({{< relref "05-valkey-8-to-9/index.md" >}})
- **라이선스는 스냅샷이고 거버넌스는 그 스냅샷이 얼마나 오래 유효할지의 확률입니다.** 2025-05 에 Redis 가 AGPLv3 를 추가해 OSI 승인 라이선스로 돌아왔는데도 Valkey 는 돌아가지 않았습니다 — AGPL 은 **추가**였을 뿐 RSALv2/SSPLv1 철회가 아니고 CLA 도 그대로입니다. 판단 근거를 현재 라이선스 문자열이 아니라 "그 문자열을 누가 바꿀 수 있나"에 두어야 하는 이유입니다. → [03]({{< relref "03-license-and-fork.md" >}})
- **cluster mode 를 켠다는 것은 샤딩을 켜는 것이 아니라 애플리케이션 계약을 바꾸는 것입니다.** cross-slot 다중 키 연산·트랜잭션·Lua 키 선언·pub/sub 전파 비용·`KEYS`/`SCAN`/`DBSIZE` 의 의미·커넥션 수가 모두 달라지는데 **standalone 테스트는 그대로 통과합니다.** AWS 에서는 그 구조가 엔드포인트로 노출되므로 모드 전환은 문자열·클라이언트 라이브러리·다중 키 연산 3종 세트를 같이 바꾸는 작업이고 **되돌릴 수 없습니다.** → [06]({{< relref "06-cluster-mode/index.md" >}}), [07]({{< relref "07-aws-endpoints/index.md" >}})
- **"같은 기능"이 이름과 방향이 달라 자동화가 깨집니다.** atomic slot migration 은 특정 진영 전용이 아니라 양쪽에 다 있고 방향만 반대입니다 — Valkey 9.0.0 `CLUSTER MIGRATESLOTS`(source 에서 push) vs Redis 8.4.0 `CLUSTER MIGRATION IMPORT`(destination 에서 pull). fast full sync 도 capa 문자열이 달라 섞으면 경고 없이 레거시 경로로 폴백하고 `CLUSTER SLOTS` 의 deprecation 상태는 진영별로 정반대입니다. **리샤딩 런북과 모니터링 쿼리는 엔진을 갈아탈 때 재작성 대상입니다.** → [06]({{< relref "06-cluster-mode/index.md" >}}), [05]({{< relref "05-valkey-8-to-9/index.md" >}})
- **memcached 는 열등한 과거가 아니라 다른 축을 끝까지 민 결과입니다.** 값을 해석하지 않기로 한 대가로 스레드를 열어 한 프로세스가 N 코어를 먹습니다. 느린 커맨드가 존재할 수 없어 지연이 예측 가능하고 값만 NVMe 로 내려 용량을 삽니다. 대신 자료구조·다중 키 원자성·복제·영속성·ACL 이 전부 없습니다. **캐시 이외의 요구가 하나도 없을 때 이기고 그 조건이 하나라도 깨지면 집니다.** → [02]({{< relref "02-memcached/index.md" >}}), [08]({{< relref "08-choosing.md" >}})

## 자매 챕터

- [ClickHouse 운영 → 로컬 NVMe 데이터스토어 벤치마킹]({{< relref "../clickhouse/07-local-nvme-datastore-patterns.md" >}}) — 9개 데이터스토어의 스토리지 전략을 횡단 비교하면서 **Redis/Valkey 는 "RAM 이 1차라 애초에 벤치 대상이 아니다"로 제외**합니다. 이 챕터가 디스크 계층 논의로 가지 않는 이유의 반대편 근거이고 memcached 의 extstore 가 그 예외에 가장 가까운 시도입니다([02]({{< relref "02-memcached/index.md" >}})).
- [ClickHouse 운영 → Managed vs Self-hosted]({{< relref "../clickhouse/01-managed-vs-selfhosted.md" >}}) — "인력 보유 여부가 데이터 크기보다 결정적"이라는 판단축은 이 챕터의 [07]({{< relref "07-aws-endpoints/index.md" >}})·[08]({{< relref "08-choosing.md" >}})과 같습니다. 관리형이 `CONFIG SET`·모듈·슬롯 통제를 막는다는 사실이 self-host 를 고민하게 만드는 실질적 이유라는 점까지 형태가 겹칩니다.
- [Istio → EnvoyFilter 확장]({{< relref "../istio/08-envoyfilter-extension/index.md" >}}) — 클러스터 전역 rate limit 을 Envoy 의 외부 Rate Limit Service 로 구현하면 **Redis 가 데이터 평면의 의존 컴포넌트로 들어옵니다.** 그쪽이 "Redis 를 하나 더 운영하는 비용과 요청당 왕복 지연"을 트레이드오프로 따진다면, 이쪽은 그 Redis 를 무엇으로 어떻게 굴릴지를 다룹니다.
