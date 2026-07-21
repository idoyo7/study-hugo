---
title: "목표 버전 — 1.35 판정과 1.36 차단 6종"
weight: 2
---

# 목표 버전 — 1.35 판정과 1.36 차단 6종

{{< callout type="info" >}}
**한눈에**
- **green은 절벽이 아니다.** 조사 도중 1.31로 in-place가 이미 끝나 있었다 — 확장지원 종료는 **2026-11-26**, 약 4개월 런웨이가 있다.
- **1.36 차단은 6종**이다 — Argo CD·argo-rollouts·aws-load-balancer-controller·external-secrets·KEDA·kube-state-metrics가 아직 1.36 지원 릴리스를 내지 않았다.
- **1.35는 유효한 판정.** 전 컴포넌트 세트가 공식 지원 릴리스를 갖는 최고 버전이자, ESO EOL 딜레마까지 해소한다.
- **kube-proxy nftables**는 opt-in 한 줄로 켤 수 있고 목표 버전과 무관하다 — 상세는 [03 managed addon]({{< relref "03-managed-addons.md" >}}).
{{< /callout >}}

이 페이지는 finance 워크로드 클러스터가 **어떤 버전을 향해** 가는지를, 2026-07-21 시점의 라이브 검증(업스트림 릴리스 노트·`aws eks describe-addon-configuration`·각 컴포넌트 릴리스 채널)을 근거로 확정한다. 왜 blue-green인가는 [배경]({{< relref "00-background.md" >}})이, 그 버전을 어떤 토폴로지·인프라로 짓는지는 [02 클러스터 설정]({{< relref "02-cluster-config.md" >}})이 다룬다.

## 1. 버전 가용성과 현재 좌표

| 항목 | 값 |
|---|---|
| upstream k8s 1.36 "Haru" GA | 2026-04-22 |
| EKS 1.35 GA | 2026-01-27 |
| EKS 1.36 GA | 2026-06-02(전 리전·GovCloud 포함) |
| finance green 현재 버전 | **k8s 1.31**(in-place 완료 직후) |
| green 표준지원 종료 | 2025-11-26(경과) |
| green 확장지원 종료 | **2026-11-26** |

1.35·1.36 모두 이미 전 리전에서 GA돼 blue 신규 클러스터를 둘 중 어느 쪽으로 직행 생성해도 가용성 문제는 없다. green이 1.31로 올라와 있어 확장지원 종료가 2026-11-26까지 밀렸고, 약 **4개월의 런웨이**가 확보돼 있다 — "임박한 절벽"은 아니지만 이 날짜를 넘기면 AWS가 컨트롤 플레인을 가장 오래된 지원 버전으로 자동 업그레이드하므로, 이관의 시점·순서를 팀이 통제하려면 그 전에 끝내는 것이 원칙이다.

### EKS 지원 종료 캘린더 (조사 시점 2026-07-21 기준)

| k8s | EKS 릴리스 | 표준지원 종료 | 확장지원 종료 | 상태 |
|---|---|---|---|---|
| **1.36** | 2026-06-02 | 2027-08-02 | 2028-08-02 | 표준지원(최신 GA) |
| **1.35** | 2026-01-27 | 2027-03-27 | 2028-03-27 | 표준지원(목표) |
| 1.34 | 2025-10-02 | 2026-12-02 | 2027-12-02 | 표준지원(폴백) |
| 1.33 | 2025-05-29 | 2026-07-29 | 2027-07-29 | 표준지원(폐기) |
| 1.32 | 2025-01-23 | 2026-03-23(경과) | 2027-03-23 | 확장지원 |
| **1.31**(현행 green) | 2024-09-26 | 2025-11-26(경과) | **2026-11-26** | 확장지원 |
| 1.30 | 2024-05-23 | 2025-07-23(경과) | 2026-07-23(경과) | 확장지원 |

1.36은 이미 GA된 최신 버전이라 "1.35가 최고"가 아니라 "1.36이 최신"이 정확한 표현이다. 컨트롤플레인 자체는 1.36을 지원해도 **애드온 세트가 막는다**(§3).

## 2. 1.35 vs 1.36 컴포넌트 호환성 매트릭스

각 컴포넌트가 **공식적으로 지원을 명시한** 최고 k8s 마이너를 라이브로 재확인한 결과다. 이 매트릭스는 지원 여부만 판정하고, 개별 컴포넌트의 실제 마이그레이션 절차는 [컴포넌트별 마이그레이션]({{< relref "components/_index.md" >}})이 잇는다.

| 컴포넌트 | 1.35 | 1.36 | 비고 |
|---|---|---|---|
| EKS 컨트롤플레인 | 지원 | 지원 | 직행 생성 가능 |
| EKS managed core(vpc-cni/kube-proxy/coredns/ebs-csi) | 지원 | 지원 | 1.36용 EKS addon 빌드 존재 |
| Karpenter | 지원(≥1.9) | 지원(≥1.13, 목표 1.14.0) | v1beta1→v1 전환 때문에 어차피 필수 → [components/01]({{< relref "components/01-karpenter.md" >}}) |
| Istio | 지원(≥1.29) | 지원(목표 1.30.3) | 1.30이 k8s 1.32~1.36 지원 |
| metrics-server | 지원(0.9.0) | 지원(0.9.0) | deps가 1.36.2로 bump |
| descheduler | 지원(0.35.x) | 지원(0.36.0) | k8s 마이너 트래킹 |
| 🔴 Argo CD | 지원(v3.4.5) | 미지원 | 3.5-rc까지, GA 없음 |
| 🔴 argo-rollouts | 지원(v1.9.1) | 미지원 | v1.10-rc1도 1.36 미커버 → [components/03]({{< relref "components/03-gitops-argocd-rollouts.md" >}}) |
| 🔴 aws-load-balancer-controller | 지원(v3.2+) | 미지원 | v3.4.2가 여전히 client-go 1.35 → [components/05]({{< relref "components/05-networking-ingress.md" >}}) |
| 🔴 external-secrets(ESO) | 지원(2.8.x) | 미지원 | 1.36 릴리스 없음, non-EOL 폴백 없음 → [components/04]({{< relref "components/04-secrets-autoscaling.md" >}}) |
| 🔴 KEDA | 지원(2.20.1) | 미지원 | 2.20 상한이 1.35, 2.21 미출시(~2026-09 전망) → [components/04]({{< relref "components/04-secrets-autoscaling.md" >}}) |
| 🔴 kube-state-metrics | 지원(2.19) | 미지원 | `main` 브랜치만 1.36, 정식 릴리스 없음 → [components/06]({{< relref "components/06-observability.md" >}}) |
| victoria-metrics-k8s-stack | 지원(0.75+) | 🟡 부분 | operator는 대응하나 KSM 서브차트가 발목 |
| aws-for-fluent-bit | 지원 | ⚪ 불명 | AWS가 k8s 인증 미게시, 버전무관 구조라 실동작 가능성 높음 |

kube-proxy nftables는 1.35/1.36 어느 쪽과도 무관하다(정정 상세 → [03 managed addon]({{< relref "03-managed-addons.md" >}})).

## 3. 1.36 차단 6종

**차단 6종**: Argo CD · argo-rollouts · aws-load-balancer-controller · external-secrets · KEDA · kube-state-metrics. 컨트롤플레인·EKS managed core·Karpenter·Istio·metrics-server·descheduler 6종은 1.35/1.36 모두 지원이라 무관하고, 실제 판정을 가르는 건 위 6종의 지원 릴리스 유무뿐이다.

해소 전망은 컴포넌트마다 갈린다.

- **먼저 풀리는 쪽**: Argo CD(3.5 GA 임박), kube-state-metrics(v2.20 임박).
- **나중에 풀리는 쪽**: KEDA(2.21, ~2026-09 전망), external-secrets(폴백 없이 EOL 압박을 받는 프로젝트 정책상 가장 보수적).
- **전 스택 1.36 정렬 예상 시점**: 대략 **2026 Q3말~Q4초**. 임계경로는 **KEDA·external-secrets 둘**이다 — 나머지 4종이 먼저 풀려도 이 둘이 막히면 blue-green 전체를 1.36으로 못 올린다.

## 4. 판정 — 1.35

**목표 = EKS 1.35.** 전 컴포넌트 세트가 공식 지원 릴리스를 갖는 최고 버전이다. 결정적 이유 하나는 external-secrets(ESO)다. 이전 계획의 1.33 목표에서 가장 큰 정책 리스크가 ESO였는데, 1.33이 지원하는 ESO 라인(0.17~0.19)이 전부 EOL이었기 때문이다. ESO는 최신 마이너 1개만 non-EOL로 유지되는 정책이라, 조사 시점 최신인 **2.8.x가 정확히 k8s 1.35를 지원**한다. 1.35를 택하면 최신·non-EOL인 ESO 2.8.x를 그대로 운영할 수 있어 EOL 딜레마가 자연 해소된다 — ESO 하나만 놓고 봐도 **1.35 > 1.34 > 1.33** 순으로 유리하다.

- **1.34는 폴백으로 남긴다.** 1.35가 부담스러우면 내려갈 수 있으나 (a) ESO 정렬이 나쁘고 (b) 표준지원 종료가 4개월 더 이르며(2026-12-02) (c) 안정성 이득이 크지 않다. 적극 권장은 1.35다.
- **1.33은 폐기한다.** 표준지원 종료가 2026-07-29로 임박해, 신규 클러스터를 1.33으로 올리는 순간 사실상 곧바로 확장지원(유료) 구간에 든다. 1.33 조사 산출물의 컴포넌트별 CRD·차트 리워크 방법론 자체는 유효하지만, **목표 k8s 값만은 1.35로 통일**해 읽는다.

## 5. 직행 breaking 체크리스트

blue-green은 마이너를 하나씩 밟지 않고 목표 버전으로 곧바로 생성하므로 **1.32~1.35(또는 1.36) 구간의 breaking 변경이 한꺼번에 적용**된다. 컷오버 전 매니페스트·Helm values를 아래 항목으로 grep 점검한다.

| 도입 버전 | breaking 변경 |
|---|---|
| 1.32 | `flowcontrol.apiserver.k8s.io/v1beta3` 완전 제거 → `v1`로 전환 |
| 1.33 | AL2 AMI 지원 종료 → AL2023/Bottlerocket 필수 |
| 1.34 | `VolumeAttributesClass` `v1beta1`→`v1` GA 전환 |
| 1.35 | cgroup v1 지원 제거(AL2023은 v2라 영향 적음), containerd 1.x 지원 종료 |
| 1.36(목표 시) | `gitRepo` 볼륨 영구 비활성, containerd 2.0+ 필수, `StrictIPCIDRValidation` 기본 활성(non-canonical CIDR 거부) |

IPVS 제거는 이 목록에 없다 — [03 managed addon]({{< relref "03-managed-addons.md" >}})에서 정정하듯 코드 삭제는 ~v1.43 예정이라 1.35/1.36 어느 쪽으로 가도 아직 해당하지 않는다.

## 우리 케이스에서는

지금 가면 **1.35 blue-green이 정답**이고, 1.36은 임계경로인 KEDA·external-secrets가 풀리는 2026 Q3말~Q4초에 재검증한다. green이 1.31이라 확장지원 종료(2026-11-26)까지 여유가 있어 1.36을 서두를 이유도 없다.
