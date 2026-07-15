---
title: "프로덕션 운영 사례"
weight: 6
---

# 프로덕션 운영 사례 — 검증된 것과 귀속(歸屬) 오류

{{< callout type="info" >}}
**한눈에** — ClickHouse를 PB~경 스케일 관측성 백엔드로 운영하는 사례는 넘치지만, **'K8s + operator + 로컬 NVMe'의 순수 1차 실증은 얇다**.
- **K8s + operator**는 eBay·Anthropic·Trip.com·LogHouse가 검증한 안전한 패턴이다.
- **로컬 NVMe primary**는 최고 성능을 사는 대신 노드 소실 시 재복제·drain 운영을 대가로 요구한다 — 대규모 K8s 사례는 대부분 **오브젝트 스토리지 백킹**으로 수렴한다.
- **소규모 팀**에는 로컬 NVMe(hot 캐시) + S3(primary) **하이브리드**가 재수화·drain 리스크를 줄여 더 안전하다.
- 대규모 사례의 수치 상당수가 **ClickHouse Inc. 벤더 출처**이므로 편향을 감안해 읽는다.
{{< /callout >}}

ClickHouse를 관측성 백엔드로 **PB~경(quadrillion) 스케일에서 운영하는 사례는 차고 넘친다** — 이 방향성 자체는 의심할 필요가 없다. 다만 사용자가 검토 중인 특정 조합 **'K8s + operator + 로컬 NVMe'**의 순수 실증은 생각보다 얇다. 대규모 named 사례의 스토리지는 대부분 (a) 베어메탈 로컬 디스크(Cloudflare·Didi)이거나 (b) 오브젝트 스토리지 백킹(Anthropic·Character.AI·ClickHouse LogHouse)이고, "K8s 위 로컬 NVMe만으로 대규모"를 공개 1차 출처로 확인해주는 곳은 드물다. 결론부터: **K8s+operator는 검증된 프로덕션 패턴이지만, 로컬 NVMe는 성능 상한을 사는 대신 node lifecycle 운영을 대가로 요구하며, 소규모 팀에는 로컬 NVMe(hot 캐시) + S3(primary) 하이브리드가 더 안전하다.**

{{< callout type="warning" >}}
대규모 사례의 상당수가 **ClickHouse Inc. 자사 블로그(케이스스터디)** 출처다. 자기 제품을 파는 맥락이므로 수치는 편향을 감안해 읽는다. 아래 매트릭스의 `출처` 열에 그 구분을 표기했다.
{{< /callout >}}

## 대규모 운영 사례 매트릭스

출처 등급 범례: `자사`=해당 회사 자체 엔지니어링 블로그(상대적 독립) · `CH`=ClickHouse 자사 블로그/케이스스터디(자기 홍보 맥락, `[벤더]`) · 규모 수치의 등급은 셀 내 표기.

| 회사 | 용도 | 규모(핵심 수치) | 배포 형태 | 스토리지 | 출처 |
|---|---|---|---|---|---|
| **Cloudflare** | HTTP/DNS/방화벽 분석·빌링 | 20+ 클러스터, >100 노드, 1000+ replica, ~90M rows/s, 100+ PB, 96조 events를 <2s(1일 창 1.61경도 <2s) `[확인됨]` | 베어메탈(자체 DC 300+) | 로컬 디스크 중심 | 자사+CH |
| **Netflix** | 로그(관측성) | 5 PB/day, 평균 10.6M events/s(peak 12.5M), 500~1000 QPS `[벤더]` | 자체 파이프라인 | 계층형 | CH |
| **MS Clarity** | 웹 세션/행동 분석 | 수백 대 머신, 수백 PB, 수백조 events, 수십억 pv/day `[확인됨]` | "layer" 서브클러스터 | DC 간 복제 | 자사 |
| **Character.AI** | 관측성(로그) | 450 PB raw/월 → 샘플 후 50B/월, 10x 데이터·비용 -50% `[벤더]` | ClickHouse Cloud(multi-cloud K8s) | S3(Cloud) | CH |
| **Tesla(Comet)** | 메트릭(관측성) | 1B rows/s를 11일 지속 = 1 quadrillion rows 무장애 `[벤더]` | K8s 추정, OTel→Kafka→ETL | CH 네이티브 | CH |
| **Didi** | 로그 | 400+ 물리 노드(Log 300+/Trace 40+), peak write 40 GB/s+, ~15M queries/day, PB/day, machine cost -30% vs ES `[벤더(자가보고)]`(2024-04 스냅샷; machine cost는 TCO보다 좁은 지표 — 엔지니어링·마이그레이션 비용 제외) | 물리 노드(베어메탈) | 계층형(hot/cold) | CH |
| **Trip.com** | 로그 | 50 PB(4PB ES에서 시작), 저장 -50%+, query 4~30x `[벤더]` | **K8s StatefulSet** | 로컬+ (SMT/S3 테스트) | CH |
| **Uber** | 로그 | millions logs/s, 수천 서비스, 수 PB, ingest <1min `[확인됨]`(2021-02 스냅샷; 단일 노드 300K logs/s 실측, 후속으로 비정형 Spark 로그는 CLP로 보완) | 자체 인프라 | 계층형 | 자사 |
| **eBay** | OLAP/모니터링 | Federated 다중 리전, 인프라 풋프린트 -90%+ `[확인됨]` | **K8s + operator** | **미확인**(출처에 언급 없음) | 자사 |
| **Anthropic** | 관측성 | 3인 팀 운영(데이터량·비용 비공개) `[확인됨]` | **air-gapped Cloud arch on K8s + operator** | **오브젝트 스토리지** | CH |
| **Sentry(Snuba)** | 에러/이벤트 검색 | Kafka 인서트, Tagstore TB→GB, Alert이 전체 QPS의 ~40% `[확인됨]` | 자체 인프라 | ClickHouse | 자사 |
| **PostHog** | 제품 분석 | Sharded CH, Kafka engine table + MV 인제스천 `[확인됨]` | 자체/Cloud | Sharded | 자사 |
| **GitLab** | 분석 + 관측성 | 100M rows 쿼리 30~40s→<1s, 일 57M+ traces, 3000+ 서비스 `[확인됨]` | Cloud/자체 | — | 자사+CH |
| **LogHouse**(CH 도그푸딩) | 내부 관측성 | 100+ PB 비압축, ~500조 rows, SysEx 37M + OTel 2M logs/s `[벤더]` | **K8s + operator** | 오브젝트 스토리지/S3 | CH |

{{% details title="그 밖의 확인 사례 — Zomato · Shopee · OpenAI · Ahrefs" closed="true" %}}
**Zomato**(EC2 10×m6g.16xlarge, gp3 hot→cold TTL, ES 대비 연 $1M+ 절감 `[벤더]`), **Shopee**(분산 트레이싱 ~3M rows/s, 30B+ trace rows `[확인됨(요약)]`). **OpenAI**는 일 PB급 로그를 자체 관리 ClickHouse 클러스터(90 샤드×2 리플리카, Fluent Bit→로드밸런서 인제스트, 최근 데이터는 디스크·구 데이터는 blob 스토리지로 티어링)로 인제스트하며 월 20%+ 성장한다 `[벤더(자가보고)]`(출처: clickhouse.com 블로그 + OpenAI 엔지니어 컨퍼런스 발표). **단 이 글은 Datadog 등 상용 벤더 이탈이나 K8s/EKS·인스턴스·로컬 NVMe를 전혀 언급하지 않는다 — OpenAI는 순수 하이퍼스케일 증거일 뿐, 아래 §'K8s + 로컬 NVMe' 실증 목록에는 넣지 않는다(C8).** **Ahrefs**(초대형 베어메탈)는 이번 조사에서도 노드 수·용량을 명시한 1차 출처를 확보하지 못해 **`[미확인]`**으로 둔다.
{{% /details %}}

두 가지가 곧바로 읽힌다. 첫째, **순수 자체운영의 최대 규모는 베어메탈**(Cloudflare 100+PB, Didi 400+노드)이고 이들은 K8s가 아니다. 둘째, **K8s로 대규모를 돌리는 곳(eBay·Trip.com·Anthropic·LogHouse)은 operator를 쓰며 스토리지는 오브젝트 스토리지 백킹으로 수렴**한다. "K8s + 로컬 NVMe만으로 대규모"는 매트릭스에서 직접 확인되는 조합이 아니다. (2026-07-14 재확인: 별도 딥리서치 라운드에서도 NVMe-on-K8s를 명시한 프로덕션 사례는 확보되지 않아 이 결론이 그대로 재확인됐다 — OpenAI를 포함해도 마찬가지다.)

매트릭스의 "가능하다"를 액면 그대로 읽으면 안 된다 — **각 규모를 내기까지 상당한 엔지니어링이 붙었다**. 즉 대규모 레퍼런스는 "CH면 공짜로 된다"가 아니라 "이만큼 튜닝하면 이 규모가 난다"로 읽어야 한다.

{{% details title="근거 — Netflix·Cloudflare가 규모를 낸 튜닝 상세" closed="true" %}}
Netflix는 5PB/day를 내려고 세 곳을 갈아엎었다 `[벤더]`: 유사 로그 수백만 개를 하나로 collapse하는 **fingerprinting**, JDBC 배치 인서트를 **커스텀 native 프로토콜 인코딩**으로 교체, 태그 쿼리에 **LowCardinality** 적용(창시자 Alexey Milovidov 제안). Cloudflare는 반대로 오케스트레이션을 얇게 가져가 "북미 DC 연결을 끊어 용량 1/3을 제거해도 유럽 클러스터가 부하를 자동 인수"하는 회복력을 보였고 `[확인됨]`, 그럼에도 2026년 빌링 파이프라인이 **쿼리 플래닝 단계의 락 경합**으로 느려진 장애를 겪었다(안티패턴 §9).
{{% /details %}}

## 'K8s + operator + 로컬 NVMe' — 실증은 어디까지인가

사용자 관심 조합을 세 축으로 쪼개 각각의 근거를 따진다. **여기서 흔한 귀속 오류를 정정한다** — 여러 2차 자료가 "eBay는 hot 데이터에 로컬 SSD를 쓴다"고 서술하지만, **eBay 공식 블로그에는 스토리지 하드웨어·티어링 언급이 전혀 없다**(원문·미러·검색 3중 확인). 이는 일반적인 K8s+ClickHouse 권장 패턴을 eBay 사례에 잘못 붙인 것이므로, eBay를 로컬 NVMe의 실증 레퍼런스로 제시하는 것은 근거가 없다 `[미확인]`.

| 사례 | K8s | operator | 로컬 NVMe(hot) | 근거 등급 |
|---|:---:|:---:|:---:|---|
| **eBay** | O(federated 다중 리전, FCHI/FCHC) | O(자체 확장 + OSS operator) | **미확인**(출처에 없음) | K8s+operator=`[확인됨]`, 스토리지=`[미확인]` |
| **Anthropic** | O | O(ClickHouse Operator) | 오브젝트 스토리지 백킹(로컬은 캐시 추정) | `[확인됨]`(로컬 캐시는 `[추정]`) |
| **Trip.com** | O(StatefulSet) | 자체 관리 | 로컬 → SharedMergeTree/S3 테스트로 이행 | `[확인됨]` |
| **ClickHouse LogHouse** | O | O(ClickHouse Operator) | 오브젝트 스토리지 | `[벤더]` |
| **mrkrbrts**(참조 아키텍처) | O(EKS) | O(Altinity) | r7gd NVMe = **S3 write-through 캐시** | `[확인됨]`(개인 참조 아키텍처) |

즉 **K8s + operator 자체는 eBay·Anthropic·Trip.com·LogHouse·ClickHouse 자신이 검증**한 패턴이다. 그러나 "로컬 NVMe를 hot으로" 쓰는 실증은 대부분 **오브젝트 스토리지 백킹 위의 캐시**(Anthropic·Character.AI·mrkrbrts) 형태이지, 로컬 NVMe를 primary durable로 두는 순수형이 아니다. 순수 로컬 NVMe primary는 성능이 최선이나 아래의 대가를 진다.

### 대가 — node lifecycle 운영

로컬 NVMe는 인스턴스에 물리 부착돼 network block(EBS)의 예측 불가한 tail latency를 피하지만 **휘발성**이다 — 노드가 죽으면 그 디스크 데이터도 사라진다. 그래서 다음이 세트로 강제된다 `[확인됨]`.

- **재복제(re-replication)**: 소실 노드의 데이터는 다른 노드의 replica에서 전량 재전송받아 복구한다. 재복제 동안 클러스터 용량·부하에 영향이 가고, **노드당 데이터가 크면(예: 40TB) 재수화가 길어져 그동안 redundancy가 준다** → 노드당 데이터량과 replica 수, shard 수의 균형 설계가 필요하다.
- **drain / upgrade 절차**: 로컬 NVMe + node affinity 조합에서는 노드 drain이 곧 데이터 재복제를 유발할 수 있어 rolling 업그레이드 절차 설계가 까다롭다. Altinity operator issue #1859(로컬 NVMe 전환 질의)은 "노드 장애 시 CH 복제가 교체 노드로 자동 복구되는가"에 스레드가 명확한 답을 남기지 않은 채 종료됐다 — **로컬 스토리지 노드 교체 절차가 잘 문서화돼 있지 않다는 방증**이다.
- **`reclaimPolicy: Retain`**: CH 클러스터/Helm 삭제 시 PVC가 함께 삭제돼 데이터가 날아가는 사고를 막는 필수 설정. 노드 장애 복구 베스트 프랙티스는 "0 replica로 스케일다운 → 노드 재부팅 → 스케일업"이며 사전에 모든 PVC가 retain인지 확인해야 한다.

{{< callout type="warning" >}}
pulse.support의 요약이 본질을 찌른다 — "ClickHouse는 IO-bound·merge-heavy이고 복제 조정을 위해 **안정적 노드 정체성**에 의존한다. Kubernetes는 **disposable pod + 네트워크 스토리지**를 전제로 설계됐다. 잘 동작하게 만들 수 있지만, **기본값은 당신과 싸운다.**"

스토리지 내구성 3종 세트(멀티 AZ replica·clickhouse-backup·Keeper)와 Karpenter 주의는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}}), operator 채택·롤링 절차는 [Altinity operator]({{< relref "03-operator.md" >}})에서 다룬다.
{{< /callout >}}

## 관측성 아키텍처 패턴

### 인제스천 파이프라인 — Kafka / Vector / OTel

대규모 사례가 수렴하는 인제스천 패턴은 다섯 갈래다.

| 패턴 | 대표 사례 | 특징 | 트레이드오프 |
|---|---|---|---|
| **Kafka 버퍼 + 커스텀 워커** | Zomato(Go), Trip.com(GoHangout), PostHog | 배치·백프레셔 제어 용이, native 포맷 인서트 | 워커 유지보수 부담 |
| **Kafka table engine + MV** | PostHog | CH 내장 컨슈머, 인프라 단순 | 튜닝 여지 제한, 장애 격리 약함 |
| **OTel Collector** | Tesla, Character.AI(DaemonSet), Netflix(일부) | 표준·벤더중립, 에코시스템 | **대규모에서 CPU 병목**(아래) |
| **Vector** | Anthropic | 경량·고성능 파이프라인 | — |
| **CH → CH 직접(SysEx)** | ClickHouse LogHouse | native 포맷 byte-copy, 재직렬화 0 | ClickHouse 소스 한정 |

공통 원칙은 어디서나 같다 `[확인됨]` — (1) **대형 배치 인서트**(수천~수만 rows) 또는 async insert, (2) **native 포맷**(HTTP 대비 ~1.8x, Zomato `[벤더]`), (3) 초당 인서트 빈도 제한(Sentry: ~1/s), (4) Kafka로 스파이크 흡수. 이를 어기면 곧바로 아래 안티패턴의 "too many parts"로 직행한다.

### wide events가 대세

관측성 스키마의 업계 방향은 **wide events**로 굳어지고 있다 `[확인됨]`(ClickHouse LogHouse의 100PB 설계, Charity Majors/Honeycomb 담론과 맞닿음). row마다 **완전한 컨텍스트**를 사전 집계 없이 저장하고(histogram 대신 개별 `insertDuration` 값), pod명·버전·네트워크 정보 같은 **고카디널리티 차원을 그대로 보존해 쿼리 시점에 집계**한다. 전통 메트릭 스토어의 per-series cardinality explosion을 회피하는 것이 핵심 동기다. ClickStack/HyperDX가 이 패턴을 UI로 지원한다([HyperDX 심층]({{< relref "../rum/01-hyperdx-deep-dive.md" >}})). 대비되는 시그널별 테이블(logs/metrics/traces 분리, OTel 스키마 기본)도 여전히 유효하며, Tesla처럼 **메트릭만 PromQL 전용 파이프라인**으로 특화하는 하이브리드가 실전적이다.

실전 스키마 규칙(여러 사례 공통 `[확인됨]`): 필터 빈도 높은 2~3개 컬럼을 **카디널리티 오름차순 ORDER BY**(Trip.com `(log_level, timestamp, host_ip, host_name)`), **LowCardinality**(Netflix 태그 최적화의 핵심), 동적 태그는 Map 또는 **JSON 타입**(25.3 GA), 압축은 **ZSTD**(Trip.com 40%+·Character.AI 15~50x `[벤더]`), skip index(tokenbf_v1/Bloom)는 **남용 금지**.

### OTel Collector의 CPU 병목 (대규모 교훈)

가장 중요한 아키텍처 교훈. ClickHouse가 자체 관측성(LogHouse)을 키우면서 **OTel Collector가 초대형 스케일에서 CPU 병목**이 됨을 공개했다 — OTel은 반복 변환(JSON 직렬화 → 파싱/마샬링 → OTel 포맷 변환 → 재인제스트)이 비싸다. 구체 수치 `[벤더]`(ClickHouse 자체 도그푸딩):

- **20M rows/s를 OTel로 안정 처리하려면 ~8,000 CPU 코어 필요**로 추산.
- 그래서 CH→CH native byte-copy인 커스텀 **SysEx**로 전환: **800 OTel 코어 → 70 SysEx 코어**로, 20배 볼륨을 이전 CPU의 **<10%**로 처리. OTel이 부하 시 로그를 drop하던 문제도 해소.
- 단 OTel을 완전 폐기하진 않았다 — crash-loop 등 system table 접근 불가 시나리오·stderr 캡처에는 여전히 유효 → **하이브리드 유지**.

{{< callout type="warning" >}}
**시사점** — 검토 중인 **"dd 프로토콜 → OTel/HyperDX 프록시" 경로도 결국 변환 단계의 CPU 비용**을 신중히 벤치마크해야 한다. 초대형에서는 변환 계층이 클러스터보다 비쌀 수 있다. 프록시 매핑의 성숙도·CPU 세금은 [dd 프록시 매핑]({{< relref "../rum/03-dd-proxy-mapping.md" >}})에서 별도로 다룬다.
{{< /callout >}}

## Datadog 대비 비용 주장 — 출처 편향 경고

{{< callout type="warning" >}}
"ClickHouse가 Datadog보다 10~50배 싸다"는 문구가 널리 인용되지만, **수치의 대부분이 ClickHouse Inc. 자료** 출처라는 점을 반드시 감안해야 한다 `[벤더]`.
{{< /callout >}}

| 항목 | 수치 | 비고 |
|---|---|---|
| Datadog vs 자체관리 ClickStack 비용비 | 1~5 TB/day 인제스트에서 **Datadog이 10~50배 비쌈** | ClickHouse 자료 `[벤더]` |
| Character.AI (관측성 마이그레이션) | **10x 데이터, 비용 -50%** | ClickHouse Cloud+ClickStack `[벤더]` |
| Zomato (ES→CH) | **연 $1M+ 절감** | ES 대비 `[벤더]` |
| Didi (ES→CH) | **머신 비용 -30%** | `[벤더]` |
| Trip.com (ES→CH) | 저장 **-50%+**, 쿼리 **4~30x** | `[벤더]` |

Datadog 고비용의 구조적 원인(고카디널리티 과금 전가, custom metrics·인제스트+쿼리 이중 과금, 오토스케일에 대한 per-host 페널티) 자체는 실재한다 `[확인됨]`. 그러나 **"10~50배"는 자체관리 인건비/운영비를 제외한 인프라 비용 기준일 가능성이 높다.** TCO 재평가 시 반드시 **운영 인력·on-call·업그레이드 비용을 가산**해야 하며, 라이선스 절감분을 운영/개발 인건비 증가가 상쇄하는 영역(Security·Synthetics 등 제품형 기능)도 있다. 인프라 vs people TCO의 실제 크로스오버는 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}})에서 숫자로 다룬다. 이관은 rip-and-replace가 아니라 **dual-write → 고카디널리티 쿼리 속도 비교 → 단계적 전환**으로 리스크를 완화하는 것이 권장 방식이다 `[확인됨]`.

## 공통 교훈 & 안티패턴

### 반복 등장하는 성공 패턴

1. **배치·async 인서트가 절대 원칙** — 모든 대규모 사례가 Kafka 버퍼 + 대형 native 배치.
2. **수직 확장 우선, 샤딩은 나중** — CH는 대형 단일 노드(수백 코어/TB RAM)에서 강하다. 조기 수평 확장은 비용·복잡도만 는다(대개 replica 2개면 충분).
3. **hot(로컬 NVMe) + cold(S3) tiering** — 성능·비용 균형의 표준. SharedMergeTree(Cloud 전용)로 storage-compute 분리가 신흥 표준이나 self-host에선 불가.
4. **LowCardinality + 필터순 ORDER BY + ZSTD** — 압축·쿼리 성능의 3종 세트.
5. **쿼리 게이트웨이/거버넌스** — Trip.com(SQL 파싱·QPS 제한·대형 스캔 차단), Uber(QueryBridge). 대규모에선 쿼리 남용 통제가 필수.
6. **복제로 내구성, 오케스트레이션은 최소** — Cloudflare는 "용량 1/3을 빼도 그리 많은 게 잘못되지 않는다"고 표현.
7. **소규모 팀도 운영 가능** — Anthropic 3명, Character.AI 첫 SRE 1명. 단 **operator + 오브젝트 스토리지 백킹**이 이를 가능케 한 전제였다.

### 안티패턴 (피해야 할 것)

`[확인됨]` (ClickHouse "13 mistakes", BigDataBoutique):

1. **Too Many Parts**(가장 흔한 프로덕션 이슈) — 작은 인서트/고카디널리티 파티션 키가 원인. 파티션당 300 parts 초과면 조치. → 배치/async insert, 파티션 키 카디널리티 <1,000.
2. **고카디널리티 파티션 키** — 일 단위가 보통 적정, 그 이상 세분화 금지.
3. **소량(row 단위) 인서트** — 각 인서트가 파트 + Keeper 레코드 생성(Sentry 교훈: ~1/s 권장).
4. **Mutation 남용** — classic mutation은 파트 전체 재작성 → lightweight delete/patch part 사용.
5. **Keeper 과소 리소스 / 단일 앙상블 의존** — 조정 손실 시 테이블이 read-only로 전락. 전용 Keeper 다중 AZ로(Clarity의 단일 3노드 ZK 전면 의존은 리스크 포인트).
6. **materialized view 남발(>50개)·skip index 남용** — 인서트 속도만 갉아먹고 성능 개선은 미미.
7. **experimental/beta 기능을 코어에 사용** — GA 전 핵심 의존 금지.
8. **(K8s 특화) 로컬 NVMe + 부주의한 node drain/upgrade** — drain이 데이터 소실→재복제를 유발. `reclaimPolicy: Retain` + PVC affinity + rolling 절차 설계 필수.
9. **(대규모) 쿼리 플래닝/컴파일 병목** — 데이터 경로만이 아니라 플래닝 락 경합도 병목이 된다(Cloudflare 2026 빌링 파이프라인 사례 `[확인됨]`).

{{< callout type="important" >}}
**소규모 팀을 위한 핵심 교훈** — 순수 로컬 NVMe primary는 최고 성능을 주지만 노드 소실 시 재복제 부담이 크다. Anthropic·Character.AI가 소수 인력으로 대규모를 굴릴 수 있었던 것은 **오브젝트 스토리지 백킹**(또는 로컬 NVMe를 write-through hot 캐시로) 하이브리드를 택했기 때문이다. "성능 극대화"가 하드 요구가 아니라면, 소규모 팀에는 **로컬 NVMe hot + S3 primary 하이브리드**가 재수화·drain 리스크를 크게 줄여준다.
{{< /callout >}}

## 우리 케이스에서는

**전제부터 다르다.** 로깅 챕터는 ClickHouse를 **로그 저장소**로만 저울질했고, 그 관점의 결론은 로그는 [VictoriaLogs]({{< relref "../logging/03-victorialogs.md" >}})로 가고 CH 통합(D4)은 "명분 + 오너가 섰을 때 earn it last"였다([로깅 권장안]({{< relref "../logging/08-recommendation.md" >}})). 이 페이지의 사례들은 그 판단을 **뒤집지 않는다** — 반대로 대규모 named 사례 대부분이 **전담 팀 또는 벤더 협업**을 전제로 한다는 사실은 "오너 없는 소규모 팀은 CH 자체운영을 1차로 밀지 말라"는 로깅 챕터의 경고를 오히려 뒷받침한다.

이 챕터의 사례 근거는 로깅 챕터가 유보한 게이트(**RUM 대체 + 범용 분석 + 인력 보유**)를 통과했다고 가정한 뒤에만 발동한다. 그 전제 위에서 프로덕션 사례가 주는 실무 함의는 다음과 같다.

- **"K8s + operator"는 안심하고 채택할 수 있다** — eBay·Anthropic·Trip.com·ClickHouse 자신이 검증한 패턴이다. operator는 Altinity로 통일한다([Altinity operator]({{< relref "03-operator.md" >}})).
- **"로컬 NVMe만으로 대규모"의 순수 실증은 없다.** eBay는 스토리지 형태를 공개하지 않았고(귀속 오류 주의), 대규모 K8s 사례는 오브젝트 스토리지 백킹으로 수렴한다. 스토리지 성능을 하드 요구로 두더라도 **로컬 NVMe hot + S3 cold**(또는 write-through 캐시) 하이브리드가 소규모 인력의 노드 소실·재수화 대응에 유리하다([스토리지 설계]({{< relref "02-storage-local-nvme.md" >}})).
- **로깅 챕터의 경계는 그대로 유지한다** — 로그 hot 경로는 여전히 VictoriaLogs, 메트릭은 VictoriaMetrics다. CH self-host는 통합 저장소 야심이 아니라 RUM·트레이스 등 신호가 실제로 한 팀에 모일 때 얹는 결정이며, 이때도 로그 전면 이전은 별도 명분이 필요하다.
- **비용 주장은 액면가로 믿지 않는다.** "10~50배"는 벤더 인프라 기준 수치이므로 운영 TCO를 가산해 재평가한다([Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}})).

두 챕터는 **모순 없이 양립한다** — 로깅 챕터는 "채택 여부(로그 관점)"에서 보류, 이 챕터는 "채택했다면 어떻게(RUM+분석 관점)"에서 사례를 큐레이션한다. 게이트를 못 넘으면 로깅 챕터 판단이 우선이다. 근거 URL은 [출처]({{< relref "08-sources.md" >}}). 시점 기준 2026-07.
