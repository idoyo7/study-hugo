---
title: "장애 이야기: 간헐적 응답 이상"
weight: 5
---

# 05 · 장애 이야기 — 메시가 낀 경로에서 간헐적 응답 이상 추적하기

> **그때 무슨 일이 있었나.** EKS의 한 서비스가 **간헐적으로 응답 이상**(산발적 5xx와 지연)을 냈다. 애플리케이션 로그는 멀쩡해 보이는데 클라이언트는 이따금 실패했다. 요청 경로에 메시가 껴 있으니, "앱이 문제냐"로 끝낼 수 없고 **앱 · 사이드카 · 컨트롤 플레인 · 네트워크**를 층으로 갈라 봐야 했다. 이 블록은 그 추적을 **순서 있는 체크리스트**로 정리한다 — 메시 장애의 나침반은 결국 **Envoy가 붙이는 response flag**다.

> 관련 블록: [01 메시 기초]({{< relref "01-mesh-basics.md" >}}) · [02 컨트롤 플레인]({{< relref "02-istiod-control-plane.md" >}}) · [03 게이트웨이]({{< relref "03-gateway-node-isolation.md" >}})

## 먼저: 5xx는 누가 낸 것인가

메시에서 요청 하나는 프록시를 여러 번 지난다. 그래서 같은 "503"도 **어느 홉에서 났느냐**에 따라 원인이 완전히 다르다.

```mermaid
flowchart LR
  client["client"] --> gw["① ingress GW Envoy"]
  gw --> ss["② source sidecar"]
  ss --> ds["③ dest sidecar"]
  ds --> app["④ app"]
```

앱(④)이 낸 503과, dest 사이드카(③)가 "붙을 상대가 없어서" 낸 503은 전혀 다른 문제다. **이걸 가르는 게 Envoy의 response flag**다. Envoy 액세스 로그의 `%RESPONSE_FLAGS%` 필드에 두세 글자로 찍힌다.

| flag | 의미 | 흔한 원인 |
|---|---|---|
| **UH** | no healthy **U**pstream **H**ost | 대상 서비스에 건강한 엔드포인트가 없음 (EDS 미반영·전부 unready) |
| **UF** | **U**pstream connection **F**ailure | 상대 파드에 연결 자체가 실패 (죽음·네트워크·mTLS 불일치) |
| **UC** | **U**pstream **C**onnection termination | 연결이 중간에 끊김 (앱이 Envoy보다 먼저 keepalive 종료 등) |
| **UO** | **U**pstream **O**verflow | 서킷브레이커·커넥션풀 상한 초과 (DestinationRule) |
| **URX** | **U**pstream **R**etry lime**X**ceeded | 재시도 한도 소진 |
| **NR** | **N**o **R**oute | 매칭되는 라우트 없음 (VirtualService·Gateway 설정 문제) |
| **DC** | **D**ownstream **C**onnection termination | 클라이언트가 먼저 끊음 |

**간헐적** 5xx라면 UH·UC·UF·UO가 단골이다 — 전부 "가끔" 발생하는 성격을 갖는다.

## 추적 순서

### 1) 범위를 좁힌다

무작정 파기 전에 패턴부터 본다. **특정 서비스만? 특정 경로만? 특정 AZ·노드만? 배포 직후에만?** 메트릭 `istio_requests_total`을 `destination_service`, `response_code`, `response_flags`, `source_workload`로 쪼개 본다. 배포 타이밍과 겹치면 라이프사이클 문제(아래 5번)를 먼저 의심한다.

### 2) 어느 홉인지 — 액세스 로그의 response flag

의심 구간의 Envoy 액세스 로그에서 `response_flags`를 확인한다. 이게 **범인이 앱인지 프록시인지, 어느 방향인지**를 즉시 갈라준다.

```bash
# 대상 워크로드 사이드카의 액세스 로그
kubectl logs deploy/<svc> -c istio-proxy | grep ' 503 '
# → RESPONSE_FLAGS 컬럼(UH/UC/UF/UO…)을 본다
```

flag가 없고 앱이 직접 503을 냈다면 그건 앱 문제다. flag가 있으면 아래로 간다.

### 3) 프록시가 든 설정이 최신인가 — proxy-status / proxy-config

간헐적 UH·NR의 흔한 뿌리는 **설정이 stale**인 것이다. 컨트롤 플레인이 밀려([02]({{< relref "02-istiod-control-plane.md" >}})의 수렴 지연) 프록시가 **옛 엔드포인트·라우트**를 들고 있으면, 이미 사라진 파드로 보내다 실패한다.

```bash
istioctl proxy-status                 # 각 프록시가 SYNCED인지 STALE인지
istioctl proxy-config endpoints <pod> # 이 프록시가 아는 실제 엔드포인트 목록
istioctl proxy-config routes <pod>    # 라우팅 규칙이 기대대로인지
```

`STALE`이 보이거나 endpoints가 실제 파드와 다르면 **02의 컨트롤 플레인 문제**로 넘어간다 — `pilot_proxy_convergence_time`을 확인한다.

### 4) mTLS·정책 불일치 — UF의 단골

간헐적 UF는 **mTLS 미스매치**가 잦다. `PeerAuthentication`이 STRICT인데 일부 호출자가 평문이거나, 마이그레이션 중 한쪽만 mTLS면 그쪽 연결이 실패한다. `AuthorizationPolicy`가 특정 조건에서만 막고 있을 수도 있다.

```bash
istioctl proxy-config secret <pod>    # 인증서가 제대로 발급됐는지
# PeerAuthentication / AuthorizationPolicy 범위와 mode 점검
```

### 5) 파드 라이프사이클 레이스 — 배포 직후 간헐 장애의 진짜 원인

간헐적 5xx가 **롤링 배포 시점에 몰린다면** 십중팔구 사이드카-앱 시작·종료 순서 문제다.

- **시작 레이스** — 앱 컨테이너가 사이드카 Envoy보다 먼저 떠서 트래픽을 받으면, 아직 준비 안 된 프록시 때문에 실패한다. → `holdApplicationUntilProxyStarts: true`로 **프록시가 준비될 때까지 앱을 붙잡는다.**
- **종료 레이스** — 파드 종료 시 사이드카가 앱보다 먼저 죽으면, 아직 처리 중이던 요청이 UC로 끊긴다. → preStop 훅에 짧은 `sleep`을 두거나 연결이 빠질 때까지 프록시 종료를 늦추고, **`terminationDrainDuration`**·엔드포인트 제거(readiness)를 맞춘다.
- **엔드포인트 갱신 랙** — 파드가 죽었는데 EDS 갱신이 늦어 UH가 뜬다. → 3번(수렴)과 이어진다. `DestinationRule`의 **outlier detection**으로 문제 엔드포인트를 자동 축출하면 간헐 실패를 데이터 플레인에서 흡수할 수 있다.

### 6) 커넥션풀·서킷브레이커 — UO

간헐적 UO는 `DestinationRule`의 커넥션풀·서킷브레이커 상한에 트래픽이 순간적으로 부딪힌 것이다. 상한이 너무 빡빡한지, 트래픽 특성(버스트)에 맞는지 재검토한다.

## 층으로 가르는 지도

정리하면, 메시 장애는 **네 개 층**으로 갈라 나침반(response flag)을 따라간다.

| 층 | 무엇을 보나 | 도구·지표 |
|---|---|---|
| **앱** | 앱이 직접 낸 에러인가 | 앱 로그, flag 없는 5xx |
| **사이드카(데이터 플레인)** | 연결·라우팅·mTLS·풀 | 액세스 로그 `response_flags`, `istioctl proxy-config` |
| **컨트롤 플레인** | 설정이 stale인가, 수렴이 밀리나 | `istioctl proxy-status`, `pilot_proxy_convergence_time` → [02]({{< relref "02-istiod-control-plane.md" >}}) |
| **네트워크·게이트웨이** | 관문·LB·노드 레벨 | 게이트웨이 Envoy 로그, LB 지표 → [03]({{< relref "03-gateway-node-isolation.md" >}}) |

## 재발 방지 체크리스트

- **라이프사이클** — `holdApplicationUntilProxyStarts`, preStop `sleep`, `terminationDrainDuration`을 표준 템플릿에 박아둔다. (배포 시점 간헐 5xx의 최대 예방책)
- **탄력성** — 적정한 timeout·retry(멱등 요청에 한해), `DestinationRule` outlier detection으로 나쁜 엔드포인트 자동 축출.
- **컨트롤 플레인 여유** — 수렴 시간을 SLO로 관측([02]({{< relref "02-istiod-control-plane.md" >}})). 배포가 몰리는 시간대에 istiod가 밀리지 않는지 본다.
- **관측 표준화** — 액세스 로그에 `%RESPONSE_FLAGS%`를 반드시 포함하고, `istio_requests_total`을 flag·code로 쪼개는 대시보드를 상시 띄워둔다. 나침반이 없으면 매번 처음부터 헤맨다.

## 이 블록에서 가져갈 것

- 메시의 5xx는 **어느 홉에서 났느냐**가 전부고, 그걸 가르는 나침반이 **Envoy response flag**(UH/UF/UC/UO/NR…)다.
- 추적은 **범위 축소 → flag 확인 → 설정 stale 여부 → mTLS → 라이프사이클 레이스 → 커넥션풀** 순서. 간헐적 5xx는 특히 **stale 엔드포인트**와 **배포 시점 라이프사이클 레이스**가 단골이다.
- 예방은 라이프사이클 훅 표준화·탄력성 설정·컨트롤 플레인 수렴 관측·flag 대시보드. 층을 갈라 보는 습관이 메시 장애 대응의 핵심이다.
