---
title: "3-1편 — 503과 Half-open Connection"
weight: 3
---

# 03-1 · 503과 Half-open Connection — waypoint가 죽은 Pod의 커넥션을 재사용한다 (2026-06)

{{< callout type="info" >}}
**참조한 내용정리** · 이 문서는 아래 원문을 읽고 우리 지식베이스 형식으로 재구성한 요약입니다. 원문 자체가 아니며, 정확한 워딩·전체 맥락·그림은 원문에서 확인합니다.
- **원문**: [Istio 3-1편: 503과 Half-open Connection](https://tech.channel.io/kr/articles/ambient-mode-troubleshooting-1-82576790)
- **매체 · 게시일**: 채널코퍼레이션 기술 블로그 · 2026-06-26
- **저자**: Jetty(정재홍) · 채널코퍼레이션 DevOps팀
{{< /callout >}}

{{< callout type="info" >}}
**한눈에**
- 증상은 workload rollout(재시작·배포) 중 간헐적으로 터지는 **503**이었습니다. public gateway는 `response_code_details: via_upstream`만 남기고 실제 원인 기록은 waypoint의 `upstream_reset_before_response_started{connection_termination}` · `response_flags: UC`에 있었습니다. 다음 hop인 ztunnel과 istio-cni에는 이상 로그가 없었습니다.
- 원인은 IP 겹침이 아니라 **stale connection을 폐기하지 못하는 커넥션 생명주기 관리**였습니다. waypoint Envoy의 `connect_originate`(ORIGINAL_DST) cluster는 `IP:Port`만을 키로 HBONE 터널을 pool에 보관·재사용하고, ztunnel은 Pod 종료 시 그 터널을 graceful하게 닫지 않습니다.
- pcap이 결정적이었습니다. 새 Pod가 뜬 직후 **TLS handshake 없이 application data stream이 곧바로 인입**됐고 새 Pod의 network namespace에는 그 TCP connection 상태가 없으니 커널 TCP 스택이 RST로 답했습니다.
- 로그·pcap·socket 세 각도가 같은 결론을 가리켰습니다. Envoy debug 로그에서 ConnectionId 79097이 Phase 1과 Phase 2에 동일하게 등장했고(`using existing fully connected connection`), Pod 삭제 후에도 waypoint 쪽 `:15008` socket이 일정 시간 `ESTABLISHED`로 남아 있었습니다.
- 즉시 조치는 **retry 조건을 `reset-before-request`에서 `reset`까지 확장**한 것입니다. 채널팀은 이것으로 증상을 해소했지만, 근본 해결은 pool key에 workload identity·Pod UID를 넣는 Istio upstream 개선 영역으로 남겼습니다.
{{< /callout >}}

Ambient mode 시리즈 3편은 채널팀이 프로덕션에서 겪은 장애들을 다룹니다. 그중 3-1편은 배포할 때마다 조금씩 새던 503을 추적한 기록입니다. [1편]({{< relref "01-why-ambient-mode.md" >}})이 왜 Ambient로 가는지를, [2편]({{< relref "02-envoy-config-anatomy.md" >}})이 waypoint Envoy config가 어떻게 생겼는지를 다뤘다면, 이 글은 그 config가 런타임에 들고 있는 상태가 장애로 이어진 사례입니다.

사이드카 모드에서 5xx를 추적하던 순서 — 게이트웨이 → 사이드카 → 앱을 훑으며 어느 hop이 끊었는지 좁혀 가는 방식 — 는 [05 장애 이야기: 간헐적 응답 이상]({{< relref "../../05-incident-intermittent-5xx.md" >}})에서 정리했습니다. Ambient에서는 그 hop 구성이 달라집니다. 커넥션을 다루는 주체가 ztunnel과 waypoint로 분리되면서 "누가 커넥션을 열고 누가 닫는가"가 한 프로세스 안에서 끝나지 않습니다. 이 글의 장애는 그 분리 지점에서 났습니다.

## 1. 문제 상황 — 롤아웃마다 새는 503

문제는 workload rollout(재시작·배포) 과정에서 간헐적으로 발생한 503 응답이었습니다. 상시 장애가 아니라 배포 창구에서만 몇 건씩 새는 형태라 알림 임계에도 잘 걸리지 않았습니다.

로그를 hop별로 늘어놓으면 어디를 봐야 하는지가 곧바로 드러납니다.

| hop | 핵심 신호 | 해석 |
| --- | --- | --- |
| public gateway | `via_upstream` | 업스트림에서 받은 것을 전달 — 원인 정보 없음 |
| waypoint | `upstream_reset_before_response_started`, `UC` | 응답 시작 전 업스트림 커넥션 reset |
| ztunnel | 이상 로그 없음 | 자기가 아는 한 아무 일도 없었다 |
| istio-cni | 이상 로그 없음 | 마찬가지 |

위 두 줄을 필드째로 옮기면 이렇습니다. public gateway가 남긴 것은 `response_code: 503`과 `response_code_details: via_upstream` — 자기가 만든 503이 아니라 업스트림에서 받은 것을 전달했다는 뜻이라 원인 정보가 없습니다. waypoint가 남긴 것은 `response_code: 503`, `response_code_details: upstream_reset_before_response_started{connection_termination}`, `response_flags: UC` — **응답 시작 전에 업스트림 커넥션이 reset**됐다는 뜻이고 `UC`는 upstream connection termination입니다.

{{< seq src="_seq/1-문제-상황-롤아웃마다-새는.json" />}}

## 2. 문제 재현 — 프로덕션을 건드릴 수 없으니 환경을 복제했다

프로덕션에서 이 문제를 직접 디버깅하기는 어렵습니다. 트래픽 볼륨이 크면 debug 로그를 켜는 것 자체가 위험하고 원하는 순간의 패킷을 골라내기도 어렵습니다.

채널팀은 격리된 재현 환경을 따로 구성했습니다. dummy application과 **전용 gateway·waypoint·ztunnel**을 별도로 띄워 노이즈 없이 문제만 관찰할 수 있는 환경을 만들었습니다.

재현 경로는 더 줄일 수 있었습니다. public gateway를 빼고 waypoint만 이용한 `Pod → waypoint → waypoint` 통신에서도 동일하게 503이 재현됐습니다. 게이트웨이·인그레스 계층이 용의선상에서 빠지고 문제는 waypoint의 업스트림 커넥션 관리로 좁혀졌습니다.

| 구분 | 경로 | 재현 여부 |
| --- | --- | --- |
| 최초 관측 경로 | public gateway → waypoint → ztunnel → destination Pod | 재현 |
| 단순화한 경로 | Pod → waypoint → waypoint | 재현 |

### 패킷을 잡기 위해 tcpdump sidecar를 주입했다

원인 규명을 위해 두 종류의 데이터를 모았습니다. 하나는 waypoint의 **debug level 로그**, 다른 하나는 **destination Pod 안에서의 TCP 패킷 캡처**입니다.

패킷 캡처 쪽은 구성이 까다롭습니다. 문제가 Pod의 생성·종료 순간에 걸쳐 있어서 앱이 살아 있는 동안만 잡아서는 필요한 구간을 놓칩니다.

| 항목 | 구성 |
| --- | --- |
| 캡처 주체 | `NET_RAW`/`NET_ADMIN` 권한을 가진 **tcpdump sidecar를 주입** |
| 캡처 범위 | Pod 생성부터 종료까지 **전체 라이프사이클** |
| 종료 처리 | **SIGTERM 이후 남는 잔여 패킷까지** 끝까지 캡처 |
| 산출물 보관 | 캡처된 pcap을 **S3에 업로드** |

Pod가 사라지면 캡처 파일도 함께 사라집니다. SIGTERM 이후까지 캡처를 유지하고 결과물을 클러스터 밖으로 밀어내야 종료 직후의 상황을 사후에 열어볼 수 있습니다.

## 3. pcap이 보여준 것 — HBONE 암호화 너머의 두 계층

destination Pod에 직접 tcpdump를 떠서 Wireshark로 열어보고서야 무엇이 벌어지는지가 보였습니다.

Ambient에서 Pod 안의 패킷을 뜨면 성격이 다른 두 계층이 동시에 잡힙니다. 이 구분을 하지 못하면 pcap은 암호문 덩어리로만 보입니다.

| 계층 | 구간 | 상태 |
| --- | --- | --- |
| 암호화 계층 | waypoint → ztunnel | HBONE/mTLS로 **암호화된** 패킷 |
| 평문 계층 | ztunnel → application | ztunnel socket을 거쳐 **복호화된** 평문 패킷 |

암호화 구간의 페이로드는 읽을 수 없지만 프레임의 순서와 종류는 보입니다. 정상과 비정상의 차이는 거기서 갈렸습니다.

{{< seq src="_seq/3-pcap-이-보여준-것.json" />}}

waypoint 입장에서는 응답 시작 전에 업스트림이 끊긴 것이므로 `upstream_reset_before_response_started`가 찍히고 503이 나갑니다.

### Pod 자체는 멀쩡했다

비정상 응답을 한 Pod 자체에는 문제가 없었습니다. probe 설정도, running state도 정상이었습니다. 애플리케이션 레벨에는 찾을 것이 없고 문제는 앱에 도달하기 전 커넥션 상태에 있습니다.

단서는 Pod 밖에 있었습니다. 비정상 응답을 받은 Pod의 IP가 짧은 시간 안에 재사용되고 있었습니다 — 직전에 삭제된 다른 Pod가 쓰던 IP를 새 Pod가 그대로 물려받은 상황이었습니다.

## 4. 가설 — "IP 겹침"이 아니라 "stale connection"

여기서 결론을 "IP가 겹쳐서 생긴 문제"로 내리면 절반만 맞습니다. 채널팀이 짚은 원인은 stale connection을 폐기하지 못하는 커넥션 생명주기 관리이고, IP 재사용은 그 문제가 드러날 확률을 높이는 조건일 뿐입니다.

이 글에서 말하는 **half-open(stale) connection**은 *새로운 Pod와 그 ztunnel은 인지하지 못하는 채로, waypoint는 아직 살아 있다고 믿는 connection*입니다. 한쪽만 살아 있다고 믿는 상태라서 half-open입니다.

### waypoint는 downstream과 upstream을 직접 잇지 않는다

가설이 성립하려면 waypoint가 커넥션을 재사용할 구조여야 합니다. waypoint Envoy는 client(downstream)와 목적지 Pod(upstream)를 하나의 직접 connection으로 연결해서 관리하지 않습니다. 내부적으로 두 영역이 분리되어 있습니다.

- client의 요청을 받는 **downstream listener**
- HBONE 터널, 즉 upstream connection을 별도로 맺어 connection pool로 관리하는 **internal listener `connect_originate`** 와 그에 연결된 **`connect_originate`(ORIGINAL_DST) cluster**

그리고 이 cluster의 pool은 **`IP:Port`만을 키로** 터널을 보관·재사용합니다.

{{< flow src="_flow/waypoint-는-downstream-과.json" />}}

HBONE은 **HTTP/2 CONNECT로 만든 outer connection(터널) 안에 실제 TCP 스트림인 inner connection을 실어 나르는 구조**입니다. pool이 재사용하는 대상은 outer connection이고, 요청마다 새로 열리는 것은 inner stream입니다. 이 구분은 뒤의 "GOAWAY로 정리하면 되지 않나"라는 질문에서 다시 등장합니다.

### 세 조건이 겹칠 때만 터진다

가설을 조건으로 분해하면 이렇습니다.

| 조건 | 주체 | 내용 |
| --- | --- | --- |
| ① 커넥션 재사용 | waypoint Envoy | `IP:Port` 키만으로 기존 HBONE 터널을 그대로 재사용한다 |
| ② graceful close 부재 | ztunnel | Pod 종료 시 GOAWAY도 FIN도 보내지 않아, waypoint는 터널이 살아 있다고 믿는다 |
| ③ IP 재사용 | IPAM/CNI | 삭제된 Pod의 IP가 짧은 시간 안에 새 Pod에 재할당된다 |

{{< seq src="_seq/세-조건이-겹칠-때만.json" />}}

## 5. 가설 검증 — 로그·pcap·socket 세 각도

가설은 세 방향에서 독립적으로 확인됐습니다.

### 5.1 Envoy debug 로그 — 같은 ConnectionId가 두 번 등장했다

두 단계로 나눈 실험을 돌렸습니다.

| 단계 | 동작 | 로그 |
| --- | --- | --- |
| Phase 1 | 새 Pod(`Pod-aaa`)로 요청 | 신규 HBONE connection 생성, **ConnectionId 79097** 기록 |
| Phase 2 | 같은 IP를 받은 새 Pod(`Pod-bbb`)로 요청 | **동일한 ConnectionId 79097**이 다시 등장 |

새 Pod로의 요청인데도 새 connection을 맺지 않고 옛 connection을 재사용했다는 증거입니다.

```text
using existing fully connected connection
```

상대편 Pod가 이미 존재하지 않는데도 Envoy는 이 커넥션을 "fully connected"로 판단하고 있었습니다.

### 5.2 pcap — 종료 신호가 아예 없었다

pcap을 다시 뒤져 Pod 종료 시점을 봤습니다. HTTP/2 GOAWAY도, TCP FIN도 관측되지 않았습니다. ztunnel이 Pod 종료 시 upstream 커넥션을 graceful하게 닫지 않는다는 뜻이고 조건 ②의 직접 증거입니다.

### 5.3 socket 상태 — 삭제 후에도 ESTABLISHED

임의의 Pod를 삭제한 뒤 socket 상태를 관찰하자 일정 시간 동안 해당 socket이 `ESTABLISHED`로 남아 있었습니다. 삭제된 Pod IP를 peer로 하는 `:15008` socket이 waypoint 쪽에 살아 있었습니다. (원문은 어떤 도구로 socket을 관찰했는지까지는 밝히지 않습니다.)

| 각도 | 관측 | 확인한 조건 |
| --- | --- | --- |
| Envoy debug 로그 | ConnectionId 79097 재등장 · `using existing fully connected connection` | ① 커넥션 재사용 |
| pcap | Pod 종료 시 GOAWAY·FIN 미관측 | ② graceful close 부재 |
| socket 상태 | 삭제 후에도 `:15008` socket이 `ESTABLISHED` | ①②의 결과 상태 |

{{< callout type="warning" >}}
`ESTABLISHED`는 "상대가 살아 있다"는 뜻이 아닙니다. TCP는 양쪽 커널이 각자 상태를 들고 있는 프로토콜이라 한쪽이 통째로 사라져도 남은 쪽은 keepalive나 다음 전송으로 실패를 확인하기 전까지 계속 `ESTABLISHED`로 표시합니다. 커넥션 pool의 "살아 있음" 판정을 socket 상태에만 의존하면 half-open을 걸러낼 수 없습니다.
{{< /callout >}}

## 6. 문제 대응

### 6.1 근본 해결책 — Istio upstream 개선이 필요한 영역

대응의 목적은 **stale connection이 재사용되지 못하게 하는 것**이고 방향은 두 갈래입니다.

#### (a) connection pool key에 신원을 넣는다

현재 Envoy의 ORIGINAL_DST cluster는 목적지 주소만으로 pool을 구분합니다.

```text
AS-IS
connection pool key ~= "10.90.142.96:15008"

TO-BE
connection pool key ~= "dst=10.90.142.96:15008 + dst_id=[spiffe://cluster.local/ns/default/sa/api]"
```

여기에 더해 이상적으로는 Pod UID 같은 인스턴스별 고유값까지 key에 포함해야 합니다. workload identity(SPIFFE ID)만으로는 같은 ServiceAccount를 쓰는 다른 Pod를 구분하지 못하기 때문입니다. key에 인스턴스 고유값이 들어가면 IP가 재사용되더라도 stale connection 재사용이 불가능해집니다.

#### (b) 종료 시점에 커넥션 정리 신호를 보낸다

"Pod가 죽을 때 GOAWAY를 보내면 되지 않나" 싶지만, 원문은 이 경로가 간단하지 않은 이유를 짚습니다.

| 난점 | 내용 |
| --- | --- |
| 타이밍 신호 부재 | ztunnel이 "지금 이 Pod가 종료된다"를 확실히 알 경로가 마땅치 않다 |
| 이미 늦은 시점 | Pod가 완전히 종료된 뒤에는 정리 신호를 보낼 수 없다 |
| 통로 자체가 사라진다 | Pod 종료 후 CNI가 veth·netns를 정리하면서 GOAWAY를 보낼 통로도 사라질 수 있다 |
| GOAWAY의 사정거리 | GOAWAY는 outer connection(HTTP/2 터널)에만 영향 — inner connection은 별도 처리 필요 |

커뮤니티에서 논의 중인 후보들도 각각 타이밍과 복잡도에서 trade-off가 다릅니다.

| 후보 | 방식 |
| --- | --- |
| `ShutdownStarting` 신호 | Pod 종료가 시작되는 시점을 잡아 GOAWAY를 전송 |
| CNI DEL hook | 네트워크가 제거되기 **직전**에 정리를 수행 |
| client 측 감지 | 클라이언트 쪽에서 Pod 삭제를 감지해 pool에서 제거 |

이 문제는 설정 하나로 닫히지 않고 **Istio가 커넥션 생명주기를 어디서 책임질 것인가**라는 설계 논의로 이어집니다. 관련 논의는 `istio/ztunnel#1637`(재현 사례 리포트)과 `istio/ztunnel#1191`(커넥션 생명주기 개선)에서 진행 중입니다.

### 6.2 즉시 적용할 수 있는 방안 — RST에 대한 retry

waypoint의 retry 정책은 원래 `reset-before-request`만 재시도 대상으로 잡고 있었습니다. 이를 **`reset`까지 포함하도록 확장**하면 stale connection 때문에 reset이 발생했을 때 waypoint가 자동으로 다시 시도합니다. 재시도 시점에는 pool에서 죽은 커넥션이 걷혀 나가므로 새 커넥션이 맺히고 요청은 정상 처리됩니다.

```text
retry_on: reset,connect-failure,refused-stream,...
```

| 구분 | 변경 전 | 변경 후 |
| --- | --- | --- |
| retry 대상 | `reset-before-request` | `reset` 포함으로 확장 |
| 효과 | stale connection RST는 그대로 503 | RST 발생 시 waypoint가 자동 재시도 |
| 성격 | — | **증상 완화이지 근본 해결이 아니다** |

원문은 커뮤니티에서 `EnvoyFilter`로 위 `retry_on`을 추가하는 것이 사실상 유일하게 효과를 본 우회책으로 보고되고 있다고 밝히고, 채널팀도 waypoint 수준에서 이 retry를 적용해 문제를 해소했다고 말합니다. 다만 채널팀이 적용한 `EnvoyFilter`의 구체적인 YAML은 공개하지 않습니다.

{{< callout type="error" >}}
retry 확대는 **멱등성을 전제로 합니다.** `reset`은 "요청이 업스트림에 전달되었는지 알 수 없는" 상태를 포함하므로 비멱등 API(결제·주문 생성 등)에 무차별로 걸면 중복 처리가 납니다. 적용 전에 대상 라우트의 API 멱등성을 확인해야 합니다. 이 함정은 사이드카 모드에서 retry를 넓힐 때와 동일합니다 — [05 장애 이야기]({{< relref "../../05-incident-intermittent-5xx.md" >}}) 참고.
{{< /callout >}}

(배경 보충: waypoint의 retry 정책을 표준 CRD 밖에서 손대야 할 때 쓰는 수단이 `EnvoyFilter`다 — [08 EnvoyFilter]({{< relref "../../08-envoyfilter-extension.md" >}}).)

### 6.3 같이 검토했으나 보조 수단으로 판단한 것들

| 수단 | 기대 효과 | 원문의 판단 |
| --- | --- | --- |
| `meshConfig.hboneIdleTimeout` 단축 | idle 상태의 stale connection을 더 빨리 정리 | 보조 수단 (기본값 미명시) |
| HTTP/2 keepalive 주기 조정 | 죽은 터널을 keepalive 실패로 조기 감지 | 보조 수단 |
| ztunnel `KEEPALIVE_*` 환경변수 | 커넥션 유지·감지 파라미터 조정 | 커뮤니티 보고상 효과 없어 미채택 |

세 손잡이의 공통 한계는 타이밍 싸움일 뿐 원인을 없애지 못한다는 것입니다. idle timeout을 아무리 줄여도 그보다 짧은 간격으로 Pod가 죽고 IP가 재할당되면 창은 여전히 열립니다. 게다가 과하게 줄이면 정상 트래픽에서도 터널 재수립이 잦아져 지연과 부하가 늘어납니다. 장수 커넥션을 파라미터로만 다스릴 때 생기는 부작용은 [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "../../09-istiod-scaling-connections.md" >}})에서 xDS 커넥션을 두고 다룬 것과 같습니다.

## 7. 결과와 남은 것

채널팀은 waypoint 수준에서 reset에 대한 retry를 적용해 stale connection 재사용으로 인한 문제를 해소했습니다.

이 장애는 어느 한 컴포넌트의 버그가 아니라 **커넥션 재사용(Envoy pool)** · **graceful close의 부재(ztunnel)** · **IP 재사용(IPAM)** 이 겹친 결과입니다. 사이드카 시절과 달리 커넥션을 다루는 주체가 ztunnel과 waypoint로 분리되면서 어느 쪽도 "이 커넥션의 상대가 사라졌다"를 단독으로 알 수 없게 됐습니다.

원문은 sidecar mode에서 같은 문제가 왜 두드러지지 않았는지를 직접 설명하지는 않습니다. 커넥션 관리 주체가 분리됐다는 서술까지가 원문의 범위입니다. 메시가 커넥션을 대신 들고 있다는 것이 어떤 비용을 만드는지는 [01 서비스 메시와 Istio 기초]({{< relref "../../01-mesh-basics.md" >}})에서 다룹니다.

시리즈의 다음 편들은 같은 성격의 함정을 이어서 다룹니다 — [3-2편: Partially Enrolled Pod와 Untaint Controller]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}}), [3-3편: Ambient mode 안전하게 업그레이드하기]({{< relref "03-3-ambient-upgrade-in-place.md" >}}), [3-4편: 507 status code와 istiod disconnected 탐지]({{< relref "03-4-507-istiod-disconnected.md" >}}).

## 이 문서에서 가져갈 것

- hop이 늘어난 메시에서 5xx를 볼 때는 `via_upstream`을 남긴 프록시가 아니라, `response_flags`(`UC` 등)와 구체적인 `response_code_details`를 남긴 프록시부터 조사합니다. 여기서는 waypoint가 시작점이었습니다.
- **커넥션 pool의 키가 곧 장애 반경입니다.** `IP:Port`만으로 pool을 구분하면 IP가 재사용되는 순간 다른 워크로드로 가는 커넥션이 섞입니다. 키에 workload identity나 인스턴스 고유값(Pod UID)이 들어가야 원천 차단됩니다. IP 재사용은 증상 트리거일 뿐이라, 이 구분을 놓치면 IPAM만 만지다가 재발합니다.
- 암호화된 구간의 pcap도 쓸모가 있습니다. 페이로드를 못 읽어도 handshake 유무와 프레임 순서는 보이고 "TLS handshake 없이 data frame이 왔다"는 관찰 하나가 원인을 갈랐습니다.
- Pod 생명주기에 걸친 문제는 캡처 범위도 그만큼 넓혀야 합니다. `NET_RAW`/`NET_ADMIN` sidecar로 SIGTERM 이후 잔여 패킷까지 잡고 pcap을 클러스터 밖(S3)으로 내보내지 않았다면 증거는 Pod와 함께 사라졌습니다.
- retry 확대는 시간을 버는 조치입니다. 멱등성을 확인한 뒤에만 적용하고, 근본 수정(upstream pool key 개선)이 들어오기 전까지의 임시 조치로 관리합니다.

## 소스

- **원문**: [Istio 3-1편: 503과 Half-open Connection](https://tech.channel.io/kr/articles/ambient-mode-troubleshooting-1-82576790) (채널코퍼레이션 기술 블로그, Jetty·정재홍, DevOps팀, 2026-06-26)
- 같은 시리즈 원문: [1편 — 왜 Istio Ambient mode인가?](https://tech.channel.io/ko/articles/tech-istio-ambient-mode-30cdf79a) · [2편 — Envoy config로 해부하는 Ambient mode](https://tech.channel.io/ko/articles/tech-istio-envoy-config-c5193569)
- 원문이 인용한 커뮤니티 논의: [istio/ztunnel#1637](https://github.com/istio/ztunnel/issues/1637) (stale connection 재현 사례) · [istio/ztunnel#1191](https://github.com/istio/ztunnel/issues/1191) (커넥션 생명주기 개선 논의)
- 배경 참고(원문이 링크한 것은 아니며, 용어 확인용): [Istio Ambient 데이터 플레인 아키텍처](https://istio.io/latest/docs/ambient/architecture/data-plane/) · [Istio MeshConfig 레퍼런스](https://istio.io/latest/docs/reference/config/istio.mesh.v1alpha1/) · [Envoy `x-envoy-retry-on` 값 목록](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/router_filter#x-envoy-retry-on) · [Envoy Original destination 클러스터](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/cluster_manager)
