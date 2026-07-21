---
title: "karpenter — 0.36.2 → 1.14.0, v1beta1→v1 CRD"
weight: 1
---

# karpenter — 0.36.2 → 1.14.0, v1beta1→v1 CRD

{{< callout type="info" >}}
**한눈에**
- 최신 stable **1.14.0**(2026-07-11 릴리스)로 직행한다. k8s 1.33을 지원하는 최소가 1.5이고 1.14는 1.30~1.36을 커버하므로 "가능한 최신 stable" 방침에 맞는다 `✓`
- **선행 사실**: finance가 쓰는 0.36.2는 이미 **v1beta1**(`karpenter.sh/v1beta1` NodePool·`karpenter.k8s.aws/v1beta1` EC2NodeClass) 스키마다. v1alpha5(Provisioner/AWSNodeTemplate)는 v0.33에서 이미 졸업했으므로 finance에는 해당 없다 — 남은 경계는 **v1beta1 → v1** 하나뿐이다 `✓`
- v1에서 **`amiSelectorTerms`가 필수화**된다. 누락하면 EC2NodeClass와 이를 참조하는 모든 NodePool이 통째로 `NotReady`가 된다 `✓`
- v1은 **drift를 GA로 승격시키며 비활성화가 불가능**해진다 — finance가 명시한 `featureGates.drift: false`는 무효화되고 drift가 강제로 켜진다 `✓`
- **blue-green 신규 클러스터라 conversion 웹훅 왕복이 불필요**하다. 기존 클러스터를 in-place로 올릴 때만 필요한 0.36→0.36.9→1.0.x→1.1+ 순차 경로를 건너뛰고, v1 CRD + v1 매니페스트로 1.14.0을 처음부터 설치한다 `✓`
{{< /callout >}}

## 버전 diff와 무엇이 바뀌는가

컨트롤러는 `0.36.2`에서 `1.14.0`으로, 차트는 org의 `karpenter-v2`(v1beta1 스키마)를 폐기하고 이미 v1 스키마인 신 차트 `karpenter`를 채택한다. org 차트의 tip(appVersion 1.1.0)은 이미 v1 스키마이지만 **k8s 1.33을 지원하지 않으므로**(1.1.0은 k8s ≤1.31까지), appVersion을 1.14.0으로 리워크한 뒤 재퍼블리시해야 한다.

CRD 경계가 이 업그레이드의 핵심이다. `NodePool`과 `EC2NodeClass`가 각각 `karpenter.sh/v1beta1`→`v1`, `karpenter.k8s.aws/v1beta1`→`v1`로 이동한다. 이와 함께 세 가지가 같이 바뀐다.

- **`amiSelectorTerms` 필수화** — 기존 `amiFamily: AL2023`만으로 자동해석되던 방식이 v1에서는 명시적 `amiSelectorTerms`(예: `alias: al2023@latest`)를 요구한다. 신 차트는 이 기본값을 이미 제공하므로, override로 비우지만 않으면 된다.
- **kubelet 설정 위치 이동** — `NodePool.spec.template.spec.kubelet`에서 `EC2NodeClass.spec.kubelet`으로 옮겨간다. finance는 kubelet을 별도로 설정하지 않으므로 이 항목의 실질 영향은 낮다.
- **disruption 리네임** — `consolidationPolicy: WhenUnderutilized`가 `WhenEmptyOrUnderutilized`로 이름이 바뀌고, expiration이 forceful로 바뀌어 대체 노드 선provision 없이 즉시 drain을 시작하며, disruption taint가 `karpenter.sh/disruption=disrupting`에서 `karpenter.sh/disrupted`로 바뀐다.

`settings.interruptionQueue`는 flat 키 구조가 v1에서도 그대로 유지된다. 다만 finance의 일부 values 파일에는 pre-0.32 시절의 죽은 키 `settings.aws.interruptionQueueName`·`settings.aws.defaultInstanceProfile`가 잔재로 남아 있다 — 실제 interruption queue는 overlay의 flat 키가 이미 공급하고 있으므로 기능 손실 없이 정리만 하면 된다. IAM 쪽은 컨트롤러 정책을 v1 전용으로 다시 생성해야 한다. v1에서는 인스턴스·인스턴스프로파일에 `eks:eks-cluster-name` 태그 스코핑이 추가되고, 이후 마이너(1.7의 `iam:ListInstanceProfiles`, 1.11의 `ec2:DescribePlacementGroups`, 1.12의 `ec2:DescribeInstanceStatus`)에서 권한이 계속 늘어난다.

## finance 적용 절차

세 레포에 걸쳐 있다.

1. **차트 소스(org 차트)** — 이미 v1 스키마인 신 차트를 채택하고 `appVersion`·의존성 버전을 1.14.0으로 bump한 뒤 차트 버전 자체도 올려 재퍼블리시한다. v1 CRD가 upstream 관례대로 별도 `karpenter-crd` 차트나 `crds/` 경로로 적용되는지는 배포 전 확인이 필요하다(ArgoCD가 Server-Side Apply를 쓰는 중이라 우호적).
2. **values(overlay)** — `provisioner:`(spot/ondemand/systemOndemand 등 per-pool 키) 구조를 신 차트의 `nodePool:`/`nodeClass:` map 구조로 재작성한다. `settings.aws.*` 죽은 키를 제거하고, `featureGates.drift: false`를 삭제한다(v1에서 무효한 키이며, 남겨두면 오류 소지가 있다). `amiSelectorTerms`는 신 차트 기본값(`alias: al2023@latest`)을 그대로 신뢰하되 override로 비우지 않는다.
3. **ArgoCD app-of-apps(targetRevision 핀)** — 차트 경로를 구 차트에서 신 차트로 바꾸고 targetRevision을 리워크된 버전으로 갱신한다. `clusterName`·`karpenter.settings.clusterEndpoint` 같은 flat Helm 파라미터는 v1에서도 유효하나, 신 차트의 값 키명과 정합이 맞는지 재확인한다.

배포 순서는 신규 blue 클러스터 기준으로 (1) v1 컨트롤러 IAM 정책 + IRSA 롤 + 노드 롤 선행 → (2) v1 CRD 설치 → (3) karpenter 1.14.0 컨트롤러 설치 → (4) 워크로드 스케줄로 노드 프로비저닝 확인 순이다(전체 클러스터 부트스트랩 순서상의 위치는 [클러스터 부트스트랩]({{< relref "../04-cluster-bootstrap.md" >}}) 참고). 검증은 아래 실행 체크리스트를 따른다.

## 컨트롤러가 Fargate에서 돌 때 — 재작성 요건

신규 blue 클러스터는 managed nodegroup을 두지 않고, karpenter 컨트롤러 자신도 CoreDNS와 함께 **Fargate profile**(`{ns: karpenter}`)로 뜬다. Fargate 배치 제약 자체(amd64 전용·DaemonSet 미부착 등)는 [클러스터 설정]({{< relref "../02-cluster-config.md" >}})이 단일 소유로 다루므로, 여기서는 이 배치가 karpenter 컨트롤러 values에 강제하는 두 재작성만 못박는다.

- **`affinity.nodeAffinity`(arm64 + system-primary)와 `tolerations`(arch/nodegroup/spot 등) 전량 제거** — 남기면 컨트롤러 파드가 영구 `Pending`에 걸린다.
- **`controller.resources`를 `cpu: 1` / `memory ≥ 1Gi`(requests=limits)로 명시** — 과소 설정(기존 기본값 0.25 vCPU/256Mi 수준) 시 CPU 기아로 **리더 election이 반복 유실**되는 사고가 사내에서 실제로 있었다.

두 항목 다 v1beta1→v1 CRD 마이그레이션과는 독립적인 배치 제약이라, values 리워크(위 §finance 적용 절차 2번) 때 CRD 스키마 변경과 함께 한 번에 반영하는 것이 효율적이다.

## 실행 체크리스트

- [ ] **배포 후 검증** — `kubectl get nodepool,ec2nodeclass -o wide` 전부 `Ready=True`·apiVersion `v1`인지, `kubectl get nodeclaim`으로 노드가 목표 k8s 버전으로 등록되는지, 컨트롤러 로그에 `UnauthorizedOperation`이 없는지, interruption 큐가 실제로 소비되는지 확인한다.
- [ ] **Fargate amd64 고정 누락** — 컨트롤러 arm64 required affinity를 지우지 않으면 karpenter 자신이 영구 Pending에 걸려 아무 노드도 프로비저닝되지 않는다.
- [ ] **컨트롤러 리소스 과소 설정** — `cpu=1/memory≥1Gi` 미명시 시 CPU 기아로 리더 election이 반복 유실된다(사내 실사고 이력).
- [ ] **drift 강제 ON** — `featureGates.drift: false` 무효화로 v1에서 drift가 상시 활성화된다. AMI·설정 변경 시 대량 노드 교체가 유발될 수 있으므로 disruption budget(`defaultBudgets`)을 사전 검토한다.
- [ ] **`amiSelectorTerms` 누락 시 전면 `NotReady`** — override로 비우지 않는다.
- [ ] **org 차트 tip(1.1.0)이 1.33 미지원** — appVersion을 반드시 1.14.0(최소 1.5)으로 bump한다.
- [ ] **IAM v1 정책 미적용 시 프로비저닝 실패** — `eks:eks-cluster-name` 태그 스코핑 + 1.7/1.11/1.12에서 추가된 권한 포함 여부를 확인한다.
- [ ] **AMI 핀 정책 결정** — 특정 AMI를 핀할지 `alias: al2023@latest` 자동해석을 쓸지는 팀 결정 사항이다.
- [ ] **CRD 적용 경로 확정** — v1 CRD가 ArgoCD로 확실히 적용되는지 배포 전 확인한다.
- [ ] **rollback** — in-place 경로를 택할 경우에만 0.36.2→0.36.9→1.0.x(매니페스트 v1 이관)→1.1+→…→1.14 순서를 엄수해야 하며, 마이너 스킵 금지 경계는 v1.0/v1.1(v1beta1 서빙 종료)이다. blue-green 신규 설치는 targetRevision을 이전 값으로 되돌리는 것으로 되돌릴 수 있다.

## 근거

- 호환 매트릭스(1.33=≥1.5, 1.14=1.30~1.36): `https://karpenter.sh/docs/upgrading/compatibility/`
- v1 마이그레이션(conversion 웹훅, amiSelectorTerms 필수, kubelet 이동, drift GA, IAM 스코핑, disruption 리네임): `https://karpenter.sh/v1.0/upgrading/v1-migration/`
- 마이너별 breaking(1.1 v1beta1 종료, 1.7/1.11/1.12 IAM 추가, 1.14 capacity buffers/DRA): `https://karpenter.sh/docs/upgrading/upgrade-guide/`
- v1.0.0 릴리스노트: `https://github.com/aws/karpenter-provider-aws/releases/tag/v1.0.0`
- SpotToSpotConsolidation이 v1에서도 ALPHA·기본 비활성 유지: `https://karpenter.sh/docs/concepts/disruption/`
