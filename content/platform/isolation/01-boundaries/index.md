---
title: "경계와 위협 모델"
linkTitle: "01 경계와 위협 모델"
weight: 1
date: 2026-09-14
lastmod: 2026-09-14
aliases: ["/isolation/01-kata-kubevirt/"]
url: "/isolation/01-boundaries/"
---

# 01 · 경계와 위협 모델 — 세 물건은 경계를 어디에 긋고, 그 경계는 무엇을 막나

{{< callout type="info" >}}
- **Kata는 공유 커널이라는 단일 실패점을 지운다** — 그 대신 2026년 한 해에만 Kata 자신의 guest-to-host 취약점 advisory가 10건 나왔고 `✓`, 16년 묵은 KVM 탈출 Januscape(CVE-2026-53359)가 Intel·AMD 양쪽에서 공개됐다 `Ⓥ`. 경계는 두껍지만 무한하지 않다.
- **Kata와 KubeVirt는 대체재가 아니다** — KubeVirt FAQ에 그 차이가 직접 적혀 있다. "Kata containers are containers inside virtual machines. KubeVirt is a virtual machine inside a container." `✓`
- **성능 수치는 05에, 판단표는 06에 있다** — 실측은 [05 성능 실측]({{< relref "/platform/isolation/05-performance/index.md" >}})에, 시나리오별 선택은 [06 판단]({{< relref "/platform/isolation/06-decision/index.md" >}})에 정리했다.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

AI 에이전트가 사용자 코드를 그 자리에서 실행한다면, 그 코드가 컨테이너를 벗어났을 때 어디까지 닿을 수 있는지 따져야 합니다. 2025년 11월 5일 공개된 runc 취약점 세 건(CVE-2025-31133·52565·52881)은 컨테이너 런타임의 버그가 호스트 침해로 이어질 수 있음을 보여줍니다. 파드 사이의 구분만으로 충분한지, 호스트 앞에 별도 경계가 필요한지 판단해야 하는 이유입니다.

VM을 Kubernetes로 가져오려는 수요도 겹칩니다. Broadcom의 VMware 인수 이후 라이선스 갱신가 상승으로 VM 워크로드의 이전을 검토하는 조직이 늘었습니다. 2026년 들어 클라우드 벤더들이 가상 인스턴스에서도 중첩 가상화를 열면서 Kata·KubeVirt를 도입할 수 있는 인스턴스 선택지도 넓어졌습니다. 다만 컨테이너의 격리를 강화하는 일과 기존 VM을 운영하는 일은 요구하는 인터페이스부터 다릅니다.

자매 문서: 파드 아래 VM의 구성과 운영 비용은 [02 Kata Containers]({{< relref "/platform/isolation/02-kata/index.md" >}})에서, VM을 Kubernetes 객체로 운영할 때의 계약은 [04 KubeVirt]({{< relref "/platform/isolation/04-kubevirt/index.md" >}})에서 다룹니다.

## 1. 실행 경계와 사용자가 보는 객체

runc로 실행한 컨테이너는 namespace와 cgroup으로 프로세스를 가리고 나누면서 호스트 커널을 공유합니다. gVisor와 Kata는 애플리케이션이 이 커널에 닿는 경로를 바꿉니다.

gVisor에서는 **Sentry**라는 유저스페이스 프로세스가 리눅스 syscall ABI의 상당 부분을 다시 구현합니다. 애플리케이션의 syscall을 가로채고, 호스트 커널에는 좁혀진 syscall만 전달합니다. 파일 접근은 별도 **Gofer** 프로세스가 대리합니다. syscall을 가로채는 방식(플랫폼)은 ptrace·KVM·systrap 셋이고, systrap은 2023-04-28에 발표돼 이후 기본 플랫폼이 됐습니다.

Kata는 파드마다 경량 VM을 세웁니다. 실제 게스트 커널과 Rust로 쓰인 kata-agent가 그 안에서 돌고, VMM은 QEMU·Cloud Hypervisor·Firecracker·Dragonball·StratoVirt 중에서 고릅니다. 아래 도식은 runc·gVisor·Kata의 실행 경로에서 호스트 커널 앞에 어떤 경계가 놓이는지 보여줍니다.

{{< flow src="_flow/1-세-경로.json" />}}

도식의 실행 경계와 별개로, 사용자가 다루는 객체도 비교해야 합니다. KubeVirt는 VM을 1급 객체로 노출하며, VM은 virt-launcher 파드 안에서 libvirt와 QEMU 프로세스로 실행됩니다. 파드를 사용하는 다른 접근과는 아티팩트·접속·마이그레이션 방식이 달라집니다.

| 축 | runc | gVisor | Kata | KubeVirt |
|---|---|---|---|---|
| 사용자가 보는 객체 | Pod | Pod | Pod | VirtualMachine |
| 아티팩트 | OCI 이미지 | OCI 이미지 | OCI 이미지 | qcow2/raw 디스크 이미지 `✓` |
| 게스트 커널 | 없음(호스트 공유) | 없음(유저스페이스로 재구현) | Kata가 제공하는 축소 커널 `✓` | 사용자 게스트 OS의 커널 `Σ` |
| 진입 방식 | `kubectl exec` | `kubectl exec`(정상 동작) `≈` | `kubectl exec` `≈` | `virtctl console`/`vnc`/SSH `✓` |
| 선택 방법 | 기본 런타임 | RuntimeClass(`runsc`) `✓` | RuntimeClass `≈` | 별도 CRD |
| 마이그레이션 | 없음 | 없음 | 없음 `≈` | VirtualMachineInstanceMigration `✓` |

Kata 내부는 호스트, VM root(게스트 이미지), VM container(사용자 OCI rootfs) 셋으로 나뉩니다. 게스트 안에서도 cgroup과 namespace가 워크로드를 VM 환경에서 한 번 더 떼어 놓습니다. 기존 namespace 격리에 하드웨어 가상화 경계를 더하는 구조입니다 `Σ`. AKS 문서는 호스트 컴포넌트를 Kata shim·Cloud Hypervisor·virtiofsd로, 게스트 컴포넌트를 사용자 워크로드·pod VM 커널·kata-agent로 나눕니다 `✓`. 이 구분은 `overhead` 필드를 얼마로 잡을지 정하는 근거가 됩니다.

Kata와 KubeVirt는 KVM/QEMU라는 부품을 공유하지만 출발점이 다릅니다. Kata는 이미 컨테이너화된 애플리케이션의 격리 수준을 높이고, KubeVirt는 컨테이너화되지 않은 애플리케이션을 VM으로 운영하는 데서 출발합니다. Josh Berkus와 Stephen Gordon은 2018년에 이 차이를 다음과 같이 설명했습니다.

> It seems unlikely that the two fundamentally different approaches can ever be reconciled. KubeVirt aims to provide as much VM functionality as possible, while Kata Containers tries to provide a container-like experience for VMs.
>
> — 출처: Josh Berkus, Stephen Gordon, Superuser (2018-03-20)

## 2. 공유 커널 공격은 어디서 멈추나

runc 아래에서 호스트 커널 버그를 이용해 root를 얻는 공격은 Kata 아래에서는 게스트 커널을 겨냥하게 됩니다. VM 경계가 유지된다면 공격은 게스트 안에서 멈춥니다. 대신 다음 공격 표면이 남습니다.

- 하이퍼바이저·KVM 자체의 버그
- virtio 장치 에뮬레이션 표면(virtio-blk, virtio-net, virtio-snd, virtio-pmem, virtiofsd)
- kata-agent의 ttRPC API
- 호스트 쪽 shim과 그것이 신뢰하는 pod annotation

이 경로의 취약점은 다시 호스트 root 탈취로 이어질 수 있습니다. Kata의 격리 효과는 호스트 탈출에 필요한 버그의 범위를 리눅스 커널 전체에서 하이퍼바이저·virtio·agent·shim으로 좁히는 데 있습니다 `Σ`.

알려진 컨테이너 탈출 CVE를 이 구조에 대입하면 다음과 같습니다. 표의 "봉쇄" 판정은 전부 아키텍처 추론입니다. 각 CVE를 Kata 위에서 실제로 재현해 막혔다고 보고한 1차 문서는 찾지 못했습니다.

| CVE | 대상 | CVSS | Kata 봉쇄? |
|---|---|---|---|
| CVE-2019-5736 | runc ≤1.0-rc6, `/proc/self/exe` 덮어쓰기 | 8.6 `✓` | 봉쇄 `≈` |
| CVE-2024-21626 | runc ≤1.1.11, fd 누수(Leaky Vessels) | 8.6 `✓` | 봉쇄 `≈` |
| CVE-2024-23651/52/53 | BuildKit | 8.7/10.0/9.8 `✓` | 해당 없음(빌드 데몬 문제) `≈` |
| CVE-2022-0847 | Linux ≥5.8, Dirty Pipe | 7.8 `✓` | 봉쇄(게스트 커널까지) `≈` |
| CVE-2022-0185 | Linux ≥5.1-rc1, fs_context 힙 오버플로 | 7.8 `✓` | 봉쇄 `≈` |
| CVE-2024-1086 | Linux 3.15–6.8-rc1, nf_tables UAF | 7.8 `✓` | 봉쇄 `≈` |
| CVE-2022-0492 | cgroups v1 release_agent | 7.8 `✓` | 봉쇄 `≈` |
| CVE-2025-31133 | runc ≤1.2.7/1.3.2, maskedPaths 심볼릭 링크 | 7.3(CVSS4) `✓` | 봉쇄 `≈` |
| CVE-2025-52565 | runc, `/dev/console` 바인드마운트 | 7.5/8.4 `✓` | 봉쇄 `≈` |
| CVE-2025-52881 | runc, procfs 쓰기 가젯·LSM 우회 | `✓` | 봉쇄 `≈` |

표의 마지막 runc 세 건은 모두 호스트의 runc가 컨테이너를 대신해 호스트 mount·procfs 상태를 조작하다 생긴 버그입니다. Kata에서는 그 조작이 게스트 커널 안에서 일어나므로 같은 실수가 호스트에 닿지 않을 것으로 봅니다. 이처럼 조작이 일어나는 경계를 옮기는 효과를 보여준다는 점에서, 2025년 11월 5일 하루에 나온 이 세 건은 Kata 도입 논거로 특히 쓸 만합니다. 다만 kata-agent도 게스트 안에서 비슷한 mount 작업을 합니다. agent에 같은 꼴의 버그가 생기면 게스트 root까지는 갈 수 있습니다 `≈`.

## 3. Kata 자체에서 확인된 취약점

Kata의 GitHub security advisory에는 2026년에 공개된 취약점이 10건 있습니다 `✓`. 게스트 내부 권한 상승부터 호스트 경로 노출과 VM 탈출까지, 영향을 받는 경계가 서로 다릅니다.

| GHSA | 제목 | 심각도 | 날짜 |
|---|---|---|---|
| GHSA-5fc8-gg7w-3g5c | 이미지가 malformed거나 레이어가 없으면 호스트 블록 장치가 VM에 hotplug됨 | Critical | 2026-01-29 |
| GHSA-wwj6-vghv-5p64 | 컨테이너 → 게스트 마이크로 VM 권한 상승 | Critical | 2026-02-19 |
| GHSA-q49m-57vm-c8cc | 심볼릭 링크로 CopyFile 정책 무력화 | Critical | 2026-04-22 |
| GHSA-rr59-xxvx-96qr | 기본 활성 pod annotation으로 virtiofsd 인자 주입 → VM 탈출 | Moderate | 2026-05-20 |
| GHSA-2gv2-cffp-j227 | runtime-rs: virtiofs 경유 게스트 root → 호스트 root 탈출 | Critical | 2026-05-21 |
| GHSA-mp2j-xm59-qfgw | config path annotation 임의 파일 로딩 | Critical | 2026-07-20 |
| GHSA-fgm4-mv68-h344 | Dragonball virtio-blk 길이 검증 누락 → 게스트-호스트 VM 탈출 | High | 2026-07-21 |
| GHSA-h8jv-63p2-496x | kata-agent mem-agent ttRPC가 agent-policy 적용 밖 | Moderate | 2026-07-21 |
| GHSA-7fhf-v3p3-rp56 | 신뢰되지 않은 annotation으로 임의 호스트 경로 바인드마운트 | High | 2026-07-21 |
| GHSA-fmg6-v47x-52wr | 생성된 정책이 공격자 선택 게스트 경로 마운트를 허용 | High | 2026-08-20 |

10건 중 3건이 annotation 경유입니다. pod annotation을 신뢰하는 설계가 반복해서 문제를 냅니다 `Σ`.

호스트 탈출의 조건이 구체적으로 드러난 사례는 `GHSA-2gv2-cffp-j227`입니다. virtiofsd가 `--sandbox none --seccomp none`으로 돌 때 게스트가 절대 호스트 경로를 담은 FUSE 요청을 보내 `/etc/cron.d`에 파일을 심는 방식이었고, runtime-rs 3.31.0에서 수정됐습니다.

`GHSA-wwj6-vghv-5p64`는 공격이 게스트 root에서 멈춘 사례입니다. virtio-pmem DAX 매핑으로 읽기 전용 게스트 이미지를 덮어써 컨테이너에서 게스트로 권한을 높였지만, 호스트까지 탈출하지는 못했습니다. 같은 Kata 취약점이라도 어느 경계가 무너졌는지를 나눠 읽어야 합니다.

게스트 내부의 방어 설정도 확인해야 합니다. Kata의 `disable_guest_seccomp`는 기본값이 `true`여서 컨테이너 seccomp 프로필이 게스트로 전달되지 않습니다 `✓`. 게스트에서 컨테이너 seccomp 프로필을 적용하려면 이 기본 설정을 바꿔야 합니다.

## 4. 하이퍼바이저도 탈출 경로가 된다

하이퍼바이저 경계가 뚫린 사례로는 **CVE-2026-53359, 통칭 "Januscape"**가 있습니다. KVM x86 shadow MMU의 use-after-free로, 악의적 게스트가 KVM이 이미 해제한 메모리를 가리키는 stale reverse-map 항목을 만들도록 유도합니다 `Ⓥ`. 약 16년간 잠복했고 Google kvmCTF에 제로데이로 제출됐으며, 업스트림 커밋이 2026년 6월 메인라인에 들어가고 7월에 공개됐습니다. 보도상 Intel과 AMD 양쪽에서 동작하는 최초의 공개 KVM 탈출입니다 `Ⓥ`.

장치 에뮬레이션에도 선례가 있습니다. VENOM(CVE-2015-3456)은 QEMU 플로피 컨트롤러 에뮬레이션의 버퍼 오버플로입니다 `✓`. virtio-snd 힙 오버플로(CVE-2024-7730)가 완전한 게스트→호스트 탈출 체인 연구로 이어진 사례도 있습니다 `Ⓥ`.

이 사례들은 VM 경계만으로 탈출 불가능을 보장할 수 없음을 보여줍니다. Kata 도입의 보안상 이득은 탈출에 필요한 버그 클래스가 더 좁고 희소해진다는 판단에 두어야 합니다 `Σ`.

## 5. gVisor의 보안 실적을 읽는 조건

gVisor 보안 페이지는 목표를 "Sentry와 기존 리눅스 하드닝(seccomp-bpf, `pivot_root`, namespace)의 2중 구조로 호스트 커널 공격 표면을 줄이는 것"이라 밝힙니다. 샌드박스 **내부**에 머무는 권한 상승이나 DoS는 CVE 대상에서 명시적으로 제외합니다 `✓`. 이 기준에서 호스트 커널 임의 코드 실행에 이르는 완전 탈출 CVE는 확인되지 않습니다(부재 확인 `✓`).

그렇다고 경계 침해 사례가 없는 것은 아닙니다. CVE-2018-16359는 seccomp 샌드박스 안에서 `renameat`으로 호스트 파일명을 바꾼 실제 경계 탈출 사례입니다. CVE-2024-10603·CVE-2024-10026은 netstack의 예측 가능한 포트·헤더 값과 약한 해시에 관한 취약점이고, CVE-2025-2713은 `runsc`가 첫 fork 전까지 root 유사 권한으로 실행돼 생긴 로컬 권한 상승입니다.

호스트 커널의 기능을 그대로 노출하지 않아 공격을 피한 경우도 있습니다. CVE-2020-14386(리눅스 패킷 링 버퍼 오버플로)은 gVisor가 `PACKET_RX_RING`을 구현하지 않고 raw socket을 기본 차단해 영향받지 않았습니다. gVisor는 amd64 기준 351개 syscall 중 277개를 완전 또는 부분 구현합니다 `✓`. 이 구현 범위가 만드는 호환성과 성능의 제약은 [03 gVisor]({{< relref "/platform/isolation/03-gvisor/index.md" >}})에서 이어집니다.

## 6. 호스트도 신뢰하지 않는다면: Confidential Containers

Kata가 워크로드로부터 호스트를 지킨다면, Confidential Containers(CoCo)는 호스트로부터 워크로드를 지킵니다. 지원 TEE는 Intel TDX, AMD SEV/SEV-ES, IBM Secure Execution, Arm CCA입니다 `Ⓥ`.

어테스테이션 스택은 **Trustee**로 묶입니다. KBS가 게스트와 대화하며 조건부로 비밀을 풀고, Attestation Service가 하드웨어 증거를 검증하며, RVPS가 기준 측정값을 보관합니다. 게스트 안에서는 Attestation Agent가 증거를 만들고, Confidential Data Hub가 검증 후 비밀을 가져와 캐시합니다 `✓`.

**peer pods**(cloud-api-adaptor) 구성은 베어메탈이나 중첩 가상화를 제공하지 않는 클라우드에서도 사용할 수 있습니다. 로컬 하이퍼바이저 대신 클라우드 제공자의 VM API를 호출해 기밀 게스트를 원격 생성하므로 워커 노드에 KVM이 없어도 됩니다 `✓`.

이 보호도 어테스테이션 체인의 구현에 의존합니다. `GHSA-989w-4xr2-ww9m`은 악의적 호스트가 I/O를 선택적으로 실패시켜 initdata 검증을 건너뛰게 만드는 TDX 대상 취약점입니다 `Ⓥ`.

## 7. 프로젝트 소속과 도입 근거의 확인 범위

CoCo는 2026-07-22에 CNCF Sandbox에서 Incubating으로 승격됐습니다 `✓`. Kata는 OpenInfra Foundation 산하이고, OpenInfra는 2025-07-23에 Linux Foundation 합류를 완료했습니다. Kata가 CNCF로 옮긴 것은 아닙니다. CNCF Incubating이 된 프로젝트는 CoCo이며, 둘을 혼동한 2차 자료는 구분해서 읽어야 합니다 `✓`.

Kata의 활동 지표로는 kata-containers/kata-containers 저장소의 별 약 8.7k, 컨트리뷰터 545명이 관측됐습니다 `≈`. 3.30.0 릴리스 하나에 1,571 커밋, 16명 기여(그중 신규 3명)가 들어갔습니다 `✓`.

프로덕션 사용처는 확인 범위가 더 좁습니다. Baidu·Huawei·IBM Cloud Code Engine의 Kata 사용은 검색 결과에 등장하지만, 1차 출처를 찾지 못해 이 글의 도입 근거에는 반영하지 않았습니다 `?`.

## 참고 자료

- [Explore KubeVirt and Kata Containers](https://superuser.openinfra.org/articles/kubevirt-kata-containers-vm-use-case/) — Josh Berkus, Stephen Gordon, Superuser, 2018-03-20
- [KubeVirt FAQ.md](https://github.com/kubevirt/kubevirt/blob/main/FAQ.md) — Kata 비교 공식 입장

- [Kata Containers security advisories](https://github.com/kata-containers/kata-containers/security/advisories) — 2026년 advisory 10건
- [GHSA-2gv2-cffp-j227](https://github.com/kata-containers/kata-containers/security/advisories/GHSA-2gv2-cffp-j227) — virtiofsd 경유 탈출
- [GHSA-wwj6-vghv-5p64](https://github.com/kata-containers/kata-containers/security/advisories/GHSA-wwj6-vghv-5p64) — 부분 봉쇄 사례

- [Januscape CVE-2026-53359 (The Hacker News)](https://thehackernews.com/2026/07/16-year-old-linux-kvm-flaw-lets-guest.html) — 2026년 7월
- [VENOM CVE-2015-3456 (Red Hat)](https://access.redhat.com/security/cve/cve-2015-3456)
- [GHSA-4fj4-9m67-3mj3 (CVE-2025-2713)](https://github.com/advisories/GHSA-4fj4-9m67-3mj3) — 2025-03-28
- [GHSA-9493-h29p-rfm2 (CVE-2025-31133)](https://github.com/opencontainers/runc/security/advisories/GHSA-9493-h29p-rfm2) — 2025-11-05
- [CNCF, runc 탈출 취약점 기술 개요](https://www.cncf.io/blog/2025/11/28/runc-container-breakout-vulnerabilities-a-technical-overview/)

- [Confidential Containers 설계 개요](https://confidentialcontainers.org/docs/architecture/design-overview/)
- [CoCo CNCF Incubating 승격](https://www.cncf.io/blog/2026/07/22/confidential-containers-becomes-a-cncf-incubating-project/) — 2026-07-22
