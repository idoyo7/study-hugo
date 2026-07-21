---
title: "시크릿·오토스케일링 — external-secrets·keda"
weight: 4
---

# 시크릿·오토스케일링 — external-secrets·keda

{{< callout type="info" >}}
**한눈에**
- **external-secrets**: 0.9.20 → **2.8.x**. 원 조사는 k8s 1.33 기준으로 진행돼 EOL 판인 0.19.2를 채택안으로 제시했지만, 상위 목표가 1.35로 상향되면서 **2.8.x가 최종 목표**로 바뀌었다 — k8s 1.35를 지원하는 최신 라인이 정확히 여기에 걸리기 때문이다 `✓`
- **keda**: 2.10.2 → **2.20.1**. 2.10은 애초에 k8s 1.33을 지원하지 않으므로(지원 창 v1.24–v1.26) bump가 사실상 필수다 `✓`
- 둘 다 **blue-green 신규 클러스터라 마이너 체인 없이 목표 버전으로 직행 설치**한다 `✓`
- external-secrets는 CRD `v1beta1→v1` **전량 재작성**이 필요하고, keda는 CRD apiVersion이 전 구간 불변이라 스키마 이관 부담이 없다 — 두 컴포넌트의 리스크 성격이 크게 다르다 `✓`
{{< /callout >}}

## external-secrets — 0.9.20 → 2.8.x

원 조사(1.33 기준)의 핵심 결론부터 짚는다. ESO 0.9.x는 k8s 1.19~1.30만 지원해 1.33에서는 지원 범위 밖이었고, 당시 1.33을 지원하는 ESO(0.17/0.18/0.19 라인)는 셋 다 이미 EOL 상태였다. 그래서 원 조사는 "1.33 지원 창의 최신"인 0.19.2를 채택안으로 제시하면서, EOL 버전을 운영하는 정책적 트레이드오프를 팀 결정 사항으로 남겼다.

**이 딜레마는 목표를 1.35로 상향하면서 해소된다.** k8s 1.35를 지원하는 ESO 라인이 정확히 최신 2.x 계열(2.8.x 부근)에 걸리기 때문에, 더 이상 EOL 버전을 감수할 필요가 없다. 이 페이지의 채택 목표는 **2.8.x**이며, 이는 이 컴포넌트만 원 조사(0.19.2)에서 상위 목표 변경으로 값이 바뀐 사례다 — 2.8.x 고유의 세부 breaking은 0.19.2 조사만큼 촘촘히 검증되지 않았으므로, 실제 작업 직전에 `charts.external-secrets.io` 인덱스와 릴리스노트로 2.8.x 라인의 세부 변경 사항을 재확인해야 한다(`?`).

CRD 경계는 0.19.2 조사에서 이미 확정된 사실이라 2.8.x에도 그대로 이어진다.

- **`v1`이 0.16.0에서 stable로 승격**됐고, **`v1beta1`은 0.17.0부터 더 이상 served되지 않는다**. 즉 0.17+ 클러스터에 v1beta1 매니페스트를 apply하면 거부된다 — finance의 모든 ExternalSecret/SecretStore를 v1으로 재작성해야 한다.
- finance가 쓰는 필드(AWS SecretsManager provider, region, JWT `serviceAccountRef`, `dataFrom.extract`, `secretStoreRef`, `target`, `refreshInterval`)는 v1에서도 그대로 유지된다 — finance 관점에서 v1 전환은 사실상 apiVersion rename에 가깝다.
- 기존 클러스터를 in-place로 올릴 때는 v1beta1과 v1이 동시에 served되는 0.16.2를 경유해 CR을 마이그레이션한 뒤 0.17+로 넘어가야 하지만, **finance는 blue-green 신규 green 클러스터라 저장된 v1beta1 오브젝트가 없다** — fresh 설치 + 처음부터 v1 매니페스트로 이 다단계 경로를 우회할 수 있다.

### 적용 절차

external-secrets는 `cluster-bootstrap-v2` umbrella의 서브차트다. ArgoCD targetRevision 하나만 올려서는 서브차트를 독립적으로 bump할 수 없다.

1. **차트 소스** — umbrella `Chart.yaml`의 external-secrets dependency 버전을 목표로 교체하고 umbrella 버전 자체도 bump한다. 번들 템플릿에 남아 있는 `v1beta1` ExternalSecret/SecretStore를 전량 `v1`으로 전환한다(keda-auth 템플릿처럼 현재 비활성인 곳도 정합성을 위해 함께 전환 권장).
2. **app-of-apps** — umbrella targetRevision을 신규 버전으로 갱신한다. ArgoCD 부트스트랩 매니페스트(SecretStore 1개 + ExternalSecret 다수, argocd 레포 자격증명용)도 v1으로 전환한다. 이 CR들은 ArgoCD가 Git 레포에 접근하는 secret을 만들기 때문에, ESO CRD가 먼저 설치된 뒤에 apply돼야 한다는 순서 제약이 있다.
3. **워크로드 CR** — 서비스 차트가 렌더하는 SecretStore/ExternalSecret도 v1으로 전환한다.
4. **배포 순서** — ESO CRD(v1) + controller/webhook/cert-controller fresh 설치 → cert-controller가 webhook 인증서 준비 완료 확인 → ArgoCD 부트스트랩의 v1 SecretStore/ExternalSecret apply → 워크로드 앱 sync(전체 클러스터 부트스트랩 순서상의 위치는 [클러스터 부트스트랩]({{< relref "../04-cluster-bootstrap.md" >}}) 참고).
5. 검증은 아래 실행 체크리스트를 따른다.

### 실행 체크리스트

- [ ] **정책 결정** — 2.8.x가 EOL이 아니라는 전제를 실제 릴리스 시점에 재확인하고, 향후 k8s 마이너가 더 올라갈 때의 ESO 후속 bump 경로를 로드맵에 등록한다.
- [ ] **v1beta1 매니페스트 전량 전환** — 미전환 CR은 apply가 거부되거나 sync가 실패한다.
- [ ] **green 클러스터가 진짜 fresh인지 확인** — 이미 ESO v1beta1 오브젝트가 존재하면 fresh 우회가 불가능해지고 in-place 마이그레이션 경로가 필요해진다.
- [ ] **ECR pull-through 캐시 확인** — controller/cert-controller/webhook 3개 이미지 모두 목표 태그로 pull 가능한지, 신규 클러스터의 노드/IRSA cross-account pull 권한을 확인한다.
- [ ] **선후관계** — ESO CRD/컨트롤러가 ArgoCD repo secret을 만드는 ExternalSecret보다 먼저 sync돼야 부트스트랩이 성립한다.
- [ ] **ArgoCD drift 방지** — CRD 필드 기본값 주입에 필요한 `ignoreDifferences`(conversionStrategy/decodingStrategy/metadataPolicy)를 제거하지 않는다.
- [ ] provider는 AWS SecretsManager + JWT뿐이라 PushSecret/ClusterExternalSecret/generators 관련 breaking은 해당 없음(사용 이력 없음).
- [ ] **배포 후 검증** — CRD가 `v1`만 served(v1beta1 미포함)인지, 모든 CR이 `SecretSynced/Ready=True`인지, 대표 Secret이 실제로 생성됐는지, ArgoCD가 drift 재조정 루프에 빠지지 않는지 확인한다.
- [ ] **rollback** — umbrella targetRevision을 이전 값으로 되돌린다. fresh 설치라 저장 상태 마이그레이션이 없으므로 되돌림은 무손실이다.

## keda — 2.10.2 → 2.20.1

10마이너 점프이지만 CRD apiVersion(`keda.sh/v1alpha1`)이 2.x 전 구간에서 불변이라 CRD conversion 이슈는 없다. finance가 실제로 쓰는 스칼러는 `cpu`·`memory`·`cron`·`datadog`·`kafka`·`prometheus`·`aws-sqs-queue`이며, 2.10→2.20 사이에 제거된 스칼러/필드(NATS Streaming, GCP Pub/Sub `subscriptionSize`, Huawei Cloudeye `minMetricValue`, IBM MQ `tls`, Azure 관련 다수)는 전부 이 사용면과 무관하다.

finance가 확인해야 할 지점은 두 갈래로 좁혀진다.

- **CPU/Memory 스칼러의 `metadata.type` 제거**(2.18 부근, 정확한 제거 시점은 공식 소스 간 상충) — finance 차트는 이미 트리거 레벨 `metricType`(신식 포맷)을 쓰므로 렌더 결과에는 영향이 없다. 다만 라이브에 손수 작성한 ScaledObject가 구식 `metadata.type`을 쓰고 있으면 거부될 수 있어 사전 인벤토리가 필요하다.
- **admission webhook 검증 강화** — 여러 마이너에 걸쳐 fallback 시 명시적 `metricType` 요구, 중복/충돌 scaleTargetRef 거부 같은 규칙이 추가됐다. 기존 SO가 새 검증에 걸릴 수 있으므로 dry-run 선행이 최대 리스크 완화책이다.

비차단이지만 부채로 이월되는 항목도 있다. `aws-eks` podIdentity와 SQS 트리거의 `identityOwner: operator`는 v3에서 제거 예정이라 지금은 deprecation 경고만 뜨고 2.20에서는 정상 동작한다. finance는 이미 2.10.2를 arm64 노드에서 구동 중이므로 2.20의 멀티아치(amd64/arm64/s390x) 지원은 실증된 것으로 본다.

### 적용 절차

keda는 upstream `kedacore/charts`를 직접 참조하는 **독립 ArgoCD 앱**이라 karpenter·external-secrets류의 umbrella 리워크가 필요 없다. targetRevision 한 줄을 2.20.1로 올리는 것이 유일한 필수 변경이고, values 스키마(serviceAccount·resources·affinity·tolerations)는 그대로 호환된다. ScaledObject/ClusterTriggerAuthentication을 렌더하는 다른 차트들도 v1alpha1을 유지하므로 코드 변경 없이 동작한다.

배포 순서는 keda 2.20.1 설치 → `cluster-bootstrap-v2`의 keda-auth 템플릿이 ClusterTriggerAuthentication과 secret store를 만드는지 확인(ESO 의존) → 워크로드 base 차트의 ScaledObject 렌더 순이다(vpc-cni/노드 Ready 등 전체 부트스트랩 순서상의 위치는 [클러스터 부트스트랩]({{< relref "../04-cluster-bootstrap.md" >}}) 참고). 검증은 아래 실행 체크리스트를 따른다.

### 실행 체크리스트

- [ ] **사전 인벤토리(필수)** — 실제 ScaledObject/ScaledJob/TriggerAuthentication 목록을 확보하고, CPU/Memory 트리거가 구식 `metadata.type`을 쓰는지 감사한다.
- [ ] **admission webhook dry-run** — 기존 SO 전체를 강화된 검증으로 재확인한다(최대 리스크, 사전 검출 가능).
- [ ] **이미지 egress** — values에 image override가 없어 `ghcr.io`를 직접 pull한다. 다른 애드온의 ECR 미러 정책과 정합이 맞는지 확인한다.
- [ ] **arm64 멀티아치** — 목표 태그의 이미지 매니페스트에 linux/arm64가 포함되는지 확인한다.
- [ ] **IRSA** — keda-operator SA role이 신규 클러스터 OIDC로 wiring됐는지 확인한다.
- [ ] **metrics 어댑터 충돌** — 클러스터에 다른 `external.metrics.k8s.io` 제공자가 없는지 확인한다.
- [ ] **배포 후 검증** — operator/metrics-apiserver/admission-webhooks 파드가 arm64 노드에 정상 스케줄됐는지, `external.metrics.k8s.io` APIService가 Available인지, 기존 SO를 `--dry-run=server`로 재검증해 강화된 admission webhook을 통과하는지 확인한다. org 실증이 없으므로 **staging-finance-green에서 먼저 검증, prod 직행 금지**.
- [ ] **rollback** — targetRevision을 2.10.2로 되돌린다. CRD apiVersion이 전 구간 불변이라 되돌림은 무손실이다.

## 근거

- ESO 지원/EOL·k8s 매트릭스: `https://external-secrets.io/latest/introduction/stability-support/`
- ESO v1beta1 unserve(하드 컷, v0.17.0): `https://github.com/external-secrets/external-secrets/releases/tag/v0.17.0`
- ESO v1 stable 승격(v0.16.0): `https://github.com/external-secrets/external-secrets/releases/tag/v0.16.0`
- ESO GitOps drift 이슈: `https://github.com/external-secrets/external-secrets/issues/5478`
- KEDA↔k8s 호환 매트릭스, N-2 정책: `https://keda.sh/docs/latest/operate/cluster/`
- KEDA CHANGELOG(2.18/2.19/2.20 breaking): `https://github.com/kedacore/keda/blob/main/CHANGELOG.md`
- KEDA aws-eks 인증 deprecation: `https://keda.sh/docs/2.20/authentication-providers/aws-eks/`
