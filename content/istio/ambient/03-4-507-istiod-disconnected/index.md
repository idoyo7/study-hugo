---
title: "507과 istiod disconnected 탐지"
weight: 6
---

# 03-4 · 507 status code와 istiod disconnected 탐지 — 부록으로 남긴 두 사례 (2026-07)

{{< callout type="info" >}}
**참조한 내용정리** · 이 문서는 아래 원문을 읽고 우리 지식베이스 형식으로 재구성한 요약입니다. 원문 자체가 아니며, 정확한 워딩·전체 맥락·그림은 원문에서 확인합니다.
- **원문**: [Istio 3-4편: 507 status code와 istiod disconnected 탐지](https://tech.channel.io/kr/articles/tech-507-istiod-disconnected-e92ce438)
- **매체 · 게시일**: 채널코퍼레이션 기술 블로그 · 2026-07-13
- **저자**: 딜런 · 재티(정재홍) — 채널코퍼레이션 DevOps팀
{{< /callout >}}

{{< callout type="info" >}}
**한눈에**
- `507 Insufficient Storage`는 스토리지 부족이 아니었다. `response_code_details`가 `request_payload_exceeded_retry_buffer_limit`이었고, Envoy가 retry를 위해 request body를 replay하지 못하는 상태를 뜻하는 local reply였다.
- 원인은 요청 크기 제한이 아니라 retry 조건이다. Envoy는 body를 chunk로 스트리밍하므로 수십 MB payload도 평소엔 통과하지만, retry가 필요해지는 순간 `per_connection_buffer_limit_bytes`(기본 1MB)가 경계가 된다.
- 대응 세 가지(buffer 증설 · retry 비활성화 · client retry) 중 채널팀이 고른 것은 **large payload는 애플리케이션 레벨에서 멱등성 키를 갖추고 재시도**하는 방향이다. retry를 끄는 선택지는 3-1편의 503 문제 때문에 막혔다.
- 두 번째 사례는 gateway/waypoint가 istiod와 xDS 연결을 잃은 것으로 보이는 상황이다. 로그는 `lookup istiod.istio-system.svc: i/o timeout`에 `closed since 1614s ago`까지 붙었지만, 채널팀은 root cause를 특정하지 못했다고 명시하고 탐지·완화로 방향을 틀었다.
- 기본 readinessProbe는 "최초 xDS config를 받았는가"에 가까워 사후 단절을 못 잡는다. 보완책은 `control_plane.connected_state` 수집과 **`failureThreshold: 3` + `successThreshold: 3`** 조합이다.
{{< /callout >}}

이 글은 채널코퍼레이션의 Istio Ambient mode 도입기 시리즈 3-4편입니다. [3-1편]({{< relref "03-1-503-half-open-connection.md" >}})·[3-2편]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}})·[3-3편]({{< relref "03-3-ambient-upgrade-in-place.md" >}})이 각각 하나의 원인을 끝까지 파고드는 글이었다면, 3-4편은 운영 중 만난 Istio/Envoy 이슈 중 기억에 남는 두 사례를 부록처럼 묶은 글입니다.

채널팀은 두 사례 모두 Ambient mode에 한정된 문제가 아니라고 못 박습니다. waypoint에서 관찰했을 뿐, 소재는 Envoy가 요청을 buffering하고 retry하는 방식과 Envoy·istiod 사이 xDS 연결을 readiness로 어떻게 볼 것인가입니다. sidecar mode나 ingress gateway를 쓰는 환경에도 적용되므로, 전부 사이드카 모드 기준인 이 레포의 [상위 Istio 챕터]({{< relref "../../_index.md" >}})와 이 섹션이 만나는 지점이기도 합니다.

## 1. 처음 본 507 status code

### 1.1 문제 상황

운영 중 애플리케이션에서 낯선 에러가 보고되었습니다.

```text
MailException: MessengerServer Error: failed to send email
MessengerServer Error: failed to send email
status: 507
msg: exceeded request buffer limit while retrying upstream
```

503이나 504라면 Istio/Envoy를 운영하며 흔히 만납니다. 그런데 507은 익숙하지 않았습니다. 일반적으로 `507 Insufficient Storage`는 서버가 요청 처리에 필요한 저장 공간을 확보하지 못했다는 뜻이라, 채널팀도 처음에는 애플리케이션 서버의 스토리지 리소스 부족을 의심했습니다.

waypoint access log를 확인하니 이 응답은 애플리케이션이 만든 것이 아니라 **Envoy가 직접 만든 local reply**였습니다. 핵심은 `response_code_details`였습니다.

```text
request_payload_exceeded_retry_buffer_limit
```

Envoy 문서는 이 값을 이렇게 설명합니다.

> Envoy is doing streaming proxying but too much data arrived while waiting to attempt a retry.

Envoy가 요청 body를 streaming으로 upstream에 전달하는 동시에 retry 가능성을 위해 일부 데이터를 buffer에 저장하고 있었는데, retry를 위해 보관해야 하는 request payload가 buffer limit을 넘었다는 뜻입니다.

### 1.2 507은 request size 제한과는 다르다

헷갈리기 쉬운 지점은 507이 `413 Content Too Large`와 다르다는 점입니다.

| 구분 | `413 Content Too Large` | `507` + `request_payload_exceeded_retry_buffer_limit` |
| --- | --- | --- |
| 계열 | 4xx (클라이언트 오류) | 5xx local reply (Envoy 생성) |
| 판단 기준 | 서버가 정의한 request body size 제한 초과 | retry에 필요한 request body를 buffer에 보관하지 못함 |
| 의미 | "이 payload 자체가 너무 커서 거부한다" | "retry하려면 body를 replay해야 하는데 replay할 수 없다" |
| 발생 시점 | 요청 수신 시점에 결정적으로 | large payload + retryable failure가 겹칠 때만 |

정상적인 streaming proxying만 놓고 보면 큰 payload 자체가 항상 문제는 아닙니다. Envoy는 request body 전체를 메모리에 올려두고 upstream으로 보내지 않고, chunk 단위로 받아 upstream으로 흘려보냅니다. 이 경우 payload 전체가 수십 MB라도 Envoy가 한 번에 그 전체를 buffer로 들고 있을 필요가 없습니다.

문제는 retry에서 생깁니다. Envoy가 upstream 실패 시 요청을 재시도하려면 같은 request를 다시 upstream으로 보낼 수 있어야 합니다. 그런데 POST body처럼 이미 streaming으로 흘려보낸 데이터를 다시 보내려면, 적어도 retry에 필요한 만큼의 request body를 Envoy가 buffer에 가지고 있어야 합니다. buffer가 limit을 넘으면 Envoy는 더 이상 retry를 위해 request body를 보관하지 못하고, 이후 upstream reset이나 5xx 같은 retry 조건이 발생하면 요청을 replay할 수 없어 507 local reply를 반환합니다.

이번 문제는 "payload가 커서 실패했다"보다 "large payload request에서 retry가 필요해지는 순간 실패했다"에 가깝습니다.

### 1.3 왜 하필 507인가

Envoy 구현을 보면 `request_payload_exceeded_retry_buffer_limit` 상황에서 `Http::Code::InsufficientStorage`, 즉 507을 local reply로 보냅니다. 개념적 흐름은 다음과 같습니다.

{{< seq src="_seq/1-3-왜-하필-인가.json" />}}

이 buffer는 retry뿐 아니라 shadowing에도 쓰이고, Envoy는 새 data를 더한 크기가 effective buffer limit을 넘는지 매번 확인합니다. 실제 Envoy 코드에서도 buffer limit을 넘는 순간 retry state를 reset하고, 이후 local reply를 만들 때 response code detail을 `RequestPayloadExceededRetryBufferLimit`으로 설정합니다. 최종적으로 관측되는 조합은 다음과 같습니다.

```text
response_code: 507
response_code_details: request_payload_exceeded_retry_buffer_limit
body: exceeded request buffer limit while retrying upstream
```

### 1.4 `per_connection_buffer_limit_bytes`와 1MB

조사 과정에서 자연스럽게 보게 된 설정은 Envoy의 `per_connection_buffer_limit_bytes`입니다. Envoy의 기본 buffer limit은 1MB이고, Istio에서 별도 설정을 하지 않으면 이 기본값의 영향을 받을 수 있습니다.

이 값은 "request payload 최대 크기"와 같은 의미가 아닙니다. 큰 request라도 streaming만 된다면 통과합니다. 다만 retry를 위해 Envoy가 request body를 보관해야 하는 상황에서는 이 buffer limit이 사실상의 경계로 동작합니다.

운영자 입장에서 난감한 건 여기입니다. request body size 제한을 걸어둔 적이 없는데도 특정 조건에서만 일정 크기 이상의 요청이 507로 실패합니다. 그 조건이 "large payload + retryable failure"라 평소에는 드러나지 않다가 장애나 reset이 겹칠 때만 나타나고, 재현도 추적도 어렵습니다.

### 1.5 대응 방안 검토

채널팀이 검토한 방안은 세 가지입니다.

| 방안 | 내용 | 채널팀의 판단 |
| --- | --- | --- |
| ① buffer limit 증설 | buffer 키워 retry buffer 유지 | 상한 설정 어려움 · 메모리 압박 우려로 미채택 |
| ② retry 비활성화 | retry를 끄면 replay 자체가 불필요 | 3-1편의 reset 대응이 무너져 503 노출 |
| ③ client에서 retry | large payload 요청은 client/애플리케이션 레벨에서 재시도 | **가장 현실적인 방향으로 선택** |

**① buffer limit을 늘립니다.** 가장 직접적입니다. 실제로 이 값을 늘리면 더 큰 payload에 대해서도 retry buffer를 유지할 수 있습니다. 하지만 몇 MB까지 허용할지 정해야 하고, media나 file upload처럼 payload가 매우 큰 요청까지 고려하면 값을 무작정 키우기 어렵습니다. buffer limit은 실제로 데이터가 쌓일 때 쓰이더라도, 많은 connection에서 큰 request가 동시에 들어오면 메모리 압박으로 이어질 수 있습니다. 전체 gateway/waypoint에 일괄 적용하면 blast radius가 커지고, 특정 route나 service에만 적용하면 관리 복잡도가 올라갑니다.

**② retry를 끕니다.** retry를 하지 않으면 request body를 replay할 필요가 없으므로 문제 자체가 사라집니다. 그러나 채널팀 환경에서는 선택하기 어려웠습니다. [3-1편]({{< relref "03-1-503-half-open-connection.md" >}})에서 다뤘듯 Ambient mode 운영 중 waypoint/ztunnel 구간의 reset에 대해 retry가 필요하다는 것을 이미 확인했기 때문입니다. retry를 끄면 507은 줄지만 다른 많은 요청에서 503이 사용자에게 노출될 수 있습니다.

**③ large payload는 client에서 retry합니다.** 결국 가장 현실적인 방향이었습니다. Envoy가 모든 큰 POST body를 안전하게 buffer해두고 재시도하는 것은 비용이 큽니다. 반면 large payload 요청은 보통 업로드, 메일 발송, 문서 처리처럼 요청 자체가 무겁고 오래 걸리는 작업입니다. 이런 API는 애플리케이션 레벨에서 멱등성 키(idempotency key)나 중복 처리 방어를 갖추고 5xx에 대해 재시도하는 편이 더 명시적이고 안전합니다.

원문이 뽑은 교훈은 이렇습니다. retry를 켜면 large request body에 보이지 않는 buffer limit이 생기고, 큰 payload가 항상 실패하지는 않지만 retry가 필요한 순간에는 `507 request_payload_exceeded_retry_buffer_limit`으로 실패합니다.

## 2. istiod와 disconnected 된 것으로 보이는 gateway/waypoint

{{< callout type="warning" >}}
원문은 이 사례의 원인을 명확히 찾지 못했다고 명시합니다. 따라서 아래 내용은 "원인은 이것입니다"가 아니라 관찰한 현상과, 이를 탐지·대응하기 위해 검토한 메트릭 위주의 정리입니다.
{{< /callout >}}

### 2.1 문제 상황

운영 중 특정 gateway/waypoint Envoy가 istiod와의 xDS 연결을 정상적으로 유지하지 못하는 것으로 보이는 상황이 있었습니다. 당시 로그에는 다음과 같은 메시지가 반복적으로 찍혔습니다.

```text
"DeltaAggregatedResources" gRPC stream to xds-grpc closed:
14 (Unavailable): lookup istiod.istio-system.svc: i/o timeout (closed since 1614s ago)
```

각 필드가 가리키는 것은 다음과 같습니다.

| 필드 | 의미 |
| --- | --- |
| `DeltaAggregatedResources` | Envoy가 Delta xDS stream을 사용 중 |
| `xds-grpc` | Envoy가 바라보는 xDS cluster. 실제로는 pod 내부의 pilot-agent UDS proxy |
| `14` | gRPC `Unavailable` |
| `lookup istiod.istio-system.svc: i/o timeout` | pilot-agent가 istiod로 연결하는 과정에서 DNS timeout 발생 |
| `closed since 1614s ago` | 최초 실패 이후 오랜 시간 stream close/retry가 반복됨 |

로그만 보면 istiod DNS lookup이 실패한 것처럼 보였고, `lookup ... i/o timeout`이라는 메시지 자체도 DNS resolution failure에 가까웠습니다. 그래서 처음에는 CoreDNS나 cluster 전반의 DNS 문제를 의심했습니다.

하지만 같은 시간대에 cluster 전체에서 광범위한 DNS lookup error가 보이지 않았고, CoreDNS 자체에도 눈에 띄는 이상이 없었습니다. 메시지는 DNS failure처럼 보였지만 root cause를 CoreDNS로 지목할 근거는 부족했습니다.

이 지점에서 채널팀은 태스크의 방향을 바꿨습니다. DNS lookup을 계속 파고들어 단일 root cause를 특정하기보다, 비슷한 상황이 다시 발생했을 때 gateway/waypoint가 오래된 xDS config만 들고 계속 traffic을 받는 상태를 어떻게 피하거나 최소한 빠르게 탐지·완화할지에 초점을 맞추기로 했습니다.

### 2.2 Envoy · pilot-agent · istiod의 연결 구조

Istio gateway/waypoint Pod 안에는 Envoy와 pilot-agent가 함께 있습니다. Envoy 입장에서 xDS upstream은 `xds-grpc` cluster지만, 이 cluster의 실제 목적지는 원격 istiod가 아니라 **같은 Pod 안의 pilot-agent UDS**입니다.

{{< flow src="_flow/2-2-envoy-pilot-agent-istiod.json" />}}

이번에 관찰한 로그는 ② 구간에서 실패했고, 그 에러가 ① 구간의 gRPC stream close로 전파된 형태였습니다.

### 2.3 pilot-agent 에러는 Envoy에 전파된다

Istio agent의 xDS proxy 구현을 보면, pilot-agent는 istiod upstream 연결 실패를 Envoy downstream stream에 숨기지 않고 전파합니다. 개념적으로는 다음과 같습니다.

```go
// upstream: istiod로의 xDS gRPC stream
upstreamMsg, err := upstream.Recv()
if err != nil {
    errChan <- err
    return
}

// downstream: Envoy로의 xDS gRPC stream
if err := downstream.Send(upstreamMsg); err != nil {
    errChan <- err
    return
}
```

istiod 쪽 stream에서 `Recv()` 에러가 발생하면 upstream error channel로 전달되고, handler가 error를 반환합니다. 그러면 Envoy가 보고 있던 gRPC config stream도 닫힙니다.

```text
onRemoteClose()
  -> control_plane.connected_state = 0
  -> setRetryTimer()
  -> backoff 후 다시 xDS stream 생성
```

{{< seq src="_seq/2-3-pilot-agent-에러는-envoy.json" />}}

istiod와 통신하지 못하는 상황에서도 관찰 시점에 따라 `connected_state=1`이 보일 수 있습니다. 이 진동이 2.6에서 flapping 문제로 되돌아옵니다.

### 2.4 기존 readinessProbe의 한계

Istio의 기본 readinessProbe는 "최초 xDS config를 받았는가"에 더 가깝습니다. pilot-agent status probe 구현에는 `receivedFirstUpdate`, `atleastOnceReady` 같은 상태가 있고, 한 번 ready가 된 뒤에는 이후 xDS 연결이 끊겨도 readiness가 곧바로 실패하지 않을 수 있습니다. 형태는 이렇습니다.

```go
func (s *server) isReady(context.Context) bool {
    return s.receivedFirstUpdate
}
```

이 방식은 startup readiness에는 적합합니다. Envoy가 최초 config를 받기 전에 traffic을 받지 않도록 막아 주기 때문입니다. 하지만 한 번 ready가 된 gateway/waypoint가 이후 istiod와 장시간 끊긴 상태는 탐지하지 못합니다. 최초 config를 받은 사실은 그대로 true로 남습니다.

이 차이가 중요한 이유는 gateway/waypoint가 이미 받은 config로 한동안 트래픽을 계속 처리하기 때문입니다. 겉보기에는 멀쩡하지만 istiod와 오래 끊기면 새 config, endpoint, certificate rotation 같은 control plane 업데이트를 받지 못합니다. 그래서 process가 live인지뿐 아니라 xDS control plane과 지금 연결되어 있는지도 봐야 합니다.

xDS stream이 왜 이렇게 오래 유지되는 장수 커넥션인지, 그리고 그 커넥션이 재분배되지 않는 이유는 사이드카 모드 기준으로 [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "../../09-istiod-scaling-connections.md" >}})에서 다룹니다. 여기서의 단절도 한 번 맺힌 stream이 알아서 낫지 않는다는 같은 성질에서 옵니다.

### 2.5 어떤 메트릭을 볼 수 있을까

채널팀이 검토한 메트릭은 두 가지입니다.

- **`envoy_control_plane_connected_state`** — xDS gRPC stream 개폐 상태. 정상값 `1`. 한계: Envoy↔pilot-agent stream 상태이지 istiod 직결 상태가 아님
- **`envoy_cluster_upstream_cx_active{cluster_name="xds-grpc"}`** — pilot-agent UDS에 맺은 upstream connection 수. 정상값 보통 `1`. 한계: 같은 이유로 istiod 연결 상태를 직접 보지는 못함

#### `envoy_control_plane_connected_state`

Envoy 내부 stat 이름은 다음과 같습니다.

```text
control_plane.connected_state
```

Prometheus로 export되면 보통 다음 이름으로 보입니다.

```text
envoy_control_plane_connected_state
```

이 값은 xDS gRPC stream이 열려 있으면 `1`, 닫히면 `0`이 되는 gauge입니다. 2.3에서 설명한 대로 Envoy ↔ pilot-agent stream 상태를 반영하지만, pilot-agent가 istiod 연결 실패를 error로 전파하므로 간접적으로 istiod 연결 문제도 반영할 수 있습니다.

다만 이 stat을 수집하려면 `proxyStatsMatcher` 설정이 올바르게 되어 있어야 합니다. `proxyStatsMatcher.inclusionRegexps`는 **Prometheus metric 이름이 아니라 Envoy 내부 stat 이름**을 기준으로 매칭됩니다. 아래는 잘못된 설정입니다.

```yaml
# 틀린 설정: Prometheus metric 이름 사용
meshConfig:
  proxyStatsMatcher:
    inclusionRegexps:
    - "envoy_control_plane_connected_state"
```

올바른 설정은 Envoy 내부 stat 이름인 `control_plane.connected_state`를 기준으로 해야 합니다.

```yaml
# 올바른 설정: Envoy 내부 stat 이름 사용
meshConfig:
  proxyStatsMatcher:
    inclusionRegexps:
    - "control_plane\\.connected_state"
```

이 설정이 잘못되어 있으면 `/stats`를 조회해도 stat 자체가 생성되지 않습니다. 실제 장애 당시에도 이 설정이 잘못되어 있어 해당 메트릭을 사후 분석에 쓰지 못했습니다.

#### `envoy_cluster_upstream_cx_active{cluster_name="xds-grpc"}`

또 하나 볼 수 있는 값은 `xds-grpc` cluster의 active connection 수입니다.

```text
envoy_cluster_upstream_cx_active{cluster_name="xds-grpc"}
```

이 값은 Envoy가 pilot-agent UDS에 맺은 upstream connection 수를 나타내며 정상 상태에서는 보통 `1`입니다. DNS 장애처럼 pilot-agent가 istiod와 연결하지 못해 gRPC stream이 계속 닫히는 경우에는 `0`으로 떨어지거나, Pod 자체 scraping이 안 되면 시계열이 소실될 수 있습니다. 이 값도 Envoy ↔ pilot-agent UDS connection을 보는 것이라 istiod 연결 상태 자체는 아니지만, pilot-agent 에러가 Envoy stream close로 전파되는 케이스에서는 실용적인 신호가 됩니다.

### 2.6 readinessProbe로 감지하기

메트릭 수집은 alert에는 쓸모가 있지만 Kubernetes Service endpoint에서 해당 gateway/waypoint를 빼 주지는 못합니다. 그래서 readinessProbe에 xDS 연결 상태를 반영하는 방안을 검토했습니다. 기본 `/healthz/ready`와 `control_plane.connected_state`를 함께 확인하는 형태입니다. 이렇게 하면 xDS stream이 일정 시간 0으로 떨어졌을 때 Pod readiness가 false가 되고 Service endpoint에서 제외될 수 있습니다.

여기에도 함정이 있습니다. 기본 `successThreshold`는 **1**입니다.

{{< seq src="_seq/2-6-readinessprobe-로-감지하기.json" />}}

그래서 단순히 `failureThreshold`만 두는 것보다 **Ready로 복귀할 때도 연속 성공을 요구하는 편이 안전합니다.**

```yaml
readinessProbe:
  # 기본 /healthz/ready 와 control_plane.connected_state 를 함께 확인
  failureThreshold: 3
  successThreshold: 3
```

| 필드 | 값 | 효과 |
| --- | --- | --- |
| `failureThreshold` | `3` | 3회 연속 실패해야 NotReady로 본다 |
| `successThreshold` | `3` | 3회 연속 성공해야 Ready로 복귀한다 (기본값 `1`) |

{{< callout type="important" >}}
채널팀은 이 방법도 완벽한 해결책이 아니라고 명시합니다. 세 가지 한계가 남습니다.
- `connected_state`는 Envoy가 istiod에 직접 붙어 있는지를 보는 메트릭이 아니라 Envoy의 xDS stream 상태를 보는 메트릭이다.
- probe에서 `/stats`를 매번 파싱하는 방식은 다소 거칠다.
- 설정을 잘못하면 startup 지연이나 오히려 flapping을 만들 수 있다.

그럼에도 기본 readiness가 "최초 config 수신 여부"에 가깝다는 점을 고려하면, gateway/waypoint 같은 중요 진입점에서는 현재 control plane 연결 상태를 별도로 보는 것이 운영상 의미가 있다고 판단했습니다.
{{< /callout >}}

## 3. 사이드카 모드 챕터와의 접점

두 사례 모두 Envoy를 data plane으로 쓰는 이상 마주치는 문제에 가깝습니다. 이 레포의 상위 Istio 챕터는 전부 사이드카 모드 기준인데, 대응 관계는 다음과 같습니다.

| 이 문서의 소재 | 사이드카 모드에서 같은 문제가 나타나는 자리 | 관련 문서 |
| --- | --- | --- |
| waypoint의 507 retry buffer | 사이드카 Envoy·Ingress Gateway도 동일하게 발생 | [01 서비스 메시와 Istio 기초]({{< relref "../../01-mesh-basics.md" >}}) |
| `xds-grpc` 단절·stale config | 사이드카도 pilot-agent 거쳐 istiod에 붙는 구조 동일 | [02 컨트롤 플레인 해부: istiod]({{< relref "../../02-istiod-control-plane.md" >}}) |
| xDS stream이 스스로 안 낫는다 | 장수 gRPC 커넥션 미재분배 문제와 같은 뿌리 | [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "../../09-istiod-scaling-connections.md" >}}) |
| retry를 켤 수밖에 없게 만든 reset | Ambient 데이터 경로에서의 503 추적 | [03-1편 503과 Half-open Connection]({{< relref "03-1-503-half-open-connection.md" >}}) |

Envoy config 레벨에서 `xds-grpc` cluster나 buffer limit이 실제로 어떻게 박혀 있는지는 [2편 Envoy config로 해부하는 Ambient mode]({{< relref "02-envoy-config-anatomy.md" >}})에서 확인할 수 있습니다.

## 이 문서에서 가져갈 것

- **status code를 액면가로 읽지 마라.** `507 Insufficient Storage`는 디스크와 무관했다. Envoy가 만든 local reply인지 애플리케이션 응답인지부터 가르고, `response_code_details`를 봐야 실제 원인(`request_payload_exceeded_retry_buffer_limit`)에 닿는다. access log에 이 필드를 남기지 않으면 이 사례는 추적 자체가 불가능하다.
- retry를 켜면 body 크기에 보이지 않는 상한이 생긴다. 명시적으로 request size 제한을 걸지 않았어도 `per_connection_buffer_limit_bytes`(기본 1MB)가 retry 경로에서 경계로 작동한다. large payload API는 Envoy에 재시도를 맡기지 말고 멱등성 키를 갖춰 애플리케이션 레벨에서 재시도하는 편이 경계가 명확하다.
- "한 번 Ready였다"와 "지금 연결되어 있다"는 다르다. Istio 기본 readinessProbe는 `receivedFirstUpdate` 기반이라 startup 게이트로는 맞지만 사후 단절을 못 잡는다. 이미 받은 config로 트래픽은 계속 흐르므로 겉보기 정상 상태에서 stale config가 누적된다.
- flapping을 막는 건 `failureThreshold`가 아니라 `successThreshold`다. 재연결 루프는 `connected_state`를 0↔1로 진동시키므로, 기본값 1이면 한 번의 우연한 성공으로 Ready에 재진입한다. 복귀에도 연속 성공을 요구해야 한다.
- 메트릭은 켜뒀다고 수집되지 않는다. `proxyStatsMatcher.inclusionRegexps`는 Prometheus 이름(`envoy_control_plane_connected_state`)이 아니라 Envoy 내부 stat 이름(`control_plane.connected_state`)으로 매칭한다. 채널팀은 이 설정이 틀려 정작 장애 사후 분석에 메트릭을 쓰지 못했다. 알람용 메트릭은 평시에 실제로 나오는지 확인해둬야 한다.
- 원인 규명과 탐지 설계는 별개의 결론이 될 수 있다. 채널팀은 DNS root cause를 특정하지 못한 채로 태스크를 "재발 시 빠르게 탐지·완화한다"로 전환했다. 원인을 못 찾았다는 사실을 명시하고 방어선을 세우는 것도 유효한 종료 조건이다.

## 소스

- **원문**: [Istio 3-4편: 507 status code와 istiod disconnected 탐지](https://tech.channel.io/kr/articles/tech-507-istiod-disconnected-e92ce438) (채널코퍼레이션 기술 블로그, 딜런·재티(정재홍) DevOps팀, 2026-07-13)
- 원문 시리즈: [1편 왜 Istio Ambient mode인가?](https://tech.channel.io/kr/articles/tech-istio-ambient-mode-30cdf79a) · [2편 Envoy config로 해부하는 Ambient mode](https://tech.channel.io/kr/articles/tech-istio-envoy-config-c5193569) · [3-1편 503과 Half-open Connection 추적기](https://tech.channel.io/kr/articles/ambient-mode-troubleshooting-1-82576790) · [3-2편 Partially Enrolled Pod와 Untaint Controller](https://tech.channel.io/kr/articles/ambient-mode-troubleshooting-2-1f761f31) · [3-3편 Ambient mode 안전하게 업그레이드하기](https://tech.channel.io/kr/articles/tech-istio-cni-in-place-b004fdb9)
- 원문이 인용한 Envoy 문서: [Response code details](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_conn_man/response_code_details) — `request_payload_exceeded_retry_buffer_limit` 설명의 출처
- 배경 참고 · Envoy: [Cluster / Listener `per_connection_buffer_limit_bytes`](https://www.envoyproxy.io/docs/envoy/latest/api-v3/config/cluster/v3/cluster.proto) · [HTTP router retry policy](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/router_filter)
- 배경 참고 · Istio: [MeshConfig `ProxyStatsMatcher`](https://istio.io/latest/docs/reference/config/istio.mesh.v1alpha1/#ProxyConfig-ProxyStatsMatcher) · [Ambient mode 개요](https://istio.io/latest/docs/ambient/overview/) · [Health checking of Istio services](https://istio.io/latest/docs/ops/configuration/mesh/app-health-check/)
- 이 문서가 다루지 못한 것: 원문 본문의 그림 5점(정상 streaming 흐름, retry buffer 초과, Envoy·pilot-agent·istiod 연결 구조, 재연결 루프, readiness flapping)은 옮기지 않고 같은 내용을 이 레포의 도식 엔진으로 새로 그렸다 — 배치·표현은 원문과 다르다. `readinessProbe` YAML의 포트 번호와 `exec` 커맨드 전문, 2.1 로그 라인의 타임스탬프는 원문에서 확실히 확보하지 못해 생략했다 — 정확한 값은 원문에서 확인한다.
