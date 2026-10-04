---
title: "04 DNS 장애 전환 — Kuma가 깨우고 GitHub Actions가 Route53을 바꾼다"
date: 2026-10-04
lastmod: 2026-10-04
weight: 4
url: "/homelab/04-dns-failover/"
---

# DNS 장애 전환 — 감시는 hub, 변경은 집 밖, 권한은 레코드 두 개

edge(본가)가 죽으면 개인 도메인의 DNS를 hub(현재 집)로 넘기는 장치를 2026-10-04 하루에 만들었습니다. 예전에는 장애를 알아챈 사람이 PR을 올리고 apply까지 마쳐야 했습니다. 10분 이상 걸리던 이 과정을 자동화하되, AWS 추가 비용은 0이어야 했습니다.

Route53 health check를 적용했다가 비용 때문에 같은 날 되돌렸습니다. 처음에는 AWX 쪽으로 기울었지만, Actions가 Atlantis를 거치지 않고 Route53을 직접 바꾸면 어떨지 질문을 던진 뒤 GitHub Actions가 Route53 레코드를 바꾸는 방식을 골랐습니다. 이 글은 그 선택과 권한 배치, 구축 중에 걸린 문제를 기록합니다. 직접 실행한 결과와 설계값, 소스를 읽어 확인한 내용은 구분해서 적었습니다.

실제 도메인과 IP, 계정·레포 식별자는 `example.com`, `198.51.100.10`(edge), `203.0.113.20`(hub) 같은 가상 값으로 바꿨습니다.

## DNS를 바꾸기 전에 준비한 것

현재 집의 hub는 노드 2대, 본가의 edge는 노드 1대인 클러스터입니다. 집도 회선도 다릅니다. 전체 구성은 [hub / edge 구조]({{< relref "/platform/homelab/01-hub-edge-architecture/index.md" >}})에 있습니다.

개인 도메인의 apex와 와일드카드는 평소 edge가 서빙합니다. Route53 hosted zone 하나에서 apex A와 와일드카드 A가 각각 단일 레코드로 edge IP를 가리키고, TTL은 300입니다. Terraform이 이 레코드를 관리하고 hub의 Atlantis가 PR 코멘트로 apply합니다.

DNS만 바꿔서 서비스를 넘기려면 hub도 같은 호스트를 받을 준비가 되어 있어야 합니다. 이미 갖춘 것과 이번에 추가한 것, 해결하지 못한 것은 다음과 같습니다.

| 대상 | hub의 준비 상태와 전환 시 동작 |
|---|---|
| 인증서와 게이트웨이 | 와일드카드 인증서(cert-manager, DNS-01)와 해당 도메인용 게이트웨이가 이미 있었습니다. |
| apex·www·blog | VirtualService가 있었고 이미지도 edge와 같았습니다. |
| nextra·kanna·we·us | 앱은 있었지만 hub 전용 도메인 호스트만 받고 있었습니다. 이번에 edge 도메인 호스트용 VirtualService 4개를 PR 하나로 추가했습니다. |
| argo | edge 자신의 ArgoCD라 넘길 곳이 없습니다. 전환 중에는 404가 납니다. |
| nextra·kanna·wedding | hub와 edge의 이미지 태그가 달라 전환 중에는 다른 버전이 보입니다. |

추가한 VirtualService 4개는 서버 dry-run을 통과했습니다. 머지한 뒤 hub 공인 IP로 직접 요청해서 4개 모두 200을 확인했습니다. argo와 이미지 태그 차이는 해결하지 못한 채 남겼습니다.

## Route53 health check를 적용했다가 되돌린 이유

처음 적용한 방식은 Route53 health check와 failover 라우팅이었습니다. health check 1개를 edge 공인 IP에 만들었습니다. HTTPS 443, Host는 apex, 경로는 `/`, 확인 간격은 30초, 실패 횟수는 3회로 설정했습니다. apex와 와일드카드는 각각 PRIMARY(edge)와 SECONDARY(hub) 레코드 쌍으로 바꾸고 TTL을 300에서 60으로 줄였습니다.

이 방식에서는 장애가 났을 때 레코드를 변경할 필요가 없습니다. 두 레코드가 처음부터 들어 있고, Route53 권한 네임서버가 질의마다 health check 상태를 보고 어느 쪽을 답할지 고릅니다. 권한은 설치할 때 한 번만 쓰이고 전환 시점에는 쓰이지 않습니다. 권한을 설계하는 입장에서는 깔끔한 방식이라고 봤습니다.

적용 과정에서는 권한과 plan이 차례로 걸렸습니다. Atlantis 실행 사용자에게 `route53:CreateHealthCheck` 권한이 없어 apply가 실패했습니다. health check는 hosted zone에 속하지 않는 리소스여서 zone으로 한정한 정책으로는 만들 수 없었습니다. 인라인 정책을 추가해 권한 문제는 풀었습니다. 실패한 apply가 state를 갱신한 탓에 저장해 둔 plan이 `Saved plan is stale`로 거부됐습니다. plan을 다시 돌린 뒤 apply했습니다.

같은 이름에 simple 레코드와 failover 레코드를 섞으면 Route53이 거부할까 봐 걱정했던 문제는 발생하지 않았습니다. provider가 한 change batch로 처리했습니다. apply 결과는 `3 added, 2 changed, 0 destroyed`였고, AWS 체커 16개(8개 리전)가 모두 HTTP 200으로 통과했습니다. 권한 네임서버 4대도 전부 edge IP를 답했습니다.

되돌린 이유는 요금이었습니다. 요금 페이지 기준으로 AWS 외부 엔드포인트의 health check 기본료는 월 0.75달러입니다. 선택 기능인 HTTPS는 AWS 외부 엔드포인트에서 기능당 월 2.00달러이므로 합계는 월 2.75달러입니다. failover 레코드 자체와 질의 요율(100만 건당 0.40달러)에는 추가 요금이 없습니다.

추가 비용이 없는 방안을 원했으므로 같은 날 revert PR로 되돌렸습니다. 결과는 `0 added, 2 changed, 3 destroyed`였고, 추가했던 IAM 정책도 지웠습니다. 이 방식으로도 edge를 실제로 내려 hub로 넘어가는지는 시험하지 않았습니다.

월 2.75달러를 쓰지 않으려면 다른 곳에서 장애를 판단하고 레코드를 바꿔야 했습니다. 전환 시점에 쓰이는 권한이 없다는 성질을 잃은 것이 그 대가라고 봅니다. 그때부터는 변경 권한을 어디에 두고, 어디서 실행할지가 선택의 기준이 됐습니다.

## 레코드를 바꿀 실행 주체를 고르다

hub에는 Uptime Kuma 2.5.5, AWX 24.6.1, Atlantis v0.48.0이 이미 있었습니다. Kuma의 모니터와 알림은 autokuma 2.0.0으로 KumaEntity CRD에 선언하고 있었습니다.

감시는 Kuma가 맡기로 하고, 알림을 받은 뒤 Route53을 바꿀 실행 주체를 비교했습니다.

| | Atlantis 경유 | AWX 잡 | GitHub Actions(채택) |
|---|---|---|---|
| 마지막에 쓰이는 AWS 권한 | Terraform 실행용 기존 키. 레코드 두 개보다 훨씬 넓은 권한 | 새 IAM 사용자의 장기 액세스 키, A 레코드 2개 UPSERT | OIDC로 빌리는 IAM 역할, A 레코드 2개 UPSERT |
| 저장되는 AWS 키 | hub의 Atlantis(기존) | hub의 AWX DB | 없음 |
| 새로 여는 통로 | 사람 없이 PR을 만들고 apply 코멘트를 다는 봇. 이 능력이 곧 그 키의 권한 | AWX 안의 키 하나 | Kuma가 가진 워크플로 실행 토큰 |
| edge를 보는 곳 | hub + GitHub 러너 | hub만 | hub(Kuma) + 집 밖(러너) |
| 전환 경로가 기대는 것 | GitHub 두 번, hub ingress, Atlantis | hub만 | GitHub |
| 손으로 할 일 | 토큰, 레포 설정 완화 | IAM 키 발급, AWX 객체 여러 개 | GitHub 토큰 1개 |

{{< flow src="_flow/4-세-안-권한-경로.json" />}}

Atlantis를 거치면 AWS 키를 새로 만들지 않아도 됩니다. 하지만 사람 없이 PR을 만들고 apply 코멘트를 다는 능력이 기존 키의 넓은 권한으로 이어집니다. 실행 경로도 Kuma, GitHub API, 러너, PR, 웹훅, Atlantis, Route53 순으로 길어져서 이 안은 버렸습니다.

AWX는 hub만 살아 있으면 된다는 장점이 있었습니다. 대신 장기 키를 hub에 저장해야 하고, edge를 보는 지점도 hub 하나뿐입니다.

설계 검토는 조사, 독립 설계 2안, 권한 관점과 신뢰성 관점의 반박 검증으로 나눠 진행했습니다. 처음에는 AWX 쪽으로 기울었습니다. 이후 “Actions가 Atlantis를 거치지 않고 Route53을 직접 바꾸면?”이라는 질문을 던지면서 Actions로 바뀌었습니다. 저장된 AWS 키 없이 집 밖에서 다시 확인할 수 있는 대신 GitHub에 의존하게 됩니다. 이 규모에서는 그 의존을 감수하기로 했습니다.

## Kuma가 깨우고 러너가 방향을 정하는 구조

{{< flow src="_flow/5-최종-구조.json" />}}

hub의 Kuma는 edge를 감시하고, 상태가 바뀌면 GitHub Actions 워크플로를 깨웁니다. 집 밖의 GitHub 러너가 현재 apex A 레코드 값을 읽고 `curl --resolve <host>:443:<IP>`로 직접 확인해 방향을 정한 뒤, OIDC로 IAM 역할을 빌려 레코드를 바꿉니다. 실행 결과는 Kuma push 모니터로 돌려보냅니다.

### 감시 대상은 edge에 고정합니다

Kuma가 확인하는 주소는 `origin.example.com`입니다. apex·와일드카드와 별개의 A 레코드로 edge IP에 고정한 이름입니다. apex를 감시하면 전환 뒤 hub의 응답을 보고 edge가 복구됐다고 판단하게 되므로 감시 대상을 분리했습니다.

이 고정 호스트를 60초마다 HTTP로 확인합니다. 재시도는 3회, 재시도 간격은 30초입니다. TLS는 정상이고 응답은 404이므로 2xx와 404를 정상으로 받습니다.

DOWN이 되거나 DOWN에서 UP으로 바뀌면 webhook 알림이 GitHub API의 `workflows/dns-failover.yml/dispatches`를 호출합니다. 본문은 고정 `{"ref":"main"}`이고 전환 방향도 IP도 싣지 않습니다. 워크플로에도 `workflow_dispatch` 입력이 없습니다. DOWN이 이어지는 동안에는 30번째 heartbeat마다, 약 30분 간격으로 재알림을 보내며 Telegram도 함께 다시 알립니다.

모니터와 webhook 알림은 autokuma의 KumaEntity로 선언했습니다.

```yaml
# 모니터 (apiVersion · kind · metadata 생략)
spec:
  config:
    type: http
    name: edge origin.example.com
    url: https://origin.example.com/
    interval: 60
    max_retries: 3
    retry_interval: 30
    resend_interval: 30
    accepted_statuscodes: ["200-299", "404"]
    notification_name_list: [telegram, dns-failover-webhook]
---
# 알림 (apiVersion · kind · metadata 생략)
spec:
  config:
    type: notification
    name: DNS failover webhook
    active: true
    is_default: false
    config:
      type: webhook
      webhookURL: https://api.github.com/repos/<owner>/dns-failover/actions/workflows/dns-failover.yml/dispatches
      httpMethod: post
      webhookContentType: custom
      webhookCustomBody: '{"ref":"main"}'
      webhookAdditionalHeaders: "{\"Authorization\": \"Bearer {{ get_env(name='AUTOKUMA__ENV__GITHUB_DISPATCH_TOKEN') }}\", \"Accept\": \"application/vnd.github+json\", \"X-GitHub-Api-Version\": \"2022-11-28\", \"Content-Type\": \"application/json\"}"
```

토큰은 git에 두지 않았습니다. autokuma Deployment가 k8s Secret을 환경 변수로 읽고 위 템플릿이 렌더링합니다. 알림은 `is_default: false`이므로 모니터가 목록에 명시했을 때만 붙습니다.

### 전환과 복귀를 다르게 판정합니다

워크플로는 현재 apex A 레코드 값을 읽고 `curl --resolve <host>:443:<IP>`로 직접 확인합니다. 타임아웃은 10초입니다.

{{< flow src="_flow/5-판정-흐름.json" />}}

| 현재 apex 값 | 확인 | 동작 |
|---|---|---|
| edge | edge IP로 apex가 200(재확인 3회 중 회복 포함) | 변경 없음 |
| edge | 실패, 20초 간격 3회 더 확인해도 전부 실패, hub IP로 apex가 200 | hub로 전환 |
| edge | 전부 실패, hub도 실패 | 변경 없이 실패 종료 |
| hub | edge IP로 apex를 30초 간격 10회 확인해 전부 200, edge IP로 nextra·kanna·we·us도 전부 200 | edge로 복귀 |
| hub | 위 조건 중 하나라도 아님 | hub 유지(성공 종료) |
| edge도 hub도 아님 | - | 아무것도 바꾸지 않고 실패 |

Kuma의 알림만으로 방향을 정하지 않고 워크플로에서 재확인하도록 설계한 이유가 있습니다. 감시 도구에 넣는 토큰은 유출될 수 있다고 보고, 그 토큰으로 방향을 정할 수 없게 했습니다. 또한 Kuma는 edge가 한 번만 응답해도 복구로 보지만, 복귀는 러너가 약 5분 동안, 30초 간격 10회 연속 정상을 확인했을 때만 하도록 했습니다.

Kuma 알림에는 hub 상태가 없으므로 전환할 대상도 확인해야 합니다. hub가 200일 때만 넘기도록 했고, hub와 edge 사이만 끊겨 장애로 오판하는 경우는 집 밖의 러너가 다시 확인하는 것으로 보완했습니다.

수동 전환과 훈련에는 레포 Actions 변수 `PIN_SITE`를 씁니다. 값이 edge 또는 hub이면 관측과 무관하게 그 사이트를 목표로 삼되, 목표가 200일 때만 바꿉니다. Kuma가 가진 Actions 쓰기 토큰으로는 이 변수를 바꿀 수 없습니다.

### 실행, 변경, 결과 보고

변경이 필요하면 GitHub OIDC로 IAM 역할을 빌려 apex와 와일드카드를 한 ChangeBatch로 UPSERT합니다. TTL은 현재 값을 읽어 그대로 쓰고, INSYNC가 될 때까지 기다립니다.

결과는 status=up|down, 현재 서빙 위치, 수행한 동작을 담아 Kuma push 모니터로 GET합니다. push 모니터의 heartbeat 간격은 7500초(약 2시간 5분)여서 워크플로가 멈추면 알림이 갑니다.

Kuma는 알림 전송에 실패해도 재시도하지 않고 로그만 남깁니다. 이를 보완하려고 워크플로를 매시 17분(`cron: '17 * * * *'`)에도 실행합니다.

```yaml
name: dns-failover

on:
  workflow_dispatch:
  schedule:
    - cron: '17 * * * *'

permissions:
  id-token: write
  contents: read

concurrency:
  group: dns-failover
  cancel-in-progress: false

jobs:
  reconcile:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      # actions/checkout v7.0.1
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false

      # aws-actions/configure-aws-credentials v6.3.0
      - uses: aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd
        with:
          role-to-assume: arn:aws:iam::<ACCOUNT_ID>:role/dns-failover
          aws-region: us-east-1

      - name: 상태 판정 및 레코드 갱신
        id: reconcile
        env:
          PIN_SITE: ${{ vars.PIN_SITE }}
        run: bash scripts/reconcile.sh

      - name: Kuma push 보고
        if: always()
        # ... status 와 msg 를 Kuma push URL 로 GET. 실패해도 무시한다.
```

외부 액션은 checkout과 configure-aws-credentials 둘뿐이며 모두 커밋 SHA로 고정했습니다. checkout에는 `persist-credentials: false`를 설정했습니다. 같은 이름의 실행은 concurrency 그룹으로 직렬화하되 진행 중인 실행을 취소하지 않습니다.

예상 소요 시간은 Kuma 감지 약 3분, 러너 기동과 재확인 1~2분, 반영 1분을 합쳐 5분 안팎입니다. 그 뒤에도 TTL 300초만큼 캐시가 남습니다. 이 시간은 설계값이며 실측이 아닙니다.

### Terraform은 존재와 TTL을 관리합니다

워크플로가 바꾼 값을 Terraform이 되돌리지 않도록 두 레코드에 `lifecycle { ignore_changes = [records] }`를 붙였습니다. Terraform은 레코드의 존재와 TTL을, 워크플로는 값을 소유합니다.

```hcl
  # 값은 GitHub Actions 워크플로가 바꾼다. 코드의 IP 는 초기값이다.
  # Terraform 은 레코드의 존재·TTL 을, 워크플로는 값을 소유한다.
  lifecycle {
    ignore_changes = [records]
  }
```

소유를 나눈 대가로, 이제 Terraform에서 IP를 고쳐도 DNS에 반영되지 않습니다. 수동으로 넘길 때도 `PIN_SITE`를 써야 합니다.

## 권한을 레코드 두 개와 전용 레포로 좁히기

### IAM 역할에 허용한 변경

변경 권한은 `ChangeResourceRecordSets` 하나입니다. hosted zone을 지정하고, 조건 키로 레코드 이름과 타입, 동작을 좁혔습니다.

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

별도의 문으로 `route53:ListResourceRecordSets`는 같은 zone ARN에, `route53:GetChange`는 `arn:aws:route53:::change/*`에 허용했습니다. 둘은 읽기라서 조건 키로 좁힐 수 없습니다.

와일드카드 이름은 정규화된 `\052.example.com`으로 적어야 합니다. IAM의 `*`는 도메인 와일드카드가 아닙니다. IAM이 보는 값은 백슬래시 하나이고 JSON 문자열에서는 두 개로 씁니다. Terraform에서는 HCL 문자열 `"\\052.example.com"`이 백슬래시 하나가 되고, `jsonencode`가 이를 JSON의 두 개로 바꿔 줍니다.

`Null` 조건은 조건 키가 빠진 요청을 막기 위해 넣었습니다. `ForAllValues`는 요청에 해당 키가 없으면 참이 됩니다. 가드 없이 시뮬레이터에 조건 키를 뺀 요청을 넣었더니 실제로 allowed가 나왔습니다. 그래서 세 키가 모두 요청에 있어야 한다는 `Null: false` 조건을 붙였습니다.

IAM 정책 시뮬레이터(`simulate-custom-policy`)로 확인한 결과는 다음과 같습니다.

| 결과 | 요청 |
|---|---|
| allowed | apex A UPSERT, 와일드카드 A UPSERT, 둘을 한 배치로 |
| implicitDeny | 다른 이름의 A, apex TXT, apex A DELETE, 허용과 비허용이 섞인 배치, 다른 zone, 조건 키 없는 요청 |

IAM으로 제한할 수 없는 것은 레코드의 값, 즉 어느 IP로 바꾸느냐입니다. 값에 대한 유일한 통제는 스크립트에 두었습니다. 스크립트에는 edge IP와 hub IP 두 개만 고정했고 외부 입력을 받지 않도록 했습니다.

### 역할을 빌릴 수 있는 레포와 브랜치

Principal은 계정에 이미 있던 GitHub OIDC 공급자(`token.actions.githubusercontent.com`)입니다. 새로 만들지 않고 Terraform data source로 참조했습니다.

신뢰 조건은 `aud`가 `sts.amazonaws.com`이고, `sub`가 특정 레포의 main 브랜치인 것입니다. `StringEquals`를 쓰며 와일드카드는 없습니다. 아래는 첫 실행의 실패를 고친 뒤 사용한 조건입니다. ID가 포함된 subject 형식 때문에 걸린 과정은 뒤의 「만들면서 걸린 것」 절에 적었습니다.

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

### 자격증명을 두는 곳과 유출 시 범위

| 자격증명 | 두는 곳 | 할 수 있는 일 | 뚫리면 |
|---|---|---|---|
| IAM 역할 | AWS에만. 저장된 키 없음 | A 레코드 2개 UPSERT, 목록 읽기 | 전용 레포에 쓸 수 있는 사람이 두 레코드를 임의 IP로 바꿈 |
| GitHub fine-grained 토큰(Actions 읽기·쓰기, 전용 레포 하나) | Kuma의 알림 설정(k8s Secret, autokuma env, Kuma DB) | 그 레포의 워크플로 실행·취소·비활성화. 코드는 못 바꿈 | 전환 장치를 끄거나 반복 실행. 방향과 IP는 못 정함 |
| Kuma push 토큰 | 전용 레포 secret, k8s Secret | 결과 보고 | 가짜 정상 신호로 워크플로 정지를 숨김 |

Kuma의 토큰과 역할 신뢰 조건은 모두 레포 단위입니다. Terraform 레포에 워크플로를 두면 나중에 그 레포에 생기는 다른 워크플로까지 두 범위에 들어옵니다. 범위를 이 워크플로에 한정하려고 전용 레포를 따로 만들었습니다.

## 만들면서 걸린 것

### IAM description은 plan만으로 확인되지 않았습니다

역할 description에 한글을 넣어도 plan은 통과했습니다. 검증 단계에서 IAM API의 역할 설명 허용 패턴이 Latin-1까지라는 것을 찾아 apply 전에 ASCII로 바꿨습니다. 서버가 한글을 실제로 거부하는지는 실행해 보지 않았습니다. 이 수정의 근거는 API 모델에 선언된 패턴입니다.

### 첫 OIDC 실행은 subject가 맞지 않아 실패했습니다

워크플로의 첫 실행은 `Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity`로 실패했습니다. 이 실행에서 자격증명을 받는 액션이 12회 재시도한 뒤 포기했습니다.

레포의 subject 설정을 읽어 보니 새로 만든 레포는 소유자 ID와 레포 ID가 들어간 불변 subject를 쓰고 있었습니다.

```console
$ gh api repos/<owner>/dns-failover/actions/oidc/customization/sub
{"use_default":true,"use_immutable_subject":true,"sub_claim_prefix":"repo:<owner>@<owner_id>/dns-failover@<repo_id>"}
```

기존 레포는 `use_immutable_subject: false`에 `repo:<owner>/<repo>` 형태입니다. 신뢰 조건의 `sub`를 `repo:<owner>@<owner_id>/dns-failover@<repo_id>:ref:refs/heads/main`으로 고치는 PR을 냈습니다. plan은 `0 to add, 1 to change`였고, 수정 뒤 다시 실행하니 성공했습니다.

같은 이름으로 레포를 다시 만들어도 ID가 달라 역할을 빌릴 수 없다는 점은 이득이라고 봤습니다.

### webhook 본문에는 Content-Type을 명시했습니다

Kuma가 쓰는 axios는 custom 본문을 문자열로 넘기면 Content-Type을 form-urlencoded로 붙입니다. 소스를 읽어 이 동작을 확인하고 헤더에 `Content-Type: application/json`을 명시했습니다.

### autokuma의 첫 reconcile은 알림보다 빨랐습니다

모니터가 참조하는 알림이 저장되기 전에 첫 reconcile이 돌아서 `NameNotFound(Notification(...))` 경고가 한 번 찍혔습니다. 5분 뒤 재시도에서 모니터가 만들어졌습니다. 실제 기록은 UTC 14:18 경고, 14:23 생성이었습니다.

### webhook을 붙일 모니터를 지정했습니다

autokuma 기본 설정은 모든 모니터에 telegram 알림을 붙입니다. 소스를 확인해 보니 모니터에 알림 목록을 명시하면 그 값이 기본값보다 우선했습니다. 그래서 이 모니터만 `[telegram, dns-failover-webhook]`을 쓰도록 했습니다.

### 시험용 probe 훅이 실제 모드에서도 동작했습니다

판정 스크립트를 검증하다가 시험용 가짜 probe 훅이 실제 모드에서도 먹는다는 것을 찾았습니다. `DRY_RUN`도 정확히 `"1"`일 때만 인정되는 상태였습니다. `DRY_RUN` 값을 0 또는 1로 검증하고, 훅은 `DRY_RUN=1`일 때만 허용하도록 고쳤습니다.

### Kuma push URL의 기존 쿼리를 제거했습니다

Kuma 화면에서 복사한 URL에는 `?status=up&msg=OK&ping=`이 붙어 있습니다. 여기에 그대로 쿼리를 이어 붙이면 실패도 up으로 보고됩니다. 기존 쿼리를 잘라 낸 뒤 붙이도록 고쳤습니다.

## 비용과 남겨 둔 한계

IAM 역할, OIDC, STS, Route53 레코드 변경 API는 무료입니다. 첫 방식에서 발생하던 월 2.75달러의 AWS 요금은 이 구조에서 0이 됐습니다. 전용 레포는 private이라 Actions 실행 분을 쓰며, 매시 실행이 월 720분 안팎입니다.

비용 조건을 맞춘 뒤에도 다음 한계는 남습니다.

- GitHub Actions에 장애가 나면 전환이 일어나지 않습니다. 스케줄 실행도 늦어지거나 빠질 수 있습니다.
- hub가 죽으면 넘길 곳이 없습니다. Kuma도 hub에 있어서 감시 자체가 멎습니다.
- 전환 중 argo 호스트는 404를 반환합니다. 앞서 적은 nextra·kanna·wedding은 hub와 edge의 이미지 태그가 달라 다른 버전이 보입니다.
- Kuma는 edge 게이트웨이의 응답(404 포함)만 봅니다. 앱만 죽은 경우는 매시 실행에서 워크플로가 apex를 직접 확인할 때 잡힙니다. 그 사이에는 한 시간 안팎, 스케줄이 밀리면 그보다 길게 비어 있을 수 있다고 봅니다.
- TTL 300초 동안은 캐시가 남습니다. 60초로 낮추는 것은 비용 없이 가능하지만 아직 하지 않았습니다.
- 앞서 설명한 레코드 값의 제한은 스크립트에만 있으므로, 두 레코드를 임의 IP로 바꾸는 것을 IAM으로 막지는 못합니다.

## 확인한 범위와 남은 시험

2026-10-04 기준으로 직접 확인한 것은 다음과 같습니다.

- 워크플로의 두 번째 실행이 성공했습니다. 러너가 OIDC로 역할을 빌렸고, 집 밖의 러너에서 edge IP로 apex를 확인한 결과는 200이었습니다. 판정은 “현재 edge, 정상, 변경 없음”이었고 레코드는 그대로였습니다.
- Kuma push 모니터가 up이어서 러너의 보고가 Kuma에 도착한 것을 확인했습니다. edge 감시 모니터도 만들어져 up입니다.
- Terraform plan에서 역할 PR은 `3 to add, 0 to change, 0 to destroy`였습니다. 역할 1개와 인라인 정책 2개이며, 레코드 변경은 0입니다.

지금은 평상시 경로, 즉 edge가 정상이면 아무것도 바꾸지 않는 동작만 실제로 돌아 본 상태입니다. 장애 경로는 스크립트의 DRY_RUN 시험과 정책 시뮬레이션까지만 확인했습니다. 다음은 아직 확인하지 못했습니다.

- 실제 레코드 전환: hub로 넘겼다가 되돌리는 훈련을 하지 않았습니다.
- Kuma webhook이 실제로 워크플로를 깨우는지: edge가 DOWN이 된 적이 없습니다.
- 러너에서 hub IP를 확인하는 경로.
- 전환에 걸리는 시간의 실측: 앞서 적은 5분 안팎은 설계값입니다.
