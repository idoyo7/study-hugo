---
title: "판단 — 언제 쓰고 언제 쓰지 않나"
linkTitle: "06 판단"
weight: 6
date: 2026-09-14
lastmod: 2026-09-14
url: "/isolation/06-decision/"
---

# 06 · 판단 — 언제 쓰고, 언제 쓰지 않고, 어디까지만 쓰나

{{< callout type="info" >}}
- **격리 비용은 워크로드 성격과 파드 크기에 따라 달라진다** `Σ` — 계산 중심인가 IO·네트워크 중심인가, 파드가 크고 적은가 작고 많은가를 함께 봐야 한다.
- **Kata와 KubeVirt의 선택은 시나리오에서 출발한다** `Σ` — 이번 조사에서는 같은 하드웨어·워크로드로 정면 비교한 공개 벤치마크를 찾지 못했다.
- **RuntimeClass는 파드 단위로 지정한다** `✓` — 신뢰 경계를 넘는 파드에만 `runtimeClassName`을 붙이고 나머지는 runc로 두는 배치가 가장 흔하다.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

## 1. 격리 비용을 가르는 두 축

사용자 제출 코드, CI 러너, AI 에이전트가 생성한 코드를 실행하거나 규제·계약이 테넌트 간 경계를 요구한다면 추가 격리를 검토할 이유가 있습니다. 어느 런타임을 감당할 수 있는지는 워크로드의 성격과 파드의 크기·수에 달려 있습니다.

워크로드가 CPU·메모리 계산 중심이고 I/O가 적을수록 Kata의 성능 비용은 작아집니다. 랜덤 I/O나 네트워크 처리량이 SLO의 중심이라면 도입에 신중해야 합니다. 파드당 고정 오버헤드는 파드가 크고 수가 적을수록 상대 비율이 낮아지고, 작고 밀도가 높은 배치에서는 부담이 커집니다 `Σ`.

이 두 축이 도입 이유를 대신하지는 않습니다. 커널 CVE가 나올 때마다 전 노드를 긴급 패치하는 부담이 큰 환경도 Kata를 검토할 만하지만, 성능 비용을 감당할 수 있다는 이유만으로 모든 파드에 추가 격리를 적용할 필요는 없습니다.

자매 문서: 필요한 격리 경계는 [01 경계와 위협 모델]({{< relref "/platform/isolation/01-boundaries/index.md" >}}), 비용을 대입할 실측값은 [05 성능 실측]({{< relref "/platform/isolation/05-performance/index.md" >}})에서 확인할 수 있습니다.

## 2. 시나리오와 운영 제약으로 후보 좁히기

Kata는 OCI 이미지의 격리를, KubeVirt는 기존 VM 이미지 실행을 겨냥합니다. 이 차이 때문에 두 기술의 선택은 사용 시나리오에서 출발해야 합니다 `Σ`. 둘 다 QEMU/KVM을 사용하는 구성에서는 CPU·메모리 오버헤드가 구조적으로 비슷할 것으로 예상할 수 있지만, 이를 직접 뒷받침하는 측정은 없습니다. 아래 표도 정면 벤치마크 결과가 아니라 각각의 인터페이스와 제약을 시나리오에 대입한 판단입니다.

| 시나리오 | 답 |
|---|---|
| 신뢰 못 하는 코드 실행 | Kata 또는 gVisor |
| Windows·커스텀 커널 | KubeVirt |
| 컨테이너화되지 않은 레거시 앱 | KubeVirt |
| vSphere 자산 이주 | KubeVirt + Forklift/MTV |
| docker-in-docker CI 러너 | 둘 다 — 러너 수명으로 가른다 |
| GPU 쪼개 쓰기 | 둘 다 아니다(Kata는 노드 GPU 전부를 한 VM에, KubeVirt는 VFIO 1Gi 추가·mdev만 마이그레이션) |
| 테넌트별 k8s 클러스터 | KubeVirt 위 중첩(HyperShift) |

### 컨테이너 격리에는 호환성 조건부터

일반적인 syscall만 쓰는 애플리케이션 코드이고, 중첩 가상화가 없는 환경에서 콜드 스타트가 중요하다면 gVisor가 더 잘 맞습니다. 커스텀 커널 모듈, io_uring, raw socket을 요구하면 gVisor는 답이 아닙니다. 구체적인 호환성 범위는 [03 gVisor]({{< relref "/platform/isolation/03-gvisor/index.md" >}})에서 다뤘습니다.

Kata도 기존 파드 설정을 그대로 받아들이는 선택지는 아닙니다. hostNetwork, subPath, 호스트 장치 패스스루에 의존하거나 노드 레벨 eBPF 런타임 보안이 규정 요건이라면 피할 조건에 해당합니다. GPU를 노드 안에서 쪼개 쓰는 경우도 피할 조건에 해당합니다. `/dev/kvm`을 얻을 수 없는 인스턴스 타입에 묶여 있어도 도입할 수 없습니다. 해당 제약은 [02 Kata Containers]({{< relref "/platform/isolation/02-kata/index.md" >}})에서 확인할 수 있습니다.

### VM이 필요한 경우의 운영 조건

컨테이너화할 수 없는 앱이 상당량 있거나 Windows 게스트·특정 커널이 필요하다면 KubeVirt가 맞습니다. GPU·SR-IOV·NUMA에 밀착한 워크로드를 VM 경계로 나눠 제공하는 경우도 여기에 속합니다.

다만 RWX 공유 스토리지가 없거나 `/dev/kvm`을 줄 수 없는 환경, 운영 인력이 부족한 환경에서는 피할 이유가 생깁니다. 노드가 자주 바뀌는 배치라면 Karpenter consolidation과의 충돌도 고려해야 합니다. 이 상호작용을 정면으로 다룬 1차 문서는 이번 조사에서 찾지 못했습니다. 목적이 컨테이너 워크로드의 격리 강화라면 Kata를 검토하는 편이 맞습니다. KubeVirt의 스토리지·축출·운영 조건은 [04 KubeVirt]({{< relref "/platform/isolation/04-kubevirt/index.md" >}})에 있습니다.

### CI 러너는 수명으로 구분

docker-in-docker CI 러너에서는 Kata와 KubeVirt의 쓰임이 겹칩니다. 매번 새로 띄우고 버리는 러너라면 기동 시간이 지배적이라 Kata가 유리하고, 상태를 유지하며 이미지 캐시를 오래 쓰는 러너라면 VM 쪽이 자연스럽습니다 `Σ`.

### GPU 분할은 별도의 요구

GPU를 VM에 붙이는 것과 여러 워크로드가 나눠 쓰는 것은 구분해야 합니다. Kata는 노드의 GPU 전부를 한 VM에 배정해야 하고 vGPU 자체를 지원하지 않으므로 GPU 파티셔닝이 목적이라면 대상이 아닙니다. KubeVirt는 VFIO 패스스루로 GPU를 붙이면 오버헤드가 1Gi 단위로 뛰고, 마이그레이션이 가능한 경로는 NVIDIA mdev(vGPU) 정도로 제한됩니다.

"GPU를 잘게 쪼개 여러 테넌트에게 팔고 싶다"는 요구에는 둘 다 답이 아닙니다. 분할은 MIG나 time-slicing 같은 GPU 자체의 기능이 맡습니다 `Σ`.

## 3. AI 에이전트 샌드박스의 채택 사례

공개된 AI 에이전트 샌드박스 사례에는 gVisor와 마이크로 VM이 모두 등장합니다. 확인한 기술과 근거 수준은 다음과 같습니다.

| 업체 | 격리 기술 |
|---|---|
| Anthropic | gVisor `✓` |
| OpenAI | gVisor `✓` |
| Modal | gVisor `✓` |
| E2B | Firecracker `Ⓥ` |
| Fly.io | Firecracker `✓` |
| Northflank | Kata + Cloud Hypervisor(GPU 시 gVisor로 대체) `Ⓥ` |
| Ant Group | Kata + Dragonball `Ⓥ` |

모델 제공자는 gVisor를, 인프라 판매자는 마이크로 VM을 고르는 경향으로 읽을 수 있습니다 `Σ`. 자기 코드로 자기 하드웨어를 지키는 데는 syscall 표면 축소로 충분할 수 있고, 남의 임의 커널 요구를 받아야 하는 인프라 판매자는 호환성 때문에 VM이 필요하다는 해석입니다 `≈`. Kubernetes SIG의 Agent Sandbox 프로젝트는 gVisor와 Kata 둘 다를 백엔드로 지원합니다 `✓`.

표에 넣지 않은 이름도 있습니다. Cloudflare Sandboxes는 "격리된 컨테이너"라고만 밝히고 하이퍼바이저를 공개하지 않습니다. Daytona는 네임스페이스 샌드박스와 VM 샌드박스를 둘 다 쓴다고 알려져 있으나 구체적인 배치 기준은 확인하지 못했습니다 `?`.

Ant Group은 운영 규모와 스택을 공개했습니다. CNCF TAB 이슈에는 최대 15,000 노드 규모 쿠버네티스 클러스터에서 runtime-rs·Dragonball 스택을 장기 운영 중이라고 적혀 있습니다 `Ⓥ`. 스택 구성은 Kubernetes + containerd + Kata + Dragonfly + Nydus입니다 `Ⓥ`. 이슈 본문은 다음 용례를 설명합니다. "AI 에이전트는 방금 생성한 코드를 실행하고 사용자 제공 파일을 다뤄야 할 때가 있다. 각 작업에 수명 짧은 환경과 명확한 테넌트 경계, 자체 게스트 커널을 준다." Kata 4.0 발표는 프로덕션 사용 조직으로 Ant Group, Edgeless Systems, Microsoft, NVIDIA를 듭니다 `Ⓥ`.

## 4. 적용할 파드를 정하고 비용 계산하기

RuntimeClass로 신뢰 경계를 넘는 파드에만 `runtimeClassName`을 붙이고 나머지는 runc로 두는 배치가 가장 흔합니다. 다만 Kata를 함께 운영하려면 `scheduling.nodeSelector`로 Kata 가능 노드를 분리해야 하므로 노드풀이 하나 늘어납니다. 오히려 통일하려는 시도가 불필요한 비용을 가장 많이 만듭니다 `Σ`.

적용 범위를 정했다면 **파드당 오버헤드(상수) × 파드 수**를 워크로드 크기와 견줍니다. 파드가 작고 많을수록 이 고정 비용이 전체 자원에서 차지하는 비중을 확인해야 합니다.

그다음에는 "경계를 건너는 횟수"가 SLO에 영향을 주는지 따집니다. [05 성능 실측]({{< relref "/platform/isolation/05-performance/index.md" >}})에서 본 순수 계산 워크로드는 격리 비용이 거의 없었지만, syscall과 IO가 촘촘한 워크로드에는 같은 판단을 적용할 수 없습니다. 파드 수로 계산한 자원 비용과 워크로드별 성능 비용을 함께 놓고 적용 범위를 정해야 합니다.

## 5. 확인하지 못한 것

- Kata와 KubeVirt를 같은 하드웨어·워크로드로 정면 비교한 공개 벤치마크는 이번 조사에서 찾지 못했다
- Kata VMM별(QEMU·Cloud Hypervisor·Firecracker·Dragonball) 아이들 샌드박스 RSS와 파드 기동 시간의 공개 대조표가 없다 — Kata 프로젝트의 `metrics` 스위트에 도구는 있지만 결과 수치는 게시돼 있지 않다
- systrap 이후 gVisor의 시스템콜 오버헤드 수치는 공식 블로그의 SVG 그래프로만 있고 텍스트 값이 없다
- GKE Sandbox는 공식 문서에 성능 오버헤드·기동 지연 수치를 제시하지 않는다
- Kata 위에서 각 컨테이너 탈출 CVE를 실제로 재현해 막혔음을 확인한 1차 보고는 찾지 못했다
- Januscape(CVE-2026-53359)의 CVSS 점수와 NVD 레코드를 직접 확인하지 못했다
- KubeVirt 네트워크 바인딩별 iperf 대조표와 라이브 마이그레이션 다운타임 수치가 공개돼 있지 않다
- Karpenter consolidation과 KubeVirt VM의 상호작용을 정면으로 다룬 1차 문서가 없다
- Dragonball의 성능 회귀를 다루는 업스트림 이슈(#5644)가 아직 열려 있어 "가장 빠른 Kata VMM"으로 단정할 수 없다

## 참고 자료

- [Kubernetes RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/) — `overhead.podFixed`
- [cncf/tab#147](https://github.com/cncf/tab/issues/147) — Ant Group Kata AI 에이전트 샌드박스, PVM 부팅 실측
