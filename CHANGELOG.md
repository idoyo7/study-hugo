# 변경 이력

문서 구조와 공통 동작이 바뀐 작업을 기록합니다. 개별 글의 수정 내역은 Git 이력을 확인합니다.

## 2026-10-26 — 전체 문서 WWE 가독성 진단

- 게시글·색인·안내 문서 354개를 WWE로 진단하고 53개 문서의 문장을 다듬었습니다. 역할을 흐리는 비유, 어색한 주어·서술어 연결, 반복되는 문서 소개를 고쳤으며 제목·문단 구조·코드·표·링크·수치·직접 인용은 보존했습니다.
- [진단 보고서](docs/changes/2026-10-26-all-posts-wwe-review.md)와 [전체 문서별 결과](docs/changes/2026-10-26-all-posts-wwe-audit.csv)를 남겼습니다. Hugo 0.166.0 빌드, 내비게이션 검사, 도구 테스트 17개를 통과했습니다.

## 2026-10-26 — promkr 뉴스레터 2026년 소식 요약

- `content/external/promkr/`를 새로 만들었습니다. 섹션 색인(`_index.md`)과 `2026.md` 한 편으로, promkr Substack 뉴스레터 2026년 1~10월호 10편을 월별로 정리하고 열 달 동안 반복된 주제(AI·에이전트, Prometheus 호환 저장소, OpenTelemetry, 비용, 프로파일링·eBPF)를 묶었습니다. 항목 73개의 원문 링크는 모두 뉴스레터 본문에 있는 URL과 대조했습니다.
- 타사 테크블로그 색인의 찾기 목록에 링크를 더하고, 설명 문장이 외부 뉴스레터도 포함하도록 고쳤습니다.
- 같은 날 `2026.md`를 branch bundle `2026/`로 바꿔 호마다 문서 한 편(`01.md`~`10.md`, 공개 URL `/external/promkr/2026/01/`~`/10/`)으로 나눴습니다. `2026/_index.md`는 URL `/external/promkr/2026/`을 그대로 쓰고, 올해 흐름과 호별 찾기 목록만 남겼습니다.
- 2025년 1~12월호 12편도 같은 형식으로 `content/external/promkr/2025/`(색인과 `01.md`~`12.md`)에 더했습니다. 11월호와 12월호는 PromCon EU 2025 발표 정리본이라 발표 하나를 항목 하나로 셌습니다. 링크와 백분율 수치는 모두 뉴스레터 본문과 대조했습니다.

## 2026-10-26 — ECS·EKS 타깃 발견 글을 요약본과 전체본으로 나눔

- `content/observability/metrics/prometheus-ecs-eks-service-discovery/`를 branch bundle로 바꿨습니다. 공개 URL `/monitoring/prometheus-ecs-eks-service-discovery/`에는 228줄 요약본(`_index.md`)을 두고, 기존 전체본은 `detail/index.md`(공개 URL `/monitoring/prometheus-ecs-eks-service-discovery/detail/`, 제목 "ECS·EKS Prometheus 타깃 발견의 근거와 설정 예시")로 옮겼습니다.
- 두 문서 모두 Cloud Map 없이 ECS API로 찾는 구성을 기본으로 쓰고, Cloud Map DNS는 맨 끝 부록에만 둡니다.
- 요약본은 Astra(gpt-6-astra, xhigh)가 전체본을 줄여 썼고, 근거 행·URL·코드·shortcode·숫자가 전체본에서 왔는지 결정적으로 대조한 뒤 의미 리뷰 13건을 반영했습니다. 실행 기록은 `_workspace/structure-2026-10-26-ecs-sd-diet/`에 있습니다.

## 2026-10-25 — ECS·EKS에서 Prometheus 타깃 자동 발견

- `content/observability/metrics/prometheus-ecs-eks-service-discovery/`를 새로 만들었습니다(공개 URL `/monitoring/prometheus-ecs-eks-service-discovery/`). EKS의 kubernetes_sd(API server watch)와 ECS의 발견 방법(네이티브 `aws_sd_configs` role ecs, Cloud Map DNS, ecs_observer, 사이드카), 수집기 배치 다섯 패턴, 다중 컨테이너 태스크의 라벨 설계, 조건별 선택 기준을 정리했습니다. 수치 타일, flow 도식 7장, seq 2장, lane 1장이 들어 있고, 메트릭 색인의 찾기 목록과 설명 목록에 링크를 더했습니다.
- 2026-10-25 조사 보고서 3편(EKS Kubernetes SD, ECS 발견 방법, ECS 아키텍처·운영)을 바탕으로 Claude가 초안을 쓰고 Astra가 전면 재작성한 뒤 원본과 대조해 보정하는 흐름입니다. 보고서끼리 어긋난 값(ecs_observer refresh_interval, 네이티브 ECS SD의 릴리스 날짜)은 소스 쪽을 따르거나 버전만 적었고, 비용 예시는 서울 리전 공개 단가로 계산한 추정입니다.
- 실행 기록은 `_workspace/structure-2026-10-25-ecs-sd/`에 있습니다.

## 2026-10-25 — 로그 저장소 비교 01~05·08과 Vector·ClickHouse 파이프라인 사실 갱신

- `content/observability/logs/comparison/01~05`(OpenSearch, Loki·Alloy, VictoriaLogs, ClickHouse, HyperDX·ClickStack)의 낡은 서술을 2026-10-22 조사 보고서의 "기존 평가 대비 변경점" 표대로 바로잡았습니다. 기존 문장은 살리고 틀린 문장만 바꿨습니다. 보고서가 1차 출처를 찾지 못한 수치(Loki 10–15배 저장 효율, ~100GB→30GB 압축, Cloudflare 96조 이벤트, VictoriaLogs 40~80배 압축)는 빼거나 벤더 문서 문구로 교체했고, 벤더 측정 수치에는 측정자와 조건을 붙였습니다.
- 바뀐 사실: AWS Optimized 엔진 GA(2026-07-01), OpenSearch 3.x 질의 성능, Loki v3.7.9와 4.0의 Kafka 의존·Helm 차트 이관·Logs Drilldown, VictoriaLogs 오브젝트 스토리지 PR의 2026-11 머지 예정과 Enterprise 기능 범위 정정, ClickHouse text index GA 버전(26.2)과 Uber 사례 원문 확인, Managed ClickStack의 MongoDB 불필요.
- 08-recommendation은 VictoriaLogs 오브젝트 스토리지 항목의 근거만 갱신했습니다(일 단위 파티션 offload 설계, PR #1155, 2026-11 머지 예정, 베팅 금지 결론 유지). 09-vector-clickhouse-pipeline은 Vector 0.60.0·Fluent Bit 5.1.5로 올리고, ClickHouse 벤치마크의 측정 조건과 text index 50TB 실험의 두 수치 출처를 분리했습니다. 변경 로그는 `_workspace/structure-2026-10-22-logstack/notes/update-0*.md`에 있습니다.

## 2026-10-22 — 로그 스택 통합 비교

- `content/observability/logs/10-log-stack-comparison/`을 새로 만들었습니다(공개 URL `/logging/10-log-stack-comparison/`). Fluent Bit·집계기·OpenSearch, Alloy·Loki, 수집기·VictoriaLogs, OTel Collector·ClickHouse·HyperDX 네 경로를 앱 로그와 Istio 액세스 로그 기준으로 데이터 모델·수집·검색·비용·운영 축에 놓고 조건별 선택 기준을 정리했습니다. 같은 배치의 flow 도식 4장이 들어 있고, 로그 색인의 찾기 목록과 문서 지도에 링크를 더했습니다.
- 2026-10-22 조사 보고서 5편(저장소 4곳과 수집기·Istio 교차 조사)을 바탕으로 Claude가 초안을 쓰고 Astra가 전면 재작성한 뒤 원본과 대조해 보정하는 흐름입니다. 벤치마크 수치에는 측정자와 조건을 붙였고, 비용 예시는 서울 리전 공개 단가와 벤더 압축비를 조합한 계산입니다.
- 실행 기록은 `_workspace/structure-2026-10-22-logstack/`에 있습니다.

## 2026-10-22 — 블록 스토리지 06·07·08, 다섯 편 글 구조 재작성

- 블록 스토리지에 06(Linux 호스트에서 NVMe/TCP를 FC SAN처럼 운영하기: 식별·자동 연결·CDC·멀티패스·타임아웃·인증·TLS·홈랩 타깃), 07(NVMe over FC·TCP·RDMA를 전송 자체만 놓고 비교, FC가 가장 안정적인가와 접근성 질문에 답함), 08(Kubernetes에서 NVMe-oF를 쓰는 길을 Mayastor를 중심으로, 공개 IOPS 측정 조건과 프로덕션 사례·상용 지원·대안 비교)을 더했습니다. 색인의 찾기 목록과 문서 지도에 세 편을 넣었습니다.
- 어제 올린 다섯 편(블록 04·05, GPU 01·02·03)은 저자 요청으로 Astra(gpt-6-astra, reasoning effort xhigh)에 `##` 절 구성까지 맡겨 다시 썼습니다. 05는 Windows Server 내용을 빼고 Kubernetes CSI를 앞세웠습니다. 추가 조사로 Longhorn V2 data engine GA(1.12.0, 2026-06-02)와 커널 기능 도입 버전(경로별 queue-depth sysfs 6.15, 업스트림 기준 6.18 LTS 필요)을 바로잡았습니다.
- 실행 기록은 `_workspace/structure-2026-10-21-002/`에 있습니다. codex exec는 `--sandbox read-only`로 띄워야 합니다. 샌드박스 없이 돌린 xhigh 호출 하나가 저장소 파일을 직접 고친 일이 있었습니다.

## 2026-10-21 — 데이터·스토리지에 GPU 클러스터 스토리지 추가, 블록 스토리지 04·05

- `content/data/gpu-storage/`를 새로 만들었습니다(공개 URL `/gpu-storage/`). 학습 로딩·체크포인트·모델 로딩·KV cache의 I/O 패턴(01), GPUDirect Storage 조건과 SuperPOD 요구치·병렬 파일시스템 비교(02), 클라우드 관리형·오브젝트 캐시·Kubernetes·MLPerf Storage v3.0 읽는 법(03) 세 편입니다. 데이터·스토리지 색인에 링크를 더했습니다.
- 블록 스토리지 시리즈에 04(2026년 엔터프라이즈 어레이의 호스트 전송 현황)와 05(vSphere·Linux·Windows·Kubernetes 지원, 클라우드 블록 볼륨의 기반 전송, 오프로드 하드웨어)를 추가했습니다. 기존 01~03·부록 URL은 그대로입니다.
- 다섯 편 모두 2026-10-21 조사 보고서를 바탕으로 Claude가 초안을 쓰고 Astra(gpt-6-astra, reasoning effort high)가 전면 재작성한 뒤, 원본과 대조해 지적된 곳만 한 번 더 보정했습니다. 실행 기록은 `_workspace/structure-2026-10-21-001/`에 있습니다.

## 2026-10-21 — 다섯 번째 대분류 "타사 테크블로그"

- 다른 회사 기술 블로그와 발표를 회사별로 모아 요약하는 `content/external/`을 만들었습니다. 사이드바 루트가 넷에서 다섯이 되어 `tools/check-content-navigation.py`의 `ROOT_SECTIONS`와 테스트의 루트 목록에 `/external/`을 더했습니다.
- 네이버: 관측성 아래 있던 VictoriaMetrics "원문별 정리" 4편을 `external/naver/d2-victoriametrics/`로 옮겼습니다. 공개 URL(`/monitoring/victoriametrics/by-source/…`)은 front matter `url`로 그대로이고, 경로 대응표 CSV의 `new_source` 5행만 새 위치로 바꿨습니다. VictoriaMetrics 색인의 "외부 발표·사례" 링크는 새 위치를 가리킵니다.
- 당근: SRE팀 클러스터 파트 자료를 중심으로 블로그 9편과 발표 24편을 한 편당 짧은 요약 한 장으로 정리했습니다. 클러스터 파트 판단은 채용 공고가 링크한 자료와 블로그 저자 소개, SRE 밋업 발표자료 페이지의 소속 표기를 따랐고, 다른 팀·파트의 Kubernetes·배포 관련 글과 발표도 함께 실었습니다. 발표는 행사별 폴더(`talks/sre-meetup-1`~`4`, `talks/builder-meetup-2026`)에 있습니다.
- 수집 범위는 2026-10-21에 확인한 당근 Medium 전체 글 목록(2015-06~2026-10, 223편)과 SRE 밋업 1~4회 발표 목록입니다. 발표 요약은 YouTube 자동 자막과 Notion에 공개된 슬라이드를 함께 읽었고, 둘이 어긋나면 슬라이드 값을 썼습니다. 자막에서만 들린 금액은 싣지 않았습니다. SRE 밋업 1회 PrivateLink 발표는 공개 영상과 슬라이드를 찾지 못해 빠졌습니다.
- 당근 요약은 Claude가 초안을 쓰고 Astra(gpt-6-astra, reasoning effort xhigh)가 전면 퇴고한 뒤, 원문 초안·자막·슬라이드와 대조해 필요한 곳만 한 번 더 보정했습니다.

## 2026-10-07 — 도식 "크게 보기" 닫기 버튼·캡션 간격·lane 확대

관련 PR: [#47](https://github.com/idoyo7/study-hugo/pull/47)

- 폰 폭(390x844)에서 모든 도식 235개를 "크게 보기"로 열어 쟀습니다. 우상단 닫기 버튼이 도식 글자를 덮은 도식이 왼쪽 끝에서 flow 83/145, seq 10/49였고, 오른쪽 끝까지 밀면 flow 18, seq 22, cfstl 5, mnode 2, bscore 1, rrev 1, rstep 4개가 덮였습니다. 도식이 위에서 12px 아래에서 시작했기 때문입니다.
- 좁은 화면 오버레이의 위쪽 padding을 60px(닫기 버튼 아래 끝 52px)으로 키우고 `align-content:start`를 추가했습니다. 변경 후 글자가 덮이는 도식은 왼쪽 끝·오른쪽 끝 모두 0개이고 도식은 y=60에서 시작합니다. 같은 규칙으로 도식과 caption 사이 간격이 80px을 넘던 도식이 flow 142, seq 33, cfstl 5, mnode 2, bscore 1, rrev 1, rstep 4개(최대 381px)에서 0개로 줄었고, 최대 간격은 8px입니다. cfstl만 도식과 caption 사이에 범례가 있어 64px입니다.
- lane(28개, 12편)은 `expand.css`에 규칙이, `expand.js`의 `SVG_SEL`에 `.lane-svg`가 없어 데스크톱·폰 모두 확대되지 않고 페이지 스크롤만 잠겼습니다(28개 전부 `position:fixed`가 아님). 7종과 같은 규칙에 lane을 넣어 28개 모두 전체화면으로 열립니다. `.vm-lane`이 이미 불투명 배경을 가져 따로 칠하지 않았습니다.
- 다크 테마에서 닫기 버튼이 보이지 않던 문제도 고쳤습니다. 닫기 버튼 배경이 `--flow-surface`/`--sq-surface`만 따르고 나머지 6종 변수를 몰라 `#fff`로 남았고, 글자색은 상속이라 밝아져 lane 28개와 cfstl·mnode·bscore·rrev·rstep 13개에서 대비가 1.0~1.1이었습니다. 배경 변수 체인에 6종 surface 변수를 모두 넣어 오버레이와 같은 색을 따르게 했습니다. 폰·데스크톱 모두 235개 대비가 15.66 이상이고, 확대하지 않은 상태의 박스·SVG 크기는 변경 전과 같습니다.
- 닫은 뒤 `html.vm-expand-lock`이 남는 도식은 235개 중 0개입니다. 데스크톱(1280x800) 오버레이의 기존 7종 207개는 도식 위치·크기가 변경 전과 모두 같습니다. 데스크톱에서 달라지는 것은 lane이 열리는 것과 닫기 버튼 배경색입니다.
- 겹침은 확대 화면을 연 직후(세로 스크롤 0)와 좌우 끝에서 쟀습니다. 화면보다 긴 도식을 세로로 밀면 고정된 닫기 버튼이 다시 글자 위에 올 수 있고, 이 경우는 세지 않았습니다.

## 2026-10-05 — 사이드바 접기 버튼

- 데스크톱(768px 이상) 사이드바 아래 메뉴 바, 테마 전환 버튼 오른쪽에 접기 버튼을 추가했습니다. 누르면 사이드바가 3rem 레일만 남기고 접히며, 접힌 동안 문서 트리는 `visibility:hidden`이라 키보드 포커스와 스크린리더에서 빠집니다.
- 상태는 `localStorage`의 `sb-off`에 저장하고 `<html data-sb-off>`로 표현합니다. 첫 페인트 전에 적용하는 인라인 한 줄을 `head-end.html`에 두어 접힌 채로 연 페이지가 펼쳐졌다 접히지 않게 했고, 저장소 접근이 막혀도 try/catch로 펼친 상태로 동작합니다.
- 버튼 동작은 캐시되는 `static/js/sidebar-collapse.js`로 분리했습니다. 페이지당 HTML은 약 600바이트 늘었습니다(대표 3개 페이지 실측은 커밋 설명 참고). 모바일 햄버거 메뉴와 `themes/hextra` 파일은 건드리지 않았습니다.
- 접힌 레일에는 펼치기 버튼만 남기므로 접은 채로는 테마를 바꿀 수 없습니다(의도한 설계, 펼친 뒤 전환). 접힌 상태로 연 페이지에서 `defer` 스크립트가 실행되기 전(또는 로드 실패 시)에는 버튼의 `aria-expanded`·라벨이 "접기"로 남을 수 있습니다. 접힘 규칙은 정상 사이드바(`hx:md:sticky`)에만 걸려, 사이드바가 꺼진 페이지의 placeholder 폭은 바뀌지 않습니다.
- `tools/check-content-navigation.py`의 baseline 비교가 지문 해시만 바뀐 번들(`/css/compiled/main.min.<해시>.css`)을 사라진 자산으로 보고 CI를 실패시켰습니다. `custom.css`를 바꾸면 번들 해시가 바뀌는 것이 정상 동작이라(HTML은 `max-age=0`, 해시 파일은 immutable) 같은 디렉터리·stem·확장자에 해시만 다른 파일이 있으면 통과시키고, 대응 파일이 없으면 지금처럼 실패합니다. 해시 길이(알고리즘)가 다르면 대응으로 보지 않습니다. 새 HTML의 깨진 참조는 기존대로 별도로 잡습니다. 잔여 위험으로, `<stem>.<32hex>.png` 꼴 일반 이미지는 같은 디렉터리에 해시만 다른 형제가 있으면 삭제돼도 통과하지만 이 저장소에는 그런 파일명이 없습니다.
- 문구는 `i18n/ko.yaml`의 `sidebarCollapse`·`sidebarExpand`, 스타일은 `assets/css/custom.css`에 있습니다. `prefers-reduced-motion`이면 전환 애니메이션이 없습니다.

## 2026-10-05 — 도식 사용 가이드

관련 PR: [#35](https://github.com/idoyo7/study-hugo/pull/35)

- 도식을 넣을지, 몇 장으로 나눠 어떤 엔진으로 그릴지, 그린 뒤 무엇을 확인할지를 정하는 가이드를 저장소 루트에 추가했습니다.
- 크기 기준값은 엔진 상수, 본문 폭 실측(데스크톱 638px), 기존 도식 203개의 집계에서 가져왔습니다. 기존 도식을 일괄 수정하지 않고 새로 그리거나 그 글을 고칠 때 적용합니다.
- README·DIAGRAMS.md·CLAUDE.md에 가이드로 가는 링크를 추가했습니다. DIAGRAMS.md의 필드와 상수 설명은 그대로입니다.
- 첫 적용으로 homelab 04편을 구조 중심으로 줄이고 도식을 이 가이드 기준으로 다시 그렸습니다(3장 → flow 3장, seq 2장). 과정은 가이드 11절에 적었습니다.

[도식 사용 가이드](DIAGRAM-GUIDE.md)

## 2026-10-04 — AI 초안 공간과 게시글 작성 흐름 안내

관련 PR: [#34](https://github.com/idoyo7/study-hugo/pull/34)

- 사이트 소개를 모든 문서가 AI로 작성되는 초안·조사 자료 공간이라는 목적에 맞춰 다시 썼습니다.
- 초안 작성 → 근거·조건 확인 → 초안 다듬기 → makgol.com에서 새 게시글 작성 과정을 안내합니다.
- 홈 소개·검색 설명·README·Claude 안내도 같은 취지로 맞췄습니다.

[사이트 소개 원본](content/about.md)

## 2026-10-04 — 문서 분류 개편

관련 PR: [#32](https://github.com/idoyo7/study-hugo/pull/32)

- 최상위 22개 주제를 플랫폼·인프라 / 관측성 / 데이터·스토리지 / 설계·개발의 4개로 통합했습니다.
- Istio·Karpenter·ClickHouse의 긴 문서 목록을 하위 주제로 나누고, HyperDX·VictoriaMetrics·Valkey의 관련 시리즈를 한 부모 아래로 모았습니다.
- 기존 문서와 도식, 공개 URL·별칭을 보존하고 내부 참조를 새 파일 위치로 갱신했습니다.
- 모바일·데스크톱 사이드바는 최대 5단계를 표시하며 이전·다음 문서는 같은 부모 안에서 연결합니다.
- PR에 Hugo 빌드와 내부 링크·내비게이션 회귀 검증을 추가했습니다.

[상세 변경 기록](docs/changes/2026-10-04-content-navigation.md) · [전체 경로 대응표](docs/changes/2026-10-04-content-navigation.csv)
