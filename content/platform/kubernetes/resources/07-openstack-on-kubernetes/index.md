---
title: "OpenStack on Kubernetes — 컨트롤 플레인은 파드로, VM은 여전히 베어메탈의 KVM으로"
linkTitle: "07 OpenStack on Kubernetes"
description: "OpenStack on Kubernetes가 Kubernetes에 올리는 것과 호스트에 남기는 것, VM 하나가 만들어지는 경로, 컴퓨트 노드를 Kubernetes에 넣는 구현과 넣지 않는 구현의 차이, 얻는 것과 어려운 곳, 스토리지 결정 지점, KubeVirt와의 대비를 근거 등급과 함께 정리한다."
weight: 7
date: 2026-10-05
lastmod: 2026-10-05
url: "/k8s-features/07-openstack-on-kubernetes/"
---

# 07 · OpenStack on Kubernetes — 컨트롤 플레인은 파드로, VM은 여전히 베어메탈의 KVM으로

OpenStack on Kubernetes는 VM을 관리하는 OpenStack 서비스를 파드로 배포하는 구성입니다. OpenStack-Helm 소스에서는 API·scheduler·conductor와 MariaDB·RabbitMQ가 파드로 실행됩니다. VM을 실행하는 쪽은 여전히 컴퓨트 노드의 libvirt와 QEMU/KVM입니다. libvirt 문서를 읽어 보면 VM 하나는 호스트에서 도는 QEMU 프로세스 하나로 보입니다. 이 일대일 대응은 제 정리입니다.

컴퓨트 노드의 서비스까지 파드로 배포하는지는 구현마다 다릅니다. OpenStack-Helm은 nova-compute와 libvirt도 Kubernetes에 넣습니다. RHOSO(Red Hat OpenStack Services on OpenShift)는 업스트림 문서 기준으로 컨트롤 플레인만 Kubernetes에 두며, 제품 문서 본문은 확인하지 못했습니다.

근거 표기 — `✓` 원문 직접 확인 · `Ⓥ` 벤더·프로젝트 주장 · `Ⓑ` 벤치마크 수치 · `≈` 눈대중·역산 · `Σ` 여러 사실을 이은 종합 추론 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 조사일은 2026-10-05입니다. Nova 문서는 `latest`(34.1.0.dev22), OpenStack-Helm 소스는 GitHub 미러의 master 기준입니다. KubeVirt와의 비교는 [04 KubeVirt]({{< relref "/platform/isolation/04-kubevirt/index.md" >}})에서 이어집니다.

## 1. 무엇이 파드가 되고 무엇이 호스트에 남는가

{{< flow src="_flow/1-파드와-호스트.json" />}}

| 컴포넌트 | 하는 일 | 형태(OpenStack-Helm 소스) | 근거 |
|---|---|---|---|
| nova-api | REST 요청을 받아 큐로 넘김 | Deployment | |
| nova-scheduler | 인스턴스를 놓을 호스트 선택 | Deployment(StatefulSet 템플릿도 있음) | |
| nova-conductor | 생성·리사이즈처럼 조율이 필요한 요청 처리, 컴퓨트 노드 대신 DB 접근 | Deployment(StatefulSet 템플릿도 있음) | |
| Placement | 호스트별 자원 재고와 사용량 추적 | 별도 차트(`placement`) | |
| MariaDB | 컨트롤 서비스의 DB. 기본 3개 복제본 | StatefulSet | |
| RabbitMQ | 서비스 사이 RPC 메시지 큐. 기본 2개 복제본 | StatefulSet | |
| nova-compute | 컴퓨트 노드마다 하나. 큐에서 요청을 받아 하이퍼바이저를 조작 | DaemonSet. hostNetwork·hostPID·hostIPC·privileged | |
| libvirtd | QEMU 프로세스의 생성·감독 | DaemonSet. hostNetwork·hostPID·hostIPC·privileged | |
| Open vSwitch, OVN controller, neutron OVS agent | VM 네트워크 데이터 경로 | DaemonSet. hostNetwork | |
| QEMU/KVM 프로세스 | VM 하나의 CPU·메모리 실행 | 호스트 프로세스 | |

OpenStack-Helm에서는 VM 관리 서비스가 파드가 됩니다. 컴퓨트 노드에서 하이퍼바이저를 조작하는 nova-compute와 QEMU를 생성·감독하는 libvirtd도 여기에 포함됩니다. VM 자체를 Kubernetes 객체로 다루는 구성은 아닙니다. libvirt는 QEMU 바이너리를 실행하며, 이를 VM과 프로세스의 일대일 관계로 설명한 부분은 이 글의 해석입니다.

그림에서는 위쪽 컨트롤 서비스 상자와 아래쪽 컴퓨트 노드 상자의 경계를 보면 됩니다. 위쪽의 API·RabbitMQ·scheduler·MariaDB는 상태를 DB와 큐에 두고 RPC(다른 프로세스의 기능을 호출하는 방식)로 서로를 부릅니다. 이런 서비스는 Deployment나 StatefulSet으로 다루기 쉬울 것으로 보입니다. 아래쪽에서는 kubelet이 nova-compute와 libvirt 파드를 띄웁니다. 시작 스크립트를 읽어 보면 QEMU가 파드의 자식으로 남지 않게 하려는 설계로 보입니다. 이 부분은 4절에서 살펴봅니다.

OpenStack-Helm의 컴퓨트 노드 파드는 호스트 자원에 접근하는 설정을 씁니다. DaemonSet은 대상 노드마다 파드를 띄우는 워크로드입니다. hostNetwork는 파드가 노드의 네트워크 네임스페이스를 쓰는 설정이고, hostPID는 노드의 프로세스가 파드에서 보이게 하는 설정입니다. 이 용어들은 뒤에서도 계속 나옵니다. libvirt 문서에 따르면 KVM을 쓰려면 `/dev/kvm`도 있어야 합니다.

왜 nova-compute가 DB에 직접 접근하지 않고 conductor를 거칠까요? Nova 문서는 업그레이드 때의 통신 호환성으로 설명합니다. DB 접근을 conductor가 맡으면 컨트롤 플레인을 먼저 업그레이드해도 이전 릴리스의 컴퓨트 노드와 통신할 수 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 그림은 컨트롤 서비스와 컴퓨트 노드의 경계를 보여 줌 | 위쪽 상자와 아래쪽 상자를 나눠 읽음 | — | — |
| 컨트롤 서비스를 Deployment나 StatefulSet으로 다루기 쉬움 | 위쪽의 API·RabbitMQ·scheduler·MariaDB가 상태를 DB와 큐에 두고 RPC로만 서로를 부르는 서비스라는 설명을 이은 판단 | — | `Σ` |
| 컴퓨트 서비스 파드와 QEMU의 수명을 분리하려는 설계로 해석 | kubelet은 nova-compute와 libvirt 파드를 띄우지만, VM인 QEMU 프로세스는 그 파드의 자식으로 남지 않도록 설계된 것으로 읽음. 4절 참조 | — | `Σ` |
| nova-api의 역할과 배포 형태 | REST 요청을 받아 큐로 넘김. Deployment | Nova 문서(역할), OpenStack-Helm 소스(배포 형태·기본값) | `✓` |
| nova-scheduler의 역할과 배포 형태 | 인스턴스를 놓을 호스트 선택. Deployment이며 StatefulSet 템플릿도 있음 | Nova 문서(역할), OpenStack-Helm 소스(배포 형태·기본값) | `✓` |
| nova-conductor의 역할과 배포 형태 | 생성·리사이즈처럼 조율이 필요한 요청 처리, 컴퓨트 노드 대신 DB 접근. Deployment이며 StatefulSet 템플릿도 있음 | Nova 문서(역할), OpenStack-Helm 소스(배포 형태·기본값) | `✓` |
| Placement의 역할과 배포 형태 | 호스트별 자원 재고와 사용량 추적. 별도 차트(`placement`) | Nova 문서(역할), OpenStack-Helm 소스(배포 형태·기본값) | `✓` |
| MariaDB의 역할과 기본값 | 컨트롤 서비스의 DB. StatefulSet, 기본 3개 복제본 | Nova 문서(역할), OpenStack-Helm 소스(배포 형태·기본값) | `✓` |
| RabbitMQ의 역할과 기본값 | 서비스 사이 RPC 메시지 큐. StatefulSet, 기본 2개 복제본 | Nova 문서(역할), OpenStack-Helm 소스(배포 형태·기본값) | `✓` |
| nova-compute의 역할과 배포 형태 | 컴퓨트 노드마다 하나. 큐에서 요청을 받아 하이퍼바이저를 조작. DaemonSet, hostNetwork·hostPID·hostIPC·privileged | Nova 문서(역할), OpenStack-Helm 소스(DaemonSet·호스트 설정) | `✓` |
| libvirtd의 역할과 배포 형태 | QEMU 프로세스의 생성·감독. DaemonSet, hostNetwork·hostPID·hostIPC·privileged | Nova 문서(역할), OpenStack-Helm 소스(DaemonSet·호스트 설정) | `✓` |
| VM 네트워크 데이터 경로의 배포 형태 | Open vSwitch, OVN controller, neutron OVS agent. DaemonSet, hostNetwork | OpenStack-Helm 소스 | `✓` |
| QEMU/KVM 프로세스와 VM의 관계 | VM 하나의 CPU·메모리 실행을 담당하는 호스트 프로세스라는 정리 | libvirt 문서 | `✓` `≈` |
| 뒤에서 사용하는 Kubernetes 용어 | DaemonSet은 노드마다 파드를 하나씩 띄우는 워크로드, hostNetwork는 파드가 노드의 네트워크 네임스페이스를 쓰는 설정, hostPID는 노드의 프로세스가 파드에서 보이는 설정 | — | — |
| conductor가 컴퓨트 노드 대신 DB에 접근하는 이유 | 컴퓨트 노드가 DB에 직접 붙지 않으면 컨트롤 플레인을 먼저 업그레이드해도 이전 릴리스의 컴퓨트 노드와 통신 가능 | Nova 문서 | `✓` |
| libvirt의 QEMU 실행 방식과 KVM 사용 조건 | QEMU 바이너리 하나를 실행하는 방식. KVM을 쓰려면 `/dev/kvm` 필요 | libvirt 문서 | `✓` |
| “VM은 호스트 프로세스 하나”라는 설명의 범위 | libvirt 문서를 읽고 VM과 프로세스를 일대일로 대응시킨 저자의 정리 | libvirt 문서 | `≈` |

{{% /details %}}

## 2. VM 하나가 만들어지는 경로

{{< seq src="_seq/2-VM-하나가-만들어지는-경로.json" />}}

| 단위 | 누가 보는가 | 하는 일 | 근거 |
|---|---|---|---|
| cell | 운영자 | 컴퓨트 노드를 샤딩. 셀마다 DB·큐·conductor가 따로 있음 | |
| availability zone(AZ) | 사용자 | 사용자가 고르는 논리 구역. aggregate에 메타데이터를 붙여 정의 | |
| host aggregate | 운영자 | 임의의 특성으로 호스트를 나눔. 운영자가 flavor와 연결 | |

그림에서는 요청이 컨트롤 서비스 파드 사이를 큐로 오가다 컴퓨트 노드의 nova-compute에서 끝나고, 그 사이에 Kubernetes API가 나오지 않는다는 점을 보면 됩니다.

요청은 어떻게 컴퓨트 노드까지 도착할까요? Placement가 호스트의 자원 재고와 사용량을 기록해 후보를 제공하고, scheduler가 인스턴스를 놓을 호스트를 고릅니다. conductor는 생성·리사이즈를 조율하며 컴퓨트 노드 대신 DB에 접근합니다. 각 컴포넌트의 역할은 Nova 문서에 있고, 이 순서로 이은 것은 제 종합입니다. 순서 어디에도 Kubernetes API는 나오지 않습니다.

요청을 받은 nova-compute는 하이퍼바이저가 있는 노드에서 동작합니다. Nova 문서의 기본 구성에서는 libvirt를 거쳐 KVM·QEMU를 사용합니다. 문서는 conductor를 nova-compute와 같은 노드에 두지 않도록 안내합니다.

컴퓨트 노드를 묶는 기준도 Nova 안에 있습니다. cell은 DB·큐·conductor를 나눠 컴퓨트 노드를 분할하는 단위입니다. AZ는 사용자가 선택하는 논리 구역이고, host aggregate는 호스트 특성을 묶어 flavor와 연결하는 단위입니다. Nova 문서는 AZ 자체가 장애 도메인을 뜻하지는 않는다고 명시합니다. 이 글에서는 region 아래의 cell과 AZ를 서로 다른 축으로, host aggregate를 AZ 아래에 붙는 묶음으로 설명합니다.

이 묶음들은 Nova DB의 레코드입니다. Kubernetes 쪽에는 OpenStack-Helm과 MOSK의 `openstack-compute-node=enabled` 노드 라벨, RHOSO의 `OpenStackDataPlaneNodeSet` CR(사용자 정의 리소스)이 있습니다. 문서들을 종합하면 라벨과 CR은 nova-compute를 설치할 노드를 지정하고, 이후 VM의 배치는 Nova가 결정하는 관계입니다.

VM을 어느 호스트에 만들지는 Nova가 정합니다. Kubernetes는 nova-compute 같은 서비스를 배포할 노드를 정하는 데 관여합니다. Nova의 컴포넌트 정의와 각 구현의 노드 배포 방식을 이어서 추정한 구분입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 그림에서 읽을 요청 경로 | 컨트롤 서비스 파드 사이를 큐로 오가던 요청이 컴퓨트 노드의 nova-compute에서 끝남. 그 사이에 Kubernetes API가 등장하지 않음 | — | — |
| 각 컴포넌트의 역할 | scheduler는 인스턴스를 놓을 호스트 선택. Placement는 호스트의 자원 재고와 사용량을 기록해 scheduler에 후보 제공. conductor는 생성·리사이즈 조율 및 컴퓨트 노드 대신 DB 접근 | Nova 문서 | `✓` |
| 컴포넌트를 VM 생성 순서로 연결 | 개별 컴포넌트 정의를 그림의 순서로 이은 것은 종합 | — | `Σ` |
| nova-compute의 실행 위치와 기본 하이퍼바이저 | 하이퍼바이저가 있는 노드에서 한 프로세스씩 실행. 기본 하이퍼바이저는 libvirt를 거친 KVM·QEMU. nova.conf 설정은 `compute_driver = libvirt.LibvirtDriver`, `virt_type = kvm` | Nova 문서 | `✓` |
| conductor의 배치 안내 | nova-compute와 같은 노드에 두지 않도록 안내 | Nova 문서 | `✓` |
| cell의 역할 | 운영자가 보는 컴퓨트 노드 샤딩 단위. 셀마다 DB·큐·conductor가 따로 있음 | Nova 문서 | `✓` |
| availability zone(AZ)의 역할 | 사용자가 고르는 논리 구역. aggregate에 메타데이터를 붙여 정의 | Nova 문서 | `✓` |
| host aggregate의 역할 | 운영자가 임의의 특성으로 호스트를 나누고 flavor와 연결 | Nova 문서 | `✓` |
| AZ와 장애 도메인의 관계 | AZ가 곧 장애 도메인은 아님 | Nova 문서 | `✓` |
| region·cell·AZ·host aggregate의 관계 | region 아래에 cell과 AZ가 서로 다른 축으로 놓임. cell은 운영자가 보는 DB·큐 샤딩, AZ는 사용자가 고르는 이름. AZ 아래에 host aggregate가 붙는 것으로 정리 | — | `Σ` |
| Nova의 노드 묶음이 저장되는 곳 | cell·AZ·host aggregate는 Nova DB의 레코드이며 Kubernetes 객체가 아님 | — | — |
| Kubernetes 쪽의 노드 지정 수단 | OpenStack-Helm과 MOSK의 `openstack-compute-node=enabled` 노드 라벨, RHOSO의 `OpenStackDataPlaneNodeSet` CR | OpenStack-Helm prerequisites 문서, MOSK 문서, openstack-operator 업스트림 문서 | `✓` |
| 노드 배포 대상과 VM 배치의 관계 | 노드 라벨과 CR은 어느 노드에 nova-compute를 설치할지 정함. VM을 어디에 놓을지는 Nova가 결정 | — | `Σ` |

{{% /details %}}

## 3. 컴퓨트 노드를 Kubernetes에 넣는가

| 구분 | 전부 Kubernetes | 컨트롤만 Kubernetes |
|---|---|---|
| 대표 | OpenStack-Helm, MOSK, Yaook | RHOSO |
| 컴퓨트 노드의 kubelet | 있음. 노드 라벨로 대상 선택 | 없음. RHEL 노드를 Ansible로 관리 |
| nova-compute·libvirt | DaemonSet 파드 | 호스트의 RPM 또는 podman 컨테이너 |
| 컴퓨트 노드 배포 | helm 또는 오퍼레이터가 파드를 만듦 | `OpenStackDataPlaneDeployment`가 Ansible을 실행해 SSH로 접속 |
| 노드 유지보수 | `kubectl drain`은 맞지 않음. DaemonSet 파드는 drain 대상이 아니고 VM은 Kubernetes 객체가 아님. Atmosphere 문서는 `nova host-evacuate-live` 사용 | 확인하지 못함 |
| 근거 | 직접 확인 | 직접 확인·미확인 |

| 구현 | 컨트롤 플레인 | 컴퓨트 쪽 | 상태·근거 |
|---|---|---|---|
| Canonical Sunbeam | Kubernetes 위 Charmed Operator, Rock 이미지 | 호스트의 snap | 문서 확인. snap 이름 미확인 |
| Mirantis MOSK | Rockoon 오퍼레이터가 CR을 OpenStack-Helm values로 변환 | 노드 라벨, privileged·hostPID 파드 | 문서 확인. 호스트 접근을 설명하는 서술도 문서에 있음(4절) |
| VEXXHOST Atmosphere | Ansible 컬렉션으로 배포 | libvirt에 Helm values를 넘김 | 컴퓨트가 파드라는 것은 추정 |
| Yaook | 오퍼레이터와 라벨·taint 스케줄링 | `NovaComputeNode` CR, 노드별 StatefulSet으로 보임 | 추정 |
| StarlingX | Kubernetes 위에 OpenStack을 애플리케이션으로 설치 | 차트가 OpenStack-Helm 기반인지 불명 | 미확인 |
| Airship | 베어메탈부터 Kubernetes와 차트 배포까지 | 확인하지 않음 | 사이트 최신 언급이 2021년. 현재 상태 미확인 |
| Kolla·kolla-ansible | Ansible이 컨테이너를 배포. Kubernetes 아님 | 같음 | 직접 확인 |

구현은 컴퓨트 노드를 Kubernetes에 넣느냐에 따라 나뉩니다. OpenStack-Helm에서는 kubelet이 nova-compute와 libvirt 파드를 실행합니다. RHOSO에서는 Kubernetes 안에서 실행한 Ansible이 외부 RHEL 노드에 접속해 컴퓨트 서비스를 배포합니다. RHOSO 설명은 업스트림 저장소의 asciidoc을 바탕으로 했으며, RHOSO 18 제품 문서 본문은 읽지 못했습니다.

OpenStack-Helm의 컴퓨트 파드는 호스트 접근 권한을 넓게 사용합니다. 소스에는 nova-compute와 libvirt 모두 호스트의 네트워크·프로세스·IPC 네임스페이스를 쓰고 privileged로 실행하도록 설정되어 있습니다. libvirt는 호스트 경로도 양방향으로 마운트합니다. Yaook 문서는 privileged를 제거할 수 있는지 검토했지만, `/dev/kvm` 접근과 nova·libvirt 사이의 소켓 통신, 양방향 마운트 때문에 불가능하다고 결론 냈습니다.

RHOSO는 컨트롤 플레인과 데이터 플레인을 다른 수단으로 관리합니다. openstack-operator가 컨트롤 플레인 CR을 맞추고, 데이터 플레인 노드에는 Ansible이 SSH로 접속합니다. 업스트림 설계 문서는 이 경로에서 Ansible이 Deployment·Pod 같은 워크로드 API와 kubelet을 대신한다고 설명합니다. 노드에 설치되는 소프트웨어는 RPM 또는 podman 컨테이너입니다.

DaemonSet 파드는 drain 대상이 아닙니다. 컴퓨트 서비스를 파드로 배포해도 VM은 Kubernetes 객체가 아니므로, 이 글의 추정으로는 VM을 옮기는 일을 Kubernetes가 맡지 않고 `kubectl drain`도 컴퓨트 노드 유지보수에 맞지 않습니다. Atmosphere 문서는 `nova host-evacuate-live`를 사용합니다. RHOSO의 해당 절차는 확인하지 못했습니다.

Atmosphere의 컴퓨트가 파드인지, Yaook의 nova-compute가 노드별 StatefulSet인지는 확인하지 못했습니다. 둘 다 추정으로 남아 있습니다. Kolla 계열은 Ansible이 컨테이너를 배포하므로 이 글의 범위에서 제외합니다. 은퇴한 kolla-kubernetes의 README는 OpenStack-Helm을 대안으로 안내합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 컴퓨트까지 Kubernetes에 넣는 구성 | 대표는 OpenStack-Helm, MOSK, Yaook. 컴퓨트 노드에 kubelet이 있고 노드 라벨로 대상 선택. 비교표에서는 nova-compute·libvirt를 DaemonSet 파드로 정리. helm 또는 오퍼레이터가 파드를 생성 | — | `✓` |
| 컨트롤만 Kubernetes에 넣는 구성 | 대표는 RHOSO. 컴퓨트 노드에 kubelet이 없고 RHEL 노드를 Ansible로 관리. nova-compute·libvirt는 호스트의 RPM 또는 podman 컨테이너. `OpenStackDataPlaneDeployment`가 Ansible을 실행해 SSH로 접속. 업스트림 확인과 제품 문서 미확인이 함께 있는 설명 | — | `✓` `?` |
| `kubectl drain`과 컴퓨트 노드 유지보수 | DaemonSet 파드는 drain 대상이 아니고 VM은 Kubernetes 객체가 아니므로 적합하지 않다는 판단 | — | `Σ` |
| Atmosphere의 컴퓨트 노드 유지보수 | `nova host-evacuate-live` 사용 | Atmosphere 문서 | `✓` |
| RHOSO의 컴퓨트 노드 유지보수 | 확인하지 못함 | — | `?` |
| OpenStack-Helm nova-compute의 배포·권한 설정 | DaemonSet. `hostNetwork`, `hostPID`, `hostIPC`가 모두 true. 컨테이너는 `privileged` | OpenStack-Helm 소스 | `✓` |
| OpenStack-Helm libvirt의 배포·권한·마운트 설정 | DaemonSet. nova-compute와 같은 호스트 네임스페이스·권한 설정. `/var/lib/libvirt`와 `/var/lib/nova`를 `mountPropagation: Bidirectional`로 마운트 | OpenStack-Helm 소스 | `✓` |
| Yaook이 privileged를 제거할 수 없다고 판단한 이유 | `/dev/kvm` 접근, nova와 libvirt의 소켓 통신, Bidirectional 마운트 필요 | Yaook 문서 | `✓` |
| RHOSO 컨트롤 플레인과 데이터 플레인의 관리 경로 | openstack-operator가 컨트롤 플레인 CR을 맞춤. 데이터 플레인은 RHEL 노드. Ansible이 Deployment·Pod 같은 워크로드 API와 kubelet을 대신함. Ansible 실행은 클러스터 안의 워크로드이며 데이터 플레인 노드에는 SSH로 접속 | openstack-operator 업스트림 저장소의 설계 문서·asciidoc | `✓` |
| RHOSO 데이터 플레인의 소프트웨어 형태 | RPM 또는 podman 컨테이너 | openstack-operator 업스트림 저장소의 asciidoc | `✓` |
| RHOSO 제품 문서 확인 범위 | docs.redhat.com의 RHOSO 18 제품 문서 본문을 읽지 못함 | RHOSO 18 제품 문서 | `?` |
| Canonical Sunbeam의 구성 | 컨트롤 플레인은 Kubernetes 위 Charmed Operator와 Rock 이미지. 컴퓨트는 호스트의 snap | Canonical Sunbeam 문서 | `✓` |
| Canonical Sunbeam의 snap 이름 | 확인하지 못함 | — | `?` |
| Mirantis MOSK의 구성 | Rockoon 오퍼레이터가 CR을 OpenStack-Helm values로 변환. 컴퓨트는 노드 라벨과 privileged·hostPID 파드 사용. 호스트 접근을 설명하는 문장은 4절 참조 | Mirantis MOSK 문서 | `✓` |
| VEXXHOST Atmosphere의 구성 | Ansible 컬렉션으로 배포. libvirt에 Helm values를 넘김 | Atmosphere 문서 | — |
| VEXXHOST Atmosphere의 추정 범위 | 컴퓨트가 파드라는 것 | — | `≈` |
| Yaook의 구성과 추정 범위 | 오퍼레이터와 라벨·taint 스케줄링, `NovaComputeNode` CR 사용. 노드별 StatefulSet으로 보임 | — | `≈` |
| StarlingX의 구성과 미확인 범위 | Kubernetes 위에 OpenStack을 애플리케이션으로 설치. 차트가 OpenStack-Helm 기반인지는 불명 | — | `?` |
| Airship의 범위와 확인 한계 | 베어메탈부터 Kubernetes와 차트 배포까지 다룸. 컴퓨트 쪽은 확인하지 않음. 사이트 최신 언급은 2021년 | Airship 사이트 | `?` |
| Kolla·kolla-ansible의 배포 방식 | Ansible이 컨트롤 플레인과 컴퓨트의 컨테이너를 배포. Kubernetes를 쓰는 계열이 아님 | — | `✓` |
| 이 글에서 Kolla 계열을 제외하는 이유 | 컨테이너로 실행하지만 오케스트레이터가 Ansible이므로 대상에서 제외 | — | — |
| kolla-kubernetes의 은퇴와 대안 안내 | 2018-05-02 은퇴. README는 OpenStack-Helm을 대안으로 안내 | governance legacy.yaml(은퇴 날짜), kolla-kubernetes README(대안 안내) | `✓` |

{{% /details %}}

## 4. 얻는 것과 어려운 곳

아래 표는 프로젝트와 벤더가 내세우는 이점이며 이 글이 검증한 것은 아닙니다.

| 주장 | 누가 | 내용 |
|---|---|---|
| 롤링 업데이트 | OpenStack-Helm | OpenStack-Helm이 설명하기로는 모든 업그레이드를 Helm으로 하고, 이미지 변경은 컨테이너 롤링 교체로 처리 |
| 설정 변경도 롤링 | OpenStack-Helm | OpenStack-Helm이 설명하기로는 차트의 configmap에 annotation을 달아 설정 변경이 롤링을 일으킴. 기본값은 `max_unavailable: 1`, `max_surge: 3` |
| 자동 복구 | Airship | Airship이 설명하기로는 모든 서비스가 컨테이너이고 Kubernetes 감독으로 복구됨 |
| 선언형 조정 | MOSK, Yaook | MOSK와 Yaook이 설명하기로는 CR을 값으로 바꿔 계속 맞춤. Yaook은 변경이 없어도 주기적으로 조정한다고 설명 |
| Day 2 운영 | Red Hat 보도자료 | Red Hat 보도자료에 따르면 컨트롤 플레인 운영이 쉬워짐. "컴퓨트 노드 배포가 17.1보다 4배 빠르다"는 측정 조건이 공개되지 않음 |

| 어려운 곳 | 확인한 것 | 근거 |
|---|---|---|
| libvirt 파드 재시작 | 시작 스크립트가 libvirtd를 파드 cgroup 밖으로 뺌 | |
| VM 트래픽 | OVS DaemonSet 롤아웃이 데이터 경로를 끊었다고 VEXXHOST가 보고 | |
| 상태 저장 서비스 | Galera·RabbitMQ를 StatefulSet으로 운영 | |
| 아래층 Kubernetes | OpenStack-Helm이 범위 밖으로 둠 | |
| 업그레이드 | Nova의 순서와 DB 마이그레이션은 그대로 | |

프로젝트들이 내세우는 이점은 배포와 갱신, 복구를 Kubernetes 방식으로 다룬다는 데 있습니다. OpenStack-Helm은 Helm을 이용한 롤링 업데이트를, Airship은 Kubernetes의 서비스 복구를 설명합니다. MOSK와 Yaook은 CR에 맞춰 구성을 계속 조정한다고 합니다. 이 글은 이런 이점을 직접 검증하지 않았습니다. Red Hat 보도자료의 배포 속도 주장도 측정 조건이 공개되지 않았습니다.

어느 부분에서 이점을 기대할 수 있을까요? 이 글의 해석으로는 컨트롤 플레인 쪽에 집중됩니다. API·scheduler·conductor는 상태를 DB와 큐에 두므로 롤링 재시작과 수평 확장이 잘 맞는 구성으로 보입니다. 컴퓨트 노드 쪽 이점은 DaemonSet으로 에이전트 버전을 맞추는 정도로 보입니다. 어려운 곳은 대부분 그 컴퓨트 노드에 있습니다.

먼저 libvirt 파드를 재시작할 때를 보겠습니다. OpenStack-Helm 시작 스크립트는 libvirtd를 파드의 cgroup(프로세스의 자원을 묶어 관리하는 커널 단위) 밖에서 실행합니다. 호스트 프로세스와 경로에 접근하는 설정까지 함께 보면, 파드를 정리할 때 QEMU가 종료되지 않도록 하려는 장치로 해석됩니다. 실제로 libvirt 파드를 삭제해 VM이 살아남는지는 시험하지 않았습니다. libvirtd 재시작이 게스트를 유지한다는 libvirt 공식 문장도 찾지 못했습니다.

컨트롤 플레인이 내려가면 실행 중인 VM도 멈출까요? Nova 업그레이드 문서는 VM 중단이 없어야 한다고 적고, nova-compute를 제외한 서비스를 내렸다 올리는 절차를 안내합니다. VM 실행 경로에 API·scheduler·DB·큐가 없다는 점을 함께 보면 생성·삭제·마이그레이션은 멈춰도 실행 중인 VM은 계속 돈다고 추론할 수 있습니다. 컨트롤 플레인 중단 상황을 그대로 설명한 공식 문장은 확인하지 못했습니다. 호스트 재부팅 뒤 게스트를 다시 켜는 동작은 별도 설정인 `resume_guests_state_on_host_boot`가 정합니다.

네트워크에서는 OVS DaemonSet이 재시작될 때 데이터 경로가 끊겼다는 벤더 보고가 있습니다. OpenStack-Helm의 OVS·Neutron 관련 파드는 호스트 네트워크를 사용합니다. 설치 설정은 노드 NIC를 브리지에 붙이고 IP도 옮깁니다. 그 NIC에 Kubernetes 노드 IP가 있다면 kubelet과 CNI(컨테이너 네트워크 인터페이스)가 쓰는 주소도 이동한다는 해석이 가능합니다. OpenStack-Helm 테스트 환경은 CNI로 Calico를 설치하므로, 추정하면 한 노드에 파드용과 VM용 데이터 경로가 함께 있습니다. VEXXHOST는 OVS 자체에 변화가 없어도 이미지 갱신에 따른 DaemonSet 재시작이 모든 노드의 데이터 경로를 끊었다고 보고했습니다. CNI와 Neutron의 공존·충돌을 설명하는 공식 문장은 찾지 못했습니다.

상태 저장 서비스와 아래층 Kubernetes도 남습니다. Galera·RabbitMQ는 StatefulSet으로 배포하지만 스토리지 선택은 구현마다 다릅니다. MOSK와 Atmosphere는 서비스별 RabbitMQ를 사용합니다. OpenStack-Helm 문서는 Kubernetes 설치를 범위 밖으로 둡니다. OpenStack이 Kubernetes 위에 있으므로 그 Kubernetes의 노드를 같은 OpenStack의 Nova로 만들 수 없습니다. 추정하면 Ceph도 OpenStack보다 먼저 떠 있어야 합니다. Airship과 MOSK는 베어메탈 프로비저닝부터 맡는다고 설명하고, RHOSO는 OpenShift의 Cluster Baremetal Operator와 Ironic을 사용합니다. 순환 의존 자체를 직접 다룬 공식 문장은 확인하지 못했습니다.

업그레이드 순서도 Nova의 규칙을 따릅니다. Nova 문서는 Placement를 nova 서비스보다 먼저 올려야 한다고 적고, 새 코드로 DB를 동기화(cell0 포함)한 뒤 conductor를 먼저 시작해 API를 마지막에 올리는 것이 가장 안전하다고 안내합니다. DB 다운그레이드는 지원하지 않으므로 Helm으로 이미지만 되돌려도 스키마는 돌아오지 않을 것으로 예상됩니다. 문서들을 종합하면 Kubernetes가 파드를 차례로 교체하더라도 서비스 순서와 DB 작업은 차트와 오퍼레이터에 반영해야 합니다.

MOSK 문서는 Kubernetes의 역할을 주로 오케스트레이션과 의존성 격리로 설명합니다. 여러 OpenStack 서비스가 호스트의 프로세스·네트워크에 접근하는 privileged 컨테이너로 실행된다는 설명도 함께 적고 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 이점의 검증 수준 | 이 절에서 소개한 이점은 프로젝트가 내세우는 주장이며 이 글에서 검증하지 않음 | — | `Ⓥ` |
| 롤링 업데이트 주장 | 모든 업그레이드를 Helm으로 수행. 이미지 변경은 컨테이너 롤링 교체로 처리 | OpenStack-Helm | `Ⓥ` |
| 설정 변경에 따른 롤링 | 차트의 configmap에 annotation을 달아 설정 변경이 롤링을 일으킴. 기본값은 `max_unavailable: 1`, `max_surge: 3` | OpenStack-Helm | `Ⓥ` `✓` |
| 자동 복구 주장 | 모든 서비스가 컨테이너이며 Kubernetes 감독으로 복구됨 | Airship | `Ⓥ` |
| 선언형 조정 | CR을 값으로 바꿔 계속 맞춤. Yaook은 변경이 없어도 주기적으로 조정 | MOSK, Yaook | `Ⓥ` |
| Day 2 운영과 배포 속도 주장 | 컨트롤 플레인 운영이 쉬워진다는 설명. "컴퓨트 노드 배포가 17.1보다 4배 빠르다"는 측정 조건 비공개 | Red Hat 보도자료 | `Ⓥ` |
| 컨트롤 플레인에 이점이 집중된다는 판단 | API·scheduler·conductor는 상태가 DB와 큐에 있어 롤링 재시작과 수평 확장이 맞는다는 해석 | — | `Σ` |
| 컴퓨트 노드 쪽 이점의 범위 | DaemonSet으로 에이전트 버전을 맞추는 정도라는 판단 | — | `Σ` |
| 어려움이 집중되는 위치 | 대부분 컴퓨트 노드 쪽에 있다는 이 글의 설명 | — | — |
| libvirt 파드 재시작을 고려한 실행 위치 | 시작 스크립트가 libvirtd를 파드 cgroup 밖으로 뺌 | OpenStack-Helm libvirt 시작 스크립트 | `✓` |
| 스크립트의 주석과 마지막 명령 | "changing CGROUP is required as restart of the pod will cause domains restarts". 마지막 줄은 `cgexec -g ...:/osh-libvirt systemd-run --scope --slice=system libvirtd --listen` | OpenStack-Helm libvirt 시작 스크립트 | `✓` |
| cgroup 용어와 명령 해설 | cgroup은 프로세스가 쓰는 자원을 묶는 커널 단위. 명령은 cgroup을 새로 만들어 libvirtd를 kubepods.slice 밖의 system 슬라이스에서 실행 | — | — |
| 파드 재시작과 QEMU 수명을 분리하려는 의도로 해석 | cgroup 처리, hostPID, `/run`·`/var/lib/libvirt` 호스트 경로 마운트를 함께 보면 QEMU가 컨테이너 정리에 휩쓸리지 않게 하려는 장치로 읽힘 | — | `Σ` |
| 기존 libvirtd 프로세스 처리 | 호스트에 이미 실행 중인 libvirtd가 보이면 `kill -9`로 종료하기도 함 | OpenStack-Helm libvirt 시작 스크립트 | `✓` |
| libvirt 파드 삭제 후 VM 생존 | 실행해 보지 않음 | — | `?` |
| libvirtd 재시작 후 게스트 유지 | 이를 명시한 libvirt 공식 문장을 찾지 못함 | libvirt 공식 문서 | `?` |
| 컨트롤 플레인 중단 중 VM 실행 유지 | 이를 그대로 적은 Nova 공식 문서를 찾지 못함 | Nova 공식 문서 | `?` |
| Nova 업그레이드 문서의 무중단 안내 | "There should be no VM downtime when you upgrade Nova". nova-compute를 뺀 서비스를 모두 내렸다 올리는 절차가 있음 | Nova 업그레이드 문서 | `✓` |
| 컨트롤 플레인 중단의 영향에 관한 추론 | VM 실행 경로에 API·scheduler·DB·큐가 없으므로 생성·삭제·마이그레이션만 멈추고 실행 중인 VM은 이어진다고 추론 | — | `Σ` |
| 호스트 재부팅 뒤 게스트 재시작 설정 | `resume_guests_state_on_host_boot`가 결정. 기본 False | Nova 설정 옵션 문서 | `✓` |
| 네트워크 파드의 호스트 접근 | OVS, neutron OVS agent, OVN controller 파드는 모두 hostNetwork. vswitchd는 privileged로 고정 | OpenStack-Helm 소스 | `✓` |
| 노드 NIC와 IP의 브리지 이동 | `auto_bridge_add`가 노드 NIC를 br-ex 브리지에 붙이고 인터페이스의 IP를 브리지로 옮김 | OpenStack-Helm 설치 문서 | `✓` |
| Kubernetes 노드 IP가 있는 NIC를 옮길 때의 해석 | 해당 NIC에 Kubernetes 노드 IP가 있으면 kubelet과 CNI가 쓰는 주소가 브리지로 넘어감 | — | `Σ` |
| 파드용·VM용 데이터 경로의 공존 | OpenStack-Helm 테스트 환경은 CNI로 Calico를 설치하므로 한 노드에 파드용과 VM용 데이터 경로가 함께 있다는 종합 | OpenStack-Helm 테스트 환경 | `Σ` |
| OVS DaemonSet 롤아웃의 데이터 경로 영향 | Kubernetes가 갱신된 이미지를 감지해 롤아웃. Open vSwitch에 변화가 없어도 재시작이 모든 노드에서 데이터 경로 끊김을 일으켰다는 보고 | VEXXHOST 블로그 | `Ⓥ` |
| RHOSO의 OVN 업데이트 순서 | 컨트롤 플레인과 데이터 플레인의 OVN을 먼저 올린 뒤 나머지 데이터 플레인 서비스를 업데이트 | openstack-operator 업스트림 저장소의 데이터 플레인 업데이트 문서(asciidoc) | `✓` |
| CNI와 Neutron의 공존 설명 | 이를 설명한 공식 문장을 찾지 못함 | — | `?` |
| 상태 저장 서비스의 배포 형태 | Galera·RabbitMQ를 StatefulSet으로 배포 | — | `✓` |
| 상태 저장 서비스의 스토리지 선택 | Galera와 RabbitMQ는 둘 다 StatefulSet이지만 스토리지 선택은 구현마다 다름. 5절 참조 | — | — |
| MOSK의 DB·큐 구성 | 서비스마다 RabbitMQ 인스턴스를 따로 두고 Galera는 3개 이상으로 구성 | MOSK 문서 | `✓` |
| Atmosphere의 큐 구성 | 서비스별 RabbitMQ 사용 | Atmosphere 문서 | `✓` |
| 아래층 Kubernetes의 책임 범위 | Kubernetes 설치는 OpenStack-Helm 범위 밖. 예시로 든 kubeadm과 Ansible은 "not production-ready" | OpenStack-Helm 문서 | `✓` |
| 아래층 Kubernetes의 선행 구성 | OpenStack을 올릴 Kubernetes의 노드를 그 OpenStack의 Nova로 만들 수 없으므로 다른 수단이 먼저 구성해야 한다는 설명 | — | — |
| 베어메탈 프로비저닝 범위 | 베어메탈 프로비저닝부터 맡는다는 설명 | Airship, MOSK | `Ⓥ` |
| RHOSO의 베어메탈 프로비저닝 | OpenShift의 Cluster Baremetal Operator와 Ironic 사용 | — | `✓` |
| RHOSO에서 먼저 쓰는 Ironic의 소속 | 설치할 OpenStack의 Ironic이 아닌 플랫폼의 Ironic이라는 해석 | — | `Σ` |
| Ceph의 선행 구성 | 같은 의존 관계 때문에 Ceph도 OpenStack보다 먼저 실행되어야 한다는 판단 | — | `Σ` |
| 순환 의존의 공식 설명 | 이를 직접 다룬 공식 문장을 찾지 못함 | — | `?` |
| Kubernetes 배포에서도 남는 업그레이드 절차 | Nova의 순서와 DB 마이그레이션을 그대로 따라야 함 | Nova 업그레이드 문서 | `✓` |
| Nova의 업그레이드 순서 | Placement를 nova 서비스보다 먼저 업데이트. 새 코드로 DB 동기화하며 cell0 포함. conductor를 먼저 시작하고 API를 마지막에 올리는 것이 가장 안전하다는 안내 | Nova 업그레이드 문서 | `✓` |
| Nova 릴리스 공존과 DB 다운그레이드 | N과 N-2 릴리스의 nova-compute가 같은 배포에 공존하는 것까지 지원. DB 다운그레이드는 지원하지 않음 | Nova 문서 | `✓` |
| Helm 이미지 되돌리기의 한계 | 이미지를 되돌려도 스키마는 돌아오지 않을 것이라는 추론 | — | `Σ` |
| 차트 업그레이드에서 남는 문제 | 이미 끝난 db_sync Job을 새 이미지로 다시 실행해야 하는 문제. 롤링 설정이 PodDisruptionBudget과 충돌할 수 있음 | OpenStack-Helm 문서 | `✓` |
| Kubernetes와 차트·오퍼레이터의 역할 구분 | Kubernetes는 파드를 하나씩 바꾸는 장치를 제공. 무엇을 어떤 순서로 바꿀지는 차트와 오퍼레이터가 OpenStack 규칙에 맞춰 구현해야 한다는 종합 | — | `Σ` |
| MOSK가 설명하는 Kubernetes 사용 범위 | "uses Kubernetes mostly for orchestration and dependency isolation. As a result, multiple OpenStack services are running as privileged containers with host PIDs and Host Networking enabled." | MOSK 문서 | `✓` |

{{% /details %}}

## 5. 스토리지는 어디서 정해지는가

| 대상 | 정하는 곳 | OpenStack-Helm 기본값 | 근거 |
|---|---|---|---|
| 컨트롤 플레인 DB·큐 | Kubernetes StorageClass | `general`. 문서가 Ceph를 전제 | |
| VM 임시 디스크 | 컴퓨트 노드 nova.conf의 `[libvirt] images_type` | qcow2(로컬 디스크). rbd로 바꾸면 Ceph | |
| VM 영구 볼륨 | Cinder의 `enabled_backends`와 드라이버 | rbd(`rbd1`) | |

스토리지를 고르는 지점은 저장할 대상에 따라 다릅니다. 컨트롤 플레인의 DB·큐는 Kubernetes StorageClass를 사용합니다. VM의 임시 디스크와 영구 볼륨은 Nova와 Cinder 설정을 따릅니다. 각 경로를 종합하면 Kubernetes의 스토리지 선택과 VM의 디스크 선택은 별개입니다.

OpenStack-Helm 문서는 MariaDB·RabbitMQ의 PV(퍼시스턴트 볼륨) 백엔드로 Ceph를 전제하고, StatefulSet이 `general`이라는 StorageClass를 찾는다고 설명합니다. MOSK 문서는 다른 선택을 보여 줍니다. Ceph CSI를 사용하지만 일부 워크로드에는 네트워크 스토리지의 지연이 맞지 않아, local-volume-provisioner의 별도 StorageClass에 Galera 파일을 둡니다. 로컬 PV는 DB 파드를 노드에 묶습니다. 이 조건을 보면 노드를 잃었을 때 Galera 복제가 필요하고, MOSK가 요구하는 최소 복제본 수와도 연결된다고 해석할 수 있습니다.

VM 디스크는 어디로 갈까요? OpenStack 설계 문서는 VM 삭제와 함께 사라지는 임시 디스크와 Cinder가 맡는 영구 볼륨을 구분합니다. OpenStack-Helm의 Nova 기본값은 로컬 qcow2이고 Cinder 기본값은 RBD 드라이버입니다. libvirt 차트는 시작할 때 Ceph 키를 libvirt secret으로 등록합니다. 이 설정을 바탕으로 보면 VM의 RBD 볼륨은 QEMU가 Ceph에 직접 접근하며 Kubernetes CSI(컨테이너 스토리지 인터페이스)를 지나지 않는 경로입니다.

따라서 이 글에서는 VM 디스크를 Kubernetes의 PV·PVC와 별개로 봅니다. VM 디스크 경로는 [02 VM 디스크 경로]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}})에서, 로컬 디스크를 쓸 때의 가용성은 [03 로컬 디스크 HA]({{< relref "/data/block-storage/03-local-disk-ha/index.md" >}})에서 이어서 다룹니다.

설정 지점이 달라도 저장소는 같을 수 있습니다. 같은 Rook-Ceph 클러스터가 컨트롤 플레인 PV와 VM의 RBD를 공급한다면, DB와 테넌트 디스크가 한 장애 도메인을 공유한다고 추정할 수 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 컨트롤 플레인 DB·큐의 스토리지 결정 지점 | Kubernetes StorageClass. OpenStack-Helm 기본값은 `general`이며 문서는 Ceph를 전제 | OpenStack-Helm 문서 | `✓` |
| VM 임시 디스크의 결정 지점과 기본값 | 컴퓨트 노드 nova.conf의 `[libvirt] images_type`. OpenStack-Helm 기본값은 qcow2(로컬 디스크). rbd로 바꾸면 Ceph | Nova KVM 문서(결정 지점), nova 차트(기본값) | `✓` |
| VM 영구 볼륨의 결정 지점과 기본값 | Cinder의 `enabled_backends`와 드라이버. OpenStack-Helm 기본값은 rbd(`rbd1`) | OpenStack-Helm | `✓` |
| Kubernetes와 OpenStack의 스토리지 설정 범위 | 컨트롤 플레인 DB·큐만 Kubernetes가 정하고 VM 임시 디스크와 영구 볼륨은 OpenStack 설정이 정한다는 종합 | — | `Σ` |
| 컨트롤 플레인 PV의 백엔드와 StorageClass | Ceph를 MariaDB·RabbitMQ 같은 서비스의 PV 백엔드로 사용. StatefulSet이 `general`이라는 StorageClass를 찾음 | OpenStack-Helm 문서 | `✓` |
| mariadb 차트 기본값 | 복제본 3개, 볼륨 5Gi | mariadb 차트 | `✓` |
| MOSK의 Galera 스토리지 선택 | Ceph CSI를 쓰지만 일부 워크로드에는 지연 때문에 네트워크 스토리지가 맞지 않는다고 설명. local-volume-provisioner를 별도 StorageClass로 두고 Galera 파일을 저장 | MOSK 문서 | `✓` |
| 로컬 PV와 Galera 복제의 관계 | 로컬 PV를 쓰면 DB 파드가 노드에 묶임. 노드를 잃었을 때 Galera 복제로 버텨야 한다는 추론이며, MOSK가 최소 3개를 요구하는 조건과 연결 | — | `Σ` |
| VM 디스크와 Kubernetes 볼륨 객체의 관계 | VM 디스크는 Kubernetes PV·PVC와 관계가 없다는 종합 | — | `Σ` |
| 임시 디스크와 영구 볼륨의 구분 | Nova 임시 디스크는 VM이 지워지면 사라짐. 영구 볼륨은 Cinder가 담당 | OpenStack 설계 문서 | `✓` |
| Nova·Cinder 차트의 디스크 기본값 | nova 차트는 `images_type: qcow2`, cinder 차트는 RBD 드라이버 | nova·cinder 차트 | `✓` |
| RBD 접근 경로 | libvirt 차트는 시작할 때 Ceph 키를 libvirt secret으로 등록. 이를 바탕으로 VM의 RBD 볼륨에 QEMU가 Ceph로 직접 접근하고 Kubernetes CSI를 지나지 않는다고 설명 | libvirt 차트 | `✓` `Σ` |
| 관련 글의 범위 | VM 디스크 경로는 02 VM 디스크 경로, 로컬 디스크 사용 시 가용성은 03 로컬 디스크 HA에서 설명 | — | — |
| Rook-Ceph를 공유할 때의 장애 도메인 | 같은 Rook-Ceph 클러스터가 컨트롤 플레인 PV와 VM RBD를 함께 공급하면 DB와 테넌트 디스크가 한 장애 도메인을 공유한다는 추론 | — | `Σ` |

{{% /details %}}

## 6. KubeVirt와 반대 방향

{{< flow src="_flow/6-세-구도.json" />}}

| 항목 | KubeVirt | OpenStack on Kubernetes(OpenStack-Helm) | 근거 |
|---|---|---|---|
| 배치 결정 | kube-scheduler | nova-scheduler와 Placement | |
| VM의 API 객체 | VMI(Kubernetes CR) | Nova DB의 instance. Kubernetes는 VM을 모름 | |
| libvirtd 단위 | VM마다 하나(파드 안) | 컴퓨트 노드마다 하나 | |
| QEMU의 cgroup | 파드 cgroup 안 | 파드 cgroup 밖으로 일부러 뺌 | |
| 파드와 VM의 생사 | 파드가 종료되면 VM 종료. virt-launcher가 VM 종료를 기다리며 파드 종료를 미룸 | libvirt 파드가 재시작해도 VM이 남도록 설계 | |
| 네트워크·스토리지 | CNI·PVC | Neutron·Cinder | |

KubeVirt와 OpenStack on Kubernetes를 구분하려면 VM의 배치를 누가 정하는지 보면 됩니다. KubeVirt에서는 kube-scheduler가 virt-launcher 파드를 노드에 놓습니다. OpenStack-Helm 구성에서는 nova-scheduler가 VM의 호스트를 고르고, kube-scheduler는 nova-compute DaemonSet 파드를 배치합니다.

KubeVirt 문서는 스케줄링·네트워크·스토리지를 Kubernetes에 맡기고 가상화 기능을 제공한다고 설명합니다. 이 글의 정리로는 KubeVirt는 Kubernetes가 VM을 실행하는 구도이고, OpenStack on Kubernetes는 Kubernetes가 VM 관리 소프트웨어를 실행하는 구도입니다. VM을 나타내는 객체도 KubeVirt의 VMI와 Nova DB의 instance로 다릅니다.

파드와 VM의 수명 관계도 이 구분에 연결됩니다. KubeVirt에서는 VM이 파드와 함께 종료되며 virt-launcher가 VM 종료를 기다립니다. OpenStack-Helm의 libvirt 스크립트는 파드가 재시작해도 VM이 남게 하려는 설계로 읽힙니다. 표의 후자는 소스에서 의도를 해석한 내용입니다. OpenStack on Kubernetes가 KubeVirt를 사용하지 않는다고 명시한 문장은 찾지 않았고, OpenStack-Helm과 RHOSO의 컴퓨트 경로에 KubeVirt 컴포넌트가 없다는 점만 소스와 문서에서 확인했습니다.

그림의 마지막 줄인 Kubernetes on OpenStack은 방향이 반대입니다. Magnum은 OpenStack의 VM·베어메탈 위에 Kubernetes 클러스터를 만드는 API입니다. Cluster API Provider OpenStack(CAPO)은 Cluster API가 OpenStack API를 호출해 노드 VM을 만들게 합니다.

한 시스템에 양쪽 방향이 함께 나타날 수도 있습니다. OpenStack-Helm에는 magnum 차트가 있고, Atmosphere는 Magnum용 Cluster API 드라이버를 소개합니다. 문서들을 종합하면 OpenStack을 실행하는 아래층 Kubernetes와 테넌트가 Magnum으로 만드는 위층 Kubernetes는 서로 다른 클러스터로 볼 수 있습니다. OpenStack Foundation 백서에 따르면 CERN은 Magnum으로 200개 이상의 Kubernetes 설치를 관리합니다. 이것도 Kubernetes on OpenStack 방향의 사례입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 그림을 읽는 기준 | VM 배치 결정 주체를 비교. 첫 줄은 kube-scheduler가 virt-launcher 파드를 배치하는 KubeVirt. 둘째 줄은 nova-scheduler가 VM 호스트를 고르고 kube-scheduler는 nova-compute DaemonSet 파드만 배치. 셋째 줄은 방향이 반대인 별개의 구도 | — | — |
| VM 배치 결정 주체 | KubeVirt는 kube-scheduler. OpenStack on Kubernetes(OpenStack-Helm)는 nova-scheduler와 Placement | — | `✓` |
| VM의 API 객체 | KubeVirt는 VMI(Kubernetes CR). OpenStack-Helm 구성은 Nova DB의 instance이며 Kubernetes는 VM을 모른다는 종합 포함 | — | `✓` `Σ` |
| libvirtd의 실행 단위 | KubeVirt는 VM마다 하나이며 파드 안에서 실행. OpenStack-Helm은 컴퓨트 노드마다 하나 | — | `✓` |
| QEMU의 cgroup 위치 | KubeVirt는 파드 cgroup 안. OpenStack-Helm은 파드 cgroup 밖으로 일부러 빼려는 설계로 해석 | — | `✓` `Σ` |
| 파드와 VM의 수명 관계 | KubeVirt는 파드가 종료되면 VM 종료. virt-launcher는 VM 종료를 기다리며 파드 종료를 미룸. OpenStack-Helm은 libvirt 파드가 재시작해도 VM이 남도록 설계된 것으로 해석 | — | `✓` `Σ` |
| 네트워크·스토리지 경로 | KubeVirt는 CNI·PVC. OpenStack-Helm 구성은 Neutron·Cinder | — | `✓` `Σ` |
| KubeVirt가 설명하는 역할 분담 | 스케줄링·네트워크·스토리지는 Kubernetes에 맡기고 가상화 기능만 제공 | KubeVirt 문서 | `✓` |
| 두 플랫폼을 구분하는 설명 | KubeVirt는 Kubernetes가 VM을 돌리는 구도. OpenStack on Kubernetes는 Kubernetes가 VM 관리 소프트웨어를 돌리는 구도 | — | `Σ` |
| KubeVirt 미사용 여부의 확인 범위 | OpenStack on Kubernetes가 KubeVirt를 쓰지 않는다고 적은 문장은 찾지 않음. OpenStack-Helm과 RHOSO의 컴퓨트 경로에 KubeVirt 컴포넌트가 없다는 점만 확인 | OpenStack-Helm 소스, openstack-operator 업스트림 문서 | `✓` `Σ` |
| Kubernetes on OpenStack의 방향 | OpenStack on Kubernetes와 반대 방향이라는 설명 | — | — |
| Magnum과 CAPO의 역할 | Magnum은 OpenStack VM·베어메탈 위에 Kubernetes 클러스터를 만드는 API. Cluster API Provider OpenStack(CAPO)은 Cluster API가 OpenStack API를 불러 노드 VM을 생성 | Magnum 문서, Cluster API Provider OpenStack README | `✓` |
| 양쪽 방향을 함께 구성하는 사례 | OpenStack-Helm에 magnum 차트가 있음. Atmosphere는 Magnum용 Cluster API 드라이버를 내세움 | OpenStack-Helm 차트·Atmosphere | `✓` |
| 아래층과 위층 Kubernetes의 관계 | OpenStack을 실행하는 아래층 Kubernetes와 테넌트가 Magnum으로 만드는 위층 Kubernetes는 서로 다른 클러스터라는 종합 | — | `Σ` |
| CERN 사례의 방향과 규모 | Magnum으로 관리하는 200개 이상의 Kubernetes 설치. Kubernetes on OpenStack 방향의 사례 | OpenStack Foundation 백서 | `Ⓥ` |

{{% /details %}}

## 7. 확인하지 못한 것

| 항목 | 상태 |
|---|---|
| RHOSO 18 제품 문서 본문 | docs.redhat.com이 JS로 렌더링되어 읽지 못함. 업스트림 asciidoc과 보도자료로 대체 `?` |
| 컨트롤 플레인이 내려가도 VM이 돈다는 공식 문장 | 업그레이드 문서의 "no VM downtime"과 실행 경로를 바탕으로 한 추론만 있음 `?` |
| libvirtd 재시작이 실행 중 게스트를 건드리지 않는다는 libvirt 문장 | 찾지 못함 `?` |
| OpenStack-Helm에서 libvirt 파드를 지웠을 때 VM 생존 | 소스에서 의도만 확인했으며 실행해 보지 않음 `?` |
| CNI와 Neutron 데이터 경로의 공존·충돌 설명 | 이를 설명하는 공식 문장을 찾지 못함 `?` |
| 순환 의존을 직접 다룬 문장, MAAS 조합의 1차 문서 | 찾지 못함 `?` |
| MOSK·Atmosphere의 libvirt cgroup 처리 | OpenStack-Helm 차트를 그대로 쓰는지 소스를 열어 보지 않음 `?` |
| Sunbeam 하이퍼바이저 snap의 이름, Yaook nova-compute가 노드별 StatefulSet인지 | 확인하지 못함 `?` |
| StarlingX 차트의 기반, Airship의 현재 상태 | 확인하지 못함. Airship 사이트의 최신 언급은 2021년이며 저장소 일부에는 2026-10에도 push가 있음 `?` |
| 운영 사례의 규모 | AT&T 사례는 2018년 무렵 재단 백서에 "still testing"으로 적힌 계획이며 현재 상태는 모름 `Ⓥ` `≈` `?`. SAP는 sapcc/helm-charts 저장소가 있다는 점까지 확인 `✓`. CERN은 on-Kubernetes 사례가 아님 |
| OpenStack-Helm README의 "2025.2 (Dalmatian)" 표기 | 2025.2의 코드명은 Flamingo이므로 오기로 보지만 확인하지 않음 `≈` |
| Rook-Ceph 하나를 컨트롤 플레인 PV와 VM RBD가 함께 쓸 때 분리하라는 권고 | 확인하지 않음 `?` |
| 성능 수치 | 조건이 명시된 자료를 찾지 못해 싣지 않음. Red Hat의 "4x faster"는 조건 비공개 `Ⓥ` |

## 참고 자료

- [Nova System Architecture](https://docs.openstack.org/nova/latest/admin/architecture.html), [Compute service overview](https://docs.openstack.org/nova/latest/install/get-started-compute.html), [Upgrades](https://docs.openstack.org/nova/latest/admin/upgrades.html) — OpenStack Nova 문서. 컴포넌트 정의, 업그레이드 순서
- [Host aggregates](https://docs.openstack.org/nova/latest/admin/aggregates.html), [Availability Zones](https://docs.openstack.org/nova/latest/admin/availability-zones.html), [Cells (v2)](https://docs.openstack.org/nova/latest/admin/cells.html) — OpenStack Nova 문서. 노드 묶음
- [KVM](https://docs.openstack.org/nova/latest/admin/configuration/hypervisor-kvm.html), [libvirt QEMU/KVM driver](https://libvirt.org/drvqemu.html) — nova.conf 설정, QEMU 프로세스
- [openstack/openstack-helm](https://github.com/openstack/openstack-helm) — master. nova·libvirt·openvswitch·mariadb·rabbitmq·cinder 차트, 설치·prerequisites·upgrades 문서
- [openstack-k8s-operators/openstack-operator](https://github.com/openstack-k8s-operators/openstack-operator) — main. README, design.adoc, creating-the-data-plane.adoc
- [Red Hat OpenStack Services on OpenShift now generally available](https://www.redhat.com/en/about/press-releases/red-hat-openstack-services-openshift-now-generally-available) — Red Hat 보도자료, 2024-08-26
- [Canonical OpenStack Architecture](https://canonical.com/openstack/docs/latest/explanation/architecture/) — Sunbeam
- [MOSK Reference Architecture](https://docs.mirantis.com/mosk/latest/ref-arch.html), [OpenStack cluster](https://docs.mirantis.com/mosk/latest/ref-arch/openstack/openstack-cluster.html) — Mirantis. 노드 라벨, DB·큐 배치
- [Atmosphere](https://vexxhost.github.io/atmosphere/), [Maintenance Guide](https://vexxhost.github.io/atmosphere/admin/maintenance.html) — VEXXHOST
- [Why is the Yaook Nova Container privileged?](https://docs.yaook.cloud/developer/explanations/nova/nova_privileged.html) — Yaook 문서
- [Zero-Downtime OpenStack Upgrades: Suppressing Open vSwitch Restarts](https://vexxhost.com/blog/zero-downtime-openstack-upgrade-suppressing-openvswitch-restarts/) — VEXXHOST 블로그
- [Leveraging Containers and OpenStack](https://www.openstack.org/use-cases/containers/leveraging-containers-and-openstack/) — OpenStack Foundation 백서. AT&T·CERN 사례
- [KubeVirt architecture](https://raw.githubusercontent.com/kubevirt/kubevirt/main/docs/architecture.md), [components](https://raw.githubusercontent.com/kubevirt/kubevirt/main/docs/components.md) — KubeVirt 저장소
- [Magnum](https://docs.openstack.org/magnum/latest/), [Cluster API Provider OpenStack](https://github.com/kubernetes-sigs/cluster-api-provider-openstack) — 반대 방향 구도
- [Storage concepts](https://docs.openstack.org/arch-design/design-storage/design-storage-concepts.html) — OpenStack arch-design. 임시 디스크와 Cinder
- [Airship](https://www.airshipit.org/), [StarlingX OpenStack install](https://docs.starlingx.io/deploy_install_guides/release/openstack/index-install-r7-os-adc44604968c.html) — 자동 복구 주장, 애플리케이션 설치 구조
- [kolla-kubernetes README](https://raw.githubusercontent.com/openstack/kolla-kubernetes/master/README.rst), [governance legacy.yaml](https://raw.githubusercontent.com/openstack/governance/master/reference/legacy.yaml) — 2018-05-02 은퇴
- [sapcc/helm-charts](https://raw.githubusercontent.com/sapcc/helm-charts/master/README.md) — SAP 저장소
- [Yaook scheduling](https://docs.yaook.cloud/user/explanations/concepts/scheduling.html), [Yaook operators](https://docs.yaook.cloud/user/explanations/concepts/operators.html) — 라벨·taint 배치, 조정 루프
- [Atmosphere RabbitMQ](https://vexxhost.github.io/atmosphere/config/rabbitmq.html), [Atmosphere storage](https://vexxhost.github.io/atmosphere/deploy/storage.html) — 서비스별 큐, 스토리지 기본값
- [Kolla](https://docs.openstack.org/kolla/latest/), [Kolla Ansible](https://docs.openstack.org/kolla-ansible/latest/) — 비 Kubernetes 계열
