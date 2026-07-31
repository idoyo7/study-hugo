---
title: "Istio의 Envoy 조립"
weight: 13
---

# 13 · Istio의 Envoy 조립 — proxyv2 이미지부터 CRD 번역까지

{{< callout type="info" >}}
**한눈에**
- `proxyv2`에는 바이너리가 둘 들어 있고(Envoy · pilot-agent), 그 Envoy조차 upstream 그대로가 아니다 — istio/proxy가 확장을 함께 컴파일해 만든 빌드다.
- `istio_requests_total`과 `source_*`/`destination_*` 라벨은 컨트롤 플레인이 아니라 **프록시 안에 컴파일된 확장**이 만든다. Mixer가 사라졌다는 말의 실질이 이것이다.
- CRD는 xDS 리소스로 번역된다 — VirtualService→route, DestinationRule→cluster, Gateway→listener. 번역 결과는 추측하지 말고 `istioctl proxy-config`로 본다.
- Istio 빌드는 Envoy의 **특정 커밋에 pin**된다. 사이드카 업그레이드가 곧 Envoy 업그레이드이고, 그 버전은 릴리스 노트가 아니라 파드에 물어봐야 안다.
- 이미지에 박힌 내장 확장과 CRD로 얹는 사용자 확장([08]({{< relref "08-envoyfilter-extension.md" >}}))은 **바꾸는 방법이 다르다**. 전자는 이미지 교체로만, 후자는 설정으로.
{{< /callout >}}

"Istio는 Envoy를 쓴다"는 문장은 어디에나 있지만, '쓴다'가 무엇인지는 잘 안 적혀 있다. [12]({{< relref "12-envoy-capabilities.md" >}})가 Envoy 자체의 능력을 훑었다면, 이 문서는 그 위에 Istio가 무엇을 더 얹었는지를 본다. 답은 두 층이다. **아래층은 컴파일 시점** — Istio는 upstream Envoy 바이너리를 받아 쓰는 게 아니라 자기 확장을 넣어 다시 빌드한다. **위층은 런타임** — istiod가 CRD를 Envoy 설정으로 번역해 xDS로 내려보낸다.

파드 안에서 그 둘이 어떻게 배선되는지(부트스트랩·SDS·xDS 중계)는 [11]({{< relref "11-request-path-anatomy.md" >}})에 있다. 여기서는 배선이 아니라 **부품의 출처**를 다룬다.

> 관련 문서: [11 요청 경로 해부]({{< relref "11-request-path-anatomy.md" >}})(파드 안의 배선) · [12 Envoy의 능력]({{< relref "12-envoy-capabilities.md" >}}) · [06 관측성]({{< relref "06-observability-points.md" >}})(여기서 만들어진 지표를 쓰는 쪽) · [08 EnvoyFilter]({{< relref "08-envoyfilter-extension.md" >}})(사용자 확장) · [02 컨트롤 플레인]({{< relref "02-istiod-control-plane.md" >}})

## 1. proxyv2 해부 — 컨테이너 하나에 든 두 바이너리

사이드카 컨테이너의 이미지 이름은 `proxy`가 아니라 `proxyv2`다. 그 안에는 바이너리가 둘 들어간다. istio/istio 레포의 `Dockerfile.proxyv2`가 그대로 보여준다.

```dockerfile
COPY ${TARGETARCH:-amd64}/${SIDECAR} /usr/local/bin/${SIDECAR}
COPY ${TARGETARCH:-amd64}/pilot-agent /usr/local/bin/pilot-agent
ENTRYPOINT ["/usr/local/bin/pilot-agent"]
```

`SIDECAR`가 `envoy`다. 즉 이미지는 Envoy와 pilot-agent를 함께 담고, **컨테이너가 뜰 때 실행되는 것은 pilot-agent 쪽**이다. Envoy는 PID 1이 아니라 agent가 기동하고 관리하는 프로세스다. [11]({{< relref "11-request-path-anatomy.md" >}})에서 "Envoy는 istiod에 직접 붙지 않는다"고 한 구조가 이미지 레벨에서부터 이렇게 정해져 있다.

그리고 여기 실린 `envoy`가 upstream 바이너리가 아니다. istio/proxy 레포의 README가 자기 정의를 이렇게 쓴다.

> The Istio Proxy is a microservice proxy that can be used on the client and server side, and forms a microservice mesh. **It is based on Envoy with the addition of several policy and telemetry extensions.**

istio.io 아키텍처 문서도 같은 말을 한 줄로 한다 — "Istio uses an extended version of the Envoy proxy." 그 "extended"의 구현이 istio/proxy의 빌드다. `WORKSPACE` 파일이 `ENVOY_SHA` / `ENVOY_SHA256`으로 envoyproxy/envoy의 **특정 커밋을 못 박아** 받아오고, 거기에 Istio 확장 소스를 함께 컴파일한다.

{{< flow caption="proxyv2 이미지가 만들어지는 경로 — Envoy는 커밋 단위로 pin되어 확장과 함께 컴파일되고, pilot-agent는 별도로 실려 엔트리포인트가 된다." >}}
{
  "nodes": [
    { "id": "UE", "col": 0, "row": 0, "label": "upstream Envoy", "sub": "envoyproxy/envoy 특정 커밋", "kind": "store" },
    { "id": "EX", "col": 0, "row": 1, "label": "Istio 확장", "sub": "metadata exchange · stats · ALPN", "kind": "store" },
    { "id": "B", "col": 1, "row": 0, "label": "istio/proxy 빌드", "sub": "WORKSPACE의 ENVOY_SHA로 고정", "kind": "proc" },
    { "id": "PA", "col": 1, "row": 1, "label": "pilot-agent", "sub": "istio/istio에서 빌드", "kind": "store" },
    { "id": "IM", "col": 2, "row": 0, "label": "proxyv2 이미지", "sub": "ENTRYPOINT = pilot-agent", "kind": "sink" }
  ],
  "edges": [
    { "from": "UE", "to": "B", "label": "pin", "rate": 700 },
    { "from": "EX", "to": "B", "label": "함께 컴파일", "rate": 700 },
    { "from": "B", "to": "IM", "label": "envoy", "rate": 700 },
    { "from": "PA", "to": "IM", "label": "그대로 COPY", "rate": 700 }
  ]
}
{{< /flow >}}

한 가지 방향성은 짚어둘 만하다. istio/proxy README에는 2024-04-17 워크그룹 결론으로 **"New extensions are not added unless they are part of core APIs"**라는 방침이 명시돼 있다. 확장을 무한정 늘리는 레포가 아니라, 이미 들어간 것을 유지하고 신규 추가에는 심사를 거는 쪽이다.

## 2. Istio가 심는 확장 — 표준 메트릭이 만들어지는 곳

[06]({{< relref "06-observability-points.md" >}})은 `istio_requests_total`과 그 표준 라벨을 "공짜로 나온다"고 정리했다. 그 공짜가 어디서 만들어지는지가 이 절이다. 만드는 주체는 컨트롤 플레인이 아니라 **프록시 안에 컴파일된 필터들**이다.

| 계층 | 필터 | 하는 일 |
|---|---|---|
| 네트워크(TCP) | `envoy.filters.network.metadata_exchange` | 커넥션 위에서 피어 메타데이터를 주고받는다 |
| HTTP | `envoy.wasm.metadata_exchange` | 헤더로 피어 메타데이터를 주고받는다 |
| HTTP | `envoy.wasm.stats` | 표준 메트릭을 생성한다 |

네트워크 계층 필터의 설정 이름은 `istio.metadata_exchange`다. HTTP 계층의 두 필터는 `envoy.filters.http.wasm`으로 래핑된 같은 wasm 필터다.

### peer metadata exchange — `source_*` / `destination_*` 라벨의 출처

메트릭에 `destination_workload` 같은 라벨이 붙으려면 프록시가 **상대가 누구인지** 알아야 한다. 그런데 프록시가 직접 아는 것은 자기 워크로드 정보뿐이다. 그래서 두 사이드카가 요청 경로 위에서 서로의 메타데이터를 교환한다.

교환 채널은 계층마다 다르다.

- **협상** — mTLS 핸드셰이크에서 `istio-peer-exchange`라는 ALPN 프로토콜을 클라이언트·서버 사이드카가 우선협상한다. 이걸 끄는 스위치(`PILOT_DISABLE_MX_ALPN`)가 Istio 1.20에서 도입됐다.
- **TCP** — magic byte 뒤에 length-prefixed protobuf payload를 실어 보낸다.
- **HTTP** — `x-envoy-peer-metadata-id` / `x-envoy-peer-metadata` 헤더로 나른다.

{{< seq caption="두 사이드카가 서로의 정체를 교환하고, 그 결과가 각자의 스탯 필터에서 라벨이 된다." >}}
{
  "participants": [
    {"id": "CS", "label": "소스 사이드카"},
    {"id": "DS", "label": "목적지 사이드카"}
  ],
  "steps": [
    {"note": ["CS", "DS"], "lines": ["둘 다 같은 proxyv2 — 같은 확장이 컴파일되어 있다"]},
    {"msg": ["CS", "DS"], "label": "1. mTLS 핸드셰이크에서 ALPN istio-peer-exchange 협상"},
    {"msg": ["CS", "DS"], "label": "2. HTTP면 x-envoy-peer-metadata 헤더로 자기 메타데이터"},
    {"msg": ["DS", "CS"], "label": "3. 상대 메타데이터", "dashed": true},
    {"note": ["CS", "DS"], "lines": ["TCP는 magic byte + length-prefixed protobuf로", "같은 것을 교환한다"]},
    {"note": ["CS", "DS"], "lines": ["stats 필터가 양쪽에서 각자 메트릭을 만든다", "source_* / destination_* 라벨이 여기서 채워진다"]}
  ]
}
{{< /seq >}}

[11]({{< relref "11-request-path-anatomy.md" >}})에서 "mTLS가 꺼져 있으면 TCP 지표의 상대 워크로드 라벨이 빈다"고 한 것의 이유가 이 그림이다. 협상이 mTLS 핸드셰이크에 얹혀 있으니, 핸드셰이크가 없으면 교환도 없고, 교환이 없으면 라벨을 채울 재료가 없다.

### telemetry v2 — 메트릭 생성이 프록시 안으로 들어온 것

`envoy.wasm.stats` 필터가 표준 메트릭을 **프록시 안에서** 만든다. 이름이 "v2"인 이유는 v1이 따로 있었기 때문이다. 예전에는 Mixer라는 별도 텔레메트리 컴포넌트가 그 역할을 했고, 그것이 제거되면서 생성 지점이 프록시로 옮겨왔다. 운영 관점에서 이 이동의 의미는 하나로 압축된다 — **메트릭이 나오는 데 컨트롤 플레인 쪽 컴포넌트가 관여하지 않는다.** 지표가 안 보이면 istiod가 아니라 그 프록시를 봐야 한다.

{{< callout type="important" >}}
**Mixer가 제거된 릴리스는 이 문서에서 확정하지 않는다.** 참고한 자료들이 Istio 1.4와 1.5를 엇갈려 지목한다. 사내 문서에 버전을 적어야 한다면 istio.io의 해당 릴리스 upgrade/change notes 원문에서 직접 대조할 것. 확실한 것은 제거됐다는 사실과, 지금의 생성 지점이 프록시라는 것뿐이다.
{{< /callout >}}

이 확장들이 만드는 것을 **조정하는** 창구는 따로 있다. Telemetry API가 그것이고, 레퍼런스의 자기 정의가 정확하다 — "Telemetry defines how telemetry (metrics, logs and traces) is generated for workloads within a mesh." 워크로드·네임스페이스·메시 전역 계층으로 적용되며, [06]({{< relref "06-observability-points.md" >}})의 카디널리티 정리 작업이 실제로 건드리는 대상이 이 절의 stats 필터다.

## 3. CRD → Envoy 설정 번역표

두 번째 층은 런타임이다. 아키텍처 문서가 번역의 주체와 시점을 한 문장으로 말한다.

> Istiod converts high level routing rules that control traffic behavior into Envoy-specific configurations, and propagates them to the sidecars at runtime.

xDS가 어떤 종류로 나뉘고 그 push가 왜 istiod CPU가 되는지는 [02]({{< relref "02-istiod-control-plane.md" >}})에 있다. 여기서는 **어느 CRD가 어느 리소스가 되는가**만 본다.

| Istio CRD | 번역되는 Envoy 리소스 | 무엇이 정해지나 | 번역 결과 확인 |
|---|---|---|---|
| `VirtualService` | **route** | 매칭 규칙, 가중치 분배, 재시도·타임아웃 | `istioctl proxy-config route <pod>` |
| `DestinationRule` | **cluster** | 로드밸런싱, 커넥션 풀 상한, outlier detection | `istioctl proxy-config cluster <pod>` |
| `Gateway` | **listener** | 받을 포트·프로토콜·호스트·TLS | `istioctl proxy-config listener <pod>` |
| `PeerAuthentication` | **transport socket** | 인바운드가 mTLS를 요구하는가 | listener·cluster 덤프를 `-o json`으로 |

`istioctl proxy-config`의 서브커맨드 이름이 그대로 `route`·`cluster`·`listener`라는 점이 이 표의 실용적인 근거다. Istio가 만드는 설정을 Envoy 쪽 리소스 타입 이름으로 부르는 것이 공식적으로 통용된다는 뜻이고, 그래서 **"이 CRD가 정말 반영됐나"를 묻는 가장 짧은 답은 해당 서브커맨드를 한 번 치는 것**이다.

```bash
# "내 VirtualService가 반영됐나" — 매칭 규칙과 가중치가 route에 있는지
istioctl proxy-config route <pod>.<ns>

# "DestinationRule의 커넥션 풀·outlier가 걸렸나" — cluster 쪽을 본다
istioctl proxy-config cluster <pod>.<ns>

# "Gateway가 이 포트를 정말 열었나" — listener 목록
istioctl proxy-config listener <pod>.<ns>

# 필드 수준까지 봐야 하면(mTLS의 transport socket 등) JSON으로
istioctl proxy-config listener <pod>.<ns> -o json
```

순서가 곧 진단 순서이기도 하다. route에 규칙이 없으면 VirtualService가 이 프록시까지 오지 않은 것이고([11]({{< relref "11-request-path-anatomy.md" >}})의 `gateways` 필드 실수가 대표적이다), route는 맞는데 동작이 다르면 그 다음 층인 cluster를 본다.

`DestinationRule`이 특히 [12]({{< relref "12-envoy-capabilities.md" >}})와 직결된다. 레퍼런스의 정의는 "DestinationRule defines policies that apply to traffic intended for a service after routing has occurred"이고, 거기서 구성하는 것이 load balancing·connection pool·outlier detection이다. 즉 12에서 Envoy의 능력으로 소개한 서킷브레이커와 outlier detection은 새로 만들어지는 기능이 아니라 **이미 프록시에 있는 기능을 켜는 스위치**이고, 그 스위치가 `DestinationRule`이다. 라우팅이 끝난 뒤에 적용된다는 순서까지 정의에 박혀 있다 — 어느 cluster로 갈지는 route가 정하고, 그 cluster를 어떻게 다룰지는 DestinationRule이 정한다.

{{< callout type="important" >}}
**이 표의 두 칸은 방증이다.** ① 'VirtualService→route, DestinationRule→cluster, Gateway→listener'를 1:1로 못 박은 istio.io 문장은 찾지 못했다. 개념 문서(architecture · traffic-management · destination-rule)와 `istioctl proxy-config` 서브커맨드 이름을 겹쳐 얻은 대응이다. ② `PeerAuthentication`이 Envoy의 transport socket으로 번역된다는 것도 마찬가지다. 'transport socket'(`envoy.transport_sockets.tls`)은 envoyproxy.io 쪽 용어이고, istio.io는 "Envoy requests the certificate and key from the Istio agent… via the SDS API", "client side Envoy starts a mutual TLS handshake with the server side Envoy"까지만 말한다. 필드 이름 수준의 연결은 실제 설정 덤프로 확인할 것.
{{< /callout >}}

## 4. 버전 결합 — 사이드카 업그레이드가 곧 Envoy 업그레이드

1절의 `ENVOY_SHA`가 운영에서 갖는 의미가 이것이다. istio/proxy가 Envoy를 **커밋 단위로 pin해서** 빌드하므로, Istio 릴리스 하나는 Envoy 커밋 하나에 묶인다. 결과는 단순하다.

- 사이드카 이미지 태그를 올리는 것은 Istio 버전만 올리는 게 아니라 **데이터 플레인의 Envoy를 통째로 교체**하는 일이다.
- 그러니 Envoy 쪽 동작 변화(설정 필드 deprecation, 필터 이름 변경 등)가 컨트롤 플레인 업그레이드가 아니라 **워크로드 재시작 시점에** 나타난다.
- [08]({{< relref "08-envoyfilter-extension.md" >}})이 "EnvoyFilter는 업그레이드에 깨진다"고 한 근거가 여기다. 날것의 Envoy 설정은 pin된 그 커밋의 스키마에 결합돼 있다.

그런데 **그 Envoy 버전이 무엇인지를 릴리스 노트에서 찾을 수는 없다.** 이 점은 오해하기 쉬우니 분명히 해둔다. istio/istio 이슈 #43140이 정확히 "릴리스 노트에 Envoy 버전을 적어달라"고 요청했고, 결론은 릴리스 노트가 아니라 **진단 문서에 조회 방법을 추가**하는 쪽이었다. 실제로 1.22·1.24·1.30 announcing 페이지 본문에는 Envoy 버전 숫자가 없다.

공식이 안내하는 방법은 돌고 있는 파드에 직접 묻는 것이다.

```bash
kubectl exec <pod> -c istio-proxy -- pilot-agent request GET server_info
```

운영 관점에서 이건 오히려 나은 계약이다. 문서에 적힌 숫자가 아니라 **실제로 그 파드에서 돌고 있는 것**을 읽기 때문이다. 사이드카 이미지가 섞여 있는 클러스터(revision 카나리 중이거나, 재시작이 밀린 워크로드가 남았거나)에서는 "우리 메시의 Envoy 버전"이 단수가 아니다.

## 5. 확장의 두 계층 — 어디까지가 이 문서인가

지금까지 본 확장은 전부 **이미지에 박혀 있는 것**이다. 사용자가 켜고 끄는 대상이 아니라, 그 proxyv2를 쓰는 이상 이미 거기 있다. 반대편에 [08]({{< relref "08-envoyfilter-extension.md" >}})이 다루는 계층이 있다.

| | 내장 확장 (이 문서) | 사용자 확장 ([08]) |
|---|---|---|
| 무엇 | metadata exchange · stats · ALPN | EnvoyFilter 패치 · WasmPlugin |
| 언제 들어가나 | istio/proxy 빌드 시점(컴파일) | 런타임(xDS로 내려가는 설정) |
| 바꾸는 방법 | 이미지 교체 = Istio 업그레이드 | CRD 수정 |
| 조정 창구 | Telemetry API로 동작만 조정 | CRD 자체가 곧 정의 |
| 신규 추가 | 워크그룹 심사(core API 여부) | 사용자 재량 |

경계는 이렇게 읽으면 된다. **내장 확장은 버전의 문제이고, 사용자 확장은 설정의 문제다.** 표준 메트릭이 이상하면 되돌릴 레버는 CRD가 아니라 이미지 버전과 Telemetry API 쪽이고, 반대로 EnvoyFilter로 얹은 것이 깨졌다면 원인은 대개 4절의 결합 — 이미지가 바뀌면서 그 아래 Envoy 스키마가 같이 바뀐 것 — 이다.

그리고 이 경계가 [08]의 선택 사다리에 한 칸을 더해 준다. 표준 CRD → 상위 API → EnvoyFilter라는 순서 앞에, **"이미 프록시 안에 있는 것으로 되는가"**를 먼저 묻는 칸이다. 관측성 요구의 상당수가 여기서 끝난다 — 새 필터를 붙일 일이 아니라 이미 도는 stats 필터를 Telemetry API로 조정할 일이기 때문이다.

## 이 문서에서 가져갈 것

- Istio가 Envoy를 "쓴다"는 것은 **커밋을 pin해서 자기 확장과 함께 다시 빌드한다**는 뜻이다. proxyv2는 그 결과물과 pilot-agent를 한 이미지에 담은 것이고, 엔트리포인트는 pilot-agent다.
- 표준 메트릭과 그 `source_*`/`destination_*` 라벨은 **프록시 안의 확장**이 만든다. 라벨을 채우는 재료는 mTLS 위에서 교환되는 피어 메타데이터이므로, mTLS가 없으면 라벨도 없다.
- CRD는 xDS 리소스로 번역된다. 반영 여부를 묻는 가장 짧은 답은 `istioctl proxy-config route|cluster|listener`이고, `DestinationRule`은 [12]({{< relref "12-envoy-capabilities.md" >}})의 기능들을 켜는 cluster 쪽 스위치다.
- **사이드카 업그레이드는 Envoy 업그레이드다.** 실제 버전은 릴리스 노트가 아니라 `pilot-agent request GET server_info`로 파드에 물어본다.

## 소스

- istio/istio — **Dockerfile.proxyv2** (Envoy와 pilot-agent를 함께 COPY, `ENTRYPOINT`는 pilot-agent): <https://github.com/istio/istio/blob/master/pilot/docker/Dockerfile.proxyv2>
- istio/proxy — **README** ("It is based on Envoy with the addition of several policy and telemetry extensions", 2024-04-17 워크그룹의 신규 확장 추가 방침): <https://github.com/istio/proxy/blob/master/README.md>
- istio/proxy — **WORKSPACE** (`ENVOY_SHA`/`ENVOY_SHA256`로 envoyproxy/envoy 커밋 pin): <https://github.com/istio/proxy/blob/master/WORKSPACE>
- Istio 공식 문서 — **Architecture** ("Istio uses an extended version of the Envoy proxy", "Istiod converts high level routing rules… and propagates them to the sidecars at runtime"): <https://istio.io/latest/docs/ops/deployment/architecture/>
- istio/istio 이슈 **#25176** (metadata exchange·stats 필터 이름, ALPN `istio-peer-exchange`, TCP magic byte / HTTP `x-envoy-peer-metadata` 헤더, `PILOT_DISABLE_MX_ALPN`): <https://github.com/istio/istio/issues/25176>
- Istio 공식 레퍼런스 — **DestinationRule** ("policies that apply to traffic… after routing has occurred", load balancing·connection pool·outlier detection): <https://istio.io/latest/docs/reference/config/networking/destination-rule/>
- Istio 공식 문서 — **Traffic Management (concepts)** (VirtualService의 routing rules, Gateway가 적용되는 대상): <https://istio.io/latest/docs/concepts/traffic-management/>
- Istio 공식 레퍼런스 — **Telemetry API** ("Telemetry defines how telemetry (metrics, logs and traces) is generated for workloads within a mesh"): <https://istio.io/latest/docs/reference/config/telemetry/>
- Istio 공식 문서 — **Proxy debug (What Envoy version is Istio using?)** (`pilot-agent request GET server_info`): <https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/#what-envoy-version-is-istio-using>
- istio/istio 이슈 **#43140** (릴리스 노트에 Envoy 버전을 싣는 대신 진단 문서로 안내하기로 한 경위): <https://github.com/istio/istio/issues/43140>
- Istio 공식 문서 — **Security (concepts)** (SDS로 인증서 전달, 사이드카 간 mutual TLS 핸드셰이크 — transport socket이라는 용어는 istio.io가 쓰지 않는다): <https://istio.io/latest/docs/concepts/security/>
