---
title: "Linux NVMe/TCP 연결을 자동화하고 장애 정책을 정한다"
linkTitle: "06 Linux NVMe/TCP 운영"
description: "Linux와 Kubernetes 워커에서 NVMe/TCP 연결을 유지하는 설정을 정리한다. 배포판별 지원 범위부터 호스트 식별, 자동 연결, 멀티패스 장애 정책, 인증과 TLS 키 관리까지 이어서 설명한다."
weight: 6
date: 2026-10-21
lastmod: 2026-10-21
url: "/storage/06-linux-nvme-tcp-operations/"
---

# 06 · Linux NVMe/TCP 연결을 자동화하고 장애 정책을 정한다

Linux 호스트가 NVMe/TCP 연결을 안정적으로 유지하려면 네 가지를 함께 맞춰야 합니다. 호스트 식별자를 고정하고, 부팅 뒤 연결을 복원하며, 디스커버리 변경을 감지하고, 모든 경로가 끊겼을 때 I/O를 얼마나 기다릴지 정해야 합니다. FC SAN의 HBA·패브릭·`multipath.conf`에 모여 있던 역할이 Linux에서는 파일과 서비스, 커널 옵션으로 흩어집니다. Kubernetes 워커도 이 설정 위에서 스토리지에 연결됩니다.

명령이 존재하는 것과 배포판이 제품 기능으로 지원하는 것은 다릅니다. 2026-10-21 현재 조사한 배포판은 nvme-cli 2.x 계열을 제공하지만 nvme-stas의 포함 여부와 버전은 제각각입니다. 반면 업스트림 3.x는 2026년 9월부터 설정 형식과 경로, 인증 명칭을 바꾸기 시작했습니다. 홈랩 타깃은 커널 nvmet와 SPDK 가운데 고를 수 있습니다.

이 글은 근거를 `✓` 1차 문서, `Ⓑ` 공개 벤치마크, `Ⓥ` 벤더·프로젝트 주장, `≈` 추정·역산, `?` 미확인으로 구분합니다. 수치와 적용 조건은 각 절의 접은 표에 모았습니다.

여기서 다루는 식별자와 타임아웃은 [05 호스트·클라우드·오프로드]({{< relref "/data/block-storage/05-host-side-and-cloud/index.md" >}})의 CSI 동작에도 그대로 이어집니다. 프로토콜 구조는 [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}}), 벤더 지원 현황은 [04 엔터프라이즈 전송 현황]({{< relref "/data/block-storage/04-enterprise-transports/index.md" >}})에 정리했습니다. 전송별 차이는 [07 FC·TCP·RDMA 전송 비교]({{< relref "/data/block-storage/07-fc-tcp-rdma-transports/index.md" >}}), Kubernetes 구현은 [08 Kubernetes NVMe-oF와 Mayastor]({{< relref "/data/block-storage/08-kubernetes-nvmeof-mayastor/index.md" >}})에서 이어집니다.

## 1. 패키지 제공과 제품 지원을 구분한다 {#1-배포판과-홈랩에서-쓸-수-있는-선택지}

저장소에서 패키지를 찾았다고 곧바로 지원 구성으로 볼 수는 없습니다. RHEL 9·10은 nvmetcli 0.8을 제공하면서도 커널 타깃인 nvmet와 nvmet-tcp는 지원하지 않는다고 명시합니다. SLES는 nvmetcli를 이용한 타깃 구성 절차를 공식 문서에 싣습니다. 디스커버리 관리 도구인 nvme-stas 역시 배포판에 따라 제공 여부와 버전이 다릅니다.

홈랩에서는 커널 nvmet나 SPDK의 `nvmf_tgt`로 타깃을 만들 수 있습니다. nvmet는 configfs에서 서브시스템, 네임스페이스, 포트를 구성하고 SPDK는 RPC를 사용합니다. nvmet의 포트 `ana_state`와 네임스페이스 `ana_grpid`를 바꾸면 서버 한 대에서도 optimized·non-optimized·inaccessible 전환과 호스트 iopolicy의 반응을 시험할 수 있습니다.

루트 파일시스템을 NVMe/TCP에서 부팅하는 기능은 데이터 볼륨 연결과 별도 지원 항목입니다. SLES는 15 SP7 이상에서 지원하고 RHEL은 Technology Preview로 제공합니다.

| FC SAN | Linux NVMe/TCP 대응 | 성숙도 |
|---|---|---|
| 부팅 LUN | NVMe/TCP 부팅(NBFT, NVMe Boot Spec 1.0). SLES 15 SP7 이상 지원, RHEL 10은 Technology Preview(일부 플랫폼), RHEL 9.4~는 설치가 Technology Preview, Ubuntu는 24.04에서 루트만 실험적(/boot는 로컬) | SLES `✓` / RHEL TP `✓` / Ubuntu 26.04 `?` |

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| nvme-stas 배포판 패키지 | RHEL 9 2.2.1, SLES 15 SP7 2.3.1, Ubuntu 24.04 2.3.1, Ubuntu 26.04·Debian 13 2.4.1. RHEL 10은 CentOS Stream 10·AlmaLinux 10 저장소에 없어 미탑재로 판단 | Ubuntu·Debian madison, CentOS·AlmaLinux 패키지 목록, SUSE OBS | `✓`, RHEL 10 `≈` |

SLES 16이 nvme-stas를 패키지로 제공하는지는 확인하지 못했다. nvmetcli는 Debian 13에는 없고 forky에는 0.9가 있으며 Ubuntu 24.04·26.04 저장소에서는 찾을 수 없었다.

커널 nvmet는 `/sys/kernel/config/nvmet/`에서 설정한다. `subsystems/<nqn>/`에는 `attr_allow_any_host`, `attr_serial`, `attr_model`, `allowed_hosts/`가 있으며 허용 호스트는 `hosts/<hostnqn>`를 가리키는 심볼릭 링크로 연결한다. `namespaces/<nsid>/`에서는 `device_path`, `ana_grpid`, `enable` 등을 지정한다. `ports/<id>/`에는 `addr_trtype`(tcp), `addr_traddr`, `addr_trsvcid`, `addr_treq`, `addr_tsas`, `ana_groups/<grpid>/ana_state`, `subsystems/` 링크를 둔다.

nvmetcli의 `saveconfig`는 설정을 `/etc/nvmet/config.json`에 저장하고 `restore`는 이를 읽으며 `clear`는 전체 설정을 지운다. 패키지의 `nvmet.service`가 부팅 시 저장본을 복원한다. `dhchap_*`, `addr_tsas`, ANA 그룹까지 저장되는지는 확인하지 못했다. 이 범위가 확인될 때까지는 configfs에 직접 쓰는 스크립트를 systemd 유닛으로 실행하는 편이 확실하다고 판단한다.

SPDK RPC는 `nvmf_create_transport -t TCP`, `nvmf_create_subsystem`, `nvmf_subsystem_add_ns`, `nvmf_subsystem_add_listener` 순서로 구성한다.

{{% /details %}}

## 2. 식별자를 고정한 뒤 연결을 자동화한다 {#2-호스트-식별에서-자동-연결까지}

호스트 정체성은 `/etc/nvme/hostnqn`과 `/etc/nvme/hostid`에 저장되고 `nvme show-hostnqn`으로 확인할 수 있습니다. nvme-cli 설계 문서는 hostid가 부팅마다 바뀌면 persistent reservation(영속 예약)이 깨지고, 서로 다른 호스트가 같은 값을 공유해도 충돌한다고 경고합니다. 따라서 이 두 파일을 포함한 VM 템플릿이나 골든 이미지를 복제하면 어레이가 여러 VM을 한 호스트로 인식할 수 있습니다. 이미지 배포 과정에서 두 식별자를 다시 만들어야 한다는 것은 이 동작에서 도출한 운영 판단입니다.

먼저 `nvme discover`로 디스커버리 로그를 읽습니다. 이후 특정 서브시스템에는 `nvme connect`, 로그에 나온 전체 대상에는 `nvme connect-all`로 접속합니다. 다음 예시는 최초 연결과 부팅 시 자동 연결을 함께 설정합니다.

```
modprobe nvme-tcp
nvme discover --transport=tcp --traddr=192.168.101.55 --host-traddr=192.168.101.154 --trsvcid=8009
nvme connect-all
systemctl enable nvmf-autoconnect.service
nvme list-subsys
```

영속 설정 파일은 nvme-cli 주 버전에 따라 바뀝니다. 2.x 자동화가 사용하던 JSON과 `--dump-config`를 3.x에 그대로 적용할 수 없습니다.

| 항목 | nvme-cli 2.x (현재 배포판) | nvme-cli 3.x (업스트림) |
|---|---|---|
| 디스커버리 목록 | `/etc/nvme/discovery.conf` (한 줄에 discover 인자) | `/etc/nvme/nvme-fabrics.conf` + `nvme-fabrics.conf.d/` (INI) |
| 다중 서브시스템·경로별 설정 | `/etc/nvme/config.json` | 같은 INI의 `[Subsystem]` 섹션 |
| 변환 | — | `nvme config-convert`, 첫 fabrics 명령에서 자동 변환 |

부팅 시 접속과 실행 중 변경 감지는 별도 경로로 동작합니다. `nvmf-autoconnect.service`는 부팅 뒤 한 차례 연결을 만들고, udev 규칙은 디스커버리 로그의 변경 이벤트를 받아 연결 명령을 다시 실행합니다. 이 이벤트를 계속 받으려면 디스커버리 컨트롤러와의 연결을 유지해야 합니다.

CDC(Centralized Discovery Controller)를 두면 디스커버리와 존을 중앙에서 관리할 수 있습니다. FC의 네임서버와 존에 가까운 역할이며 Linux 호스트에서는 nvme-stas가 이를 사용합니다. stafd가 디스커버리 컨트롤러를 찾아 로그를 관리하고, stacd는 그 정보를 받아 I/O 컨트롤러에 접속합니다. nvme-stas 프로젝트 설명에 따르면 CDC의 존 변경에 맞춰 stacd가 연결을 만들거나 해제합니다. CDC가 없는 환경에서는 타깃의 허용 호스트 목록과 네트워크 분리가 이 역할을 대신합니다.

| FC SAN | Linux NVMe/TCP 대응 | 성숙도 |
|---|---|---|
| WWPN/WWNN (HBA 고정) | hostnqn + hostid 파일. 이미지 복제 시 같이 복제됨 | `✓` 동작 / `≈` 운영 함정 |
| 존(zoning) | CDC 존(TP8010) + stacd `honor-fabric-zoning`. CDC가 없으면 타깃의 `allowed_hosts`와 네트워크 분리 | `✓` 클라이언트 / `?` CDC 제품 현황 |
| LUN masking | 서브시스템별 허용 호스트(`allowed_hosts`, 어레이 host 매핑) + 네임스페이스 | `✓` |
| RSCN·패브릭 로그인 이벤트 | 디스커버리 로그 변경 AEN(`0x70f002`) → udev → `nvmf-connect@` 재실행. 영속 디스커버리 연결이 전제 | `✓` |
| 부팅 시 패브릭 로그인 | `nvmf-autoconnect.service` (3.2부터 `nvme-discoverd`) | `✓` / 3.2 미출시 |

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 식별 파일 | `/etc/nvme/hostnqn`, `/etc/nvme/hostid`. 확인은 `nvme show-hostnqn`. 컨트롤러별 `/sys/class/nvme/nvmeX/hostnqn`, `hostid` | RHEL 9·10 문서, 커널 sysfs.c | `✓` |
| hostid 미고정 위험 | 부팅마다 새 값이 생기면 persistent reservation이 깨진다고 경고. 공유해도 충돌 | nvme-cli INI 설정 설계 문서 | `✓` |
| 설정 파일 변화 | 2.x `discovery.conf`·`config.json`, 3.x INI. 3.x는 `.json` 거부, `--dump-config` 스크립트 깨짐 | nvme-cli NEWS.md, INI 설계 문서, RHEL 9 문서 | `✓` |
| 자동 연결 | `nvmf-autoconnect.service`, `70-nvmf-autoconnect.rules`(`NVME_AEN=="0x70f002"`). nvme-cli v3.1 저장소 기준 | nvme-cli v3.1 nvmf-autoconnect | `✓` |
| `nvme-discoverd` | 3.2 미출시 문서 기준 | nvme-cli NEWS.md | `✓` 미출시 |
| stafd·stacd 역할 | stafd가 DC에 붙어 캐시와 D-Bus API 제공, stacd가 I/O 연결. TP8010·TP8009 근거 | nvme-stas README | `✓` |
| 3.0 경로 변경 | `/etc/stas/*.conf` → `/etc/nvme/*.conf`, `nvme-stas.conf` 신설, `sys.conf`·`stasadm` 삭제 | nvme-stas NEWS.md | `✓` |
| 존 변경 시 자동 연결·해제 | 프로젝트 설명 | nvme-stas README | `Ⓥ` |
| Dell SFSS | 데이터 경로에 끼지 않는 CDC. 2021년 자료만 확인 | WWT 블로그 | `Ⓥ` 현황 `?` |

관례상 디스커버리는 8009, I/O는 4420 포트를 사용한다. 경로를 특정 NIC에 고정하려면 `--host-traddr`(`-w`)나 `--host-iface`(`-f`)를 지정한다.

부팅 과정에서 `nvmf-autoconnect.service`는 `network-online.target` 이후 `nvme connect-all --owner=autoconnect`를 한 차례 실행한다. 디스커버리 로그 변경 AEN(`0x70f002`) uevent가 오면 `70-nvmf-autoconnect.rules`가 `nvmf-connect@<인자>.service`를 다시 시작한다. 3.0부터는 런타임 옵션 `--persistent`로 디스커버리 연결을 영속화한다.

미출시 3.2의 `nvme-discoverd.service`가 이 역할을 넘겨받을 예정이다. 이 데몬을 빌드하면 앞의 udev 규칙과 `nvmf-*` 유닛은 설치되지 않는다. 3.x의 `nvme disconnect-all`은 소유자 정보가 없는 컨트롤러만 끊는다. NetApp은 SLES 16에서 이 명령이 루트 파일시스템 연결까지 해제할 수 있으므로 SAN 부팅 호스트에서는 사용하지 말라고 안내한다.

stafd는 로그 페이지를 `/run/stafd/`에 캐시하고 D-Bus API로 제공한다. 기본값이 꺼진 mDNS 탐색은 `stafd.conf`의 `zeroconf=enabled`로 활성화한다. 이 기능에는 avahi-daemon 0.7 이상이 필요하다.

nvme-stas 3.0은 `/etc/stas/stafd.conf`와 `stacd.conf`를 `/etc/nvme/stafd.conf`, `/etc/nvme/stacd.conf`로 옮겼다. 컨트롤러 목록은 libnvme INI 형식의 `/etc/nvme/nvme-stas.conf`에 둔다. `sys.conf`와 `stasadm`은 삭제됐고 호스트 정체성은 `/etc/nvme/hostnqn`과 `hostid`에서 읽는다. 기본값이 yes인 `honor-fabric-zoning`이 2.x의 `disconnect-scope`와 `disconnect-trtypes`를 대체한다.

3.0부터 libnvme 소유권 레지스트리가 nvme-cli udev 자동 연결과 nvme-stas의 중복을 조정한다. 두 구성요소는 각각 자신이 만들지 않은 연결을 해제하지 않는다.

Dell SmartFabric Storage Software는 ESX의 VM으로 실행되는 CDC다. 문서상 호스트·서브시스템 NQN으로 존을 만들고 그 결과를 호스트에 알린다. 다만 확인된 자료는 2021년 출시 문서뿐이다.

{{% /details %}}

## 3. 경로를 모두 잃었을 때 대기 시간을 제한한다 {#3-모든-경로를-잃었을-때-io의-동작을-정한다}

RHEL 9·10과 SLES 15·16은 커널의 네이티브 NVMe 멀티패스를 사용합니다. RHEL은 NVMe/TCP에 DM-Multipath를 지원한 적이 없습니다. `nvme list-subsys`에서 경로를 확인할 수 있으며, 커널은 ANA(경로 접근 상태)가 optimized인 경로를 먼저 쓰고 없으면 non-optimized 경로를 선택합니다.

경로 선택 정책은 기본값인 `numa`와 `round-robin`, `queue-depth` 세 가지이며 모두 ANA 상태를 따릅니다. 서브시스템별 설정은 `/sys/class/nvme-subsystem/nvme-subsysN/iopolicy`에서 바꿉니다. 특정 모델에 계속 적용하려면 udev 규칙으로 고정합니다. 다만 사용할 수 있는 정책과 관측 항목은 커널 버전에 좌우됩니다.

| 기능 | 도입 | 6.12 LTS | 6.18 LTS |
|---|---|---|---|
| queue-depth 정책 | 6.11 | 있음 | 있음 |
| 경로별 `queue_depth`·`numa_nodes` | 6.15 | 없음 | 있음 |
| `multipath_always_on`, `delayed_removal_secs` | 6.16 | 없음 | 있음 |
| 장애 카운터(`multipath_failover_count` 등) | 7.2 | 없음 | 없음 |

업스트림 6.12 LTS에는 queue-depth 정책이 들어 있지만 경로별 정보와 지연 제거 기능은 6.18 LTS부터 사용할 수 있습니다. 두 LTS 모두 장애 카운터는 제공하지 않습니다. RHEL 10과 SLES 16의 6.12 계열 커널이 이 기능을 얼마나 백포트했는지는 확인하지 못했습니다.

사용 가능한 경로가 사라지면 커널은 각 컨트롤러의 상태와 failfast 만료 여부를 확인합니다. LIVE·RESETTING·CONNECTING 상태의 경로가 하나라도 남아 있고 failfast가 끝나지 않았다면 I/O를 큐에 보관합니다. 이 조건을 만족하지 못하면 I/O를 실패시킵니다. 다음 옵션이 재접속을 기다리는 시간과 실패 시점을 결정합니다.

| nvme-cli 옵션 | 커널 옵션 | 기본값 | 의미 |
|---|---|---|---|
| `--ctrl-loss-tmo` (`-l`) | `ctrl_loss_tmo` | 600초, 음수는 무한 | 컨트롤러를 잃은 뒤 재연결을 포기하기까지의 시간 |
| `--reconnect-delay` (`-c`) | `reconnect_delay` | 10초 | 재연결 시도 간격 |
| `--keep-alive-tmo` (`-k`) | `keep_alive_tmo` | I/O 컨트롤러 5초 | Keep Alive 타임아웃 |
| `--fast_io_fail_tmo` | `fast_io_fail_tmo` | -1 (꺼짐) | 재연결 중 I/O를 몇 초 뒤 실패시킬지 |
| — | `nvme_core.io_timeout` | 30초 | I/O 명령 타임아웃 |

`ctrl_loss_tmo=-1`을 주면 컨트롤러가 CONNECTING 상태에 남고 I/O가 실패하지 않은 채 쌓입니다. 이 글에서는 이를 dm-multipath의 `queue_if_no_path`와 같은 효과로 해석합니다. 무한 대기를 피하려면 `fast_io_fail_tmo`로 상한을 둡니다. 기본값 600초가 지나면 컨트롤러가 삭제되고 I/O가 실패합니다. SUSE 문서는 이때 파일시스템이 읽기 전용으로 바뀔 수 있다고 설명하며, NetApp의 TCP udev 규칙은 이를 피하려고 `ctrl_loss_tmo=-1`을 사용합니다.

`delayed_removal_secs`가 0보다 크면 마지막 경로가 사라져도 지정한 시간 동안 I/O를 보관합니다. FC에서 `no_path_retry`와 `queue_if_no_path`로 정하던 대기·실패 정책이 NVMe/TCP에서는 연결 옵션과 커널 옵션에 나뉜다고 볼 수 있습니다.

| FC SAN | Linux NVMe/TCP 대응 | 성숙도 |
|---|---|---|
| `multipath.conf` 정책, ALUA | iopolicy(numa·round-robin·queue-depth) + 서브시스템별 sysfs + udev 규칙, ANA(optimized·non-optimized·inaccessible·persistent-loss·change) | `✓` |
| `queue_if_no_path`·`no_path_retry`, `multipath -ll` | `ctrl_loss_tmo`(-1=무한), `fast_io_fail_tmo`, `delayed_removal_secs`(6.16) / `nvme list-subsys`, `nvme top`(3.1) | `✓` |

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 멀티패스 기본값 | `nvme_core.multipath` 기본 켜짐, 권한 0444. 확인 `cat /sys/module/nvme_core/parameters/multipath` | 커널 multipath.c v7.3, NetApp SLES 16 문서 | `✓` |
| DM-Multipath | RHEL 9·10은 NVMe/TCP에서 지원된 적 없음. RHEL 10은 RDMA·FC도 미지원. SLES는 DM 기반이 아님 | RHEL 9·10 문서, SLES 15 SP7 문서 | `✓` |
| ANA·경로 선택 | 상태 5종, optimized 우선, ANATT 두 배 초과 시 리셋 | 커널 multipath.c v7.3, 커널 admin-guide | `✓` |
| iopolicy | numa(기본)·round-robin·queue-depth. 전역 `/sys/module/nvme_core/parameters/iopolicy`, 서브시스템별 sysfs | 커널 admin-guide, sysfs.c | `✓` |
| 도입 버전 | queue-depth 6.11, 경로별 `queue_depth`·`numa_nodes` 6.15(이전 보고서의 6.14 정정), `multipath_always_on`·`delayed_removal_secs` 6.16, 카운터 7.2. v5.14~v7.3 태그 대조 | 커널 `drivers/nvme/host/` 태그 대조 | `✓` |
| I/O 보관·실패 판단 | LIVE·RESETTING·CONNECTING이고 failfast 미만료면 보관, 아니면 즉시 실패 | 커널 multipath.c v7.3 | `✓` |
| 파라미터 기본값 | `ctrl_loss_tmo` 600초, `reconnect_delay` 10초, I/O 컨트롤러 `keep_alive_tmo` 5초, `fast_io_fail_tmo` -1, `nr_io_queues` 온라인 CPU 수, `queue_size` 128, `io_timeout` 30초, `admin_timeout` 60초. 커널 v7.3, 옵션 이름은 nvme-cli v3.1 문서 | 커널 fabrics.c·core.c, nvme-cli fabrics-options | `✓` |
| 운영 결론 셋 | `-1`은 `queue_if_no_path`와 같은 효과, `fast_io_fail_tmo`로 상한 | 보고서 해석 | `≈` |

`nvme_core.multipath`는 런타임에 변경할 수 없으므로 비활성화하려면 부팅 파라미터를 사용해야 한다. ANA는 `optimized`, `non-optimized`, `inaccessible`, `persistent-loss`, `change` 다섯 상태를 갖는다. 컨트롤러가 알린 ANATT의 두 배가 지나도록 `change`가 해소되지 않으면 커널이 컨트롤러를 리셋한다.

`nvme list-subsys` 출력에는 각 경로의 전송, 주소, 상태(`live`), ANA 상태가 나온다. 컨트롤러별 정보는 `/sys/class/nvme/nvmeX/state`, `transport`, `address`에서 읽는다. 수동 제어 인터페이스는 `reset_controller`, `rescan_controller`, `delete_controller`다. nvme-cli 3.1의 `nvme top`은 서브시스템·경로·컨트롤러 통계를 실시간으로 보여 준다.

I/O를 보관할 때는 "no usable path - requeuing I/O", 실패시킬 때는 "no available path - failing I/O", ANA 시간이 초과되면 "ANATT timeout, resetting controller." 로그가 남는다. 이 문구들은 경보 규칙에 활용할 수 있다. failfast가 만료된 컨트롤러는 "available"로 세지 않는다.

`--hdr-digest`와 `--data-digest`로 설정하는 헤더·데이터 디지스트는 기본값이 꺼짐이다.

{{% /details %}}

## 4. 인증과 TLS 키의 수명주기를 관리한다 {#4-인증과-tls는-키-저장과-업그레이드까지-확인한다}

RHEL 9·10이 문서화한 인밴드 DH-HMAC-CHAP 인증은 NVMe/TCP에서만 지원하며 RDMA와 FC에는 적용되지 않습니다. 키는 `nvme gen-dhchap-key -n ${HOSTNQN}`으로 만들고 `--dhchap-secret`, `--dhchap-ctrl-secret` 옵션으로 연결합니다. 업스트림 nvme-cli 3.0은 명칭을 KX-HMAC-CHAP으로 바꾸면서 생성 명령을 `nvme keys gen-kxchap-secret`, 연결 옵션을 `--kxchap-secret`으로 변경했습니다. 기존 이름은 deprecated 상태로 남아 있습니다.

커널 키링 `.nvme`의 내용은 재부팅하면 사라집니다. nvme-cli가 키 내보내기와 부팅 시 가져오기 기능을 제공하는 이유입니다. 아래는 RHEL 9·10의 연결 절차이며, 두 버전 모두 NVMe/TCP TLS와 kTLS를 Technology Preview로 분류합니다.

```
HOSTNQN=$(nvme show-hostnqn)
PSK=$(nvme gen-tls-key)
nvme check-tls-key --insert --hostnqn=${HOSTNQN} --subsysnqn=${SUBSYSTEM} --keydata=${PSK} --identity=1
# /etc/tlshd.conf 의 [authenticate] 에 keyring=.nvme 추가
systemctl restart tlshd
nvme connect -t tcp --tls -a ${TRADDR} -s 4420 -n ${SUBSYSTEM}
```

RHEL 10.2는 표준에 맞게 키 유도 방식을 바꿨습니다. 릴리스 노트는 nvme-cli 2.16 미만과 libnvme 1.16 미만에서 만든 PSK(사전 공유 키)를 새 버전이 가져오지 못할 수 있다고 설명합니다. 연결에 실패하면 `--compat`로 키를 불러오거나 벤더 구현에 맞춰 PSK를 다시 배포해야 합니다.

타깃 쪽에서는 커널 nvmet가 포트별 TLS를 설정하고 SPDK는 실험적 TLS 리스너와 호스트별 PSK를 사용합니다. 인증 결과에서 TLS PSK를 만드는 secure concatenation은 관리 큐에 TLS를 적용합니다. 커널 코드에는 I/O 큐를 지원하지 않는다는 메시지가 남아 있습니다.

| FC SAN | Linux NVMe/TCP 대응 | 성숙도 |
|---|---|---|
| FC-SP 인증, 링크 암호화(FC는 보통 안 함) | DH-HMAC-CHAP(KX-HMAC-CHAP), NVMe/TCP 전용(RHEL 기준) / TLS 1.3 + tlshd, RHEL은 Technology Preview | `✓` |
| HBA 펌웨어·드라이버 호환표 | 커널 + nvme-cli + 어레이 펌웨어 조합. TLS PSK 유도 변경처럼 userspace 업그레이드가 연결을 끊을 수 있음 | `✓` |

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| DH-HMAC-CHAP 커널 | 호스트·타깃 옵션 모두 6.0. 컨트롤러 sysfs `dhchap_secret`·`dhchap_ctrl_secret` | 커널 fabrics.c·sysfs.c·target configfs.c | `✓` |
| RHEL 절차 | `nvme gen-dhchap-key -n`, `--dhchap-secret`, `--dhchap-ctrl-secret`. NVMe/TCP 전용 | RHEL 9·10 문서 | `✓` |
| KX-HMAC-CHAP 개명 | nvme-cli 3.0, "TP4201에 맞춘다". INI 키 `kxchap-secret`, nvme-stas 키도 개명. 비밀은 INI에 평문 | nvme-cli NEWS.md, INI 설계 문서, nvme-stas NEWS.md | `✓`, TP4201 내용 `?` |
| TLS 커널 | 6.7에 `tls`·`tls_key`·`keyring`, `tls_handshake_timeout` 기본 10초, 타깃 `NVME_TARGET_TCP_TLS` | 커널 fabrics.c·tcp.c, target Kconfig | `✓` |
| 키 영속화 | `nvme keys export --keyfile /etc/nvme/tls-keys`, `70-nvmf-keys.rules`가 `nvme keys import` 실행 | nvme-cli v3.1 문서·nvmf-autoconnect | `✓` |
| PSK 유도 변경 | RHEL 10.2, nvme-cli 2.16 미만·libnvme 1.16 미만에서 만든 PSK 영향. `--compat` 또는 재배포. libnvme 1.15·1.16 노트의 HKDF·PSK 유도 수정과 같은 변경 | RHEL 10.2 릴리스 노트, libnvme releases | `✓` |
| secure concatenation | 6.15, I/O 큐 미지원 메시지 | 커널 auth.c v7.3 | `✓` |
| 배포판 TLS | RHEL 9·10 NVMe/TCP TLS와 kTLS는 Technology Preview. SLES 16은 TLS 1.3 절차 | RHEL 문서·릴리스 노트, NetApp SLES 16 문서 | `✓`, SLES `Ⓥ` |

커널 6.0은 호스트 옵션 `dhchap_secret`, `dhchap_ctrl_secret`과 타깃 옵션 `dhchap_key`, `dhchap_ctrl_key`, `dhchap_hash`, `dhchap_dhgroup`을 함께 도입했다. 7.3에서도 커널 옵션 이름은 `dhchap_secret`이다. TP4201의 내용은 확인하지 못했으므로 KX-HMAC-CHAP은 명칭 변경으로만 설명한다.

커널 6.7부터 tlshd와 kTLS를 이용한 TLS 구성을 지원한다. 핸드셰이크 처리는 netlink를 통해 사용자 공간의 tlshd로 넘긴다.

nvmet의 호스트별 인증 항목은 `hosts/<hostnqn>/dhchap_key`, `dhchap_ctrl_key`, `dhchap_hash`, `dhchap_dhgroup`이다. 포트별 TLS는 `addr_tsas`에 `tls1.3`을 지정해 켠다. 키링이 없으면 "TLS keyring not configured"로 연결을 거부하고, TLS가 활성화되면 `addr_treq` 기본값은 `required`로 바뀐다.

SPDK의 실험적 TLS는 `--secure-channel` 리스너와 `nvmf_subsystem_add_host --psk`로 구성한다. 이 설정은 `--allow-any-host`와 함께 사용할 수 없다. DH-HMAC-CHAP은 `nvmf_subsystem_add_host --dhchap-key --dhchap-ctrlr-key`로 지정한다.

{{% /details %}}

## 아직 확인할 항목 {#확인하지-못한-것}

- RHEL 10과 SLES 16의 6.12 계열 커널이 6.14~7.2의 NVMe 기능을 어느 범위까지 백포트했는지는 배포판 커널 소스를 더 대조해야 한다.
- 동일 장비에서 NVMe/TCP의 TLS·디지스트 비용을 측정한 중립 벤치마크는 찾지 못했다. 확인된 자료는 벤더 주장과 정성적 보고뿐이다.
- 오픈소스 CDC 구현과 Dell SFSS의 2026년 운영 상태는 확인하지 못해 CDC 기반 존을 개념 수준으로만 설명했다.
- Ubuntu 26.04의 NVMe/TCP 부팅 지원 범위와 Ubuntu·Debian 커널의 `CONFIG_NVME_TCP_TLS` 설정은 확인이 남았다.
- TP4201의 구체적인 내용, KX-HMAC-CHAP 개명이 프로토콜 동작에 미치는 영향, nvmetcli의 인증·TLS·ANA 설정 저장 범위는 확인하지 못했다.
- NVMe/TCP 전용 MTU와 NIC 큐 권고는 1차 문서에서 찾지 못했다. nvme-cli 3.2의 `nvme-discoverd` 등은 아직 출시 전이므로 예정 기능으로만 다뤘다.

## 참고 자료

- [kernel.org finger_banner](https://www.kernel.org/finger_banner) · [nvme-cli releases](https://github.com/linux-nvme/nvme-cli/releases) · [NEWS.md](https://github.com/linux-nvme/nvme-cli/blob/master/NEWS.md) · [libnvme releases](https://github.com/linux-nvme/libnvme/releases) — 현재 stable·longterm 커널 버전, 3.0·3.1 변경, 3.2 예정, 1.15·1.16 TLS·PSK 유도 수정
- [nvme-stas README](https://github.com/linux-nvme/nvme-stas) · [NEWS.md](https://github.com/linux-nvme/nvme-stas/blob/main/NEWS.md) · [DISTROS.md](https://github.com/linux-nvme/nvme-stas/blob/main/DISTROS.md) · [설정 예시](https://github.com/linux-nvme/nvme-stas/tree/main/etc/nvme) · [nvme-cli INI 설정 설계 문서](https://github.com/linux-nvme/nvme-cli/blob/master/libnvme/design/CONFIG.md) — stafd·stacd 역할, 3.0 경로 변경, 3.x 설정 형식, hostid 경고
- [nvme-cli v3.1 fabrics-options](https://github.com/linux-nvme/nvme-cli/blob/v3.1/Documentation/fabrics-options.txt) · [v3.1 문서](https://github.com/linux-nvme/nvme-cli/tree/v3.1/Documentation) · [v3.1 nvmf-autoconnect](https://github.com/linux-nvme/nvme-cli/tree/v3.1/nvmf-autoconnect) — 연결 옵션, 키 명령, systemd·udev 규칙
- [Linux drivers/nvme/host (v7.3)](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/nvme/host?h=v7.3) · [multipath.c](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/nvme/host/multipath.c?h=v7.3) · [sysfs.c](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/nvme/host/sysfs.c?h=v7.3) · [tcp.c](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/nvme/host/tcp.c?h=v7.3) · [core.c](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/nvme/host/core.c?h=v7.3) · [auth.c](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/nvme/host/auth.c?h=v7.3) — 도입 버전, 기본값, sysfs
- [Linux target configfs.c](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/nvme/target/configfs.c?h=v7.3) · [Linux admin-guide NVMe multipath](https://docs.kernel.org/admin-guide/nvme-multipath.html) — nvmet configfs 구조, 인증·TLS 키, iopolicy
- [Ubuntu archive madison](https://people.canonical.com/~ubuntu-archive/madison.cgi) · [Debian madison](https://qa.debian.org/madison.php) · [CentOS Stream 10 BaseOS](https://mirror.stream.centos.org/10-stream/BaseOS/x86_64/os/Packages/) · [AlmaLinux 10 BaseOS](https://repo.almalinux.org/almalinux/10/BaseOS/x86_64/os/Packages/) — 배포판별 패키지 버전
- [RHEL 10 NVMe/TCP 구성](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/managing_storage_devices/configuring-nvme-over-fabrics-using-nvme-tcp) · [RHEL 9 같은 장](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_storage_devices/configuring-nvme-over-fabrics-using-nvme-tcp_managing-storage-devices) · [RHEL 10.2 Release Notes, Technology Preview](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/10.2_release_notes/technology-preview-features) · [RHEL 9.4 Release Notes](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/9.4_release_notes/technology-previews) — 연결, 인증, TLS 절차, TLS 기술 프리뷰, PSK 유도 변경, 부팅
- [SLES 15 SP7 NVMe-oF](https://documentation.suse.com/sles/15-SP7/html/SLES-all/cha-nvmeof.html) · [SUSE OBS, nvme-stas (SLE-15-SP7)](https://build-test-1.opensuse.org/package/show/SUSE:SLE-15-SP7:Update/nvme-stas) — 멀티패스, 타깃 구성, NBFT, SLES 15 SP7 nvme-stas 버전
- [NetApp, Configure SLES 16 for NVMe-oF with ONTAP](https://docs.netapp.com/us-en/ontap-sanhost/nvme-sles16-spx.html) — udev 정책, PDC, `disconnect-all` 주의
- [SPDK NVMe-oF Target](https://github.com/spdk/spdk/blob/master/doc/nvmf.md) · [nvmetcli(8)](https://manpages.debian.org/testing/nvmetcli/nvmetcli.8.en.html) — SPDK RPC 순서, nvmetcli 저장·복원
- [Ubuntu Discourse, NVMe/TCP PoC 24.10](https://discourse.ubuntu.com/t/introducing-the-nvme-tcp-poc-with-ubuntu-server-24-10/48620) · [Phoronix, Ubuntu 24.04 NVMe-over-TCP 설치](https://www.phoronix.com/news/Ubuntu-Install-NVMe-Over-TCP) — Ubuntu 부팅 지원
- [WWT, PowerStore 2.1 NVMe over TCP & SmartFabric Storage Software](https://www.wwt.com/blog/powerstore-2-1-nvme-over-tcp-smartfabric-storage-software) — Dell SFSS CDC
