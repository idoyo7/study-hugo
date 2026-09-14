---
title: "Kata · KubeVirt · gVisor"
linkTitle: "01 Kata · KubeVirt · gVisor"
weight: 1
date: 2026-09-14
lastmod: 2026-09-14
---

# 01 · Kata · KubeVirt · gVisor — 컨테이너 아래 VM을 한 겹 더 깔면 무엇을 얻고 무엇을 내주나

{{< callout type="info" >}}
- **CPU·메모리 대역폭은 셋 다 오차범위 3% 안이다** — 2026년 K8s 실측에서 sysbench CPU가 runc 2,258 · Kata Cloud Hypervisor 2,197(−2.7%) · gVisor 2,220(−1.7%) events/s로 나온다 `Ⓑ`. 여기서는 격리가 사실상 공짜다.
- **랜덤 4K IO에서는 정반대다** — 같은 측정에서 Kata는 −99%, gVisor는 −76% 떨어진다 `Ⓑ`. HTTP 처리량도 Kata −89%, gVisor −42%로 갈린다. 비용은 연산이 아니라 경계를 건너는 횟수에 붙는다.
- **메모리 오버헤드는 VM 크기와 무관한 상수다** — VMM 자체 몫만 재면 Firecracker 3MB · Cloud Hypervisor 13MB · QEMU 131MB이고 `Ⓑ`, AKS의 RuntimeClass overhead는 128Mi 파드 VM에 16Mi(12.5%), 128Gi 파드 VM에 1Gi(0.8%)가 붙는다 `✓`. 작은 파드를 많이 띄울수록 비율이 나빠진다.
- **Kata는 공유 커널이라는 단일 실패점을 지운다** — 그 대신 2026년 한 해에만 Kata 자신의 guest-to-host 취약점 advisory가 10건 나왔고 `✓`, 16년 묵은 KVM 탈출 Januscape(CVE-2026-53359)가 Intel·AMD 양쪽에서 공개됐다 `Ⓥ`. 경계는 두껍지만 무한하지 않다.
- **Kata와 KubeVirt는 대체재가 아니다** — KubeVirt FAQ가 직접 못 박는다. "Kata containers are containers inside virtual machines. KubeVirt is a virtual machine inside a container." `✓`
- **진입 장벽이 2026년에 낮아졌다** — AWS가 2026-02-16부터 C8i·M8i·R8i 상용 인스턴스에서 중첩 가상화를 열었다 `✓`. `.metal` 강제가 세대 한정으로 풀렸다.
- **CPU limit을 안 주면 Kata 파드는 vCPU 1개로 굳는다** — "Kata shim은 request를 보지 못한다"가 문서의 표현이다 `✓`. request만 크게 잡던 관행이 그대로 성능 사고가 된다.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

이 질문이 다시 올라온 이유는 세 갈래입니다. 하나는 AI 에이전트가 사용자 코드를 그 자리에서 실행해야 하는 워크로드가 늘면서, 신뢰 경계를 파드 단위로 다시 그어야 하는 상황이 흔해졌다는 점입니다. 다른 하나는 2025년 11월 5일 하루에 공개된 runc 취약점 세 건(CVE-2025-31133·52565·52881)처럼, 공유 커널 위에서 컨테이너 런타임 하나가 뚫리면 노드 전체가 넘어간다는 사실이 반복 확인되고 있다는 사정입니다. 세 번째는 Broadcom의 VMware 인수 이후 라이선스 갱신가가 감당하기 어려운 수준으로 뛰면서, VM 워크로드를 어디로 옮길지 다시 계산하는 조직이 늘었다는 흐름입니다.

여기에 겹치는 변화 하나가 더 있습니다. 2026년 들어 클라우드 벤더들이 가상 인스턴스에서도 중첩 가상화를 열어주기 시작하면서, 그동안 베어메탈 노드에만 허락되던 Kata·KubeVirt 도입이 훨씬 흔한 인스턴스 타입에서도 가능해졌습니다. 진입 장벽이 낮아진 만큼 "정말 필요한가"를 판단하는 근거도 그만큼 더 꼼꼼해야 합니다.

이 글은 Kata Containers, KubeVirt, gVisor 세 물건을 같은 축 위에 놓습니다. 셋 다 "컨테이너 아래 또는 옆에 격리를 한 겹 더 까는" 기술이지만 까는 위치와 방향이 다릅니다. 직관은 대개 "컨테이너는 공짜, 격리를 더하면 무척 비쌀 것"인데, 실측을 모아 보면 그 직관은 절반만 맞습니다. CPU와 메모리에서는 격리가 사실상 공짜이고, 시스템콜과 IO와 기동 지연에서는 자릿수가 바뀌도록 비쌉니다. 어디서 그 비용이 붙는지를 구조로 짚고, 언제 쓰고 언제 피할지를 시나리오별로 정리합니다.

자매 문서: [런타임]({{< relref "../../runtime/_index.md" >}}) — 그 챕터가 "일이 어디로 옮겨가나"를 묻는다면 이 챕터는 "경계가 어디에 생기고 그 경계의 요금은 누가 내나"를 묻습니다. 컨테이너 CPU limit이 vCPU 수를 정하는 일반론은 [k8s 02 CPU Throttling]({{< relref "../../k8s-features/02-cpu-throttling/index.md" >}})에서 다뤘습니다.

## 1. 세 물건은 경계를 어디에 긋나

네 가지 접근이 같은 문제를 다른 위치에서 풉니다.

runc는 namespace와 cgroup으로 프로세스를 가리고 나누지만 커널은 하나입니다. 노드 위 모든 컨테이너가 같은 커널 이미지를 공유합니다.

gVisor는 **Sentry**라는 유저스페이스 프로세스가 리눅스 syscall ABI의 상당 부분을 다시 구현해, 애플리케이션의 syscall을 가로채 호스트 커널에 닿지 않게 합니다. 파일 접근은 별도 **Gofer** 프로세스가 대리합니다. syscall을 가로채는 방식(플랫폼)은 ptrace·KVM·systrap 셋이고, systrap은 2023-04-28에 발표돼 이후 기본 플랫폼이 됐습니다.

Kata는 파드마다 경량 VM을 세웁니다. 진짜 게스트 커널과 Rust로 쓰인 kata-agent가 그 안에서 돌고, VMM은 QEMU·Cloud Hypervisor·Firecracker·Dragonball·StratoVirt 중에서 고릅니다.

KubeVirt는 VM을 1급 객체로 노출합니다. VM은 virt-launcher 파드 안에서 libvirt와 QEMU 프로세스로 돕니다.

{{< flow src="_flow/1-세-경로.json" />}}

세 경로가 호스트 커널에 닿기까지 지나는 층이 다릅니다. runc는 곧장 닿고, gVisor는 Sentry(그리고 필요하면 Gofer)를 거쳐 좁혀진 syscall만 닿고, Kata는 게스트 커널을 완전히 거친 뒤에야 하이퍼바이저를 통해 닿습니다. 층이 늘수록 비용과 격리가 함께 늘어난다는 것이 이 그림의 요지입니다.

인터페이스 차이가 실무 차이로 이어지는 축을 표로 정리하면 이렇습니다.

| 축 | runc | gVisor | Kata | KubeVirt |
|---|---|---|---|---|
| 사용자가 보는 객체 | Pod | Pod | Pod | VirtualMachine |
| 아티팩트 | OCI 이미지 | OCI 이미지 | OCI 이미지 | qcow2/raw 디스크 이미지 `✓` |
| 게스트 커널 | 없음(호스트 공유) | 없음(유저스페이스로 재구현) | Kata가 제공하는 축소 커널 `✓` | 사용자 게스트 OS의 커널 `Σ` |
| 진입 방식 | `kubectl exec` | `kubectl exec`(정상 동작) `≈` | `kubectl exec` `≈` | `virtctl console`/`vnc`/SSH `✓` |
| 선택 방법 | 기본 런타임 | RuntimeClass(`runsc`) `✓` | RuntimeClass `≈` | 별도 CRD |
| 마이그레이션 | 없음 | 없음 | 없음 `≈` | VirtualMachineInstanceMigration `✓` |

Kata 안에서도 격리가 완전히 새로 발명되는 건 아닙니다. 계층은 호스트, VM root(게스트 이미지), VM container(사용자 OCI rootfs) 셋으로 나뉘고, 게스트 안에서도 cgroup과 namespace가 워크로드를 VM 환경으로부터 갈라냅니다. 즉 Kata는 namespace 격리를 대체하는 게 아니라 그 위에 하드웨어 가상화라는 경계를 하나 더 얹는 구조입니다 `Σ`. AKS 문서가 이 구조를 컴포넌트 단위로 가장 깔끔하게 나눠 둡니다. 호스트 컴포넌트는 Kata shim·Cloud Hypervisor·virtiofsd이고, 게스트 컴포넌트는 사용자 워크로드·pod VM 커널·kata-agent입니다 `✓`. 이 구분이 나중에 `overhead` 필드를 얼마로 잡을지 정하는 근거가 됩니다.

같은 부품을 반대 방향으로 쓴다는 점이 핵심입니다. Kata와 KubeVirt 둘 다 KVM/QEMU 위에 서지만, Kata는 애플리케이션이 이미 컨테이너화돼 있다는 전제 위에서 격리 수준만 올리고, KubeVirt는 애플리케이션이 컨테이너화돼 있지 않다는 전제에서 출발합니다. 2018년에 Josh Berkus와 Stephen Gordon이 남긴 문장이 지금도 정확합니다.

> It seems unlikely that the two fundamentally different approaches can ever be reconciled. KubeVirt aims to provide as much VM functionality as possible, while Kata Containers tries to provide a container-like experience for VMs.
>
> — 출처: Josh Berkus, Stephen Gordon, Superuser (2018-03-20)

## 2. 무엇으로부터 지키나 — 위협 모델

Kata가 지우는 위협은 하나입니다. **공유 커널이라는 단일 실패점**입니다. runc 아래에서 컨테이너가 커널 버그를 찔러 커널 메모리를 망가뜨리면 곧장 호스트 root지만, Kata 아래에서는 같은 공격이 게스트 커널을 망가뜨리는 데서 멈춥니다.

남는 위협은 넷입니다.

- 하이퍼바이저·KVM 자체의 버그
- virtio 장치 에뮬레이션 표면(virtio-blk, virtio-net, virtio-snd, virtio-pmem, virtiofsd)
- kata-agent의 ttRPC API
- 호스트 쪽 shim과 그것이 신뢰하는 pod annotation

이 넷 중 어느 하나라도 뚫리면 결과는 다시 호스트 root입니다. 다만 그 버그가 나타날 자리가 리눅스 커널 전체가 아니라 하이퍼바이저·virtio·agent·shim이라는 훨씬 좁은 코드베이스로 줄어든다는 점이 Kata가 실제로 주는 값입니다 `Σ`.

runc를 포함한 컨테이너 탈출 CVE가 Kata 위에서 어떻게 막히는지 정리하면 이렇습니다. 표의 "봉쇄" 판정은 전부 아키텍처 추론이고, 각 CVE를 Kata 위에서 실제로 재현해 막혔다고 보고한 1차 문서는 찾지 못했습니다.

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

2025년 11월 5일 하루에 나온 runc 3종 세트는 Kata 도입 논거로 특히 쓸 만합니다. 셋 다 호스트의 runc가 컨테이너를 대신해 호스트 mount·procfs 상태를 조작하다 생긴 버그입니다. Kata에서는 그 조작이 게스트 커널 안에서 일어나므로 같은 실수가 호스트에 닿지 않습니다. 다만 kata-agent가 게스트 안에서 비슷한 mount 작업을 하기 때문에, agent에 동형의 버그가 생기면 게스트 root까지는 갈 수 있습니다 `≈`.

Kata 자신의 취약점 쪽은 2026년이 조용하지 않았습니다. GitHub advisory에 공개된 것만 10건입니다.

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

패턴이 읽힙니다. **pod annotation을 신뢰하는 설계**가 반복해서 문제를 냅니다. 10건 중 3건이 annotation 경유입니다 `Σ`. `GHSA-2gv2-cffp-j227`은 virtiofsd가 `--sandbox none --seccomp none`으로 돌 때 게스트가 절대 호스트 경로를 담은 FUSE 요청을 보내 `/etc/cron.d`에 파일을 심는 방식이었고, runtime-rs 3.31.0에서 수정됐습니다. 반대로 `GHSA-wwj6-vghv-5p64`(virtio-pmem DAX 매핑으로 읽기 전용 게스트 이미지를 덮어쓰는 컨테이너→게스트 권한 상승)는 VM 경계가 부분적으로는 작동한 사례입니다. 탈출이 게스트 root에서 멈췄습니다.

하이퍼바이저 경계도 뚫립니다. 가장 무거운 반례는 **CVE-2026-53359, 통칭 "Januscape"**입니다. KVM x86 shadow MMU의 use-after-free로, 악의적 게스트가 KVM이 이미 해제한 메모리를 가리키는 stale reverse-map 항목을 만들게 유도합니다 `Ⓥ`. 약 16년간 잠복했고 Google kvmCTF에 제로데이로 제출됐으며, 업스트림 커밋이 2026년 6월 메인라인에 들어가고 7월에 공개됐습니다. 보도상 Intel과 AMD 양쪽에서 동작하는 최초의 공개 KVM 탈출입니다 `Ⓥ`. 역사적 선례로 VENOM(CVE-2015-3456, QEMU 플로피 컨트롤러 에뮬레이션 버퍼 오버플로) `✓`이 있고, virtio-snd 힙 오버플로(CVE-2024-7730)가 완전한 게스트→호스트 탈출 체인 연구로 이어진 사례도 있습니다 `Ⓥ`. VM 경계는 공유 커널 경계보다 두껍지만 무한하지 않습니다. Kata를 도입하는 논거는 "탈출이 불가능하다"가 아니라 "탈출에 필요한 버그 클래스가 훨씬 좁고 희소하다"여야 합니다 `Σ`.

gVisor 쪽 실적은 결이 다릅니다. gVisor 보안 페이지 스스로 목표를 "Sentry와 기존 리눅스 하드닝(seccomp-bpf, `pivot_root`, namespace)의 2중 구조로 호스트 커널 공격 표면을 줄이는 것"이라 밝히고, 샌드박스 **내부**에 머무는 권한 상승이나 DoS는 CVE 대상에서 명시적으로 제외합니다 `✓`. 그 기준에서 호스트 커널 임의 코드 실행에 이르는 완전 탈출 CVE는 확인되지 않습니다(부재 확인 `✓`). 확인된 CVE는 CVE-2018-16359(seccomp 샌드박스 안에서 `renameat`으로 호스트 파일명을 바꾼 실제 경계 탈출 사례), CVE-2024-10603·CVE-2024-10026(netstack의 예측 가능한 포트·헤더 값과 약한 해시), CVE-2025-2713(`runsc`가 첫 fork 전까지 root 유사 권한으로 실행돼 생긴 로컬 권한 상승)입니다. CVE-2020-14386(리눅스 패킷 링 버퍼 오버플로)은 gVisor가 `PACKET_RX_RING`을 구현하지 않고 raw socket을 기본 차단해 애초에 영향받지 않은 구조적 회피 사례입니다. amd64 기준 351개 syscall 중 277개가 완전 또는 부분 구현입니다 `✓`.

기본값 함정이 하나 있습니다. Kata의 `disable_guest_seccomp`는 기본값이 `true`입니다. 컨테이너 seccomp 프로필이 게스트로 전달되지 않는다는 뜻이고 `✓`, 의식적으로 켜야 하는 스위치입니다.

Confidential Containers(CoCo)는 방향이 반대입니다. Kata는 워크로드로부터 호스트를 지키고, CoCo는 호스트로부터 워크로드를 지킵니다. 2026-07-22에 CNCF Sandbox에서 Incubating으로 승격됐습니다 `✓`. 지원 TEE는 Intel TDX, AMD SEV/SEV-ES, IBM Secure Execution, Arm CCA입니다 `Ⓥ`. 어테스테이션 스택은 **Trustee**로 묶입니다 — KBS가 게스트와 대화하며 조건부로 비밀을 풀고, Attestation Service가 하드웨어 증거를 검증하며, RVPS가 기준 측정값을 보관하고, 게스트 안 Attestation Agent가 증거를 만들고, Confidential Data Hub가 검증 후 비밀을 가져와 캐시합니다 `✓`. **peer pods**(cloud-api-adaptor) 구성은 베어메탈이나 중첩 가상화를 안 주는 클라우드에서도 로컬 하이퍼바이저 대신 클라우드 제공자의 VM API를 호출해 기밀 게스트를 원격 생성합니다. 워커 노드에 KVM이 필요 없다는 뜻입니다 `✓`. CoCo 자신의 어테스테이션 체인에도 구멍이 있었습니다. `GHSA-989w-4xr2-ww9m`은 악의적 호스트가 I/O를 선택적으로 실패시켜 initdata 검증을 건너뛰게 만드는 TDX 대상 취약점입니다 `Ⓥ`.

다만 Kata 자신은 CNCF가 아니라 OpenInfra Foundation 산하이고, OpenInfra는 2025-07-23에 Linux Foundation 합류를 완료했습니다. Kata가 CNCF로 옮겼다는 서술은 사실이 아니며, CNCF Incubating이 된 것은 별개 프로젝트인 CoCo입니다. 둘을 혼동한 2차 자료가 돌아다니므로 주의가 필요합니다 `✓`.

거버넌스가 어디 있는지와 별개로 활동 지표는 건실한 편입니다. kata-containers/kata-containers 저장소는 별 약 8.7k, 컨트리뷰터 545명 수준으로 관측됐습니다 `≈`. 3.30.0 릴리스 하나에 1,571 커밋, 16명 기여(그중 신규 3명)가 들어갔습니다 `✓`. 다만 Baidu·Huawei·IBM Cloud Code Engine의 Kata 사용은 검색 결과에 등장하지만 1차 출처를 찾지 못해 이 글에는 반영하지 않았습니다 `?`.

## 3. Kata의 구조와 비용이 생기는 자리

호스트에서 도는 것은 셋입니다. `containerd-shim-kata-v2`가 shimv2 API를 구현해 컨테이너 몇 개든 바이너리 인스턴스 하나로 관리하고, VMM이 VM을 띄우고, `virtiofsd`가 파일을 공유합니다. 게스트 안에는 Rust로 쓰인 kata-agent가 있고 shim과는 VSOCK 위 ttRPC로 말합니다.

**4.0.0(2026-07-20)**에서 runtime-rs(Rust)가 기본 런타임이 되고 원래 Go 런타임은 deprecated로 남았습니다. 최신은 **4.1.0(2026-08-21)**입니다 `✓`. 하이퍼바이저 기본값도 최근 바뀌어서, **3.30.0**에서 runtime-rs의 기본 하이퍼바이저가 QEMU로 지정됐습니다. Kata 3.0 초기에 runtime-rs가 Dragonball만 지원하던 시절과는 상황이 다릅니다.

{{< seq src="_seq/3-kata-파드-기동.json" />}}

비용이 붙는 자리는 VM 부팅과, CNI veth를 TAP으로 옮기고 rootfs를 공유하는 연결 단계입니다. 컨테이너를 만드는 단계부터는 runc와 거의 같은 모양이 됩니다.

VMM은 다섯 중에서 고릅니다. GPU와 기밀 컴퓨팅이 필요하면 선택지가 없습니다. QEMU만 그 셋(GPU·Intel TDX·AMD SEV-SNP)을 전부 지원합니다.

| VMM | 언어 | GPU | Intel TDX | AMD SEV-SNP |
|---|---|---|---|---|
| Cloud Hypervisor | Rust | ✗ | ✗ | ✗ |
| Firecracker | Rust | ✗ | ✗ | ✗ |
| QEMU | C | ✓ | ✓ | ✓ |
| Dragonball | Rust | ✗ | ✗ | ✗ |
| StratoVirt | Rust | ✗ | ✗ | ✗ |

Firecracker는 virtio-fs 없이 블록 장치(devmapper 스냅샷터)로 rootfs를 받습니다 `✓`.

rootfs를 게스트로 넣는 길은 네 갈래입니다. **virtio-fs**가 Kata 2.0부터 기본이고 9pfs 대비 성능과 POSIX 준수 양쪽이 낫습니다. virtiofsd는 vhost-user 장치로 호스트의 일반 프로세스로 돌면서 게스트 메모리를 직접 읽고 씁니다 — 이 "직접 읽고 쓴다"가 앞서 본 2026년 탈출 취약점의 무대였습니다 `Σ`. **9p**는 예전 방식이고, **게스트 내부 이미지 pull**(nydus 스냅샷터 경유)은 Kata 3.3.0에서 들어온 네 번째 길입니다. 기밀 컨테이너가 이걸 요구하는 이유는 명확합니다. 호스트가 이미지를 풀고 복호화하면 평문이 TEE 밖 호스트 메모리를 지나가므로 기밀성 보장이 통째로 무너지기 때문입니다 `✓`. 네트워킹은 CNI veth를 TAP으로 리다이렉트하는 **tcfilter**가 기본이고 — "설정이 단순하고 CNI 플러그인 호환성이 좋으며 성능이 MACVTAP과 대등해서 기본값"이라는 게 문서의 설명입니다 — macvtap은 예전 구현, bridge는 성능 열위로 권장하지 않습니다.

Dragonball을 VMM으로 쓰면 shim·VMM·virtio-fs 데몬이 한 프로세스 안에 들어갑니다 `Ⓥ`. Ant Group이 만든 이 조합은 프로세스 경계를 줄여 오버헤드를 낮추려는 설계인데, 업스트림에는 "Dragonball Performance Degradation Compared to other Kata Runtimes"라는 성능 회귀 이슈(#5644)가 아직 열려 있어 "가장 빠른 Kata VMM"이라고 단정하기는 이릅니다 `Σ`. `static_sandbox_resource_mgmt`를 켜면 워크로드 요구사항과 `default_vcpus`로 부팅 전에 크기를 정하고 이후 리사이즈하지 않습니다. Firecracker는 CPU·메모리 hotplug 자체를 지원하지 않아 이 모드가 사실상 강제됩니다 `✓`.

VM 크기 산정이 Kata 운영의 핵심 난점입니다. vCPU는 `vCPUs = ceiling(quota / period)` 공식으로 정해지고 `✓`, CPU limit이 없으면 vCPU 1개로 고정됩니다. 결정적인 문장은 이것입니다 — "Kata shim은 request를 보지 못한다. 따라서 CPU limit이 선언되지 않으면 pod VM은 1 vCPU로 제한된다" `✓`. request만 크게 잡고 limit을 비워두던 관행이 Kata에서는 그대로 성능 사고가 됩니다. 이 대목은 [k8s 02 CPU Throttling]({{< relref "../../k8s-features/02-cpu-throttling/index.md" >}})에서 다룬 CPU limit의 일반론과 정확히 이어집니다.

RuntimeClass 이름도 하이퍼바이저·보안 기능 조합별로 나뉩니다. `kata-deploy`가 만드는 이름은 `kata-qemu`, `kata-clh`, `kata-qemu-tdx`, `kata-qemu-sev`, `kata-qemu-snp`, `kata-qemu-nvidia-gpu` 식으로, 어떤 조합을 쓸지가 곧 어떤 RuntimeClass를 참조할지를 정합니다 `Ⓥ`. `overhead.podFixed`는 v1.24부터 stable이고 `scheduling.nodeSelector`·`tolerations`는 v1.16부터 beta라, Kata 노드풀을 별도로 분리하는 스케줄링 규칙은 오래전부터 안정적으로 쓸 수 있었습니다 `✓`.

메모리 쪽도 기본값을 그냥 넘기면 안 됩니다. Kata 업스트림 `default_memory`는 2048MiB입니다(Makefile의 `DEFMEMSZ`) `✓`. AKS는 이보다 훨씬 작게 잡아 pod VM 메모리 기본값을 512Mi로, 지정이 없을 때 RuntimeClass overhead를 600Mi로 둡니다 `✓`. `overhead.podFixed`에 담기는 건 호스트 컴포넌트 몫뿐입니다. 게스트 컴포넌트 소비량은 담을 필요가 없습니다.

이렇게 산정된 VM은 네이티브 컨테이너와 완전히 같은 방식으로 동작하지는 않습니다. 문서가 명시한 것과 구조상 따라오는 것이 뒤섞여 있어 하나씩 확인해 둘 필요가 있습니다.

| 항목 | 내용 |
|---|---|
| hostNetwork | 미지원 |
| `--net=container:` | 다른 컨테이너의 네트워크 namespace 참가 불가 |
| `volumeMount.subPath` | 미지원 |
| privileged | 호스트 장치가 전달되지 않는다. 게스트 안에서는 root이지만 호스트로부터는 격리된 채로 남는다 |
| hostPath | 마운트되지만 격리가 훼손된다. `/dev` 하위 파일은 예외 |
| `/proc` bind mount | 일부 금지(CVE-2019-16884, CVE-2019-19921 관련) |
| emptyDir(block 변형) | `sizeLimit`이 블록 장치 용량에 반영되지 않아 eviction을 유발할 수 있다 |
| checkpoint/restore | 없음 |
| `exec`/`logs`/`port-forward` | shim과 agent를 거쳐 정상 동작 |
| 사이드카 | 같은 파드의 컨테이너가 한 VM을 공유하므로 정상 동작 `≈` |

GPU는 VFIO 패스스루가 필수이고 호스트에 NVIDIA 드라이버가 없어야 합니다. "Kata는 VFIO로 GPU를 VM에 직접 전달하며 호스트 레벨 GPU 드라이버는 VFIO 장치 바인딩을 방해한다"는 게 NVIDIA GPU Operator 문서의 설명입니다 `✓`. IOMMU를 켠(`intel_iommu=on` 또는 `amd_iommu=on`) 베어메탈이 필요하고, 제약이 둘 큽니다. 노드의 GPU 전부가 한 Kata VM에 배정돼야 하고("일부 GPU만 Kata용으로 구성하는 것은 지원되지 않는다"), vGPU는 지원되지 않으며, 컨테이너 런타임은 containerd만 지원됩니다 `✓`. MIG나 time-slicing 같은 GPU 분할 기법은 이 문서가 지원 구성으로 언급하지 않습니다 `?`.

## 4. 성능 — 직관은 절반만 맞다

### 4.1 CPU·메모리 — 3% 안

{{< lane src="_lane/4-1-cpu-메모리.json" />}}

2015년 하드웨어로 돌린 Felter의 고전 실험도 같은 방향입니다. Linpack GFLOPS는 native 290.8, Docker 290.9, KVM 기본 241.3(−17%), KVM 튜닝 284.2(−2%)였고, STREAM Triad는 45.6/45.6/45.0으로 사실상 동률이었습니다 `Ⓑ`. PXZ만 −22%로 벌어졌는데 논문은 이를 nested paging TLB 압박으로 추정합니다. 2015년 하드웨어라 현행 EPT/NPT 세대와 직접 비교하기는 어렵고, Linpack이 튜닝 후 −2%까지 회복된다는 점을 보면 하드웨어 세대보다 설정의 영향이 컸다고 읽는 편이 맞습니다 `Σ`.

VEE 2020과 Middleware '21도 정성적으로 같은 결론에 이릅니다. VEE 2020은 sysbench CPU 10초 실행에서 "모든 플랫폼(host, Firecracker, LXC, gVisor)이 유사하게 동작"했고 LLCProbe에서도 "모든 플랫폼이 인스턴스당 약 33k probe"를 기록했다고 적습니다. 인스턴스를 10개로 늘리면 인스턴스당 성능이 23% 떨어지는데 이건 플랫폼과 무관한 자원 경합입니다 `Ⓑ`. Middleware '21의 표현은 더 직접적입니다 — "보안 컨테이너를 포함한 모든 컨테이너가 CPU 바운드 작업에서 네이티브 수준", "QEMU 하이퍼바이저를 쓰는 Kata도 메모리에서 유의미한 손상이 없다", 다만 "메모리 성능의 유일한 이상치는 Firecracker"입니다.

### 4.2 시스템콜 — 세 자릿수 스펙트럼

{{< lane src="_lane/4-2-시스템콜-스펙트럼.json" />}}

이 축에서는 native와 runc 막대가 눈에 잘 안 들어올 정도로 작습니다. 그 자체가 격차의 크기를 말해줍니다.

{{< lane src="_lane/4-2-gvisor-플랫폼.json" />}}

같은 gVisor라도 syscall을 가로채는 플랫폼에 따라 숫자가 뒤집힙니다. KVM 플랫폼이 runc보다 **빠른** 이유는 Sentry가 게스트 링0에서 syscall을 자체 처리해 호스트 커널 진입 자체가 없기 때문입니다. "격리 기술의 비용은 기술 자체가 아니라 구현 경로가 정한다"는 이 글의 핵심 반전 중 하나가 여기서 나옵니다.

HotCloud '19 논문 본문의 표현을 그대로 옮기면 이렇습니다 — "runc는 네이티브보다 32% 느린 데 그치지만, gVisor의 가장 빠른 결과(KVM + Sentry 전용)도 2.8배 느리다. KVM 모드에서 호스트 호출은 Sentry 내부 처리보다 9배, Gofer 호출은 72배 느리다." 파일 open+close 지연에서는 격차가 216배까지 벌어집니다(외부 tmpfs 518µs vs runc 2.40µs) `Ⓑ`. Gofer를 거치는 호출이라 왕복이 하나 더 붙기 때문입니다. 다만 이 수치는 systrap 이전 gVisor 버전의 것이고, systrap 이후의 대응 수치는 공식 블로그에 SVG 그래프만 있고 텍스트 값이 없어 확인하지 못했습니다 `?`. Kata 게스트 안의 시스템콜은 진짜 리눅스 커널이 처리하므로 구조상 native에 근접해야 하지만, 이를 뒷받침하는 공개 측정은 찾지 못했습니다 `?`.

### 4.3 디스크 IO — 순차와 랜덤이 반대로

{{< lane src="_lane/4-3-랜덤-4k.json" />}}

같은 2026년 3자 비교에서 순차 read는 Kata +112%, gVisor +551%로 runc를 앞섭니다. 실제 디스크 성능이 좋아진 게 아니라 캐시 효과입니다. gVisor의 Gofer가 호스트 페이지 캐시에서 공격적으로 read-ahead를 하고, Kata의 virtio-fs DAX가 호스트 캐시를 게스트에 매핑하기 때문이라고 원 저자가 직접 밝힙니다. 그래서 이 수치는 같은 차트에 올리지 않았습니다. 랜덤 4K는 캐시가 먹히지 않는 자리라 구조적 비용이 그대로 드러납니다. Kata의 −99%는 IO 한 번마다 VM exit이 발생하는 구조 때문으로 보입니다 `≈`.

CLOSER 2020 논문(2코어 노트북급 VM, containerd/CRI-O × runc/runsc 4조합)이 잰 파일 IO도 같은 방향을 가리킵니다. 순차 read에서 runsc가 runc 대비 9.2배 느렸고(3.32초 대 0.36초), 랜덤 read는 9.7배(0.29초 대 0.03초) 느렸습니다. 반면 쓰기 쪽 격차는 2.5배 정도로 훨씬 완만했습니다 `Ⓑ`. 저자는 이 비대칭을 "Gofer가 제공하는 가상 파일시스템의 비효율적 구현" 탓으로 설명합니다. 하드웨어도 실험 목적도 다른 측정 셋(2026년 3자 비교, gVisor 공식 fio, CLOSER 2020)이 "읽기가 쓰기보다 훨씬 크게 벌어진다"는 같은 결론에 따로따로 도달했습니다 `Σ`.

NSDI 2020의 하드웨어 측정이 이 구조를 더 날카롭게 보여줍니다. 하드웨어 자체는 4kB에서 340,000 IOPS 이상을 낼 수 있는데, Firecracker 게스트는 v0.20.0 시점 구현 한계(flush 미구현, IO 직렬 처리)로 약 13,000 IOPS에 묶입니다 `Ⓑ`. 26배 가까이 벌어지는 셈입니다 `≈`. 논문은 QD1 99퍼센타일 지연에서 Firecracker의 4kB read가 네이티브보다 49µs 느리다고도 밝힙니다. Felter의 오래된 측정에서도 같은 방향입니다 — "Docker는 Linux 대비 오버헤드 없음, KVM은 IOPS의 절반만 전달"했고 이유는 모든 IO가 QEMU를 통과하기 때문입니다. 랜덤 read 지연은 KVM에서 2~3배 늘었습니다 `Ⓑ`.

Kata가 쓰는 공유 파일시스템 선택도 성능을 크게 가릅니다. virtio-9p는 순차 read 91–98 MB/s에 그치는데 virtio-fs+DAX는 660–703 MB/s까지 올라갑니다 `Ⓑ`. 4개 파일을 동시에 여는 시나리오에서는 DAX 구성이 2~3 GB/s까지 올라가고 베이스라인은 300~400 MB/s에 머뭅니다. StackHPC의 2019년 측정(Kata 1.6.2, 9p 시절, BeeGFS/NVMe over 100G IB)에서는 bare metal read 대역폭의 약 15%밖에 못 냈고, 순차 read 1클라이언트 p50 지연이 bare metal 1,581µs 대비 Kata 4,112µs로 늘었습니다 `Ⓑ`. Kata 2.0부터 virtio-fs가 기본이 된 배경이고, Middleware '21도 "virtio-fs는 9P를 크게 앞서는 유망한 대안"이라고 같은 결론을 냅니다.

### 4.4 네트워크 — 대역폭과 지연의 순위가 다르다

{{< lane src="_lane/4-4-대역폭.json" />}}

링크 자체가 병목이면 격차가 사라집니다. Felter의 10GbE 환경에서는 native·Docker·KVM이 전부 9.3Gbps로 동률이었습니다. NSDI처럼 loopback으로 링크 제약을 걷어내야 VMM 사이의 실제 격차가 드러납니다.

{{< lane src="_lane/4-4-rtt.json" />}}

대역폭 순위와 지연 순위가 뒤집힙니다. Firecracker는 대역폭에서 host급인데 RTT는 gVisor보다 나쁩니다. 패킷이 게스트와 호스트 양쪽의 네트워크 스택을 온전히 두 번 통과하기 때문입니다.

{{< lane src="_lane/4-4-http-처리량.json" />}}

{{< lane src="_lane/4-4-http-지연.json" />}}

같은 역전이 HTTP에서도 반복됩니다. gVisor는 처리량을 42% 잃으면서 평균 지연은 runc보다 34% 낮게 나옵니다. 요청당 효율은 좋지만 병렬성이 제한적이라는 뜻입니다.

TCP 연결 수립 시간도 벌어집니다. Quark 논문에서 runC-Flannel이 504.65µs인데 Kata-Flannel은 834.6µs입니다 `Ⓑ`. Middleware '21은 하이퍼바이저(TAP+virtio-net) 경로가 약 −25%, bridge가 −9~10%, gVisor의 p90 지연이 경쟁자의 3~4배라고 정리합니다. 이 논문은 Kata가 bridge와 QEMU TAP+virtio-net을 둘 다 쓰기 때문에 "가장 약한 고리인 QEMU 쪽 성능과 같아야 하고, 실제로 그렇다"고 설명합니다. Felter의 결론도 되짚을 만합니다 — 자신의 실험 환경에서 "vhost는 복잡한 네트워크 가속 기술 없이도 네트워크 처리량 문제를 직설적으로 해결한다. NIC이 더 있다면 이 서버는 40Gbps 이상을 밀어낼 수 있을 것"이라고 적었습니다. 대신 오버헤드는 대역폭이 아니라 바이트당 CPU 사이클과 netperf 왕복 지연에 나타났습니다 — NAT은 지연을 2배로, KVM은 트랜잭션당 30µs를 더해 80%를 늘렸습니다 `Ⓑ`. KubeVirt 바인딩별 iperf 대조표는 공개된 것을 찾지 못했습니다 `?`.

### 4.5 기동 시간

{{< lane src="_lane/4-5-기동-시간.json" />}}

NSDI 2020은 Firecracker가 애플리케이션 코드까지 125ms 미만으로 뜬다고 밝히는데, Middleware '21이 잰 Firecracker end-to-end는 350ms입니다. 같은 대상을 잰 게 아닙니다. NSDI는 패치된 커널이 부팅 중 특수 장치에 남기는 타임스탬프까지의 구간을, Middleware는 프로세스 생성부터 종료까지를 잽니다. Middleware 저자는 NSDI 방식이 "왜곡됐다"고 직접 비판합니다. 그래서 두 수치를 같은 막대에 올리지 않았습니다.

부팅 시간을 가르는 요인은 NSDI가 숫자로 분해해 뒀습니다. 압축 커널 해제가 +40ms, Ubuntu 기본 커널 사용이 +900ms, 시리얼 콘솔 로깅 끄기가 −70ms입니다 `Ⓑ`. 커널 이미지를 최적화하지 않으면 부팅 시간의 대부분이 여기서 샙니다.

Ant Group의 실험적 PVM 경로는 claim-to-Ready가 사전부팅 풀이 없을 때 8.806초, 준비된 샌드박스가 하나 있을 때 1.385초입니다 `Ⓥ`. 리틀의 법칙을 적용하면 125ms 생성 시간에서 초당 8건 생성마다 사전부팅 풀 1개가 필요하다는 계산이 나옵니다.

Docker 데몬을 경유하는 측정에서는 gVisor가 runc보다 빠르게 나오기도 합니다. 데몬 자체의 오버헤드가 워낙 커서 런타임 차이를 덮어버리기 때문입니다. HotCloud '19가 잰 동시성 없는 생명주기 전체(setup+teardown)에서도 runc 1.014초, gVisor+KVM 1.117초, gVisor+ptrace 1.181초로 격차가 크지 않았습니다 `Ⓑ`. 컨테이너 자체의 기동은 이렇게 짧은데, 앞서 본 Kata·Firecracker의 수백 ms대 수치와 나란히 두면 "VM을 세우는 일"과 "프로세스를 띄우는 일"의 자릿수 차이가 선명해집니다.

### 4.6 메모리 바닥값과 밀도 — 직관이 가장 잘 맞는 축

{{< lane src="_lane/4-6-vmm-메모리.json" />}}

VMM 자체의 비공유 세그먼트만 재면 VM 크기와 무관하게 상수입니다. QEMU의 131MB는 128MB짜리 마이크로 VM을 띄울 때 VM 본체보다 VMM이 더 크다는 뜻입니다. gVisor는 빈 컨테이너에서 5.79배(+18.7MiB)까지 벌어지지만 Redis처럼 1GB를 쓰는 워크로드에서는 1.02배로 희석됩니다. 밀도 비용은 컨테이너가 작을수록 치명적이라는 걸 이 대비가 보여줍니다.

{{< lane src="_lane/4-6-aks-오버헤드.json" />}}

이 그림이 이 글의 세 번째 반전입니다. 절대 오버헤드는 VM 크기를 따라 커지지만 그 비율은 128Mi에서 12.5%였다가 128Gi에서 0.78%로 떨어집니다. 호스트 컴포넌트 여유는 450~490Mi 선에 수렴합니다. **VM 메모리 오버헤드는 "VM이라서" 비싼 게 아니라 "워크로드가 작아서" 비싼 것**입니다 `Σ`.

{{< lane src="_lane/4-6-kubevirt-오버헤드.json" />}}

KubeVirt 쪽도 같은 구조입니다. 기본 구성(8GiB/4vCPU)에서 296Mi였던 오버헤드가 그래픽·전용 CPU를 더하면 428Mi로, VFIO(GPU·SR-IOV) 패스스루를 더하면 1,452Mi로 뜁니다. VFIO는 게스트 RAM 전체를 lock해야 해서 한 번에 1Gi가 붙습니다. Red Hat의 스케일 테스트가 실측한 파드당 약 288MB가 이 계산값과 잘 맞습니다 `Ⓥ`.

같은 스케일 테스트에서 노드당 400개 VMI를 띄울 수 있었고(목표는 500이었으나 테스트베드 불안정으로 미달), 100개를 생성하는 데 약 200초, 200개를 생성하는 데 약 600초가 걸렸습니다 `Ⓥ`. 300개 구간에서의 생성률은 분당 약 48 VMI였습니다. VM당 게스트 RAM은 10MB로 작게 잡았는데도 virt-launcher 파드당 메모리 오버헤드가 위에서 본 288MB 선이었다는 점이, 소스 코드 상수를 그대로 조립한 계산값과 실측이 어긋나지 않는다는 근거입니다.

### 4.7 정리 — 워크로드 유형별 기대 오버헤드

| 워크로드 | Kata | gVisor | 근거 |
|---|---|---|---|
| CPU 바운드 | −3% 안팎 | −2% 안팎 | 2026 K8s 실측 `Ⓑ` |
| 메모리 대역폭 | −3% 안팎 | 0% 안팎 | 2026 K8s 실측 `Ⓑ` |
| 랜덤 소블록 IO | −99% | −76% | 2026 K8s 실측 `Ⓑ` |
| 순차 대블록 IO | +112%(캐시 효과, 참고용) | +551%(캐시 효과, 참고용) | 같은 자료, 캐시 제거 안 됨 `Ⓑ` |
| 네트워크 처리량 | −89% | −42% | 2026 wrk 실측 `Ⓑ` |
| 네트워크 지연 | +250%대 | runc보다 −34% | 2026 wrk 실측 `Ⓑ` |
| syscall 밀집(빌드·컴파일류) | 미확인 `?` | 최대 200배대(경로에 따라) | HotCloud '19 `Ⓑ` |
| 기동 지연 | 약 6배(Docker 대비) | 약 2배(Docker 대비) | Middleware '21 `Ⓑ` |
| 파드당 메모리 | 128Mi VM 기준 +12.5% | 빈 컨테이너 기준 +5.79배 | AKS 공식 · gVisor density.csv `✓`/`≈` |

이 표를 보는 방법은 "Kata·gVisor가 나쁘다"가 아니라 "어느 축이 워크로드에 걸리는가"입니다. 계산 중심 배치 작업이라면 이 표의 위쪽 두 줄만 신경 쓰면 되고, 요청이 잦은 API 서버라면 중간의 IO·네트워크 줄이 SLO를 직접 흔듭니다. 여기까지는 Kata와 gVisor처럼 컨테이너를 감싸는 격리를 봤습니다. 이제 컨테이너 대신 VM 자체를 1급 객체로 다루는 KubeVirt로 넘어갑니다.

## 5. KubeVirt — VM을 파드로

{{< flow src="_flow/5-kubevirt-구조.json" />}}

QEMU 프로세스가 virt-launcher 파드의 cgroup과 namespace 안에서 돕니다. 파드가 죽으면 VM도 죽습니다. Kubernetes가 아는 건 파드이고, VM은 그 파드의 내용물일 뿐입니다. 최신 버전은 **v1.9.0(2026-07-30 태그, Kubernetes v1.36 대상)**이고 4개월 주기로 릴리스되며, CNCF Incubating 상태에서 졸업 신청이 진행 중입니다 `✓`. v1.9에서는 Beta 피처 게이트가 전부 기본 활성화됐고, **cgroup v1은 deprecated돼 다음 릴리스에서 제거될 예정**입니다 `✓`.

스토리지가 도입 판단의 1순위인 이유가 있습니다. 라이브 마이그레이션은 RWX 공유 스토리지가 필요하고 `✓`, CPU·메모리 hotplug가 내부적으로 라이브 마이그레이션을 동반하며 `✓`, 워크로드 업데이트 전략(LiveMigrate/Evict)도 마찬가지입니다. RWX가 없으면 셋 다 못 씁니다. 마이그레이션 기본값은 다음과 같습니다.

| 파라미터 | 기본값 |
|---|---|
| `parallelMigrationsPerCluster` | 5 |
| `parallelOutboundMigrationsPerNode` | 2 |
| `bandwidthPerMigration` | 64Mi |
| `completionTimeoutPerGiB` | 800 |
| `progressTimeout` | 150 |

네트워킹 바인딩은 넷입니다. **masquerade**가 기본값이고 pod IP 뒤에 게스트를 NAT로 숨기며 라이브 마이그레이션을 완전히 지원합니다. **bridge**는 pod IP를 게스트에 위임하는 대신 라이브 마이그레이션이 명시적으로 금지됩니다. **passt**는 v1.8부터 core 바인딩으로 승격됐고 메모리 250Mi를 추가로 씁니다. **SR-IOV**는 VF를 vfio로 넘기면서도 마이그레이션 시 자동으로 hot-unplug·hot-plug됩니다 `✓`. Service는 게스트가 아니라 virt-launcher 파드의 라벨을 매칭하므로, Service와 Ingress가 VM에 별다른 작업 없이 그대로 붙습니다.

축출은 곧 VM 종료입니다. `evictionStrategy: LiveMigrate`가 걸린 VMI마다 PodDisruptionBudget이 자동으로 생성돼 축출을 막고 마이그레이션을 보장합니다. 드레인 명령에 `--force`가 필요한 이유도 여기 있습니다 — virt-launcher 파드는 ReplicaSet이나 DaemonSet 소유가 아니라서 kubectl이 재스케줄을 보장할 수 없습니다. 커스텀 PDB를 쓸 때는 `maxUnavailable`이 아니라 `minAvailable`을 써야 합니다. VMI가 `/scale` subresource를 구현하지 않기 때문입니다. Karpenter의 consolidation은 노드의 파드를 전부 축출할 수 있어야 그 노드를 정리하는데, PDB가 걸린 virt-launcher 파드는 축출되지 않아 consolidation이 그 노드를 건드리지 못할 가능성이 있습니다 `≈`. 이걸 정면으로 다룬 1차 문서는 찾지 못했습니다 `?`. [Karpenter]({{< relref "../../karpenter/_index.md" >}}) 챕터가 다루는 consolidation 로직과 맞물리는 지점입니다.

오버헤드는 소스 코드의 `GetMemoryOverhead` 함수가 정확히 정의합니다. 고정분은 virt-launcher 100Mi, virtqemud 40Mi, qemu 50Mi, virt-launcher-monitor 25Mi, virtlogd 25Mi를 더한 240Mi입니다. 여기에 페이지테이블(게스트 RAM/512), vCPU당 8Mi, IOThread 8Mi가 가변으로 붙고, 그래픽 디바이스 32Mi, 전용 CPU 또는 Guaranteed QoS 100Mi, VFIO 디바이스 1Gi가 옵션으로 얹힙니다 `✓`. 4.6절 차트가 이 수치를 조립한 예시입니다.

성능이 중요한 VM에는 별도의 튜닝 손잡이가 있습니다. `dedicatedCpuPlacement`는 Kubernetes CPU manager의 static 정책과 Guaranteed QoS를 전제로 vCPU를 물리 코어에 고정하고, `isolateEmulatorThread`를 같이 켜면 QEMU 에뮬레이터 스레드가 vCPU 실행과 경쟁하지 않도록 별도 코어를 받습니다 `✓`. hugepages는 노드에 미리 할당돼 있어야 하고 요청 메모리가 hugepage 크기로 나눠떨어져야 합니다 `✓`. NUMA는 `guestMappingPassthrough`로 게스트에 호스트의 NUMA 토폴로지를 그대로 보여주는데, 문서 스스로 "재스케줄되면 게스트가 다른 NUMA 토폴로지를 볼 수 있다"고 한계를 인정합니다 `✓`. 이런 손잡이는 전부 Guaranteed QoS와 노드 사전 준비를 요구하므로, 켜는 순간 그 VM은 더 이상 아무 노드에나 뜨는 물건이 아니게 됩니다 `Σ`.

모든 KubeVirt 컴포넌트는 `/metrics` 엔드포인트로 Prometheus 메트릭을 냅니다. VMI 런타임 메트릭은 `kubevirt_vmi_memory_resident_bytes`, `kubevirt_vmi_network_traffic_bytes_total`, `kubevirt_vmi_vcpu_seconds_total` 같은 `kubevirt_vmi` 접두사를 씁니다 `✓`.

노드 쪽 전제는 `/dev/kvm`입니다. `useEmulation: true`로 소프트웨어 에뮬레이션 폴백이 가능하지만 개발용이지 프로덕션 물건이 아닙니다. 컨테이너 런타임은 containerd와 cri-o를 지원하고, SELinux 노드는 container-selinux가 필요합니다.

CPU·메모리를 실행 중에 늘리는 hotplug 기능에는 공통 전제가 하나 있습니다. **라이브 마이그레이션을 동반한다**는 점입니다. CPU hotplug는 v1.0에서 GA가 됐지만 "현재 구현은 VM이 라이브 마이그레이션할 것을 요구한다"고 문서가 명시하고, 워크로드 업데이터가 자동으로 마이그레이션을 트리거합니다 `✓`. 메모리 hotplug는 v1.1에서 들어왔고 최소 1GiB가 필요하며 마찬가지로 마이그레이션을 동반합니다 `✓`. 결국 CPU·메모리를 유연하게 조절하고 싶다는 요구 자체가 RWX 스토리지 요구로 되돌아갑니다.

디스크를 게스트에 넣는 경로는 CDI(Containerized Data Importer)가 담당합니다. DataVolume이 받는 소스 종류는 `http`/`s3`/`gcs`(원격 다운로드), `registry`(컨테이너 이미지를 디스크로), `pvc`(기존 PVC 복제), `snapshot`, `upload`, `blank`, 그리고 vSphere 이주의 뿌리가 되는 `imageio`·`vddk`입니다 `✓`. Windows 게스트를 올릴 때는 viostor·viorng 같은 virtio 드라이버가 필요하고, EFI를 켜면 Secure Boot가 함께 켜집니다. vTPM은 비영속이 기본이라 VM 종료마다 상태가 지워지는데, Windows 11이 TPM 2.0과 Secure Boot를 하드 요구사항으로 걸기 때문에 영속 TPM을 쓰려면 backend storage를 먼저 구성해야 합니다 `✓`.

중첩 Kubernetes 클러스터를 올리는 용도로도 쓰입니다. HyperShift의 KubeVirt provider는 베어메탈 OpenShift 위에 테넌트 클러스터를 대규모로 얹습니다. HostedCluster 리소스를 만들면 관리 클러스터 안에 전용 네임스페이스가 생기고 etcd·kube-apiserver·controller-manager가 그 안에서 Pod로 돕니다. 게스트 클러스터 프로비저닝은 10~15분 안에 끝난다고 알려져 있습니다 `Ⓥ`. 베어메탈 노드 부트스트랩을 걷어내 프로비저닝 시간을 줄이고, 여러 hosted control plane을 같은 물리 인프라에 밀집시키려는 노림수입니다.

KubeVirt를 "격리 수단"으로 쓰는 사례가 역설적으로 많습니다. ADOPTERS.md에는 Cloudflare(2018년부터 컨테이너 친화적이지 않은 CI 러너), NVIDIA GeForce NOW, CoreWeave, SK Telecom, Nebius 같은 이름이 올라 있습니다 `✓`. Broadcom의 VMware 인수 이후 이주 물결도 뚜렷합니다. TechTarget의 2026-05-15 기사에 따르면 Cleveland Clinic은 VM 1만 대 중 450대를 이관했고, Emirates NBD는 9,000대 이상을 옮겼으며, FedHIVE는 Broadcom 갱신가가 9배로 뛰는 상황에서 100대를 약 6주 만에 옮겼습니다 `✓`. 애널리스트 Rob Strechay의 평가는 냉정합니다 — "OpenShift Virtualization is still seen as expensive, even though it's not as expensive as VMware." 2026년 9월 Broadcom이 VDDK 공개 다운로드를 내리면서 vSphere 이주 경로 자체에 마찰이 생겼다는 보도도 있습니다 `≈`. 배포판으로는 Red Hat OpenShift Virtualization, SUSE Harvester(최신 v1.8), Kubermatic, Spectro Cloud가 있습니다.

이 흐름 속에서 KubeVirt 자신도 CNCF 졸업을 노리고 있습니다. KubeCon EU 2026 취재에서 Andrew Burden은 이렇게 말합니다 — "Graduating for us makes it more obvious for people that [KubeVirt] is deeply embedded in the Kubernetes ecosystem." 다만 졸업에 필요한 커뮤니티 성장 정량 지표(스타 수, 기여자 추이, 채택률 서베이)는 이번 조사에서 확보하지 못했습니다 `?`.

## 6. Kata vs KubeVirt — 겹치는 자리와 안 겹치는 자리

이 글이 조사한 범위에서 Kata와 KubeVirt를 같은 하드웨어·같은 워크로드로 정면 비교한 공개 벤치마크는 존재하지 않습니다. 두 프로젝트가 애초에 다른 사용 사례(Kata는 OCI 이미지의 격리, KubeVirt는 기존 VM 이미지 실행)를 겨냥하기 때문입니다 `Σ`. 둘 다 QEMU/KVM 위에 서므로 구조적으로 CPU·메모리 오버헤드는 비슷해야 하지만, 이를 직접 뒷받침하는 측정은 없습니다. 그래서 아래 시나리오 표는 두 기술을 직접 비교한 결과가 아니라 각각의 인터페이스와 제약을 시나리오에 대입한 판단입니다.

GPU를 여러 워크로드가 나눠 쓰고 싶은 경우가 특히 그렇습니다. Kata는 노드의 GPU 전부를 한 VM에 배정해야 하고 vGPU 자체를 지원하지 않으므로, GPU 파티셔닝이 목적이라면 애초에 대상이 아닙니다. KubeVirt는 VFIO 패스스루로 GPU를 붙이면 오버헤드가 1Gi 단위로 뛰고, 마이그레이션이 되는 경로는 NVIDIA mdev(vGPU) 정도로 제한됩니다. 결국 "GPU를 잘게 쪼개 여러 테넌트에게 팔고 싶다"는 요구에는 둘 다 정답이 아니고, 그 자리는 MIG나 time-slicing 같은 GPU 자체의 분할 기능이 채웁니다 `Σ`.

시나리오별로 답이 갈립니다.

| 시나리오 | 답 |
|---|---|
| 신뢰 못 하는 코드 실행 | Kata 또는 gVisor |
| Windows·커스텀 커널 | KubeVirt |
| 컨테이너화되지 않은 레거시 앱 | KubeVirt |
| vSphere 자산 이주 | KubeVirt + Forklift/MTV |
| docker-in-docker CI 러너 | 둘 다 — 러너 수명으로 가른다 |
| GPU 쪼개 쓰기 | 둘 다 아니다(Kata는 노드 GPU 전부를 한 VM에, KubeVirt는 VFIO 1Gi 추가·mdev만 마이그레이션) |
| 테넌트별 k8s 클러스터 | KubeVirt 위 중첩(HyperShift) |

docker-in-docker CI 러너가 실제로 겹치는 자리입니다. 판단 기준은 러너의 수명입니다. 러너를 매번 새로 띄우고 버린다면 기동 시간이 지배적이라 Kata가 유리하고, 러너가 상태를 유지하며 이미지 캐시를 오래 쓴다면 VM 쪽이 자연스럽습니다 `Σ`.

AI 에이전트 샌드박스 지형에서는 뚜렷한 구도가 보입니다.

| 업체 | 격리 기술 |
|---|---|
| Anthropic | gVisor `✓` |
| OpenAI | gVisor `✓` |
| Modal | gVisor `✓` |
| E2B | Firecracker `Ⓥ` |
| Fly.io | Firecracker `✓` |
| Northflank | Kata + Cloud Hypervisor(GPU 시 gVisor로 대체) `Ⓥ` |
| Ant Group | Kata + Dragonball `Ⓥ` |

모델 제공자 본인들은 gVisor를 고르고, 인프라 판매자들은 마이크로 VM을 고르는 구도로 읽힙니다 `Σ`. 자기 코드로 자기 하드웨어를 지키는 문제라면 syscall 표면 축소로 충분하지만, 남의 임의 커널 요구를 받아야 하는 인프라 판매자는 호환성 때문에 VM이 필요하다는 해석이 자연스럽습니다 `≈`. Kubernetes SIG의 Agent Sandbox 프로젝트는 gVisor와 Kata 둘 다를 백엔드로 지원합니다 `✓`.

표에 넣지 않은 이름도 있습니다. Cloudflare Sandboxes는 "격리된 컨테이너"라고만 밝히고 하이퍼바이저를 공개하지 않으며, Daytona는 네임스페이스 샌드박스와 VM 샌드박스를 둘 다 쓴다고 알려져 있으나 구체적인 배치 기준은 확인하지 못했습니다 `?`. 표에 오른 이름들만으로도 구도는 충분히 뚜렷합니다.

Ant Group의 사례가 이 구도에서 가장 구체적인 숫자를 냅니다. CNCF TAB 이슈에 최대 15,000 노드 규모 쿠버네티스 클러스터에서 runtime-rs·Dragonball 스택을 장기 운영 중이라고 적혀 있고 `Ⓥ`, 스택 구성은 Kubernetes + containerd + Kata + Dragonfly + Nydus입니다 `Ⓥ`. 이슈 본문의 용례 설명이 이 글의 주제와 정확히 겹칩니다 — "AI 에이전트는 방금 생성한 코드를 실행하고 사용자 제공 파일을 다뤄야 할 때가 있다. 각 작업에 수명 짧은 환경과 명확한 테넌트 경계, 자체 게스트 커널을 준다." Kata 4.0 발표는 프로덕션 사용 조직으로 Ant Group, Edgeless Systems, Microsoft, NVIDIA를 듭니다 `Ⓥ`.

## 7. 운영 비용 체크리스트 (Kata 도입 전에 답할 것)

Kata를 도입하는 결정은 런타임 하나를 바꾸는 일로 끝나지 않습니다. 노드 프로비저닝부터 관측 파이프라인까지 열 군데가 함께 바뀝니다. 도입 전에 아래 열 가지에 스스로 답해야 나중에 사고로 알게 되는 일을 줄일 수 있습니다.

1. 파드당 추가 메모리는 얼마나 붙는가
2. 부팅 지연이 SLO 안에 들어오는가
3. 밀도 손실을 감당할 수 있는가 — 정적 크기 모드에서는 오버커밋 여지가 준다
4. 게스트 커널 유지보수를 누가 지는가 — 3.30.0이 CVE-2026-31431 대응으로 게스트 이미지 커널을 통째로 올린 사례가 전형이다
5. 디버깅 경로가 있는가 — `kata-runtime exec`나 debug console 경유
6. 관측 사각지대를 인지하는가 — 호스트 eBPF는 게스트를 못 본다 `≈`. AKS는 "Defender for Containers는 Kata 파드를 평가하지 못한다"고 명시한다 `✓`
7. CNI 데이터패스가 게스트 내부까지 보이는가 — Cilium 같은 eBPF CNI는 호스트 쪽에서만 동작하고 veth-TAP 리다이렉션 아래의 게스트 내부는 보지 못한다 `≈`
8. 서비스 메시 사이드카가 정상 동작하는가 — 같은 파드의 컨테이너가 한 VM을 공유하므로 붙는다 `≈`. Istio Ambient는 아직 실험 단계인 L3 forwarding 네트워크 모델과 맞물린다 `✓`
9. 스토리지 CSI의 IOPS 한계를 아는가 — AKS는 Azure Files와 로컬 SSD에서 IOPS 한계를 명시적으로 경고한다
10. seccomp 프로필이 게스트로 전달되는지 확인했는가 — 기본은 미전달이다

`/dev/kvm`을 확보할 수 있는지가 출발점입니다.

| 클라우드 | 조건 |
|---|---|
| AWS | 2026-02-16부터 C8i·M8i·R8i가 전 상용 리전에서 중첩 가상화 지원. 그 전에는 `.metal`만 |
| GCP | Intel VT-x 지원, AMD는 N4D만. 중첩 VM은 CPU 10%+·IO는 그 이상 성능 저하 경고 |
| Azure | 중첩 가상화를 지원하는 gen2 VM이면 가능 |

관리형 서비스로는 AKS Pod Sandboxing(`kata-vm-isolation` RuntimeClass, Azure Linux 전용, `uname -r`로 게스트 커널 확인), GKE Sandbox(Kata가 아니라 gVisor), Alibaba ACK Sandboxed Container(V2가 오버헤드 90% 감소를 주장하나 독립 검증은 못 했다 `Ⓥ`)가 있습니다.

## 8. 판단 — 쓸 때와 쓰지 말 때

지금까지 본 숫자를 종합하면 판단 기준은 결국 두 축으로 좁혀집니다. 워크로드가 계산 중심인가 IO·네트워크 중심인가, 그리고 파드가 크고 적은가 작고 많은가입니다. 앞 축이 계산 쪽으로, 뒤 축이 크고 적은 쪽으로 갈수록 Kata의 청구서는 가벼워집니다.

**Kata를 쓸 만한 경우**

- 신뢰할 수 없는 코드를 실행한다 — 사용자 제출 코드, CI 러너, AI 에이전트가 생성한 코드
- 테넌트 간 경계가 규제나 계약으로 요구된다
- 워크로드가 CPU·메모리 중심이고 I/O가 적다
- 파드가 크고 수가 적다 — overhead 상대 비율이 낮아진다
- 커널 CVE가 나올 때마다 전 노드 긴급 패치를 도는 부담이 이미 크다

**Kata를 피할 경우**

- 랜덤 I/O나 네트워크 처리량이 SLO의 중심이다
- 파드가 작고 밀도가 높다
- hostNetwork, subPath, 호스트 장치 패스스루에 의존한다
- 노드 레벨 eBPF 런타임 보안이 규정 요건이다
- GPU를 노드 안에서 쪼개 쓴다
- `/dev/kvm`을 얻을 수 없는 인스턴스 타입에 묶여 있다

**gVisor가 더 맞는 경우**

- 워크로드가 일반적인 syscall만 쓰는 애플리케이션 코드다
- 중첩 가상화 없는 환경이고 콜드 스타트가 중요하다
- 반대로 커스텀 커널 모듈, io_uring, raw socket을 요구받으면 gVisor는 답이 아니다

**KubeVirt가 맞는 경우 / 피할 경우**

- 맞는 경우 — 컨테이너화가 불가능한 앱이 이미 상당량 있다, vSphere 자산을 Forklift/MTV로 옮겨야 한다, Windows 게스트나 특정 커널이 필요하다, GPU·SR-IOV·NUMA 밀착 워크로드를 VM 경계로 나눠 판다
- 피할 경우 — RWX 공유 스토리지가 없다, `/dev/kvm`을 줄 수 없다, 노드가 자주 바뀌어 Karpenter consolidation과 부딪힌다, 목적이 컨테이너 워크로드의 격리 강화다(그건 Kata의 일이다), 운영 인력이 얇다

중간 선택지도 있습니다. RuntimeClass는 파드 단위라 전부 아니면 전무가 아닙니다. 신뢰 경계를 넘는 파드에만 `runtimeClassName`을 붙이고 나머지는 runc로 두는 배치가 실제로 가장 흔합니다. 다만 `scheduling.nodeSelector`로 Kata 가능 노드를 분리해야 하므로 노드풀이 하나 늘어납니다. 클러스터 전체를 한 런타임으로 통일할 필요는 없다는 뜻이고, 오히려 통일하려는 시도가 불필요한 비용을 가장 많이 만듭니다 `Σ`.

이 글이 준 숫자로 독자가 스스로 계산할 수 있는 식이 하나 있습니다. **파드당 오버헤드(상수) × 파드 수**를 워크로드 크기와 견주고, 그 상수가 파드 수에 곱해질 만큼 파드가 작고 많은지를 먼저 봅니다. 그다음 "경계를 건너는 횟수"가 SLO에 들어가는 성질인지를 봅니다. 순수 계산이라면 격리는 거의 공짜이고, syscall과 IO가 촘촘하다면 그 공짜는 사라집니다.

## 9. 확인하지 못한 것

- Kata와 KubeVirt를 같은 하드웨어·워크로드로 정면 비교한 공개 벤치마크는 존재하지 않는다
- Kata VMM별(QEMU·Cloud Hypervisor·Firecracker·Dragonball) 아이들 샌드박스 RSS와 파드 기동 시간의 공개 대조표가 없다 — Kata 프로젝트의 `metrics` 스위트에 도구는 있지만 결과 수치는 게시돼 있지 않다
- systrap 이후 gVisor의 시스템콜 오버헤드 수치는 공식 블로그의 SVG 그래프로만 있고 텍스트 값이 없다
- GKE Sandbox는 공식 문서에 성능 오버헤드·기동 지연 수치를 제시하지 않는다
- Kata 위에서 각 컨테이너 탈출 CVE를 실제로 재현해 막혔음을 확인한 1차 보고는 찾지 못했다
- Januscape(CVE-2026-53359)의 CVSS 점수와 NVD 레코드를 직접 확인하지 못했다
- KubeVirt 네트워크 바인딩별 iperf 대조표와 라이브 마이그레이션 다운타임 수치가 공개돼 있지 않다
- Karpenter consolidation과 KubeVirt VM의 상호작용을 정면으로 다룬 1차 문서가 없다
- Dragonball의 성능 회귀를 다루는 업스트림 이슈(#5644)가 아직 열려 있어 "가장 빠른 Kata VMM"으로 단정할 수 없다

## 참고 자료

- [The True Cost of Containing: A gVisor Case Study](https://www.usenix.org/system/files/hotcloud19-paper-young.pdf) — Young et al., HotCloud '19. 시스템콜 지연 3자릿수 스펙트럼의 출처
- [Blending Containers and Virtual Machines: A Study of Firecracker and gVisor](https://pages.cs.wisc.edu/~swift/papers/vee20-isolation.pdf) — Anjali, Caraza-Harter, Swift, VEE '20. RTT 역전의 출처
- [Firecracker: Lightweight Virtualization for Serverless Applications](https://www.usenix.org/system/files/nsdi20-paper-agache.pdf) — Agache et al., NSDI '20. 부팅 요인 분해, VMM 메모리 상수, 네트워크 대역폭의 출처
- [An Updated Performance Comparison of Virtual Machines and Linux Containers](https://www.read.seas.harvard.edu/~kohler/class/cs260r-s19/containerperf14.pdf) — Felter et al., IEEE ISPASS 2015
- [A Fresh Look at the Architecture and Performance of Contemporary Isolation Platforms](https://arxiv.org/pdf/2110.11462) — van Rijn, Rellermeyer, Middleware '21. 기동 시간 정의 논쟁의 출처
- [Quark: A High-Performance Secure Container Runtime for Serverless Computing](https://arxiv.org/pdf/2309.12624) — Zhao et al., arXiv:2309.12624. TCP 연결 수립 시간, Kata 샌드박스 메모리의 출처
- [Some performance numbers for virtiofs, DAX and virtio-9p](https://www.mail-archive.com/virtio-fs@redhat.com/msg02371.html) — Vivek Goyal, 2020-12-10
- [I/O performance of Kata containers](https://www.stackhpc.com/kata-io-1.html) — Bharat Kunwar, StackHPC, 2019-05-09

- [Kata Containers Releases](https://github.com/kata-containers/kata-containers/releases) — 릴리스 일자
- [Kata Containers 4.0.0 Release Overview](https://katacontainers.io/blog/kata-containers-4-0-0-release-overview/) — runtime-rs 기본화
- [hypervisors.md](https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/hypervisors.md) — VMM 비교표
- [Limitations.md](https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/Limitations.md) — 동작하지 않는 것 목록
- [networking.md](https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/design/architecture/networking.md) — tcfilter·macvtap·bridge
- [vcpu-handling-runtime-go.md](https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/design/vcpu-handling-runtime-go.md) — vCPU 산정 공식
- [src/runtime/Makefile](https://raw.githubusercontent.com/kata-containers/kata-containers/main/src/runtime/Makefile) — `DEFMEMSZ`, `DEFDISABLEGUESTSECCOMP` 등 기본값
- [Kata Containers security advisories](https://github.com/kata-containers/kata-containers/security/advisories) — 2026년 advisory 10건
- [GHSA-2gv2-cffp-j227](https://github.com/kata-containers/kata-containers/security/advisories/GHSA-2gv2-cffp-j227) — virtiofsd 경유 탈출
- [GHSA-wwj6-vghv-5p64](https://github.com/kata-containers/kata-containers/security/advisories/GHSA-wwj6-vghv-5p64) — 부분 봉쇄 사례
- [Kubernetes RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/) — `overhead.podFixed`
- [gVisor Architecture Guide](https://gvisor.dev/docs/architecture_guide/intro/) — Sentry·Gofer 구조
- [gVisor Platforms](https://gvisor.dev/docs/architecture_guide/platforms/) — ptrace·KVM·systrap
- [gVisor Security Model](https://gvisor.dev/security/) — CVE 대상 범위
- [gVisor Performance Guide](https://gvisor.dev/docs/architecture_guide/performance/) — syscall.csv·density.csv 원본
- [Releasing Systrap](https://gvisor.dev/blog/2023/04/28/systrap-release/) — 2023-04-28
- [gVisor amd64 syscall 호환성](https://gvisor.dev/docs/user_guide/compatibility/linux/amd64/) — 277/351
- [gVisor, 실제 취약점 봉쇄 사례](https://gvisor.dev/blog/2020/09/18/containing-a-real-vulnerability/) — CVE-2020-14386 회피
- [KubeVirt FAQ.md](https://github.com/kubevirt/kubevirt/blob/main/FAQ.md) — Kata 비교 공식 입장
- [KubeVirt Architecture](https://kubevirt.io/user-guide/architecture/)
- [kubevirt/docs/components.md](https://github.com/kubevirt/kubevirt/blob/main/docs/components.md) — virt-launcher가 cgroup·namespace를 제공한다는 서술
- [Live Migration](https://kubevirt.io/user-guide/compute/live_migration/) — RWX 요구, 기본값 표
- [Interfaces and Networks](https://kubevirt.io/user-guide/network/interfaces_and_networks/) — masquerade·bridge·passt·SR-IOV
- [Node Overcommit](https://kubevirt.io/user-guide/compute/node_overcommit/)
- [pkg/hypervisor/kvm/hypervisorbackend.go](https://raw.githubusercontent.com/kubevirt/kubevirt/main/pkg/hypervisor/kvm/hypervisorbackend.go) — `GetMemoryOverhead` 상수
- [KubeVirt v1.9.0 changelog](https://kubevirt.io/2026/changelog-v1.9.0.html) — Beta 게이트 기본 on, cgroup v1 deprecated
- [Node Maintenance](https://kubevirt.io/user-guide/cluster_admin/node_maintenance/) — evictionStrategy·PDB·drain
- [KubeVirt | CNCF](https://www.cncf.io/projects/kubevirt/) — Incubating 상태
- [Confidential Containers 설계 개요](https://confidentialcontainers.org/docs/architecture/design-overview/)
- [CoCo CNCF Incubating 승격](https://www.cncf.io/blog/2026/07/22/confidential-containers-becomes-a-cncf-incubating-project/) — 2026-07-22
- [kubevirt/ADOPTERS.md](https://github.com/kubevirt/kubevirt/blob/main/ADOPTERS.md) — Cloudflare·NVIDIA·CoreWeave 등 채택 사례
- [Explore KubeVirt and Kata Containers](https://superuser.openinfra.org/articles/kubevirt-kata-containers-vm-use-case/) — Josh Berkus, Stephen Gordon, Superuser, 2018-03-20

- [AKS Pod Sandboxing 고려사항](https://learn.microsoft.com/en-us/azure/aks/considerations-pod-sandboxing) — 파드 VM 크기별 오버헤드 실측 표
- [AKS Pod Sandboxing](https://learn.microsoft.com/en-us/azure/aks/use-pod-sandboxing) — `kata-vm-isolation`, `uname -r` 확인법
- [AWS EC2 중첩 가상화 발표](https://aws.amazon.com/about-aws/whats-new/2026/02/amazon-ec2-nested-virtualization-on-virtual/) — 2026-02-16
- [GCP 중첩 가상화](https://docs.cloud.google.com/compute/docs/instances/nested-virtualization/overview)
- [NVIDIA GPU Operator + Kata](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/deploy-kata-containers.html)
- [GKE Sandbox](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods)
- [Red Hat, KubeVirt Scale Test: Creating 400 VMIs Per Node](https://www.redhat.com/en/blog/kubevirt-scale-test-creating-400-vmis-per-node) — 2022-08-15
- [Enterprises fleeing Broadcom move to OpenShift Virtualization](https://www.techtarget.com/searchitoperations/news/366643085/Enterprises-fleeing-Broadcom-move-to-OpenShift-Virtualization) — TechTarget, 2026-05-15
- [cncf/tab#147](https://github.com/cncf/tab/issues/147) — Ant Group Kata AI 에이전트 샌드박스, PVM 부팅 실측
- [Alibaba ACK Sandboxed Container](https://www.alibabacloud.com/help/en/ack/ack-managed-and-ack-dedicated/user-guide/overview-10/)

- [container-runtime-benchmarks](https://github.com/bikramkgupta/container-runtime-benchmarks) — 2026년 runc/Kata/gVisor 3자 비교의 출처

- [Januscape CVE-2026-53359 (The Hacker News)](https://thehackernews.com/2026/07/16-year-old-linux-kvm-flaw-lets-guest.html) — 2026년 7월
- [VENOM CVE-2015-3456 (Red Hat)](https://access.redhat.com/security/cve/cve-2015-3456)
- [GHSA-4fj4-9m67-3mj3 (CVE-2025-2713)](https://github.com/advisories/GHSA-4fj4-9m67-3mj3) — 2025-03-28
- [GHSA-9493-h29p-rfm2 (CVE-2025-31133)](https://github.com/opencontainers/runc/security/advisories/GHSA-9493-h29p-rfm2) — 2025-11-05
- [CNCF, runc 탈출 취약점 기술 개요](https://www.cncf.io/blog/2025/11/28/runc-container-breakout-vulnerabilities-a-technical-overview/)
