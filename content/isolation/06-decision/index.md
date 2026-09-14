---
title: "판단 — 언제 쓰고 언제 쓰지 않나"
linkTitle: "06 판단"
weight: 6
date: 2026-09-14
lastmod: 2026-09-14
---

# 06 · 판단 — 언제 쓰고, 언제 쓰지 않고, 어디까지만 쓰나

{{< callout type="info" >}}
- **Kata vs KubeVirt 정면 벤치마크는 존재하지 않는다** `Σ` — 두 프로젝트가 애초에 다른 사용 사례를 겨냥하기 때문이다. 시나리오별 판단만 가능하다.
- **RuntimeClass는 파드 단위라 전부 아니면 전무가 아니다** `✓` — 신뢰 경계를 넘는 파드에만 `runtimeClassName`을 붙이고 나머지는 runc로 두는 배치가 실제로 가장 흔하다.
- **판단 축은 둘이다** `Σ` — 워크로드가 계산 중심인가 IO·네트워크 중심인가, 그리고 파드가 크고 적은가 작고 많은가.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

[02 Kata Containers]({{< relref "../02-kata/index.md" >}}), [03 gVisor]({{< relref "../03-gvisor/index.md" >}}), [04 KubeVirt]({{< relref "../04-kubevirt/index.md" >}})에서 각각의 구조와 제약을 봤고, [05 성능 실측]({{< relref "../05-performance/index.md" >}})에서 그 비용을 숫자로 확인했습니다. 이 편은 그 조각들을 모아 언제 무엇을 쓸지 정리하고, 이번 조사에서 확인하지 못한 것도 함께 남깁니다.

자매 문서: 세 물건의 경계와 위협 모델은 [01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}})에, Kata는 [02 Kata Containers]({{< relref "../02-kata/index.md" >}})에, gVisor는 [03 gVisor]({{< relref "../03-gvisor/index.md" >}})에, KubeVirt는 [04 KubeVirt]({{< relref "../04-kubevirt/index.md" >}})에, 성능 실측은 [05 성능 실측]({{< relref "../05-performance/index.md" >}})에 있습니다.

## 1. Kata vs KubeVirt — 겹치는 자리와 안 겹치는 자리

이 글이 조사한 범위에서 Kata와 KubeVirt를 같은 하드웨어·같은 워크로드로 정면 비교한 공개 벤치마크는 존재하지 않습니다. 두 프로젝트가 애초에 다른 사용 사례(Kata는 OCI 이미지의 격리, KubeVirt는 기존 VM 이미지 실행)를 겨냥하기 때문입니다 `Σ`. 둘 다 QEMU/KVM 위에 서므로 구조적으로 CPU·메모리 오버헤드는 비슷해야 하지만, 이를 직접 뒷받침하는 측정은 없습니다. 그래서 아래 시나리오 표는 두 기술을 직접 비교한 결과가 아니라 각각의 인터페이스와 제약을 시나리오에 대입한 판단입니다.

GPU를 여러 워크로드가 나눠 쓰고 싶은 경우가 특히 그렇습니다. Kata는 노드의 GPU 전부를 한 VM에 배정해야 하고 vGPU 자체를 지원하지 않으므로, GPU 파티셔닝이 목적이라면 애초에 대상이 아닙니다. KubeVirt는 VFIO 패스스루로 GPU를 붙이면 오버헤드가 1Gi 단위로 뛰고, 마이그레이션이 되는 경로는 NVIDIA mdev(vGPU) 정도로 제한됩니다. 결국 "GPU를 잘게 쪼개 여러 테넌트에게 팔고 싶다"는 요구에는 둘 다 정답이 아니고, 그 자리는 MIG나 time-slicing 같은 GPU 자체의 분할 기능이 채웁니다 `Σ`.

근거 수치는 [05 성능 실측]({{< relref "../05-performance/index.md" >}})에 있습니다.

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

모델 제공자 본인들은 gVisor를 고르고, 인프라 판매자들은 마이크로 VM을 고르는 구도로 읽힙니다 `Σ`. 자기 코드로 자기 하드웨어를 지키는 문제라면 syscall 표면 축소로 충분하지만, 남의 임의 커널 요구를 받아야 하는 인프라 판매자는 호환성 때문에 VM이 필요하다는 해석이 자연스럽습니다 `≈`. Kubernetes SIG의 Agent Sandbox 프로젝트는 gVisor와 Kata 둘 다를 백엔드로 지원합니다 `✓`. gVisor 자체의 구조와 호환성은 [03 gVisor]({{< relref "../03-gvisor/index.md" >}})에서 다뤘습니다.

표에 넣지 않은 이름도 있습니다. Cloudflare Sandboxes는 "격리된 컨테이너"라고만 밝히고 하이퍼바이저를 공개하지 않으며, Daytona는 네임스페이스 샌드박스와 VM 샌드박스를 둘 다 쓴다고 알려져 있으나 구체적인 배치 기준은 확인하지 못했습니다 `?`. 표에 오른 이름들만으로도 구도는 충분히 뚜렷합니다.

Ant Group의 사례가 이 구도에서 가장 구체적인 숫자를 냅니다. CNCF TAB 이슈에 최대 15,000 노드 규모 쿠버네티스 클러스터에서 runtime-rs·Dragonball 스택을 장기 운영 중이라고 적혀 있고 `Ⓥ`, 스택 구성은 Kubernetes + containerd + Kata + Dragonfly + Nydus입니다 `Ⓥ`. 이슈 본문의 용례 설명이 이 시리즈의 주제와 정확히 겹칩니다 — "AI 에이전트는 방금 생성한 코드를 실행하고 사용자 제공 파일을 다뤄야 할 때가 있다. 각 작업에 수명 짧은 환경과 명확한 테넌트 경계, 자체 게스트 커널을 준다." Kata 4.0 발표는 프로덕션 사용 조직으로 Ant Group, Edgeless Systems, Microsoft, NVIDIA를 듭니다 `Ⓥ`.

## 2. 판단 — 쓸 때와 쓰지 말 때

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

이 시리즈가 준 숫자로 독자가 스스로 계산할 수 있는 식이 하나 있습니다. **파드당 오버헤드(상수) × 파드 수**를 워크로드 크기와 견주고, 그 상수가 파드 수에 곱해질 만큼 파드가 작고 많은지를 먼저 봅니다. 그다음 "경계를 건너는 횟수"가 SLO에 들어가는 성질인지를 봅니다. 순수 계산이라면 격리는 거의 공짜이고, syscall과 IO가 촘촘하다면 그 공짜는 사라집니다.

## 3. 확인하지 못한 것

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

- [Kubernetes RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/) — `overhead.podFixed`
- [cncf/tab#147](https://github.com/cncf/tab/issues/147) — Ant Group Kata AI 에이전트 샌드박스, PVM 부팅 실측
