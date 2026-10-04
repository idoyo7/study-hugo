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

일반 HDD도 호스트와 NVMe(저장장치용 호스트 인터페이스 규격)로 통신하도록 연결할 수 있습니다. 여러 자료를 이어 보면, 이미 가진 SATA·SAS HDD를 NVMe-oF(네트워크로 NVMe 명령을 주고받는 방식) 타깃 뒤에 두는 구성이 가능합니다. 드라이브가 NVMe를 직접 지원하는 길도 규격과 시연까지 나왔지만, 구매할 수 있는 제품은 찾지 못했습니다.

오버헤드가 줄어도 HDD에서 체감할 만큼 큰지는 별개입니다. 데이터시트로 추정한 랜덤 읽기 한 건은 12ms 안팎이고, 프로토콜 비용은 마이크로초 단위입니다. 확인한 자료를 종합하면, 네이티브 NVMe HDD가 실제로 얼마나 줄이는지 직접 잰 자료는 없습니다. Seagate가 설명한 주된 목적도 성능보다 스택 단순화에 있습니다.

근거 표기 — `✓` 원문 직접 확인 · `Ⓥ` 벤더·저자 주장 · `Ⓑ` 벤치마크·데이터시트 수치 · `≈` 눈대중·역산 · `Σ` 여러 사실을 이은 종합 추론 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 본편은 [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})입니다.

## 1. HDD를 NVMe로 붙이는 두 길

{{< flow src="_flow/1-두-경로.json" />}}

이미 가진 HDD를 쓰려면 그림 아래쪽 경로를 보면 됩니다. SATA·SAS HDD를 서버에 연결하고, 서버가 타깃(저장장치를 내주는 쪽)으로서 nvmet이나 SPDK nvmf로 NVMe-oF namespace(호스트에 제공하는 논리 저장 공간)를 내보냅니다. 여러 자료를 이어 보면, 이 경로는 지금도 소프트웨어로 구성할 수 있습니다.

NVMe가 어디까지 이어질까요? 아래쪽 경로에서는 호스트 스택과 네트워크 구간까지입니다. 타깃 안에서 HDD로 내려가는 길에는 sd와 libata 또는 SAS HBA 드라이버가 남습니다. Linux libata 문서에 따르면 libata는 T10 SAT에 따른 SCSI↔ATA 변환을 맡습니다. 이 자료들을 이어 보면 iSCSI(LIO)로 내보낼 때도 타깃 아래쪽 경로는 같습니다. 전체 순서를 한 문서에서 확인한 결과는 아닙니다.

그림 위쪽은 드라이브 자체가 NVMe 명령을 받는 경로입니다. Seagate의 설명으로는 드라이브 안에 컨트롤러가 있어 SAS·SATA 브리지가 필요 없습니다. 이 설명은 시연 장비를 기준으로 합니다.

- 바뀐 것: 위쪽은 드라이브 인터페이스까지, 아래쪽은 호스트와 네트워크 구간.
- 남은 비용: 아래쪽 타깃의 SCSI·ATA 계층.
- 적용할 수 없는 비교: 시연 장비의 구성을 시판품의 특성으로 취급하지 않기.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 네이티브 NVMe HDD는 드라이브가 NVMe를 직접 처리 | 드라이브 안에 컨트롤러가 있어 SAS·SATA 브리지가 필요 없다는 설명. 시연 장비 기준이며 구매할 수 있는 제품의 값이 아님 | Seagate 글(StorageNewsletter 재수록), StorageNewsletter | `Ⓥ` |
| 기존 SATA·SAS HDD를 NVMe-oF로 제공 가능 | HDD를 서버에 연결하고 nvmet이나 SPDK nvmf로 NVMe-oF namespace를 내보내는 구성. 현재 소프트웨어로 가능한 경로라는 종합 판단 | — | `Σ` |
| 타깃 뒤에 HDD를 두면 바뀌는 구간은 호스트 스택과 네트워크 | 타깃 안의 sd와 libata 또는 SAS HBA 드라이버는 남음 | — | — |
| libata가 SCSI↔ATA 변환을 담당 | T10 SAT에 따른 변환 | Linux libata 문서 | `✓` |
| 전체 경로는 여러 자료를 연결한 설명 | 동작 순서 전체를 한 문서에서 확인하지는 못함 | — | `Σ` |
| iSCSI로 제공해도 타깃 아래쪽 경로는 같음 | iSCSI(LIO)와 NVMe-oF 타깃 뒤의 SATA·SAS HDD 경로 비교 | — | `Σ` |

{{% /details %}}

## 2. 규격과 실물은 어디까지 왔는가

| 시점 | 내용 | 근거 |
|---|---|---|
| 2021-06~07 | NVMe 2.0에 회전 매체 지원(TP 4088) 추가. 식별 비트(NSFEAT 비트 4, EGFEAT), 로그 페이지 16h, Spinup Control feature(1Ah), 전원 상태 규칙 | |
| 2021-11 | Seagate가 OCP Global Summit에서 네이티브 NVMe HDD 시연. 12×3.5인치 PoC JBOD, PCIe 3 스위치 | |
| 2024-11 | Linux 6.13에 호스트 쪽 rotational 인식 커밋 머지 | |
| 2025-03 | GTC에서 NVMe HDD 8개 + NVMe SSD 4개 + BlueField-3 PoC 재시연 | |
| 2025-12 | 현행 Exos SATA 매뉴얼의 인터페이스는 SATA. 문서에 NVMe라는 단어가 없음 | |

규격과 Linux 호스트 코드는 회전 매체를 지원합니다. 제품은 공개 자료에서 시연까지 확인했으며, 구매할 수 있는 네이티브 NVMe HDD는 찾지 못했습니다.

NVM Express의 변경 목록에 따르면 회전 매체 지원은 NVMe 2.0부터 들어갔습니다. 규격이 추가한 항목은 회전 매체를 식별하는 비트, 로그 페이지, 기능 설정, Endurance Group(내구성 관리 단위) 지원 의무, 전원 상태 규칙입니다. 규격 내용을 종합하면 읽기·쓰기에는 기존 NVM Command Set을 그대로 씁니다. 회전 매체 관련 규정은 Base Specification 본문에서 확인했지만, 변경 제안인 TP 4088 원문은 열지 못했습니다.

시연 뒤에 나온 일정은 어디까지 믿을 수 있을까요? 당시 기사에는 엔지니어링 샘플과 고객 데모 유닛 일정이 있었고, 2024년 고객 데모 유닛은 시판품이 아니라는 정정이 붙었습니다. 후속 기사도 출시일을 알기 어렵다고 적었습니다. Seagate 블로그는 요약만 확인했으며, 출하일이나 성능 수치가 없는 로드맵 수준입니다. 시험용 물량의 실제 출하와 WD·Toshiba의 개발 상태는 1차 자료로 확인하지 못했습니다.

Linux 소스에서는 6.13부터 NVMe namespace의 회전 비트를 읽어 `queue/rotational`에 반영합니다. 직전 버전의 소스에는 그 코드가 없습니다. 이를 근거로 이전 커널은 NVMe namespace를 비회전 장치로 다뤘다고 추정할 수 있습니다.

- 바뀐 것: 규격과 Linux 호스트 코드의 회전 매체 지원.
- 남은 비용: 구매할 수 있는 드라이브를 찾지 못한 상태.
- 적용할 수 없는 비교: 시연 기사에 나온 일정과 실제 출시일.

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

HDD에서는 프로토콜 시간을 줄여도 요청 전체에서 차지하는 비중이 작을 것으로 추정합니다. 헤드를 옮기는 탐색과 원하는 위치가 돌아오기를 기다리는 시간이 길기 때문입니다. WD Ultrastar He12 데이터시트의 탐색 시간에 회전 대기를 더하면, 랜덤 읽기 한 건의 기구 시간은 12.16ms 수준입니다. 명령 처리와 데이터 전송 시간은 이 계산에서 빠져 있습니다. 최근 데이터시트에서는 탐색 시간의 새 값을 찾지 못했습니다.

프로토콜 비용은 어느 정도일까요? 본편 01이 인용한 iSCSI 실험에서는 원격 읽기가 로컬 읽기보다 마이크로초 단위의 지연을 더했습니다. 미디어 시간을 제외한 커널 NVMe/TCP 왕복 측정도 마이크로초 단위입니다. 이 값을 앞의 기구 시간과 비교하면 iSCSI의 추가 지연은 약 1.1%입니다.

이 비율은 서로 다른 장비와 시기의 자료를 이어 계산한 값입니다. HDD에서 전송 방식을 바꿔 직접 잰 개선율은 아닙니다. 추정하면, iSCSI를 NVMe/TCP로 바꿔 아낄 수 있는 양은 iSCSI의 추가 지연 안쪽이라 HDD 요청 한 건의 1% 안팎입니다. 두 측정은 실험 조건이 달라 서로 빼지 않았습니다.

[02]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}})가 인용한 Hajnoczi의 도식도 장치가 빨라질수록 같은 소프트웨어 오버헤드의 비중이 커진다고 설명합니다. 이를 HDD에 적용해 추정하면, 장치 시간이 길수록 그 비중은 작아집니다. 로컬 SCSI 스택과 NVMe 스택의 요청당 CPU 시간을 같은 장비에서 비교한 자료는 이 글에 없습니다.

- 바뀐 것: 줄일 수 있는 부분은 프로토콜·스택 처리 시간.
- 남은 비용: 인터페이스를 바꿔도 남는 탐색과 회전 대기.
- 적용할 수 없는 비교: 그림의 세 막대를 더하거나 성능 순위로 해석하기.

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
| SATA NCQ | 태그 32개 | |
| SAS | Exos X16 SAS 매뉴얼이 "128 - deep task set"과 "up to 64 queue tags"를 함께 적음. 어느 쪽이 실제 한도인지 확인하지 못함 | |
| NVMe | I/O 큐 최대 65,535개, 큐당 미처리 명령 최대 65,535개 | |

문서들을 종합하면, NVMe의 큐 한도가 크다고 단일 액추에이터 HDD가 여러 위치를 한꺼번에 읽지는 않습니다. Linux NVMe host의 기본 큐 구성과 HDD의 동작을 이어 보면, 호스트 큐는 CPU 쪽 제출 경합을 줄이고, 드라이브의 병렬 처리 능력은 액추에이터(헤드를 움직이는 기구) 수에 달려 있습니다. 단일 액추에이터 HDD는 한 번에 한 위치를 읽거나 씁니다.

HDD는 대기 중인 요청을 어떻게 활용할까요? SATA-IO는 NCQ(드라이브가 대기 명령의 처리 순서를 바꾸는 기능)가 명령을 효율적인 순서로 묶어 기구 작업량을 줄인다고 설명합니다. 그래서 큐가 깊어져도 병렬 처리가 늘어난다고 보기는 어렵습니다. 큐 수와 깊이를 바꾸며 단일 액추에이터 HDD의 IOPS(초당 입출력 처리 수)를 잰 공개 자료는 찾지 못했습니다.

액추에이터를 늘린 제품에서는 실제 병렬성이 늘어납니다. Seagate Exos 2X18 SATA 매뉴얼에 따르면 독립 액추에이터가 LBA(논리 블록 주소) 영역을 나누어 맡습니다. 함께 사용할 때의 지속 전송률은 520MiB/s이며, NCQ 깊이는 그대로입니다.

SAS 모델의 랜덤 읽기 수치는 리뷰 기사 요약에서만 확인했습니다. 그 값은 단일 액추에이터 Exos X18 데이터시트 값의 1.79배로 계산됩니다. 서로 다른 문서에서 가져왔고 한쪽은 2차 인용이므로 참고용 비교입니다.

- 바뀐 것: NVMe가 허용하는 큐 수와 깊이.
- 남은 비용: 액추에이터 수가 제한하는 병렬 처리량.
- 적용할 수 없는 비교: 큐 한도를 IOPS 이득으로 환산하거나, 170과 304 IOPS를 3절의 He12 기반 12.16ms와 섞기.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| SATA NCQ의 큐 한도 | 태그 32개 | torvalds/linux(libata.h), Seagate SATA 매뉴얼 | `✓` |
| SAS 모델의 큐 한도 표기가 서로 다름 | Exos X16 SAS 매뉴얼에 "128 - deep task set"과 "up to 64 queue tags"가 함께 있음. 어느 쪽이 실제 한도인지 확인하지 못함 | Exos X16 SAS Product Manual 100845788 Rev G | `✓` `?` |
| NVMe의 큐 한도 | I/O 큐 최대 65,535개, 큐당 미처리 명령 최대 65,535개 | NVM Express Base Specification 2.0a | `✓` |
| Linux NVMe host의 기본 큐 구성 | 기본으로 CPU 수만큼 I/O 큐를 생성 | torvalds/linux | — |
| 호스트 큐와 드라이브 병렬성은 구분해야 함 | 호스트 큐는 CPU 쪽 제출 경합을 줄이며, 드라이브가 한꺼번에 처리할 수 있는 양은 액추에이터 수가 정함. 단일 액추에이터 HDD는 한 번에 한 위치를 읽고 씀 | torvalds/linux, NVMe 회전 매체 규정과 HDD 동작을 종합 | `Σ` |
| NVMe 규격은 복수 액추에이터를 표현 | 회전 매체를 "one or more actuators"로 정의하고 액추에이터 수를 로그에 별도로 기록 | NVM Express Base Specification 2.0a | `✓` |
| NCQ는 처리 순서를 바꿔 기구 작업량을 줄임 | SATA-IO 예시 그림에서 명령 넷을 NCQ로 1과 1/4바퀴, NCQ 없이 2와 3/4바퀴에 처리 | SATA-IO, Native Command Queuing | `Ⓥ` |
| 큐 수와 깊이 증가가 단일 액추에이터의 병렬 처리로 이어지지는 않는다는 추론 | HDD의 큐 활용은 요청 재배치. 다중 큐와 액추에이터의 병렬 처리 능력은 별개 | SATA-IO 설명, Linux 큐 구성, HDD 동작을 종합 | `Σ` |
| 단일 액추에이터 HDD의 큐별 성능 변화는 미확인 | 큐 수와 깊이를 바꾸며 IOPS를 잰 공개 측정을 찾지 못함 | 이 글에서 확인한 자료 | `?` |
| Exos 2X18 SATA는 독립 액추에이터를 사용 | 독립 액추에이터 둘이 LBA의 앞 50%와 뒤 50%를 각각 담당 | Exos 2X18 SATA Product Manual 203859600 Rev A | `✓` |
| Exos 2X18 SATA의 전송률과 NCQ 깊이 | 두 액추에이터를 함께 쓸 때 지속 전송률 520MiB/s, 액추에이터당 260. NCQ 깊이는 32 | Exos 2X18 SATA Product Manual 203859600 Rev A | `✓` |
| Exos 2X18 SAS의 구성과 랜덤 읽기 성능 | 9TB LUN(논리 장치 단위) 둘로 표시. 4K QD16 랜덤 읽기 304 IOPS. 데이터시트를 받지 못해 리뷰 기사 요약만 확인 | StorageReview, Seagate Exos 2X18 | `Ⓑ` `?` |
| 단일 액추에이터 Exos X18의 랜덤 읽기 성능 | 같은 4K QD16 조건에서 170 IOPS | Exos X18 데이터시트 | `Ⓑ` |
| 인용한 랜덤 읽기 수치의 비율 | 304 IOPS는 170 IOPS의 1.79배. 서로 다른 문서이며 한쪽은 2차 인용이므로 참고용 | StorageReview의 Exos 2X18 요약, Exos X18 데이터시트 | `≈` |
| 큐 한도와 다른 절의 수치를 비교할 때의 범위 | 큐 한도를 IOPS 이득으로 해석하지 않음. 170과 304 IOPS를 3절의 He12 기반 12.16ms와 섞지 않음 | 이 절의 큐 규격·제품 자료, 3절의 기구 시간 추정 | — |

{{% /details %}}

## 5. 그래도 NVMe HDD를 만드는 이유

| 업체가 든 동기 | 출처 | 근거 |
|---|---|---|
| 스택 단순화가 목적이었고 성능은 주된 목적이 아니었다 | David Allen(Seagate), TechTarget 2021-11-12 | |
| SAS IOC·익스팬더·전용 드라이버를 없애고 CPU나 PCIe 스위치에 SSD처럼 연결 | 같은 기사 | |
| 전력 절감은 작은 폭이고 가격·전력은 비슷할 것 | 같은 기사 | |
| 단일 NVMe 드라이버와 OS 스택으로 HDD·SSD를 함께 다룸 | Seagate 블로그 2025-03 | |
| LUN 분리 없이 멀티 액추에이터 지원 | 같은 기사, Seagate 발표 글 | |

Seagate가 설명한 주된 이유는 스택 단순화입니다. Seagate 블로그(요약만 확인했습니다)는 HDD와 SSD를 같은 NVMe 드라이버와 OS 스택으로 다루고, SAS용 부품과 드라이버를 줄이려는 방향을 설명합니다. 업체가 제시한 이점은 부품 수, 드라이버, 관리 API, 연결 구성에 모여 있습니다.

이 변화가 요청 지연이나 IOPS도 개선할까요? 확인한 자료를 종합하면 SAS·SATA HDD보다 얼마나 나아지는지 보여 주는 수치는 없습니다. 같은 조건에서 네이티브 NVMe HDD와 비교한 공개 측정도 찾지 못했습니다. GTC 시연 결과 역시 기존 오버헤드를 없앴다는 업체의 정성 설명이며, 수치와 대조군은 제시하지 않았습니다.

NVMe-oF 경로에서도 Seagate는 SAS·SATA 드라이브가 먼저 변환 계층을 거쳐야 하므로 비효율적이라고 주장합니다. 그 변환에 걸리는 시간은 자료에 없습니다.

- 바뀐 것: HBA(호스트 버스 어댑터)·브리지·SAS 전용 드라이버가 불필요해진다는 업체 설명.
- 남은 비용: 요청 시간 대부분을 차지하는 기구 동작.
- 적용할 수 없는 비교: 부품 수·전력 이점을 지연 개선량으로 환산하기.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 주된 개발 목적은 스택 단순화 | David Allen의 발언: "Performance was not the main goal or the reason that drove this. It was about simplifying the stack." | David Allen(Seagate), TechTarget 2021-11-12 | `Ⓥ` |
| SAS용 부품과 드라이버를 없앨 수 있다는 설명 | SAS IOC·익스팬더·전용 드라이버를 없애고 CPU나 PCIe 스위치에 SSD처럼 연결 | TechTarget 2021-11-12(IOC·익스팬더·드라이버) | `Ⓥ` |
| HBA·브리지가 필요 없어진다는 주장 | HBA·브리지가 필요 없어진다는 설명. 블로그는 요약만 확인 | Seagate 블로그 2025-03(HBA·브리지, 요약만 확인) | `Ⓥ` `?` |
| 전력과 가격의 예상 | 전력 절감은 작은 폭이며 가격·전력은 비슷할 것이라는 발언 | TechTarget 2021-11-12 | `Ⓥ` |
| HDD와 SSD에 같은 소프트웨어 스택 사용 | 단일 NVMe 드라이버와 OS 스택으로 HDD·SSD를 함께 다룬다는 설명. 블로그는 요약만 확인 | Seagate 블로그 2025-03 | `Ⓥ` `?` |
| 멀티 액추에이터 지원 방식 | LUN 분리 없이 지원한다는 설명 | TechTarget 기사, Seagate 발표 글 | `Ⓥ` |
| 업체가 든 동기의 범위와 성능 수치 부재 | 동기는 부품 수, 드라이버, 관리 API, 토폴로지에 해당. 확인한 어느 자료에도 요청당 지연이나 IOPS가 SAS·SATA HDD보다 좋아진다는 수치가 없음 | TechTarget, Seagate 블로그·발표, 시연 기사 종합 | `Σ` |
| 네이티브 NVMe HDD의 직접 성능 비교는 미확인 | NVMe HDD와 SAS·SATA HDD를 같은 조건에서 잰 공개 측정을 찾지 못함 | 이 글에서 확인한 자료 | `?` |
| 네이티브 NVMe HDD의 절감량은 직접 측정 자료가 없음 | 네이티브 NVMe HDD가 줄이는 양을 직접 잰 자료 없음 | 이 글에서 확인한 자료 | `Σ` `≈` |
| GTC PoC 결과는 정성 설명 | 2025년 GTC PoC에서 "legacy SAS/SATA overhead was eliminated"라고 서술. 수치와 대조군 없음 | Blocks & Files 2025-03-25 | `Ⓥ` |
| NVMe-oF에서 SAS·SATA 변환 계층이 비효율적이라는 주장 | Seagate는 SAS·SATA 드라이브가 먼저 변환 계층을 거쳐야 한다고 설명 | El-Batal(Seagate), TechTarget 2021-11-12 | `Ⓥ` |
| 변환 계층의 시간 비용은 미확인 | 변환에 걸리는 시간을 제시한 자료 없음 | 이 글에서 확인한 자료 | `?` |
| 이점 해석의 범위 | 요청당 시간의 대부분인 기구 시간은 남음. 부품 수·전력 이점을 지연 이점으로 옮겨 해석하지 않음 | 이 글의 기구 시간 추정, Seagate 설명 | — |

{{% /details %}}

## 6. 타깃 뒤에 HDD를 둘 때 알아 둘 것

| 항목 | 내용 | 근거 |
|---|---|---|
| 타깃 안의 변환 | sd와 libata(또는 SAS HBA)가 남는다. 줄어드는 것은 호스트와 네트워크 구간의 마이크로초다 | |
| nvmet의 rotational 전달 | 6.13부터 뒤의 블록 장치가 회전식이면 NSFEAT의 rotational 비트를 세운다 | |
| nvmet의 로그 페이지 | 대부분 빈 값이다. 채우는 것은 endurance group 번호와 액추에이터 수(없으면 1)뿐이고 RPM·spinup 횟수는 0 | |
| SPDK nvmf | master 기준으로 이 비트를 세우지 않는다. `lib/nvmf/ctrlr.c`에 rotational이라는 문자열이 없다 | |
| 호스트의 인식 조건 | 타깃과 호스트가 모두 6.13 이상이어야 `rotational=1`로 보인다. 한쪽이 6.12 이하면 SSD처럼 다룬다 | |

타깃 뒤에 HDD를 연결할 때는 호스트가 그 장치를 회전 매체로 인식하는지도 봐야 합니다. Linux 소스에 따르면 nvmet은 뒤의 블록 장치가 회전식이면 그 정보를 NVMe namespace에 표시합니다. 타깃과 호스트 코드를 이어 보면, 양쪽 모두 6.13 이상일 때 호스트까지 회전 정보가 전달됩니다. 타깃 안의 SCSI·ATA 경로는 이 정보 전달과 별개로 남습니다.

nvmet이 채워 주는 회전 매체 정보는 일부뿐입니다. 로그에는 endurance group 번호와 액추에이터 수만 들어가고 RPM과 spinup 횟수는 비어 있습니다. SPDK nvmf의 master 소스에서는 회전 비트를 설정하지 않으므로, 뒤에 연결한 HDD가 호스트에서 비회전 장치로 보일 수 있습니다.

이 정보가 틀리면 실제로 무엇이 달라질까요? 스케줄러, readahead(미리 읽기), 파일시스템·Ceph의 장치 분류에 미치는 영향을 잰 자료는 찾지 못했습니다. Linux의 I/O 스케줄러 기본값은 회전 여부보다 하드웨어 큐 수에 따라 정해집니다. 큐가 하나면 mq-deadline, 여럿이면 none을 사용합니다. 배포판의 udev 규칙이 회전 여부를 보고 이 선택을 바꾸는지는 확인하지 못했습니다.

- 바뀐 것: nvmet에서 호스트까지 회전 정보 전달 가능.
- 남은 비용: SPDK nvmf 뒤의 HDD를 비회전으로 인식할 가능성.
- 적용할 수 없는 비교: 검색에서 찾은 EBOF는 SSD용이며, HDD용 NVMe-oF JBOD·EBOF 시판품은 미확인.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| NVMe-oF 타깃 안의 HDD 경로는 남음 | sd와 libata 또는 SAS HBA가 남으며, 줄어드는 부분은 호스트와 네트워크 구간의 마이크로초 단위 시간 | — | `Σ` |
| nvmet이 뒤의 장치의 회전 여부를 전달 | Linux 6.13부터 뒤의 블록 장치가 회전식이면 NSFEAT의 rotational 비트를 설정 | torvalds/linux, nvme/target/admin-cmd.c·nvmet.h | `✓` |
| nvmet의 회전 매체 로그는 대부분 빈 값 | endurance group 번호와 액추에이터 수만 채움. 액추에이터 수가 없으면 1, RPM·spinup 횟수는 0 | torvalds/linux, nvme/target/admin-cmd.c·nvmet.h | `✓` |
| SPDK nvmf는 회전 비트를 설정하지 않음 | master 기준. `lib/nvmf/ctrlr.c`에 rotational이라는 문자열이 없음 | spdk/spdk | `✓` |
| 호스트까지 회전 정보가 전달되는 조건 | 타깃과 호스트가 모두 6.13 이상이어야 `rotational=1`로 표시. 한쪽이 6.12 이하면 SSD처럼 비회전으로 취급 | torvalds/linux, v6.12·v6.13의 host·target 코드 종합 | `Σ` |
| 회전 여부 오인식의 실제 영향은 미확인 | 스케줄러, readahead, 파일시스템·Ceph의 장치 분류에 미치는 영향을 잰 자료를 찾지 못함 | 이 글에서 확인한 자료 | `?` |
| Linux I/O 스케줄러 기본값의 기준 | 회전 여부가 아닌 하드웨어 큐 수로 결정. 큐가 하나면 mq-deadline, 여럿이면 none | torvalds/linux, block/elevator.c | `✓` |
| 배포판의 추가 스케줄러 선택 규칙은 미확인 | udev 규칙이 rotational을 보고 스케줄러를 바꾸는지 확인하지 못함 | 배포판 udev 규칙 | `?` |
| SPDK nvmf 뒤의 HDD가 비회전으로 보일 가능성 | master의 회전 비트 미설정에 따른 호스트 인식 가능성 | spdk/spdk, 호스트 인식 조건 | — |
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
