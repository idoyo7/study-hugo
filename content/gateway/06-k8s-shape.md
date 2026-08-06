---
title: "k8s 형태 판정 — Deployment로 끝나는 이유와 종료 설계"
linkTitle: "06 k8s 형태 판정"
weight: 6
---

# 06 · k8s 형태 판정 — Deployment로 끝나는 이유와 종료 설계

{{< callout type="info" >}}
**한눈에**
- **두 분기 모두 Deployment로 끝난다.** StatefulSet이 주는 네 가지(안정적 ordinal·네트워크 ID·PVC·순차 롤링) 중 이 워크로드가 쓰는 것이 하나도 없다. Loki ingester가 StatefulSet인 이유는 WAL용 PVC인데, **우리는 디스크에 아무것도 쓰지 않는다.**
- **headless service는 분기 A에서 필요 없다.** 파드 간 직접 통신이 생기는 건 [04 §6]({{< relref "04-branch-a-client-dials/index.md" >}})의 레지스트리 방식으로 전환할 때뿐이다.
- **`terminationGracePeriodSeconds` 기본 30초는 이 워크로드에 짧다.** 파드 하나가 2,500개 SSE 연결을 들고 있고, 그것을 흩어서 끊어야 하므로 종료 절차가 분 단위다.
- **SSE의 `retry:` 필드가 재접속 폭풍의 유일한 프로토콜 레벨 해법이다.** 종료 직전에 커넥션마다 다른 값을 밀어넣으면 2,500대의 재접속이 원하는 창에 흩어진다. WebSocket에는 등가물이 없다.
- **순서가 중요하다** — readiness 실패 → LB 드레이닝 대기 → `retry:` 배포 → 점진적 종료. 이 순서가 틀리면 방금 끊은 연결이 다시 이 파드로 꽂힌다.
- **CPU는 이 워크로드의 HPA 지표로 최악이다.** idle SSE 연결은 CPU를 거의 안 쓴다. **파드당 활성 커넥션 수**를 커스텀 메트릭으로 쓰고, **scale-in은 그 자체가 재접속을 유발하므로** 안정화 창을 길게 잡는다.
- **ALB idle timeout 기본 60초가 하트비트 주기를 정한다.** API Gateway의 10분 제약이 사라지는 대신 이게 들어온다 — **없어지는 게 아니라 이름이 바뀐다.**
- **압축과 버퍼링을 꺼야 한다.** 경로상 어디든 응답을 버퍼링하면 SSE는 "연결은 됐는데 아무것도 안 오는" 상태가 된다. 가장 흔한 SSE 사고다.
{{< /callout >}}

> **왜 이 문서인가.** "StatefulSet이나 headless service로 정의해야 하나"라는 질문에 답하고, 그보다 훨씬 자주 사고를 내는 **종료 설계**를 다룬다. 장수명 연결 게이트웨이에서 배포는 평시 최대 부하 이벤트다 — 아무것도 안 하면 배포할 때마다 5만 대가 동시에 재접속한다.

## 1. 워크로드 종류 판정

| StatefulSet이 주는 것 | 분기 A | 분기 B |
|---|---|---|
| 안정적 ordinal (`gw-0`, `gw-1`) | 쓸 데 없음 | `hash % N` 방식에서만 필요 — [05 §2]({{< relref "05-branch-b-pod-dials/index.md" >}})에서 배제 |
| 안정적 네트워크 ID | 쓸 데 없음 | 멤버십을 Redis/EndpointSlice에서 읽으면 불필요 |
| PVC 고정 | **디스크에 안 씀** | **디스크에 안 씀** |
| 순차 롤링 업데이트 | 오히려 느림 | 재배정이 N번 순차 발생 — 불리 |

**둘 다 Deployment다.**

| Service 종류 | 언제 필요한가 |
|---|---|
| ClusterIP | 내부 서비스가 게이트웨이 API를 부를 때. 분기 A의 기본 |
| **LoadBalancer / Ingress** | POS 인바운드 종단. 분기 A 필수 |
| **headless** | **파드 간 직접 통신이 생길 때만** — [04 §6]({{< relref "04-branch-a-client-dials/index.md" >}})의 레지스트리 방식, 또는 부트스트랩용 피어 발견 |

분기 A의 기본 구성에서 headless service는 **필요 없다.** 이 사실이 놀랍다면, 그건 [03]({{< relref "03-platform-precedents.md" >}})의 결론이 그대로 반영된 것이다 — 파드끼리 나눠 가질 상태가 없으면 파드끼리 통신할 이유도 없다.

## 2. 종료 설계 — 이 문서의 본론

### 2.1 아무것도 안 하면 무슨 일이 일어나나

파드에 `SIGTERM`이 가고 30초 뒤 `SIGKILL`이다. 그 사이 SSE 응답 스트림이 끊기고, 2,500대의 POS가 **각자의 기본 재연결 지연(수 초)으로 거의 동시에** 다시 붙는다. 롤링 업데이트로 파드 20개가 순차 교체되면 이 파동이 20번 반복된다.

더 나쁜 것은 **타이밍이 겹칠 때다.** 파드가 아직 LB 타깃 목록에서 빠지지 않은 상태에서 연결을 끊으면, 방금 끊긴 POS가 **같은 파드로 다시 꽂힌다.** 그리고 그 파드는 곧 죽는다.

### 2.2 올바른 순서

```
1. preStop 시작
2. readiness probe 를 실패로 전환          ← LB 타깃에서 빠지기 시작
3. LB 드레이닝 완료까지 대기 (deregistration delay)
4. 기존 연결에 retry: <jitter> 이벤트 전송   ← 재접속 시각을 흩는다
5. 연결을 점진적으로 종료
6. 프로세스 종료
```

**2와 3이 4보다 먼저**여야 한다. 그래야 끊긴 연결이 이 파드로 되돌아오지 않는다.

```yaml
spec:
  terminationGracePeriodSeconds: 180
  containers:
    - name: gateway
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "touch /tmp/shutdown && sleep 5"]
      readinessProbe:
        httpGet: { path: /readyz, port: 8080 }
        periodSeconds: 2
        failureThreshold: 1
```

`/readyz`는 `/tmp/shutdown`이 있으면 즉시 실패를 반환한다. 나머지(4~5단계)는 애플리케이션이 `SIGTERM` 핸들러에서 수행한다 — preStop이 끝나야 `SIGTERM`이 가므로 순서가 보장된다.

`terminationGracePeriodSeconds`는 **드레이닝 대기 + 흩는 창 + 여유**보다 커야 한다. 기본 30초로는 어림없다.

### 2.3 `retry:` — SSE가 WebSocket보다 나은 지점

[WHATWG 명세](https://html.spec.whatwg.org/multipage/server-sent-events.html)는 `retry:` 필드를 이렇게 규정한다 — *"If the field value consists of only ASCII digits, then interpret the field value as an integer in base ten, and set the event stream's reconnection time to that integer."*

**서버가 클라이언트의 재연결 지연을 지시할 수 있다.** 종료 직전에 커넥션마다 다른 값을 밀면 재접속이 흩어진다.

```kotlin
// SIGTERM 핸들러: 연결마다 서로 다른 재연결 지연을 배포한다
val window = 60_000  // 60초 창에 흩는다
connections.forEach { conn ->
    conn.writeRaw("retry: ${Random.nextInt(1_000, window)}\n\n")
}
```

2,500대가 60초 창에 흩어지면 초당 약 42건이다. 파드 20개가 순차 교체돼도 각 파동이 그 정도에 머문다.

**WebSocket에는 이에 해당하는 표준 필드가 없다.** 애플리케이션 메시지로 같은 걸 만들 수는 있지만, 그건 클라이언트가 그 메시지를 이해하도록 우리가 만들어야 한다는 뜻이다. SSE에서는 프로토콜이 이미 정의한 동작이다.

> **[Valkey / 2,000노드에서 부러지는 것]({{< relref "../valkey/cluster-xl-scale/01-부러지는-것/index.md" >}})** 에서 본 것과 같은 종류의 폭풍이다. 그쪽은 primary 수백 개를 동시에 죽였을 때 재접속 경로가 먼저 부러졌고, 여기서는 그것이 배포마다 정기적으로 온다.

### 2.4 점진적 종료

`retry:`를 배포한 뒤에도 연결을 한꺼번에 끊으면, POS들은 흩어진 시각에 재접속하지만 **끊기는 순간은 동시**다. 그 순간 서버 측 소켓 정리와 클라이언트 측 오류 처리가 몰린다.

끊는 것도 흩는다.

```
초당 N개씩 close → 2,500개 / 100개/초 = 25초
```

이 25초가 `terminationGracePeriodSeconds` 예산에 포함된다.

## 3. PodDisruptionBudget

```yaml
spec:
  maxUnavailable: 2
  selector:
    matchLabels: { app: pos-gateway }
```

`maxUnavailable: 1`이면 가장 안전하지만, 파드 하나 드레이닝에 90초가 걸리고 20개면 **롤링 업데이트가 30분**이다. 2~3이 현실적인 절충이다.

**노드 드레인(karpenter consolidation, 노드 업그레이드)도 이 예산을 따른다는 점이 중요하다.** PDB가 없으면 consolidation이 게이트웨이 파드 여러 개를 한꺼번에 걷어간다.

> 관련: [Karpenter / disruption budgets]({{< relref "../karpenter/08-disruption-budgets/index.md" >}}) — 노드 측 예산과 파드 측 예산은 별개로 걸린다.

## 4. HPA — CPU를 쓰지 마라

idle SSE 연결은 CPU를 거의 소비하지 않는다. 파드가 2,500개 연결을 들고 CPU 3%를 쓰다가, 커넥션 5,000개에서 메모리·FD 한계로 죽는다. **CPU 기반 HPA는 그 지점까지 아무 반응도 하지 않는다.**

```yaml
metrics:
  - type: Pods
    pods:
      metric: { name: sse_active_connections }
      target: { type: AverageValue, averageValue: "2500" }
behavior:
  scaleDown:
    stabilizationWindowSeconds: 900
    policies:
      - type: Pods
        value: 1
        periodSeconds: 300
  scaleUp:
    stabilizationWindowSeconds: 60
```

**scale-in을 극도로 보수적으로 잡는 이유는 축소가 곧 재접속이기 때문이다.** 파드 하나를 걷으면 2,500대가 재접속한다. 부하가 잠깐 내려갔다고 축소했다가 다시 확장하면, 그 왕복이 5,000대의 재접속을 만든다.

분기 B에서는 **HPA를 아예 붙이지 않는 편이 낫다** — 스케일 이벤트마다 링 리밸런싱이 발생한다([05 §6]({{< relref "05-branch-b-pod-dials/index.md" >}})).

## 5. 로드밸런서와 idle timeout

API Gateway의 `Idle Connection Timeout: 10 minutes`는 없어지는 게 아니라 **이름이 바뀐다.**

| 계층 | 기본값 | 조정 |
|---|---|---|
| **ALB idle timeout** | 60초 | 1~4000초 |
| **NLB TCP idle timeout** | 350초 | 조정 가능(대역 제한 있음) |
| 매장 라우터 NAT 세션 | 알 수 없음 | **우리가 못 고침** |
| 중간 프록시·WAF | 제각각 | 경로마다 확인 |

**하트비트 주기는 이 중 가장 짧은 값보다 짧아야 한다.** ALB 기본 60초를 그대로 쓴다면 하트비트는 20~30초다.

SSE에서 하트비트는 주석 줄 하나면 된다.

```
: ping

```

`:`로 시작하는 줄은 명세상 무시되므로 클라이언트 이벤트 핸들러를 건드리지 않는다. **`data:` 이벤트로 ping을 보내면 클라이언트가 그것을 이벤트로 처리해야 하고, `id:`를 붙이면 last event ID까지 오염된다.** 주석 줄이 맞다.

**ALB idle timeout을 크게 늘리는 대신 하트비트를 성기게 하는 방향은 권하지 않는다.** 매장 회선 중간 장비의 NAT 세션 타임아웃은 우리가 모르고 조정할 수도 없다. 짧은 하트비트가 그것까지 함께 방어한다.

### 5.1 deregistration delay

타깃 그룹의 `deregistration_delay.timeout_seconds` 기본값은 300초다. §2.2의 3단계가 이 값을 기다린다. 게이트웨이용 타깃 그룹은 **30초 정도로 줄여야** 종료 절차가 현실적인 길이가 된다 — 어차피 우리는 그 뒤에 직접 연결을 끊으므로 LB가 오래 기다릴 이유가 없다.

## 6. 버퍼링과 압축 — 가장 흔한 SSE 사고

경로상 어느 컴포넌트든 응답을 버퍼링하면, **연결은 성립하는데 이벤트가 도착하지 않는다.** 그리고 버퍼가 찰 때 뭉텅이로 도착한다. 원인 파악이 오래 걸리는 종류의 사고다.

점검 목록:

| 지점 | 조치 |
|---|---|
| nginx / ingress-nginx | `proxy_buffering off;` 또는 응답에 `X-Accel-Buffering: no` |
| 응답 압축 (gzip/br) | **끈다.** 압축은 본질적으로 버퍼링이다 |
| ALB | 응답 버퍼링 없음 — 문제되지 않음 |
| CloudFront 등 CDN | **경로에서 뺀다.** SSE를 태울 이유가 없다 |
| 애플리케이션 프레임워크 | flush 정책 확인 — [07]({{< relref "07-kotlin-notes.md" >}}) |

응답 헤더는 이렇게 나가야 한다.

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

## 7. 커넥션이 소비하는 것

| 자원 | 파드당 (2,500 연결) | 확인 지점 |
|---|---|---|
| 파일 디스크립터 | 2,500+ | 컨테이너 `nofile` 상한. 런타임 기본값이 낮으면 조정 |
| 소켓 버퍼 (커널) | 연결당 수~수십 KB | `net.ipv4.tcp_rmem/wmem` |
| 힙 (JVM) | **실측 필요** — [07]({{< relref "07-kotlin-notes.md" >}}) | 연결당 sink + 큐 |
| 노드 conntrack | 노드에 몰린 총 연결 수 | `nf_conntrack_max` |

**힙은 반드시 실측한다.** "연결당 몇 KB"는 프레임워크·버퍼 정책·큐 상한에 따라 한 자릿수 배 차이가 난다. 부하 시험 없이 파드 수를 정하면 안 된다.

## 8. AZ 분산

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels: { app: pos-gateway }
```

AZ 하나가 나가면 그 AZ의 연결이 전부 끊기고 재접속한다. 3-AZ 균등이면 그게 1/3이다. **AZ가 기울어 있으면 그만큼 한 번에 재접속하는 규모가 커진다.**

분기 A에서는 이게 유일한 AZ 고려사항이다 — 파드가 상태를 안 들고 있으므로 어느 AZ에 몇 개가 있든 정합성 문제가 없다.

## 9. 체크리스트

- [ ] Deployment (StatefulSet 아님) — §1
- [ ] `terminationGracePeriodSeconds` ≥ 드레이닝 + 흩는 창 + 여유 — §2.2
- [ ] preStop → readiness 실패 → 드레이닝 대기 → `retry:` 배포 → 점진 종료 순서 — §2.2
- [ ] `retry:` jitter 창을 재접속률 목표에서 역산 — §2.3
- [ ] PDB `maxUnavailable` — 롤링 총 소요시간과 함께 결정 — §3
- [ ] HPA는 커넥션 수 기준, scale-in 안정화 창 길게 — §4
- [ ] 하트비트 주기 < ALB idle timeout — §5
- [ ] deregistration delay 축소 — §5.1
- [ ] 압축·버퍼링 전 경로 확인 — §6
- [ ] `nofile` 상한, conntrack — §7
- [ ] 힙 실측 후 파드 수 결정 — §7
- [ ] AZ topology spread — §8
