---
title: "HTTP Applications로 구현한 설정 버전 관리와 스테이징"
description: "Cloudflare가 L7 설정을 호스트네임이 아닌 용도 단위로 묶고 버전과 스테이징을 붙인 HTTP Applications의 동작 원리를 정리했습니다. Routing Rules가 요청마다 어떤 설정 버전을 불러올지 정하는 과정을 요약합니다."
date: 2026-11-14
weight: 13
---

# HTTP Applications로 구현한 설정 버전 관리와 스테이징 (2022-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How we built config staging and versioning with HTTP applications](https://blog.cloudflare.com/version-and-stage-configuration-changes-with-http-applications)
- 매체 · 게시일: The Cloudflare Blog · 2022-05-12
- 저자: Garrett Galow
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 클로즈드 베타에서 엔터프라이즈 공개로 {#beta-expansion}

Cloudflare는 2021년 12월에 HTTP Applications를 클로즈드 베타로 공개했습니다. 고객이 L7 설정을 버전과 스테이징으로 더 안전하게 다루게 하는 제품입니다. 이 글은 베타를 참여 의사가 있는 모든 엔터프라이즈 고객으로 넓히는 시점에 나왔고, 개선된 점과 내부 동작 방식을 설명합니다.

## 용도 단위 설정과 버전 {#http-application}

HTTP Application은 설정을 호스트네임이 아니라 용도 기준으로 관리하는 단위입니다. 마케팅 웹사이트나 사내 애플리케이션처럼 목적마다 하나씩 둡니다. 안에는 버전이 여러 개 있고, 각 버전은 Page Rules, Firewall Rules, 캐시 설정 같은 트래픽 관리 설정의 스냅샷입니다. 버전끼리는 서로 독립이며, 새 버전은 직전 버전을 복사해서 시작합니다.

HTTP Application은 기존 zone 하나에서 만들어집니다. 그 zone의 현재 설정이 복사되어 첫 번째 버전이 되고, 이후에는 zone과 버전 1이 서로 영향을 주지 않습니다. 버전은 Routing Rules로 배포하기 전까지 zone의 트래픽에 아무 영향도 주지 않습니다.

## 어떤 버전을 쓸지 정하는 Routing Rules {#routing-rules}

버전은 특정 호스트네임에 묶여 있지 않으므로, 어떤 트래픽에 어떤 버전을 적용할지 따로 정해야 합니다. 이 역할이 Routing Rules입니다. Cloudflare의 Ruleset Engine 위에서 동작하며, 계정 안의 호스트네임을 설정 버전에 연결하는 "if, then" 조건을 씁니다. 예를 들면 zone 이름이 `example.com`일 때 HTTP Application xyz의 버전 2 설정을 쓰라는 식입니다.

이 규칙이 전 세계 네트워크에서 실행되면 `example.com`의 일반 zone 설정 대신 버전 2의 설정이 적용됩니다. 덕분에 예전처럼 별도의 스테이징 zone을 두지 않고도 변경 묶음을 버전으로 스테이징할 수 있습니다. Cloudflare는 배포 전에 설정을 시험할 수 있는 전용 IP를 제공하므로, 규칙이나 설정의 오류를 고객에게 닿기 전에 잡을 수 있습니다.

## 요청 처리 단계의 동작 {#request-flow}

모든 데이터센터에서 요청은 먼저 계정과 설정의 쌍에 연결됩니다. 계정 id가 777이고 zone id가 123인 `example.com`의 요청이라면 소유권 조회가 `777:123` 같은 값을 돌려주고, 이 값이 어떤 설정으로 요청을 처리할지 가리킵니다.

HTTP Applications와 Routing Rules를 쓰면 소유권 조회는 그대로 한 뒤에 조회를 한 번 더 합니다. 라우팅 규칙이 설정을 바꾸는지 확인하는 단계입니다. 규칙의 버전 2가 설정 id 456을 가진다면 조회 값은 `777:456`이 되고, 그 버전의 설정이 로드됩니다.

Routing Rules가 Ruleset Engine으로 구현된 덕분에, 테스트용으로 예약된 IP로 들어온 요청에만 실행되는 특별한 규칙을 만들 수 있습니다. 스테이징 IP로 온 요청은 아직 배포되지 않은 변경이 들어 있는 다른 버전으로 라우팅됩니다. 그래서 변경을 안전하게 시험한 뒤, 똑같은 설정을 모든 트래픽에 동시에 배포할 수 있습니다.

## 롤백 {#rollback}

스테이징 단계든 프로덕션 배포 단계든 문제가 생기면 직전에 배포한 버전으로 되돌리면 됩니다. 어떤 설정이 바뀌었는지 찾아다닐 필요가 없고, 원인 조사는 원클릭 롤백으로 문제를 해결한 뒤에 하면 됩니다. 원문은 이 제품이 설정 변경을 쉽게 하는 힘과 안전을 고객 손에 쥐여 준다고 설명하며, 올해 안에 기능을 계속 넓히겠다고 밝힙니다. 이용하려면 엔터프라이즈 고객이 계정 담당자에게 문의해야 합니다.

{{% details title="조회 값과 규칙 예시" closed="true" %}}

| 항목 | 값 |
|---|---|
| 예시 계정 id / zone id | 777 / 123 |
| 기본 조회 값 | 777:123 |
| 규칙 적용 시 설정 id | 456 (버전 2) |
| 규칙 적용 시 조회 값 | 777:456 |
| 예시 규칙 | zone.name = example.com 이면 HTTP Application xyz 버전 2 사용 |

{{% /details %}}
