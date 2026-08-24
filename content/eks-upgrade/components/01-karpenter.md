---
title: "karpenter — 0.36.2 → 1.14.0, v1beta1→v1 CRD"
weight: 1
---

# karpenter — 0.36.2 → 1.14.0, v1beta1→v1 CRD

{{< callout type="info" >}}
- 컨트롤러를 `0.36.2`에서 최신 stable `1.14.0`(2026-07-11 릴리스)로 올립니다. 목표 k8s 1.35를 지원하는 최소가 1.9이고 1.14는 1.30~1.36을 커버하니 "가능한 최신 stable" 방침에 맞습니다 — 1.36으로 재검토할 때도 하한이 1.13이라 1.14.0이 그대로 유효합니다 `✓`
- 넘을 스키마 경계는 `v1beta1` → `v1` 하나뿐입니다. finance의 0.36.2는 이미 v1beta1(`karpenter.sh/v1beta1` NodePool·`karpenter.k8s.aws/v1beta1` EC2NodeClass)입니다. v1alpha5의 Provisioner·AWSNodeTemplate은 v0.33에서 졸업해 애초에 없습니다 `✓`
- v1에서 `amiSelectorTerms`가 필수가 됩니다. 빠뜨리면 EC2NodeClass와 이를 참조하는 모든 NodePool이 통째로 `NotReady`가 됩니다 `✓`
- v1은 drift를 GA로 승격시키면서 끄는 수단을 없앱니다. finance가 명시한 `featureGates.drift: false`는 무효가 되고 drift가 강제로 켜집니다 `✓`
- blue-green 신규 클러스터라 conversion 웹훅을 왕복하지 않습니다. 기존 클러스터를 in-place로 올릴 때만 밟아야 하는 `0.36 → 0.36.9 → 1.0.x → 1.1+` 순차 경로를 건너뛰고 v1 CRD와 v1 매니페스트로 1.14.0을 처음부터 세웁니다 `✓`
{{< /callout >}}

## 1. 왜 1.14.0인가

목표 클러스터가 k8s 1.35라서 버전은 거의 정해집니다. karpenter 호환 매트릭스에서 1.35를 받는 최소 버전이 1.9이고 1.14는 1.30~1.36을 커버합니다. "가능한 최신 stable"이라는 방침과 하한 조건이 같은 답을 가리킵니다. 나중에 1.36으로 재검토하더라도 그때의 하한이 1.13이라 1.14.0은 그대로 쓸 수 있습니다.

차트도 같이 갈아탑니다. org의 `karpenter-v2`(v1beta1 스키마)를 폐기하고 이미 v1 스키마인 신 차트 `karpenter`를 채택합니다.

문제는 그 차트의 버전입니다. tip은 appVersion 1.1.0으로 이미 v1 스키마이긴 하지만 1.1.0이 지원하는 k8s는 ≤1.31이라 1.35에서는 쓸 수 없습니다. 스키마만 맞다고 올릴 수 있는 게 아니므로 appVersion을 1.14.0으로 리워크한 뒤 재퍼블리시하는 작업이 먼저입니다.

## 2. v1이 깨는 것

이 업그레이드에서 문제가 되는 곳은 CRD 경계입니다. `NodePool`이 `karpenter.sh/v1beta1`에서 `v1`으로, `EC2NodeClass`가 `karpenter.k8s.aws/v1beta1`에서 `v1`으로 옮겨갑니다. 그 이동에 딸려 오는 변경이 셋입니다.

`amiSelectorTerms` 필수화. 지금까지는 `amiFamily: AL2023`만 적어두면 자동으로 해석됐지만 v1은 `alias: al2023@latest` 같은 명시적 `amiSelectorTerms`를 요구합니다. 빠뜨리면 EC2NodeClass와 이를 참조하는 NodePool 전부가 `NotReady`로 떨어집니다. 다행히 신 차트가 이 기본값을 이미 들고 있어서 override로 비우지만 않으면 손댈 일이 없습니다.

kubelet 설정의 이사. `NodePool.spec.template.spec.kubelet`에 있던 것이 `EC2NodeClass.spec.kubelet`으로 옮겨갑니다. finance는 kubelet을 따로 설정하지 않으므로 실제 영향은 낮습니다.

disruption 어휘 변경. `consolidationPolicy: WhenUnderutilized`가 `WhenEmptyOrUnderutilized`로 이름을 바꿉니다. expiration은 forceful로 바뀌어 대체 노드를 선provision하지 않고 곧바로 drain을 시작합니다. disruption taint도 `karpenter.sh/disruption=disrupting`에서 `karpenter.sh/disrupted`로 이름이 달라집니다.

릴리스 노트에 이름이 붙지 않은 변화가 하나 더 있습니다. v1은 drift를 GA로 올리면서 비활성화 수단을 없앱니다. finance가 명시해 둔 `featureGates.drift: false`는 효력을 잃고 drift가 상시 켜집니다. 그 상태에서 AMI나 설정을 바꾸면 노드가 대량으로 교체될 수 있습니다. disruption budget(`defaultBudgets`)을 미리 검토해야 합니다.

설정 키 쪽은 대체로 손댈 게 없습니다. `settings.interruptionQueue`의 flat 키 구조는 v1에서도 유지됩니다. finance 일부 values에는 pre-0.32 시절의 죽은 키 `settings.aws.interruptionQueueName`·`settings.aws.defaultInstanceProfile`가 잔재로 남아 있습니다 — 실제 interruption queue는 overlay의 flat 키가 이미 공급하고 있으니 기능 손실 없이 지우기만 하면 됩니다.

IAM은 정책을 v1 전용으로 다시 만들어야 합니다. v1에서 인스턴스와 인스턴스프로파일에 `eks:eks-cluster-name` 태그 스코핑이 붙습니다. 그 뒤 마이너에서도 권한이 계속 늘어납니다 — 1.7의 `iam:ListInstanceProfiles`, 1.11의 `ec2:DescribePlacementGroups`, 1.12의 `ec2:DescribeInstanceStatus`. v1 정책을 적용하지 않으면 프로비저닝이 실패하므로 태그 스코핑과 이 셋이 정책에 들어 있는지 확인합니다.

## 3. 적용 절차

### Fargate 배치가 강제하는 values 재작성

신규 blue 클러스터에는 managed nodegroup이 없고 karpenter 컨트롤러도 CoreDNS와 함께 Fargate profile(`{ns: karpenter}`)로 뜹니다. Fargate 배치 제약 자체(amd64 전용·DaemonSet 미부착 등)는 [클러스터 설정]({{< relref "../02-cluster-config.md" >}})이 단일 소유로 다루므로 여기서는 그 배치가 컨트롤러 values에 강제하는 둘만 명시합니다.

- `affinity.nodeAffinity`(arm64 + system-primary)와 `tolerations`(arch/nodegroup/spot 등)를 전량 제거합니다. 남겨두면 컨트롤러 파드가 영구 `Pending`에 걸립니다. karpenter 자신이 뜨지 못하니 노드가 하나도 프로비저닝되지 않습니다.
- `controller.resources`를 `cpu: 1` / `memory ≥ 1Gi`(requests=limits)로 명시합니다. 기존 기본값 수준(0.25 vCPU/256Mi)으로 두면 CPU 기아 때문에 리더 election이 반복 유실됩니다 — 사내에서 실제로 겪은 사고입니다.

둘 다 v1beta1→v1 CRD 마이그레이션과는 무관한 배치 제약이지만 손대는 파일이 같은 values입니다. 아래 세 레포 작업 2번에서 스키마 재작성과 함께 반영하는 편이 낫습니다.

### 세 레포에 걸친 작업

1. 차트 소스(org 차트) — 이미 v1 스키마인 신 차트를 채택하고 `appVersion`과 의존성 버전을 1.14.0으로 bump한 뒤 차트 버전 자체도 올려 재퍼블리시합니다. v1 CRD가 upstream 관례대로 별도 `karpenter-crd` 차트나 `crds/` 경로로 적용되는지는 배포 전에 확인해야 합니다. ArgoCD가 Server-Side Apply를 쓰는 중이라 이쪽 조건은 유리합니다.
2. values(overlay) — `provisioner:`(spot/ondemand/systemOndemand 등 per-pool 키) 구조를 신 차트의 `nodePool:`/`nodeClass:` map 구조로 재작성합니다. 같은 패스에서 `settings.aws.*` 죽은 키를 제거하고 `featureGates.drift: false`를 삭제합니다(v1에서 무효한 키이며 남겨두면 오류 소지가 있습니다). `amiSelectorTerms`는 신 차트 기본값(`alias: al2023@latest`)을 그대로 신뢰하되 override로 비우지 않습니다. 위 Fargate 재작성 두 건도 여기서 함께 넣습니다.
3. ArgoCD app-of-apps(targetRevision 핀) — 차트 경로를 구 차트에서 신 차트로 바꾸고 targetRevision을 리워크된 버전으로 갱신합니다. `clusterName`·`karpenter.settings.clusterEndpoint` 같은 flat Helm 파라미터는 v1에서도 유효하지만 신 차트의 값 키명과 정합이 맞는지는 다시 확인합니다.

배포는 신규 blue 클러스터 기준으로 (1) v1 컨트롤러 IAM 정책 + IRSA 롤 + 노드 롤 선행 → (2) v1 CRD 설치 → (3) karpenter 1.14.0 컨트롤러 설치 → (4) 워크로드를 스케줄해 노드 프로비저닝 확인 순서입니다. 이 순서가 전체 클러스터 부트스트랩에서 어디에 놓이는지는 [클러스터 부트스트랩]({{< relref "../04-cluster-bootstrap.md" >}})을 참고합니다.

## 4. 검증과 롤백

배포 전에 결정하거나 확인해야 하는 것부터 봅니다.

- [ ] AMI 핀 정책 결정 — 특정 AMI를 핀할지 `alias: al2023@latest` 자동해석을 쓸지는 팀이 정합니다.
- [ ] CRD 적용 경로 확정 — v1 CRD가 ArgoCD로 확실히 적용되는지 배포 전에 확인합니다.
- [ ] IAM v1 정책 반영 — `eks:eks-cluster-name` 태그 스코핑과 1.7/1.11/1.12에서 추가된 권한이 정책에 들어 있는지 확인합니다.
- [ ] disruption budget 사전 검토 — drift가 강제로 켜지므로 AMI·설정을 바꾸면 노드가 대량으로 교체될 수 있습니다. `defaultBudgets`를 미리 검토합니다.
- [ ] Fargate values 2건 반영 — arm64 required affinity·tolerations 제거와 `cpu=1`/`memory≥1Gi` 명시(§3 Fargate).
- [ ] org 차트 appVersion bump — tip(1.1.0)은 k8s 1.35를 지원하지 않습니다. 1.14.0으로 올립니다(1.35 하한은 1.9).

배포 후에는 넷을 봅니다.

- [ ] `kubectl get nodepool,ec2nodeclass -o wide`가 전부 `Ready=True`이고 apiVersion이 `v1`인지
- [ ] `kubectl get nodeclaim`으로 노드가 목표 k8s 버전으로 등록되는지
- [ ] 컨트롤러 로그에 `UnauthorizedOperation`이 없는지
- [ ] interruption 큐가 실제로 소비되는지

롤백. blue-green 신규 설치는 targetRevision을 이전 값으로 되돌리면 원복할 수 있습니다. 순차 경로를 엄수해야 하는 쪽은 in-place를 택했을 때뿐입니다. 그 경우 `0.36.2 → 0.36.9 → 1.0.x`(매니페스트 v1 이관) `→ 1.1+ → … → 1.14` 순서를 지켜야 합니다. 마이너 스킵이 금지되는 경계는 v1beta1 서빙이 끝나는 v1.0/v1.1입니다.

## 근거

- 호환 매트릭스(1.35=≥1.9, 1.36=≥1.13, 1.14=1.30~1.36): `https://karpenter.sh/docs/upgrading/compatibility/`
- v1 마이그레이션(conversion 웹훅, amiSelectorTerms 필수, kubelet 이동, drift GA, IAM 스코핑, disruption 리네임): `https://karpenter.sh/v1.0/upgrading/v1-migration/`
- 마이너별 breaking(1.1 v1beta1 종료, 1.7/1.11/1.12 IAM 추가, 1.14 capacity buffers/DRA): `https://karpenter.sh/docs/upgrading/upgrade-guide/`
- v1.0.0 릴리스노트: `https://github.com/aws/karpenter-provider-aws/releases/tag/v1.0.0`
- SpotToSpotConsolidation이 v1에서도 ALPHA·기본 비활성 유지: `https://karpenter.sh/docs/concepts/disruption/`
