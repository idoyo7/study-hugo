---
title: "MySQL 8.0 Instant DDL의 속도를 만드는 메타데이터"
description: "MySQL은 기존 로우를 고치지 않고 컬럼을 바꾼 뒤 어떻게 정확한 데이터를 읽을까요? 8.0.29의 Instant DDL은 ROW_VERSION과 컬럼 변경 이력을 남겨, 조회할 때 파일의 값이나 기본값을 읽고 삭제한 컬럼은 제외합니다."
date: 2026-11-14
weight: 3
---

# MySQL 8.0 Instant DDL의 속도를 만드는 메타데이터 (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MySQL Ver. 8.0 New Feature: Instant DDL Algorithm에 대한 이해](https://tech.kakao.com/posts/731)
- 매체 · 게시일: 카카오 기술블로그 · 2025-09-02
- 저자: 본문에 저자 미표기
- 2023년 11월에 분석한 내용이며, 8.0.12의 초기 Instant가 아니라 8.0.29에서 개선된 알고리즘을 중심으로 합니다. 내부 구조 그림과 테스트 시나리오는 MySQL 공식 블로그와 슬라이드 자료를 참고했다고 밝힙니다. 원문 끝에는 같은 주제의 카카오 기술블로그 글(posts/703) 링크가 있습니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

카카오는 MySQL 8.0.19부터 Instant DDL을 사용했습니다. 운영 중인 테이블의 컬럼을 빠르게 바꾸는, 엔지니어들이 기다리던 기능이었습니다. 도입 초기부터 여러 문제를 겪으면서 내부에서 어떤 로직으로 처리하는지, 이후 설계는 어떻게 바뀌었는지 분석하게 됐습니다.

## 데이터 복사를 생략한 Instant DDL {#알고리즘-변천}

1.6GB 테이블에 컬럼을 추가하는 데 걸린 시간은 0.01초였습니다. MySQL 8.0.12에 도입된 Instant v1의 실행 예제입니다. 기존 로우의 물리적 구조는 그대로 두고 테이블 메타데이터만 수정하므로, 테이블 크기에 관계없이 컬럼을 빠르게 추가합니다.

이전 알고리즘에서는 테이블이 커질수록 변경 작업도 부담스러웠습니다. Copy는 DDL 작업 내내 Read Lock을 확보한 채 변경된 구조의 임시 테이블을 만들고 데이터를 옮겼습니다. 24시간 트래픽을 받는 서비스에서는 서비스를 멈춰야 하는 상황까지 생겼습니다. In-Place는 장시간 Lock을 잡는 문제를 없앴지만, 새 테이블로 데이터를 복사하는 방식은 유지했습니다. 데이터가 많으면 ALTER에 필요한 공간과 시간도 늘어났습니다.

Instant v1은 이 복사 과정을 생략했지만 적용 범위가 좁았습니다. 새 컬럼은 테이블의 마지막에만 추가할 수 있었고, DROP COLUMN은 지원하지 않았습니다. 8.0.29의 Instant v2에서는 내부 설계를 바꿔 위치와 관계없이 컬럼을 추가하거나 삭제하도록 개선했습니다.

v2도 데이터 영역을 수정하지 않습니다. ADD와 DROP COLUMN에 걸리는 시간은 테이블 크기와 무관하게 거의 같습니다. 컬럼을 추가할 때는 `ALTER TABLE ... ADD COLUMN ... [FIRST]/[AFTER ...], ALGORITHM=Instant`, 삭제할 때는 `DROP COLUMN ..., ALGORITHM=Instant` 구문을 사용합니다.

## 삭제 뒤에도 파일에 남은 rC {#fetch-규칙}

컬럼을 바꿨는데 로우는 그대로라면, 조회 결과와 파일 내용은 달라집니다. 카카오가 `xxd`로 데이터 파일을 확인한 테스트에서 그 차이가 드러났습니다.

C1부터 C4까지 있는 테이블에 `rA`, `rB`, `rC`, `rD`를 가진 로우를 입력한 뒤, Instant로 C5를 `DEFAULT "rE"`와 함께 추가했습니다. SELECT 결과에는 C5의 기본값인 `rE`가 나타났습니다. 파일에는 그 값이 없었습니다. 이어 C3를 삭제하자 조회 결과에서 해당 컬럼이 사라졌지만, 파일에는 C3의 값인 `rC`가 여전히 남아 있었습니다.

컬럼 추가와 삭제가 기존 로우를 물리적으로 고치지 않았다는 증거입니다. MySQL은 파일에 없는 값을 조회 결과에 채우기도 하고, 파일에 남아 있는 값을 제외하기도 해야 합니다. 이를 판단하려면 현재 테이블의 컬럼 정보뿐 아니라 각 로우가 어느 시점의 테이블 구조로 저장됐는지도 알아야 합니다.

## 로우를 해석하는 기준 ROW_VERSION {#row-version}

Instant v2에서 도입한 ROW_VERSION은 테이블마다 Instant ALTER를 수행한 횟수입니다. 테이블 메타데이터에 현재 값을 기록하고, 로우에는 입력하거나 수정할 당시의 값을 남깁니다. 같은 테이블 안에서도 로우마다 버전이 달라질 수 있습니다.

테이블의 현재 값은 `INFORMATION_SCHEMA.INNODB_TABLES`의 `TOTAL_ROW_VERSIONS` 컬럼에서 확인합니다. 새 테이블에서는 0입니다. Instant로 컬럼을 한 번 추가하면 1, 이어 한 번 삭제하면 2가 됩니다.

로우 쪽에서는 INFO BITS가 버전 정보의 유무를 알려 줍니다. 4비트 중 두 번째 비트가 1이면 로우 헤더에 1바이트 크기의 ROW_VERSION 영역이 있다는 뜻입니다. 앞의 테스트에서도 컬럼을 추가한 뒤 입력한 로우는 ROW_VERSION이 1, INFO BITS가 4로 기록됐고, 컬럼을 삭제한 뒤 입력한 로우는 ROW_VERSION이 2였습니다.

로우의 버전만으로는 어떤 컬럼이 바뀌었는지 알 수 없습니다. 컬럼별로 추가 시점인 `VERSION_ADDED`와 삭제 시점인 `VERSION_DROPPED`도 관리합니다. Instant로 컬럼을 추가하면 증가한 ROW_VERSION을 `VERSION_ADDED`에, 삭제하면 그때의 값을 `VERSION_DROPPED`에 기록합니다. 관련 문서에 따르면 이 정보는 Data Dictionary에 저장됩니다. 카카오의 분석에서는 물리적으로 어느 영역에 저장되는지까지 확인하지 못해, 조회에 쓰이는 정보라는 범위에서 설명했습니다.

로우를 가져오는 Fetch 과정은 이 값들을 비교합니다. `VERSION_ADDED`와 `VERSION_DROPPED`가 모두 0인 컬럼은 파일에 저장된 값을 그대로 읽습니다. `VERSION_DROPPED`가 0이 아니면 조회 대상에서 제외합니다.

추가 이력이 있는 컬럼은 비교가 더 필요합니다. `VERSION_ADDED`가 로우의 ROW_VERSION보다 크면 컬럼의 기본값을 읽고, 더 작으면 파일에 저장된 값을 읽습니다. C5를 추가하기 전에 입력한 로우에서 `rE`가 조회된 이유도 여기에 있습니다. 로우에는 C5가 없지만, 컬럼을 추가한 버전이 로우의 버전보다 크므로 기본값을 가져온 것입니다.

## Update 뒤에 달라지는 로우의 자리 {#update-처리}

기존 로우를 수정할 때는 ROW_VERSION도 현재 테이블의 값으로 갱신합니다. 카카오는 Instant DDL을 세 번 수행해 `TOTAL_ROW_VERSIONS`가 3인 테이블에서, ROW_VERSION이 1인 로우를 Update했습니다. 테스트는 Row Header와 데이터를 합친 크기가 기존보다 작아지는 경우와 커지는 경우로 나눴습니다.

C2 값을 `r2B`에서 `rU`로 바꾼 경우에는 로우의 크기가 줄었습니다. 파일을 확인하니 기존 자리에서 데이터가 수정됐고, ROW_VERSION은 1에서 3으로 바뀌어 있었습니다.

기존보다 큰 `rBRBRBR…`로 바꾸면 결과가 달랐습니다. 커진 로우를 제자리에 저장하지 못해 가장 뒤쪽에 새 로우를 입력했고, 새 로우의 ROW_VERSION은 3이었습니다. 기존 로우의 값은 파일에 그대로 남아 있었습니다.

## 카카오 표준 DB 구성에서 확인한 성능 {#마무리}

DDL은 빨라졌지만 데이터를 읽는 절차는 늘었습니다. 로우 버전과 컬럼의 변경 이력을 확인해 기본값을 가져오거나 컬럼을 제외해야 하므로, Instant DDL 이후의 Fetch는 이전보다 복잡합니다. SELECT 성능이 떨어질 가능성도 있습니다.

카카오는 이 가능성을 확인하려고 Instant DDL을 수행한 뒤 Sysbench의 `bulk_insert`, `oltp_read_write` 시나리오로 성능을 테스트했습니다. 그 결과 카카오 표준 DB 구성에서는 크게 의미 있는 성능 저하가 없다고 판단했습니다. 테스트 상세는 글에 싣지 않고 이 판단만 공유했습니다.

## Instant DDL에 남은 적용 제한 {#instant-limits}

8.0.29에서는 ROW_VERSION이 64까지만 증가합니다. 이 값에 도달한 뒤 `ALGORITHM=Instant`를 명시해 컬럼을 추가하거나 삭제하면 ERROR 4080과 함께 “Maximum row versions reached” 오류가 발생합니다. 알고리즘을 명시하지 않으면 In-place로 실행됩니다. Instant를 기대하고 수행한 ALTER가 다른 방식으로 동작할 수 있는 조건입니다.

64에 도달했다고 Instant를 더는 쓸 수 없는 것은 아닙니다. 테이블을 재구축하면 ROW_VERSION이 초기화돼 다시 사용할 수 있습니다. `TRUNCATE TABLE`도 값을 초기화하지만, 테이블의 데이터를 모두 삭제합니다.

버전 상한에 이르기 전에도 적용할 수 없는 테이블이 있습니다. FTS(Full-Text-Search) 인덱스가 있는 테이블, `ROW_FORMAT=COMPRESSED` 테이블, 임시 테이블에서는 Instant v2를 사용할 수 없습니다.

{{% details title="Instant 버전별 기능과 적용 제한" closed="true" %}}

| 항목 | 값 |
|---|---|
| Instant v1 도입 | 8.0.12 (컬럼 추가만, 마지막 위치에만) |
| Instant v2 도입 | 8.0.29 (위치 무관 ADD/DROP COLUMN) |
| v1 예시 결과 | 1.6GB 테이블에서 컬럼 추가 0.01초 |
| ROW_VERSION 상한 | 64 (8.0.29) |
| 상한 도달 뒤 명시 시 오류 | ERROR 4080, Maximum row versions reached |
| 상한 도달 뒤 미명시 시 | ALGORITHM=INPLACE로 대체 |
| 사용 불가 조건 | FTS 인덱스, ROW_FORMAT=COMPRESSED, 임시 테이블 |
| ROW_VERSION 확인 | INFORMATION_SCHEMA.INNODB_TABLES의 TOTAL_ROW_VERSIONS |
| Update 시 ROW_VERSION | 제자리 수정이면 갱신, 큰 값이면 뒤에 새 로우 입력 |

{{% /details %}}
