---
title: "Hyperdrive MySQL의 빈 응답을 부른 캐시 속 바이트"
description: "데이터가 있어야 하는 MySQL 쿼리에 왜 빈 응답이 돌아왔을까요? Cloudflare는 Client와 Endpoint의 공유 캐시에 서로 다른 형식의 응답이 섞인 것을 찾아내고 저장 형식을 통일했습니다."
date: 2026-11-14
weight: 1
---

# Hyperdrive MySQL의 빈 응답을 부른 캐시 속 바이트 (2026-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Inside Hyperdrive: How we solved a rare Hyperdrive MySQL caching bug](https://blog.cloudflare.com/hyperdrive-mysql)
- 매체 · 게시일: The Cloudflare Blog · 2026-10-14
- 저자: Pranoy Dutta
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

Postgres만 지원하던 Hyperdrive가 지난해 MySQL 베타를 거쳐 MySQL 지원을 GA로 전환했습니다. Cloudflare 개발팀은 베타와 GA의 차이를 “트렌치코트 속에 든 버그 수정 20개”에 빗댑니다. 보고를 받고 쉽게 고친 문제도 있었지만, 발생률이 약 0.001%여서 실행 흔적조차 찾기 힘든 버그도 있었습니다.

베타에서 확인하려던 것은 실제 고객의 사용 환경에서도 프로덕션 가용성 목표인 99.99%를 충족하는지였습니다. 개발팀은 Worker의 클라이언트 연결이 Hyperdrive 관련 오류로 끝나는 빈도를 추적하며 아직 부족한 부분이 있다는 사실을 알고 있었습니다. 그 빈틈을 좁히는 데 고객의 제보가 도움이 됐습니다.

## 캐시를 켠 인스턴스에만 나타난 빈 응답 {#버그}

베타 고객 중 MySQL 트래픽이 가장 많은 고객이 이상한 응답을 제보했습니다. 항상 데이터가 돌아와야 하는 쿼리에서 빈 결과를 받는다는 내용이었습니다. 빈도는 낮았습니다. 약 0.001%에 불과했지만, 꾸준히 되풀이됐습니다.

개발팀은 고객의 로직과 텔레메트리를 살피고, 해당 Hyperdrive 인스턴스의 트레이스 수집 비율도 높였습니다. 네트워크에서 원인을 찾아보려 했으나 이 현상을 설명할 문제는 보이지 않았습니다. 오류가 워낙 드물어, 발생 순간을 담은 종단 간 실행 트레이스를 찾기도 어려웠습니다.

그래도 단서는 있었습니다. 빈 응답은 캐싱을 켠 Hyperdrive 인스턴스에서만 돌아왔습니다. 개발팀이 MySQL 캐싱을 의심한 이유입니다.

## Client와 Endpoint가 함께 쓰는 데이터 센터 캐시 {#캐시}

Hyperdrive는 Cloudflare Workers와 SQL 데이터베이스를 연결하는 분산 커넥션 풀러입니다. SQL 연결을 새로 맺으려면 네트워크를 최소 다섯 번 왕복해야 합니다. Workers 같은 서버리스 환경에서 요청마다 이 과정을 반복하면 지연이 늘고, 열린 연결이 많아질수록 연결별 자원 비용도 커집니다. MySQL은 Postgres처럼 연결마다 OS 프로세스 하나를 쓰지는 않지만, 연결이 많으면 일반적인 배포에서도 자원 부족을 겪을 수 있습니다.

Hyperdrive는 전 세계 네트워크에 SQL 연결을 열어 두고 여러 Worker 요청이 재사용하게 합니다. 자주 쓰는 쿼리의 결과는 글로벌 CDN 캐시에 저장해 원본 DB의 부하와 응답 지연을 줄입니다. 이 일을 나눠 맡는 노드가 Client와 Endpoint입니다.

Client는 사용자의 Worker와 같은 머신에서 실행됩니다. 캐싱을 켰다면 로컬 캐시를 확인하고, 필요할 때 Endpoint로 쿼리를 보냅니다. 커넥션 풀을 보유한 Endpoint는 원본 DB에서 가장 가까운 데이터 센터에 자리합니다. 각 노드는 자신이 실행되는 데이터 센터의 Cloudflare CDN 캐시를 사용합니다. 따라서 Client와 Endpoint가 같은 데이터 센터에 있으면 캐시도 하나를 공유합니다.

공유 캐시는 대체로 성능에 유리합니다. Hyperdrive는 쿼리의 와이어 메시지 내용을 일부 정규화한 뒤 해시해 캐시 키로 삼고, 결과 바이트를 저장합니다. Endpoint가 최근 저장한 쿼리를 같은 데이터 센터의 Client가 받으면 그 캐시에서 바로 응답할 수 있습니다. 여기에는 전제가 있습니다. 같은 응답이라면 어느 노드가 저장하든 캐시에 들어가는 바이트가 같아야 합니다.

## 연결을 비운 뒤 되돌아온 `latin1` {#작은-버그}

MySQL 지원에서는 문자 집합부터 예상과 다른 동작을 만났습니다. 베타 초반에는 데이터베이스에 쓴 이모지가 제대로 돌아오지 않는다는 제보가 있었습니다. 시작 핸드셰이크에서 협상한 `utf8`이 원인이었습니다. 이름은 `utf8`이지만, 실제로는 코드 포인트당 1~3바이트만 지원하는 `utf8mb3`의 폐기 예정 별칭입니다. 최대 4바이트를 쓰는 완전한 UTF-8을 지원하려면 `utf8mb4`가 필요했습니다. 핸드셰이크에서 이 값을 선택하도록 바꾸자 이모지 문제가 해결됐습니다.

연결을 정리하는 기능을 추가한 뒤에는 인코딩 오류가 다시 나타났습니다. Hyperdrive는 연결을 빌려 쓰는 요청 사이에 세션 상태가 새지 않도록 가벼운 MySQL 명령인 `COM_RESET_CONNECTION`을 사용했습니다. 그런데 이 명령은 문자 집합을 서버 기본값으로 되돌립니다. 서버 기본값이 `latin1`이면 처음에 `utf8mb4`를 협상했어도 리셋 뒤에는 `latin1`이 됩니다. 이후에는 연결을 리셋할 때마다 인코딩을 `utf8mb4`로 지정하는 명령을 실행하도록 고쳤습니다.

## 응답의 끝을 바꾸는 MySQL capability {#프로토콜}

빈 응답 버그를 추적하던 개발팀도 MySQL 프로토콜로 눈을 돌렸습니다. 직접적인 실행 트레이스를 얻지 못했으니, Postgres에서는 통하던 가정이 MySQL 처리 코드에 남아 있는지 살펴보기로 했습니다.

커넥션 풀러가 끼어 있으면 클라이언트와 서버의 역할도 여러 곳에 나뉩니다. Worker의 MySQL 클라이언트 라이브러리는 서버 역할을 하는 Hyperdrive Client에 접속합니다. Client는 다시 Endpoint에 연결하고, Endpoint는 실제 MySQL 원본 서버에 접속하는 클라이언트로 동작합니다.

MySQL 연결은 인증 방식과 지원 기능인 capability를 합의하는 Connection Phase로 시작합니다. 이후 SQL 같은 명령과 응답을 주고받는 Command Phase로 넘어갑니다. 상대가 지원하지 않는 기능을 사용하면 프로토콜 desync가 생겨 예상하지 못한 동작으로 이어질 수 있습니다. Hyperdrive는 원본 서버의 메시지를 파싱할 수 있도록 고정된 capability 플래그 집합을 사용합니다. Worker의 드라이버가 지원하는 기능은 이와 다를 수 있어, 원본 응답을 Worker가 기대하는 형식으로 변환해야 합니다.

조사 당시 Node.js에서 널리 쓰이는 MySQL 라이브러리 `mysql2`는 `CLIENT_DEPRECATE_EOF`를 지원하지 않았습니다. 이 capability는 결과 집합의 경계를 표시하는 패킷을 바꿉니다.

| 결과 집합의 경계 | `CLIENT_DEPRECATE_EOF` 미협상 | `CLIENT_DEPRECATE_EOF` 협상 |
|---|---|---|
| 컬럼 정의와 행 사이 | EOF 패킷 | EOF 패킷 생략 |
| 결과 집합 끝 | EOF 패킷 | OK 패킷 |

MySQL 서버 5.7.5 이상은 이 기능을 지원하지만, 클라이언트가 협상했을 때만 새로운 OK 패킷 방식을 사용합니다. Hyperdrive도 이 기능을 지원합니다. 그러나 Worker의 드라이버가 지원하지 않으면, Hyperdrive가 결과 집합에 필요한 EOF 패킷을 넣고 OK 패킷을 EOF로 바꿔 보내야 합니다.

## Postgres에서 가져온 캐싱 코드의 가정 {#원인}

며칠 동안 텔레메트리와 문서, 코드를 살핀 끝에 마지막 조각을 찾았습니다. Client의 캐싱 코드는 Worker에 보낸 바이트를 그대로 저장하고 있었습니다. Postgres용으로 구현할 때는 합리적인 선택이었습니다. MySQL에서는 capability 차이 때문에 이 가정이 깨졌습니다.

Endpoint가 다루는 응답은 Hyperdrive의 capability에 맞춰 인코딩돼 있습니다. Client가 Worker에 보내는 응답은 Worker의 capability에 맞게 변환된 상태입니다. 같은 쿼리의 결과라도 바이트 형식이 달라질 수 있었습니다. Client와 Endpoint가 같은 데이터 센터에서 캐시를 공유하고, 한쪽이 다른 쪽이 저장한 값을 읽으면 이 차이가 문제가 됐습니다.

### 변환 없이 Worker로 향한 `R_hyperdrive`

Endpoint가 쿼리 Q를 처리하며 원본 서버에서 응답 R을 받습니다. 이 응답은 Hyperdrive의 capability로 인코딩된 `R_hyperdrive`이며, Endpoint는 그 바이트를 공유 캐시에 저장합니다.

이후 같은 쿼리 Q를 받은 Client가 캐시에서 `R_hyperdrive`를 찾습니다. 문제는 그다음입니다. Client는 캐시에서 읽은 응답을 Worker의 capability로 변환하지 않고 그대로 돌려줍니다. Worker는 자신이 협상한 기능과 다른 형식의 응답을 받게 됩니다.

### 다른 Client에 도착한 `R_worker`

Client가 먼저 응답을 캐시하는 흐름도 있습니다. 쿼리 Q의 처리를 마친 Client가 Worker용으로 변환한 바이트인 `R_worker`를 저장합니다. Q를 처리하던 Endpoint가 이 값을 캐시에서 찾아 다른 Client로 보냅니다.

응답을 받은 Client는 이미 Worker용인 `R_worker`를 다시 Worker의 capability에 맞춰 변환하려 합니다. 그 과정에서 EOF를 너무 일찍 보내거나 처리가 멈춥니다. 공유 캐시에 섞인 응답 형식이 예상 밖의 빈 결과와 멈춤으로 이어진 것입니다.

## Hyperdrive 형식으로 통일한 결과 바이트 {#결과}

원인을 찾은 뒤 수정은 간단했습니다. 어느 노드가 저장하든 캐시에는 항상 Hyperdrive의 capability로 인코딩한 정규 형식의 결과 바이트를 쓰도록 했습니다. 변경을 배포하자 빈 행 문제가 사라졌고, Client 연결 성공률은 99.99%에 도달했습니다.

GA로 제공되는 Hyperdrive의 MySQL 지원은 대시보드나 wrangler에서 사용할 수 있습니다. 기존 MySQL 호환 데이터베이스에 Hyperdrive를 만들거나, PlanetScale의 새 데이터베이스에 연결할 수 있습니다.

{{% details title="발생 빈도와 수정 후 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| 프로덕션 가용성 목표 | 99.99% |
| 빈 응답 발생률 | 약 0.001% |
| 수정 후 Client 연결 성공률 | 99.99% |
| SQL 연결 수립에 필요한 네트워크 왕복 | 최소 5회 |
| 이모지 문제 수정 | 핸드셰이크 인코딩 `utf8` → `utf8mb4` |
| `CLIENT_DEPRECATE_EOF` 서버 지원 | MySQL 5.7.5 이상 |

{{% /details %}}
