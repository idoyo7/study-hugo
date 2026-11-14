---
title: "NAT Gateway 뒤의 L4 포트 한계를 찾아낸 SRE 팀"
description: "주말마다 반복된 5xx는 IDC L4의 포트 할당 한계에서 비롯됐습니다. SRE 팀은 connection pool 사용 여부와 통신 경로를 바꿔 원인을 검증하고, 관련 서비스에도 재발 방지 조치를 적용했습니다."
date: 2026-11-14
weight: 8
---

# NAT Gateway 뒤의 L4 포트 한계를 찾아낸 SRE 팀 (2020-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [SRE 팀에서 장애의 root cause를 찾고 재발방지 하는 방법](https://techblog.woowahan.com/2700/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2020-11-11
- 저자: 천명호 (시스템신뢰성개발팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 주말 장애의 단서가 된 B 서비스의 ACK {#incident}

장애가 난 곳은 AWS EC2의 A 서비스와 on premise 서버의 B 서비스가 REST API로 통신하는 구간입니다. 5xx error가 늘면서 사용자 요청이 실패했고, B 서비스의 L4 세션 카운트도 함께 증가했습니다.

A 서비스 인스턴스를 늘리자 레이턴시와 5xx, L4 세션 카운트는 줄었습니다. 그래도 평소 수준까지 내려오지는 않았습니다. 5xx와 L4 세션 카운트가 정상으로 돌아온 시점은 인스턴스를 교체한 뒤입니다.

원인은 여전히 불명확했습니다. 트래픽이 많은 주말마다 장애가 되풀이됐고, SRE팀과 개발팀도 같은 대응을 반복했습니다. 편안한 주말을 되찾기 위해 SRE팀, 클라우드인프라개발팀, 도메인팀, 정보보안팀이 함께 근본 원인을 찾기 시작했습니다.

두 서비스의 애플리케이션 에러 로그와 시스템 로그, packet dump를 살피던 중 눈에 들어온 것은 B 서비스의 이상한 ACK입니다. AWS NAT Gateway의 출발지 포트 10141에서 B 서비스의 443 포트로 향하는 요청인데도, 정상일 때와 비정상일 때의 흐름이 달랐습니다.

정상 요청은 3way-handshake로 연결을 맺고 데이터를 전송한 뒤 4way-handshake로 끝났습니다. 비정상 요청에서는 SYN을 받은 B 서비스가 SYN,ACK 대신 잘못된 sequence number의 ACK만 보냈고, 요청자는 SYN을 3회 재전송했습니다. 포트를 반복해서 재사용하다가 B 서비스의 TCP 소켓이 제대로 닫히지 않은 것은 아닌지 의심할 만한 흔적입니다.

## connection pool 사용 여부로 달라진 재현 결과 {#hypotheses}

팀은 출발지와 목적지에서 TCP 소켓을 정상적으로 종료하지 못한다는 가설을 각각 시험했습니다. 출발지에서는 인스턴스 수와 타임아웃을 조정하고 AWS 존 이슈를 확인했으며, 목적지에서는 서버 수를 바꾸고 커널을 튜닝했습니다. 커널 설정의 조정 대상은 인바운드 큐 크기, fin timeout, TIME_WAIT 소켓 수 상한입니다.

같은 환경에서 테스트했지만 커널 튜닝과 서버 증설 뒤에도 증상은 나타났습니다. 다른 단서는 NAT 증설과 IDC 방화벽, L4 등 네트워크 구간을 테스트하던 중 나왔습니다. AWS NAT Gateway 환경에서 A 서비스가 connection pool을 쓰지 않을 때만 같은 현상이 발생한 것입니다.

이 조건을 더 분명히 확인하려고 통신 경로와 connection pool 사용 여부를 바꿨습니다. 기존 경로는 `A Service → NAT gateway → Public → IDC → F/W → L4 → B Service`입니다.

| 테스트 조건 | 재현 결과 |
|---|---|
| 기존 경로에서 A 서비스의 connection pool 사용 | 재현 안 됨 |
| AWS와 IDC 사이에 VPN을 구성해 NAT와 Public 제외 | 재현 안 됨 |
| A Zone에서 기존 경로로 요청 | 재현됨 |
| connection pool을 쓰지 않고 L4 제외 | 재현 안 됨 |

L4가 있어도 connection pool을 쓰면 재현되지 않았습니다. connection pool 없이도 L4를 빼면 증상이 사라졌습니다. 팀이 IDC의 L4 구간으로 조사 범위를 좁힌 근거입니다.

## Source IP마다 드러난 L4의 포트 한계 {#load-test}

L4에서는 DAM(Direct access mode)이 활성화된 상태에서 클라이언트 포트 변환이 일어났습니다. 문제는 팀이 알고 있던 포트 범위와 실제 동작이 다르다는 점입니다.

알려진 범위는 2000~65000이었지만, `/i/slb/sess/du`로 세션 테이블을 확인했을 때는 2048~16383만 보였고 서비스 포트 15000 이상은 확인되지 않았습니다. 클라이언트 요청 과부하로 테스트 VIP 세션이 약 28000을 넘으면 AUX Table의 Allocation fail 수치도 증가했습니다.

L4 구간을 찾았다고 검증을 끝내지는 않았습니다. 이번에는 L4가 Source IP(NAT Gateway IP) 하나당 약 14000개의 포트를 할당할 것이라는 가설을 세웠습니다. 이 가설대로라면 NAT Gateway를 3개 쓸 때 B 서비스 테스트 서버의 TIME_WAIT가 약 42000개 이상이면 같은 현상이 나타날 것이라는 예상입니다.

검증을 위해 AWS 가용 영역(A, B, C)과 NAT Gateway를 1:1로 매핑하고 A 서비스를 각 존에 분배해 부하를 주었습니다. B 서비스 테스트 서버에 TIME_WAIT가 약 42000개 생겼을 때 A 서비스에서 5xx error가 발생했습니다. NAT Gateway 3개에서 확인한 임계치는 예상했던 14000 × 3 = 42000과 맞았습니다.

## AWS와 IDC 사이로 넓힌 connection pool 전환 {#prevention}

SRE팀은 A 서비스 팀과 협업해 connection pool을 사용하도록 전환했습니다. 재발 방지 조치의 대상은 다른 서비스까지 넓혔습니다. AWS와 IDC 사이에서 NAT Gateway를 쓰는 서비스를 조사하고, 이들 서비스도 connection pool을 사용하도록 바꿨습니다.

{{% details title="검증에 사용한 커널 설정과 테스트 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| net.core.netdev_max_backlog | 30000 |
| net.ipv4.tcp_max_syn_backlog | 65536 |
| net.core.somaxconn | 16384 |
| net.ipv4.tcp_fin_timeout | 5 |
| net.ipv4.tcp_max_tw_buckets | 1800000 (gracefully shutdown을 위해 크게 설정) |
| L4 알려진 포트 범위 | 2000~65000 |
| L4 세션 테이블에서 확인된 범위 | 2048~16383 |
| Allocation fail 증가 조건 | 테스트 VIP 세션 약 28000 초과 |
| Source IP당 예상 포트 | 약 14000 |
| 테스트 TIME_WAIT | 약 42000 (NAT Gateway 3개 × 14000) |

{{% /details %}}
