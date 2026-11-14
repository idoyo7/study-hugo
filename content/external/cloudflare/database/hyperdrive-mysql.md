---
title: "Hyperdrive MySQL 캐시에서 드물게 나던 빈 응답 버그 추적"
description: "Cloudflare Hyperdrive의 MySQL 지원이 GA가 되기 전, 쿼리의 약 0.001%에서 빈 응답이 돌아오던 버그를 추적한 기록입니다. 원인은 Client 노드와 Endpoint 노드가 같은 캐시에 서로 다른 인코딩의 바이트를 넣고 읽던 데 있었습니다."
date: 2026-11-14
weight: 1
---

# Hyperdrive MySQL 캐시에서 드물게 나던 빈 응답 버그 추적 (2026-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Inside Hyperdrive: How we solved a rare Hyperdrive MySQL caching bug](https://blog.cloudflare.com/hyperdrive-mysql)
- 매체 · 게시일: The Cloudflare Blog · 2026-10-14
- 저자: Pranoy Dutta
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 베타에서 GA까지 {#배경}

Hyperdrive는 Cloudflare Workers와 SQL 데이터베이스를 잇는 데이터베이스 커넥션 풀러입니다. 처음에는 Postgres만 지원했고, 지난해 MySQL 프로토콜 지원 베타를 발표한 뒤로 MySQL 처리를 Postgres만큼 안정적으로 만드는 작업을 해 왔습니다. 원문은 베타와 GA의 차이가 "트렌치코트 속에 든 버그 수정 20개"쯤이라고 농담처럼 말합니다.

베타의 목표는 실제 고객 사용에서 프로덕션 가용성 목표 99.99%를 확인하는 것이었습니다. Worker의 클라이언트 연결이 Hyperdrive 관련 오류로 끝나는 빈도를 추적하고 있어 신뢰성에 빈틈이 있다는 것은 알고 있었고, 베타 고객의 피드백으로 프로덕션의 드물고 미묘한 버그도 발견했습니다.

Hyperdrive는 전 세계 네트워크에 데이터베이스 커넥션을 열어 둔 채 여러 Worker 요청이 공유하게 하고, 자주 쓰는 쿼리는 글로벌 CDN 캐시에 올려 지연과 원본 DB 부하를 줄입니다. SQL 연결은 최소 다섯 번의 네트워크 왕복이 필요하고, Workers 같은 서버리스 환경에서 요청마다 연결을 맺는 것은 현실적이지 않습니다.

## 먼저 잡은 작은 버그들 {#작은-버그}

보고되자마자 고치기 쉬웠던 문제도 있었습니다. 첫 번째는 이모지가 제대로 돌아오지 않는 문제로, 문자 집합 협상 때문이었습니다. Hyperdrive는 시작 핸드셰이크에서 `utf8`을 협상했는데 이것은 `utf8mb3`의 폐기 예정 별칭이라 코드 포인트당 1~3바이트만 지원합니다. 완전한 UTF-8은 최대 4바이트이므로 핸드셰이크를 `utf8mb4`로 바꿔 해결했습니다.

두 번째도 인코딩 문제였습니다. 세션 상태가 체크아웃 사이에 새지 않도록 `COM_RESET_CONNECTION` 정리 단계를 넣었는데, 이 명령은 협상한 문자 집합이 아니라 서버 기본값으로 연결을 되돌립니다. 기본값이 `latin1`인 MySQL 서버라면 `utf8mb4`를 협상해도 리셋 뒤 `latin1`이 됩니다. 연결을 리셋한 뒤에는 항상 인코딩을 `utf8mb4`로 지정하는 명령을 실행하도록 고쳤습니다.

## 찾기 어려웠던 버그 {#버그}

가장 트래픽이 많은 MySQL 고객이 비어 있지 않아야 하는 쿼리에서 빈 응답이 작지만 꾸준한 비율로 돌아온다고 보고했습니다. 텔레메트리를 훑고 고객의 로직을 파악하고 해당 Hyperdrive 인스턴스의 트레이스 비율을 올려 보았으며, 이 현상을 설명할 만한 네트워크 문제도 찾았지만 아무것도 맞지 않았습니다. 발생률이 약 0.001%여서 관련된 종단 간 실행 트레이스를 찾기가 매우 어려웠습니다.

단서는 하나였습니다. 버그는 캐싱을 켠 Hyperdrive 인스턴스에서만 났고, 그래서 MySQL 캐싱을 의심하게 됐습니다.

## Hyperdrive 캐시의 구조 {#캐시}

모든 Hyperdrive 인스턴스는 Client와 Endpoint 두 노드로 나뉩니다. Client 노드는 사용자의 Worker와 같은 머신에서 돌며 로컬 캐시(켠 경우)를 처리하고 필요하면 Endpoint에 쿼리를 넘깁니다. Endpoint 노드는 커넥션 풀을 가지고 원본 DB와 가장 가까운 데이터 센터에 놓입니다. 두 노드는 각자 실행되는 데이터 센터의 Cloudflare CDN 캐시를 쓰므로, 같은 데이터 센터에 있으면 캐시를 공유합니다.

공유는 대체로 성능에 이롭습니다. 쿼리의 와이어 메시지 내용을 정규화해 해시하고 결과 바이트를 캐시에 저장하므로, Endpoint가 최근 캐시한 쿼리를 같은 데이터 센터의 Client가 받으면 공유 캐시에서 바로 응답할 수 있습니다. 이 방식이 맞게 동작하려면 같은 응답에 대해 Client가 저장하든 Endpoint가 저장하든 같은 바이트가 캐시에 있어야 합니다.

## MySQL 프로토콜과 capability 협상 {#프로토콜}

직접 트레이스를 얻지 못해 MySQL 클라이언트·서버 프로토콜을 살펴보기로 했습니다. Postgres 프로토콜에 대한 가정이 MySQL 처리에 박혀 있을지 모른다는 생각이었습니다. 커넥션 풀링에서는 클라이언트 역할이 둘, 서버 역할이 둘입니다. 첫 클라이언트는 MySQL 클라이언트 라이브러리를 쓰는 Worker이고, 이것이 서버 역할의 Hyperdrive Client에 접속합니다. Hyperdrive Client는 다시 Hyperdrive Endpoint에 연결하며, Endpoint는 실제 MySQL 원본 서버에 대해 MySQL 클라이언트로 동작합니다.

프로토콜은 인증 방식과 capability를 합의하는 Connection Phase로 시작하고, 이후 클라이언트가 명령을 보내고 서버가 응답하는 Command Phase로 이어집니다. 한쪽이 지원하지 않는 기능을 쓰면 프로토콜 desync가 생깁니다. Hyperdrive는 원본 DB에는 클라이언트로, Worker에는 서버로 동작하므로 협상이 까다롭습니다. 원본 서버의 메시지를 파싱하려고 고정된 capability 플래그 집합을 쓰고, Worker 클라이언트의 집합이 다를 수 있으므로 원본 응답을 Worker가 기대하는 capability로 변환해야 합니다.

디버깅 중에 Node.js의 인기 MySQL 클라이언트 라이브러리 `mysql2`가 `CLIENT_DEPRECATE_EOF` capability를 지원하지 않는다는 것을 알았습니다. 이 capability가 없으면 서버는 컬럼 정의와 행 사이에 EOF 패킷을, 결과 집합 끝에 또 EOF 패킷을 보냅니다. 협상하면 메타데이터 EOF 패킷이 빠지고 마지막 EOF가 OK 패킷으로 바뀝니다. MySQL 서버 5.7.5 이상이 이를 지원하지만 클라이언트가 협상할 때만 OK 패킷 방식이 쓰입니다. Hyperdrive는 이 capability를 지원하지만 Worker의 드라이버는 아닐 수 있어서, 필요하면 결과 집합에 EOF를 넣고 OK 패킷을 EOF로 바꾸는 변환을 합니다.

## 잘못된 가정 {#원인}

며칠 동안 텔레메트리와 문서, 코드를 보고 나서 마지막 조각이 맞춰졌습니다. Hyperdrive Client의 캐싱 코드에 있던 가정이 원인이었습니다. Postgres용 Client 캐싱을 구현할 때 Worker에 되돌려 준 바이트를 그대로 캐시할 수 있다고 가정했는데, Postgres 와이어 프로토콜에서는 합리적이었지만 MySQL capability 불일치 때문에 더는 성립하지 않았습니다. Endpoint 노드는 늘 Hyperdrive의 capability로 일하고, Client 노드가 돌려주는 바이트는 Worker의 capability에 맞게 변환된 것이라 형식이 다릅니다.

버그는 Client와 Endpoint가 같은 데이터 센터에서 캐시를 공유하고, 한쪽이 다른 쪽이 캐시한 값을 읽을 때 생깁니다. 원문은 두 시나리오를 듭니다.

- Endpoint가 캐시하고 Client가 읽는 경우: Endpoint가 쿼리 Q의 응답 R을 원본에서 받아 Hyperdrive capability로 인코딩된 바이트(R_hyperdrive)를 공유 캐시에 넣습니다. 이후 Client가 같은 Q를 받아 캐시에서 R_hyperdrive를 찾고, Worker의 capability로 변환하지 않은 채 그대로 Worker에 돌려줍니다.
- Client가 캐시하고 Endpoint가 읽는 경우: Client가 Worker용으로 변환한 바이트(R_worker)를 캐시에 씁니다. Q를 처리하던 Endpoint가 캐시에서 R_worker를 찾아 다른 Client에 보내고, 그 Client가 이것을 Worker의 capability로 다시 변환하려다 EOF를 일찍 보내거나 멈춥니다.

두 경우 모두 잘못된 capability로 인코딩된 응답이 나가서 예상 밖의 빈 결과와 멈춤이 생깁니다.

## 해결과 결과 {#결과}

원인을 찾고 나니 수정은 단순했습니다. 어느 노드가 저장하든 캐시에는 항상 Hyperdrive의 capability로 인코딩한 정규 버전의 결과 바이트를 쓰게 했습니다. 이 변경을 배포한 뒤 빈 행 문제는 사라졌고 Client 연결의 성공률이 99.99%에 도달했습니다. 원문은 Hyperdrive의 MySQL 지원이 GA가 됐다고 알리며, 대시보드나 wrangler로 기존 MySQL 호환 데이터베이스에 Hyperdrive를 만들거나 PlanetScale의 새 데이터베이스에 연결할 수 있다고 안내합니다.

{{% details title="버그와 목표 관련 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| 프로덕션 가용성 목표 | 99.99% |
| 빈 응답 발생률 | 약 0.001% |
| 수정 후 Client 연결 성공률 | 99.99% |
| SQL 연결 수립에 필요한 네트워크 왕복 | 최소 5회 |
| 이모지 문제 수정 | 핸드셰이크 인코딩 `utf8` → `utf8mb4` |
| `CLIENT_DEPRECATE_EOF` 서버 지원 | MySQL 5.7.5 이상 |

{{% /details %}}
