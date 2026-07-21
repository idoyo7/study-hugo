---
title: "목표 버전 실검증 — 1.35 vs 1.36 (2026-07-21 라이브 확인)"
weight: 7
---

# 목표 버전 실검증 — 1.35 vs 1.36 (2026-07-21 라이브 확인)

{{< callout type="info" >}}
**한눈에**
- **green은 절벽이 아니다.** 조사 도중 1.31로 in-place가 이미 끝나 있었다 — 확장지원 종료는 **2026-11-26**, 약 4개월 런웨이가 있다 `✓`.
- **1.36 차단 컴포넌트는 4종이 아니라 6종이다.** [목표 버전 판정]({{< relref "02-strategy-target-version.md" >}})이 지목한 KEDA·kube-state-metrics·external-secrets·Argo CD에, 이번 라이브 검증에서 **argo-rollouts·aws-load-balancer-controller가 추가**로 확인됐다 `✓`.
- **1.35는 여전히 유효한 판정.** 컨트롤플레인·EKS managed core·Karpenter·Istio·metrics-server·descheduler까지 6종은 1.35/1.36 모두 지원이라 무관하고, 실제 판정을 가르는 건 위 6종의 지원 릴리스 유무뿐이다 `✓`.
- **kube-proxy nftables는 opt-in 한 줄로 켤 수 있다** — 기본값은 여전히 iptables이고, IPVS는 "1.36에서 제거"가 아니라 ~v1.43까지는 deprecated 상태로 계속 동작한다(이전 서술 정정) `✓`.
{{< /callout >}}

[이관 전략과 목표 버전]({{< relref "02-strategy-target-version.md" >}})에서 1.35를 판정한 지점으로부터 시간이 좀 지났고, 그사이 green 좌표도 바뀌었다. 이 페이지는 2026-07-21 시점에 공식 소스(업스트림 릴리스 노트, `aws eks describe-addon-configuration`, 각 컴포넌트 릴리스 채널)를 직접 다시 짚어 **1.35 대 1.36 판정이 여전히 유효한지**를 검증한 결과다. 결론은 "판정 자체는 그대로이지만, 차단 요인의 개수와 성격이 이전 리서치보다 더 넓다"는 것이다. 컴포넌트별 실제 마이그레이션 절차는 [컴포넌트별 마이그레이션]({{< relref "components/_index.md" >}})이, EKS managed addon 4종의 부트스트랩 순서는 [managed addon 페이지]({{< relref "05-managed-addons.md" >}})가 이어받는다.

## 1. 버전 가용성과 현재 좌표 — green 1.31, 런웨이 재확인

| 항목 | 값 |
|---|---|
| upstream k8s 1.36 "Haru" GA | 2026-04-22 |
| EKS 1.35 GA | 2026-01-27 |
| EKS 1.36 GA | 2026-06-02(전 리전·GovCloud 포함) |
| finance green 현재 버전 | **k8s 1.31**(in-place 완료 직후) |
| green 표준지원 종료 | 2025-11-26(경과) |
| green 확장지원 종료 | **2026-11-26** |

1.35·1.36 모두 이미 전 리전에서 GA된 상태라 blue 신규 클러스터를 둘 중 어느 쪽으로 직행 생성해도 가용성 문제는 없다. 달라진 건 출발선이다 — green이 1.30이 아니라 **1.31**로 한 단계 올라와 있어, 확장지원 종료가 **2026-11-26**까지 밀렸다. [3대 확정 결정]({{< relref "_index.md" >}})이 서술한 "임박한 절벽" 긴급도는 더는 유효하지 않고, 약 **4개월의 런웨이**가 확보돼 있다. 이 재확인이 목표 버전 자체를 바꾸지는 않지만, "지금 당장 1.36으로 강행할 이유가 없다"는 §6의 권고를 뒷받침하는 근거가 된다.

## 2. 1.35 vs 1.36 컴포넌트 호환성 매트릭스

각 컴포넌트가 **공식적으로 지원을 명시한** 최고 k8s 마이너를 라이브로 재확인한 결과다.

| 컴포넌트 | 1.35 | 1.36 | 비고 |
|---|---|---|---|
| EKS 컨트롤플레인 | 지원 | 지원(GA 2026-06-02) | 직행 생성 가능 |
| EKS managed core(vpc-cni/kube-proxy/coredns/aws-ebs-csi-driver) | 지원 | 지원 | 1.36용 EKS addon 빌드 존재 |
| Karpenter | 지원(≥1.9) | 지원(≥1.13, 목표 1.14.0) | 0.36.2→1.14.0은 v1beta1→v1 CRD 전환 때문에 어차피 필수([컴포넌트별 마이그레이션]({{< relref "components/01-karpenter.md" >}})) |
| Istio | 지원(≥1.29) | 지원(1.30.x, 목표 1.30.3) | 1.30이 k8s 1.32~1.36 지원 |
| metrics-server | 지원(0.9.0) | 지원(0.9.0) | deps가 k8s 1.36.2로 bump |
| descheduler | 지원(0.35.1) | 지원(0.36.0) | k8s 마이너 트래킹 |
| Argo CD | 지원(v3.4.5) | 🔴 미지원 | 3.5에 1.36 코드가 머지됐으나 v3.5.0-rc2까지, GA 없음 |
| Argo Rollouts | 지원(v1.9.1) | 🔴 미지원 | v1.10-rc1도 1.36 미커버 — **이전 내부 리서치 미기재 항목** |
| aws-load-balancer-controller | 지원(v3.2+) | 🔴 미지원 | v3.4.2가 여전히 client-go 1.35 — **이전 내부 리서치 미기재 항목** |
| external-secrets(ESO) | 지원(2.8.x) | 🔴 미지원 | 1.36 릴리스 없음, non-EOL 폴백 없음 |
| KEDA | 지원(2.20.1) | 🔴 미지원 | 2.20 상한이 1.35, 2.21 미출시(~2026-09 전망) |
| kube-state-metrics | 지원(2.19) | 🔴 미지원 | `main` 브랜치만 1.36, 정식 릴리스 없음 |
| victoria-metrics-k8s-stack | 지원(0.75+) | 🟡 부분 | operator는 대응하지만 KSM 서브차트가 발목 |
| aws-for-fluent-bit | 지원(chart 0.2.0) | ⚪ 불명 | AWS가 k8s 버전 인증을 게시하지 않음. 버전무관 구조라 실동작 가능성은 높음 |

## 3. 1.36 차단 6종 — 이전 리서치의 4종 과소집계

[목표 버전 판정]({{< relref "02-strategy-target-version.md" >}}) §3.2는 1.36을 막는 컴포넌트를 KEDA·kube-state-metrics·external-secrets·Argo CD **4종**으로 지목했다. 이번 라이브 재검증에서는 여기에 **argo-rollouts·aws-load-balancer-controller가 추가**로 확인돼 실제 차단 컴포넌트는 **6종**이다 — 두 컴포넌트 모두 이전 리서치 시점엔 별도로 조사되지 않았거나, 조사됐어도 문서에 반영되지 않았던 항목이다.

**차단 6종**: Argo CD · Argo Rollouts · aws-load-balancer-controller · external-secrets · KEDA · kube-state-metrics.

해소 전망은 컴포넌트마다 다르다.

- **먼저 풀리는 쪽**: Argo CD(3.5 GA 임박), kube-state-metrics(v2.20 임박).
- **나중에 풀리는 쪽**: KEDA(2.21, ~2026-09 전망), external-secrets(가장 보수적 — 폴백 없이 EOL 압박을 받는 프로젝트 정책상 신규 마이너 지원까지 시간이 더 걸린다).
- **전 스택 1.36 정렬 예상 시점**: 대략 2026 Q3말~Q4초. 임계경로는 **KEDA·external-secrets 둘**이다 — 나머지 4종이 먼저 풀려도 이 둘이 막혀 있으면 blue-green 전체를 1.36으로 못 올린다.

두 항목이 이전 리서치에서 누락된 이유까지 추적할 필요는 없지만, 이번 재검증 이후 컴포넌트별 마이그레이션 문서를 다시 훑을 때는 [components/03(GitOps·argo-rollouts)]({{< relref "components/03-gitops-argocd-rollouts.md" >}})·[components/05(ALB)]({{< relref "components/05-networking-ingress.md" >}})도 1.36 차단 목록에 포함해 읽어야 한다.

## 4. kube-proxy nftables — 정정과 활성화 절차

이전 [managed addon 페이지]({{< relref "05-managed-addons.md" >}}) §2-2에서도 한 차례 재조사했던 내용을 이번에 다시 라이브로 확인했다. 핵심은 크게 바뀌지 않았지만, 활성화 절차와 IPVS 제거 시점 서술을 더 정확히 정정한다.

- **기본값은 여전히 iptables다.** upstream 1.35/1.36 모두 기본 프록시 모드는 iptables이고, nftables는 1.33에서 GA됐을 뿐 default 전환 계획이 없다 — 쓰려면 명시적으로 설정해야 한다.
- **EKS kube-proxy managed addon도 기본값 iptables.** 다만 `configurationSchema`의 `mode` enum에 `nftables`가 kube-proxy addon **v1.31 계열부터** 포함됐다(1.30 계열에는 없다). 1.33~1.36 전 구간의 최신 addon 버전은 `mode` enum이 `["iptables", "ipvs", "nftables"]`로 확인된다(`aws eks describe-addon-configuration` 직접 확인).
- **활성화 절차**는 아래 한 줄이면 끝난다. 별도 하위필드는 없다(ipvs만 `scheduler` 하위필드를 갖는다).

  ```bash
  aws eks update-addon \
    --cluster-name $CLUSTER \
    --addon-name kube-proxy \
    --configuration-values '{"mode":"nftables"}' \
    --resolve-conflicts OVERWRITE
  ```

  신규 생성 시에는 `create-addon`에 동일한 `--configuration-values`를 넘기면 된다.
- **커널 요구사항**: 5.13+. AL2023은 6.x 커널이라 조건을 충족한다.
- **IPVS 서술 정정**: 1.35에서 deprecated된 것은 맞지만 "1.36에서 제거"는 부정확하다. 실제 코드 삭제는 KEP-5495 기준 **~v1.43** 예정이며(1.37 feature gate → 1.40 default off → 1.43 삭제), 1.35·1.36 어느 쪽에서도 IPVS는 deprecated 경고와 함께 여전히 동작한다. 즉 nftables 전환은 **강제가 아니라 성능·권장 사유로 고르는 선택**이다.
- **주의 두 가지**: AWS best-practices 문서(`ipvs.html`)는 본문이 stale하다 — 상단 경고 박스만 최신화됐고 본문 서술은 여전히 IPVS를 권장하는 투다. 그리고 **VPC CNI × nftables 상호작용은 1차 소스로 확인되지 않은 unknown 영역**이다. blue-green이라 그나마 리스크가 낮은 전환이지만, 전체 적용 전에 **카나리 노드그룹으로 먼저 검증**하는 것을 권장한다.

## 5. 직행(1.31→1.35/1.36) breaking 체크리스트

blue-green은 마이너를 하나씩 밟지 않고 목표 버전으로 곧바로 생성하므로, **1.32~1.35(또는 1.36) 구간의 breaking 변경이 한꺼번에 적용**된다. 컷오버 전 매니페스트·Helm values를 아래 항목으로 grep 점검한다.

| 도입 버전 | breaking 변경 |
|---|---|
| 1.32 | `flowcontrol.apiserver.k8s.io/v1beta3` 완전 제거 → `v1`로 전환 |
| 1.33 | AL2 AMI 지원 종료 → AL2023/Bottlerocket 필수 |
| 1.34 | `VolumeAttributesClass` `v1beta1`→`v1` GA 전환 |
| 1.35 | cgroup v1 지원 제거(AL2023은 v2라 영향 적음), containerd 1.x 지원 종료 |
| 1.36(목표 시) | `gitRepo` 볼륨 영구 비활성, containerd 2.0+ 필수, `StrictIPCIDRValidation` 기본 활성(non-canonical CIDR 거부) |

IPVS 제거는 이 목록에 없다 — §4에서 정정했듯 ~v1.43 예정이라 1.35/1.36 어느 쪽으로 가도 아직 해당하지 않는다.

## 6. 우리 케이스에서는

지금 당장 가야 한다면 **1.35 blue-green이 정답**이다. 전 컴포넌트가 공식 지원 릴리스를 갖고 있어 리스크가 가장 낮고, [목표 버전 판정]({{< relref "02-strategy-target-version.md" >}})의 결론이 이번 재검증으로도 그대로 유지된다. 1.36을 원한다면 **6~10주 후 재검증**을 권한다 — 그사이 스테이징에서 Argo CD 3.5-rc·kube-state-metrics `main` 빌드를 선행 검증해두면, 두 컴포넌트의 GA 도착 즉시 이관할 수 있다. 다만 임계경로인 KEDA·external-secrets는 이보다 늦게 풀리므로, 6종 전부가 맞춰지는 시점은 그보다 더 뒤(대략 2026 Q3말~Q4초)로 봐야 한다.

green이 1.31로 이미 올라와 있어 확장지원 종료(2026-11-26)까지 여유가 있다는 것도 1.36을 서두를 이유가 없다는 근거다. **1.36 강행은 권장하지 않는다** — external-secrets는 폴백 없이 미검증 상태로 운영해야 하고, KEDA 미지원은 오토스케일링이 붕괴할 리스크를 그대로 안고 가는 셈이다. kube-proxy nftables 전환은 1.35 blue-green과 독립적으로 언제든 opt-in 가능하니, 목표 버전 판정과 별개로 [managed addon 페이지]({{< relref "05-managed-addons.md" >}})의 부트스트랩 순서 안에서 카나리 검증 후 채택 여부를 정하면 된다.
