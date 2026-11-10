# 변경 이력

문서 구조와 공통 동작이 바뀐 작업을 기록합니다. 개별 글의 수정 내역은 Git 이력을 확인합니다.

## 2026-11-10 — HyperDX·ClickStack에 타사 사례 분류와 게임듀오 사례 추가

- `content/observability/hyperdx/cases/`를 새로 만들고 HyperDX·ClickStack 색인에서 잇습니다. 다른 회사의 ClickStack 구축·운영 공개 사례를 우리 설계 문서와 대조하려고 모으는 자리입니다.
- 첫 문서는 AWS 기술 블로그의 게임듀오 사례(2026-11-10, 서창민·이은학)입니다. 250대 넘는 게임 서버의 로그·트레이스를 SaaS에서 EC2 기반 ClickStack으로 옮기면서 Loki를 접은 이유, 게이트웨이가 S3에 먼저 쓰고 응답하는 S3+SQS 버퍼, EBS 핫(로그 7일)·S3 콜드(180일) 티어링, 카나리·데드맨·정합성 점검, TTL 변경·머지 예약·자동 컬럼 통계로 겪은 장애를 요약했습니다. 끝에서 우리 EBS·S3 티어링·용량 산정 문서로 잇습니다.
- 원문은 Chrome으로 읽었습니다. Claude 초안 → Astra(`gpt-6-astra`, xhigh) 전면 재작성 → 코드 블록·수치·앵커·표 기계 대조와 문장 대조 순으로 만들었고, 보정은 필요 없었습니다.

## 2026-11-10 — 네이버에 n3r OIDC 발표 요약 추가

- NAVER Engineering Day 10th 공개 세션 「로그인 화면, 이제 만들지 마세요 - n3r OIDC」(YouTube, 2026-11-08 공개, 약 32분)를 `content/external/naver/n3r-oidc.md`에 요약했습니다. 사내 쿠버네티스 플랫폼 n3r의 IAM을 OIDC 프로바이더로 열면서 내린 네 가지 설계 결정(프로젝트 접두사 groups와 프로젝트별 roles 클레임, 클라이언트 등록 주체로 정하는 audience, 토큰의 롤만 보는 인가, introspection 없이 짧은 액세스 토큰 수명)과 트레이드오프가 중심입니다.
- 본문은 YouTube 한국어 자동 자막(306구간)을 Chrome 스크립트 패널에서 받아 썼습니다. timedtext API는 빈 응답을 돌려줬습니다. n3r→NCR, 사번→4번, 감사 로그→오딘로그 같은 인식 오류를 문맥으로 고친 전사본은 로컬 `_workspace/n3r-oidc-2026-11-10/transcript.md`에만 두고 게시하지 않았습니다. 슬라이드에만 있던 설정 예와 토큰 예시 값은 요약에 없습니다.
- Claude 초안 → Astra(`gpt-6-astra`, xhigh) 전면 재작성(전사본을 사실 확인용으로 함께 제공) → 전사본 대조 순으로 만들었고 보정은 필요 없었습니다.

## 2026-11-10 — 타사 테크블로그에 올리브영·여기어때 온콜 사례 추가

- Amazon Connect `StartOutboundVoiceContact`로 장애 전화를 거는 국내 사례 두 편을 요약했습니다. 올리브영(2025-12-24, SES·SQS·Lambda 서버리스, Google Groups와 플러스 어드레싱으로 수신자 식별)은 `content/external/oliveyoung/`에, 여기어때(2025-12-16, Grafana OnCall 당번표·ELBv2 직접 감지·Slack 전화 중지 버튼)는 `content/external/yeogi/`에 두고 두 문서가 서로를 잇습니다. 분류 색인에도 두 출처를 더했습니다.
- 여기어때 블로그는 WebFetch에 403을 돌려줘서 두 원문 모두 Chrome으로 읽었습니다. 여기어때 원문의 values.yaml 예시는 `ingress.enabled: true`인데 본문은 Ingress를 껐다고 설명하므로, 요약에 그 불일치를 주의로 남겼습니다.
- Claude 초안 → Astra(`gpt-6-astra`, xhigh) 전면 재작성 → Claude 원문 대조 → 보정 1회(올리브영의 "수신 확인 절차를 두지 않는다"는 원문에 없는 단정이라 "원문에 나오지 않는다"로 낮춤) 순으로 만들었습니다. 실행 기록은 `_workspace/structure-2026-11-10-oncall/`에 있습니다.
- 두 설계를 항목 17개로 나란히 놓은 비교 문서 `content/external/oncall-amazon-connect-comparison.md`를 더했습니다. 여기어때 원문 이후 Grafana OnCall OSS가 2026-03-24 아카이브된 사실은 Grafana 공식 블로그·문서로 확인해 출처와 함께 실었고, 여기어때의 Connect 직접 호출 경로가 Cloud Connection 종료와 무관해 보인다는 부분은 추정으로 표시했습니다. 같은 방식(초안 → Astra xhigh → 대조)으로 만들었고 보정은 필요 없었습니다.

## 2026-11-10 — 타사 테크블로그에 Uber 추가

- Uber 엔지니어링 블로그 777편 가운데 게시일이 있는 745편을 제목과 태그로 분류했고, 인프라(컴퓨트·Kubernetes, 관측성, 신뢰성, 데이터베이스, CI·개발자 도구, 서비스 아키텍처, 네트워크·보안)와 AI(GenAI 에이전트, ML 플랫폼) 글 206편을 골랐습니다. 데이터 플랫폼, 응용 ML 모델링, AI Labs 연구, 모바일·웹, 조직 소개 글은 제외했습니다.
- `content/external/uber/` 아래 아홉 분류로 나눴습니다. 2020년 이후 155편 가운데 153편을 한 편씩 요약했습니다. 나머지 2편(Prompt Engineering Toolkit, Offline Inferences)은 Uber 페이지에 본문이 나오지 않아서, 2019년 이전 51편과 함께 분류 색인에 원문 링크로만 실었습니다.
- 요약 153편은 영어 원문 자료와 함께 Astra(`gpt-6-astra`, xhigh, `--sandbox read-only`)로 제목·절 구성·문장을 전면 재작성했습니다. 원문 자료는 처음 7편만 전문이고, 나머지 146편은 사실·수치·예시를 풀어 쓴 영어 상세 노트입니다. 전문을 그대로 옮겨 적는 출력이 차단돼서 바꿨습니다. 결정적 검증(frontmatter·callout·details 표 행·URL·코드·앵커·제목 콜론·헤딩 말투)에서 FATAL 0인 후보만 반영했고, 1편은 보정 1회 뒤 통과했습니다. 표본 5편을 원문과 사실 대조했더니 수치 오류는 없었고, 인과 과장 1건과 근거 없는 표 값 1건은 직접 고쳤습니다. 실행 기록은 `_workspace/structure-2026-11-10-uber-summaries/`에 있습니다.
- 저자 검토로 22편을 지웠습니다. 짧은 공지·릴리스 노트 5편, 법무·장보기·송장·재무·기획·디자인·라벨링 같은 현업 부서용 GenAI 앱 8편, ML 모델링·연구 쪽 5편, 사무실 네트워크·인보이스 서비스 이전·보안 훈련 같은 사내 IT·도메인 글 4편입니다. 선별 목록에서도 빼서 분류 색인에 원문 링크로 남기지 않았습니다. 남은 분량은 184편이고, 그중 요약은 131편입니다.
- 이어서 13편을 더 지웠습니다. 인프라와 거리가 있는 9편(DragonCrawl, PerfInsights, FixrLeak, JUnit 5 이전, Piranha, Neuropod, OCI Ampere 협업, 지속가능 엔지니어링, uVitals)과, 뒤 글이 같은 주제를 대신하는 4편(Java 불안정 테스트 2021, Edge Gateway 첫 글, Horovod on Ray, XGBoost on Ray)입니다. 2019년 이전 원문 링크도 폐기된 프로젝트, 공지성 글, 뒤 글이 대신하는 글 16개와 본문 없는 2개를 빼고 35개만 남겼습니다. 최종 분량은 선별 153편, 요약 118편입니다.
- Uber 블로그는 curl 요청에 406을 돌려주므로 본문은 Chrome으로 읽었습니다. 여러 탭으로 함께 열면 보안 검사 페이지가 떠서, 브라우저 작업은 한두 개로 제한해 돌렸습니다.

## 2026-11-09 — 한 요청의 여행 5편을 3편으로 합치고 response flag 절 추가

- 저자 결정으로 다섯 편을 세 편으로 합쳤습니다. 「01 연결 너머의 길 — NLB에서 사이드카 15006까지」(01+02, `/study/istio-mesh/01-to-the-gateway/`), 「02 요청마다 달라지는 길 — 사이드카 통신과 L7 제어」(03+04, `/study/istio-mesh/02-between-proxies/`), 「03 두 프록시의 발자국 — 메트릭·로그·트레이스」(05, `/study/istio-mesh/03-traces-left-behind/`)입니다. 이전 주소(`/study/istio-mesh/0N-…/`, `/istio/mesh-traffic/0N-…/`)는 모두 aliases로 새 주소에 연결했고 앵커 id는 그대로입니다. 그림 24장도 모두 옮겼습니다.
- 2편에 Envoy response flag 절을 새로 넣었습니다. UH·UF·URX·UT·UO·NR·NC·UC·DC를 뜻, 주로 찍히는 쪽(호출 쪽/대상 쪽 사이드카), 대표 장면으로 정리하고 나머지 flag는 접힌 블록에 두었습니다. Envoy 1.39 문서와 소스로 확인했고, 실측하지 않은 장면은 추정으로 표시했습니다(`_workspace/istio-merge-2026-11-09/research-flags.md`).
- sonnet 병합 초안 → Astra(`gpt-6-astra`, xhigh, `--sandbox read-only`) 전면 재작성(명사구 제목 규칙, 분량 85~110% 유지) → sonnet 검증 → 보정 1회 순으로 만들었습니다. 1편에서 Astra가 근거 표 링크를 다른 글로 바꾼 것과 2편의 절 배치를 보정에서 바로잡았습니다. 실행 기록은 `_workspace/structure-2026-11-09-istio-merge/`에 있습니다.

## 2026-11-08 — 한 요청의 여행 본문 보충과 istiod·xDS 아키텍처 그림

- 그림 중심 개편에서 너무 많이 잘렸다는 저자 평가에 따라 다섯 편의 보이는 본문을 약 1.5배로 늘렸습니다(공백 제외 13,874자 → 21,253자). 개편 전 원고에서 확인 명령(`istioctl proxy-config`, iptables 등), 짧은 YAML 예, 그림만으로 안 보이는 인과와 기본값·함정, 사이드카와 ambient 대조를 골라 되살렸고 절마다 접힌 근거 표를 다시 달았습니다. 그림·제목·소제목·앵커는 그대로입니다. 분량 측정 스크립트와 브리프는 `_workspace/istio-visual-expand-2026-11-08/`에 있습니다.
- 02편에 istiod가 Kubernetes API를 watch하고 ingress gateway와 사이드카 Envoy에 xDS로 설정과 인증서를 내려보내는 아키텍처 그림을 더했습니다. Istio 공식 아키텍처 그림(사이드카 모드)의 배치(위 데이터 플레인 Ingress → Service A → Service B → Egress, 아래 istiod)를 따라 flow로 다시 그렸고, Ingress 자리에 ingress gateway를, istiod 옆에 Kubernetes API를 더했습니다.

## 2026-11-09 — 로깅에 VictoriaLogs 스토리지 내부 구조 시리즈 추가

- Write-Ahead 블로그의 VictoriaLogs 스토리지 내부 구조 시리즈 1편(데이터 모델, 2026-11-07)을 읽고 `content/observability/logs/victorialogs-internals/`에 시리즈 묶음 페이지와 1편 정리를 두었습니다. 로그 한 줄이 필드 가방, 스트림 해시, 일 파티션을 거쳐 datadb·indexdb로 갈라지는 흐름을 flow 도식 한 장으로 그렸습니다.
- 1편 본문은 Claude 초안을 Astra xhigh가 전면 재작성하고 보정 1회를 거쳤습니다. 첫 재작성(초안만 입력)은 사실은 맞았지만 단정문만 늘어 딱딱하다는 평가를 받아, 영어 원문 전문을 참고 자료로 함께 넘기고 원문의 비유와 어조를 살리도록 지시를 바꿔 다시 돌렸습니다. 실행 기록과 편집 전 초안은 로컬 `_workspace/structure-2026-11-09-victorialogs-data-model{,-v2}/`에 있습니다. 시리즈 묶음 페이지는 색인 성격이라 재작성하지 않았습니다.
- 원문 시리즈와 별도로 `es-vs-victorialogs/`에 Elasticsearch와 VictoriaLogs의 저장 구조를 같은 배치의 flow 도식 두 장으로 나란히 놓고, 자원 차이가 생기는 지점과 벤치마크 조건을 표로 정리한 비교 글을 두었습니다. 근거는 2026-11-09에 공식 문서·소스·벤치 저장소를 직접 확인했고(VictoriaLogs v1.53.0, Elasticsearch 9.5.6 기준), 벤더 주장과 구조상 추정을 본문에서 구분했습니다. 출처 URL이 없는 일화 한 건은 뺐습니다.
- 로깅 색인과 VictoriaLogs 비교 글에서 새 시리즈로 가는 링크를 추가했습니다. Hugo 0.164.0 빌드, 내비게이션 검사, 도식 spec-lint를 통과했습니다.

## 2026-11-08 — 타사 테크블로그에 티맵모빌리티 추가

- 티맵모빌리티 테크노트(브런치 @tmapmobility) 29편 가운데 지도·측위·경로탐색 엔진, 실시간 데이터 파이프라인, 클라우드 인프라, 보안에 해당하는 18편을 `content/external/tmap/blog/`에 한 편씩 요약했습니다. 형식은 쏘카·당근 요약과 같고, 목록은 게시일 최신순입니다.
- 티맵 앱과 지도 서버가 어떻게 이어지는지를 관련 글 14편의 단서로 진단한 문서를 `content/external/tmap/server-connectivity.md`로 두었습니다. 원문이 지속 연결 방식을 밝히지 않는다는 점을 먼저 적고, 드러난 패턴과 알 수 없는 영역을 나눴습니다.
- 브런치는 curl 요청을 로그인 페이지로 돌려보내므로 본문은 Chrome으로 읽었습니다. 타사 테크블로그 색인과 홈 소개에 티맵 링크를 추가했고, Hugo 0.164.0 빌드와 내비게이션 검사를 통과했습니다.

## 2026-11-08 — 타사 테크블로그에 쏘카 추가

- 쏘카 기술 블로그(tech.socar.kr) 72편 가운데 인프라·플랫폼·데이터 파이프라인·운영에 해당하는 20편을 골라 `content/external/socar/blog/`에 한 편씩 요약했습니다. 형식은 당근 블로그 요약과 같고, 목록은 게시일 최신순입니다.
- 차량 관제 장치와 서버, 스마트폰이 이어지는 구조를 관련 글 일곱 편에서 추려 다시 그린 진단 문서를 `content/external/socar/device-connectivity.md`로 두었습니다. 원문이 밝히지 않은 항목은 추정 없이 따로 모았습니다.
- 타사 테크블로그 색인과 홈 소개에 쏘카 링크를 추가했습니다. Hugo 0.164.0 빌드와 내비게이션 검사를 통과했습니다.

## 2026-11-08 — 스터디 Istio 전편을 도식 중심으로 개편

- 「한 요청의 여행」 소개와 01~05편을 핵심 그림 → 짧은 해설 → 필요한 조건 순으로 다시 썼습니다. 도식은 10개에서 23개로 늘리고, 큰 근거표·반복 설명·세부 설정 예제를 줄였습니다. 접힌 근거표와 도식을 제외한 화면 본문은 각 편이 기존의 약 21~38%입니다. 그림의 라벨·캡션을 포함한 원고 텍스트도 모든 페이지에서 절반 이하입니다.
- 첫 그림을 바로 볼 수 있도록 이 시리즈의 상단 인라인 목차를 껐습니다. 공개 URL·이전 주소 리다이렉트·본문 앵커는 유지하고, mTLS 강제 조건·재시도 범위·로그와 트레이스의 활성화 조건을 남겼습니다. 기준은 Istio 1.31.4·Envoy 1.39 계열의 사이드카 모드입니다.
- 검증 기록과 개편 전 원고는 `_workspace/istio-visual-2026-11-08/`에 있습니다. Hugo 0.166.0 빌드, 내비게이션 검사, 도식 23개 검사와 기존 테스트 17개를 통과했습니다. 1440px·390px 화면에서 첫 그림 노출·가로 넘침·확대/닫기를 확인하고, 시각 검토에서 발견한 05편의 라벨 겹침도 수정했습니다. 저장소 전체 도식 실행기는 기존 숨김 상태 JSON을 도식으로 오인해 실패했으며, 실제 `_flow`·`_seq` 파일 294개를 선별한 검사에서는 오류가 없었습니다.

## 2026-11-07 — Istio 기존 글 7편 최소 교체

- 한 요청의 여행 조사 중 찾은, Istio 1.31.4·Envoy 1.39 기준과 어긋나는 서술 9건을 문장 단위로 고쳤습니다. 11편의 앱 전달 주소(localhost → 파드 IP, 도식 두 장 포함)와 HTTP 해석 리스너, 11·13편의 "mTLS가 없으면 TCP 라벨이 빈다" 단정, 13편의 HTTP 메타데이터 교환 필터 이름, ambient 01의 15006/15008 분기 기준(source → destination port), cilium 05의 ztunnel L7 정책 동작, cilium 04의 기본 503 재시도 여부, operations 05의 NR·URX 정의, operations 06의 액세스 로그 기본값·gRPC 메시지 메트릭·`connection_security_policy` 조건입니다. 근거는 `_workspace/series-2026-11-07-istio-traffic/research/`에 있습니다.

## 2026-11-07 — 스터디 대분류 신설, 한 요청의 여행 시리즈 이동

- 최상위 대분류 「스터디」(`content/study/`)를 새로 만들고, 같은 날 Istio 하위에 올렸던 5부작을 `content/study/istio-mesh/`(`/study/istio-mesh/…`)로 옮겼습니다. 이전 주소 `/istio/mesh-traffic/…`는 `aliases`로 남겨 새 주소로 넘어갑니다. 내비게이션 검사기의 루트 섹션 목록과 테스트에 `/study/`를 더했습니다.
- 저자가 제목이 너무 사실적이라고 해서 시리즈 이름을 「한 요청의 여행」으로, 다섯 편 제목을 비유를 앞세우고 다루는 구간을 뒤에 붙인 꼴로 바꿨습니다. 예: 「02 문지기는 봉투를 열고 다시 봉인한다 — 게이트웨이에서 사이드카까지」. 본문은 바꾸지 않았습니다.
- 이어서 본문 소제목 38개도 Astra(`gpt-6-astra`, xhigh, `--sandbox read-only`)에 다섯 편을 한 번에 넘겨 같은 결로 바꿨습니다(예: 「Service 이름은 수신인, 파드 IP는 배달 주소」). 기존 앵커는 `{#id}`로 유지했습니다. 실행 기록은 `_workspace/structure-2026-11-07-istio-traffic/headings/`에 있습니다.
- 저자가 편지·우편 비유와 「A는 B」식 대응이 별로라고 해서 Astra로 한 번 더 돌렸습니다. 02·04편 제목을 「02 문을 지나 다시 길을 고른다」, 「04 요청을 읽는 곳에서 길은 달라진다」로 바꾸고 소제목은 장면을 그리는 문장으로 고쳤습니다(`headings2/`).
- 저자가 완성형 문장 대신 명사구로 끝맺는 꼴을 골라 다섯 편 제목과 소제목을 다시 지었습니다(예: 「02 다시 길을 고르는 문」, 「443에서 TLS를 푸는 Envoy」, `headings3/`). 이 꼴은 wwe 1.8.2의 기본 규칙으로 넣었습니다.

## 2026-11-07 — Istio 메시 통신 경로 5부작 추가

- Istio 분류에 하위 섹션 「메시 통신 경로」(`/istio/mesh-traffic/`, 같은 날 스터디로 이동)를 새로 만들고 다섯 편을 더했습니다. 그동안 요청 경로·게이트웨이·Envoy 기능·관측성 글에 흩어져 있던 이야기를 요청 하나의 경로로 다시 엮었습니다. 01 메시 이전의 L4·L7 통신, 02 Ingress Gateway에서 사이드카까지, 03 사이드카 사이의 통신 방식, 04 L7 프록시라서 생기는 기능, 05 메트릭·로그·트레이스 순서이며, 기준은 사이드카 모드이고 ambient는 편마다 대조로만 다룹니다. 기준 버전은 Istio 1.31.4(2026-11-06), Envoy 1.39 계열입니다. 상위 Istio 색인의 찾기 목록과 읽는 순서에 연결했습니다.
- opus 조사·초안 다섯 건을 병렬로 받고(`_workspace/series-2026-11-07-istio-traffic/`), Astra(`gpt-6-astra`, xhigh, `--sandbox read-only`)가 제목과 절 구성까지 전면 재작성했습니다. 결정적 대조와 sonnet 검증자 세 명의 지적 가운데 정보성 항목을 뺀 것을 보정 라운드 1회로 반영했습니다. 실행 기록은 `_workspace/structure-2026-11-07-istio-traffic/`에 있습니다. 조사 중 기존 글(11·13편, ambient 01, cilium 04·05, operations 05·06)에서 현재 버전과 어긋나는 서술을 찾아 조사 노트에 적었고, 기존 글은 이번에 고치지 않았습니다.

## 2026-11-01 — Cortex vs Thanos 비교 글 추가

- 메트릭 분류에 「Cortex vs Thanos 비교와 선택」(`/monitoring/cortex-vs-thanos/`)을 더했습니다. 저자가 정한 순서대로 두 솔루션을 아키텍처 도식과 함께 먼저 소개하고, 쓰기 모델·컴포넌트 대응표·외부 의존성, 한눈 비교표와 장단점 표, 공개 성능 수치, 보존·다운샘플링, 운영과 프로젝트 활동, 선택 조건을 차례로 비교합니다. 기준 버전은 Thanos v0.42.5, Cortex v1.21.1입니다. 메트릭 색인의 찾기 목록과 소개 목록에 연결했습니다.
- architect 조사 → executor 초안 → wwe 보존 윤문(`_workspace/docs-2026-11-01-071/`) → Astra(`gpt-6-astra`, xhigh, `--sandbox read-only`) 전면 재작성 → 결정적 대조와 sonnet 검증자 지적 4건(빠진 평가 내용·도입 사례·promql-engine 한정 문장, 권고로 바뀐 문장)과 문장 6건 보정 1회 순으로 만들었습니다. 실행 기록은 `_workspace/structure-2026-11-01-cortex-thanos/`에 있습니다.

## 2026-11-01 — Cortex·Mimir·VictoriaMetrics 비교 글 추가

- 메트릭 분류에 「Cortex vs VictoriaMetrics 비교와 선택」(`/monitoring/cortex-vs-victoriametrics/`)을 더했습니다. Prometheus 뒤에 붙이는 Cortex(v1.21.1), Grafana Mimir(3.2.4), VictoriaMetrics cluster(v1.155.0)를 저장과 복제, 테넌트 경계, 메모리, 쿼리 호환, 증설과 장애, OSS·Enterprise 경계, 프로젝트 활동으로 나눠 비교합니다. 세 제품의 쓰기·조회 경로를 같은 배치의 flow 세 장으로 그렸고, 메트릭 색인의 찾기 목록과 소개 목록에 연결했습니다.
- architect 조사 보고서를 바탕으로 executor가 초안을 쓰고, Astra(`gpt-6-astra`, xhigh, `--sandbox read-only`)가 제목과 절 구성까지 전면 재작성했습니다. 결정적 대조와 sonnet 검증자의 지적 6건(헤딩 어투, 벤더 주장을 측정으로 쓴 문장, 본문에서 빠진 미확인 단서, 원본에 없던 일반론)을 보정 라운드 1회로 반영했습니다. 실행 기록은 `_workspace/structure-2026-11-01-cortex-mimir-vm/`에 있습니다.
- 같은 날 저자 검토에서 제목에 Cortex가 없고, 장단점과 벤치마크 지표가 눈에 띄지 않으며, 글이 길다는 지적을 받았습니다. 그래서 제목에 세 제품 이름을 넣고, 한눈 비교표·장단점 표·공개 벤치마크 표와 Thanos와 견준 보존(retention) 설정 표를 앞세워 464줄을 220줄로 줄였습니다. 보존 설정 값은 Thanos·Cortex·Mimir·VictoriaMetrics 공식 문서에서 다시 확인했습니다.
- 이어서 제목을 「Cortex vs VictoriaMetrics 비교와 선택」으로 바꿨습니다(URL 유지). 벤치마크 절에는 2022년 Mimir 2.2·VictoriaMetrics 1.80 기준임을 밝히고, 2022년 이후 제품별 개선 표를 더했습니다. Mimir 2.7~3.0, VictoriaMetrics v1.82~v1.133, Cortex 1.15~1.21의 릴리스 노트와 벤더 블로그에서 공개 수치를 모았고, Cortex는 공식 수치가 없다고 적었습니다. Cortex와 VictoriaMetrics를 직접 잰 유일한 공개 수치인 adidas 측정(PromCon EU 2019, DynamoDB 청크 저장 시절 Cortex)도 조건과 함께 표에 넣었습니다.
- 공개 URL도 `/monitoring/cortex-vs-victoriametrics/`로 바꾸고 page bundle을 `content/observability/metrics/cortex-vs-victoriametrics/`로 옮겼습니다. 이전 주소 `/monitoring/cortex-mimir-vs-victoriametrics/`는 `aliases`로 남겨 새 주소로 넘어갑니다.

## 2026-11-01 — SRE 01~05편 Astra 전면 재작성

- 저자가 SRE 섹션 다섯 편을 읽고 "너무 AI스럽다"고 해서 01~05편 전부를 Astra(`gpt-6-astra`, xhigh, `--sandbox read-only`)로 제목·절 구성·문단·문장·단어까지 다시 썼습니다. 지시문에 균일한 문장 길이와 종결, 같은 골격의 절, 자리를 채우는 문장, 출처 목차 순서의 나열, 방어적 조건문, 용어마다 붙는 괄호 풀이, 불릿 쪼개기를 없앨 대상으로 적었습니다. 새 제목은 「01 SRE는 운영 문제를 어떻게 엔지니어링으로 푸는가」, 「02 AI가 장애를 해결할 때 SRE는 어디서 경험을 쌓나」, 「03 USE Method로 느린 서비스의 자원 병목 좁히기」, 「04 RED Method로 요청량·실패·지연을 함께 읽는 기준」, 「05 Four Golden Signals로 사용자 영향과 한계 읽기」이며 공개 URL과 색인 링크는 유지했습니다.
- 편마다 1차 출처(영어 위키백과, Google SRE Book·Workbook 해당 장, SigNoz 원문과 GeekNews·HN 기록, Brendan Gregg USE 문서, Grafana RED 글, Prometheus 히스토그램 문서)를 프롬프트에 넣었고, 결정적 대조(frontmatter·URL·shortcode·relref·코드펜스·수치)와 sonnet 검증자 5명의 출처 대조에서 나온 지적 64건(귀속 오류, 빠진 조건과 헤지, 출처에 없는 해석 문장, 답글 관계 오류 등)을 보정 라운드 1회로 반영했습니다. 01편에는 Astra가 SRE Book의 운영 업무 50% 상한과 2020년 설문 수치를 새로 넣었는데 출처와 일치해 귀속을 붙여 남겼습니다. 실행 기록은 `_workspace/structure-2026-11-01-sre-series/`에 있습니다.

## 2026-11-01 — USE·RED·Four Golden Signals 글 추가

- SRE 03~05편을 추가했습니다. Brendan Gregg의 USE Method, Tom Wilkie의 RED Method, Google SRE Book의 Four Golden Signals를 각각 원문과 공식 계측 문서를 바탕으로 설명합니다. 자원별 점검, 요청을 세는 범위, 지연 분포와 실패 기준, 포화도의 해석을 다루며 세 글을 서로 연결했습니다.
- 자원 조사 흐름과 가상의 주문 요청 경로를 flow로, 내부 호출 재시도를 seq로 그렸습니다. RED 편에는 가정한 메트릭의 PromQL 예제와 결측 시계열·무트래픽·히스토그램 집계 조건을 함께 적었습니다. SRE 색인에 세 글을 연결했습니다.

## 2026-11-01 — SRE 두 편의 구성 개편과 도식 추가

- 01편을 「SRE는 신뢰성을 어떻게 만드는가」로 바꾸고, 신뢰성 목표·운영과 개선·토일·팀 구성 순서로 다시 썼습니다. Google SRE 자료를 바탕으로 SLI·SLO·오류 예산을 풀어 설명하고 색인의 제목과 소개를 맞췄습니다. 공개 URL은 유지했습니다.
- 02편은 댓글을 따라가던 구성을 숙련 저하의 우려·근거의 한계·반론·실무 대응으로 묶었습니다. FAA의 수동 비행 권고와 의무 규정을 구분하고, 의료 분야의 관찰연구를 SRE의 숙련 저하에 대한 직접 증거로 읽지 않도록 보완했습니다.
- 기존 flow 템플릿으로 신뢰성 개선 과정과 비운영 환경의 장애 대응 훈련을 한 장씩 추가했습니다. 훈련 도식은 토론의 제안을 재구성한 예시임을 본문과 캡션에 밝혔습니다.

## 2026-11-01 — AI 디스킬링 논쟁 요약, SRE 02편

- SRE 섹션에 「02 AI가 바꾸는 SRE의 일과 숙련」(`/sre/02-ai-deskilling-sres/`)을 더했습니다. GeekNews 토픽 [AI는 SRE를 대체하는 게 아니라 숙련도를 떨어뜨리고 있음](https://news.hada.io/topic?id=36299)(2026-10-31)의 원문인 SigNoz 뉴스레터 [AI Isn't Replacing SREs. It's Deskilling Them.](https://newsletter.signoz.io/p/ai-isnt-replacing-sres-its-deskilling)(2026-02-28)과 GeekNews 댓글, [Hacker News 스레드](https://news.ycombinator.com/item?id=50305693)(646점, 댓글 464개)를 함께 읽고, 원문의 주장(Bainbridge 1983의 자동화의 역설, 디스킬링·네버스킬링, 의도적 비효율)과 토론의 반론(항공 비유의 비용과 규제, Terraform·Docker가 이미 한 디스킬링, 이해의 깊이, 새 역량, SRE·DevOps 직무 비판)을 쟁점별로 묶었습니다. 댓글 작성자 닉네임은 싣지 않았습니다. SRE 색인의 찾기 목록과 요약 표에 링크를 더했습니다.
- 원문은 Substack API로, HN 스레드는 Algolia API로 받았고, GeekNews 페이지는 curl이 403이라 WebFetch로 본문·댓글을 문장 단위로 기록해 출처로 썼습니다. executor 초안(52KB)을 Astra(`gpt-6-astra`, xhigh, `--sandbox read-only`)가 제목·절 구성까지 전면 재작성했고, 결정적 대조와 sonnet 검증자의 출처 대조 지적 24건(귀속 오류 1건, 빠진 주장 복원, 출처에 없는 용어 풀이 삭제, 이 사이트의 해석 문장 삭제 등)을 보정 라운드 1회로 반영했습니다. 실행 기록은 `_workspace/structure-2026-11-01-sre-deskilling/`에 있습니다.

## 2026-11-01 — SRE 섹션 신설과 위키백과 요약 01편

- `content/engineering/sre/`를 새로 만들었습니다(공개 URL `/sre/`). 첫 글 「01 SRE가 신뢰성을 책임지는 방식」(`/sre/01-what-is-sre/`)은 영어 위키백과 [Site reliability engineering](https://en.wikipedia.org/wiki/Site_reliability_engineering) 항목(2026-10-04 판)을 요약한 글로, SRE가 DevOps의 구체적 구현이라는 위치와 운영팀 이름만 바꾼 사례, 책임 범위, 실천 4개와 원칙 8개, 팀 배치 모델 5종과 도구·하이브리드 구성, Google에서 시작된 역사와 2020년 설문, 더 읽을 자료를 담습니다. 항목에 없는 내용은 보태지 않았습니다. 설계·개발 색인과 첫 화면 주제 표, README 구조에 SRE를 더했습니다.
- executor 초안을 Astra(`gpt-6-astra`, xhigh, `--sandbox read-only`)가 제목·절 구성까지 전면 재작성했고, 결정적 대조(frontmatter·URL·수치·고유명사·책 7권·외부 링크 4개)와 sonnet 검증자의 원문 대조에서 나온 지적 10건(SLI·SLO 풀이 범위, Embedded 인원 표현, 용량 계획과 변경 관리 분리, Tools를 팀 모델 표에서 도구 문단으로 분리 등)을 보정 라운드 1회로 반영했습니다. 실행 기록은 `_workspace/structure-2026-11-01-sre/`에 있습니다.

## 2026-10-31 — Keycloak 로그인 화면 글과 테마 시안

- 홈랩 09편 `content/platform/homelab/09-keycloak-login-theme/`을 추가했습니다(공개 URL `/homelab/09-keycloak-login-theme/`). 개인 Gmail로 Google IdP를 붙인 방법, 이메일이 같은 기존 계정에만 연결하는 first broker flow, 로그인 화면 시안 53장, 실제로 적용한 HUD 다크 테마의 구조와 걸린 문제를 다룹니다. 홈랩 색인의 찾기 목록과 요약 표에 링크를 더했습니다.
- 시안 스크린샷 53장과 적용 화면 3장은 `assets/images/keycloak-theme/`에 있습니다. 헤드리스 Chromium으로 찍었고, 공개용으로 계정 이름과 서비스 주소를 바꿨습니다. 테마 파일 세 개(`theme.properties`, `login.ftl`, `template.ftl`)는 글 번들의 `makgol-hud/login/`에 원본 그대로 두고 본문에도 전문을 실었습니다.

## 2026-10-29 — 서브에이전트를 메인 루프로 접는 글 요약과 제안

- Anthropic의 [Building agents: When to fold subagents into your main agent loop](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop)(Diane Sarkis, 2026-10-22)를 요약한 AI 도구 06편을 추가했습니다. 공개 URL은 `/ai-tools/06-fold-subagents/`이며 AI 도구 색인에서 연결합니다. 서브에이전트를 남길 세 조건, 조직도를 닮은 멀티 에이전트 구성의 실패 양상, 점진적 공개를 쓰는 단일 루프, 평가로 하나씩 접는 절차와 Claude API 스킬 네 가지를 정리했습니다.
- 마지막 절은 원문이 아니라 이 사이트의 제안입니다. 역할별 서브에이전트 여럿 대신 큰 메인 에이전트 하나(Large Ultra 에이전트)를 관리 대상으로 삼고, 서브에이전트는 세 조건에 맞을 때만 남기자는 방향이며 측정 결과가 아니라는 점과 비용 영향을 확인하지 못했다는 점을 밝혔습니다.
- 오케스트레이터 구성과 단일 루프를 같은 배치로 비교하는 flow 도식 두 장을 새로 그렸습니다(spec-lint 오류 0). Claude 초안을 Astra(`gpt-6-astra`, xhigh, read-only)가 제목·절 구성까지 전면 재작성했고, 원문 대조에서 빠진 논지 네 곳을 보정 라운드로 채웠습니다. 실행 기록은 `_workspace/structure-2026-10-29-fold-subagents/`에 있습니다.

## 2026-10-27 — 하네스 엔지니어링 글 요약

- Lilian Weng의 [Harness Engineering for Self-Improvement](https://lilianweng.github.io/posts/2026-07-04-harness/)를 요약한 AI 도구 05편을 추가했습니다. 공개 URL은 `/ai-tools/05-harness-engineering/`이며 AI 도구 색인에서 연결합니다.
- 실행 결과가 다음 입력으로 이어지는 구조와 하네스 자체를 개선하는 과정을 flow 도식 두 장으로 그렸습니다. 연구별 개선 대상을 비교하고, 가중치를 고정한 실험과 공동 갱신의 초기 연구, 저자의 전망을 구분했습니다.
- 같은 날 WWE 구조 편집 지침에 따라 Astra(`gpt-6-astra`, high)가 본문을 전면 재작성했습니다. 코드 수정과 테스트에서 시작해 기억·컨텍스트, 하네스 개선, 평가의 한계로 설명을 이어 가고, 연구 비교표와 압축된 불릿을 문단으로 풀었습니다. 별도 문장·의미 검토를 거쳤고, 출처·도식·공개 URL과 기존 소제목 앵커 5개를 보존했습니다. 실행 기록은 `_workspace/structure-2026-10-27-harness-wwe/`에 있습니다.

## 2026-10-26 — 네트워크 L4·L7 스터디 자료를 요약본과 전체본으로 나누고 도식 8장 추가

- 저자가 "너무 길고 그림이 부족하다"고 해서 `content/platform/kubernetes/network-l4-l7/`을 branch bundle로 바꿨습니다. 공개 URL `/kubernetes/network-l4-l7/`에는 도식 중심 요약본(`_index.md`)을 두고, 기존 전체본은 `detail/index.md`(공개 URL `/kubernetes/network-l4-l7/detail/`, 제목 "네트워크 L4·L7 스터디의 근거와 세부 설명")로 옮겼습니다. 문단 산문은 전체본의 약 1/4, 표·근거 블록을 포함한 파일 전체는 약 38%입니다.
- 요약본 도식 8장: 새로 그린 전체 경로·백엔드 선택 시점 flow, kube-proxy 모드 일정·메시 P50 지연 lane, gRPC 쏠림 seq와, Cilium 비교 01편·3-1편에서 복사한 세 가지 배치·L4/L7 경계 flow, 503 세 조건 seq입니다. spec-lint·lane_smoke 오류 0.
- 요약본은 Astra(gpt-6-astra xhigh)가 전체본과 도식 목록을 받아 썼고, 근거 행·URL·relref·코드·shortcode가 전체본이나 도식 목록에서 왔는지 결정적으로 대조했습니다. 실행 기록은 `_workspace/structure-2026-10-26-k8s-net-diet/`에 있습니다.

## 2026-10-26 — 쿠버네티스 네트워크 L4·L7 30분 스터디 자료

- `content/platform/kubernetes/network-l4-l7/`을 새로 만들었습니다(공개 URL `/kubernetes/network-l4-l7/`). 파드 A의 `curl http://svc-b` 한 번을 따라가며 CNI·kube-proxy·Cilium eBPF의 L4 경로, 연결 단위 분산으로 풀리지 않는 문제, 사이드카·ambient의 L7 프록시와 그 비용, waypoint 503 장애, 프록시 배치 기준을 이어 설명합니다. 시간 배분 표, 데모 명령 표, 슬라이드로 옮길 기존 글의 도식 목록과 발표 전 점검 항목이 함께 들어 있습니다. Kubernetes 색인의 찾기 목록에 링크를 더했습니다.
- L4 쪽은 2026-10-26 조사(Kubernetes 1.37.1, Cilium 1.20.4, Istio 1.31.3, VPC CNI v1.23.2)를, L7 쪽은 저장소의 Istio·Cilium 글 8편을 근거로 삼았습니다. kube-proxy IPVS 모드 deprecated(1.35)와 nftables 기본값 전환 예정(1.40, KEP-5343), Cilium Kafka L7 정책 제거(1.20)를 반영했습니다. 기존 Cilium 비교 글의 버전 표기(1.20.3·1.31.2)는 한 단계 이전 판이라는 점을 근거 표에 적었습니다.
- executor 초안을 Astra(gpt-6-astra xhigh, read-only)가 제목·절 구성까지 다시 쓰고, 결정적 대조(FATAL 0)와 의미 검수 지적 6건·문장 12건을 보정 라운드로 반영했습니다. 실행 기록은 `_workspace/structure-2026-10-26-k8s-net-study/`에 있습니다.

## 2026-10-26 — 전체 문서 WWE 가독성 진단

- 게시글·색인·안내 문서 354개를 WWE로 진단하고 53개 문서의 문장을 다듬었습니다. 역할을 흐리는 비유, 어색한 주어·서술어 연결, 반복되는 문서 소개를 고쳤으며 제목·문단 구조·코드·표·링크·수치·직접 인용은 보존했습니다.
- [진단 보고서](docs/changes/2026-10-26-all-posts-wwe-review.md)와 [전체 문서별 결과](docs/changes/2026-10-26-all-posts-wwe-audit.csv)를 남겼습니다. Hugo 0.166.0 빌드, 내비게이션 검사, 도구 테스트 17개를 통과했습니다.

## 2026-10-26 — promkr 뉴스레터 2026년 소식 요약

- `content/external/promkr/`를 새로 만들었습니다. 섹션 색인(`_index.md`)과 `2026.md` 한 편으로, promkr Substack 뉴스레터 2026년 1~10월호 10편을 월별로 정리하고 열 달 동안 반복된 주제(AI·에이전트, Prometheus 호환 저장소, OpenTelemetry, 비용, 프로파일링·eBPF)를 묶었습니다. 항목 73개의 원문 링크는 모두 뉴스레터 본문에 있는 URL과 대조했습니다.
- 타사 테크블로그 색인의 찾기 목록에 링크를 더하고, 설명 문장이 외부 뉴스레터도 포함하도록 고쳤습니다.
- 같은 날 `2026.md`를 branch bundle `2026/`로 바꿔 호마다 문서 한 편(`01.md`~`10.md`, 공개 URL `/external/promkr/2026/01/`~`/10/`)으로 나눴습니다. `2026/_index.md`는 URL `/external/promkr/2026/`을 그대로 쓰고, 올해 흐름과 호별 찾기 목록만 남겼습니다.
- 2025년 1~12월호 12편도 같은 형식으로 `content/external/promkr/2025/`(색인과 `01.md`~`12.md`)에 더했습니다. 11월호와 12월호는 PromCon EU 2025 발표 정리본이라 발표 하나를 항목 하나로 셌습니다. 링크와 백분율 수치는 모두 뉴스레터 본문과 대조했습니다.
- 같은 날 호별 문서 22편(2025년 1월호~2026년 10월호)을 링크 한 줄 요약에서 원문 요약으로 바꿨습니다. 링크 192개의 원문을 curl·GitHub API·카카오 테크 API로 병렬 수집하고, Cloudflare에 막힌 5개는 Chrome으로 받았습니다. 받지 못한 2개(krusty.space, ericmustin Substack)는 그 사실을 밝히고 뉴스레터 소개만 남겼습니다. 집필은 호마다 Astra(gpt-6-astra high, read-only) 1콜이고, URL·front matter·절 수·숫자 토큰을 결정적으로 대조한 뒤(FATAL 0) 표본 3편 사실 대조에서 나온 경미한 지적 7건을 고쳤습니다. 실행 기록은 `_workspace/promkr-deep-2026-10-26/`에 있습니다.
- 이어서 나머지 19편도 sonnet verifier 6명이 원문과 절마다 대조했습니다. 지적 31건(사실 오류 5건 포함)을 최소 교체로 고쳤습니다. 2025년 9월호 ClickHouse 실험 절은 Astra 입력이 원문 앞 45,000자로 잘려 결과가 빠져 있었고, 전문 대조로 비교 결과와 실험 한계를 보충했습니다.
- 검수 제안 그대로 끼워 넣은 문장 31개는 Astra 보정 라운드(13개 호, 해당 문단만 수정 허용)로 앞뒤 흐름에 맞게 다시 다듬었습니다. 허용 밖 줄을 바꾼 1곳(2025년 1월호)은 원래대로 되돌렸습니다. 실행 기록은 `_workspace/promkr-deep-2026-10-26/corr/`에 있습니다.

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
