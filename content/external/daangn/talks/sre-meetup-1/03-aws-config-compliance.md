---
title: "사내 운영 규칙을 AWS Config로 검사하고 보고하기"
description: "당근의 AWS Config 도입을 2021년 발표 슬라이드로 요약합니다. Rulebook을 Managed·Custom Rule에 연결한 방식과 RDK 배포, 일일 리포트, 당시 지원 제약을 다룹니다."
date: 2026-10-21
weight: 3
---

# 사내 운영 규칙을 AWS Config로 검사하고 보고하기 (SRE 밋업 1회)

{{< callout type="info" >}}
**원문 정보**
- 원문: 당근 SRE 밋업 1회 발표 슬라이드 (영상 미확인, 슬라이드 기준. 1회 재생목록에 비공개 영상 2개가 있어 확인하지 못했습니다)
- 매체 · 게시일: 밋업 발표 자료. 1회 밋업은 2021-08-26에 열렸고 같은 회차 영상은 2021-08-31에 게시되었습니다.
- 발표자: Ozzy (슬라이드 자기소개). 이름 외 실명은 슬라이드에 없고, 슬라이드 본문에 클라우드 파트에서 Rulebook을 관리한다는 설명이 있습니다.
- 근거: 발표 슬라이드 47쪽. 글자 추출이 깨져 페이지를 이미지로 보고 확인했습니다. 구두 설명은 확인하지 못했습니다.
- 발표 슬라이드를 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 규칙 문서만으로는 설정 준수를 확인하기 어렵다 {#사내-규칙을-사람이-점검하기-어려웠던-이유}

당근은 사내 표준을 정해도 리소스가 그 규칙을 따르는지 확인하기 어려웠습니다. 잘못 설정한 리소스가 있을 수 있고 국가별 규정도 달랐습니다. 슬라이드에는 AWS 서비스가 200개 이상이며 특정 환경의 리소스가 514개라고 나옵니다. 수동 점검을 계속하기 어려운 규모라는 설명입니다.

발표는 기업 정책과 규제 기관의 요구, 업계·보안 표준의 준수 여부를 지속해서 감시하고 평가하는 과정을 컴플라이언스로 정의하고, 이 평가를 자동화하자고 제안합니다.

## Rulebook의 규칙을 코드와 평가 결과로 연결 {#rulebook을-aws-config-평가로-연결}

당근은 Confluence Rulebook에 AWS·Kubernetes·Terraform 운영 규칙을 기록했습니다. AWS 항목에는 IAM Role, RDS, SSM, S3, ACM, EC2, ElastiCache 등의 설정 판단 기준이 있습니다. 2021년 초부터 이 AWS 규칙을 Config로 관리하기 시작했고, 모든 규칙을 검사하는 것을 목표로 삼았습니다.

규칙을 코드로 작성하면 같은 기준으로 반복 평가하고, 기준이 바뀔 때 코드도 수정할 수 있습니다. 슬라이드는 정기 감사에 여러 사람이 함께 시간을 쓰는 부담을 줄이고 필요할 때 일부 리소스를 평가하거나 위반 설정을 자동 교정할 수 있다는 점을 들었습니다.

AWS가 제공하는 Managed Rule은 당시 190개였고 파라미터를 지정해 사용했습니다. Lambda로 평가하는 Custom Rule은 RDK(Rule Development Kit)로 개발·배포했습니다. RDK가 IAM Role, Lambda, CloudWatch Logs 등을 CloudFormation으로 만들며, Rulesets로 여러 Rule을 함께 배포합니다. Rule 묶음인 Conformance Pack에는 K-ISMS Pack도 있습니다.

Resource Inventory의 타임라인에는 CloudTrail 이벤트와 설정·컴플라이언스 변경이 표시됩니다. 평가는 변경 후 약 1~2분 또는 정해진 시간 주기로 실행할 수 있습니다. 수동·자동 교정에는 AWS Systems Manager Automation을 사용하며 AWS-CreateJiraIssue로 티켓을 생성하는 방법도 소개했습니다.

당근의 규칙에는 ASG 지표 활성화, Access Key 생성 후 90일 미만 유지, 조건별 ElastiCache Redis 버전 확인, CloudFront default root object와 리소스 태그 검사가 있습니다. 태그에는 지정된 Key와 이에 맞는 Value가 있어야 했습니다. 정해진 Rule의 평가 결과는 매일 오전 10시 Slack으로 보냈습니다.

## 일일 리포트와 보안 외의 활용 {#확인할-수-있는-산출물}

슬라이드에는 Rulebook 기반 규칙 세트, RDK로 배포한 Custom Rule, 리전별 검사 결과·오류 수를 담은 Slack 리포트가 나옵니다. 도입 전후 효과를 수치로 비교한 결과는 없습니다.

활용 대상으로는 보안 규칙 외에도 지정한 RI 인스턴스 사용 여부, ElastiCache 점검 시간, S3 버킷 정책의 특정 Action 금지를 제안했습니다.

## 지원하지 않는 리소스와 RDK의 제약 {#사용하면서-드러난-제약}

AWS Config가 직접 지원하지 않는 리소스도 Custom Rule로 다룰 수 있지만, 발표자는 당시 지원이 충분하지 않다고 평가했습니다. Unsupported Resource에는 이름과 Type만 표시되고 ARN이나 Manage Resource 버튼은 없었습니다. ElastiCache, Route53, MSK를 예로 들었습니다.

Config는 Terraform으로 관리하지 않았습니다. Role부터 여러 리소스가 함께 생성돼 관리가 더 복잡해졌다는 이유입니다. Rule을 이름으로 검색·정렬할 수 없어 Conformance Pack을 배포하면 원하는 규칙을 찾기도 어려웠습니다. 당근은 Rulebook 아래에 각 Config Rule의 링크를 관리했습니다.

RDK의 샘플 CI는 실제 개발에 필요한 내용이 부족해 리소스 설정을 직접 가져와야 했습니다. Lambda MemorySize가 하드코딩된 부분은 라이브러리 코드를 수정했습니다. 발표는 추가 참고 대상으로 보안 자동화의 bridgecrew와 통합 관리의 AWS Control Tower(Detective Guardrail)를 소개했습니다. 이 제약과 평가는 영상 없이 2021년 슬라이드에서 확인한 범위입니다.

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
