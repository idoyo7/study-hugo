---
title: "MySQL 8.0 Instant DDL 알고리즘의 동작 원리"
description: "카카오 MySQL 엔지니어가 8.0.29에서 개선된 Instant DDL 알고리즘의 내부를 분석한 글을 정리했습니다. ROW_VERSION 메타데이터, 로우 Fetch 규칙, Update 때의 로우 변경 방식과 사용 시 한계를 요약합니다."
date: 2026-11-14
weight: 3
---

# MySQL 8.0 Instant DDL 알고리즘의 동작 원리 (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MySQL Ver. 8.0 New Feature: Instant DDL Algorithm에 대한 이해](https://tech.kakao.com/posts/731)
- 매체 · 게시일: 카카오 기술블로그 · 2025-09-02
- 저자: 본문에 저자 미표기
- 2023년 11월에 분석한 내용이며, 8.0.12의 초기 Instant가 아니라 8.0.29에서 개선된 알고리즘을 중심으로 합니다. 내부 구조 그림과 테스트 시나리오는 MySQL 공식 블로그와 슬라이드 자료를 참고했다고 밝힙니다. 원문 끝에는 같은 주제의 카카오 기술블로그 글(posts/703) 링크가 있습니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## DDL 알고리즘의 변천 {#알고리즘-변천}

MySQL은 서비스가 커질수록 운영하기 어려웠고, 그 큰 이유가 운영 중에 Online DDL을 하기 어렵다는 점이었습니다. 처음의 Copy 알고리즘은 DDL 내내 Read Lock을 쥔 채 바뀐 구조의 임시 테이블을 만들어 데이터를 옮깁니다. 24시간 트래픽을 받는 서비스에서는 서비스를 멈춰야 할 정도였습니다. 이를 줄이려고 나온 In-Place 알고리즘은 장시간의 Lock은 없앴지만, 새 테이블을 만들어 데이터를 복사한다는 방식은 그대로여서 테이블이 커질수록 더 많은 공간과 시간이 필요했습니다.

Instant 알고리즘은 MySQL 8.0에서 이 문제를 풀려고 도입됐습니다. 카카오 MySQL 엔지니어들이 기다리던 기능이라 8.0.19부터 써 왔고, 초기부터 겪은 문제들이 어떤 로직 때문이었고 이후 어떻게 바뀌었는지 궁금해 내부를 분석했다고 합니다.

## Instant v1과 v2 {#v1-v2}

8.0.12의 초기 Instant(v1)는 물리 구조를 건드리지 않고 테이블 메타 정보만 고쳐, 테이블 크기와 상관없이 컬럼을 즉시 추가합니다. 원문이 보인 결과는 1.6GB 테이블에 0.01초 만에 컬럼이 추가된 것입니다. 한계는 새 컬럼을 마지막 위치에만 넣을 수 있고 DROP COLUMN을 지원하지 않는다는 점이었습니다.

8.0.29부터는 내부 설계가 바뀌어(v2) 위치와 상관없이 컬럼을 추가하고 삭제할 수 있습니다. 여전히 데이터 영역은 바꾸지 않고 메타데이터만 수정하므로 ADD와 DROP COLUMN의 소요 시간이 테이블 크기와 무관하게 거의 같습니다. 구문은 `ALTER TABLE ... ADD COLUMN ... [FIRST]/[AFTER ...], ALGORITHM=Instant`와 `DROP COLUMN ..., ALGORITHM=Instant`입니다.

## ROW_VERSION과 그 한계 {#row-version}

v2에서 등장한 ROW_VERSION은 테이블마다 따로 기록되는 값으로, Instant로 ALTER를 수행한 횟수입니다. 테이블 메타데이터 영역과 로우 메타데이터 영역에 각각 저장되며, `INFORMATION_SCHEMA.INNODB_TABLES`의 `TOTAL_ROW_VERSIONS` 컬럼으로 볼 수 있습니다. 새 테이블은 0이고 컬럼 추가 한 번에 1, 컬럼 삭제 한 번에 다시 1씩 오릅니다.

8.0.29에서 ROW_VERSION은 64까지만 오릅니다. 그 뒤에 `ALGORITHM=Instant`를 명시하면 "Maximum row versions reached" 오류(ERROR 4080)가 나고, 명시하지 않으면 In-place 알고리즘으로 조용히 바뀌어 의도치 않은 동작이 될 수 있으니 주의해야 합니다. 값은 테이블을 재구축하면 초기화되어 Instant를 다시 쓸 수 있습니다(`TRUNCATE TABLE`도 초기화하지만 데이터를 모두 지우므로 의미가 없다고 원문은 봅니다). v2의 다른 한계는 FTS 인덱스가 있는 테이블, `ROW_FORMAT=COMPRESSED` 테이블, 임시 테이블에서 쓸 수 없다는 점입니다.

## 메타데이터와 Fetch 규칙 {#fetch-규칙}

Instant는 메타데이터만 바꾸므로 컬럼을 추가해도 데이터 파일의 로우에는 그 컬럼이 없을 수 있고, 컬럼을 삭제해도 모든 로우에서 값이 지워지지 않습니다. MySQL은 이 불일치를 사용자가 느끼지 못하게 별도 메타 정보를 둡니다.

- 로우 메타데이터: 각 로우의 INFO BITS(4비트) 중 두 번째 비트가 1이면 로우 헤더에 1바이트 ROW_VERSION 영역이 있다는 뜻이며, 값은 로우를 입력하거나 수정할 때의 테이블 `TOTAL_ROW_VERSION`입니다.
- 테이블 메타데이터: 컬럼 단위로 `VERSION_ADDED`와 `VERSION_DROPPED`를 두며 Data Dictionary에 저장됩니다. 컬럼을 삭제하면 ROW_VERSION이 오르고 그 값이 `VERSION_DROPPED`가 되며, 컬럼을 추가하면 올라간 ROW_VERSION이 `VERSION_ADDED`가 됩니다. 이 값들이 물리적으로 어디에 저장되는지는 확인하지 못해 Fetch 때 쓰는 정보라는 논리적 이해에서 멈춘다고 원문이 밝힙니다.

Fetch 규칙은 이렇습니다. 두 값이 모두 0인 컬럼은 데이터 파일 그대로 읽습니다. `VERSION_DROPPED`가 0이 아니면 조회에서 제외합니다. `VERSION_ADDED`가 0이 아닌 컬럼은 로우의 ROW_VERSION과 견줘, 컬럼의 값이 더 크면 컬럼의 기본값을 읽고 더 작으면 파일에 저장된 값을 읽습니다.

원문은 컬럼 네 개짜리 테이블에 로우를 넣고 C5를 `DEFAULT "rE"`로 추가한 뒤 C3를 삭제하는 시나리오를 `xxd`로 확인했습니다. 조회에는 `rE`가 나오지만 파일 바이너리에는 없고, C3는 조회에서 사라졌지만 바이너리에는 `rC`가 남아 있었습니다. 컬럼을 추가한 뒤 입력한 로우는 ROW_VERSION 1과 INFO BITS 4로, 컬럼을 삭제한 뒤 입력한 로우는 ROW_VERSION 2로 기록되어 예측과 맞았습니다.

Fetch 로직이 이전보다 복잡해져 SELECT 성능이 떨어질 수 있다는 것이 원문의 해석입니다. 카카오도 이를 인지해 Sysbench의 `bulk_insert`, `oltp_read_write` 시나리오로 테스트했고, 카카오 표준 DB 구성에서는 의미 있는 성능 저하가 없다고 판단했습니다. 테스트 상세는 길어서 결론만 적었습니다.

## Update 때의 로우 처리 {#update-처리}

Instant DDL을 세 번 수행해 TOTAL_ROW_VERSIONS가 3인 테이블에서, ROW_VERSION 1인 로우를 갱신해 봤습니다. 기존보다 작은 값으로 바꾸면 그 자리에서 수정되고 로우의 ROW_VERSION이 1에서 3으로 올라갑니다. 기존보다 큰 값으로 바꾸면 제자리에 담기지 않아 가장 뒤쪽에 새 로우가 입력되며 ROW_VERSION은 3이고 기존 로우는 그대로 남습니다.

## 마무리 {#마무리}

Instant 알고리즘은 컬럼 추가와 삭제를 빠르게 하려고 도입됐고, 그 대가로 관리용 메타데이터가 늘고 Fetch가 복잡해졌습니다. DDL이 서비스에 주는 영향은 줄지만 SELECT 성능 저하가 예상되므로 쓰는 것이 맞는지 고민해야 하고, 기능의 특징과 제한을 알고 필요한 곳에 알맞게 쓰면 MySQL의 사용성을 높일 수 있다는 것이 원문의 결론입니다.

{{% details title="Instant 알고리즘 버전별 비교와 제한값" closed="true" %}}

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
