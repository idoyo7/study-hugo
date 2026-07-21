---
title: "컷오버·롤백 계약 — ALB 가중치 전환과 되돌리기"
weight: 6
---

# 컷오버·롤백 계약 — ALB 가중치 전환과 되돌리기

{{< callout type="info" >}}
**한눈에**
- 트래픽 전환은 Route53 가중치가 아니라 **ALB target group 가중치**로 green→blue 이전한다.
- blue·green이 **동일 RDS/큐를 공유**하므로 트래픽 비율과 무관하게 데이터는 단일 소스다(스키마는 backward-compatible 전제).
- **롤백 = ALB 가중치를 green 100%로 즉시 복귀**(클러스터 삭제·재배포 아님).
- blue 100% + 안정화 관찰을 통과하기 전까지 **green은 보존**한다(즉시 롤백 여지).
{{< /callout >}}

blue 클러스터가 부트스트랩까지 완료된 뒤([04 부트스트랩]({{< relref "04-cluster-bootstrap.md" >}})), 실제 트래픽을 어떻게 옮기고 문제가 생기면 어떻게 되돌리는지의 계약을 정의한다. 아래 단계·관찰시간·롤백 기준은 사내 blue-green 방법론의 구조 위에서 구성한 **권장 기본값·예시**이며, 실제 값은 팀 상황에 맞춰 조정한다.

## 진입조건

트래픽을 옮기기 전에 아래가 모두 충족돼야 한다.

- blue 클러스터 부트스트랩 완료 — EKS managed addon 5종 `ACTIVE`, spoke ArgoCD 조인, tier-1 8파일 endpoint 재바인딩 완료([04 부트스트랩]({{< relref "04-cluster-bootstrap.md" >}})).
- karpenter가 노드를 정상 프로비저닝하고, ebs-csi PVC 검증(gp3 `Bound`)이 통과([03 managed addon]({{< relref "03-managed-addons.md" >}})).
- 서비스 파드가 blue에서 healthy 상태이고, 해당 서비스가 blue target group에 등록 완료.

## 트래픽 가중 단계와 관찰

전환은 **ALB target group 가중치**로 한다. public/private·anchor target group을 함께 이동하며, blue/green 각각 public·private 타깃그룹의 구조만 유지하면 된다(개별 ARN·계정은 배선 시 확인).

| 단계 | green | blue | 관찰 창(예시) |
|---|---|---|---|
| 0 | 100% | 0% | 진입조건 최종 확인 |
| 1 | 95% | 5% | 가장 길게(초기 카나리) |
| 2 | 75% | 25% | 최소 N분 |
| 3 | 50% | 50% | 최소 N분 |
| 4 | 0% | 100% | 안정화 관찰로 이어감 |

각 단계 관찰 창 동안 **에러율·p99 레이턴시·5xx·target group 헬스**를 지켜본다. 5%·초기 단계는 더 길게 관찰하고, 이상이 없을 때만 다음 단계로 올린다. 단계 수·비율·관찰 시간은 서비스 특성에 맞춰 조정하는 예시값이다.

## 상태 공유 — DB·큐

blue·green은 **동일 RDS/큐를 공유**하므로 트래픽 비율과 무관하게 데이터는 단일 소스다(스키마 마이그레이션은 backward-compatible 전제). 이 덕분에 롤백 시 데이터 되돌리기가 필요 없다.

⚠️ **경고**: yogiyo 이벤트 warm-up 시점에는 양 클러스터 파드 합계가 급증해 **DB max connection 한도에 도달**할 위험이 있다 — 원문에서부터 강조된 항목이라, 컷오버는 **이벤트 없는 시간대에 수행**한다. Airflow batch는 신규 클러스터 endpoint로 kubeconfig 재설정이 필요한데, 이는 트래픽 컷오버와 분리된 운영 후속 작업이다(상세 생략).

## 롤백 계약

**판단 기준(예시)**: 특정 관찰 창에서 5xx율·에러율·레이턴시가 임계를 초과하거나, target group이 unhealthy로 떨어지거나, 신규 파드가 crashloop/`ImagePullBackOff`에 빠지면 롤백한다.

**되돌릴 대상**: **ALB target group 가중치를 green 100%로 즉시 복귀**한다. 클러스터를 삭제하거나 재배포하는 것이 아니라 **가중치만** 되돌린다. 상태 공유 구조라 데이터 롤백은 불요하다(backward-compatible 전제). 부분 롤백은 직전 단계로 가중치를 되돌리는 것으로 한다.

## green 보존·폐기

blue 100% 도달 후에도 **안정화 관찰 기간(예: 수일)**을 통과하기 전까지 **green은 보존**한다 — 이 구간이 곧 즉시 롤백의 여지다. 폐기는 (a) blue 안정 확인, (b) green 트래픽 0 지속 확인 이후에만 한다.

green의 통제 삭제는 CAPA 롤이 죽어 있어 수동으로만 가능하다([배경]({{< relref "00-background.md" >}})). 뒤집어 말하면, CAPA 롤을 되살리지 않은 채 두면 이관 중 green이 자동으로 오조작될 경로 자체가 없다.

## 우리 케이스에서는

롤백은 "클러스터를 되살리는 일"이 아니라 **"ALB 가중치를 green으로 되돌리는 일"**이다 — 상태를 공유하기에 가능한 단순함이고, 그래서 컷오버 리스크의 대부분은 DB 커넥션과 관찰 창 설계에 몰린다.
