---
title: "부록 · AZ를 건너면 Pod 간 지연은 얼마나 늘어나는가"
linkTitle: "부록 A Pod 네트워크 RTT"
description: "EKS에서 Pod 간 RTT·대역폭·DNS 조회 수를 같은 노드, 같은 AZ, 다른 AZ로 나눠 잰 외부 실측을 정리하고, 본편 05의 AZ 분할 설명과 조건이 어디서 다른지 근거 등급과 함께 적는다."
weight: 90
date: 2026-10-05
lastmod: 2026-10-05
url: "/monitoring/victoriametrics-operations/a1-pod-network-rtt/"
---

# 부록 · AZ를 건너면 Pod 간 지연은 얼마나 늘어나는가

같은 AZ의 다른 노드와 다른 AZ의 노드에 있는 Pod를 비교했을 때, ping 평균 RTT는 0.339ms에서 0.544ms로 늘었지만 단일 TCP 플로우는 모두 4.96Gbps였습니다. atomai의 [Pod 네트워크 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/networking/06-pod-network-benchmark)가 m5.xlarge 노드에서 보고한 결과입니다. 같은 노드의 Pod 사이 RTT는 0.040ms였습니다.

[05 vmagent AZ 분할]({{< relref "/observability/metrics/victoriametrics/operations/05-vmagent-az-split/index.md" >}})은 scrape 응답이 AZ 경계를 넘는 양을 줄이는 구성을 다룹니다. 이 외부 실측은 지연과 대역폭을 살펴볼 자료지만, scrape나 본편 클러스터를 직접 측정한 값은 아닙니다.

근거 표기 — `✓` 원문 직접 확인 · `Ⓥ` 저자 주장 · `Ⓑ` 벤치마크 수치 · `≈` 눈대중·역산 · `Σ` 여러 사실을 이은 종합 추론 · `?` 미확인. 수치는 모두 atomai 문서가 보고한 값이며 우리가 다시 잰 것이 아닙니다. 각 절 끝의 '근거와 측정 조건'에 조건을 모았습니다.

## 1. 무엇을 어떤 환경에서 쟀는가

m5.xlarge 노드와 Amazon VPC CNI 환경에서 서버 Pod를 같은 노드, 같은 AZ의 다른 노드, 다른 AZ의 노드에 하나씩 두고 클라이언트 Pod 하나가 각각을 호출했습니다. 애플리케이션 트래픽은 Service를 거치지 않고 Pod IP로 직접 보냈습니다.

ping은 유휴 ICMP RTT를, fortio는 HTTP/1.1·gRPC 요청 지연을, iperf3는 TCP 처리량을 측정했습니다. DNS는 glibc 리졸버를 호출하는 Python 스크립트와 tcpdump로 확인했습니다. 서로 다른 도구의 통계량을 빼서 하나의 경로 비용으로 분해한 실험은 아닙니다.

각 셀은 하루에 한 번 잰 값입니다. 분산을 추정할 독립 반복이 없어 순위와 비율은 이 표본에 한정됩니다. 원문도 SLA로 사용할 수 없다고 밝혔습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값 | 근거 |
|---|---|---|
| 클러스터·리전 | Amazon EKS, ap-northeast-2, 컨트롤 플레인 v1.36.2, 사용 AZ 2개(2a, 2b) | `Ⓑ` |
| 노드 | Karpenter가 새로 띄운 m5.xlarge 3대(4 vCPU, Xeon Platinum 8175M). 2a 클라이언트 노드, 2a 서버 노드, 2b 서버 노드 | `Ⓑ` |
| OS·커널 | Amazon Linux 2023, 커널 6.18.41, containerd 2.2.5 | `Ⓑ` |
| CNI·kube-proxy | VPC CNI v1.21.1, kube-proxy 1.35.3 iptables 모드. prefix delegation·Pod ENI 꺼짐 | `Ⓑ` |
| Pod NIC | MTU 9001, TCP 혼잡 제어 cubic | `Ⓑ` |
| 도구 버전 | netshoot v0.14(iperf 3.19, fortio 1.69.5), DNS 클라이언트는 python:3.12-slim(glibc 2.41) | `Ⓑ` |
| 측정일·시각 | 2026-09-02 07:58~08:40 UTC. 문서 갱신은 2026-09-12 | `Ⓑ` |
| 반복 | 셀당 1회(n=1). 분산 추정용 독립 반복 없음 | `Ⓥ` |
| 다른 부하 | 새 노드였으나 consolidation으로 다른 네임스페이스의 작은 Pod 몇 개가 합류. 측정 중 유휴·저트래픽이라고 기술 | `Ⓥ` |
| 이 기록의 성격 | 이번 개정에서 벤치마크를 다시 실행하지 않았다고 원문이 명시 | `Ⓥ` |
| 원문 직접 확인 범위 | 위 값을 원문 본문에서 읽음. 원문 매니페스트와 재현 절차는 우리가 실행하지 않음 | `✓` |

출처: [Pod 네트워크 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/networking/06-pod-network-benchmark) — 「테스트 환경」, 「해석 시 주의사항」

{{% /details %}}

## 2. 경로별 RTT와 요청 지연

유휴 ping 평균은 같은 노드 0.040ms, 같은 AZ 0.339ms, 다른 AZ 0.544ms였습니다. 이 실행에서 같은 AZ에서 다른 AZ로 바뀐 증가분은 약 0.21ms이고, 같은 노드 대비로는 약 0.50ms입니다. 노드나 AZ를 건널 때마다 더할 고정 비용으로 읽을 수는 없습니다.

100qps·keepalive 연결 4개의 HTTP p50도 같은 순서로 0.259ms, 0.461ms, 0.704ms였습니다. 같은 AZ와 다른 AZ 사이 차이는 약 0.24ms입니다. 요청마다 새 연결을 맺은 경우 다른 AZ p50은 1.517ms로 더 컸습니다. 연결을 재사용한 측정에도 AZ 간 지연 차이는 남아 있으며, 새 연결에서 추가된 비용의 구성 요소는 분리해 재지 않았습니다.

연결 16개로 한계까지 부하를 준 실행에서는 달성 qps가 같은 노드 44,991, 같은 AZ 38,507, 다른 AZ 25,602였습니다. 고정된 연결 풀에서 평균 지연이 길어지면 처리할 수 있는 요청률이 낮아지는 관계와 맞습니다. 원문도 이를 모든 환경에 적용할 AZ 페널티로 보지 않습니다.

scrape 역시 HTTP 요청과 응답을 주고받으므로 왕복 지연이 영향을 준다고 추정할 수 있습니다. 원문의 echo 본문은 약 75바이트지만 scrape 응답은 타깃별로 크고 다양합니다. 응답이 커지면 RTT보다 전송 시간이 영향을 더 줄 수 있다는 것은 이 글의 해석이며, 위 수치를 scrape 한 건의 시간으로 환산하지 않습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 근거 |
|---|---|---|
| 유휴 RTT | ping 200회(`-i 0.05`) 평균. 같은 노드 0.040, 같은 AZ 0.339, 다른 AZ 0.544ms. 손실 0/200. mdev는 모두 0.017ms 이하 | `Ⓑ` |
| 단계별 차이 | 같은 AZ − 같은 노드 +0.30, 다른 AZ − 같은 AZ +0.21, 다른 AZ − 같은 노드 +0.50ms. 원문은 이를 노드·AZ당 고정 비용이 아닌 해당 실행의 관측 차이로 규정 | `Ⓑ` `≈` |
| HTTP/1.1 지연 | 100qps, 연결 4개, keepalive, 60초(요청 6,000개). p50 0.259 / 0.461 / 0.704ms, p99 0.350 / 0.667 / 0.812ms | `Ⓑ` |
| gRPC ping 지연 | 100qps, 연결 4개, 30초(요청 3,000개). p50 0.397 / 0.592 / 0.865ms. 다른 AZ의 p99.9는 2.582ms | `Ⓑ` |
| 새 연결 비용 | keepalive 끔, 100qps, 연결 4개, 30초. p50 0.664 / 1.079 / 1.517ms. keepalive p50 대비 +0.405 / +0.618 / +0.813ms. 핸드셰이크·소켓·앱 비용을 분리한 실험은 아님 | `Ⓑ` |
| 고정 풀의 최대 qps | `-qps 0`, 연결 16개, 20초. 44,991 / 38,507 / 25,602 qps. 다른 AZ는 같은 AZ보다 33.5% 낮음. Little의 법칙(동시성 ÷ 평균 지연)과 맞아떨어지나 AZ 페널티의 일반 법칙은 아님 | `Ⓑ` |
| 요청 크기 | HTTP echo 응답 본문 약 75바이트, 실행별 오류 0건. 원문이 기록 | `Ⓥ` |
| scrape 지연으로의 환산 | 원문은 scrape를 재지 않았음. 응답이 클 때 RTT보다 전송 시간이 좌우한다는 추론은 우리 해석 | `Σ` `?` |
| 같은 노드의 꼬리 지연 | 같은 노드의 p99.9·최대가 더 컸던 원인으로 CPU 경합을 의심하나 프로파일링으로 확인하지 않음 | `Ⓥ` |

출처: [Pod 네트워크 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/networking/06-pod-network-benchmark) — 「측정 1 — RTT와 HTTP 레이턴시: 같은 노드 → 같은 AZ → 다른 AZ」

{{% /details %}}

## 3. 단일 플로우 대역폭과 인스턴스 한도

같은 AZ와 다른 AZ의 두 노드 사이에서 단일 TCP 플로우는 모두 4.96Gbps, 8개 플로우는 모두 9.94Gbps였습니다. 원문은 각각 클러스터 배치 그룹 밖의 일반적인 단일 플로우 5Gbps 한도와 m5.xlarge의 "up to 10 Gbps" 피크에 부합한다고 해석합니다.

같은 노드의 Pod는 물리 NIC를 거치지 않아 단일 플로우 29.97Gbps, 8개 플로우 48.15Gbps를 기록했습니다. 단일 플로우의 클라이언트 CPU가 99.8%여서 CPU 한계를 반영했을 가능성이 있습니다. 물리 NIC를 우회했다는 조건만으로 순수 메모리 복사 속도라고 볼 수는 없습니다.

m5.xlarge의 베이스라인은 1.25Gbps이고 10Gbps는 버스트입니다. AZ 간 4개 플로우를 180초 동안 측정했을 때 구간별 값은 9.92~9.94Gbps로 유지됐습니다. 베이스라인으로 내려가는 구간은 관측하지 못했고 180초 초과 전송도 시험하지 않았으므로 장시간 지속 처리량은 이 결과로 정할 수 없습니다.

부하 중 TCP RTT는 송신측 평균 같은 AZ 5.6ms, 다른 AZ 5.4ms로 유휴 ping 평균 0.34ms·0.54ms보다 컸습니다. 큐잉이 가능한 설명이지만 큐의 위치는 확인하지 않았습니다. 프로토콜과 표본 방식도 달라 두 측정값을 직접 빼서 큐 대기 시간을 계산하지 않습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 근거 |
|---|---|---|
| 두 노드 간 단일 플로우 | iperf3 3.19, TCP, 20초. 같은 AZ 4.96Gbps(재전송 4), 다른 AZ 4.96Gbps(재전송 2) | `Ⓑ` |
| 8개 플로우 | 같은 AZ 9.94Gbps(재전송 5,874), 다른 AZ 9.94Gbps(재전송 5,979) | `Ⓑ` |
| 같은 노드 | 단일 29.97Gbps(클라이언트 CPU 99.8%), 8개 48.15Gbps. 물리 NIC 우회. 순수 메모리 복사 속도는 아님 | `Ⓑ` |
| 인스턴스 사양 | m5.xlarge 베이스라인 1.25Gbps, 피크 10Gbps. `describe-instance-types` 결과를 원문이 인용. 원문은 공식 [M5 네트워크 사양](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html)에도 같은 값이 있다고 적음 | `Ⓥ` |
| 180초 지속 테스트 | AZ 간, `-P 4`, 10초 간격 18구간. 최소 9.92, 최대 9.94Gbps. 재전송 44,842회. 버스트가 best effort라는 설명은 원문이 [EC2 대역폭 가이드](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-network-bandwidth.html)를 인용 | `Ⓑ` |
| 한도 해석 | 단일 5Gbps 한도와의 부합은 원문의 해석. 배치 그룹 내부 10Gbps, ENA Express 25Gbps 같은 다른 한도가 있다고 원문이 함께 언급(원문은 "AWS는 문서화합니다"라고만 쓰고 문서를 특정하지 않음) | `Ⓥ` |
| 부하 중 TCP RTT | 송신측 평균 같은 AZ 5,641µs, 다른 AZ 5,420µs, 최대 snd_cwnd 약 4.3MB. 프로토콜·표본 방식이 달라 유휴 ping과 직접 빼지 않음 | `Ⓑ` |
| 측정하지 않은 것 | ENA allowance 카운터 미수집. 재전송 수로 셰이핑 위치를 특정할 수 없음. 180초 초과 구간 미시험 | `Ⓥ` `?` |

출처: [Pod 네트워크 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/networking/06-pod-network-benchmark) — 「측정 2 — 처리량: 단일 플로우 5 Gbps 상한과 인스턴스 10 Gbps 상한」, 「3분 지속 테스트와 버스트 크레딧」

{{% /details %}}

## 4. ndots:5가 만드는 DNS 조회 수

DNS 측정은 AZ 경로 비교와 별도로 수행했습니다. CoreDNS가 AZ마다 하나씩 있었지만 요청이 어느 replica로 갔는지는 재지 않았습니다. 확인한 것은 glibc 리졸버에서 이름 형식과 `ndots` 설정에 따라 달라지는 조회 수입니다.

Pod의 `resolv.conf`에는 search 도메인 4개와 `ndots:5`가 있었습니다. 점이 5개 미만인 이름은 search 접미사를 붙인 후보부터 질의하고 마지막에 절대 이름으로 묻습니다. glibc가 후보마다 A·AAAA를 함께 보내므로 `sts.ap-northeast-2.amazonaws.com` 한 번을 푸는 데 10쿼리가 나갔고 8개가 NXDOMAIN이었습니다. 웜 중앙값은 3.78ms였습니다.

이름 끝에 점을 붙이면 2쿼리·0.80ms, `ndots:1`로 바꾸면 2쿼리·0.54ms였습니다. 점이 하나인 `kubernetes.default`에서는 반대 결과가 나왔습니다. `ndots:1`로 바꾸자 4쿼리에서 6쿼리로, 중앙값은 1.71ms에서 2.04ms로 늘었습니다. 따라서 외부 이름의 개선만으로 짧은 서비스 이름에도 같은 효과가 있다고 볼 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 근거 |
|---|---|---|
| Pod DNS 설정 | search 4개, `ndots:5`, nameserver는 `kube-dns` ClusterIP. NodeLocal DNSCache 없음, autopath 없음 | `Ⓑ` |
| CoreDNS 구성 | v1.14.2, 2 replicas(AZ마다 1개), `cache 30`, `pods insecure` | `Ⓑ` |
| 쿼리 수 | `sts.ap-northeast-2.amazonaws.com`(점 3개) 10쿼리·NXDOMAIN 8개. 끝점을 붙이면 2쿼리·0개. `ndots:1`이면 2쿼리·0개 | `Ⓑ` |
| 웜 지연 | 프로세스당 20회 반복 중앙값. default 3.78ms, 끝점 0.80ms, `ndots:1` 0.54ms. 프로세스 첫 호출은 6.22ms | `Ⓑ` |
| 짧은 이름의 역효과 | `kubernetes.default`는 default에서 4쿼리·1.71ms, `ndots:1`에서 6쿼리·2.04ms | `Ⓑ` |
| 측정 범위 | 리졸버는 glibc 2.41 하나. musl 등은 미측정. tcpdump는 UDP 53만 관찰 | `Ⓥ` |
| 캐시 상태 | 첫 호출이라도 CoreDNS·업스트림 캐시가 비었다고 볼 수 없다고 원문이 단서. `cache 30`은 TTL 상한 | `Ⓥ` |
| AZ 간 DNS 비율 | 원문은 측정하지 않았다고 명시. 엔드포인트 둘을 같은 확률로 고르는 모델은 설명용 | `Ⓥ` `?` |

출처: [Pod 네트워크 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/networking/06-pod-network-benchmark) — 「측정 4 — DNS: ndots:5가 만드는 쿼리 증폭」

{{% /details %}}

## 5. vmagent scrape와 비교할 때의 조건 {#5-본편-05와-맞춰-보면}

본편의 AZ 분할은 같은 scrape 응답이 AZ 경계를 몇 번 넘는지를 바꿉니다. 이 실측은 경로별 요청 지연과 처리량을 비교했습니다. 전송량과 지연은 관련될 수 있지만 측정 대상과 경로가 달라 개선량을 서로 환산할 수는 없습니다.

| 항목 | 본편 05 | atomai 원문 | 맞춰 읽는 법 |
|---|---|---|---|
| 비교 축 | AZ 간 scrape 전송량 | 지연, 대역폭, DNS 쿼리 수 | 겹치는 수치가 없어 직접 대조하지 못함 |
| AZ 간 대역폭 | 다루지 않음 | 단일 플로우 4.96Gbps로 같은 AZ와 동일 | 이 환경에서는 AZ 간 대역폭 감소가 관측되지 않음. 본편은 전송량 감소를 다룸 |
| AZ 간 지연 | 다루지 않음 | 같은 AZ보다 ping 평균 +0.21ms | 이 실행의 경로 간 차이. 본편 클러스터의 RTT나 scrape 개선량은 미측정 |
| 트래픽 종류 | scrape 응답(크기 큼, 타깃에 따라 다름) | 작은 echo와 iperf3 포화 부하 | 응답 크기 조건이 달라 환산 불가 |
| 경로 | 타깃 → vmagent → 쓰기 LB → vminsert | Pod IP 직접 통신, Service·LB 미경유 | LB를 낀 경로에는 이 수치를 적용하지 않음 |
| 환경 | 우리 클러스터(본편 서술) | ap-northeast-2의 m5.xlarge 3대, 2개 AZ | 인스턴스 타입이 다르면 대역폭 한도가 달라짐 |

본편: [vmagent AZ 분할]({{< relref "/observability/metrics/victoriametrics/operations/05-vmagent-az-split/index.md" >}})

이 결과를 참고하면 작은 요청의 지연, 포화 전송의 대역폭, DNS 조회 수를 각각 측정해야 하는 이유를 볼 수 있습니다. Service·LB를 거치는 본편 경로의 성능이나 AZ 분할 뒤의 변화는 별도 관측이 필요합니다.

## 6. scrape에서 추가로 확인할 항목 {#6-보충으로-얻는-것과-남은-질문}

원문에서는 AZ 간 ping·HTTP 지연이 더 컸지만 노드 간 대역폭은 같았습니다. 이 차이를 본편에 적용하려면 실제 scrape의 응답 크기와 경로를 반영한 측정이 필요합니다. DNS 조회 수의 변화는 AZ 분할과 분리해서 다뤄야 합니다.

| 항목 | 상태 |
|---|---|
| scrape 요청을 같은 AZ와 다른 AZ에서 나눠 잰 지연 | 원문에 없음 |
| 응답 크기별 AZ 간 전송 시간 | 원문은 응답 약 75바이트만 측정 |
| 같은 실험을 다른 인스턴스 타입이나 다른 리전에서 반복한 값 | 원문에 없음 |
| 180초 이상 지속 전송에서의 대역폭 | 원문이 미시험이라고 명시 |
| AZ 간 DNS 쿼리 비율 | 원문이 미측정이라고 명시 |
| 우리 환경에서의 RTT | 이 문서는 재지 않음 |

## 참고 자료

- Pod 네트워크 실측 벤치마크 — 같은 노드·같은 AZ·다른 AZ, 그리고 DNS ndots, atomai Kubernetes 가이드북(kubernetes-docs), 2026-09-02 측정(2026-09-12 갱신). [https://www.atomai.click/kubernetes-docs/ko/networking/06-pod-network-benchmark](https://www.atomai.click/kubernetes-docs/ko/networking/06-pod-network-benchmark)
