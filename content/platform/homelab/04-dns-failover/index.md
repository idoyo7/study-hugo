---
title: "04 DNS 장애 전환 — Kuma가 깨우고 GitHub Actions가 Route53을 바꾼다"
date: 2026-10-04
lastmod: 2026-10-05
weight: 4
url: "/homelab/04-dns-failover/"
---

# DNS 장애 전환 — 감시는 hub, 변경은 집 밖, 권한은 레코드 두 개

edge(본가)가 죽으면 개인 도메인의 apex와 와일드카드 A 레코드를 hub(현재 집)로 넘깁니다. hub의 Kuma가 감시하고, 집 밖의 GitHub Actions 러너가 재확인한 뒤 Route53을 변경하며, AWS 추가 비용은 0입니다.

실제 도메인과 IP, 계정·레포 식별자는 `example.com`, `198.51.100.10`(edge), `203.0.113.20`(hub) 같은 가상 값으로 바꿨습니다.

## 전환 전제

apex와 와일드카드 A 레코드는 평소 edge IP를 가리키며 TTL은 300초입니다. DNS만 바꿔서 넘기려면 hub도 같은 호스트를 받아야 합니다. hub에는 와일드카드 인증서(cert-manager, DNS-01)와 게이트웨이, apex·www·blog 및 nextra·kanna·we·us의 호스트별 VirtualService가 준비돼 있습니다. 전체 구성은 [hub / edge 구조]({{< relref "/platform/homelab/01-hub-edge-architecture/index.md" >}})에 있습니다.

전환 중 argo는 넘길 곳이 없어 404를 반환합니다. apex·www·blog의 이미지는 edge와 같지만, nextra·kanna·wedding은 이미지 태그가 달라 다른 버전이 보입니다.

## 감시와 전환

{{< flow src="_flow/2-1-감시는-hub-변경은-집-밖.json" />}}

hub의 Kuma는 edge IP에 고정된 별도 A 레코드 `origin.example.com`을 60초마다 확인합니다. 재시도는 3회, 재시도 간격은 30초이며 2xx와 404를 정상으로 받습니다. apex를 감시하면 전환 뒤 hub의 응답을 edge 복구로 판단하므로 감시 호스트를 분리합니다.

{{< flow src="_flow/2-2-apex를-감시하면-hub를-본다.json" />}}

감시 호스트만 `origin.example.com`으로 바꾸면 같은 상황에서 요청이 가는 곳이 달라집니다.

{{< flow src="_flow/2-3-고정-호스트는-edge를-본다.json" />}}

DOWN 또는 DOWN→UP 때 webhook이 GitHub API의 `workflows/dns-failover.yml/dispatches`를 호출합니다. 본문은 고정 `{"ref":"main"}`이며 방향과 IP를 싣지 않고, 워크플로에도 `workflow_dispatch` 입력이 없습니다. 헤더에는 `Content-Type: application/json`을 명시합니다. DOWN이 이어지면 30번째 heartbeat마다 약 30분 간격으로 재알림을 보냅니다.

러너는 현재 apex A 레코드 값을 읽고 `curl --resolve <host>:443:<IP>`로 직접 확인합니다. 타임아웃은 10초입니다.

| 현재 apex 값 | 확인 | 동작 |
|---|---|---|
| edge | edge IP로 apex가 200(재확인 3회 중 회복 포함) | 변경 없음 |
| edge | 실패, 20초 간격 3회 더 확인해도 전부 실패, hub IP로 apex가 200 | hub로 전환 |
| edge | 전부 실패, hub도 실패 | 변경 없이 실패 종료 |
| hub | edge IP로 apex를 30초 간격 10회 확인해 전부 200, edge IP로 nextra·kanna·we·us도 전부 200 | edge로 복귀 |
| hub | 위 조건 중 하나라도 아님 | hub 유지(성공 종료) |
| edge도 hub도 아님 | - | 아무것도 바꾸지 않고 실패 |

{{< seq src="_seq/2-4-hub가-200일-때만-전환.json" />}}

재확인을 러너에 두어 Kuma의 토큰으로 전환 방향을 정할 수 없게 합니다. Kuma는 한 번의 응답으로 복구를 판단하지만, 러너는 약 5분 동안 30초 간격으로 10회 연속 정상을 확인해야 복귀합니다. hub가 200일 때만 전환하며, 집 밖에서 확인해 hub와 edge 사이만 끊긴 경우의 오판을 보완합니다.

{{< seq src="_seq/2-5-전부-200일-때만-복귀.json" />}}

수동 전환과 훈련에는 레포 Actions 변수 `PIN_SITE`를 씁니다. edge 또는 hub를 지정하면 관측과 무관하게 목표로 삼되, 목표가 200일 때만 바꿉니다. Kuma의 Actions 쓰기 토큰으로는 이 변수를 바꿀 수 없습니다.

변경할 때는 GitHub OIDC로 IAM 역할을 빌려 apex와 와일드카드를 한 ChangeBatch로 UPSERT합니다. TTL은 현재 값을 유지하고 INSYNC까지 기다립니다. 워크플로 권한은 `id-token: write`, `contents: read`만 부여하며, 외부 액션 checkout과 configure-aws-credentials는 모두 커밋 SHA로 고정합니다. concurrency로 직렬화하고 진행 중인 실행은 취소하지 않습니다.

워크플로는 예약 실행 없이 Kuma의 webhook으로만 돕니다. 결과를 Kuma push 모니터로 보내던 것도 없앴으며, 실행이 실패하면 GitHub의 기본 실패 알림에 맡깁니다.

전환과 복귀 알림은 Kuma의 다른 모니터에서 옵니다. 이 모니터는 공개 DNS가 apex에 답하는 값을 직접 보고, 응답이 hub IP로 바뀌면 한 번, edge로 돌아오면 한 번 알립니다. 이 횟수는 이 모니터만 센 값입니다. edge를 감시하는 모니터의 DOWN·UP 알림과, DOWN이 이어지는 동안의 30분 재알림은 따로 오므로 사람이 받는 알림은 전환 때와 복귀 때 각각 두 번이고, edge가 죽어 있는 동안에는 30분마다 한 번씩 더 옵니다. DNS가 hub를 가리키는 동안에는 같은 확인을 하는 두 번째 모니터가 약 30분마다 워크플로를 다시 깨워 복귀를 재시도합니다. 예약 실행이 없어서, edge가 돌아온 직후의 복귀 판정이 실패했거나 복귀 webhook이 유실됐을 때 DNS가 hub에 눌러앉는 것을 막으려는 장치입니다. Kuma는 알림 전송 실패를 재시도하지 않으므로, 장애 쪽 webhook 유실은 앞의 30분 재알림이, 복귀 쪽은 이 재시도가 보완합니다.

처음에는 매시 17분 cron과 push 보고를 뒀습니다. 그런데 GitHub의 스케줄 실행이 cron대로 돌지 않아(2026-10-04에는 간격이 3시간을 넘었습니다) 장애가 아닌 "보고 없음" 알림이 하루에 세 번 왔고, 그래서 예약 실행과 push 보고를 없앴습니다.

예상 소요 시간은 Kuma 감지 약 3분, 러너 기동과 재확인 1~2분, 반영 1분을 합쳐 5분 안팎입니다. 이후에도 TTL 300초만큼 캐시가 남습니다. 이 시간은 설계값이며 실측이 아닙니다.

## Terraform과 값의 소유 분리

두 레코드에 다음 설정을 적용해 워크플로가 바꾼 값을 Terraform이 되돌리지 않게 합니다. Terraform은 레코드의 존재와 TTL을, 워크플로는 값을 관리합니다.

```hcl
  # 값은 GitHub Actions 워크플로가 바꾼다. 코드의 IP 는 초기값이다.
  # Terraform 은 레코드의 존재·TTL 을, 워크플로는 값을 소유한다.
  lifecycle {
    ignore_changes = [records]
  }
```

따라서 Terraform에서 IP를 고쳐도 DNS에 반영되지 않습니다. 수동 전환도 `PIN_SITE`를 사용합니다.

## 권한과 자격증명

IAM 역할의 변경 권한은 지정한 hosted zone의 `ChangeResourceRecordSets`이며, 조건 키로 이름·타입·동작을 제한합니다.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "UpsertApexAndWildcardA",
    "Effect": "Allow",
    "Action": "route53:ChangeResourceRecordSets",
    "Resource": "arn:aws:route53:::hostedzone/<ZONE_ID>",
    "Condition": {
      "ForAllValues:StringEquals": {
        "route53:ChangeResourceRecordSetsNormalizedRecordNames": ["example.com", "\\052.example.com"],
        "route53:ChangeResourceRecordSetsRecordTypes": ["A"],
        "route53:ChangeResourceRecordSetsActions": ["UPSERT"]
      },
      "Null": {
        "route53:ChangeResourceRecordSetsNormalizedRecordNames": "false",
        "route53:ChangeResourceRecordSetsRecordTypes": "false",
        "route53:ChangeResourceRecordSetsActions": "false"
      }
    }
  }]
}
```

와일드카드는 정규화된 `\052.example.com`으로 적습니다. IAM의 `*`는 도메인 와일드카드가 아니며, IAM이 보는 백슬래시 하나를 JSON에서는 두 개로 씁니다. `ForAllValues`는 요청에 조건 키가 없어도 참이므로, 세 키가 모두 있어야 한다는 `Null: false` 가드가 필요합니다.

별도로 `route53:ListResourceRecordSets`는 같은 zone ARN에, `route53:GetChange`는 `arn:aws:route53:::change/*`에 허용합니다. 둘은 조건 키로 좁힐 수 없습니다. IAM 정책 시뮬레이터(`simulate-custom-policy`) 결과는 다음과 같습니다.

| 결과 | 요청 |
|---|---|
| allowed | apex A UPSERT, 와일드카드 A UPSERT, 둘을 한 배치로 |
| implicitDeny | 다른 이름의 A, apex TXT, apex A DELETE, 허용과 비허용이 섞인 배치, 다른 zone, 조건 키 없는 요청 |

IAM은 레코드 값을 제한하지 못합니다. 값은 워크플로가 실행하는 판정 스크립트에 edge와 hub IP 두 개로 고정하며 외부 입력을 받지 않습니다.

역할은 기존 GitHub OIDC 공급자를 data source로 참조하며, `aud`와 특정 레포 main 브랜치의 `sub`를 `StringEquals`로 제한합니다. 새로 만든 레포는 소유자 ID와 레포 ID가 들어간 subject를 쓰므로, 신뢰 조건이 이 형식과 일치하지 않으면 역할을 빌리지 못합니다.

```hcl
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# ...
Condition = {
  StringEquals = {
    "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
    "token.actions.githubusercontent.com:sub" = "repo:<owner>@<owner_id>/dns-failover@<repo_id>:ref:refs/heads/main"
  }
}
```

| 자격증명 | 두는 곳 | 할 수 있는 일 | 뚫리면 |
|---|---|---|---|
| IAM 역할 | AWS에만. 저장된 키 없음 | A 레코드 2개 UPSERT, 목록 읽기 | 전용 레포에 쓸 수 있는 사람이 두 레코드를 임의 IP로 바꿈 |
| GitHub fine-grained 토큰(Actions 읽기·쓰기, 전용 레포 하나) | Kuma의 알림 설정(k8s Secret, autokuma env, Kuma DB) | 그 레포의 워크플로 실행·취소·비활성화. 코드는 못 바꿈 | 전환 장치를 끄거나 반복 실행. 방향과 IP는 못 정함 |

Kuma 토큰과 역할 신뢰 조건은 레포 단위입니다. 이 워크플로를 Terraform 레포에 두면 나중에 그 레포에 생기는 다른 워크플로까지 권한 범위에 들어오므로 전용 레포를 사용합니다.

## 비용과 한계

IAM 역할, OIDC, STS, Route53 레코드 변경 API는 무료여서 AWS 추가 비용은 0입니다. 전용 레포는 private이며, 문제가 있을 때만 실행되므로 평소에는 Actions를 쓰지 않습니다. hub가 서빙하는 동안에는 복귀 재시도로 약 30분마다 실행됩니다.

- GitHub Actions 장애 시 전환이 일어나지 않습니다.
- hub가 죽으면 넘길 곳이 없으며, hub에 있는 Kuma의 감시도 멎습니다.
- 전환 중 argo의 404와 nextra·kanna·wedding의 버전 차이는 남습니다.
- Kuma는 edge 게이트웨이 응답(404 포함)만 봅니다. 게이트웨이는 살아 있고 앱만 죽은 경우는 예약 실행이 없어진 지금 잡히지 않으며, 알아챈 사람이 `PIN_SITE`로 수동 전환해야 합니다.
- 평소에는 워크플로가 한 번도 돌지 않아 Kuma가 쓰는 dispatch용 토큰의 만료, OIDC 역할 신뢰, 고정한 액션의 폐기 같은 문제가 실제 장애 전까지 드러나지 않습니다. 이 토큰이 단일 실패점이고 실패해도 Kuma는 로그만 남기므로, 만료일을 사람이 확인하고 `PIN_SITE` 훈련을 주기적으로 돌려야 합니다.
- hub가 서빙하는 동안 약 30분마다 실행된다는 것은 edge가 살아 있을 때의 값입니다. edge가 죽어 있으면 edge 감시의 재알림 webhook이 더해져 30분에 두 번 실행됩니다.
- 공개 DNS 조회가 3분 넘게 실패하면 전환이 아니어도 전환 상태 알림이 옵니다.
- TTL 300초 동안 캐시가 남습니다. 비용 없이 60초로 낮출 수 있지만 아직 하지 않았습니다.
- 레코드 값은 스크립트에서만 제한하므로 IAM으로 임의 IP 변경을 막지 못합니다.

## 확인 범위

2026-10-04 기준으로 러너가 OIDC로 역할을 빌렸고, 집 밖의 러너에서 edge IP로 apex를 확인해 200을 받았습니다. 워크플로는 레코드 변경 없이 정상 종료했고 감시 모니터의 up 상태를 확인했습니다. 당시 확인한 Kuma push 보고는 이후 없앴습니다. 2026-10-05에는 새 구조에서 Kuma 파드가 받는 공개 DNS의 apex 응답이 edge IP로만 오는 것을 확인했고, 새 모니터 둘의 선언은 적용 가능한 형태인지만 서버 dry-run으로 봤습니다. dry-run은 스키마가 열려 있어 필드 값을 검증하지는 않습니다. nextra·kanna·we·us용 VirtualService 4개는 서버 dry-run과 hub 공인 IP 직접 요청에서 모두 통과·200을 확인했고, Terraform 역할 PR의 plan은 역할 1개와 인라인 정책 2개를 추가하는 `3 to add, 0 to change, 0 to destroy`로 레코드 변경은 없었습니다.

평상시 경로, 즉 edge가 정상이면 아무것도 바꾸지 않는 동작만 실제로 돌아 본 상태입니다. 장애 경로는 스크립트 DRY_RUN과 정책 시뮬레이션까지만 확인했으며, 다음은 확인하지 못했습니다.

- 실제 레코드를 hub로 넘겼다가 되돌리는 전환 훈련.
- edge DOWN 때 Kuma webhook이 워크플로를 깨우는지.
- 새 모니터 둘(전환 상태, 복귀 재시도)이 실제 전환과 복귀에서 울리는지. 선언만 했고 아직 보지 못했습니다.
- 러너에서 hub IP를 확인하는 경로.
- 전환 시간의 실측. 5분 안팎은 설계값입니다.
