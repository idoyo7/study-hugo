# GPU 11편 Astra 구조·문장 편집 기록

2026-10-21에 공개된 GPU 11편과 시리즈 색인을 검토했다. WWE v1.7.1의 구조 편집·한국어 명확성 기준을 적용해 Astra(`gpt-6-astra`, high)가 전체 원문을 재작성했다. 편별 작성자와 다른 편집자가 원본·후보를 교차 검토하고, 리더가 기술 표현 보정과 사이트 검증을 맡았다. 기존 WWE 규칙으로 처리할 수 있어 스킬 파일은 변경하지 않았다.

## 편별 편집 내용

| 글 | 설명 순서와 주요 수정 |
|---|---|
| [01 노드 토폴로지](../../content/platform/kubernetes/gpu/01-node-topology/index.md) | GPU 연결, Fabric Manager, CPU·NIC 경로, NCCL 로그와 진단 순서로 이어지게 했다. |
| [02 Device Plugin](../../content/platform/kubernetes/gpu/02-allocation-device-plugin/index.md) | 노드 선택과 장치 선택을 구분한 뒤 선호 점수, NUMA, 구현별 제약을 설명했다. |
| [03 DRA](../../content/platform/kubernetes/gpu/03-allocation-dra/index.md) | 사용 목적과 객체 모델을 먼저 설명하고, 예제 뒤에 기능 성숙도와 전환 제약을 배치했다. |
| [04 라벨과 Kueue](../../content/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md) | 통신 병목에서 라벨 표현과 TAS 설정으로 연결하고, 용량·장애 조건을 뒤에 모았다. |
| [05 Volcano·KAI·Slurm](../../content/platform/kubernetes/gpu/05-scheduling-volcano-kai-slurm/index.md) | 워크로드 API와 스케줄러별 역할을 설명한 뒤 도입 근거와 미확인 기능을 구분했다. |
| [06 GPUDirect RDMA 기초](../../content/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md) | PCIe 경로와 메모리 등록부터 격리·NIC 할당·설치 검증까지 연결했다. |
| [07 GPUDirect RDMA 운영](../../content/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md) | 로그 판독과 측정 조건을 가까이 두고, 진단 뒤에 클라우드와 DRA 지원 범위를 설명했다. |
| [08 GDS·NVMe-oF](../../content/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md) | 호스트·타깃·DPU의 처리 비용을 구분하고 전송 경로별 요구 조건을 명시했다. |
| [09 스토리지 적용 판단](../../content/platform/kubernetes/gpu/09-storage-reality/index.md) | 데이터셋·체크포인트·가중치·KV 접근에서 실제 지원 범위와 시험 절차로 이어지게 했다. |
| [10 패브릭 구성](../../content/platform/kubernetes/gpu/10-provider-fabric-config/index.md) | FM 설정과 초기화 진단, MIG·가상화, NVL72, IB·RoCE 순서로 정리했다. |
| [11 검증과 테넌트 격리](../../content/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md) | 토폴로지와 격리 조건을 먼저 정하고 NCCL 시험·인수 검사·관측을 연결했다. |
| [시리즈 색인](../../content/platform/kubernetes/gpu/_index.md) | 중복한 질문·링크 목록을 통합하고 11편의 역할과 읽는 순서를 정리했다. |

본문을 되풀이하던 근거표는 고유한 수치·조건·출처를 본문으로 옮긴 뒤 줄였다. 버전·성능·설정 비교에 필요한 표와 절차는 유지했다. 명사 나열, 형식적인 도입과 결말, 정형적인 연결 표현을 문맥에 맞게 고쳤다. 문서 확인, 벤더 주장, 추론, 미확인 결과는 구분했다.

## 의미를 바로잡은 부분

- NCCL 비활성화 변수의 값과 전송 기능의 상태를 구분했다. `1`이면 비활성화하고 미설정이면 사용을 허용한다는 [환경변수 문서](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)에 맞췄다.
- DRA의 `pcieRoot` 일치를 단일 PCIe 스위치 일치로 해석하지 않도록 [표준 장치 속성](https://kubernetes.io/docs/reference/node/dra-standard-device-attributes/#resourcekubernetesiopcieroot)의 범위를 명시했다. 07의 기본 GDR 판정 도식에도 06에서 설명한 C2C 예외를 표시했다.
- RWO는 단일 파드가 아닌 단일 노드의 읽기·쓰기 마운트다. [PersistentVolume 접근 모드](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes)에 맞춰 같은 노드의 여러 파드와 ReadWriteOncePod를 구분했다.
- SPDK Target의 코어당 IOPS 비교를 Kubernetes 클라이언트 CPU 절감 근거로 확대하지 않았다. 원문 수치·측정 조건은 유지하고 클라이언트 비용은 별도 측정 대상으로 남겼다.
- [Fabric Manager 가이드](https://docs.nvidia.com/datacenter/tesla/fabric-manager-user-guide/index.html)의 일반 MIG 절과 Shared NVSwitch 가상화 절을 분리했다. 절마다 다른 링크 활성 상태·트레이닝 설명과 H100 이후 예외를 합쳐 단정하지 않았다. 세대별 세부 적용 범위를 확정하지 못한 점도 명시했다.
- 09의 드라이버 점검 목록에 08의 로컬 NVMe 업스트림 P2PDMA 예외를 반영했다. DOCA-OFED 요구는 선택한 전송 경로에 따라 확인하도록 했다.
- [CNS의 과거 구성](https://github.com/NVIDIA/cloud-native-stack)에서 Network Operator가 N/A인 이유를 해당 버전에 한정하고, [Network Operator 26.7 지원 범위](https://docs.nvidia.com/networking/display/kubernetes2670/platform-support.html)와 구분했다.
- RDMA 모드 변경 조건을 기본 `init_net` 외의 다른 네임스페이스가 없어야 한다는 뜻으로 고쳤다. [Linux v6.18 구현](https://github.com/torvalds/linux/blob/v6.18/drivers/infiniband/core/device.c#L1120-L1149)을 확인했다.

전체 외부 자료를 새로 검증하거나 GPU 장비 실험을 수행한 작업은 아니다. 원문의 실측 여부와 미확인 조건은 유지했다.

## 검증 기록

- Hugo **0.166.0 extended**로 원본과 최종 후보를 각각 빌드했다. 최종 후보는 **724 pages**로 성공했다.
- 내비게이션 검사에서 **371 HTML**, **1,821 경로·리소스**를 원본 빌드와 비교했다. 내부 링크·리소스·canonical·사이드바 검사를 통과했다.
- 기존 공개 헤딩 ID **123개**, 전체 HTML ID **182개**를 유지했다. 새 중복 ID는 없다.
- 기존 회귀 테스트 **17개**와 `git diff --check`를 통과했다.
- 12개 문서의 frontmatter, 코드 블록 **30개**, 도식 shortcode와 자산, 기존 외부 URL과 내부 참조 대상을 보존했다. 중복 근거표·링크를 합칠 때 같은 참조의 반복 횟수는 줄일 수 있도록 대조했다.
- WWE 습관 표현 검색 후 문맥을 검토했다. 기술적 개수를 뜻하는 ‘멤버 매칭 세 가지’와 실제 로그 기록을 뜻하는 ‘남깁니다’는 유지했다.
- 원본 SHA-256을 재대조한 뒤 검증한 최종 후보를 격리된 작업 트리에 적용했다. 다른 세션의 작업은 커밋 범위에 넣지 않았다.

원본·후보·편별 메모·교차 검토·보존 검사·앵커 검사·digest는 로컬 `_workspace/structure-2026-10-21-gpu-astra/`에 보관했다. `run.json`에서 각 기록을 연결한다.
