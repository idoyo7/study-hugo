---
title: "Privacy Proxy의 40ms 지연을 줄인 명령 버퍼링"
description: "Privacy Proxy의 토큰 검사가 약 40ms씩 늦어진 원인은 분할 전송과 ACK 대기의 상호작용이었습니다. Cloudflare는 명령을 버퍼에 모아 한 번에 보내 검사 지연 중앙값을 1ms 미만으로 낮췄습니다."
date: 2026-11-16
weight: 18
---

# Privacy Proxy의 40ms 지연을 줄인 명령 버퍼링 (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Reducing double spend latency from 40 ms to < 1 ms on privacy proxy](https://blog.cloudflare.com/reducing-double-spend-latency-from-40-ms-to-less-than-1-ms-on-privacy-proxy)
- 매체 · 게시일: The Cloudflare Blog · 2025-08-05
- 저자: Ben Yang
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 웹사이트 접속 앞에 놓인 토큰 검사 {#authentication-bottleneck}

Cloudflare가 Privacy Proxy의 인증 경로에서 발견한 지연은 약 40ms였습니다. 토큰을 이미 사용했는지 확인하는 데 걸린 시간입니다. 프록시가 초당 수백만 건의 요청을 받는 만큼, 이 검사에서 기다리는 시간은 사용자의 웹사이트 접속을 늦춥니다.

Cloudflare는 Apple의 Private Relay와 Microsoft의 Edge Secure Network 같은 프라이버시 프록시의 인프라를 운영합니다. 사용자가 방문 웹사이트에 개인정보를 노출하지 않고 웹을 탐색하도록 돕는 서비스입니다. 인증 과정에서도 사용자 정보를 가능한 한 적게 수집하기 위해 공개 인터넷 표준인 Privacy Pass를 사용합니다.

요청에는 `Proxy-Authorization` 헤더로 토큰이 전달됩니다. Cloudflare는 암호학적 검증에 앞서 이 토큰을 이미 사용했는지 확인합니다. 사용한 토큰을 다시 내는 ‘이중 사용’은 접근 제어상 문제의 징후이며, 익명성 집합과 개인정보 보호 특성을 약화할 수 있습니다.

지연의 첫 단서는 Jaeger 트레이스였습니다. 하지만 일부만 샘플링한 트레이스에서 약 40ms가 보였다는 사실만으로는 얼마나 넓게 발생하는 현상인지 알기 어려웠습니다. 샘플을 늘리면 크고 무거운 트레이스를 더 처리해야 했습니다. Cloudflare는 더 가벼운 메트릭을 추가해 모든 이중 사용 검사를 관측했고, 느린 프록시들의 지연 중앙값이 약 45ms에 이르는 등 상당수 요청이 영향을 받는다는 점을 확인했습니다.

그렇다고 45ms라는 숫자만으로 느리다고 단정할 수는 없었습니다. 비교할 기준이 필요했습니다. 토큰의 존재 여부를 조회하는 저장소는 `memcached`이고, 전 세계에 있는 인스턴스 중 어디로 요청을 보낼지는 `mcrouter`가 결정합니다. 이 `mcrouter`의 서버별 평균 처리 지연은 급증 구간을 제외하면 대부분 1ms 미만이었습니다. 조회 처리 시간만으로는 프록시에서 관측한 지연을 설명할 수 없었습니다.

## 연결 풀 가설을 깨뜨린 한산한 서버 {#connection-hypotheses}

검사 코드는 연결을 확보한 뒤 `memcached get` 명령을 보냅니다. 연결을 얻을 때는 먼저 `memcached version` 명령으로 상태를 확인하고, 정상이면 그 연결을 쓰고 그렇지 않으면 새로 연결합니다. 혹시 이 상태 확인이 오래 걸리는지 측정했지만 중앙값은 1ms 미만이었습니다. 단순한 명령답게 빠르게 끝났습니다.

연결 풀에서 차례를 기다리는 시간은 더 그럴듯한 후보였습니다. 준비된 연결을 재사용하면 매번 연결을 만드는 비용을 줄일 수 있지만, 풀의 한도는 서버당 20개였습니다. 초당 5,000건의 요청이 들어오고 요청 하나가 45ms 머문다고 가정하면, Little’s Law로 계산한 평균 요청 수는 `5000 × 0.045 = 225`입니다. 연결 20개가 각각 요청 하나를 처리하는 동안 205건이 기다리는 상황입니다.

관측 결과는 이 가설과 맞지 않았습니다. 여러 서버에서 요청률이 달라도 지연은 약 40ms로 비슷했습니다. 최대 초당 20건만 받는 서버조차 대다수 요청이 40~50ms 구간에 몰렸습니다. 요청이 뜸해져도 남는 지연을 풀 부족으로 설명하기는 어려웠습니다.

## ACK를 기다리며 멈춘 memcached 명령 {#nagle-and-delayed-acks}

빠른 `version`과 느린 `get` 사이에는 명령을 쓰는 방식의 차이가 있었습니다. Cloudflare가 사용한 `memcache-async` crate는 `version` 명령 전체를 한 번의 `write_all`로 작성했습니다. `get`은 달랐습니다. `get `, 토큰 키, `\r\n`을 각각 `write_all`로 작성한 뒤 `flush`를 호출했습니다. Cloudflare 코드에서는 `io`가 `TcpStream`이어서 작은 쓰기들이 개별 전송으로 이어졌습니다.

이 차이를 TCP 동작과 연결한 단서는 Gemini의 제안 중 하나였습니다. 관측 내용을 전달하자 `TCP_NODELAY` 설정을 확인하라는 제안이 나왔습니다. 이 옵션은 Nagle’s algorithm을 끕니다. 알고리즘 자체가 문제인 것은 아니었지만, 확인 응답인 ACK의 전송을 늦추는 delayed ACKs와 함께 작동하면 지연이 생길 수 있었습니다.

단체 채팅에서 친구가 “Hi”, “how”, “are”, “you”를 한 단어씩 보낸다고 생각해 봅니다. 알림이 계속 울립니다. Nagle’s algorithm은 이런 작은 전송을 줄이기 위해 짧은 메시지를 한 번 보낸 뒤 곧바로 이어지는 단어들을 임시 초안에 모아 두고, 일정 길이에 이르면 내보내는 방식입니다.

실제 연결에서는 `get `만 먼저 전송됐습니다. 토큰 키와 줄바꿈은 커널 버퍼에 남아 ACK를 기다렸습니다. 받는 쪽인 `mcrouter`도 일을 시작할 수 없었습니다. 명령이 아직 완성되지 않았기 때문입니다. 여기에 delayed ACKs가 작동해 약 40ms 뒤에야 ACK를 보냈고, 그 ACK가 도착한 다음에야 버퍼에 있던 나머지 명령이 전송됐습니다. `mcrouter`가 조회를 처리하고 응답할 수 있는 시점도 그만큼 늦어졌습니다.

반복해서 나타난 40ms에는 출처가 있었습니다. Linux 커널 소스는 `HZ >= 100`일 때 `TCP_DELACK_MIN`과 `TCP_ATO_MIN`을 `HZ/25`로 정의합니다. Cloudflare의 자체 커널 설정은 `CONFIG_HZ=1000`이었습니다. 이 값이 `HZ`에 반영되면서 delayed ACK의 최소 대기 시간이 40ms가 된 것입니다.

## 완성된 명령을 한 번에 보내는 버퍼 {#buffering-and-results}

Nagle’s algorithm을 끄면 작은 메시지들이 모두 곧바로 전달돼 이 대기를 피할 수 있었습니다. 하지만 애초에 명령 하나를 보내려고 메시지를 세 번 나눌 이유가 없었습니다. Cloudflare가 적용한 수정은 작은 쓰기들을 먼저 모으는 방식이었습니다.

전송이 나뉜다는 사실은 Wireshark 캡처로도 확인했습니다. 이 캡처는 로컬 MacOS에서 수행했으며, 그 환경에서는 메시지마다 ACK가 돌아왔습니다. 따라서 이 관측이 확인해 준 것은 명령의 분할 전송이었습니다.

Cloudflare는 `TcpStream`을 `BufWriter<TcpStream>`으로 감쌌습니다. 이제 `write_all`은 작은 쓰기들을 사용자 공간 메모리 버퍼에 모으고, `flush`가 완성된 `memcached` 명령을 한 번에 보냅니다. 수정 후 Wireshark 캡처에서도 전송이 간결해진 모습을 확인했습니다.

production 배포 뒤에는 전 세계에서 이중 사용 검사 지연 중앙값이 약 40ms에서 기대했던 1ms 미만으로 낮아졌습니다.

{{% details title="지연 측정과 연결 풀 예시·커널 설정" closed="true" %}}
| 항목 | 값 |
|---|---|
| 초기 관측 | Jaeger 트레이스에서 약 40ms, 느린 프록시들의 메트릭에서 약 45ms 수준 |
| `mcrouter` 처리 지연 | 서버별 평균 지연 그래프에서 급증 구간을 제외하면 대부분 1ms 미만 |
| 연결 상태 확인 | `memcached version` 명령의 지연 중앙값 1ms 미만 |
| 연결 풀 한도 | 서버당 20개 연결 |
| 풀 부족 가설의 예시 조건 | 초당 5,000건, 요청 체류 시간 45ms |
| Little’s Law 예시 계산 | `5000 × 0.045 = 225`, 연결 20개가 각각 요청 하나를 처리하면 205건 대기 |
| 낮은 요청률 서버의 반례 | 최대 초당 20건인 서버에서도 대다수 요청이 40~50ms 구간 |
| 기존 `get` 명령 작성 | `get `, 토큰 키, `\r\n`을 각각 `write_all`로 작성한 뒤 `flush` |
| Linux 최소 지연 계산 | `HZ >= 100`에서 `TCP_DELACK_MIN`과 `TCP_ATO_MIN`을 `HZ/25`로 정의 |
| Cloudflare 커널 설정 | `CONFIG_HZ=1000`, 위 계산에 따른 지연 40ms |
| 수정 및 결과 | `BufWriter<TcpStream>` 적용 후 전 세계 검사 지연 중앙값 1ms 미만 |
{{% /details %}}
