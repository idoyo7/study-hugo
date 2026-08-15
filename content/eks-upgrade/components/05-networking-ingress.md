---
title: "네트워킹·인그레스 — aws-load-balancer-controller"
weight: 5
---

# 네트워킹·인그레스 — aws-load-balancer-controller

{{< callout type="info" >}}
**한눈에**
- chart **1.8.1**(앱 v2.8.x)에서 **chart 3.4.2**(앱 v3.4.2)로 갑니다. v3.0.0이 **chartVersion=appVersion 정렬**로 관례 자체를 갈아치운 탓에 차트 라인은 1.x에서 곧바로 3.x로 건너뜁니다 — 2.x 차트는 아예 존재하지 않습니다 `✓`
- 목표 k8s **1.35**에서 v2.8.x도 동작하므로 하드 블로커는 아닙니다. 그럼에도 ~2년 구버전이라 최신 stable로 올리는 것을 권장합니다 `✓`
- CRD `TargetGroupBinding`·`IngressClassParams`는 **storage 버전이 v1beta1로 불변**이어서 기존 CR을 변환할 일이 없습니다 `✓`
- **IAM 정책에 8개 액션이 새로 필요**합니다. 빠지면 컨트롤러 reconcile 중 AccessDenied로 ALB 갱신이 실패합니다 `✓`
- finance는 이 컨트롤러를 **`cluster-bootstrap-v2` umbrella의 서브차트**로 배포하므로 독립 bump가 불가능합니다 — umbrella 리워크와 ECR 재퍼블리시가 선행 조건입니다 `✓`
{{< /callout >}}

## 1. 왜 chart 3.4.2인가

목표 k8s만 놓고 보면 이 컴포넌트는 급하지 않습니다. 현행 앱 v2.8.x도 1.35에서 동작하므로 하드 블로커가 아닙니다. 그럼에도 손대는 이유는 버전 나입니다 — v2.8.x는 ~2년 구버전입니다. 최신 stable인 chart 3.4.2(앱 v3.4.2)로 올리는 것을 권장합니다.

폭이 chart 1.8.1에서 3.4.2로 커 보이는 것은 중간이 비어 있기 때문입니다. v3.0.0이 chartVersion=appVersion 정렬을 도입하면서 차트 번호가 앱 번호로 갈아탔습니다. eks-charts에는 2.x 차트가 없습니다. finance의 dependency 핀도 1.8.1에서 곧장 3.4.2로 점프하는 수밖에 없습니다.

직행 자체는 가능합니다. 공식 문서에 강제 스텝 버전 요구가 없고 최소 k8s 1.22+라 목표 1.35와는 무관합니다.

한 가지 전망을 덧붙입니다. aws-load-balancer-controller는 1.36으로 갈 경우 **서드파티 차단 6종** 중 하나입니다. 1.35 기준 목표(chart 3.4.2)는 그대로 유효합니다. 1.36 재검토 시점은 [목표버전 판정]({{< relref "../01-target-version.md" >}})을 따릅니다.

## 2. v3.0.0이 깨는 것

메이저 breaking 경계는 v3.0.0(2026-01-23)입니다. 이 릴리스에서 세 가지가 동시에 일어나고 여기에 IAM과 리스너 쪽 실무 영향이 둘 더 붙습니다.

- **chartVersion=appVersion 정렬** — v2.x 앱은 차트 v1.x를 썼습니다(예: LBC 2.17=차트 1.17). v3.0.0부터는 차트와 앱 버전이 일치합니다. eks-charts에 2.x 차트가 없으니 finance의 dependency 핀도 1.8.1에서 곧장 3.4.2로 점프해야 합니다.
- **CRD 수동 재적용 요건** — 공식 설치 문서는 "`helm install`은 CRD를 자동 적용하지만 `helm upgrade`는 하지 않는다"고 명시합니다. in-place bump라면 CRD를 먼저 수동 적용해야 합니다. 반면 blue-green 신규 클러스터는 fresh 설치이므로 ArgoCD/Helm이 crds/를 자동 렌더·적용해 이 단계를 생략할 수 있습니다.
- **Gateway API GA 승격** — finance는 istio 기반에 TargetGroupBinding/Ingress를 쓰므로 기능적으로 해당 없습니다. 다만 v3 컨트롤러는 Gateway/ListenerSet CRD를 참조합니다. 이 CRD가 helm crds.yaml에서 누락되면 업데이트가 깨진 사례가 upstream에 보고돼 있습니다 — CRD를 전량 적용했는지 확인이 필요합니다.
- **IAM 8액션** — v2.8.1→v3.4.2 사이 IAM 정책 실 diff를 대조하면 ec2 3개(`GetSecurityGroupsForVpc`·`DescribeIpamPools`·`DescribeRouteTables`), elasticloadbalancing 5개(`DescribeListenerAttributes`·`ModifyListenerAttributes`·`DescribeCapacityReservation`·`ModifyCapacityReservation`·`ModifyIpPools`), 총 8개 액션이 새로 추가됐습니다. v3 컨트롤러가 리스너 attribute·capacity reservation을 조회·수정하기 때문입니다. 이 액션들이 IRSA 정책에 없으면 reconcile 중 AccessDenied로 ALB 갱신이 실패합니다.
- **리스너 규칙 재계산** — v2.8→v2.11 구간에서 리스너 규칙 재계산이 발생한 사례가 upstream에 보고돼 있습니다. 이만한 대점프에서는 최초 sync에서 기존 ALB 리스너 규칙이 한 번 갱신될 수 있습니다(무중단이지만 스테이징 선검증을 권장합니다).

깨지지 않는 쪽도 못박아 둡니다. `keepTLSSecret` values 키 제거와 `--aws-vpc-tag-key` flag deprecated는 finance가 애초에 미사용이라 해당 없습니다.

## 3. 적용 절차

finance의 LBC는 독립 ArgoCD 앱이 아니라 `cluster-bootstrap-v2` umbrella 차트의 서브차트입니다. targetRevision 하나만 올려서는 서브차트가 바뀌지 않습니다. 이 절차는 거기서 출발합니다.

1. **차트 소스 리워크** — umbrella `Chart.yaml`에서 `aws-load-balancer-controller` dependency를 3.4.2로 교체하고 umbrella 자체 버전도 bump해 ECR에 재퍼블리시합니다. 서브차트가 들고 오는 `elbv2.k8s.aws` CRD는 v1beta1 storage가 불변이라 기존 CR과 호환됩니다. 다만 Gateway/ListenerSet 같은 신규 CRD가 포함돼 있는지는 별도로 확인합니다.
2. **app-of-apps targetRevision 핀** — stage/prod 양쪽의 umbrella targetRevision을 새 버전으로 교체합니다. `clusterName` Helm 파라미터는 그대로 자동 주입되므로 별도 변경이 필요 없습니다. syncPolicy가 `prune:false / selfHeal:false`이므로 자동 sync가 아니라 수동 sync가 필요하다는 점도 유의합니다.
3. **values 검증** — 제거된 키(`keepTLSSecret`)가 없는지는 확인 완료입니다. 이미지 repo가 미러 ECR이므로 v3.4.2 태그를 그 경로에 먼저 미러 퍼블리시해야 pull이 가능합니다.
4. **IRSA 정책 갱신** — 8개 신규 액션을 IAM 정책에 반영합니다. 이 role을 어느 레포가 관리하는지, 즉 정책의 실제 관리 경로가 확인되지 않은 상태라면 먼저 관리 주체를 특정한 뒤 v3.4.2 공식 `iam_policy.json` 기준으로 액션을 추가합니다.
5. **CRD 선적용** — in-place 갱신이라면 CRD를 수동으로 먼저 적용합니다. blue 클러스터 fresh 설치라면 ArgoCD가 crds/를 렌더·적용하므로 생략 가능합니다.

배포 순서는 (1) IRSA role + v3.4.2 IAM 정책 준비 → (2) 이미지 미러 퍼블리시 → (3) umbrella 리워크·재퍼블리시 → app-of-apps targetRevision 핀 → (4) fresh 설치라면 CRD 자동 적용, in-place라면 수동 선적용입니다. `cluster-bootstrap-v2`가 전체 클러스터 부트스트랩 순서에서 어느 위치에 배포되는지는 [클러스터 부트스트랩]({{< relref "../04-cluster-bootstrap.md" >}}) 참고합니다.

## 4. 검증과 롤백

배포 전에 통과시켜야 하는 게이트부터 봅니다.

- [ ] **IAM 8액션 선반영** — role 관리 경로를 먼저 특정하고 v3.4.2 공식 `iam_policy.json` 기준으로 추가합니다. 미반영 시 reconcile AccessDenied.
- [ ] **umbrella 리워크·ECR 재퍼블리시** — targetRevision만 올려도 서브차트는 그대로 1.8.1입니다.
- [ ] **v3.4.2 이미지 미러 ECR 퍼블리시 선행** — 누락 시 ImagePullBackOff.
- [ ] **CRD 전량 존재 확인** — in-place는 crds.yaml 수동 선적용. 적용 후 컨트롤러가 요구하는 CRD(ListenerSet/Gateway 포함)가 전부 존재하는지 봅니다.
- [ ] **staging ALB 규칙 diff 선검증** — 리스너 규칙 1회 재계산 가능성이 있으므로 prod 적용 전 staging에서 diff를 대조합니다.

배포 후에는 세 갈래를 봅니다.

- [ ] 컨트롤러 이미지가 v3.4.2인지, 로그에 AccessDenied(특히 `DescribeListenerAttributes`/`DescribeCapacityReservation`)가 없는지
- [ ] `TargetGroupBinding` 대상(istio ingressgateway 타깃그룹)이 정상 healthy인지 — 사용처는 istio ingressgateway 타깃그룹 바인딩 1곳뿐이고 v3에서 스키마는 무변경이나 sync 후 대상 재등록을 확인합니다
- [ ] 리스너 규칙이 예상치 못하게 재계산되지 않는지, webhook 인증서가 정상이고 ALB 신규 생성/삭제 e2e가 통과하는지

되돌릴 길은 한 줄입니다.

- [ ] **rollback** — umbrella targetRevision을 1.8.1로 되돌립니다. TargetGroupBinding CRD storage가 불변이라 기존 CR은 영향 없습니다.

## 근거

- 릴리스 목록/최신 stable(v3.4.2, v3.0.0): `https://api.github.com/repos/kubernetes-sigs/aws-load-balancer-controller/releases`
- v3.0.0 breaking(chartVersion=appVersion 정렬, CRD 수동, Gateway API GA): `https://github.com/kubernetes-sigs/aws-load-balancer-controller/releases/tag/v3.0.0`
- 설치 문서(helm upgrade는 CRD 자동적용 안 함, 최소 k8s 1.22+): `https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/deploy/installation/`
- IAM 정책 diff(v3.4.2 vs v2.8.1 `iam_policy.json`): `https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v3.4.2/docs/install/iam_policy.json`
- ListenerSet CRD 누락 사례, 리스너 규칙 재계산 사례: `https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/4674`, `.../issues/4064`
