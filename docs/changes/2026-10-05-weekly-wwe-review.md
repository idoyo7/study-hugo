# 최근 일주일 글 목록과 WWE 재작성 기록

대상 기간은 2026-09-28부터 2026-10-05 작업 시작 시점까지다. 저장소의 현재 원문과 Git 이력으로 확인했으며, 실제 운영 사이트의 배포 시각을 조회한 목록은 아니다. 사용자는 신규 글과 이 기간에 본문을 수정한 기존 글 모두를 대상으로 지정했다.

신규 글 **17편**, 본문 개정 글 **4편**을 검토했다. 본문을 재작성한 글은 **19편**, 기록 본문을 보존하고 안내를 편집한 전사·STT 문서는 **2편**이다. 2026-10-04 분류 개편의 파일 이동·relref 변경은 신규 글로 세지 않았다. 목차·홈·사이트 소개·참고 자료 목록은 게시글 수에서 제외했다.

## 신규 글 17편

| 게시일(date) | 글 | 편집 내용 |
|---|---|---|
| 2026-10-05 | [VM 표준 구성을 로컬 디스크로만 잡아도 되는가 — 복제를 어디에 둘 것인가](../../content/data/block-storage/03-local-disk-ha/index.md) | 복제 주체와 복구 조건을 중심으로 재작성하고 커밋·재복제·백업을 구분했다. |
| 2026-10-05 | [부록 · HDD를 NVMe로 붙이면 오버헤드가 줄어드는가](../../content/data/block-storage/a1-nvme-hdd/index.md) | 절마다 반복한 고정 결말을 줄이고 기구 지연·큐·타깃 경로를 구분했다. |
| 2026-10-05 | [부록 · NFS를 같이 놓고 보면 — 파일 프로토콜은 iSCSI·NVMe-oF와 어디서 다른가](../../content/data/block-storage/a2-nfs/index.md) | 쓰기 보장·캐시·장애 조건을 나누고 최종 판단표를 본문의 제한에 맞췄다. |
| 2026-10-05 | [부록 · EKS 범용 노드와 gp3에서 잰 ClickHouse 1억 행 실측](../../content/data/clickhouse/storage/a1-eks-gp3-benchmark.md) | 측정 환경·압축·쿼리 결과·재현 한계가 이어지도록 재작성했다. |
| 2026-10-05 | [부록 · EBS gp2·gp3 fio 실측은 gp3 선택을 어디까지 뒷받침하는가](../../content/observability/hyperdx/design/a1-ebs-gp2-gp3-benchmark/index.md) | gp2 버스트와 gp3 설정 차이, 각 시험의 관측 시간을 구분했다. |
| 2026-10-05 | [부록 · AZ를 건너면 Pod 간 지연은 얼마나 늘어나는가](../../content/observability/metrics/victoriametrics/operations/a1-pod-network-rtt/index.md) | 패킷·HTTP 연결·AZ 조건별 측정을 나누고 비교 범위를 결과 가까이에 뒀다. |
| 2026-10-05 | [부록 · 사이드카와 Ambient의 지연·롤아웃 실측은 무엇을 말하는가](../../content/platform/istio/ambient/a1-sidecar-vs-ambient-measurements/index.md) | 지연과 롤아웃 실측을 나누고 개선 전후 요청 수·오류율 조건을 정리했다. |
| 2026-10-05 | [OpenStack on Kubernetes — 컨트롤 플레인은 파드로, VM은 여전히 베어메탈의 KVM으로](../../content/platform/kubernetes/resources/07-openstack-on-kubernetes/index.md) | VM 요청·실행·운영 책임을 중심으로 설명하고 중복 근거와 잘못 묶인 비교 제목을 고쳤다. |
| 2026-10-04 | [iSCSI와 NVMe-oF — 네트워크 블록 경로와 비용](../../content/data/block-storage/01-iscsi-nvme-of/index.md) | 연결·명령·백엔드 순서로 설명하고 본문과 겹친 근거 행을 정리했다. |
| 2026-10-04 | [NVMe 용량을 VM에 나누기 — virtio·vhost·가상 NVMe·직접 할당](../../content/data/block-storage/02-vm-disk-paths/index.md) | 게스트 장치·처리 주체·공유 단위를 구분하고 측정 조건을 비교 가까이에 배치했다. |
| 2026-10-04 | [수집 경로 다시 그리기 — Vector와 ClickHouse](../../content/observability/logs/09-vector-clickhouse-pipeline/index.md) | 직접 sink와 OTel exporter 비교를 설정 앞에 놓고 홈랩 검증 범위를 분명히 했다. |
| 2026-10-04 | [Istio 히스토그램 3종이 시리즈의 44%: vmstorage 인덱스 줄이기](../../content/observability/metrics/victoriametrics/operations/06-storage-index-roadmap.md) | 사용처 조사 뒤 라벨 구성을 설명하고 전체 90% 감축 재집계와 실제 적용 계획을 구분했다. |
| 2026-10-04 | [03 관측 스택 일원화 — Vector와 HyperDX 컬렉터로 모으기](../../content/platform/homelab/03-observability-consolidation/index.md) | 계층별 비교와 선택을 연결하고 개명·이관 기록을 실행 절에 모았다. |
| 2026-10-04 | [04 DNS 장애 전환 — Kuma가 깨우고 GitHub Actions가 Route53을 바꾼다](../../content/platform/homelab/04-dns-failover/index.md) | 감시·판정·레코드 변경·알림·재시도를 나누고 미검증 전환을 명시했다. |
| 2026-10-01 | [01 워크플로우 · 하네스 · Context/Memory · MCP/A2A](../../content/engineering/ai-tools/03-agent-concepts/01-concepts/index.md) | 개념 질문부터 시작하고 반복 요약·발표 진행 회고를 정리했다. |
| 2026-10-01 | [부록 · 발표 전사 — 에이전트, 개념부터 같이 정리해봐요](../../content/engineering/ai-tools/03-agent-concepts/02-transcript/index.md) | 전사 발언·타임코드·슬라이드 노트를 보존하고 안내 구조를 다듬었다. |
| 2026-10-01 | [부록 · STT 원문 — 에이전트, 개념부터 같이 정리해봐요](../../content/engineering/ai-tools/03-agent-concepts/03-stt-raw/index.md) | STT 기록을 그대로 보존하고 원자료 사용 안내를 다듬었다. |

게시일은 frontmatter의 `date`다. DNS 장애 전환 글은 게시일이 10월 4일이고, 현재 Git 이력에서 최초 추가 커밋은 10월 5일이다. 발표 전사와 STT 원문은 신규 문서 목록에 포함하되 발언·타임코드 본문을 원자료로 보존한다.

## 본문이 개정된 기존 글 4편

| 글 | 기존 게시일 | 편집 내용 |
|---|---|---|
| [01 Claude Code 관측 — OTel 내보내기·대시보드·백필](../../content/engineering/ai-tools/01-claude-code-otel/index.md) | 2026-09-08 | 현재 OTel 수집 경로와 과거 로그 백필을 구분해 재작성했다. |
| [02 Codex CLI 관측과 공통 대시보드 — Claude Code와 한 화면에](../../content/engineering/ai-tools/02-codex-otel/index.md) | 2026-09-22 | 설정·실제 수집·대시보드 차이를 연결하고 공통 경로의 반복을 줄였다. |
| [vmagent AZ 분할로 AZ 간 scrape 전송 줄이기](../../content/observability/metrics/victoriametrics/operations/05-vmagent-az-split/index.md) | 2026-09-27 | 실측과 전체 적용 예상의 분모를 구분하고 최종 전환 계획부터 설명했다. |
| [01 hub/edge 2-클러스터 구조](../../content/platform/homelab/01-hub-edge-architecture/index.md) | 2026-08-20 | NAS 장애에서 운영 방침으로 이어지게 쓰고 home-assistant의 PVC 예외를 앞에서 밝혔다. |

## 링크·목차만 바뀐 문서

아래 기존 문서는 본문의 기술 설명을 새로 쓴 글과 구분했다. 최근 변경분을 대조하고 연결 대상도 검증했으며, 글 전체를 재작성하는 범위에는 넣지 않았다.

- ClickHouse 「스토리지 아키텍처 — 로컬 NVMe」: EKS gp3 부록 안내 추가.
- HyperDX 「ClickHouse hot 데이터를 gp3에 저장하기」: EBS 실측 부록 안내 추가.
- Istio 「왜 Ambient mode인가」: 사이드카·Ambient 실측 부록 안내 추가.
- ClickHouse·HyperDX 참고 자료: 새 부록의 외부 출처 추가.
- VictoriaMetrics 「카디널리티」·「쿼리 패턴」: 관련 글의 시리즈 이름 변경.

## 적용한 편집 기준

- WWE v1.7.0의 구조 편집 가이드(`structure-editing.md`)와 한국어 명확성 지침(`korean-clarity.md`)을 적용했다.
- 형식적인 도입·반복 결론, 본문을 그대로 되풀이하는 근거표, 관계가 생략된 명사 나열을 문맥에 맞게 고쳤다. 필요한 비교표와 절차는 남겼다.
- 실제 관측·문서 확인·벤더 주장·계산·추론·미확인을 구분했다. 미확인 결과를 재현하거나 새로 측정한 것처럼 쓰지 않았다.
- frontmatter, 공개 URL, 코드, 출처와 도식 자산을 보존했다. 헤딩을 바꾼 곳은 이전 Hugo의 실제 앵커를 명시했다.
- 발표 전사와 STT 원문은 기록 본문을 보존하고 안내만 편집했다.

## 원출처와 대조해 고친 내용

- EBS 부록의 ‘같은 시간 내내’라는 비교를 gp3 600초, gp2 2,700초의 각 시험으로 구분했다. 측정자가 공개한 [fio 명령과 결과](https://www.atomai.click/kubernetes-docs/ko/storage/01-ebs-gp2-gp3-benchmark)에서 확인했다.
- Istio 부록의 59,352건은 전체 요청 수가 아니라 성공(200) 건수다. 성공 59,352건과 503 응답 648건으로 구분했다. [원출처의 조정 후 표](https://www.atomai.click/kubernetes-docs/ko/service-mesh/istio/comparison/03-sidecar-vs-ambient)가 근거다.
- Pod RTT 부록의 keepalive 설명을 고쳤다. 연결을 재사용해도 같은 AZ와 다른 AZ의 HTTP p50은 각각 0.461ms·0.704ms로 차이가 있었다. [원출처의 HTTP 실측](https://www.atomai.click/kubernetes-docs/ko/networking/06-pod-network-benchmark)에서 확인했다.

Claude 백필 기록의 총수 5,065개와 항목별 합계 5,064개는 1건 차이가 난다. 원자료로 확정할 수 없어 기존 수치를 유지하고 해당 표 아래에 재확인 필요를 표시했다. 코드 예제의 과거·현재 적용 조건과 미실시 검증도 유지했다. 이번 작업은 문서 재작성과 확인한 모순의 수정이며, 모든 기술 사실을 새로 실험한 것은 아니다.

## 검증 기록

- Hugo **0.166.0 extended**로 원본과 전체 후보를 각각 빌드했다. 후보 빌드는 **555 pages**로 성공했다. 시스템 기본 0.164.0 대신 저장소 지정 버전을 임시 경로에서 사용했다.
- 내비게이션 검사: **293 HTML**, **1,455 경로·리소스**를 기존 빌드와 비교했다. 내부 링크·리소스·canonical·사이드바 검사 통과.
- 대상 21편의 기존 HTML ID **356개**가 모두 남았다. 새 중복 ID도 없었다.
- 기존 회귀 테스트 **17개** 통과.
- 21편 모두 frontmatter·fenced code·shortcode 다중집합·출처 URL 집합을 대조했다. 누락이 없으며, 발표 전사와 STT 기록 본문은 바이트 단위로 동일하다.
- WWE 습관 표현 검사 결과는 문맥별로 검토했다. 실제 UI 명칭인 ‘한눈에’, 참조를 뜻하는 ‘가리키다’, 기술 용어 ‘구조적 병합’, 직접 전사의 발언은 기계적으로 지우지 않았다. ‘카테고리를’·‘유실은’의 부분 문자열 탐지도 제외했다.
- 독립 의미 검토에서 새로 붙은 인과 3곳을 제거하고 LeapIO 수치의 ‘논문 초록이 제시한 개발 동기’라는 한정을 복원했다.
- 최종 적용 전 원본 SHA-256을 재대조하고 검증한 후보와 같은 내용을 원본 21편에 반영했다. 반영 뒤 실제 원본 경로에서도 Hugo 빌드와 기준 빌드 대비 내비게이션 검사를 다시 통과했다. `git diff --check`도 통과했다.

원본 스냅샷·후보·글별 메모·보존 검사·앵커 검사·digest는 `_workspace/structure-2026-10-05-weekly-wwe/`에 있다. 원본과 후보 및 검사 기록은 `run.json`에서 연결된다.
