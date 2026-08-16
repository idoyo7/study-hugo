---
title: "문제의 형태 — API Gateway를 떠나는 진짜 이유"
linkTitle: "01 문제의 형태"
weight: 1
---

# 01 · 문제의 형태 — API Gateway를 떠나는 진짜 이유

{{< callout type="info" >}}
**한눈에**
- **`Connection duration for WebSocket API: 2 hours` · `Can be increased: No`.** 이것이 이 전환의 유일한 구조적 논거입니다. 상시 연결이 전제인 단말에 2시간마다 강제 종료가 걸립니다.
- **비용 논거는 성립하지 않습니다.** 5만 대 상시 연결의 connection-minutes는 **월 $540**입니다. "비싸서 나간다"고 쓰면 첫 질문에서 무너집니다. 정확히는 *싸지만 맞지 않습니다.*
- **2시간 종료가 비싼 이유는 쿼터가 아니라 재동기화입니다.** 재접속률 자체는 초당 7건으로 500/s 쿼터의 1.4%에 불과하입니다. 진짜 비용은 **재개 메커니즘이 없으면 2시간마다 5만 대가 전량 재동기화한다**는 것입니다.
- **`Idle Connection Timeout: 10 minutes`도 상향 불가**라, 하트비트는 선택이 아니라 강제입니다. 자체 구현으로 옮겨도 이 제약은 없어지지 않고 **LB idle timeout으로 이름만 바뀝니다.**
- **프레임 32KB / 페이로드 128KB.** 초과하면 에러가 아니라 **close code 1009로 연결이 끊깁니다.** 페이로드가 자랄 여지가 있으면 이게 조용한 시한폭탄입니다.
- **흐름이 일방향이면 WebSocket의 양방향성은 안 쓰는 기능입니다.** SSE로 내려가면 재연결과 재개(`Last-Event-ID`)가 **프로토콜에 내장**되어 따라온다 — WebSocket에서는 전부 직접 만들어야 하는 것들입니다.
{{< /callout >}}

> **왜 이 문서인가.** 전환 검토서의 첫 문장이 "API Gateway가 비싸서"이면 그 검토는 거기서 끝난다. 실제로 계산해보면 싸다. 이 문서는 **떠나야 하는 이유를 하나로 좁히고**, 그 대신 자체 구현으로 넘어갔을 때 *따라오는 제약*과 *없어지는 제약*을 구분한다. 검증 기준: AWS 공식 쿼터 표, API Gateway 요금표, WHATWG HTML 명세의 server-sent events 절.

## 1. 쿼터 표가 말하는 것

[WebSocket API 쿼터 표](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html)에서 이 워크로드에 걸리는 행만 뽑으면 여섯 개입니다.

| 항목 | 기본값 | 상향 가능 |
|---|---|---|
| **Connection duration for WebSocket API** | **2 hours** | **No** |
| **Idle Connection Timeout** | **10 minutes** | **No** |
| WebSocket frame size | 32 KB | No |
| Message payload size | 128 KB | No |
| New connections per second per account per Region | 500 | Yes |
| Concurrent connections | *(쿼터 없음)* | — |

동시 연결 수에는 쿼터가 없습니다. 문서는 그 대신 **동시 연결 수가 두 값의 곱으로 결정된다**고 설명합니다 — *"The maximum number of concurrent connections is determined by the rate of new connections per second and maximum connection duration of two hours. For example, with the default quota of 500 new connections per second, ... API Gateway can serve up to 3,600,000 concurrent connections."*

5만 대는 360만의 1.4%다. **용량은 문제가 아니다.**

### 1.1 32KB 프레임은 에러가 아니라 절단이다

각주가 이렇게 붙습니다 — *"Because of the WebSocket frame-size quota of 32 KB, a message larger than 32 KB must be split into multiple frames... **If a larger message (or larger frame size) is received, the connection is closed with code 1009.**"*

거부가 아니라 **연결 종료**입니다. 페이로드가 32KB 근처에서 노는 설계라면, 어느 날 카탈로그 항목 하나가 늘어난 순간 그 매장만 재연결 루프에 빠지고 로그에는 1009만 남습니다. 자체 구현으로 옮기면 이 상한은 우리가 정하게 되므로 **없어지는 제약**입니다.

## 2. 비용 — 논거가 되지 않는다

[요금표](https://aws.amazon.com/api-gateway/pricing/) 기준으로 WebSocket API는 connection-minutes $0.25/M, 메시지 $1.00/M(첫 10억 건), 메시지는 **32KB 단위로 미터링**된다(33KB는 2건).

5만 대를 한 달 내내 붙여둔다고 하면:

```
connection-minutes = 50,000 × 60분 × 24시간 × 30일
                   = 2,160,000,000  (2,160M)
                   × $0.25/M        = $540 / 월
```

메시지를 단말당 하루 200건으로 잡아도 300M/월 × $1.00/M = $300/월입니다. **합쳐 월 $1,000 아래**입니다. 같은 트래픽을 받는 자체 게이트웨이 파드 20개와 Redis, ALB, 그리고 그것을 운영하는 사람의 시간을 합치면 어느 쪽이 싼지는 자명하지 않습니다.

> **그래서 전환의 논거는 비용이 아니라 적합성입니다.** 문서에도 그렇게 씁니다. 비용을 앞세우면 재무 검토에서 되돌아옵니다.

## 3. 2시간 강제 종료 — 무엇이 실제로 비싼가

먼저 겁먹기 쉬운 계산부터 걷어내자.

```
정상 상태 재접속률 = 50,000 / 7,200초 ≈ 6.9 conn/s
                    → 500/s 쿼터의 1.4%
전면 장애 후 일괄 재접속 = 50,000 / 500 = 100초
```

**쿼터는 안 터집니다.** 5만 대가 동시에 재접속해도 100초면 다 붙습니다.

비싼 것은 그 다음입니다. **2시간마다 모든 단말이 세션을 새로 맺는데, 재개 수단이 없으면 그때마다 상태를 처음부터 다시 맞춰야 합니다.** API Gateway WebSocket에는 `Last-Event-ID`에 해당하는 개념이 없습니다 — 새 `connectionId`가 발급되고, 그 사이에 있었던 일은 애플리케이션이 알아서 복구해야 합니다. 5만 대 × 하루 12회 = **일 60만 회의 전량 재동기화**가 정상 경로로 상시 발생합니다.

이게 이 전환의 실제 논거입니다. 그리고 **재개 보장을 설계에 넣기로 한 순간 API Gateway는 그 요구를 표현할 수단이 없습니다.**

### 3.1 10분 idle은 옮겨가도 없어지지 않는다

`Idle Connection Timeout: 10 minutes` 역시 상향 불가라, 10분 안에 뭐라도 흘려야 합니다. 자체 구현으로 옮기면 이 값은 사라지는 대신 **ALB idle timeout**(기본 60초, 최대 4000초)과 매장 회선 중간 장비의 NAT 세션 타임아웃으로 대체됩니다. 후자는 우리가 못 고칩니다.

**결론: 하트비트는 어느 쪽이든 필수입니다.** SSE에서는 주석 줄(`: ping\n\n`) 하나로 끝납니다.

## 4. `@connections`가 대신 해주던 것

API Gateway를 걷어낼 때 실제로 우리 숙제로 넘어오는 건 두 가지입니다.

1. **커넥션 레지스트리** — `connectionId`가 어느 백엔드에 붙어 있는지. API Gateway는 이걸 완전히 숨깁니다.
2. **임의 지점에서의 푸시** — `POST /@connections/{connectionId}`로 어느 Lambda에서든 특정 연결에 밀어넣을 수 있습니다.

자체 구현에서 이 둘을 어떻게 되살릴 것인가가 [04]({{< relref "04-branch-a-client-dials/index.md" >}})의 전부입니다. 미리 결론만 말하면, **재개 보장을 요구한 덕분에 1번을 만들 필요가 없어집니다** — 이벤트가 파드 밖에 남으면 "누가 들고 있나"를 물을 이유가 사라지기 때문입니다.

## 5. SSE인가 WebSocket인가

흐름이 중앙 → 단말 일방이고 단말 → 중앙은 어차피 REST라면, **WebSocket의 양방향성은 쓰지 않는 기능**입니다. 그 하나를 포기하고 얻는 것이 큽니다.

| | SSE | WebSocket |
|---|---|---|
| 프로토콜 | HTTP 그대로 | HTTP Upgrade 후 별도 프레이밍 |
| 재연결 | **클라이언트 표준 동작** | 직접 구현 |
| 재개 | **`Last-Event-ID` 헤더 자동 송신** | 직접 구현 |
| 재연결 지연 제어 | **서버가 `retry:`로 지시 가능** | 없음 |
| 중간 장비 | 그냥 HTTP 응답 — LB·프록시·WAF가 전부 이해 | Upgrade 지원 필요 |
| 관측성 | 액세스 로그·트레이싱이 평소대로 | 별도 계측 |
| 페이로드 | UTF-8 텍스트 (바이너리는 인코딩 필요) | 텍스트·바이너리 |
| 방향 | **단방향** | 양방향 |

[WHATWG 명세](https://html.spec.whatwg.org/multipage/server-sent-events.html)가 규정하는 세 가지가 그대로 우리 설계의 뼈대가 됩니다.

- **`id:` 필드가 last event ID 버퍼를 설정한다** — *"If the field value does not contain U+0000 NULL, then set the last event ID buffer to the field value."*
- **재연결 시 그 값이 헤더로 자동 송신된다** — *"If the EventSource object's last event ID string is not the empty string ... Set (`Last-Event-ID`, lastEventIDValue) in request's header list."*
- **`retry:` 필드로 서버가 재연결 지연을 지정한다** — *"If the field value consists of only ASCII digits, then ... set the event stream's reconnection time to that integer."*

세 번째가 특히 값을 합니다. **종료 직전에 커넥션마다 서로 다른 `retry:` 값을 밀어넣으면 재접속 폭풍을 프로토콜 레벨에서 흩을 수 있습니다.** WebSocket에는 이에 해당하는 표준 수단이 없습니다. 자세한 건 [06 · graceful shutdown]({{< relref "06-k8s-shape.md" >}})에서 다룹니다.

### 5.1 다만 POS 클라이언트는 브라우저가 아니다

브라우저 `EventSource` API는 커스텀 헤더를 못 붙이고 `GET`만 가능하다는 제약이 유명하지만, **POS 클라이언트는 우리가 만듭니다.** 인증 헤더든 `Last-Event-ID`를 쿼리 파라미터로 보내든 자유입니다. 명세의 자동 동작은 *공짜로 따라오는 기본값*으로 쓰고, 필요하면 우리 규칙을 얹으면 됩니다.

반대로 브라우저가 아니라서 **잃는 것도 있습니다** — 자동 재연결·백오프·`retry:` 해석을 클라이언트에 직접 구현해야 합니다. 이건 [07]({{< relref "07-kotlin-notes.md" >}})의 클라이언트 절에서 다룹니다.

## 6. 다음 문서로 넘기는 질문

여기까지가 "무엇에서 벗어나는가"입니다. **"무엇으로 가는가"는 아직 하나가 미결입니다** — POS가 거는가, 우리가 거는가. [02]({{< relref "02-connect-direction.md" >}})가 그것을 판정합니다.
