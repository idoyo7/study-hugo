---
title: "컷오버·롤백 계약 — ALB 가중치 전환과 되돌리기"
date: 2026-07-21
lastmod: 2026-08-24
weight: 6
---

# 컷오버·롤백 계약 — ALB 가중치 전환과 되돌리기

{{< callout type="info" >}}
- 트래픽 전환은 Route53 가중치가 아니라 ALB target group 가중치로 green→blue 이전합니다.
- blue·green이 동일 RDS/큐를 공유하므로 트래픽 비율과 무관하게 데이터는 단일 소스입니다(스키마는 backward-compatible 전제).
- 롤백은 ALB 가중치를 green 100%로 즉시 복귀시키는 일입니다(클러스터 삭제·재배포 아님).
- blue 100% + 안정화 관찰을 통과하기 전까지 green은 보존합니다(즉시 롤백 여지).
{{< /callout >}}

blue 클러스터의 부트스트랩이 끝난 지점([04 부트스트랩]({{< relref "04-cluster-bootstrap.md" >}}))에서 이어집니다. 여기서는 실제 트래픽을 어떻게 옮기고 문제가 생기면 어떻게 되돌릴지를 계약으로 정합니다. 아래 단계·관찰시간·롤백 기준은 사내 blue-green 방법론의 구조 위에서 짠 권장 기본값이자 예시입니다. 실제 값은 팀 상황에 맞춰 조정합니다.

## 진입조건

트래픽을 옮기기 전에 아래가 모두 충족돼야 합니다.

- blue 클러스터 부트스트랩 완료 — EKS managed addon 5종 `ACTIVE`, spoke ArgoCD 조인, tier-1 8파일 endpoint 재바인딩 완료([04 부트스트랩]({{< relref "04-cluster-bootstrap.md" >}})).
- karpenter가 노드를 정상 프로비저닝하고 ebs-csi PVC 검증(gp3 `Bound`)이 통과([03 managed addon]({{< relref "03-managed-addons.md" >}})).
- 서비스 파드가 blue에서 healthy 상태이고 해당 서비스가 blue target group에 등록 완료.

## 트래픽 가중 단계와 관찰

전환은 ALB target group 가중치로 합니다. public/private·anchor target group을 함께 옮기며 blue/green 각각 public·private 타깃그룹의 구조만 유지하면 됩니다(개별 ARN·계정은 배선 시 확인).

| 단계 | green | blue | 관찰 창(예시) |
|---|---|---|---|
| 0 | 100% | 0% | 진입조건 최종 확인 |
| 1 | 95% | 5% | 가장 길게(초기 카나리) |
| 2 | 75% | 25% | 최소 N분 |
| 3 | 50% | 50% | 최소 N분 |
| 4 | 0% | 100% | 안정화 관찰로 이어감 |

관찰 창마다 지켜볼 지표는 에러율·p99 레이턴시·5xx·target group 헬스입니다. 5%·초기 단계는 더 길게 보고 이상이 없을 때만 다음 단계로 올립니다. 단계 수·비율·관찰 시간은 서비스 특성에 맞춰 조정하는 예시값입니다.

## 상태 공유 — DB·큐

blue·green은 동일 RDS/큐를 공유합니다. 트래픽 비율과 무관하게 데이터는 단일 소스이고(스키마 마이그레이션은 backward-compatible 전제) 롤백할 때 데이터를 되돌리는 절차가 따로 필요하지 않습니다.

경고: 대형 프로모션 이벤트 warm-up 시점에는 양 클러스터 파드 합계가 급증해 DB max connection 한도에 도달할 위험이 있습니다 — 원문에서부터 강조된 항목이라 컷오버는 이벤트 없는 시간대에 수행합니다. Airflow batch는 신규 클러스터 endpoint로 kubeconfig를 재설정해야 하는데 트래픽 컷오버와는 분리된 운영 후속 작업입니다(상세 생략).

## 롤백 계약

판단 기준(예시): 다음 중 하나만 나와도 롤백합니다 — 특정 관찰 창에서 5xx율·에러율·레이턴시가 임계를 초과, target group이 unhealthy로 떨어짐, 신규 파드가 crashloop/`ImagePullBackOff`에 빠짐.

되돌릴 대상: ALB target group 가중치를 green 100%로 즉시 복귀합니다. 가중치만 손대고 클러스터를 삭제하거나 재배포하지는 않습니다. 상태를 공유하는 구조라 데이터 롤백은 불요합니다(backward-compatible 전제). 가중치를 직전 단계로만 되돌리면 부분 롤백입니다.

## green 보존·폐기

blue가 100%에 도달한 뒤에도 green은 보존합니다 — 안정화 관찰 기간(예: 수일)을 통과할 때까지입니다. 이 구간이 곧 즉시 롤백의 여지입니다. 폐기는 (a) blue 안정 확인, (b) green 트래픽 0 지속 확인을 모두 채운 뒤에만 합니다.

green의 통제 삭제는 CAPA 롤이 죽어 있어 수동으로만 가능합니다([배경]({{< relref "00-background.md" >}})). CAPA 롤을 되살리지 않은 채 두는 한 이관 중 green이 자동으로 오조작될 경로 자체가 없습니다.

## 우리 케이스에서는

롤백은 "클러스터를 되살리는 일"이 아니라 "ALB 가중치를 green으로 되돌리는 일"입니다. 상태를 공유하니 이만큼 단순합니다. 그래서 컷오버 리스크의 대부분은 DB 커넥션과 관찰 창 설계에 몰립니다.
