---
title: "HTTP Applications로 배포 전에 시험하는 설정 변경"
description: "별도 스테이징 zone 없이 Cloudflare 설정 변경을 어떻게 시험할까요? HTTP Applications의 설정 버전을 테스트용 IP에서 시험하고, Routing Rules로 같은 버전을 전체 트래픽에 적용합니다."
date: 2026-11-14
weight: 16
---

# HTTP Applications로 배포 전에 시험하는 설정 변경 (2022-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How we built config staging and versioning with HTTP applications](https://blog.cloudflare.com/version-and-stage-configuration-changes-with-http-applications)
- 매체 · 게시일: The Cloudflare Blog · 2022-05-12
- 저자: Garrett Galow
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

Cloudflare 설정을 배포 전에 시험하려면 예전에는 별도의 스테이징 zone이 필요했습니다. HTTP Applications와 Routing Rules를 함께 쓰면 설정 변경을 버전으로 묶어 두고, 테스트용 IP로 들어오는 요청에만 그 버전을 적용할 수 있습니다. 규칙이나 설정의 오류가 고객에게 영향을 주기 전에 확인할 기회가 생깁니다.

시험을 마치면 그 설정을 그대로 배포합니다. 문제가 생겼을 때 돌아갈 곳도 개별 설정 항목이 아닌 직전 버전입니다. 이 동작을 가능하게 하려면 설정을 보관하는 단위와 요청에 적용하는 방식을 함께 바꿔야 합니다.

## 호스트네임에서 독립한 HTTP Application {#http-application}

HTTP Application은 호스트네임 대신 용도를 기준으로 L7 설정을 묶는 단위입니다. 마케팅 웹사이트를 위한 설정이나 사내 애플리케이션을 위한 설정처럼, 각각의 목적을 갖습니다. 그 안의 각 버전은 Page Rules, Firewall Rules, 캐시 설정 등 트래픽을 처리할 설정을 담은 스냅샷입니다.

출발점은 기존 zone입니다. zone의 현재 설정을 복사해 첫 번째 버전을 만들지만, 이후 zone을 수정해도 버전 1은 바뀌지 않고 버전 1을 수정해도 zone에는 영향을 주지 않습니다. 처음의 내용만 같을 뿐, 이후에는 독립적으로 관리합니다.

새 버전도 직전 버전을 복사해 시작하며, 버전끼리 서로 영향을 주지 않습니다. 버전을 만들기만 해서는 트래픽이 바뀌지 않습니다. 특정 호스트네임에 묶이지 않은 이 설정을 실제 요청에 적용하려면 Routing Rules로 배포해야 합니다.

## 설정 조회에 한 단계를 더하는 Routing Rules {#request-flow}

요청에 적용할 버전은 Routing Rules가 정합니다. Cloudflare의 Ruleset Engine에서 실행되는 “if, then” 규칙으로, 계정에서 관리하는 호스트네임을 설정 버전에 연결합니다.

이 규칙이 개입하는 지점은 요청을 처리할 설정을 불러오기 전입니다. Cloudflare의 모든 데이터센터에서는 먼저 요청의 소유권을 조회해 계정과 설정의 쌍을 찾습니다. 예를 들어 계정 id가 777이고 zone id가 123인 `example.com`에 `cat.jpg` 요청이 들어오면, 소유권 조회 결과는 `777:123`입니다. 이 값이 요청을 처리할 계정과 설정을 가리킵니다.

HTTP Applications와 Routing Rules를 사용해도 소유권 조회는 그대로입니다. 그 뒤에 적용할 설정을 바꾸는 라우팅 규칙이 있는지 한 번 더 확인합니다. 예를 들어 `zone.name = example.com`이면 HTTP Application xyz의 버전 2를 쓰라는 규칙이 있고, 그 버전의 설정 id가 456이라면 설정 조회에는 `777:456`을 사용합니다. 계정은 그대로 두고, `example.com`의 일반 zone 설정 대신 버전 2의 설정을 불러오는 과정입니다.

{{% details title="요청에 적용할 설정이 바뀌는 예시" closed="true" %}}

| 항목 | 값 |
|---|---|
| 예시 계정 id / zone id | 777 / 123 |
| 기본 조회 값 | 777:123 |
| 규칙 적용 시 설정 id | 456 (버전 2) |
| 규칙 적용 시 조회 값 | 777:456 |
| 예시 규칙 | zone.name = example.com 이면 HTTP Application xyz 버전 2 사용 |

{{% /details %}}

## 테스트용 IP에서 전체 트래픽으로 이어지는 배포 {#rollback}

설정 버전을 고르는 조건에 테스트용 IP를 넣으면 스테이징이 됩니다. Routing Rules는 Ruleset Engine을 사용하므로, 테스트용으로 예약된 IP에 보낸 요청에만 실행되는 특별한 규칙을 만들 수 있습니다. Cloudflare가 제공하는 이 IP로 요청을 보내면, 아직 다른 트래픽에는 배포하지 않은 변경 버전을 시험하게 됩니다.

시험이 끝난 뒤 설정을 다시 만들 필요는 없습니다. 검증한 것과 똑같은 설정을 모든 트래픽에 한 번에 배포할 수 있습니다. 별도 스테이징 zone 없이 변경을 시험하고, 시험한 버전을 그대로 배포하는 흐름입니다.

스테이징에서 시험하다 문제가 생기거나 프로덕션 배포 중 문제가 드러나면, 직전에 배포했던 버전으로 원클릭 롤백할 수 있습니다. 어떤 설정이 바뀌었는지 찾아다니기 전에 먼저 복구합니다. 변경 내역을 살피고 원인을 조사하는 일은 문제를 해결한 뒤에 진행하면 됩니다.

## 엔터프라이즈 고객으로 넓어진 HTTP Applications 베타 {#beta-expansion}

Cloudflare는 2021년 12월 HTTP Applications를 클로즈드 베타로 공개했으며, 앞선 글에서 사용법을 더 자세히 소개했습니다. 이 글을 발표한 2022년 5월 12일에는 참여를 원하는 모든 엔터프라이즈 고객으로 베타 대상을 넓혔습니다.

당시 Cloudflare는 베타를 이용하려는 엔터프라이즈 고객에게 계정 담당자에게 접근 권한을 요청하도록 안내했습니다. 2022년 안에 제공 기능을 계속 확대하겠다는 계획도 밝혔습니다.
