---
title: "부록 · NFS를 같이 놓고 보면 — 파일 프로토콜은 iSCSI·NVMe-oF와 어디서 다른가"
linkTitle: "부록 B NFS"
description: "NFS를 iSCSI·NVMe-oF와 한 표에 놓을 수 있는 전송 구조와 놓을 수 없는 쓰기 의미·캐시, 2004년 NFS 대 iSCSI 실측과 최근 자료의 한계, VM 디스크·볼륨으로 쓸 때와 NFS가 맞는 경우를 근거 등급과 함께 정리한다."
weight: 91
date: 2026-10-05
lastmod: 2026-10-05
url: "/storage/a2-nfs/"
---

# 부록 · NFS를 같이 놓고 보면 — 파일 프로토콜은 iSCSI·NVMe-oF와 어디서 다른가

NFS 위의 파일에 `fio direct=1`을 실행한 결과를 원격 블록 장치의 결과와 그대로 비교할 수는 없습니다. NFS는 서버에 있는 파일시스템에 접근하고, 클라이언트 캐시를 우회해도 서버 캐시는 남을 수 있습니다. 쓰기가 언제 저장된 것으로 인정되는지도 서버 설정에 따라 달라집니다.

NFS·iSCSI·NVMe-oF는 연결 수와 전송 구조를 비교할 수 있지만, 성능을 비교하려면 파일시스템 위치와 쓰기 완료 조건을 맞춰야 합니다. 세 프로토콜을 한 장비에서 함께 잰 최근 공개 측정은 찾지 못했습니다. 이 글의 자료로 판단할 수 있는 범위는 파일 공유 방식, VM에 제공할 기능, DB가 요구하는 저장 조건까지입니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크·논문 실측 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `Σ` 여러 사실을 이은 종합 추론 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 본편은 [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})이고, VM 전달 방식은 [02]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}}), 복제와 live migration은 [03]({{< relref "/data/block-storage/03-local-disk-ha/index.md" >}})에 있습니다.

## 1. 무엇을 내보내는가

{{< flow src="_flow/1-파일시스템-위치.json" />}}

NFS는 서버의 파일에 접근하고 iSCSI·NVMe-oF는 원격 디스크 블록에 접근합니다. Radkov 외 FAST'04 논문은 이 차이를 파일시스템의 위치로 설명합니다. NFS 서버는 파일시스템 연산을 처리합니다. 블록 프로토콜에서는 클라이언트가 파일시스템 연산을 처리한 뒤 블록 연산을 서버로 보냅니다.

VM에서 디스크처럼 사용하는 경우에도 NFS가 내보내는 대상은 파일입니다. Cinder NFS 드라이버는 공유에 파일을 만든 뒤 인스턴스에 매핑해 블록 장치를 흉내 냅니다. 게스트에 보이는 장치 형태만으로 호스트와 서버 사이의 접근 단위를 판단할 수 없는 이유입니다.

RFC 1813에서 NFS v3의 읽기·쓰기 요청은 파일 핸들, 바이트 오프셋, 길이로 위치를 지정합니다. 파일 핸들은 서버가 파일을 구분하려고 내주는 불투명한 식별자입니다. 요청은 RPC(원격 프로시저 호출)로 보내고 호출 인자는 XDR(기종과 무관한 데이터 표현 규칙)로 담습니다. NFS v4.1도 계층적인 파일시스템과 바이트 스트림으로 된 일반 파일 모델을 유지합니다.

Linux 서버의 nfsd는 VFS(파일시스템에 공통 인터페이스를 제공하는 커널 계층)를 거쳐 로컬 파일시스템에 접근합니다. 클라이언트는 쓰기 요청을 SunRPC로 보내고 NFS_UNSTABLE 응답을 받으면 나중에 COMMIT을 보냅니다. 이 경로를 블록 프로토콜과 비교하면 NFS의 병렬성은 RPC 슬롯과 TCP 연결 수를 통해 살펴야 한다고 해석할 수 있습니다. blk-mq 큐가 전송 큐로 이어지는 블록 경로와 달라 큐 깊이·하드웨어 큐 수를 그대로 대응시키기는 어렵습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 네트워크 파일시스템과 SAN 프로토콜은 접근 단위가 다름 | 네트워크 파일시스템은 파일 단위, SAN 프로토콜은 디스크 블록 단위로 원격 데이터에 접근 | Radkov 외, FAST'04 서론 | `Ⓑ` |
| 파일시스템 위치에 따라 네트워크 연산이 달라짐 | NFS는 서버에 파일시스템을 두고 파일·메타데이터 읽기·쓰기를 전송. 블록 프로토콜은 클라이언트에 파일시스템을 두고 블록 연산을 전송 | Radkov 외, FAST'04 | `Ⓑ` |
| Cinder NFS 드라이버는 파일로 블록 장치를 흉내 냄 | 인스턴스에 블록 수준 접근을 직접 제공하지 않음. NFS 공유에 파일을 만들어 인스턴스에 매핑 | Cinder 문서 | `✓` |
| NFS v3는 RPC 위의 프로토콜 | XDR 위에 세운 RPC primitive로 기종 독립성을 얻음 | RFC 1813 | `✓` |
| NFS가 가리키는 대상은 파일 핸들 | 서버가 파일을 구분하려고 제공하며, 클라이언트에는 내용이 불투명한 식별자 | RFC 1813 | `✓` |
| 읽기·쓰기 위치는 파일 안의 바이트 단위로 지정 | 인자는 파일 핸들, 바이트 오프셋, 길이 | RFC 1813 | `✓` |
| NFS v4.1도 같은 파일 모델을 사용 | 서버 파일시스템은 계층 구조이며 일반 파일은 불투명한 바이트 스트림 | — | `✓` |
| Linux 서버의 NFS 처리 경로 | nfsd → VFS → 서버 로컬 파일시스템에서 읽기·쓰기 | 현재 Linux 커널 소스 | `✓` |
| Linux 클라이언트의 쓰기 처리 경로 | 요청을 SunRPC에 전달. 응답이 NFS_UNSTABLE이면 뒤에 COMMIT 전송 | 현재 Linux 커널 소스 | `✓` |
| NFS 요청의 서버 처리 경로가 더 길다는 실측 해석 | 2004년 Linux 2.4 기준, NFS 요청의 서버 처리 경로가 iSCSI 요청의 두 배라는 저자 해석 | Radkov 외, FAST'04 | `Ⓑ` |

{{% /details %}}

## 2. 한 표에 놓을 수 있는 것

| 항목 | iSCSI | NVMe-oF | NFS |
|---|---|---|---|
| 내보내는 단위 | LUN(블록 장치), SCSI CDB | namespace(블록 장치), NVMe 명령 capsule | 파일·디렉터리(파일 핸들 + 바이트 오프셋) |
| 파일시스템 위치 | 클라이언트(host) | 클라이언트(host) | 서버 |
| 표준 | RFC 7143(2014) | NVMe-oF 1.0(2016), TCP 바인딩(2018) | RFC 1813 v3(1995), RFC 8881 v4.1(2020), RFC 7862 v4.2(2016) |
| 요청 하나의 틀 | PDU(BHS 48B) | capsule(SQE 64B / CQE 16B) | RPC 호출(XDR), v4는 COMPOUND |
| Linux 기본 연결 수 | 세션당 TCP 1개 | I/O 큐당 1개, 큐 수 = 온라인 CPU 수 | 서버당 TCP 1개, nconnect로 최대 16 |
| 병렬성의 단위 | 세션(하드웨어 큐 1) | CPU별 큐 | RPC 슬롯(전송당 2에서 최대 65,536), 연결 선택은 대기 길이 기준 |
| 서버(타깃) 쪽 처리 | LIO → backstore | nvmet → 블록 장치 | nfsd 스레드(기본 8) → VFS → 로컬 파일시스템 → 블록 |
| RDMA 변형 | iSER(RFC 7145) | NVMe/RDMA | RPC-over-RDMA(RFC 8166·8267) |
| RDMA 데이터 이동 | RDMA Read/Write로 SCSI 버퍼에 직접 | controller가 RDMA_READ/WRITE 시작 | 서버가 chunk를 pull/push, READ·WRITE 페이로드만 대상 |

### 연결을 늘리는 방식

Linux 기본 연결 수만 보면 NFS와 iSCSI는 가까운 편입니다. NFS는 기본으로 서버당 TCP 연결 하나를 사용하고, RPC 클라이언트 생성 코드는 `nconnect`가 1 이하이면 추가 전송을 붙이지 않습니다. 마운트에서 서버로 여는 연결 수를 늘리는 `nconnect`는 Linux 5.3에 도입됐고 최대 16을 지원합니다.

연결을 늘리면 RPC 슬롯에 있는 요청이 여러 연결로 나뉘어 나갑니다. 슬롯은 응답을 기다리는 요청을 관리하며, TCP 전송 하나에서 2로 시작해 최대 65,536까지 늘어납니다. 코드에서 연결 선택은 전송의 대기 길이를 기준으로 했고, CPU나 파일에 연결을 고정하는 부분은 찾지 못했습니다. NVMe/TCP가 블록 계층의 CPU별 큐를 전송까지 잇는 구조와는 다르다고 해석할 수 있습니다.

`max_connect`는 같은 NFS v4.1 이상 서버의 다른 IP로 가는 연결 수를 정합니다. 상한은 16이며 도입 커널 버전은 확인하지 못했습니다.

단일 연결에 부하가 모이는 현상은 블록 쪽 측정에서도 관찰됐습니다. NVMe/TCP 연결 하나에서 fio job을 5개에서 6개로 늘렸을 때 처리량은 3.1% 증가했습니다. Filestore가 단일 클라이언트의 고부하에서 nconnect 효과가 크다고 설명한 것과 같은 방향으로 읽을 수 있습니다. 이 결과만으로 NFS의 개선 폭까지 계산할 수는 없습니다.

### RDMA의 요청과 데이터 경로

RDMA(원격 메모리에 직접 데이터를 전송하는 방식)에서도 작은 요청과 큰 데이터의 경로는 구분됩니다. RFC 8166과 RFC 8267의 RPC-over-RDMA는 작은 메시지를 Send로 보내고 큰 데이터는 chunk로 분리합니다. Read chunk는 서버가 가져가고 Write chunk는 서버가 밀어 넣습니다. 이를 NFS 연산에 대응시키면 WRITE 데이터는 서버의 RDMA Read로, READ 데이터는 서버의 RDMA Write로 이동한다고 읽을 수 있습니다. 연산을 서버가 시작한다는 점은 NVMe/RDMA의 controller와 비슷합니다.

RFC 8267은 NFS v2·v3에서 직접 배치할 수 있는 대상을 READ·WRITE 데이터와 SYMLINK·READLINK 경로명으로 정합니다. 나머지 메타데이터 연산은 Send/Receive로 보냅니다. nconnect와 RDMA를 함께 사용할 수 있는 버전별 조합은 1차 문서로 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 표준과 연도 | iSCSI: RFC 7143(2014). NVMe-oF: 1.0(2016), TCP 바인딩(2018). NFS: RFC 1813 v3(1995), RFC 8881 v4.1(2020), RFC 7862 v4.2(2016) | RFC 7143, NVMe-oF 1.0·TCP 바인딩, RFC 1813·8881·7862 | `✓` |
| 요청 하나의 형식 | iSCSI: PDU(BHS 48B). NVMe-oF: capsule(SQE 64B / CQE 16B). NFS: RPC 호출(XDR), v4는 COMPOUND | — | `✓` |
| Linux 기본 연결 수 | iSCSI는 세션당 TCP 1개. NVMe-oF는 I/O 큐당 1개이며 큐 수는 온라인 CPU 수. NFS는 서버당 TCP 1개, nconnect로 최대 16 | — | `✓` |
| 병렬성의 단위 | iSCSI는 세션(하드웨어 큐 1), NVMe-oF는 CPU별 큐, NFS는 RPC 슬롯(전송당 2에서 최대 65,536). NFS 연결 선택은 대기 길이 기준 | — | `✓` `≈` |
| 서버 처리 경로 | iSCSI: LIO → backstore. NVMe-oF: nvmet → 블록 장치. NFS: nfsd 스레드(기본 8) → VFS → 로컬 파일시스템 → 블록 | — | `✓` |
| RDMA 변형 | iSCSI는 iSER(RFC 7145), NVMe-oF는 NVMe/RDMA, NFS는 RPC-over-RDMA(RFC 8166·8267) | RFC 7145, RFC 8166·8267 | `✓` |
| RDMA 데이터 이동 비교 | iSCSI는 RDMA Read/Write로 SCSI 버퍼에 직접 이동. NVMe-oF는 controller가 RDMA_READ/WRITE 시작. NFS는 서버가 chunk를 pull/push하며, 표에서는 READ·WRITE 페이로드를 대상으로 비교 | — | `✓` `≈` |
| Linux NFS 클라이언트의 기본 연결 생성 | RPC 클라이언트 생성 코드는 `nconnect`가 1 이하이면 추가 전송을 붙이지 않음 | Linux RPC 클라이언트 생성 코드 | `✓` |
| `nconnect`의 의미·상한·도입 버전 | 마운트 하나에서 서버로 여는 TCP 연결 수를 정하는 옵션. 최대 16, Linux 5.3에서 도입 | — | `✓` |
| 연결 사이 요청 분배 | 전송의 대기 길이 기준. CPU나 파일에 연결을 고정하는 부분은 코드에서 보지 못함 | Linux 코드 | `≈` |
| `max_connect`의 의미와 상한 | 같은 v4.1 이상 서버의 다른 IP로 가는 연결 수. 상한 16 | — | `✓` |
| `max_connect` 도입 시점 | 도입 커널 버전을 확인하지 못함 | — | `?` |
| 응답 대기 요청 수는 RPC 슬롯 테이블이 관리 | TCP 전송 하나의 슬롯은 2에서 시작해 최대 65,536 | — | `✓` |
| RPC 슬롯 수의 해석 | 응답을 기다릴 수 있는 RPC 수가 동적으로 증가한다는 뜻으로 읽음 | — | `≈` |
| 서버 병렬성과 요청 크기 | nfsd 스레드 수 기본 8. Linux 클라이언트는 읽기 페이로드 1MiB까지 지원 | — | `✓` |
| 단일 NVMe/TCP 연결의 처리량 증가 한계 | 연결 하나에서 fio job을 5개에서 6개로 늘렸을 때 처리량 3.1% 증가 | Kang & Liu, ntprof, NSDI'25 §4.3 | `Ⓑ` |
| RPC-over-RDMA 표준 | RPC-over-RDMA v1은 RFC 8166, NFS 바인딩은 RFC 8267 | RFC 8166·8267 | `✓` |
| 작은 메시지와 큰 데이터의 전송 경로 | 작은 메시지는 RDMA Send로 통째로 전송. 큰 데이터는 chunk로 분리. Read chunk는 서버가 pull, Write chunk는 서버가 push | RFC 8166·8267 | `✓` |
| NFS 연산과 RDMA 연산의 대응 | WRITE 데이터는 서버가 RDMA Read로 가져감. READ 데이터는 서버가 RDMA Write로 클라이언트 메모리에 배치 | — | `≈` |
| 직접 배치 대상의 범위 | NFS v2·v3의 READ·WRITE 데이터와 SYMLINK·READLINK 경로명만 대상. 나머지 메타데이터 연산은 Send/Receive 사용 | RFC 8267 | `✓` |
| RPC-over-RDMA 흐름 제어 단위 | credit | — | `✓` |
| nconnect와 RDMA의 조합 | 함께 쓸 수 있는 버전별 조합을 1차 문서로 확인하지 못함 | — | `?` |

{{% /details %}}

## 3. 한 표에 놓으면 안 되는 것

같은 전송 속도와 연결 수라도 쓰기 완료 조건, 캐시, 잠금, 장애 처리가 다르면 애플리케이션에서 관찰하는 결과가 달라집니다.

| 항목 | iSCSI | NVMe-oF | NFS |
|---|---|---|---|
| 쓰기 확정 | SCSI SYNCHRONIZE CACHE·FUA(원문 미확인) | NVMe Flush·FUA(원문 미확인) | WRITE의 stable_how + COMMIT, export sync/async가 뜻을 바꿈 |
| O_DIRECT의 범위 | host 캐시 우회, 타깃이 블록 backstore면 캐시 층 없음 | 같음 | 클라이언트 캐시만 우회, 서버는 캐시할 수 있음 |
| 잠금·공유 | 프로토콜에 파일 잠금 없음(블록 장치 공유는 클러스터 FS 필요) | 같음 | v3는 NLM 곁가지, v4는 프로토콜 내장(lease) |
| 서버 장애 시 기본 동작 | 멀티패스 전환 또는 I/O 오류(타임아웃 값 미확인) | ANA 멀티패스 | hard 마운트: 무한 재시도 |

### WRITE 응답과 안정 저장

{{< seq src="_seq/3-쓰기는-write와-commit으로-나뉜다.json" />}}

블록 프로토콜의 쓰기 확정은 타깃의 휘발성 캐시 설정과 맞물립니다. NFS에는 WRITE가 요청한 안정성 수준과 서버 export(클라이언트에 공개하는 공유) 설정도 관여합니다. RFC 1813에서 FILE_SYNC는 데이터와 메타데이터를 안정 저장소에 쓴 뒤 응답하지만, UNSTABLE은 그 전에 응답할 수 있습니다. 클라이언트는 뒤이어 COMMIT으로 앞선 쓰기를 안정 저장소에 반영하도록 요청하고 재전송 필요 여부를 확인합니다. 서버 재시작으로 verf(재시작할 때마다 바뀌는 확인용 값)가 달라지면 미확정 데이터를 다시 보내는 것으로 읽힙니다.

서버 export의 `sync`·`async`는 클라이언트 마운트의 sync·async와 별개입니다. exports(5)는 서버 async가 변경을 안정 저장소에 쓰기 전에 응답하도록 허용하며, 비정상 재시작 때 데이터가 유실되거나 손상될 수 있다고 설명합니다. 커널 소스에서도 async export는 FILE_SYNC 요청을 UNSTABLE로 바꿉니다. 기본 조합인 클라이언트 async와 서버 sync에서는 fsync가 서버 안정 저장까지 이어진다고 해석할 수 있습니다. 서버 export를 async로 바꾸면 fsync·O_SYNC·O_DIRECT도 서버 메모리에서 끝날 수 있습니다.

### 캐시를 우회하는 범위

man page가 설명하는 기본 캐시 일관성 규칙은 close-to-open입니다. 파일을 열 때 서버에 확인하고 닫을 때 쓰기를 보냅니다. 클라이언트 사이의 완전한 캐시 일관성을 제공하지는 않습니다. `noac`도 데이터 캐시를 끄는 옵션은 아닙니다. 이 옵션은 쓰기를 동기로 만들고, man page는 그에 따른 성능 손실이 크다고 설명합니다.

open(2)는 NFS가 O_DIRECT 플래그를 서버에 전달하지 못한다고 명시합니다. 클라이언트 페이지 캐시만 우회하므로 서버는 I/O를 캐시할 수 있습니다. 클라이언트는 동기 처리를 요청하지만 서버가 안정 저장에 도달했다고 거짓으로 알리도록 설정할 수도 있습니다. 이 설정은 export의 async를 뜻한다고 읽었습니다. 따라서 fio의 `direct=1`로 제외되는 캐시 범위가 블록 장치와 NFS에서 같지 않습니다.

### 장애와 잠금

nfs(5)의 기본값인 `hard`는 요청을 무한 재시도합니다. PostgreSQL 문서는 hard 마운트를 NFS 사용의 필수 요건으로 들며, 네트워크 문제로 프로세스가 멈출 수 있다고 설명합니다. 블록 쪽은 멀티패스로 경로를 바꾸거나 타임아웃 뒤 I/O 오류를 올리는 흐름으로 해석할 수 있지만, 타임아웃 기본값은 확인하지 못했습니다.

NFS v3의 잠금은 NLM·NSM이라는 별도 프로토콜이 처리합니다. v4에서는 주 프로토콜에 포함되고 클라이언트 전체의 lease(서버가 부여한 유효 기간)에 묶입니다. lease를 갱신하지 못하면 잠금이 회수될 수 있습니다. `local_lock`의 배타성은 같은 클라이언트 안의 애플리케이션에만 적용됩니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 쓰기 확정 방식 비교 | iSCSI는 SCSI SYNCHRONIZE CACHE·FUA, NVMe-oF는 NVMe Flush·FUA이나 스펙 원문 미확인. NFS는 WRITE의 stable_how + COMMIT이며 export sync/async에 따라 의미가 달라짐 | — | `✓` `?` |
| O_DIRECT의 캐시 우회 범위 비교 | iSCSI·NVMe-oF는 host 캐시 우회, 타깃이 블록 backstore이면 캐시 층 없음. NFS는 클라이언트 캐시만 우회하며 서버는 캐시 가능 | — | `✓` `Σ` |
| 파일 잠금과 공유 방식 비교 | iSCSI·NVMe-oF에는 파일 잠금이 없고 블록 장치 공유에는 클러스터 FS 필요. NFS v3는 NLM, v4는 프로토콜 내장 lease | — | `✓` `Σ` |
| 서버 장애 시 기본 동작 비교 | iSCSI는 멀티패스 전환 또는 I/O 오류이며 타임아웃 값 미확인. NVMe-oF는 ANA 멀티패스. NFS hard 마운트는 무한 재시도 | — | `✓` `Σ` `?` |
| NFS WRITE의 안정성 수준 | UNSTABLE·DATA_SYNC·FILE_SYNC 셋 | RFC 1813 | `✓` |
| FILE_SYNC와 UNSTABLE의 응답 조건 | FILE_SYNC는 데이터와 메타데이터를 안정 저장소에 쓴 뒤 응답. UNSTABLE은 일부·전부를 쓰거나 아무것도 쓰지 않고 응답할 수 있음 | RFC 1813 | `✓` |
| COMMIT의 역할 | 앞선 비동기 WRITE를 안정 저장소에 반영하도록 요청하고 재전송 필요 여부를 확인 | RFC 1813 | `✓` |
| 서버의 verf 보장 | verf 값을 바꾸지 않고는 데이터를 버리지 않겠다는 보장 | RFC 1813 | `✓` |
| 서버 재시작 뒤 클라이언트의 재전송 | 서버가 재시작해 verf가 바뀌면 클라이언트가 미확정 데이터를 다시 보낸다는 해석 | — | `≈` |
| 서버 async export의 의미와 위험 | "NFS 프로토콜을 위반하고 변경이 안정 저장소에 닿기 전에 응답한다". 비정상 재시작 때 데이터 유실·손상 가능 | exports(5) | `✓` |
| 서버 export 기본값 | sync | exports(5) | `✓` |
| async export의 커널 처리 | 클라이언트의 FILE_SYNC 요청도 UNSTABLE로 변경. `nfsd_commit()`은 sync export일 때만 `vfs_fsync_range()` 호출 | Linux 커널 소스 | `✓` |
| 클라이언트 마운트의 sync/async는 서버 export와 별개 | 기본 async에서는 메모리 압박, fsync류 호출, close, 잠금 설정·해제 중 하나가 일어날 때까지 서버로 쓰기를 미룸 | — | `✓` |
| 기본 조합에서 fsync가 도달하는 범위 | 클라이언트 async + 서버 sync가 기본. 이때 fsync는 서버 안정 저장까지 도달한다는 해석 | — | `Σ` |
| 서버 async export에서 동기 요청이 끝날 수 있는 위치 | 클라이언트 fsync·O_SYNC·O_DIRECT가 모두 서버 메모리에서 끝날 수 있음 | — | `Σ` |
| 기본 캐시 일관성 규칙 | close-to-open(CTO): 열 때 서버에 확인하고 닫을 때 쓰기를 전송. `nocto`로 해제 | — | `✓` |
| 클라이언트 사이의 캐시 일관성 한계 | 완전한 캐시 일관성보다 약한 일관성을 제공 | man page | `✓` |
| 일반 파일 속성의 캐시 시간 | 최소 3초(`acregmin`), 최대 60초(`acregmax`) | — | `✓` |
| `noac`의 동작과 비용 | 쓰기를 동기로 만들고 성능 손실이 큼. 데이터 캐시를 끄는 옵션은 아님 | — | `✓` |
| 클라이언트 사이의 절대 일관성에 관한 문서 안내 | 파일 잠금이나 O_DIRECT 사용을 제시 | man page | `✓` |
| NFS O_DIRECT는 클라이언트 캐시만 우회 | NFS 프로토콜이 플래그를 서버로 전달하지 못하므로 서버는 I/O를 캐시할 수 있음 | open(2) | `✓` |
| O_DIRECT의 동기 의미를 위한 클라이언트 요청 | 서버에 I/O를 동기로 처리해 달라고 요청 | open(2) | `✓` |
| 서버가 안정 저장 완료를 거짓으로 알릴 수 있음 | 서버가 안정 저장에 닿았다고 클라이언트에 거짓으로 알리도록 설정 가능 | open(2) | `✓` |
| nfsd의 기본 읽기·쓰기 모드 | 버퍼드 | — | `✓` |
| O_DIRECT·동기 쓰기의 왕복 | 매 연산이 클라이언트와 서비스 사이를 왕복한다는 설명 | EFS 문서 | `Ⓥ` |
| NFS 기본 장애 동작 | `hard`가 기본이며 요청을 무한 재시도 | nfs(5) | `✓` |
| soft 마운트의 실패 동작과 위험 | `soft`는 `retrans`번 재전송 뒤 EIO로 실패. 조용한 데이터 손상 가능성을 경고 | nfs(5) | `✓` |
| TCP 기본 타임아웃 | `timeo`는 600(60초) | nfs(5) | `✓` |
| PostgreSQL의 NFS 필수 요건과 장애 안내 | 유일한 필수 요건은 hard 마운트. 네트워크 문제 때 프로세스가 멈출 수 있어 모니터링 필요 | PostgreSQL 문서 | `✓` |
| 블록 프로토콜의 타임아웃 기본값 | 확인하지 못함 | — | `?` |
| NFS 버전별 잠금 모델 | v3는 별도 NLM·NSM, v4는 주 프로토콜에 포함되며 클라이언트 전체의 lease에 묶임 | — | `✓` |
| lease 갱신 실패 시 잠금 회수 가능 | lease는 서버가 주는 유효 기간 | — | `✓` |
| `local_lock`의 배타성 범위 | 같은 클라이언트의 애플리케이션 사이에서만 배타적 | — | `✓` |

{{% /details %}}

## 4. 실측은 어디까지 있나

NFS·iSCSI·NVMe-oF를 한 장비에서 함께 잰 최근 공개 자료는 찾지 못했습니다. 직접 비교 자료와 특정 설정의 효과를 잰 자료를 나누어 읽어야 합니다.

### 2004년 NFS와 iSCSI 직접 비교

Radkov 외 FAST'04 실험은 1GbE·Linux 2.4의 단일 클라이언트 환경에서 NFS v3와 iSCSI를 비교했습니다.

| 항목 | NFS v3 | iSCSI |
|---|---|---|
| TPC-C(DB2, 4KB 랜덤, 읽기 2/3) 정규화 처리량 | 1.00 | 1.08 |
| TPC-H(1GB) 정규화 처리량 | 1.00 | 1.07 |
| 128MB 파일 4KB 순차 읽기 완료 시간 | 35초 | 35초 |
| 같은 파일 순차 쓰기 | 17초 | 2초 |
| 서버 CPU, PostMark | 77% | 13% |
| 서버 CPU, TPC-C | 13% | 7% |
| 서버 CPU, TPC-H | 20% | 11% |

{{< lane src="_lane/4-postmark-완료-시간.json" />}}

저자들은 데이터 위주 부하의 성능은 비슷했고 메타데이터 위주 부하는 iSCSI가 두 배 이상 앞섰다고 설명합니다. iSCSI 쪽에서 메타데이터를 적극적으로 캐시하고 갱신을 모아 보낸 점을 원인으로 들었습니다. 서버가 파일시스템을 처리하는 NFS와 클라이언트가 처리하는 iSCSI의 차이가 드러난 결과로 읽을 수 있습니다. 이 구현에는 이후의 delegation·COMPOUND·nconnect가 반영되지 않았으므로 수치를 현재의 성능 차이로 옮길 수는 없습니다.

순차 쓰기의 17초와 2초는 디스크에 저장을 마친 시간으로 읽어서는 안 됩니다. 저자 설명상 ext3의 비동기 쓰기가 영향을 준 값입니다. PostMark에서는 파일 수가 늘수록 두 프로토콜의 완료 시간 차이가 줄었습니다. CPU 처리 위치도 달라 NFS는 서버가, iSCSI는 클라이언트가 메타데이터 처리를 더 많이 맡았습니다. 표의 CPU 사용률이 어느 백분위인지는 추출한 텍스트에서 확인하지 못했습니다.

VMware의 2009년 백서는 한 스토리지 서버에서 FC·HW iSCSI·SW iSCSI·NFS를 비교했습니다. 네 방식 모두 단일 VM과 여러 VM에서 line-rate 처리량을 냈고 IP 기반 프로토콜의 차이는 대부분의 블록 크기에서 의미가 없었다고 보고합니다. 1GbE 링크가 먼저 포화된 결과로 추정되며 지연 수치는 찾지 못했습니다.

### nconnect가 효과를 낸 조건

Azure NetApp Files는 단일 클라이언트의 큰 개선을 보고했고 Filestore도 단일·소수 클라이언트에 연결 증가를 권합니다. Azure Files는 채널을 계속 늘리면 이득이 없거나 성능이 나빠질 수 있다고 설명합니다. 커널 NFS 서버 메일링 리스트에는 클라이언트 200대가 이미 서버를 포화시킨 상태에서 nconnect를 늘리자 합계 읽기 IOPS가 줄었다는 보고도 있습니다. 이를 종합하면 연결 하나로 서버와 링크를 충분히 쓰지 못하던 구성에서 연결 증가의 효과가 크다고 해석할 수 있습니다.

같은 메일링 리스트 보고에서 서버 코어와 NIC를 바꿔도 작은 랜덤 읽기 처리량은 일정 범위에 머물렀습니다. 메인테이너는 경합하는 스핀 락을 지목했고, 보고자는 서버 페이지 캐시에서 작은 랜덤 읽기를 처리하는 드문 부하라고 밝혔습니다. 이 결과의 적용 범위는 해당 커널 NFS 서버 부하의 확장 한계입니다.

### RDMA 자료와 남은 측정 공백

Chuck Lever의 발표는 큰 I/O에서 NFS/TCP보다 높은 처리량을 제시하지만 공개한 조건이 적습니다. 개인 블로그의 비교는 Arm 서버의 tmpfs export에서 수행됐습니다. Lever의 후속 패치 커버레터는 보통 RPC 전송이 NFS 처리량과 지연의 주된 병목은 아니라고 설명합니다. NVMe-oF의 미디어를 제외한 낮은 큐 깊이 왕복 지연에 대응할 NFS 측정은 찾지 못했습니다.

확인한 Blockbridge와 Dell 자료는 블록 프로토콜끼리 비교한 자료입니다. NetApp도 비슷한 선속도와 연결 수에서 프로토콜 차이가 작았다고 설명할 뿐 수치와 조건을 제시하지 않습니다. 따라서 이 자료들로 NFS와 NVMe/TCP의 지연 차이를 특정 값으로 계산할 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| FAST'04 측정 환경 | 서버: 933MHz Pentium-III 2개, 10,000RPM SCSI 디스크 RAID-5. 클라이언트: 1GHz Pentium-III. 격리된 Gigabit Ethernet, RedHat Linux 9, 커널 2.4.20, ext3 | Radkov 외, FAST'04 | `Ⓑ` |
| 실험의 접근 형태 | 한 클라이언트가 원격 저장소 하나에 접근 | Radkov 외, FAST'04 | `Ⓑ` |
| 당시 수치를 현재 성능 차이로 옮길 수 없는 이유 | 2004년 조건. NFS v3 구현은 v4 delegation·COMPOUND·nconnect보다 앞선 구현 | — | `Σ` |
| TPC-C 정규화 처리량 | DB2, 4KB 랜덤, 읽기 2/3. NFS v3 1.00, iSCSI 1.08 | Radkov 외, FAST'04 | `Ⓑ` |
| TPC-H 정규화 처리량 | 1GB. NFS v3 1.00, iSCSI 1.07 | Radkov 외, FAST'04 | `Ⓑ` |
| 순차 읽기 완료 시간 | 128MB 파일, 4KB 순차 읽기. NFS v3 35초, iSCSI 35초 | Radkov 외, FAST'04 | `Ⓑ` |
| 같은 파일의 순차 쓰기 완료 시간 | 128MB 파일. NFS v3 17초, iSCSI 2초 | Radkov 외, FAST'04 | `Ⓑ` `≈` |
| PostMark 서버 CPU 사용률 | NFS v3 77%, iSCSI 13%. 몇 백분위인지 추출한 텍스트에서 읽지 못함 | Radkov 외, FAST'04 | `Ⓑ` `?` |
| TPC-C 서버 CPU 사용률 | NFS v3 13%, iSCSI 7%. 몇 백분위인지 추출한 텍스트에서 읽지 못함 | Radkov 외, FAST'04 | `Ⓑ` `?` |
| TPC-H 서버 CPU 사용률 | NFS v3 20%, iSCSI 11%. 몇 백분위인지 추출한 텍스트에서 읽지 못함 | Radkov 외, FAST'04 | `Ⓑ` `?` |
| 저자들의 부하별 결론 | 데이터 위주 부하에서는 iSCSI와 NFS가 비슷함. 메타데이터 위주 부하에서는 iSCSI가 두 배 이상 앞섬 | Radkov 외, FAST'04 | `Ⓑ` |
| 메타데이터 부하 차이에 관한 저자 설명 | iSCSI가 메타데이터를 적극 캐시하고 갱신을 모아 전송 | Radkov 외, FAST'04 | `Ⓑ` |
| 순차 쓰기 시간의 해석 | 17초 대 2초는 저자 설명상 ext3 비동기 쓰기의 영향이며, 디스크에 내려간 시간을 뜻하지 않음 | Radkov 외, FAST'04 | `≈` |
| PostMark 완료 시간 배수 | NFS 대 iSCSI: 파일 1,000개에서 약 12.2배, 5,000개에서 약 5.7배, 25,000개에서 약 2.5배. 파일 수가 늘수록 차이 감소 | Radkov 외, FAST'04 | `≈` |
| 메타데이터 CPU 처리 위치 | NFS에서는 서버, iSCSI에서는 클라이언트가 더 많이 처리 | Radkov 외, FAST'04 | `Ⓑ` |
| VMware 비교 대상과 처리량 | 2009년, 한 스토리지 서버에서 FC·HW iSCSI·SW iSCSI·NFS 비교. 네 방식 모두 단일 VM·여러 VM에서 line-rate 처리량 가능 | VMware 백서 | `Ⓥ` |
| IP 기반 프로토콜의 처리량 차이 | 대부분의 블록 크기에서 의미 있는 차이가 없다는 설명 | VMware 백서 | `Ⓥ` |
| VMware 비교의 CPU 비용 | FC·HW iSCSI가 SW iSCSI·NFS보다 낮다는 설명 | VMware 백서 | `Ⓥ` |
| VMware 결과의 링크 병목 추정 | 구성이 1GbE여서 링크가 먼저 포화됐을 것으로 추정. 1GbE는 백서의 구성, 포화는 추정 | — | `≈` |
| VMware 지연 수치 | 없음 | VMware 백서 | `?` |
| Azure NetApp Files의 nconnect 효과 | 단일 클라이언트, 100Gbps NIC, NFSv3. 8KiB 랜덤 읽기 약 426,000 IOPS, nconnect 없을 때의 약 7배 | Azure NetApp Files 큰 볼륨 문서 | `Ⓥ` |
| Azure Files의 채널 수 한계 | 4채널을 넘으면 이득이 없고 성능이 나빠질 수 있다는 설명 | Azure Files 문서 | `Ⓥ` |
| Filestore의 nconnect 권고 범위 | 단일·소수 클라이언트에서 nconnect 증가 권고 | Filestore 문서 | `Ⓥ` |
| 이미 포화된 서버에서 nconnect 증가 결과 | 클라이언트 200대가 서버를 포화시킨 상태에서 nconnect를 1보다 크게 하자 합계 읽기 IOPS 감소 | 커널 NFS 서버 메일링 리스트 보고 | `Ⓑ` |
| 커널 NFS 서버의 작은 랜덤 읽기 한계 보고 | 서버 코어 수·NIC를 바꿔도 NFSv3 읽기는 30만~40만 IOPS 근처, NFSv4.2는 16만. 메인테이너는 경합하는 스핀 락을 지목. 보고자는 서버 페이지 캐시에서 작은 랜덤 읽기를 하는 드문 부하라고 설명 | 커널 NFS 서버 메일링 리스트 보고 | `Ⓑ` |
| NFS/RDMA 발표의 처리량 주장 | 2017년, 큰 I/O에서 NFS/TCP의 2~4배. 공개 조건은 Linux v4.12, 56Gbps Mellanox CX3 Pro | Chuck Lever, 2017년 슬라이드 | `Ⓥ` |
| 개인 블로그의 TCP·RDMA 비교 | Arm 서버의 tmpfs export. TCP 약 47 KIOPS, RDMA 180 KIOPS 이상. 이 조건을 일반화할 수 없음 | NFS over RDMA 개인 블로그 | `Ⓑ` |
| RPC 전송의 병목 여부에 관한 구현자 설명 | 2026년 패치 커버레터에서 NFS 처리량·지연의 주된 병목은 보통 RPC 전송이 아니라고 설명 | Chuck Lever, 2026년 패치 커버레터 | `Ⓥ` |
| NVMe-oF 왕복 지연에 대응할 NFS 측정 | 미디어를 뺀 QD1 왕복: NVMe-oF 커널 TCP 21.39µs, RDMA 12.10µs. 이에 맞댈 NFS 공개 측정을 찾지 못함 | — | `?` |
| 세 프로토콜의 최근 직접 비교 | NFS·iSCSI·NVMe-oF를 한 장비에서 함께 잰 최근 자료를 찾지 못함 | — | `?` |
| Blockbridge·Dell 자료의 비교 범위 | 찾은 범위에서는 블록 프로토콜끼리만 측정 | Blockbridge 자료, Dell 자료 | `Ⓥ` |
| NetApp의 프로토콜 비교 서술 | 비슷한 선속도·연결 수에서 큰 차이가 없었다는 문장만 있으며 수치·조건 없음 | NetApp 문서 | `Ⓥ` |

{{% /details %}}

## 5. VM 디스크와 볼륨으로 쓸 때

### QEMU·Nova·Cinder가 제공하는 기능

NFS 위의 파일을 VM 디스크로 사용할 수 있지만, QEMU의 `cache=none`을 적용해도 NFS 서버 캐시는 남는 것으로 해석됩니다. QEMU 문서는 기본 이미지 잠금으로 동시 접근을 막고 공유 스토리지 migration 때 잠금을 인계한다고 설명합니다. NFS 서버 장애나 lease 만료 때의 동작은 확인하지 못했습니다.

QEMU의 libnfs 드라이버는 NFS 공유 파일에 직접 접근하며 전송은 TCP만 사용합니다. `cache.direct=on`이면 자체 readahead를 사용할 수 없고 커널 클라이언트와의 성능 비교 자료는 없습니다. libvirt에서는 lockd 플러그인에 모든 호스트가 볼 수 있는 공유 파일시스템이 필요하며, netfs 풀이 NFS 공유의 파일을 볼륨으로 취급합니다.

Nova의 공유 스토리지 경로는 [03]({{< relref "/data/block-storage/03-local-disk-ha/index.md" >}})과 이어집니다. Nova는 NFS를 공유 스토리지의 첫 예로 들고, 공유 스토리지 live migration에서는 디스크를 복사하지 않는다고 설명합니다. `/var/lib/nova/instances`를 공유하면 block migration 없이 이동하고 노드 장애 뒤 다시 띄울 경로가 생긴다고 해석할 수 있습니다.

NFS 자체의 공유 기능이 이를 감싼 서비스에 모두 제공되는 것은 아닙니다. Cinder NFS 드라이버의 지원 매트릭스에는 Multi-Attach·QoS·Volume Replication 등이 missing입니다. 이를 근거로 Cinder 볼륨이 된 NFS 파일은 한 인스턴스의 디스크로 취급된다고 읽었습니다. 파일 공유 서비스로는 Manila가 관련될 수 있지만 문서를 열지는 않았습니다. Cinder는 블록 드라이버와 같은 IO 성능을 기대하지 말고 시험하라는 주의문도 제공합니다.

Kubernetes의 접근 모드 표에서 NFS는 RWO·ROX·RWX를 지원하지만 raw block 목록에는 없습니다. iSCSI·FC·RBD에는 RWX가 없습니다. csi-driver-nfs는 서버에 하위 디렉터리를 만들어 PV로 줍니다. 이 경로의 용량 격리·IOPS 한도·스냅숏은 서버 구현이 제공하는 범위에 따르는 것으로 해석됩니다.

### DB가 요구하는 저장 조건

PostgreSQL 문서는 NFS가 로컬 드라이브처럼 동작한다고 가정하며 서버의 `sync` export를 강하게 권합니다. 그렇지 않으면 클라이언트 fsync가 서버의 영구 저장소에 도달한다는 보장이 없어 fsync를 끈 것과 비슷한 손상이 생길 수 있다고 설명합니다. 같은 문서는 iSCSI가 블록 장치로 보이므로 NFS 특유의 동작을 다루지 않아도 되지만, 원격 스토리지 관리의 복잡성은 다른 계층으로 옮겨 간다고 적습니다.

다른 DB 문서의 확인 수준은 고르지 않습니다. MySQL 8.4의 NFS 주의사항과 Elasticsearch의 원격 스토리지 서술은 요약 모델이 돌려준 인용으로만 확인했습니다. Elasticsearch 인용에는 NFS라는 이름도 없습니다. etcd는 디스크 쓰기 지연에 민감하다고 설명하지만 NFS를 직접 언급하지 않으며, Kafka 공식 문서에서는 관련 문장을 뽑지 못했습니다.

### 클라우드 파일 서비스의 지연 조건

EFS 문서의 General Purpose Regional·Elastic은 최선의 경우 읽기 약 1ms, 쓰기 약 2.7ms를 제시합니다. AWS는 연산마다 작은 지연이 붙기 때문에 큰 I/O와 여러 클라이언트·스레드의 병렬 처리가 높은 처리량의 전제라고 설명합니다. Azure Files도 작은 I/O와 메타데이터가 많은 작업의 지연을 구분합니다.

이 수치들은 EBS io2 Block Express의 지연 목표와 측정 조건이 달라 순위로 묶기 어렵습니다. 문서들을 비교하면 파일 서비스는 연산별 왕복과 병렬화를, 블록 서비스는 볼륨당 IOPS와 지연을 제시한다는 차이가 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| QEMU 캐시 설정 | `cache=none`은 호스트 페이지 캐시를 우회하는 `cache.direct=on`. 기본은 writeback. NFS 이미지에서는 NFS 클라이언트 캐시만 제외되고 서버 캐시는 남는다는 해석 포함 | QEMU 문서 | `✓` `Σ` |
| QEMU 이미지 잠금 | 기본으로 동시 접근을 차단. Linux에서는 OFD 잠금 사용. 공유 스토리지 migration의 잠금 인계 처리 | QEMU 문서 | `✓` |
| QEMU 이미지 잠금의 장애 동작 | NFS 서버 장애·lease 만료 때 동작을 문서에서 확인하지 못함 | QEMU 문서 | `?` |
| QEMU libnfs 드라이버 경로와 제약 | `block/nfs.c`가 NFS 공유 파일에 직접 접근. 전송은 TCP뿐. `cache.direct=on`이면 자체 readahead 사용 불가 | QEMU libnfs 드라이버 | `✓` |
| libnfs와 커널 클라이언트 성능 비교 | 실측 없음 | — | `?` |
| libvirt의 공유 파일시스템 사용 | lockd 플러그인은 모든 호스트에서 보이는 공유 파일시스템 필요. netfs 풀은 NFS 공유의 파일을 볼륨으로 취급 | libvirt 문서 | `✓` |
| Nova의 공유 스토리지와 장애 재기동 | NFS를 공유 스토리지의 첫 예로 제시. 공유 스토리지 live migration은 디스크를 복사하지 않음. 노드 장애 때 `/var/lib/nova/instances`가 공유이면 인스턴스 재기동 가능하다는 해석 포함 | Nova 문서 | `✓` `Σ` |
| Cinder NFS 드라이버의 볼륨과 주의문 | 볼륨은 NFS 위 파일. 블록 드라이버와 같은 IO 성능을 기대하지 말고 시험하라는 안내 | Cinder NFS 드라이버 문서 | `✓` |
| Cinder NFS 드라이버의 지원 범위 | Multi-Attach·QoS·Volume Replication 등이 missing | Cinder Driver Support Matrix | `✓` |
| Kubernetes 접근 모드와 raw block | NFS는 RWO·ROX·RWX. iSCSI·FC·RBD는 RWX 없음. raw block 목록에 NFS 없음 | Kubernetes 접근 모드 표·raw block 목록 | `✓` |
| NFS PV를 만드는 단위 | 서버에 하위 디렉터리를 만들어 PV로 제공 | csi-driver-nfs | `✓` |
| 파일 공유 서비스 관련 미확인 사항 | Manila 같은 서비스가 관련될 것으로 보이나 문서를 열지 않음 | — | `?` |
| Kubernetes NFS PV의 볼륨 속성 범위 | 서버 export 아래 하위 디렉터리이므로 용량 격리·IOPS 한도·스냅숏은 서버 구현이 제공하는 범위에 따름 | — | `Σ` |
| PostgreSQL의 NFS 전제 | NFS가 로컬 드라이브와 똑같이 동작한다고 가정 | PostgreSQL 문서 | `✓` |
| PostgreSQL의 서버 export 권고 | 서버의 `sync` export를 강하게 권고. 그렇지 않으면 클라이언트 fsync의 영구 저장소 도달 보장이 없어 fsync를 끈 것과 비슷한 손상 가능 | PostgreSQL 문서 | `✓` |
| PostgreSQL의 iSCSI 비교 | iSCSI는 블록 장치로 보여 NFS의 특이한 점을 다루지 않아도 됨. 원격 스토리지 관리의 복잡성은 다른 계층으로 이동 | PostgreSQL 문서 | `✓` |
| MySQL의 NFS 주의사항과 확인 수준 | MySQL 8.4는 잠금, 순서 뒤바뀜·유실, 파일 크기 한도를 언급. 요약 모델이 돌려준 인용으로만 확인 | MySQL 8.4 문서 | `?` |
| Elasticsearch의 원격 스토리지 서술 | 로컬 스토리지가 대체로 낫고 일부 원격 스토리지는 매우 나쁘다는 설명. NFS라는 이름은 없으며 인용으로만 확인 | Elasticsearch 문서 | `Ⓥ` |
| etcd의 요구 | NFS를 이름으로 든 문장은 없고 디스크 쓰기 지연에 민감하다는 요구만 있음 | etcd 문서 | `✓` |
| Kafka 관련 문장 | 공식 문서에서 관련 문장을 뽑지 못함 | Kafka 공식 문서 | `?` |
| EFS의 최선 지연 수치 | General Purpose의 Regional·Elastic: 읽기 약 1ms, 쓰기 약 2.7ms | EFS 문서 | `Ⓥ` |
| EFS의 I/O 크기와 병렬화 설명 | 연산마다 작은 지연이 붙어 I/O 크기가 클수록 처리량 증가. 최고 성능은 클라이언트 10대 이상·클라이언트당 64스레드 이상에서 나온다는 설명 | EFS 문서 | `Ⓥ` |
| EFS 파일 열기·닫기 비용 | 열기·닫기 한 번의 왕복이 메가바이트 데이터를 읽고 쓰는 시간만큼 걸릴 수 있다는 설명 | EFS 문서 | `Ⓥ` |
| Azure Files의 지연 범위 | SSD 공유의 작은 I/O는 한 자릿수 ms 초반. 메타데이터가 많은 작업은 더 길 수 있음 | Azure Files 문서 | `Ⓥ` |
| EBS 지연 설계 목표 | io2 Block Express: 16KiB 평균 500µs 미만 | EBS 문서 | `Ⓥ` |

{{% /details %}}

## 6. 언제 NFS가 맞는 답인가

NFS가 제공하는 파일 공유와 관리 기능이 필요한지부터 판단할 수 있습니다. Kubernetes는 NFS의 RWX를 명시하고 Nova는 공유 디스크를 이용한 이동·재기동 경로를 설명합니다. NetApp은 LUN 생성·매핑·포맷과 다른 파일 관리 방식을 설명하며, Cinder는 볼륨 백업을 파일 복사에 비유합니다. NFS v4.2의 COPY·CLONE·DEALLOCATE도 VM 이미지를 파일로 관리할 때 활용할 여지가 있습니다. 마지막 연결은 기능과 용도를 종합한 해석입니다.

| 상황 | 판단과 적용 조건 |
|---|---|
| 여러 노드가 같은 데이터를 읽고 쓴다 | NFS의 파일 공유에 적합한 용도. 블록 장치 동시 쓰기에는 클러스터 인식 파일시스템이 필요 |
| 공유 스토리지 live migration, 노드 장애 재기동 | Nova가 설명하는 공유 스토리지 경로에 적합 |
| LUN 생성·매핑·포맷 없이 쓰고 크기를 줄이고 싶다 | 파일로 관리하는 방식이 운영을 단순하게 하는 경우에 적합 |
| 서버 측 복사·클론, sparse 파일 | NFS v4.2의 파일 단위 기능을 활용할 수 있는 용도 |
| 단일 클라이언트의 메타데이터 위주 부하 | 2004년 1GbE·Linux 2.4 실측에서는 불리했음. 현행 구현의 성능으로 일반화할 수 없음 |
| fsync에 기대는 DB를 async export 위에 올린다 | 안정 저장 전 응답으로 손상 위험이 있으므로 부적합 |
| 지연이 작아야 하는 낮은 큐 깊이의 쓰기 | 연산별 왕복 비용을 검토해야 함. 같은 조건의 NFS·NVMe-oF 지연 비교는 미확인 |
| VM에 블록 장치 그대로 필요하다 | NFS 파일을 감싼 서비스의 기능 제한이 있으므로 부적합 |

이 표는 문서와 측정을 연결한 판단이며 모든 항목의 근거 수준이 같지는 않습니다. 낮은 큐 깊이 쓰기의 적합성을 낮게 본 근거는 파일 서비스의 연산별 왕복과 로컬 스토리지를 선호한다는 서술입니다. 블록 장치의 flush가 장치에 도달하고 한 호스트가 장치를 독점하는 사용 방식에 기대는 경우에도 NFS의 쓰기·공유 의미를 별도로 검토해야 합니다. 메타데이터 부하에서 NFS의 서버 CPU 사용이 높았다는 결과는 2004년 실측에 한정되며, 서버에 파일시스템을 둔 차이와 연결해 읽었습니다.

PostgreSQL 문서가 설명하듯 iSCSI를 선택하면 NFS 특유의 동작을 피할 수 있지만 원격 스토리지 관리의 복잡성은 다른 계층에 남습니다. NetApp 역시 비슷한 선속도와 연결 수에서 프로토콜 차이가 작았다고 설명하면서 NVMe-oF의 IOPS·지연·호스트 CPU 이점과 NFS의 VM 관리 편의를 함께 제시합니다. 호스트 CPU 감소 수치에는 조건이 없으므로 이를 정량 비교로 사용할 수는 없습니다. 확보한 자료로는 성능 순위보다 공유·저장·복구 방식의 적합성을 판단하는 데 무게를 두게 됩니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 공유 접근의 근거 | 접근 모드 표에서 RWX는 NFS 같은 파일 계열 | Kubernetes 접근 모드 표 | `✓` |
| 블록 장치 동시 쓰기의 조건 | 클러스터 인식 파일시스템이 없으면 손상 | — | `✓` |
| Nova의 공유 스토리지 예 | NFS를 첫 예로 제시 | Nova 문서 | `✓` |
| 관리 방식의 차이 | LUN 생성·매핑·포맷 및 크기 변경과 관련한 서술 | NetApp 문서 | `Ⓥ` |
| 파일로 된 볼륨의 백업 | "볼륨 백업은 파일 복사만큼 쉽다" | Cinder 문서 | `✓` |
| NFS v4.2 파일 단위 기능 | COPY·CLONE·DEALLOCATE | — | `✓` |
| 메타데이터 부하 실측 | 2004년 실측에서 블록이 2배 이상 앞섬 | Radkov 외, FAST'04 | `Ⓑ` |
| async export의 DB 손상 위험 | fsync를 끈 것과 비슷한 손상 경고 | PostgreSQL 문서 | `✓` |
| 파일 서비스의 연산 비용 | 연산당 왕복 지연 | 파일 서비스 문서 | `Ⓥ` |
| 로컬 스토리지 선호 | 로컬 스토리지를 선호한다는 서술 | Elasticsearch 문서 | `Ⓥ` |
| vSphere NFS 데이터스토어 제한 | RDM·VM Cluster 불가 | — | `✓` |
| Kubernetes raw block 범위 | NFS 없음 | Kubernetes raw block 목록 | `✓` |
| Cinder NFS 지원 범위 | Multi-Attach·QoS missing | Cinder 문서 | `✓` |
| iSCSI 선택 뒤에도 남는 관리 복잡성 | NFS의 특이한 점은 피하지만 원격 스토리지 관리의 복잡성이 다른 계층으로 이동 | PostgreSQL 문서 | `✓` |
| 벤더의 프로토콜 선택 서술 | 같은 선속도·연결 수에서는 프로토콜 차이가 작음. NVMe-oF는 IOPS·지연·호스트 CPU에서 이득, 호스트 CPU는 최대 50% 이상 감소. NFS는 많은 VM에서 유연성과 관리 편의가 가장 크다는 설명. 50% 수치의 조건은 없음 | NetApp 문서(vSphere datastore and protocol features overview) | `Ⓥ` |

{{% /details %}}

## 7. 확인하지 못한 것

| 항목 | 상태 |
|---|---|
| NFS·iSCSI·NVMe-oF를 한 장비·한 커널에서 같이 잰 공개 실측 | 논문·벤더 보고서·학회 발표에서 찾지 못함 |
| NFS에서 미디어를 뺀 QD1 왕복 지연(TCP·RDMA, 커널 6.x) | 01의 NVMe-oF 값과 비교할 NFS 측정 없음 |
| nconnect의 조건 포함 실측(LPC·SNIA SDC·NetApp TR·Red Hat·SUSE) | 찾지 못함. NetApp TR-4067은 내려받지 못함 |
| `max_connect` 도입 버전, nfsd I/O 모드(DIRECT·DONTCACHE)의 도입 버전과 설정 인터페이스 | 확인하지 않음 |
| v4.1 세션의 슬롯 수 협상이 동시 요청 상한이 되는지, 배포판·벤더의 슬롯 권고값 | RFC 원문과 권고 문서 미확인 |
| 같은 서버로 가는 여러 마운트가 연결을 공유한다는 커널 문서 | 벤더 문서로만 확인 |
| nconnect와 RDMA의 조합 지원 범위 | 확인하지 못함 |
| Radkov 표의 CPU 사용률이 몇 백분위인지, VMware 백서의 상대 CPU 값과 지연 | 텍스트 추출에서 숫자가 빠졌거나 그래프에만 있음 |
| QEMU 문서의 NFS 이미지 cache·aio 권고, NFS 서버 장애 때 이미지 잠금 동작, libnfs 대 커널 클라이언트 성능 | 문서에서 찾지 못함 |
| MySQL·Elasticsearch 문장의 원문 재확인, Kafka 공식 문서의 NFS 문장 | 요약 모델 인용으로만 확인하거나 관련 문장을 뽑지 못함 |
| iSCSI·NVMe-oF에서 flush·FUA가 타깃까지 전달되는 규칙, 블록 쪽 I/O 타임아웃 기본값 | 스펙 원문 미확인 |
| Manila 문서, Nova libvirt의 NFS 마운트 옵션 | 열지 않음 |
| Google Filestore·Azure Files의 조건 포함 지연 표 | 범위 표현만 있음 |

## 참고 자료

- [RFC 1813 NFS Version 3 Protocol Specification](https://www.rfc-editor.org/rfc/rfc1813.txt) — IETF, 1995-06. 파일 핸들, stateless, stable_how, COMMIT
- [RFC 8881 NFSv4.1](https://www.rfc-editor.org/rfc/rfc8881.txt) — IETF, 2020-08. COMPOUND, 잠금·lease, 세션, pNFS
- [RFC 7862 NFSv4.2](https://www.rfc-editor.org/rfc/rfc7862.txt) — IETF, 2016-11. 서버 측 복사, sparse, 공간 예약
- [RFC 8166 RPC-over-RDMA v1](https://www.rfc-editor.org/rfc/rfc8166.txt) · [RFC 8267 NFS Upper-Layer Binding](https://www.rfc-editor.org/rfc/rfc8267.txt) — IETF, 2017. chunk, credit, DDP-eligible
- [nfs(5)](https://man7.org/linux/man-pages/man5/nfs.5.html) · [exports(5)](https://man7.org/linux/man-pages/man5/exports.5.html) · [rpc.nfsd(8)](https://man7.org/linux/man-pages/man8/rpc.nfsd.8.html) · [open(2)](https://man7.org/linux/man-pages/man2/open.2.html) — man7.org. nconnect, hard/soft, 캐시 일관성, sync/async, 스레드 수, O_DIRECT
- [torvalds/linux](https://github.com/torvalds/linux) — master, 2026-10-05. fs/nfs/{write.c, direct.c, fs_context.c}, fs/nfsd/vfs.c, net/sunrpc/{clnt.c, xprtmultipath.c, xprtsock.c}
- [A Performance Comparison of NFS and iSCSI for IP-Networked Storage](https://www.usenix.org/legacy/event/fast04/tech/full_papers/radkov/radkov.pdf) — Radkov 외, FAST'04. 2004년 실측
- [Comparison of Storage Protocol Performance in VMware vSphere 4](https://web.archive.org/web/2020id_/https://www.vmware.com/content/dam/digitalmarketing/vmware/en/pdf/techpaper/perf_vsphere_storage_protocols.pdf) — VMware, 2009. 아카이브본
- [vSphere datastore and protocol features overview](https://github.com/NetAppDocs/ontap-apps-dbs/blob/main/vmware/vmware-vsphere-datastores-top.adoc) — NetApp 문서. 프로토콜 선택 서술
- [Improve NFS Azure file share performance](https://learn.microsoft.com/en-us/azure/storage/files/nfs-performance) · [Azure NetApp Files large volume performance benchmarks for Linux](https://learn.microsoft.com/en-us/azure/azure-netapp-files/performance-large-volumes-linux) — Microsoft, 2026-07-29·2025-10-29. nconnect 효과
- [Amazon EFS performance specifications](https://docs.aws.amazon.com/efs/latest/ug/performance.html) · [performance tips](https://docs.aws.amazon.com/efs/latest/ug/performance-tips.html) — AWS. 지연·한도 계약
- [Filestore Performance](https://docs.cloud.google.com/filestore/docs/performance) — Google Cloud, 2026-09-30
- [knfsd read iops limits?](https://ratatoskr.run/linux-nfs/2026/01/16642729/t) — linux-nfs 메일링 리스트, 2026-01-25. 사용자 보고
- [NFS/RDMA Next Steps](https://datatracker.ietf.org/meeting/99/materials/slides-99-nfsv4-nfsrdma-next-steps-chuck-lever-00) — Chuck Lever, IETF 99, 2017-07 · [svcrdma 패치 커버레터](https://ratatoskr.run/linux-nfs/2026/02/16643056/t), 2026-02-27
- [NFS over RDMA Setup & Benchmark](https://charlie0129.github.io/blog/p/nfs-over-rdma/) — 개인 블로그, 2024-07-19
- [QEMU invocation](https://www.qemu.org/docs/master/system/invocation.html) · [QEMU block drivers](https://www.qemu.org/docs/master/system/qemu-block-drivers.html) · [libvirt 잠금 관리자](https://libvirt.org/kbase/locking.html) · [libvirt 스토리지](https://libvirt.org/storage.html)
- [Cinder NFS driver](https://docs.openstack.org/cinder/latest/configuration/block-storage/drivers/nfs-volume-driver.html) · [Cinder Driver Support Matrix](https://docs.openstack.org/cinder/latest/reference/support-matrix.html) · [Nova Configure live migrations](https://docs.openstack.org/nova/latest/admin/configuring-migrations.html)
- [Kubernetes Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) · [csi-driver-nfs](https://github.com/kubernetes-csi/csi-driver-nfs)
- [PostgreSQL 18 §18.2.2.1 NFS](https://www.postgresql.org/docs/current/creating-cluster.html) · [MySQL 8.4 Using NFS with MySQL](https://dev.mysql.com/doc/refman/8.4/en/disk-issues.html) · [Elasticsearch 8.19 Tune for indexing speed](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/tune-for-indexing-speed.html)
- [etcd v3.6 hardware](https://raw.githubusercontent.com/etcd-io/website/main/content/en/docs/v3.6/op-guide/hardware.md) · FAQ — etcd. 디스크 쓰기 지연 요구, NFS 언급 없음
- [NFS file shares in Azure Files](https://learn.microsoft.com/en-us/azure/storage/files/files-nfs-protocol) — Microsoft, 2026-07-08. SSD 공유 지연
- [Amazon EBS Provisioned IOPS SSD volumes](https://docs.aws.amazon.com/ebs/latest/userguide/provisioned-iops.html) — AWS. io2 Block Express 설계 목표
- [Linux 5.3](https://kernelnewbies.org/Linux_5.3) · [NFS 변경 pull 요청](https://lkml.iu.edu/hypermail/linux/kernel/1907.2/02845.html) — nconnect 도입
- [Broadcom TechDocs, Comparing Types of Storage](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/7-0/vsphere-storage/getting-started-with-a-traditional-storage-model-in-vsphere-environment/what-types-of-physical-storage-does-esxi-support/comparing-types-of-storage.html) — vSphere 7.0
