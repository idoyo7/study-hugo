---
title: "부록 · HDD를 NVMe로 붙이면 오버헤드가 줄어드는가"
linkTitle: "부록 A NVMe HDD"
description: "HDD를 NVMe로 붙이는 두 경로(네이티브 NVMe HDD, NVMe-oF 타깃 뒤의 SATA·SAS HDD)의 구조와 제품화 상태, 프로토콜 오버헤드와 HDD 요청 시간의 크기 차이, 큐 수와 액추에이터 수의 관계를 근거 등급과 함께 정리한다."
weight: 90
date: 2026-10-05
lastmod: 2026-10-05
url: "/storage/a1-nvme-hdd/"
---

# 부록 · HDD를 NVMe로 붙이면 오버헤드가 줄어드는가

기존 SATA·SAS HDD를 NVMe-oF(네트워크로 NVMe 명령을 주고받는 방식) 타깃 뒤에 두면 호스트에 NVMe 저장 공간으로 제공할 수 있습니다. 드라이브 자체가 NVMe(저장장치용 호스트 인터페이스 규격)를 지원하는 방식도 규격과 시연까지 나왔지만, 이 글에서 구매 가능한 제품은 찾지 못했습니다.

이 연결이 HDD 요청 시간을 얼마나 줄일지는 따로 봐야 합니다. 데이터시트로 추정한 랜덤 읽기의 기구 시간은 12ms 안팎이고, 인용한 프로토콜 비용은 마이크로초 단위입니다. 네이티브 NVMe HDD의 절감량을 직접 잰 자료는 없으며, Seagate도 주된 개발 목적을 성능보다 스택 단순화로 설명했습니다.

근거 표기 — `✓` 원문 직접 확인 · `Ⓥ` 벤더·저자 주장 · `Ⓑ` 벤치마크·데이터시트 수치 · `≈` 눈대중·역산 · `Σ` 여러 사실을 이은 종합 추론 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 본편은 [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})입니다.

## 1. HDD를 NVMe로 붙이는 두 길

{{< flow src="_flow/1-두-경로.json" />}}

그림 아래쪽은 이미 가진 HDD를 사용하는 경로입니다. SATA·SAS HDD를 서버에 연결하고, 서버가 nvmet이나 SPDK nvmf 타깃(저장장치를 내주는 쪽)으로 NVMe-oF namespace(호스트에 제공하는 논리 저장 공간)를 내보냅니다. 여러 자료를 연결하면 현재 소프트웨어로 구성할 수 있는 방식입니다.

이때 NVMe로 바뀌는 범위는 호스트 스택과 네트워크 구간까지입니다. 타깃 안에서 HDD에 접근하는 sd와 libata 또는 SAS HBA 드라이버는 남습니다. Linux libata 문서는 T10 SAT에 따른 SCSI↔ATA 변환을 설명합니다. 이를 타깃 구성과 연결하면 iSCSI(LIO)로 내보낼 때도 타깃 아래쪽 경로는 같다고 해석할 수 있습니다. 전체 순서를 한 문서에서 확인한 결과는 아닙니다.

그림 위쪽의 네이티브 NVMe HDD는 드라이브 자체가 NVMe 명령을 받습니다. Seagate는 드라이브 안에 컨트롤러가 있어 SAS·SATA 브리지가 필요 없다고 설명합니다. 이 차이는 시연 장비에서 확인한 업체 설명이며 시판품의 특성으로 확정할 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 네이티브 NVMe HDD는 드라이브가 NVMe를 직접 처리 | 드라이브 안에 컨트롤러가 있어 SAS·SATA 브리지가 필요 없다는 설명. 시연 장비 기준이며 구매할 수 있는 제품의 값이 아님 | Seagate 글(StorageNewsletter 재수록), StorageNewsletter | `Ⓥ` |
| 기존 SATA·SAS HDD를 NVMe-oF로 제공 가능 | HDD를 서버에 연결하고 nvmet이나 SPDK nvmf로 NVMe-oF namespace를 내보내는 구성. 현재 소프트웨어로 가능한 경로라는 종합 판단 | — | `Σ` |
| libata가 SCSI↔ATA 변환을 담당 | T10 SAT에 따른 변환 | Linux libata 문서 | `✓` |
| iSCSI로 제공해도 타깃 아래쪽 경로는 같음 | iSCSI(LIO)와 NVMe-oF 타깃 뒤의 SATA·SAS HDD 경로 비교 | — | `Σ` |

{{% /details %}}

## 2. 규격과 실물은 어디까지 왔는가

NVMe 규격과 Linux 호스트 코드는 회전 매체를 지원합니다. 공개 자료에서 네이티브 NVMe HDD의 제품화는 시연 단계까지 확인했으며, 구매할 수 있는 제품은 찾지 못했습니다.

| 시점 | 내용 | 근거 |
|---|---|---|
| 2021-06~07 | NVMe 2.0에 회전 매체 지원(TP 4088) 추가. 식별 비트(NSFEAT 비트 4, EGFEAT), 로그 페이지 16h, Spinup Control feature(1Ah), 전원 상태 규칙 | `✓` |
| 2021-11 | Seagate가 OCP Global Summit에서 네이티브 NVMe HDD 시연. 12×3.5인치 PoC JBOD, PCIe 3 스위치 | `Ⓥ` |
| 2024-11 | Linux 6.13에 호스트 쪽 rotational 인식 커밋 머지 | `✓` |
| 2025-03 | GTC에서 NVMe HDD 8개 + NVMe SSD 4개 + BlueField-3 PoC 재시연 | `Ⓥ` |
| 2025-12 | 현행 Exos SATA 매뉴얼의 인터페이스는 SATA. 문서에 NVMe라는 단어가 없음 | `✓` |

NVM Express의 변경 목록은 회전 매체 지원이 NVMe 2.0에 들어갔다고 설명합니다. 식별 비트, 로그 페이지, 기능 설정, Endurance Group(내구성 관리 단위) 지원 의무, 전원 상태 규칙이 추가됐습니다. Base Specification 내용을 종합하면 읽기·쓰기는 기존 NVM Command Set을 그대로 사용합니다. 회전 매체 규정은 본문에서 확인했지만 변경 제안인 TP 4088 원문은 열지 못했습니다.

시연 기사에 나온 일정은 실제 출시와 구분해야 합니다. 엔지니어링 샘플과 고객 데모 유닛 일정이 발표됐지만 2024년 고객 데모 유닛은 시판품이 아니라는 정정이 붙었습니다. 후속 기사도 출시일을 알기 어렵다고 적었습니다. Seagate 블로그는 요약만 확인했고, 그 내용은 출하일이나 성능 수치가 없는 로드맵 수준입니다. 시험용 물량의 실제 출하나 WD·Toshiba의 개발 상태를 확인할 1차 자료는 확보하지 못했습니다.

호스트에서의 회전 매체 인식은 Linux 6.13부터 확인됩니다. NVMe namespace의 회전 비트를 읽어 `queue/rotational`에 반영하는 코드가 있고, 직전 6.12 소스에는 해당 코드가 없습니다. 이전 커널이 NVMe namespace를 비회전 장치로 취급했다는 판단은 이 차이에 근거합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| NVMe 규격에 회전 매체 지원 추가 | 2021-06~07, NVMe 2.0, TP 4088. NSFEAT 비트 4와 EGFEAT, 로그 페이지 16h, Spinup Control feature(1Ah), 전원 상태 규칙 | Changes in NVM Express Revision 2.0, NVM Express Base Specification 2.0a | `✓` |
| 규격이 추가한 항목 | 식별 비트(NSFEAT, EGFEAT), 로그 페이지, feature, Endurance Group 지원 의무, 전원 상태 규칙을 추가 | NVM Express Base Specification 2.0a | — |
| 읽기·쓰기와 기존 명령의 관계 | 읽기·쓰기는 기존 NVM Command Set 사용 | NVM Express Base Specification 2.0a | `Σ` |
| 규격 확인 범위 | NVMe Base Specification 2.0a의 8.20절 확인. TP 4088 문서 자체는 열지 못함 | NVM Express Base Specification 2.0a, TP 4088 | `?` |
| Seagate가 네이티브 NVMe HDD 시연 | 2021-11 OCP Global Summit. 12×3.5인치 PoC JBOD, PCIe 3 스위치 | StorageNewsletter, Blocks & Files, Tom's Hardware의 2021년 시연 기사 | `Ⓥ` |
| 시연 당시 공개한 제품화 일정 | 2022년 9월 엔지니어링 샘플, 2024년 중반 고객 데모 유닛. 2024년분은 시판품이 아니라는 정정이 붙음 | StorageNewsletter(일정), Tom's Hardware(정정) | `Ⓥ` |
| Linux 호스트에 회전 매체 인식 코드 반영 | 2024-11, Linux 6.13에 rotational 인식 커밋 머지 | torvalds/linux | `✓` |
| GTC에서 NVMe HDD 구성 재시연 | 2025-03, NVMe HDD 8개 + NVMe SSD 4개 + BlueField-3 PoC | Blocks & Files, Tom's Hardware의 2025년 시연 기사 | `Ⓥ` |
| 후속 기사에서도 출시일은 불명확 | 2025년 기사에 출시일을 알기 어렵다고 기재 | Tom's Hardware 2025-03-18 | `Ⓥ` |
| Seagate 블로그의 확인 범위 | 2025-03 블로그는 요약만 확인. 출하일과 성능 수치가 없는 로드맵 수준 | NVMe hard drives and the future of AI storage | `Ⓥ` `?` |
| 현행 Exos 매뉴얼은 SATA 인터페이스를 명시 | 2025-12 Exos SATA 매뉴얼. 문서에 NVMe라는 단어가 없음 | Exos SATA Product Manual 210048100 Rev E | `✓` |
| 구매 가능한 네이티브 NVMe HDD를 찾지 못함 | 2026-10 기준. Seagate 블로그, 현행 Exos 매뉴얼, WD 데이터시트, 2025~2026년 기사 검색까지 확인. 공개 자료에서 제품화는 시연 단계까지 확인 | Seagate 블로그, Exos 매뉴얼, WD 데이터시트, 관련 기사 | `Σ` |
| 시험용 물량 출하와 다른 제조사의 개발 상태는 미확인 | Seagate 시험용 물량이 고객에게 나갔는지, WD·Toshiba가 개발 중인지 확인할 1차 자료 없음 | 이 글에서 확인한 자료 | `?` |
| Linux 호스트가 회전 비트를 장치 속성에 반영 | Linux 6.13부터 NVMe namespace의 회전 비트를 읽어 `queue/rotational`에 반영 | torvalds/linux, nvme/host/core.c | `✓` |
| 이전 Linux 커널은 NVMe namespace를 비회전으로 취급했다는 추론 | Linux 6.12 소스에 해당 비트를 읽는 코드가 없음 | torvalds/linux, v6.12·v6.13 | `Σ` |

{{% /details %}}

## 3. 오버헤드는 줄어도 드러나지 않는다

{{< lane src="_lane/3-기구-대-프로토콜.json" />}}

HDD 요청에는 헤드를 옮기는 탐색과 원하는 위치가 돌아오기를 기다리는 시간이 들어갑니다. 7200rpm HDD의 QD1(큐 깊이) 랜덤 읽기를 가정해 탐색 8.0ms와 회전 대기 4.16ms를 더하면 기구 시간만 12.16ms입니다. 탐색은 WD Ultrastar He12의 2018년 데이터시트 값이고, 최근 데이터시트에서는 새 값을 찾지 못했습니다. 명령 처리와 데이터 전송 시간은 이 계산에 포함하지 않았습니다.

본편 01이 인용한 ReFlex의 무부하 4KB 읽기 실험에서는 로컬 78µs, iSCSI 211µs로 추가 지연이 133µs였습니다. 이 추가 지연을 12.16ms와 비교하면 약 1.1%입니다. 미디어를 제외한 커널 NVMe/TCP QD1 왕복 21.39µs는 같은 기구 시간의 약 0.18%입니다.

이 비율은 다른 장비와 시기의 자료로 시간의 크기를 비교한 값입니다. HDD의 전송 방식을 바꿔 직접 잰 개선율이 아니며, iSCSI와 NVMe/TCP 수치를 서로 빼지도 않았습니다. 인용한 iSCSI 추가 지연 안에서만 절감할 수 있다고 추정하면 상한의 크기는 HDD 요청 한 건의 1% 안팎입니다. 그림의 세 막대도 합산하거나 성능 순위를 매기는 용도로 읽어서는 안 됩니다.

[02]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}})가 인용한 Hajnoczi의 도식은 장치가 빨라질수록 같은 소프트웨어 오버헤드의 비중이 커진다고 설명합니다. HDD에 이 관계를 적용하면 긴 기구 시간 때문에 프로토콜 개선의 비중은 작을 것으로 추정할 수 있습니다. 로컬 SCSI 스택과 NVMe 스택의 요청당 CPU 시간을 같은 장비에서 비교한 자료는 확보하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| HDD 랜덤 읽기의 기구 시간 추정 | 7200rpm, QD1(큐 깊이) 랜덤 읽기. 탐색 8.0ms에 회전 대기 4.16ms를 더한 12.16ms 수준으로, 앞머리의 12ms 안팎에 해당. 명령 오버헤드와 전송 시간 제외 | WD Ultrastar He12 데이터시트(탐색 8.0ms), Exos X18·WD HC550 데이터시트(평균 회전 대기 4.16ms) | `Ⓑ` `≈` |
| 탐색 시간의 최신 값은 확보하지 못함 | 탐색 8.0ms는 2018년 데이터시트 값. 최근 데이터시트는 해당 항목을 싣지 않아 새 값을 찾지 못함 | WD Ultrastar He12 데이터시트, 최근 데이터시트 | `?` |
| iSCSI가 로컬 읽기보다 추가한 지연 | 무부하 4KB 읽기에서 로컬 78µs, iSCSI 211µs. 차이는 133µs | ReFlex(ASPLOS'17) Table 2 | `Ⓑ` |
| 커널 NVMe/TCP의 왕복 시간 | 미디어 제외, QD1, 21.39µs | SPDK NVMe-oF TCP 성능 보고서(커널 타깃, null 장치) | `Ⓑ` |
| 비율 계산에 사용한 자료의 조건이 다름 | 분자는 SSD·NVMe 장비에서 2017~2024년에 잰 값, 분모는 2018년 데이터시트 값. 같은 실험이 아니며 자릿수 감각용 비교 | iSCSI·커널 NVMe/TCP 측정, WD Ultrastar He12 데이터시트 | — |
| iSCSI 추가 지연이 HDD 기구 시간에서 차지하는 비율 | 133µs를 12.16ms와 비교하면 약 1.1% | iSCSI 읽기 실험, WD Ultrastar He12 데이터시트 | `Σ` `≈` |
| NVMe/TCP 왕복 시간이 HDD 기구 시간에서 차지하는 비율 | 21.39µs를 12.16ms와 비교하면 약 0.18% | 커널 NVMe/TCP 측정, WD Ultrastar He12 데이터시트 | `Σ` `≈` |
| iSCSI를 NVMe/TCP로 바꿀 때 절감량 상한의 자릿수 추정 | 인용한 조건에서 상한은 iSCSI 추가 지연인 133µs 안쪽, HDD 한 건의 약 1%. 서로 다른 실험이므로 133에서 21.39를 빼지는 않음 | iSCSI·커널 NVMe/TCP 측정, WD Ultrastar He12 데이터시트 | `Σ` `≈` |
| 빠른 장치에서는 같은 소프트웨어 오버헤드의 비중이 커짐 | Hajnoczi 도식에서 100µs짜리 디스크는 5%, 15µs짜리 디스크는 33% | 본편 02가 인용한 Hajnoczi 도식 | `Ⓥ` |
| HDD에서는 같은 소프트웨어 오버헤드의 비중이 더 작아진다는 추론 | 장치 시간이 12ms인 HDD에 Hajnoczi 도식의 관계를 적용한 해석 | Hajnoczi 도식, HDD 기구 시간 추정 | `Σ` |
| 로컬 스택의 요청당 CPU 시간 비교는 미확인 | 같은 장비에서 SCSI 스택과 NVMe 스택을 비교한 값이 이 글의 자료에 없음 | 이 글에서 확인한 자료 | `?` |
| 그림의 비교 범위 | 탐색과 회전 대기는 인터페이스와 무관하게 남음. 세 막대는 합산하거나 순위를 매길 대상이 아니며, 비율은 자릿수 감각용 | 이 절의 도식과 인용 자료 | — |

{{% /details %}}

## 4. 큐가 많아도 헤드는 하나다

| 인터페이스 | 큐 한도 | 근거 |
|---|---|---|
| SATA NCQ | 태그 32개 | `✓` |
| SAS | Exos X16 SAS 매뉴얼이 "128 - deep task set"과 "up to 64 queue tags"를 함께 적음. 어느 쪽이 실제 한도인지 확인하지 못함 | `✓` `?` |
| NVMe | I/O 큐 최대 65,535개, 큐당 미처리 명령 최대 65,535개 | `✓` |

NVMe의 큰 큐 한도가 단일 액추에이터 HDD의 병렬 읽기로 이어지지는 않습니다. Linux NVMe host는 기본으로 CPU 수만큼 I/O 큐를 생성합니다. 이 큐는 CPU 쪽 제출 경합을 줄이는 데 쓰이지만, 한 번에 읽고 쓸 수 있는 위치 수는 액추에이터(헤드를 움직이는 기구)에 달렸다고 해석할 수 있습니다. 단일 액추에이터는 한 번에 한 위치를 처리합니다.

드라이브는 대기 요청의 순서를 바꿔 기구 작업량을 줄일 수 있습니다. SATA-IO가 설명하는 NCQ의 역할도 이 재배치입니다. 큐에 요청을 더 넣는 것과 독립적으로 처리할 헤드를 더 두는 것은 다른 변화입니다. 단일 액추에이터 HDD에서 큐 수·깊이에 따른 IOPS(초당 입출력 처리 수)를 직접 잰 공개 자료는 찾지 못했습니다.

Seagate Exos 2X18 SATA는 독립 액추에이터 둘이 LBA(논리 블록 주소)의 앞 50%와 뒤 50%를 나누어 맡습니다. 매뉴얼은 함께 사용할 때 지속 전송률 520MiB/s, 액추에이터당 260을 제시합니다. NCQ 깊이는 32로 유지됩니다.

SAS 모델은 9TB LUN(논리 장치 단위) 둘로 표시되며 4K QD16 랜덤 읽기 304 IOPS라는 수치를 리뷰 기사 요약에서 확인했습니다. 단일 액추에이터 Exos X18 데이터시트의 같은 4K QD16 조건은 170 IOPS여서 비율은 1.79배입니다. 서로 다른 문서이고 한쪽은 2차 인용이므로 참고용 비교입니다. 이 수치를 3절의 He12 기반 12.16ms와 섞거나 큐 한도를 IOPS 이득으로 환산할 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| SATA NCQ의 큐 한도 | 태그 32개 | torvalds/linux(libata.h), Seagate SATA 매뉴얼 | `✓` |
| SAS 모델의 큐 한도 표기가 서로 다름 | Exos X16 SAS 매뉴얼에 "128 - deep task set"과 "up to 64 queue tags"가 함께 있음. 어느 쪽이 실제 한도인지 확인하지 못함 | Exos X16 SAS Product Manual 100845788 Rev G | `✓` `?` |
| NVMe의 큐 한도 | I/O 큐 최대 65,535개, 큐당 미처리 명령 최대 65,535개 | NVM Express Base Specification 2.0a | `✓` |
| Linux NVMe host의 기본 큐 구성 | 기본으로 CPU 수만큼 I/O 큐를 생성 | torvalds/linux | — |
| NVMe 규격은 복수 액추에이터를 표현 | 회전 매체를 "one or more actuators"로 정의하고 액추에이터 수를 로그에 별도로 기록 | NVM Express Base Specification 2.0a | `✓` |
| NCQ는 처리 순서를 바꿔 기구 작업량을 줄임 | SATA-IO 예시 그림에서 명령 넷을 NCQ로 1과 1/4바퀴, NCQ 없이 2와 3/4바퀴에 처리 | SATA-IO, Native Command Queuing | `Ⓥ` |
| 단일 액추에이터 HDD의 큐별 성능 변화는 미확인 | 큐 수와 깊이를 바꾸며 IOPS를 잰 공개 측정을 찾지 못함 | 이 글에서 확인한 자료 | `?` |
| Exos 2X18 SATA는 독립 액추에이터를 사용 | 독립 액추에이터 둘이 LBA의 앞 50%와 뒤 50%를 각각 담당 | Exos 2X18 SATA Product Manual 203859600 Rev A | `✓` |
| Exos 2X18 SATA의 전송률과 NCQ 깊이 | 두 액추에이터를 함께 쓸 때 지속 전송률 520MiB/s, 액추에이터당 260. NCQ 깊이는 32 | Exos 2X18 SATA Product Manual 203859600 Rev A | `✓` |
| Exos 2X18 SAS의 구성과 랜덤 읽기 성능 | 9TB LUN(논리 장치 단위) 둘로 표시. 4K QD16 랜덤 읽기 304 IOPS. 데이터시트를 받지 못해 리뷰 기사 요약만 확인 | StorageReview, Seagate Exos 2X18 | `Ⓑ` `?` |
| 단일 액추에이터 Exos X18의 랜덤 읽기 성능 | 같은 4K QD16 조건에서 170 IOPS | Exos X18 데이터시트 | `Ⓑ` |
| 인용한 랜덤 읽기 수치의 비율 | 304 IOPS는 170 IOPS의 1.79배. 서로 다른 문서이며 한쪽은 2차 인용이므로 참고용 | StorageReview의 Exos 2X18 요약, Exos X18 데이터시트 | `≈` |

{{% /details %}}

## 5. 그래도 NVMe HDD를 만드는 이유

Seagate가 설명한 개발 동기는 HDD와 SSD의 연결·관리 방식을 통일하는 데 모여 있습니다. David Allen은 성능이 주된 목적은 아니었고 스택을 단순화하려는 작업이었다고 말했습니다.

| 업체가 든 동기 | 출처 | 근거 |
|---|---|---|
| 스택 단순화가 목적이었고 성능은 주된 목적이 아니었다 | David Allen(Seagate), TechTarget 2021-11-12 | `Ⓥ` |
| SAS IOC·익스팬더·전용 드라이버를 없애고 CPU나 PCIe 스위치에 SSD처럼 연결 | 같은 기사 | `Ⓥ` |
| 전력 절감은 작은 폭이고 가격·전력은 비슷할 것 | 같은 기사 | `Ⓥ` |
| 단일 NVMe 드라이버와 OS 스택으로 HDD·SSD를 함께 다룸 | Seagate 블로그 2025-03 | `Ⓥ` |
| LUN 분리 없이 멀티 액추에이터 지원 | 같은 기사, Seagate 발표 글 | `Ⓥ` |

Seagate 블로그는 단일 NVMe 드라이버와 OS 스택으로 HDD·SSD를 다루고 HBA(호스트 버스 어댑터)·브리지를 줄이려는 방향을 설명합니다. 블로그는 요약만 확인했습니다. 업체 설명에서 기대할 수 있는 변화는 부품 수, 드라이버, 관리 API, 연결 구성입니다.

이 자료들에는 SAS·SATA HDD 대비 요청 지연이나 IOPS 개선 수치가 없습니다. 네이티브 NVMe HDD와 기존 HDD를 같은 조건에서 비교한 공개 측정도 찾지 못했습니다. GTC 시연 결과는 기존 오버헤드를 없앴다는 정성 설명이며 수치와 대조군을 제시하지 않았습니다.

Seagate는 NVMe-oF에서도 SAS·SATA 드라이브가 먼저 변환 계층을 거쳐야 해서 비효율적이라고 주장합니다. 변환에 걸리는 시간은 제시하지 않았습니다. 부품·전력 이점만으로 지연 개선량을 계산할 수 없고, 인터페이스가 바뀌어도 HDD의 탐색과 회전 대기는 남습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 주된 개발 목적은 스택 단순화 | David Allen의 발언: "Performance was not the main goal or the reason that drove this. It was about simplifying the stack." | David Allen(Seagate), TechTarget 2021-11-12 | `Ⓥ` |
| SAS용 부품과 드라이버를 없앨 수 있다는 설명 | SAS IOC·익스팬더·전용 드라이버를 없애고 CPU나 PCIe 스위치에 SSD처럼 연결 | TechTarget 2021-11-12(IOC·익스팬더·드라이버) | `Ⓥ` |
| HBA·브리지가 필요 없어진다는 주장 | HBA·브리지가 필요 없어진다는 설명. 블로그는 요약만 확인 | Seagate 블로그 2025-03(HBA·브리지, 요약만 확인) | `Ⓥ` `?` |
| 전력과 가격의 예상 | 전력 절감은 작은 폭이며 가격·전력은 비슷할 것이라는 발언 | TechTarget 2021-11-12 | `Ⓥ` |
| HDD와 SSD에 같은 소프트웨어 스택 사용 | 단일 NVMe 드라이버와 OS 스택으로 HDD·SSD를 함께 다룬다는 설명. 블로그는 요약만 확인 | Seagate 블로그 2025-03 | `Ⓥ` `?` |
| 멀티 액추에이터 지원 방식 | LUN 분리 없이 지원한다는 설명 | TechTarget 기사, Seagate 발표 글 | `Ⓥ` |
| 네이티브 NVMe HDD의 직접 성능 비교는 미확인 | NVMe HDD와 SAS·SATA HDD를 같은 조건에서 잰 공개 측정을 찾지 못함 | 이 글에서 확인한 자료 | `?` |
| GTC PoC 결과는 정성 설명 | 2025년 GTC PoC에서 "legacy SAS/SATA overhead was eliminated"라고 서술. 수치와 대조군 없음 | Blocks & Files 2025-03-25 | `Ⓥ` |
| NVMe-oF에서 SAS·SATA 변환 계층이 비효율적이라는 주장 | Seagate는 SAS·SATA 드라이브가 먼저 변환 계층을 거쳐야 한다고 설명 | El-Batal(Seagate), TechTarget 2021-11-12 | `Ⓥ` |
| 변환 계층의 시간 비용은 미확인 | 변환에 걸리는 시간을 제시한 자료 없음 | 이 글에서 확인한 자료 | `?` |

{{% /details %}}

## 6. 타깃 뒤에 HDD를 둘 때 알아 둘 것

NVMe-oF 타깃 뒤에 HDD를 연결할 때는 호스트가 회전 매체 정보를 받는지 확인해야 합니다. Linux nvmet은 뒤의 블록 장치가 회전식이면 namespace에 그 정보를 표시합니다. 타깃과 호스트 코드를 종합하면 양쪽 모두 6.13 이상일 때 호스트까지 회전 정보가 전달됩니다. 타깃 안의 sd·libata 또는 SAS HBA 경로는 이 정보 전달과 별개로 남습니다.

| 항목 | 내용 | 근거 |
|---|---|---|
| 타깃 안의 변환 | sd와 libata(또는 SAS HBA)가 남는다. 줄어드는 것은 호스트와 네트워크 구간의 마이크로초다 | `Σ` |
| nvmet의 rotational 전달 | 6.13부터 뒤의 블록 장치가 회전식이면 NSFEAT의 rotational 비트를 세운다 | `✓` |
| nvmet의 로그 페이지 | 대부분 빈 값이다. 채우는 것은 endurance group 번호와 액추에이터 수(없으면 1)뿐이고 RPM·spinup 횟수는 0 | `✓` |
| SPDK nvmf | master 기준으로 이 비트를 세우지 않는다. `lib/nvmf/ctrlr.c`에 rotational이라는 문자열이 없다 | `✓` |
| 호스트의 인식 조건 | 타깃과 호스트가 모두 6.13 이상이어야 `rotational=1`로 보인다. 한쪽이 6.12 이하면 SSD처럼 다룬다 | `Σ` |

nvmet의 회전 매체 로그에는 endurance group 번호와 액추에이터 수만 들어갑니다. RPM과 spinup 횟수까지 드라이브 정보가 전부 전달되는 것은 아닙니다. SPDK nvmf의 master에서는 회전 비트를 설정하지 않으므로 뒤의 HDD가 호스트에 비회전 장치로 보일 수 있습니다.

이 오인식이 스케줄러, readahead(미리 읽기), 파일시스템·Ceph의 장치 분류에 미치는 영향을 잰 자료는 찾지 못했습니다. Linux I/O 스케줄러의 기본값은 회전 여부보다 하드웨어 큐 수로 정해져 큐가 하나면 mq-deadline, 여럿이면 none입니다. 배포판 udev 규칙이 회전 여부에 따라 이를 바꾸는지는 확인하지 않았습니다. HDD용 NVMe-oF JBOD·EBOF 시판품도 찾지 못했으며 검색에서 나온 EBOF는 SSD용이었습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| nvmet이 뒤의 장치의 회전 여부를 전달 | Linux 6.13부터 뒤의 블록 장치가 회전식이면 NSFEAT의 rotational 비트를 설정 | torvalds/linux, nvme/target/admin-cmd.c·nvmet.h | `✓` |
| nvmet의 회전 매체 로그는 대부분 빈 값 | endurance group 번호와 액추에이터 수만 채움. 액추에이터 수가 없으면 1, RPM·spinup 횟수는 0 | torvalds/linux, nvme/target/admin-cmd.c·nvmet.h | `✓` |
| SPDK nvmf는 회전 비트를 설정하지 않음 | master 기준. `lib/nvmf/ctrlr.c`에 rotational이라는 문자열이 없음 | spdk/spdk | `✓` |
| 호스트까지 회전 정보가 전달되는 조건 | 타깃과 호스트가 모두 6.13 이상이어야 `rotational=1`로 표시. 한쪽이 6.12 이하면 SSD처럼 비회전으로 취급 | torvalds/linux, v6.12·v6.13의 host·target 코드 종합 | `Σ` |
| 회전 여부 오인식의 실제 영향은 미확인 | 스케줄러, readahead, 파일시스템·Ceph의 장치 분류에 미치는 영향을 잰 자료를 찾지 못함 | 이 글에서 확인한 자료 | `?` |
| Linux I/O 스케줄러 기본값의 기준 | 회전 여부가 아닌 하드웨어 큐 수로 결정. 큐가 하나면 mq-deadline, 여럿이면 none | torvalds/linux, block/elevator.c | `✓` |
| 배포판의 추가 스케줄러 선택 규칙은 미확인 | udev 규칙이 rotational을 보고 스케줄러를 바꾸는지 확인하지 못함 | 배포판 udev 규칙 | `?` |
| HDD용 NVMe-oF 인클로저의 시판 여부는 미확인 | HDD용 NVMe-oF JBOD·EBOF 시판품을 찾지 못함. 검색에서 나온 EBOF는 SSD용 | 이 글의 제품 검색 | `?` |

{{% /details %}}

## 7. 확인하지 못한 것

| 항목 | 상태 |
|---|---|
| TP 4088 원문, OCP NVMe HDD Specification 1.0b 본문 | 변경 목록과 Base 2.0a 본문만 확인. OCP 문서는 접근이 막혀 큐·커넥터·ZNS 요구를 확인하지 못함 |
| Seagate 시험 물량의 실제 출하, WD·Toshiba 개발 여부 | 확인할 1차 자료 없음 |
| NVMe HDD 대 SAS·SATA HDD 동일 조건 측정 | 공개 측정을 찾지 못함 |
| 단일 액추에이터 HDD의 큐 수·깊이별 IOPS | 공개 측정을 찾지 못함 |
| 로컬 SCSI 스택 대 NVMe 스택의 요청당 CPU 시간 | 이 글에서 확인한 자료에 없음 |
| 최신 20TB급 니어라인의 평균 탐색 시간 | 제조사가 해당 값을 싣지 않아 2018년 값을 사용 |
| Exos 2X18 SAS 데이터시트 원문 | 리뷰 기사 요약만 확인 |
| Linux가 Number of Actuators로 independent access ranges를 채우는지 | 확인하지 않음 |
| ZNS 명령 집합으로 SMR 존을 내놓는지 | 확인하지 못함 |

## 참고 자료

- [Changes in NVM Express Revision 2.0](https://nvmexpress.org/changes-in-nvm-express-revision-2-0/) — NVM Express, 2021. TP 4088
- [NVM Express Base Specification 2.0a](https://nvmexpress.org/wp-content/uploads/NVMe-NVM-Express-2.0a-2021.07.26-Ratified.pdf) — NVM Express, 2021-07-23. 8.20절 회전 매체, 로그 16h, feature 1Ah, 큐 한도
- [torvalds/linux](https://github.com/torvalds/linux) — master와 v6.12·v6.13 태그. nvme/host/core.c, nvme/target/admin-cmd.c·nvmet.h, block/elevator.c, libata 문서, sysfs-block
- [spdk/spdk](https://github.com/spdk/spdk) — master. lib/nvmf/ctrlr.c, doc/bdev.md
- [OCP Global Summit: Seagate Demonstrated First Native NVMe HDD](https://www.storagenewsletter.com/2021/11/17/ocp-global-summit-seagate-demonstrated-first-native-nvme-hdd/) — StorageNewsletter(David Allen, Seagate), 2021-11-17. 시연과 장점 목록
- [Seagate debuts NVMe HDD technology at OCP](https://www.techtarget.com/searchstorage/news/252509448/Seagate-debuts-NVMe-HDD-technology-at-OCP) — TechTarget, 2021-11-12. 동기 발언
- [Hooking up a faucet to Niagara Falls](https://www.blocksandfiles.com/disk/2021/11/11/hooking-up-a-faucet-to-niagara-falls-seagate-demos-nvme-accessed-disk-drives-at-open-compute-summit/1591575) · [Seagate spins an NVMe hybrid flash-disk array story](https://blocksandfiles.com/2025/03/25/seagate-spins-an-nvme-hybrid-flash-disk-array-story/) — Blocks & Files, 2021-11-11·2025-03-25
- [Seagate demonstrates HDD with PCIe NVMe](https://www.tomshardware.com/news/seagate-demonstrates-hdd-with-pcie-nvme-interface) · [GPU meets PCIe-based hard drives](https://www.tomshardware.com/pc-components/hdds/gpu-meets-pcie-based-hard-drives-seagate-and-nvidia-demo-nvme-hdds) — Tom's Hardware, 2021-11·2025-03-18
- [NVMe hard drives and the future of AI storage](https://www.seagate.com/blog/nvme-hard-drives-and-the-future-of-ai-storage/) — Seagate, 2025-03-17. 요약만 확인
- [Exos X18 데이터시트](https://www.seagate.com/content/dam/seagate/migrated-assets/www-content/datasheets/pdfs/exos-x18-channel-DS2045-4-2106US-en_US.pdf) — Seagate, 2021-06. 회전 대기 4.16ms, 4K QD16 170 IOPS
- [Ultrastar He12 데이터시트](https://documents.westerndigital.com/content/dam/doc-library/en_us/assets/public/western-digital/product/data-center-drives/ultrastar-hdd-sata-series/ultrastar-he12/data-sheet-ultrastar-he12.pdf) · [Ultrastar DC HC550 데이터시트](https://documents.westerndigital.com/content/dam/doc-library/en_us/assets/public/western-digital/product/data-center-drives/ultrastar-dc-hc500-series/data-sheet-ultrastar-dc-hc550.pdf) — WD. 탐색 시간 8.0ms, 인터페이스
- [Exos SATA Product Manual 210048100 Rev E](https://www.seagate.com/content/dam/seagate/assets/support/internal-hard-drives/enterprise-hard-drives/exos-m/_shared/files/Seagate_Exos_SATA_Product_Manual_32-30-28-24TB_210048100E.pdf) · [Exos 2X18 SATA Product Manual 203859600 Rev A](https://www.seagate.com/content/dam/seagate/migrated-assets/www-content/manuals/exos-x-2x18/pdf/203859600a.pdf) · [Exos X16 SAS Product Manual 100845788 Rev G](https://www.seagate.com/www-content/product-content/enterprise-hdd-fam/exos-x-16/en-us/docs/100845788g.pdf) — Seagate. 인터페이스, NCQ, 듀얼 액추에이터, SAS 큐 깊이
- [Seagate Exos 2X18](https://www.storagereview.com/news/seagate-exos-2x18) — StorageReview, 2022-11-14. SAS 모델 수치, 요약만 확인
- [Native Command Queuing](https://sata-io.org/native-command-queuing) — SATA-IO. NCQ의 재배치 설명
- [NVMe Zoned Namespaces (ZNS) Devices](https://zonedstorage.io/docs/introduction/zns) — zonedstorage.io. SMR HDD 모델과 ZNS
