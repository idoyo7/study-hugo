---
title: "당근은 gRPC 연결과 요청 분산을 어떻게 관리하고 장애를 찾았나"
description: "2021년 당근의 gRPC 운영 발표를 요약합니다. 채널과 HTTP/2 연결의 관계를 바탕으로 keepalive, L7 프록시, 상태 코드와 장애 조사 지표를 설명합니다."
date: 2026-10-21
weight: 2
---

# 당근은 gRPC 연결과 요청 분산을 어떻게 관리하고 장애를 찾았나 (SRE 밋업 1회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [당근마켓 gRPC 서비스 운영 노하우 | 당근마켓 SRE 밋업 1회](https://www.youtube.com/watch?v=igHrQPzLVRw) (34:46)
- 매체 · 게시일: YouTube 당근 채널 · 2021-08-31 (설명란 기준 녹화일 2021-08-26)
- 발표자: 배상익 (Aidan, 당근마켓 SRE 팀 클러스터 파트). 영상 설명란과 슬라이드 표지로 확인했습니다.
- 근거: YouTube 자동 자막 전체(질의응답 포함) + 발표 슬라이드. 슬라이드 PDF는 글자 추출이 깨져 주요 페이지를 이미지로 보고 확인했습니다.
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 서비스 증가를 감당해야 했던 소규모 SRE팀 {#서비스와-함께-늘어난-운영-이슈}

발표자는 발표 전해 10월 입사 당시 수습 인원을 포함해 SRE가 3명이었다고 설명합니다. 월간 사용자는 900만~1000만 명이었고, 이후 직원은 100명에서 200명으로 늘었습니다. 서비스가 늘면서 gRPC 운영 이슈도 증가해 적은 인력으로 대응할 방법이 필요했습니다.

gRPC는 플랫폼 팀의 Go 서비스를 중심으로 도입됐고 Java, Ruby on Rails, Go, Node.js, Python 서비스가 사용했습니다. 2021년 3월 15일과 8월 23일 대시보드에서 gRPC 요청량은 초당 32.5k에서 59.9k로 늘었습니다. 발표 슬라이드가 제시한 내부 호출량은 HTTP 약 75k rps, gRPC 약 60k rps입니다.

## 요청 경로와 HTTP/2 연결을 함께 확인하기 {#트래픽-경로와-연결-동작을-기준으로-운영하기}

당근은 앞단의 HAProxy와 클러스터 내부의 Istio ingress gateway·서비스 메시로 gRPC 요청을 처리했습니다. 메시 경로가 실패하면 HAProxy를 거쳐 gRPC 백엔드 풀에 접근하는 경로도 뒀습니다. 여러 AZ에 걸친 클러스터에서는 액티브/스탠바이 대신 스위칭 전략을 사용했습니다.

장애 위치를 찾으려면 요청이 지나가는 구간을 파악해야 했습니다. 발표자는 ALB의 커넥션, NLB의 플로우, 프록시, iptables·IPVS, CNI와 Kubernetes 네트워크 동작을 이해하고 구간별 메트릭을 준비했다고 설명합니다. 운영 환경을 공유하는 Go 테스트 서버에는 분석 CLI와 부하 스크립트를 넣었고, 환경 변수로 gRPC 디버그 로그를 켜 HTTP/2 프레임까지 확인했습니다.

gRPC 채널은 엔드포인트에 대한 가상 연결이며 여러 HTTP/2 연결로 구현될 수 있습니다. 각 RPC는 HTTP/2 스트림을, 메시지는 프레임을 사용합니다. Kubernetes Service의 L4 분산에서는 연결 하나에 속한 요청이 한쪽에 몰릴 수 있습니다. 당근은 L7 프록시가 Service 대신 엔드포인트 목록을 직접 관리하도록 구성했습니다.

발표에서 설명한 클라이언트 resolver와 로드밸런서는 DNS를 주기적으로 다시 조회하고, 연결 실패 때 직전 주소 목록으로 재연결합니다. 이 동작이 클러스터 통합에도 도움이 됐다고 합니다. keepalive는 HTTP/2 ping으로 연결을 확인하므로 프록시의 idle timeout보다 짧게 설정하도록 권했습니다. 당시 슬라이드의 예는 GCP LB 10분, AWS ELB 60초입니다. 서버가 GOAWAY를 보내 새 연결을 유도하는 MAX_CONNECTION_AGE는 서비스 특성에 맞춰 정하도록 했습니다.

응답은 헤더·데이터·트레일러로 구성되며 gRPC 상태는 트레일러의 grpc-status와 grpc-message에 담깁니다. 당근 SRE는 애플리케이션이 처리할 상태와 인프라가 확인할 상태를 나누고 후자를 Prometheus로 감시했습니다.

## 프록시 오류부터 애플리케이션 추적까지 {#적용-결과와-모니터링}

질의응답에 따르면 ingress gateway는 거의 Istio로 통합했지만, 서비스 특성에 따라 sidecar를 주입하지 않는 예외가 있었습니다. gRPC 관련 문제는 Istio보다 HAProxy에서 더 자주 겪었고 연결 풀을 분리해 대응했습니다.

조사할 때는 프록시의 connection 오류와 abort를 보고, CPU throttling, 네트워크 입출력 바이트, Sentry 같은 이벤트 기록, APM 순으로 확인했습니다. 일부 지표에는 Slack 알림도 설정했습니다.

## 2021년 운영 경험에서 제안한 설정 {#적용할-때-확인할-점}

발표는 당근의 당시 구성과 경험을 소개한 자료입니다. HAProxy에서 데드라인 초과가 반복됐을 때는 연결 풀의 flow control 오류가 원인이었다고 합니다. 발표자는 gRPC 지원 문서와 `http-use-htx` 옵션을 확인하도록 권했으며, 모니터링 지표가 부족해 새로 구성한다면 nginx를 고려하겠다는 의견도 밝혔습니다.

CPU throttling으로 응답이 늦어져 데드라인을 넘기는 상황에는 CPU limit 해제나 ingress 계열 Pod의 민감도를 높이는 조치를 제안했습니다. 개발자에게는 서비스에 맞는 옵션과 데드라인을 설정하고 인터셉터로 로깅·모니터링을 구성해 달라고 요청했습니다.

## 주요 구간

- [03:00](https://www.youtube.com/watch?v=igHrQPzLVRw&t=180s) 당근의 gRPC 현황과 인프라 구성
- [06:00](https://www.youtube.com/watch?v=igHrQPzLVRw&t=360s) 트래픽 플로우 이해와 네트워크 테스트 서버
- [09:30](https://www.youtube.com/watch?v=igHrQPzLVRw&t=570s) 채널, 스트림, 클라이언트의 resolver와 로드밸런서
- [12:30](https://www.youtube.com/watch?v=igHrQPzLVRw&t=750s) Keepalive와 MAX_CONNECTION_AGE
- [15:00](https://www.youtube.com/watch?v=igHrQPzLVRw&t=900s) 요청과 응답 구조, 상태 코드
- [19:30](https://www.youtube.com/watch?v=igHrQPzLVRw&t=1170s) 로드밸런싱과 모니터링 지표

{{% details title="근거와 세부 수치" closed="true" %}}

| 항목 | 내용 | 근거 |
|---|---|---|
| 트래픽 | HTTP 75k rps, gRPC 60k rps | 슬라이드 |
| 언어 | Java, Ruby on Rails, Go, Node.js, Python 다섯 언어 | 슬라이드 |
| gRPC 요청량 추이 | 32.5k ops(3월 15일, 직원 100명)에서 59.9k ops/s(8월 23일, 직원 200명) | 슬라이드 |
| 입사 때 규모 | SRE 3명, 월간 사용자 900만~1000만 | 자막 기준 |
| idle timeout | GCP LB 10m, AWS ELB 60s | 슬라이드 |
| MAX_CONNECTION_AGE 예시 | 60초일 때 GOAWAY 후 새 연결(와이어샤크 캡처) | 슬라이드, 자막 기준 |
| 지표 | Proxy connection 지표, CPU throttling, 네트워크 입출력 바이트, Sentry, APM | 슬라이드 |
| CNI | AWS VPC CNI | 자막 기준 |
| 로깅 | Loki | 자막 기준 |
| 클러스터 구성 | 클러스터 하나에 서비스별 네임스페이스 | 자막 기준 |

HTTP는 자막의 "초당 7만 5천개"와 슬라이드의 75k가 일치합니다. gRPC는 자막 수치가 깨져 슬라이드 값(60k)을 사용했으며, 자막에서 "초당 욕망 개"로 인식된 값은 슬라이드의 59.9k와 맞춰 읽었습니다.

{{% /details %}}
