---
title: "05 kagent — 파드로 도는 에이전트와 2026-10 점검"
date: 2026-10-05
lastmod: 2026-10-05
weight: 5
url: "/homelab/05-kagent/"
---

# kagent — 에이전트는 파드, 도구는 MCP, 모델은 ModelConfig 하나

hub 클러스터에는 2026년 3월부터 kagent가 올라가 있습니다. Kubernetes 위에서 AI 에이전트를 CR로 선언해 실행하는 프레임워크입니다. 2026-10-05에 점검해 보니 에이전트 16개가 모두 Ready였지만, 파드가 뜬 뒤 7일 남짓 동안 에이전트가 실행된 기록은 1건이었습니다. 이 글에는 kagent가 무엇으로 이루어졌는지, 질문 하나가 어떤 경로로 모델까지 가는지, 운영하면서 겪은 문제와 이번 점검에서 정한 것을 적습니다.

실제 도메인과 IP, 저장소 식별자는 `example.com` 같은 가상 값으로 바꿨고, API 키와 토큰 값은 싣지 않았습니다. 클러스터 배치는 [hub / edge 구조]({{< relref "/platform/homelab/01-hub-edge-architecture/index.md" >}})에, MCP와 A2A라는 용어의 뜻은 [에이전트 개념 정리]({{< relref "/engineering/ai-tools/03-agent-concepts/01-concepts/index.md" >}})에 있습니다.

## 구성 요소

kagent는 차트 둘(`kagent-crds`, `kagent`)로 설치합니다. 아래 표의 오른쪽 칸은 2026-10-05에 hub에서 조회한 값입니다.

| 구성 요소 | 하는 일 | hub에서 본 모습 |
|---|---|---|
| controller | Agent·ModelConfig·MCP 서버 CR을 읽어 Deployment와 설정을 만들고, HTTP API로 UI의 요청과 에이전트 호출(A2A)을 받는다 | 파드 1개, 8083 |
| UI | Next.js 화면. 브라우저의 `/api` 요청을 controller로 넘긴다 | 파드 1개, 8080 |
| Agent CR | 에이전트 하나의 선언. 시스템 프롬프트, 참조할 ModelConfig, 쓸 tool 이름 목록 | 16개, CR마다 Deployment와 Service 하나 |
| ModelConfig CR | 공급자, 모델 이름, API 키가 든 Secret, 엔드포인트 | 1개 |
| tool server (`kagent-tools`) | kubectl·helm·istioctl 같은 명령을 MCP tool로 제공하는 서버 | 파드 1개, 8084, tool 126개 |
| MCPServer CR과 kmcp | MCP 서버를 CR로 선언하면 kmcp controller가 Deployment로 띄운다 | 4개 |
| RemoteMCPServer CR | 이미 HTTP로 떠 있는 MCP 서버의 주소를 등록한다 | 2개(tool server, Grafana MCP) |
| 번들 Postgres | controller의 저장소. 세션이 여기에 저장된다 | 파드 1개, PVC 500Mi |

에이전트는 controller 안에서 돌지 않습니다. Agent CR 하나마다 파드 하나가 뜹니다. `k8s-agent`의 Deployment를 보면 소유자가 Agent CR이고, 컨테이너는 Go로 작성된 에이전트 런타임 이미지(`golang-adk`) 하나입니다. controller가 만든 설정이 Secret으로 `/config`에 마운트되고, ModelConfig가 가리키는 Secret의 API 키가 env로 들어가며, controller 주소가 `KAGENT_URL`로 주어집니다. 16개 모두 런타임이 `go`입니다.

MCP 서버를 연결하는 방법은 셋입니다.

- **stdio MCPServer.** 표준 입출력으로만 통신하는 MCP 서버를 그대로 쓸 때입니다. kmcp가 파드에 init container를 넣어 agentgateway 바이너리를 공유 볼륨에 복사하고, 메인 컨테이너는 MCP 서버 이미지 안에서 그 agentgateway를 실행합니다. agentgateway가 stdio 서버를 HTTP(3000)로 바꿔 줍니다.
- **http MCPServer.** 서버가 Streamable HTTP를 직접 지원하면 변환기 없이 띄웁니다.
- **RemoteMCPServer.** 이미 HTTP로 떠 있는 서버는 URL만 등록합니다. hub에서는 차트가 띄운 둘이 이렇게 등록돼 있고, controller가 그 서버의 tool 목록을 조회해 CR의 status에 적어 둡니다.

## 질문 하나가 지나는 길

모델 호출이 어디에서 나가는지부터 그림으로 봅니다.

{{< flow src="_flow/2-1-모델-호출은-에이전트-파드에서-나간다.json" />}}

브라우저의 요청은 인그레스 게이트웨이를 지나 UI에 도달하고, UI는 `/api` 경로를 controller의 8083으로 넘깁니다. controller는 `/api/a2a/<네임스페이스>/<에이전트>`로 들어온 메시지를 해당 에이전트의 파드로 전달합니다. 모델은 그 파드가 호출합니다. 이 때문에 API 키가 controller가 아니라 에이전트 파드의 env에 있습니다. 키가 저장되는 범위도 controller 하나가 아니라 같은 ModelConfig를 참조하는 에이전트 파드 전체가 됩니다. env는 k8s-agent에서 확인했습니다.

에이전트 파드 안에서는 모델과 tool을 번갈아 호출하는 과정이 반복됩니다.

{{< seq src="_seq/2-2-모델과-tool-사이의-반복.json" />}}

요청은 OpenAI chat completions 형식입니다. 에이전트는 대화 이력과 함께 자신이 쓸 수 있는 tool의 이름·설명·인자 스키마를 매번 보냅니다. 모델은 tool을 실행하지 않고 "이 tool을 이 인자로 불러 달라"는 응답만 돌려주며, 실제 호출은 에이전트 파드가 MCP 서버로 보냅니다. tool server라면 그 안에서 kubectl이 실행되고 결과 텍스트가 돌아옵니다. 에이전트는 그 결과를 이력에 추가해 모델을 다시 호출합니다.

이 구조에서 생기는 비용은 두 가지입니다. tool 정의가 호출마다 입력에 포함되므로 tool을 많이 가진 에이전트는 질문이 짧아도 입력 토큰이 많습니다. 또 질문 하나에도 모델을 여러 번 호출하게 됩니다. 세션과 작업 기록은 에이전트가 controller API를 거쳐 Postgres에 남깁니다.

위 순서는 kagent v0.10.3 소스와 hub의 Deployment 설정을 읽고 파악했습니다. 실제 요청 하나를 trace로 따라가 보지는 못했습니다.

## hub에 올린 구성

Argo CD Application 셋이 sync-wave 순서대로 구성을 배포합니다. 0번 `kagent-crds`는 CRD 차트, 1번 `kagent`는 본체 차트와 values, 2번 `kagent-manifests`는 GitOps 저장소의 매니페스트 디렉터리를 사용합니다. 이 디렉터리에는 직접 만든 Agent·MCPServer·VirtualService가 들어 있습니다. 셋 다 자동 sync에 prune과 selfHeal을 켰습니다. 2026-10-05 기준으로 셋 모두 Synced/Healthy이고 차트는 0.10.2, 네임스페이스의 파드는 26개입니다.

에이전트 16개 가운데 10개는 차트가 서브차트로 넣어 주는 번들입니다.

| 번들 에이전트 | 붙은 tool |
|---|---|
| k8s-agent, helm-agent, istio-agent | tool server의 `k8s_*`·`helm_*`·`istio_*` (각각 18·9·20개) |
| observability-agent | Grafana MCP 34개 지정(그중 4개는 서버의 tool 목록에 없다), tool server 2개, promql-agent를 tool로 호출 |
| promql-agent | 없음 |
| cilium 3종, kgateway-agent, argo-rollouts-conversion-agent | tool server의 `cilium_*`·`argo_*` 등 |

나머지 6개는 직접 만들어 매니페스트로 관리합니다.

| 직접 만든 에이전트 | 붙인 tool |
|---|---|
| argocd-agent | tool server의 `k8s_*` 12개(apply·patch·exec 포함) |
| victoria-metrics-agent | VictoriaMetrics MCP 8개, tool server 5개 |
| github-agent | GitHub MCP 21개 |
| openclaw-agent | tool server 6개, fetch 1개 |
| db-agent | Postgres MCP의 `query` |
| k8sagent | tool server 4개. 3월에 kubectl로 만든 것을 9월에 git으로 옮겼다 |

MCP 서버는 여섯입니다. tool server와 Grafana MCP는 차트가 띄우고 RemoteMCPServer로 등록됩니다. Grafana MCP는 토큰 없이 Grafana의 익명 Viewer 권한으로 읽기만 합니다. 나머지 넷은 MCPServer CR입니다. GitHub·fetch·Postgres MCP는 stdio라 변환기를 거치고, VictoriaMetrics MCP는 http transport로 vmselect를 직접 읽습니다. tool server가 제공하는 tool 126개는 cilium 58, k8s 23, istio 13, kubescape 10, argo 8, helm 6, prometheus 5, 그 밖 3개(shell 포함)입니다.

## 모델 연결

### OpenAI 호환 provider로 다른 공급자를 가리킨다

ModelConfig는 하나입니다. provider는 `OpenAI`인데 `spec.openAI.baseUrl`이 OpenAI가 아닌 z.ai의 OpenAI 호환 엔드포인트를 가리키고, 모델은 `glm-4.7`, 형식은 `chatCompletions`입니다. kagent는 OpenAI로 취급하지만 실제로 답하는 곳은 다른 공급자입니다. 엔드포인트만 맞으면 어느 공급자든 같은 방식으로 연결할 수 있습니다.

에이전트 16개가 모두 이 ModelConfig 하나를 참조합니다. 공급자에 장애가 나거나 잔액이 소진되면 전부 멈춥니다. 9월 28일의 점검 메모에는 잔액이 0이라 응답하지 못한다고 적혀 있었고, 이번에는 잔액을 확인하지 못했습니다. 점검을 마친 뒤 이 공급자의 키는 더 쓰지 않고 폐기하기로 했습니다.

### baseUrl은 차트가 읽지 않는 키였다

values에는 `providers.openAI.baseUrl`이 적혀 있었습니다. 하지만 차트는 `providers.<공급자>.config` 아래만 ModelConfig의 `spec.<공급자>`로 렌더합니다. 이 values로 렌더한 ModelConfig에는 `openAI` 필드가 아예 없었습니다.

라이브에 baseUrl이 있었던 이유는 2026-03-21에 `kubectl patch`로 직접 넣었기 때문입니다. 필드 소유자 기록(managedFields)에 그 날짜와 `kubectl-patch`가 남아 있었고, Argo CD는 다른 필드만 소유하고 있었습니다. Application에는 `/spec/openAI`를 비교에서 빼는 `ignoreDifferences`가 설정돼 있어서 selfHeal이 이 값을 되돌리지 않았습니다. git 어디에도 실제로 적용되는 엔드포인트 설정이 없었던 셈입니다. ModelConfig가 한 번 다시 만들어지면 baseUrl이 빠지고, 그 키로 OpenAI를 호출하다 에이전트 전부가 실패합니다.

고친 values는 다음과 같고, 렌더한 `spec.openAI`가 라이브 값과 필드 단위로 같습니다.

```yaml
providers:
  default: openAI
  openAI:
    model: "glm-4.7"
    config:                       # 차트가 spec.openAI 로 렌더하는 곳
      baseUrl: "https://llm.example.com/v4"
      apiFormat: chatCompletions
```

처음 감사에서는 이 `ignoreDifferences`를 평문 키의 diff를 가리는 장치로 추정했고, Secret 참조로 바꾼 뒤 지우라고 권했습니다. 그대로 따랐다면 selfHeal이 baseUrl을 제거했을 것입니다. `ignoreDifferences`는 아직 남겨 두었고, 값이 git에서 렌더되는 것을 확인한 뒤 지우는 작업은 후속 변경으로 남깁니다. 이 values에는 읽히지 않는 키(`agents.<에이전트>.resources`)도 있었는데 지금은 고쳐 두었습니다. 번들 에이전트는 서브차트라 `<에이전트>.resources`로 넘겨야 합니다.

### 구독형 모델을 그대로 붙일 수 없는 이유

ModelConfig가 요구하는 것은 API 키로 호출하는 HTTP 엔드포인트입니다. 같은 클러스터의 openclaw는 ChatGPT 구독을 OAuth 로그인으로 쓰고 있는데, 이는 API 키가 아니어서 ModelConfig에 넣을 값이 없습니다. 선택지를 조사한 결과는 다음과 같습니다. 가격은 2026-10-05에 확인한 입력/출력 100만 토큰당 값입니다.

| 선택지 | 확인 수준 | 가격·조건 | 걸리는 것 |
|---|---|---|---|
| 지금 공급자 유지(GLM-4.7) | 라이브에서 확인 | $0.6 / $2.2 (공식 가격 페이지) | 잔액이 0이면 전부 멈춘다 |
| OpenAI API 키 | 차트 values로 확인 | gpt-6.1-sol $2 / $10. 2026-10-05 공식 가격 페이지 기준 | 구독과 별도 청구 |
| Anthropic API 키 | 차트 values와 CRD로 확인 | Haiku 4.5 $1 / $5, Sonnet 5.5 $2 / $10 (공식 가격 페이지) | 구독과 별도 청구 |
| openclaw 게이트웨이의 OpenAI 호환 엔드포인트 | 문서로만 확인, 호출해 보지 않음 | 추가 요금 없음, 구독 한도 소모 | 아래 문단 |
| 로컬 모델(Ollama) | 불가로 판단 | — | 노드 셋 모두 GPU가 없다 |

openclaw 문서에는 게이트웨이가 `/v1/chat/completions`를 열 수 있고 tool 호출과 스트리밍을 지원한다고 적혀 있습니다. 기본은 꺼져 있고 hub의 설정에도 켜져 있지 않습니다. 걸리는 점은 넷입니다. 요청의 `model` 필드가 모델이 아니라 openclaw의 에이전트를 가리키므로, 이 엔드포인트는 모델을 중계하는 대신 openclaw 에이전트를 한 번 실행합니다. 문서는 게이트웨이 토큰 하나가 운영자 전체 권한을 갖는다고 경고합니다. 구독 로그인을 한 번 더 중계하는 것이 약관상 허용되는지는 1차 출처로 확인하지 못했습니다. 또 에이전트의 반복 호출이 텔레그램에서 쓰는 한도를 나눠 씁니다. kagent가 보내는 tool 스키마를 openclaw가 끝까지 처리하는지도 시험하지 않았습니다.

Claude 구독도 쓰지 않습니다. 결론은 정식 API 키입니다.

## 운영하며 겪은 것

아래 다섯 가지 문제와 변화는 대부분 2026-09-28에 차트를 0.7.23에서 0.10.2로 올리면서 드러났습니다.

### stdio 변환기는 musl 빌드에 묶여 있다

kmcp 0.3.0이 기본으로 쓰는 agentgateway는 0.9.0이고, 이 버전에 해당하는 공개 보안 권고가 4건 있었습니다. 버전을 올리려 했더니 상한이 있었습니다. kmcp의 init container는 agentgateway를 `--copy-self`로 복사하는데, agentgateway는 이 기능을 musl 빌드에만 넣었고 musl 태그는 `v1.3.1-musl`이 마지막입니다. v1.4.0부터는 glibc 빌드뿐이라 소스상 `--copy-self is not supported in this build`로 끝납니다.

kmcp controller의 env `TRANSPORT_ADAPTER_VERSION`을 `v1.3.1`로 올려 권고 2건에 해당하는 문제를 해결했습니다. 남은 2건은 여러 라우트에 서로 다른 인가 정책이 있거나 HTTPRoute 위임을 쓸 때의 문제여서, kmcp가 만드는 라우트 하나에 정책이 없는 설정에는 해당하지 않는다고 판단했습니다. 10월 2일에 공개된 권고 1건(medium, v1.6.0에서 수정)은 미해결 상태입니다. 10월 5일에 다시 조회했을 때도 v1.4.0~v1.6.0의 musl 태그는 없었습니다. 서버가 HTTP를 직접 지원하면 변환기 자체를 쓰지 않는 편이 낫고, VictoriaMetrics MCP는 그렇게 띄웠습니다.

### Grafana MCP가 403을 낸 원인은 latest 태그였다

차트 기본값은 `mcp/grafana:latest`에 pullPolicy `Always`입니다. 9월 27일 노드 재부팅으로 파드가 다시 뜨면서 그사이 푸시된 새 latest를 받았고, 그 빌드에는 DNS rebinding 방어가 들어 있었습니다. Host 헤더가 loopback이 아니면 요청을 거부합니다.

controller와 에이전트는 Service 이름으로 접속하므로 `initialize`부터 403 `forbidden: host not allowed`를 받았고, RemoteMCPServer가 Accepted=False가 됐습니다. `--allowed-hosts`에 Service 이름의 변형들과 loopback을 넣어 문제를 해결하고, 이미지를 공식 저장소의 버전 태그로 고정한 뒤 pullPolicy를 `IfNotPresent`로 바꿨습니다. 같은 서브차트의 Grafana 주소 기본값에는 스킴이 없고 호스트도 존재하지 않아 모든 호출이 실패하고 있었습니다. 주소를 클러스터의 Grafana Service로 지정했습니다.

### npm으로 받던 MCP 서버가 사라졌다

직접 만든 MCP 서버 넷은 npx로 npm 패키지를 받아 실행하고 있었습니다. 파드가 뜰 때마다 레지스트리에서 받는 방식입니다.

| 서버 | 무엇이 깨졌나 | 조치 |
|---|---|---|
| GitHub | npm 패키지가 폐기됐고 설치 시 의존성 해석이 깨져 `ERR_MODULE_NOT_FOUND`로 종료됐다 | GitHub의 공식 컨테이너(Go 바이너리)로 교체, tool 이름을 새 이름으로 변경 |
| fetch | npm에 그 이름의 패키지가 없다(E404). controller가 1분마다 시간 초과로 재시도했다 | Python 패키지 `mcp-server-fetch`를 uvx로 실행, 이미지와 패키지 버전 고정 |
| Prometheus | npm에 그 이름의 패키지가 없어(E404) 뜬 적이 없다 | VictoriaMetrics 공식 MCP로 교체(http transport) |
| Postgres | 패키지가 deprecated이고 `npx -y`에 버전이 없다 | 이번 점검에서 삭제하기로 함 |

VictoriaMetrics MCP는 기동 후 30초 만에 OOMKilled되는 일을 반복했습니다. documentation 도구가 켜져 있으면 기동할 때 내장 문서 전체를 메모리 인덱스로 만들기 때문이었고, `MCP_DISABLED_TOOLS`로 껐습니다. 이 변수는 기본 비활성 목록을 통째로 바꾸므로 기본값도 함께 적어야 합니다.

### tool server의 istioctl을 클러스터 Istio에 맞췄다

tool server 이미지에는 istioctl이 포함돼 있고, istioctl의 지원 범위는 컨트롤 플레인의 앞뒤 한 minor입니다. 클러스터의 istiod는 1.31.1인데 차트 0.7.23이 고정한 tool server에는 istioctl 1.28.3이, 0.10.2가 고정한 tool server에는 1.29.1이 들어 있었습니다. 차트를 올려도 두 minor가 어긋납니다. 증상을 본 것은 아니고, 지원 범위를 벗어난 채 두지 않으려고 이미지 태그를 istioctl 1.31.1이 든 0.3.0으로 따로 지정했습니다. 차트 0.10.3은 기본값이 0.3.0이어서 이 지정을 지웁니다.

### 0.10.2에서 저장소와 런타임이 바뀌었다

0.7.23까지 controller의 저장소는 tmpfs 위의 sqlite였고, 0.10.2부터는 번들 Postgres가 PVC와 함께 뜹니다. 세션은 원래 재시작하면 사라졌으므로 옮길 데이터가 없었습니다. 클러스터에 기본 StorageClass가 둘이어서 values에 하나를 명시했습니다. 올린 직후 controller가 한 번 재시작했는데, Postgres보다 먼저 떠서 마이그레이션 중 접속에 실패했기 때문입니다. 다시 뜬 뒤로는 정상입니다.

에이전트 런타임도 바뀌었습니다. 선언형 에이전트 16개가 Python에서 Go로 바뀌었습니다. 업스트림 기본값이 바뀌었으며, 에이전트별로 되돌리는 설정값이 있습니다. CRD 차트는 본체보다 먼저 올렸고 저장 버전이 그대로여서 CR 변환은 없었습니다.

## 보안 자세

tool server의 ServiceAccount에는 모든 API 그룹·리소스·verb를 허용하는 ClusterRole이 연결돼 있습니다. cluster-admin과 같은 범위입니다. 에이전트가 어떤 tool을 쓰든 이 계정의 권한으로 실행합니다. 제공하는 tool에는 `shell`도 있습니다.

앞단의 통제는 게이트웨이의 IP 제한 하나입니다. controller는 인증 없는 모드로 돌고, UI 호스트에는 집 안 대역과 몇 개 주소만 통과시키는 정책을 걸어 두었습니다. 0.10.2부터 UI가 controller API까지 넘겨주게 되면서 9월 28일에 추가한 정책입니다. 집 안에서는 `/api/agents`가 인증 없이 200을 돌려주는 것을 확인했고, 집 밖에서 403이 나오는지는 이번에 확인하지 못했습니다.

{{< flow src="_flow/6-게이트웨이를-거치지-않는-길.json" />}}

네임스페이스에는 NetworkPolicy가 없고 서비스 메시에도 들어 있지 않습니다. 공개된 앱의 파드 하나가 침해되면 그 파드에서 tool server로 가는 접근을 막을 수단이 없습니다. 감사에서는 UI에 SSO를 붙이라는 권고가 먼저 나왔지만, 허용 대역 안에서는 SSO를 건너뛰는 설정이라 달라지는 것이 없었고 실제로 접근이 열려 있는 쪽은 이 내부 경로였습니다. 이를 제한하려고 정책 둘을 준비했습니다. 하나는 같은 네임스페이스의 파드끼리만 인그레스를 허용하고, 다른 하나는 게이트웨이 파드에서 UI 파드의 8080으로 접근하는 것을 추가로 허용합니다. 노드의 프로세스와 hostNetwork 파드에서 같은 노드의 파드로 가는 접근은 이 정책으로 차단되지 않습니다.

쓰기 tool에도 통제가 없습니다. tool 호출 전에 사람의 승인을 받는 `requireApproval`은 16개 어디에도 없습니다. k8s-agent·istio-agent·argocd-agent는 apply·patch·delete를 할 수 있고, github-agent는 PR 병합과 푸시까지 할 수 있습니다. 선택지는 둘이고 아직 정하지 않았습니다.

| 선택지 | 방법 | 대가 |
|---|---|---|
| tool server를 읽기 전용으로 | `--read-only` 인자와 읽기 전용 RBAC. 렌더에서 ClusterRole이 get/list/watch 규칙으로 바뀌는 것을 확인 | apply·patch·exec가 전부 실패한다. Secret을 읽지 못해 helm 릴리스 조회도 막힌다 |
| 쓰기를 남기고 승인 | Agent CR의 `requireApproval`에 tool 이름을 나열 | 직접 만든 에이전트에만 설정할 수 있다. 번들은 tool 목록이 서브차트 템플릿에 고정돼 있다 |

두 방법 모두 실행해 보지는 않았습니다. UI가 승인 요청을 띄우는지도 확인하지 못했습니다.

비밀 관리에서는 LLM API 키와 GitHub 토큰이 git에 평문으로 있었습니다. 저장소가 비공개여도 클론과 CI, 에이전트 세션 어디서든 읽히고 이력에 남습니다. 옮기는 순서에서 주의할 점이 있습니다. 차트는 values에 키가 있을 때만 Secret을 만들므로, 키 줄을 지우면 그 Secret이 렌더에서 사라지고 prune으로 삭제됩니다. 새 키를 같은 이름의 Secret에 넣어 두어도 Argo CD가 관리하던 Secret이라 함께 지워집니다. 새 이름의 Secret을 git 밖에서 먼저 만들고 values가 그 이름을 참조하게 바꿔야 하며, 이력에 남은 옛 키까지 폐기해야 조치가 끝납니다. LLM 키는 폐기하기로 했으므로 정리 변경에서 키 줄을 지우지 않고 값만 비밀이 아닌 자리표시 문자열로 바꿨습니다. 줄을 남긴 이유가 위의 prune 문제입니다. GitHub 토큰을 옮기는 일은 이번 변경에 넣지 않았습니다.

## 2026-10-05 점검

{{< basis "기준 2026-10-05" "범위 hub 클러스터 kagent 네임스페이스" "로그는 파드 수명 전체" >}}

{{< kpis >}}
{{< kpi label="에이전트 실행" value="1건" sub="파드가 뜬 뒤 7일 남짓" tone="warn" >}}
{{< kpi label="Agent" value="16개" sub="전부 Ready" >}}
{{< kpi label="파드" value="26개" sub="실사용 480Mi · 36m" >}}
{{< kpi label="tool server의 tool" value="126개" sub="남길 에이전트가 쓰는 것 38개" >}}
{{< /kpis >}}

에이전트 16개의 로그를 처음부터 끝까지 봤습니다. 실행 기록은 k8s-agent의 1건(9월 28일 새벽)이고 그 뒤에 완료나 오류를 알리는 줄이 없습니다. 나머지 15개는 기동 로그가 전부입니다. Ready와 Accepted는 설정이 받아들여졌다는 뜻이지 모델이 답한다는 뜻이 아닙니다. 모델이 지금 답하는지는 이번 점검에서도 확인하지 못했습니다.

이 결과를 보고 기능을 더하기보다 줄이는 쪽으로 정했습니다.

| 분류 | 항목 | 이유 |
|---|---|---|
| {{< badge "일몰" warn >}} | 번들 에이전트 5개(cilium 3종, kgateway, argo-rollouts) | 대상 솔루션이 클러스터에 없다. CNI는 Calico다 |
| {{< badge "일몰" warn >}} | k8sagent | 번들 k8s-agent가 조회까지 모두 할 수 있고, k8sagent의 argo tool이 가리키는 Argo Rollouts는 클러스터에 없다. 9월에 편입할 때는 역할이 겹치지 않는다고 봤으나 이번에 판단을 바꿨다 |
| {{< badge "일몰" warn >}} | db-agent와 Postgres MCP | kagent 자신의 DB만 본다. 패키지가 deprecated다 |
| {{< badge "축소" warn >}} | tool server의 범주를 `k8s`·`helm`·`istio`로 | 남는 에이전트 9개가 쓰는 tool 38개가 모두 이 셋에 속한다. `shell`이 든 범주와 주소가 없는 prometheus 범주가 빠진다 |
| {{< badge "수정" info >}} | baseUrl을 `config` 아래로 | 모델 연결 절 |
| {{< badge "수정" info >}} | LLM API 키를 자리표시 값으로 | 키를 폐기하기로 했다. 줄을 지우면 Secret이 prune된다 |
| {{< badge "올림" good >}} | kagent·kagent-crds 0.10.2 → 0.10.3 | 10월 2일 릴리스. 커밋 2개, DB 마이그레이션과 CRD 변경 없음 |
| {{< badge "올림" good >}} | Grafana MCP 1.6.0 → 1.6.3, GitHub MCP v1.12.2 → v1.14.0, uv 이미지 0.12.19 → 0.12.23 | 같은 major 안의 수정 |
| {{< badge "추가" good >}} | trace를 HyperDX로, 본문 캡처는 끔 | 아래 |
| {{< badge "추가" good >}} | NetworkPolicy 2개 | 보안 자세 절. 별도 변경 |
| {{< badge "보류" >}} | kagent 1.0.0-alpha7 | alpha이고 API가 바뀌는 중이다 |
| {{< badge "보류" >}} | kmcp 0.4.0 | 차트가 0.3.0을 고정한다. 차이는 커밋 1개다 |
| {{< badge "보류" >}} | agentgateway v1.4.0 이상 | musl 태그가 없다 |
| {{< badge "보류" >}} | Grafana MCP 2.0.0 | 번들 observability-agent가 참조하는 Sift tool이 삭제됐고 사용 통계가 기본으로 켜진다 |

trace는 [관측 스택 일원화]({{< relref "/platform/homelab/03-observability-consolidation/index.md" >}})에서 연 HyperDX 컬렉터의 내부 수신 지점(grpc 4327)으로 보냅니다. 모델 호출과 tool 호출이 성공했는지를 로그로는 알 수 없어서 추가했습니다. 리뷰에서 부작용이 하나 드러났습니다. trace를 켜면 에이전트가 모델 요청과 응답의 본문을 span 속성으로 기록합니다. 본문에는 tool 결과가 들어가므로 cluster-admin 권한으로 읽은 Secret의 YAML이나 파드 로그가 trace 저장소에 설정상 최대 90일 남게 됩니다. 7일 뒤 콜드 저장소로 옮기고 90일 뒤 삭제하도록 해 둔 값이며, 실제 TTL은 확인하지 못했습니다. controller에 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`를 넣었습니다. controller의 `OTEL_*` env는 에이전트 파드로 복사됩니다. 이 동작은 소스로 확인했고, 이 값이 false이면 본문 속성이 빠지는 것이 아니라 `{}`로 대체됩니다. tool 결과에도 같은 처리가 적용되는지는 확인하지 못했으므로 적용 뒤 trace로 확인해야 합니다.

변경 둘을 준비했고 아직 적용하지 않았습니다. 하나는 정리와 업그레이드, 다른 하나는 NetworkPolicy이며 둘 다 PR로 올렸고 머지하지 않았습니다. 적용 전에 확인한 것은 다음과 같습니다.

- 변경 전후 values로 `helm template`을 돌리면 리소스가 53개에서 48개가 되고, 사라지는 것은 Agent 5개뿐입니다. 매니페스트 삭제까지 합치면 파드는 26개에서 18개, 에이전트는 16개에서 9개가 됩니다.
- ModelConfig의 렌더 결과가 라이브와 같습니다.
- tool server v0.3.0을 로컬에서 빌드해 목록을 조회했습니다. 인자 없이 실행했을 때 126개로 라이브와 이름까지 같았습니다. 남는 에이전트가 쓰는 38개는 k8s 19, istio 13, helm 6으로 모두 남기는 세 범주에 속합니다. 세 범주만으로 띄워 보지는 않았고, 렌더된 인자가 `--tools=k8s,helm,istio`인 것까지 확인했습니다.
- Grafana MCP 1.6.3을 같은 인자로 띄워 허용한 Host로는 200, 그 밖의 Host로는 403을 받았습니다. GitHub MCP v1.14.0의 tool 목록에는 github-agent가 쓰는 21개가 모두 있습니다.
- NetworkPolicy는 라이브 파드의 라벨에 대입해 흐름 14개가 허용되는지만 따졌습니다. 클러스터를 읽기 전용으로만 다뤄서 실제로 적용해 보지는 않았습니다.

올리는 버전들은 릴리스된 지 2~5일 됐습니다. 정리 변경을 먼저 적용하고 UI 접속과 에이전트 9개의 상태를 확인한 뒤 NetworkPolicy를 적용합니다. 둘은 서로 의존하지 않지만, 이 순서로 적용하면 문제가 생겼을 때 원인을 구분하기 쉽습니다.

## 남은 판단

7일 남짓에 1건이면 없애는 것이 맞는지부터 물어야 합니다. 이번 점검에서는 없애지 않고 줄여서 남기는 쪽을 택했습니다. 사용하는 자원은 네임스페이스 전체로 480Mi·36m(10월 5일 `kubectl top` 합계, 값은 변동합니다)이고, 클러스터 내부를 읽는 MCP 도구가 이미 연결돼 있습니다. 쓰이지 않는 원인을 기능 부족으로 보지는 않습니다. 조사 결과가 가리키는 병목은 둘입니다. 모델이 답하는지 알 수 없다는 것, 그리고 질문하러 UI까지 갈 일이 없다는 것입니다. 기존 키를 폐기하기로 했으므로 정리 변경이 적용되면 kagent는 모델이 없는 상태가 됩니다. 에이전트는 떠 있지만 모델 호출은 인증 오류로 실패합니다.

다음에 할 일을 그 순서로 적습니다.

1. 모델을 정합니다. 정식 API 키를 발급하면 Secret을 새 이름으로 git 밖에 만들고 ModelConfig가 그것을 가리키게 바꿉니다. 그 뒤 UI에서 에이전트 하나에 질문해 모델이 답하는지 확인합니다.
2. 변경 둘을 적용하고 확인합니다. 확인할 항목은 tool server의 인자, 에이전트 9개의 Ready 상태, UI 접속, HyperDX에 trace가 보이는지와 본문 속성이 `{}`인지입니다.
3. 쓰기 tool을 읽기 전용으로 할지 승인을 받도록 할지 정합니다. 클러스터 변경은 GitOps로 하므로 에이전트가 직접 apply할 이유는 약합니다.
4. 실제 사용으로 이어질 후보는 둘을 살펴봤습니다. 하나는 로그와 trace가 이미 쌓여 있는 ClickHouse를 읽기 전용 MCP로 연결하는 방안이고, 다른 하나는 Argo CD를 읽기 전용 MCP로 연결해 OutOfSync의 원인을 묻는 방안입니다. 둘 다 저장소 문서로 기능을 확인했을 뿐 띄워 보지 않았습니다.
5. 알림이 오면 에이전트가 1차 진단을 덧붙이도록 연결하는 방안도 후보입니다. 텔레그램으로 답을 받는 쪽을 UI보다 자주 쓸 가능성이 높습니다. 알림 형식을 에이전트 호출 형식으로 바꾸는 중계가 필요한지는 확인하지 못했습니다.

번들 에이전트를 더 켜거나 MCP 서버를 여러 개 새로 연결하는 일은 하지 않습니다. 한두 개로 실제로 쓰게 되는지를 먼저 봅니다.
