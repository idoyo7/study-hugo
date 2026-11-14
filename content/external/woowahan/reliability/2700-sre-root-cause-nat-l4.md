---
title: "SRE 팀의 장애 근본 원인 분석과 재발 방지"
description: "주말마다 반복된 5xx 장애를 NAT Gateway와 IDC L4 구간의 포트 문제로 좁혀 간 과정을 정리했습니다. 가설 검증, 재현 테스트, connection pool 전환까지 요약합니다."
date: 2026-11-14
weight: 8
---

# SRE 팀의 장애 근본 원인 분석과 재발 방지 (2020-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [SRE 팀에서 장애의 root cause를 찾고 재발방지 하는 방법](https://techblog.woowahan.com/2700/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2020-11-11
- 저자: 천명호 (시스템신뢰성개발팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 반복된 장애와 임시 대응 {#incident}

AWS 안에 있는 시스템(A 서비스)과 on premise에 있는 시스템(B 서비스) 사이의 API 요청에서 5xx error가 늘고 사용자 요청이 실패했습니다. B 서비스의 L4 세션 카운트도 함께 늘었습니다.

대응은 이랬습니다. A 서비스 인스턴스를 늘리자 5xx와 L4 세션 카운트가 줄었지만 평소 수치로 돌아오지는 않았습니다. 인스턴스를 교체하고 나서야 평소 수치로 돌아왔습니다. 현상은 풀렸지만 원인은 불명확했고, 장애는 트래픽이 많은 주말마다 반복되었습니다. SRE팀과 개발팀이 주말마다 같은 대처로 수습하던 끝에 SRE팀, 클라우드인프라개발팀, 도메인팀, 정보보안팀이 함께 근본 원인을 찾기 시작했습니다.

## 증거 수집과 이상 징후 {#evidence}

구성은 AWS의 EC2 웹 애플리케이션과 on premise 서버가 REST API로 통신하는 형태입니다. 두 서비스의 애플리케이션 에러 로그, 시스템 로그, packet dump를 살폈고, B 서비스의 packet dump에서 이상한 점을 찾았습니다.

정상 흐름은 AWS NAT Gateway에서 B 서비스 서버의 443 포트로 3way-handshake, 데이터 전송, 4way-handshake 순으로 이어집니다. 비정상 흐름에서는 요청자의 SYN을 받은 B 서비스 서버가 SYN,ACK 대신 잘못된 sequence number의 ACK만 응답했고, 요청자는 SYN을 3회 재전송했습니다. 팀은 포트 재사용이 반복되다가 B 서비스 쪽에서 TCP 소켓이 제대로 닫히지 않아 생기는 증상으로 의심하고 가설을 세웠습니다.

## 가설 수립과 검증 {#hypotheses}

가설은 세 갈래였습니다. 출발지에서 TCP 소켓을 정상 종료하지 않았다, 목적지에서 정상 종료하지 않았다, 출발지와 목적지 사이 네트워크 구간에 문제가 있었다.

출발지 가설은 인스턴스 수량과 타임아웃 조정, AWS 존 이슈로 확인했습니다. 목적지 가설은 서버 수량 조정과 커널 튜닝(인바운드 큐 크기, fin timeout, TIME_WAIT 소켓 수 상한)을 시험했습니다. 두 가설을 동일한 환경에서 재현해 본 결과 커널 튜닝과 서버 증설로는 같은 증상이 그대로 나왔습니다.

세 번째 구간 가설(NAT 증설, IDC 방화벽, IDC L4)을 테스트하던 중 흥미로운 사실이 나왔습니다. AWS NAT Gateway 환경에서 A 서비스가 connection pool을 쓰지 않을 때만 같은 현상이 생긴다는 점이었습니다. 이를 확인하려고 구간별로 구성을 바꿔 다시 테스트했습니다. 경로는 A Service → NAT gateway → Public → IDC → F/W → L4 → B Service입니다.

- connection pool을 쓰면 재현되지 않았습니다.
- AWS와 IDC 사이에 VPN을 구성해 NAT와 Public을 빼도 재현되지 않았습니다.
- 특정 존에서는 같은 현상이 재현되었습니다.
- L4를 빼고 테스트하면 재현되지 않았습니다.

L4가 있는 상태에서 출발지가 connection pool을 쓰면 재현이 안 되고, connection pool 없이 L4만 빼도 재현이 안 됩니다. 팀은 이 결과로 IDC의 L4 구간 이상 동작이라고 범위를 좁혔습니다.

L4에서는 DAM(Direct access mode)이 켜져 있을 때 클라이언트 포트가 변환되는데, 알려진 포트 범위(2000~65000)와 실제 동작이 달랐습니다. 세션 테이블을 확인하면 2048~16383만 보였고 서비스 포트 15000 이상은 확인되지 않았습니다. 클라이언트 요청 과부하로 테스트 VIP 세션이 약 28000을 넘으면 AUX Table의 Allocation fail 수치가 늘었습니다.

## 부하 테스트로 임계치 확인 {#load-test}

원문은 "끝날 때까지 끝난 게 아니다"라며 L4 가설을 한 번 더 검증합니다. AWS 가용 영역(A, B, C)과 NAT Gateway를 1:1로 매핑하고 A 서비스를 각 존에 분배해 부하를 주었습니다. 예상은 L4가 Source IP(NAT Gateway IP) 하나당 약 14000개 포트를 할당하고, B 서비스 테스트 서버의 TIME_WAIT가 약 42000개를 넘으면 같은 현상이 난다는 것이었습니다.

결과는 예상과 맞았습니다. B 서비스 테스트 서버에서 TIME_WAIT 약 42000개가 생기면서 A 서비스에서 5xx가 발생했습니다. NAT Gateway 3개 구성이므로 14000 × 3 = 42000이 됩니다.

## 재발 방지와 정리 {#prevention}

재발 방지 조치는 두 가지입니다. A 서비스 팀과 협업해 connection pool을 쓰도록 바꿨고, AWS와 IDC 사이에서 NAT Gateway를 쓰는 서비스를 조사해 같은 전환을 진행했습니다.

원문은 장애 해결법이 원인 분석 과정에서 쉽게 보이기도 하지만, 원인을 정확히 확인하지 않으면 잠재적 위험을 안고 운영하게 된다고 말합니다. 우아한형제들은 장애 해결을 최우선으로 두면서도 재발 방지를 위해 root cause를 찾는 과정을 중요하게 여긴다고 맺습니다.

{{% details title="원문의 커널 튜닝 값과 테스트 수치" closed="true" %}}

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
