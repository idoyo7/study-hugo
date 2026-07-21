---
title: "네트워킹·인그레스 — aws-load-balancer-controller"
weight: 5
---

# 네트워킹·인그레스 — aws-load-balancer-controller

{{< callout type="info" >}}
**한눈에**
- chart **1.8.1**(앱 v2.8.x) → **chart 3.4.2**(앱 v3.4.2). v3.0.0에서 **chartVersion=appVersion 정렬**이라는 관례 자체가 바뀌면서, 차트 라인이 1.x에서 곧바로 3.x로 점프한다(2.x 차트는 존재하지 않는다) `✓`
- k8s 1.33 지원에 하드 블로커는 아니다(v2.8.x도 동작) — 다만 ~2년 구버전이라 최신 stable로 올리는 것을 권장한다 `✓`
- CRD `TargetGroupBinding`·`IngressClassParams`는 **storage 버전이 v1beta1로 불변**이라 기존 CR 변환이 필요 없다 `✓`
- **IAM 정책에 8개 액션이 새로 필요**하다 — 없으면 컨트롤러 reconcile 중 AccessDenied로 ALB 갱신이 실패한다 `✓`
- finance에서는 **`cluster-bootstrap-v2` umbrella의 서브차트**로 배포되므로 독립 bump가 불가능하다 — umbrella 리워크 + ECR 재퍼블리시가 선행돼야 한다 `✓`
{{< /callout >}}

## 버전 diff와 무엇이 바뀌는가

v3.0.0(2026-01-23)이 메이저 breaking 경계다. 세 가지가 동시에 일어난다.

- **chartVersion=appVersion 정렬** — v2.x는 차트 v1.x를 썼지만(예: LBC 2.17=차트 1.17), v3.0.0부터 차트/앱 버전이 일치한다. eks-charts에는 2.x 차트가 없어 finance의 dependency 핀도 1.8.1에서 곧장 3.4.2로 점프해야 한다.
- **CRD 수동 재적용 요건** — 공식 설치 문서는 "`helm install`은 CRD를 자동 적용하지만 `helm upgrade`는 하지 않는다"고 명시한다. in-place bump라면 CRD를 먼저 수동 적용해야 하지만, blue-green 신규 클러스터는 fresh 설치이므로 ArgoCD/Helm이 crds/를 자동 렌더·적용해 이 단계를 생략할 수 있다.
- **Gateway API GA 승격** — finance는 istio 기반 + TargetGroupBinding/Ingress를 쓰므로 기능적으로 해당 없지만, v3 컨트롤러가 참조하는 Gateway/ListenerSet CRD가 helm crds.yaml에서 누락되면 업데이트가 깨진 사례가 upstream에 보고돼 있다 — CRD를 전량 적용했는지 확인이 필요하다.

`keepTLSSecret` values 키 제거, `--aws-vpc-tag-key` flag deprecated는 finance가 애초에 미사용이라 해당 없다. v2.8.1→v3.4.2 사이 IAM 정책 실 diff를 대조하면 ec2 3개(`GetSecurityGroupsForVpc`·`DescribeIpamPools`·`DescribeRouteTables`), elasticloadbalancing 5개(`DescribeListenerAttributes`·`ModifyListenerAttributes`·`DescribeCapacityReservation`·`ModifyCapacityReservation`·`ModifyIpPools`), 총 8개 액션이 새로 추가됐다. v3 컨트롤러는 리스너 attribute·capacity reservation을 조회·수정하므로, 이 액션들이 IRSA 정책에 없으면 reconcile 중 AccessDenied로 ALB 갱신이 실패한다.

직행은 가능하다 — 공식 문서에 강제 스텝 버전 요구가 없고 최소 k8s 1.22+로 1.33/1.35와 무관하다. 다만 v2.8→v2.11 구간에서 리스너 규칙 재계산이 발생한 사례가 upstream에 보고돼 있어, 대점프 시 최초 sync에서 기존 ALB 리스너 규칙이 한 번 갱신될 수 있다(무중단이지만 스테이징 선검증을 권장한다).

## finance 적용 절차

finance의 LBC는 독립 ArgoCD 앱이 아니라 `cluster-bootstrap-v2` umbrella 차트의 서브차트다. targetRevision 하나만 올려서는 서브차트가 바뀌지 않는다.

1. **차트 소스 리워크** — umbrella `Chart.yaml`의 `aws-load-balancer-controller` dependency를 3.4.2로 교체하고 umbrella 버전을 bump해 ECR에 재퍼블리시한다. 서브차트의 `elbv2.k8s.aws` CRD는 v1beta1 storage가 불변이라 기존 CR과 호환되지만, Gateway/ListenerSet 같은 신규 CRD가 포함돼 있는지는 별도로 확인한다.
2. **app-of-apps targetRevision 핀** — umbrella targetRevision을 새 버전으로 교체한다(stage/prod 모두). `clusterName` Helm 파라미터는 그대로 자동 주입되므로 별도 변경이 필요 없다. syncPolicy가 `prune:false / selfHeal:false`이므로 자동 sync가 아니라 수동 sync가 필요하다는 점도 유의한다.
3. **values 검증** — 제거된 키(`keepTLSSecret`)가 없는지 확인 완료. 이미지 repo가 미러 ECR이므로 v3.4.2 태그를 그 경로에 먼저 미러 퍼블리시해야 pull이 가능하다.
4. **IRSA 정책 갱신** — 8개 신규 액션을 IAM 정책에 반영한다. 정책의 실제 관리 경로(어느 레포가 이 role을 관리하는지)가 확인되지 않은 상태라면, 먼저 관리 주체를 특정한 뒤 v3.4.2 공식 `iam_policy.json` 기준으로 액션을 추가한다.
5. **CRD 선적용** — in-place 갱신이라면 CRD를 수동으로 먼저 적용한다. blue 클러스터 fresh 설치라면 ArgoCD가 crds/를 렌더·적용하므로 생략 가능하다.

배포 순서는 (1) IRSA role + v3.4.2 IAM 정책 준비 → (2) 이미지 미러 퍼블리시 → (3) umbrella 리워크·재퍼블리시 → app-of-apps targetRevision 핀 → (4) EKS managed addon 4종 다음, karpenter/istio 이전 순서로 `cluster-bootstrap-v2`를 배포 → (5) fresh 설치라면 CRD 자동 적용, in-place라면 수동 선적용이다.

검증은 컨트롤러 이미지가 v3.4.2인지, 로그에 AccessDenied(특히 `DescribeListenerAttributes`/`DescribeCapacityReservation`)가 없는지, `TargetGroupBinding` 대상(istio ingressgateway 타깃그룹)이 정상 healthy인지, 리스너 규칙이 예상치 못하게 재계산되지 않는지, webhook 인증서가 정상이고 ALB 신규 생성/삭제 e2e가 통과하는지를 본다.

## 리스크 체크리스트

- [ ] **IAM 8액션 추가 선반영** — 미반영 시 reconcile AccessDenied. role 관리 경로를 먼저 특정한다.
- [ ] **번들 리워크 없이는 불가** — targetRevision만 올려도 서브차트는 그대로 1.8.1이다.
- [ ] **v3.4.2 이미지 미러 ECR 퍼블리시 선행** — 누락 시 ImagePullBackOff.
- [ ] **CRD 처리** — in-place는 crds.yaml 수동 선적용. TargetGroupBinding/IngressClassParams는 v1beta1 storage 불변이라 기존 CR은 안전하다.
- [ ] **ListenerSet/Gateway CRD 누락 리스크** — Gateway API 미사용이어도 관련 CRD 누락만으로 업데이트가 깨진 upstream 사례가 있다. crds.yaml 적용 후 컨트롤러가 요구하는 CRD가 전부 존재하는지 확인한다.
- [ ] **리스너 규칙 1회 재계산 가능성** — prod 적용 전 staging에서 ALB 규칙 diff를 선검증한다.
- [ ] TargetGroupBinding 사용처는 istio ingressgateway 타깃그룹 바인딩 1곳뿐 — v3에서 스키마 무변경이나 sync 후 대상 재등록을 확인한다.

## 근거

- 릴리스 목록/최신 stable(v3.4.2, v3.0.0): `https://api.github.com/repos/kubernetes-sigs/aws-load-balancer-controller/releases`
- v3.0.0 breaking(chartVersion=appVersion 정렬, CRD 수동, Gateway API GA): `https://github.com/kubernetes-sigs/aws-load-balancer-controller/releases/tag/v3.0.0`
- 설치 문서(helm upgrade는 CRD 자동적용 안 함, 최소 k8s 1.22+): `https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/deploy/installation/`
- IAM 정책 diff(v3.4.2 vs v2.8.1 `iam_policy.json`): `https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v3.4.2/docs/install/iam_policy.json`
- ListenerSet CRD 누락 사례, 리스너 규칙 재계산 사례: `https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/4674`, `.../issues/4064`
