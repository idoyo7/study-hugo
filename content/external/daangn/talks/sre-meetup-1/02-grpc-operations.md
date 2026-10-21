---
title: "실전! gRPC 서비스 운영 노하우"
description: "당근 SRE 밋업 1회에서 클러스터 파트 배상익이 발표한 gRPC 운영 경험의 요약입니다. 채널과 HTTP/2 연결의 관계, keepalive, 상태 코드, L7 로드밸런싱, 모니터링 지표를 당근의 구성과 함께 설명합니다."
date: 2026-10-21
weight: 2
---

# 실전! gRPC 서비스 운영 노하우 (SRE 밋업 1회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [당근마켓 gRPC 서비스 운영 노하우 | 당근마켓 SRE 밋업 1회](https://www.youtube.com/watch?v=igHrQPzLVRw) (34:46)
- 매체 · 게시일: YouTube 당근 채널 · 2021-08-31 (설명란 기준 녹화일 2021-08-26)
- 발표자: 배상익 (Aidan, 당근마켓 SRE 팀 클러스터 파트). 영상 설명란과 슬라이드 표지로 확인했습니다.
- 근거: YouTube 자동 자막 전체(질의응답 포함) + 발표 슬라이드. 슬라이드 PDF는 글자 추출이 깨져 주요 페이지를 이미지로 보고 확인했습니다.
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 주요 구간

- [03:00](https://www.youtube.com/watch?v=igHrQPzLVRw&t=180s) 당근의 gRPC 현황과 인프라 구성
- [06:00](https://www.youtube.com/watch?v=igHrQPzLVRw&t=360s) 트래픽 플로우 이해와 네트워크 테스트 서버
- [09:30](https://www.youtube.com/watch?v=igHrQPzLVRw&t=570s) 채널, 스트림, 클라이언트의 resolver와 로드밸런서
- [12:30](https://www.youtube.com/watch?v=igHrQPzLVRw&t=750s) Keepalive와 MAX_CONNECTION_AGE
- [15:00](https://www.youtube.com/watch?v=igHrQPzLVRw&t=900s) 요청과 응답 구조, 상태 코드
- [19:30](https://www.youtube.com/watch?v=igHrQPzLVRw&t=1170s) 로드밸런싱과 모니터링 지표

## 서비스와 함께 늘어난 운영 이슈

당근에서는 서비스가 빠르게 늘면서 이슈도 같이 늘었고, 발표자는 적은 SRE 인력을 어디에 쓸지 고민했습니다. 입사한 지난해 10월에는 수습 중인 사람을 포함해 SRE가 3명이고, 월간 사용자는 900만에서 1000만 명 수준이었습니다. 이후 직원은 100명에서 200명으로 늘었습니다. Istio 대시보드의 3월 15일과 8월 23일 캡처에서는 gRPC 요청량이 초당 32.5k에서 59.9k로 증가했습니다.

gRPC는 플랫폼 팀의 Go 서비스를 중심으로 도입했으며, Java, Ruby on Rails, Go, Node.js, Python 다섯 언어의 서비스가 사용하고 있었습니다. 슬라이드 기준 내부 호출량은 HTTP가 초당 약 75k 요청, gRPC가 약 60k 요청입니다.

## 트래픽 경로와 연결 동작을 기준으로 운영하기

발표자는 오픈소스를 활용해 운영 부담에 대응했습니다. 당근은 앞단의 HAProxy와 클러스터 안의 Istio ingress gateway·서비스 메시로 gRPC를 처리합니다. 메시에서 실패하면 HAProxy를 거쳐 gRPC 백엔드 풀에 접근하는 경로도 둡니다. 클러스터가 여러 AZ에 걸쳐 있어 액티브/스탠바이 대신 스위칭 전략을 사용합니다.

문제가 생긴 구간을 빨리 찾으려면 운영자가 트래픽 플로우를 직접 그릴 수 있어야 했습니다. ALB(커넥션 기반), NLB(플로우 기반), 프록시, iptables나 IPVS, CNI의 통신 방식과 Kubernetes 네트워크를 파악하고 구간별 메트릭을 준비했습니다. 같은 환경을 공유하는 Go 테스트 서버에는 네트워크 분석용 CLI 도구와 부하 스크립트를 넣었습니다. 환경 변수로 gRPC 디버그 로그를 켜면 HTTP/2 프레임까지 확인할 수 있게 했습니다.

발표자는 gRPC의 중심 개념으로 채널을 꼽았습니다. gRPC 채널은 엔드포인트에 대한 가상 연결로, 하나의 채널을 여러 HTTP/2 연결이 뒷받침할 수 있습니다. RPC는 HTTP/2 스트림으로, 메시지는 프레임으로 처리합니다. L4인 Kubernetes Service에서는 gRPC 요청이 연결 단위로 쏠릴 수 있어 L7 프록시가 필요하며, 프록시가 Service 대신 엔드포인트 목록을 직접 관리하게 합니다.

클라이언트의 resolver와 로드밸런서는 주기적으로 DNS를 다시 풀고, 연결 실패 시 직전 주소 목록으로 재연결합니다. 이 동작 덕분에 클러스터를 통합할 때도 큰 문제가 없었습니다. 발표자는 HTTP/2 ping 프레임으로 연결을 확인하는 keepalive를 프록시의 idle timeout보다 짧게 설정하라고 권했습니다. 슬라이드에 나온 idle timeout은 GCP LB 10분, AWS ELB 60초입니다. 서버가 GOAWAY를 보내 연결을 새로 맺게 하는 MAX_CONNECTION_AGE는 서비스 특성에 맞게 사용하도록 설명했습니다.

응답은 헤더, 데이터, 트레일러로 나뉘며, gRPC 상태는 트레일러의 grpc-status와 grpc-message에 담깁니다. 애플리케이션 레이어에서 다룰 상태와 인프라 레이어에서 볼 상태가 분리되어 있어, SRE는 인프라 쪽 상태 코드를 프로메테우스로 모니터링합니다.

## 적용 결과와 모니터링

- 질의응답에서는 Istio를 ingress gateway로 거의 통합했고, 서비스 특성에 따라 사이드카를 주입하지 않은 서비스도 있다고 답했다.
- gRPC 지원 이슈는 Istio보다 HAProxy에서 더 많이 겪었으며, 연결 풀을 분리해 대응했다.
- 지표를 살피는 순서는 프록시의 connection 관련 오류와 abort, CPU 스로틀링, 네트워크 입출력 바이트, Sentry 같은 이벤트 모니터링, APM이다. 일부에는 Slack 알림을 설정했다.

## 적용할 때 확인할 점

발표자는 큰 노하우를 전하기보다 당근의 운영 방식과 네트워크 구성을 소개하는 자리라고 밝혔습니다. 발표에서 다룬 경험은 2021년 시점입니다.

HAProxy에서 데드라인 초과가 잦았을 때는 연결 풀에서 flow control 오류가 났다고 합니다. 발표자는 gRPC 지원 문서를 정독하고 `http-use-htx` 옵션을 확인하라고 권했습니다. gRPC 모니터링 지표가 아직 부족해 새로 구축한다면 nginx를 쓸 것 같다는 의견도 덧붙였습니다.

CPU 스로틀링으로 응답이 늦어지면 데드라인을 넘길 수 있어, CPU limit 해제나 ingress 계열 파드의 민감도를 높이는 조치를 권했습니다. 개발자에게는 서비스 특성에 맞는 옵션 설정, 인터셉터를 이용한 로깅과 모니터링, 데드라인 설정을 부탁했습니다.

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
