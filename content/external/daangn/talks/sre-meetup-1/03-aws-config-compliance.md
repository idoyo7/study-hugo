---
title: "AWS Config로 시작하는 컴플라이언스 기반 리소스 관리"
description: "당근 SRE 밋업 1회에서 SRE 팀 Ozzy가 발표한 AWS Config 활용 요약입니다. 영상은 확인하지 못했고 슬라이드만으로 정리했습니다. Rule과 Conformance Pack, RDK, 사내 Rulebook 연동과 써 보며 느낀 한계를 다룹니다."
date: 2026-10-21
weight: 3
---

# AWS Config로 시작하는 컴플라이언스 기반 리소스 관리 (SRE 밋업 1회)

{{< callout type="info" >}}
**원문 정보**
- 원문: 당근 SRE 밋업 1회 발표 슬라이드 (영상 미확인, 슬라이드 기준. 1회 재생목록에 비공개 영상 2개가 있어 확인하지 못했습니다)
- 매체 · 게시일: 밋업 발표 자료. 1회 밋업은 2021-08-26에 열렸고 같은 회차 영상은 2021-08-31에 게시되었습니다.
- 발표자: Ozzy (슬라이드 자기소개). 이름 외 실명은 슬라이드에 없고, 슬라이드 본문에 클라우드 파트에서 Rulebook을 관리한다는 설명이 있습니다.
- 근거: 발표 슬라이드 47쪽. 글자 추출이 깨져 페이지를 이미지로 보고 확인했습니다. 구두 설명은 확인하지 못했습니다.
- 이 문서는 슬라이드를 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 사내 규칙을 사람이 점검하기 어려웠던 이유

슬라이드는 당근의 문제로 사내 표준을 만들어도 리소스가 규칙대로 쓰이는지 보장할 수 없다는 점을 듭니다. 실수로 잘못 설정한 리소스가 있을 수 있고, 글로벌 서비스라 국가별 규정도 많았습니다. AWS 서비스는 200개가 넘고 특정 환경의 리소스만 514개여서 사람이 하나씩 관리하기 어려웠습니다.

발표는 기업 정책과 규제 기관의 요구, 업계·보안 표준을 지키는지 지속해서 감시하고 평가하는 과정을 컴플라이언스로 정의합니다. 슬라이드의 결론은 이 과정을 자동화해야 한다는 것입니다.

## Rulebook을 AWS Config 평가로 연결

당근은 사내 Confluence의 Rulebook에 AWS, Kubernetes, Terraform에서 지킬 규칙을 적어 둡니다. AWS 규칙에는 IAM Role, RDS, SSM, S3, ACM, EC2, ElastiCache 등의 잘못된 설정을 판단하는 기준이 있습니다. 올해 초부터 AWS Config로 AWS 규칙을 관리하기 시작했으며, 목표는 모든 규칙을 관리하는 것입니다.

슬라이드는 AWS Config를 쓰면 정기 감사에 모두가 시간을 낼 필요가 없고, 필요할 때 작은 단위로 평가하거나 위반 리소스를 자동으로 고칠 수 있다고 설명합니다. 규칙을 코드로 작성하면 일관된 기준으로 평가하고 준수 여부를 빠르게 확인할 수 있으며, 기준이 바뀌어도 코드만 고치면 됩니다.

평가에 쓰는 Rule은 AWS가 제공하는 Managed Rule과 Lambda로 동작하는 Custom Rule로 나뉩니다. Managed Rule은 슬라이드 시점에 190개이며 파라미터만 넣으면 평가할 수 있습니다. 여러 Rule을 묶은 패키지가 Conformance Pack이고, K-ISMS Pack도 제공됩니다.

당근은 Custom Rule을 RDK(Rule Development Kit)로 개발하고 배포합니다. RDK는 필요한 IAM Role, Lambda, CloudWatch Logs 등을 CloudFormation으로 배포하며, Rulesets로 여러 Rule을 한 번에 배포할 수 있습니다. AWS Config가 지원하지 않는 리소스도 Custom Rule로 다룰 수 있지만, 슬라이드는 지원이 다소 부실하다고 평가합니다.

Resource Inventory에서는 리소스 목록과 타임라인을 확인합니다. 타임라인은 CloudTrail 이벤트, 설정과 컴플라이언스 변경 기록을 보여 줍니다. 평가는 변경 시 1~2분 정도의 준실시간으로 실행하거나 시간 주기(Cron 방식)로 실행할 수 있습니다. 교정은 자동과 수동이 있고, AWS Systems Manager Automation으로 고치거나 AWS-CreateJiraIssue로 Jira 티켓을 만들 수 있습니다.

당근의 규칙 예로는 Auto Scaling Group 지표 활성화, Access Key 생성 후 경과 기간(age) 90일 미만, 조건에 따른 ElastiCache Redis 버전 확인, CloudFront의 default root object 설정, 리소스 태그가 나옵니다. 태그에는 정해진 Key와 그에 대응하는 Value가 있어야 합니다. 정해진 Rule의 평가 결과는 매일 아침 10시에 Slack으로 게시합니다.

## 확인할 수 있는 산출물

슬라이드에서 확인할 수 있는 산출물은 Rulebook 기반 규칙 세트, RDK로 배포한 Custom Rule, 리전별 검사 결과와 오류 수를 담은 Slack 일일 리포트입니다. 정량 결과는 제시되지 않았습니다.

발표는 보안 외의 정책 점검에도 활용을 제안합니다. 정해진 RI 인스턴스 사용 여부, ElastiCache 점검 시간 지정, S3 버킷 정책의 특정 Action 금지가 그 예입니다.

## 사용하면서 드러난 제약

슬라이드에 따르면 당근은 Config를 Terraform으로 관리하지 않습니다. Role 생성부터 여러 리소스가 한꺼번에 생겨 관리가 더 어려웠기 때문입니다. Rule은 이름으로 검색하거나 정렬할 수 없고, Conformance Pack 하나만 배포해도 수가 많아져 찾기 어려웠습니다. 당근은 컨플루언스의 Rulebook 하위에 Config Rule 링크를 따로 관리합니다.

Unsupported Resource는 이름과 Type만 보이고 ARN이 없으며 Manage Resource 버튼도 쓸 수 없습니다. 슬라이드는 ElastiCache, Route53, MSK를 해당 리소스로 듭니다. RDK 샘플 CI는 내용이 부실해 실제 리소스 설정을 가져와 개발해야 했습니다. Lambda MemorySize가 하드코딩되어 있어 라이브러리 코드도 수정했습니다.

슬라이드는 더 다양한 보안 자동화에는 bridgecrew를, 통합 관리에는 AWS Control Tower(Detective Guardrail)를 참고하라고 안내합니다.

{{% details title="근거와 세부 수치" closed="true" %}}

| 항목 | 내용 | 근거 |
|---|---|---|
| 리소스 규모 | AWS 서비스 200개 이상, 특정 환경의 리소스 514개 | 슬라이드 |
| Managed Rule 수 | 190개 | 슬라이드 |
| 변경 트리거 지연 | 1~2분 정도의 준실시간 | 슬라이드 |
| 정기 리포트 | 매일 아침 10시 Slack 게시 | 슬라이드 |
| Access Key 규칙 | 생성 후 경과 기간(age) 90일 미만 | 슬라이드 |
| 도입 시점 | 올해 초부터 (발표 시점인 2021년 기준) | 슬라이드 |

발표자의 구두 설명, 리소스 514개가 어느 환경의 값인지, 규칙 개수는 슬라이드에 없거나 영상 미확인이라 적지 않았습니다. 슬라이드 PDF는 글꼴 인코딩이 깨져 페이지 이미지를 직접 읽었습니다.

{{% /details %}}
