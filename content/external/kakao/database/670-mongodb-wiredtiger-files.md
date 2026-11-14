---
title: "MongoDB WiredTiger 데이터 디렉터리의 파일 구조"
description: "카카오 분산데이터베이스 조직의 MongoDB 운영자가 WiredTiger가 만드는 파일들을 bsondump와 wt로 하나씩 열어 본 글을 정리했습니다. 메타데이터, 히스토리 스토어, 저널 로그, 컬렉션·인덱스 파일에 어떤 값이 어떤 형식으로 저장되는지 다룹니다."
date: 2026-11-14
weight: 8
---

# MongoDB WiredTiger 데이터 디렉터리의 파일 구조 (2024-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MongoDB WiredTiger의 파일 구조](https://tech.kakao.com/posts/670)
- 매체 · 게시일: 카카오 기술블로그 · 2024-12-06
- 저자: andy.hj (카카오 분산데이터베이스 조직, MongoDB 운영)
- WiredTiger 시리즈의 첫 글입니다. 이후 글은 WiredTiger의 주요 변경사항 등을 다룰 예정이라고 원문이 언급합니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 글의 출발점 {#motivation}

MongoDB를 운영하면 궁금한 점이 많은데, Oracle이나 MySQL만큼 깊이 있는 자료는 찾기 어렵다는 것이 글쓴이의 출발점입니다. 운영하며 정리한 내용을 나누려는 것이고, MongoDB를 쓰는 데 필수는 아니며 호기심이 있는 독자를 위한 글이라고 밝힙니다. 데이터 디렉터리의 파일을 열어 보면 대부분 사람이 읽을 수 없는 형태라서 답답하지만, 파일 내용을 몰라도 사용이나 이슈 분석에 문제가 생기지는 않습니다. 그래도 눈에 힘을 주면 뭔가 보일 것 같아 호기심이 생기는 파일들입니다.

MongoDB는 플러그형 스토리지 엔진 구조여서 과거에는 MMAPv1, RocksDB 같은 엔진도 지원했고, 지금은 WiredTiger가 기본입니다. WiredTiger는 버클리(Berkeley) DB를 만든 팀이 개발한 키-값 저장소로, 트랜잭션, 락 프리 알고리즘, 데이터 압축을 지원합니다. 6.0 기준 데이터 디렉터리에는 WiredTiger, WiredTiger.lock, WiredTiger.turtle, WiredTiger.wt, WiredTigerHS.wt, _mdb_catalog.wt, sizeStorer.wt, journal, 데이터베이스별 디렉터리 등이 생깁니다. storage.directoryPerDB 옵션이면 데이터베이스마다 전용 디렉터리를 씁니다.

## 분석 도구 {#tools}

내용을 보려면 두 도구가 필요합니다.

- bsondump: BSON(Binary JSON) 데이터를 읽을 수 있는 JSON으로 바꿔 줍니다. MongoDB 바이너리 패키지에 들어 있습니다.
- wt: WiredTiger의 내부 파일에 직접 접근해 조작하는 유틸리티입니다. 패키지에 없어서 WiredTiger 소스를 받아 cmake로 `make wt` 빌드해야 합니다. 글에서는 mongodb-6.0 브랜치를 썼습니다.

wt를 쓸 때는 mongod 프로세스를 내려 둬야 하고, 파일을 직접 수정할 수 있어 운영 환경에서는 조심해야 합니다.

## 메타데이터 파일 {#metadata-files}

- WiredTiger: 실행 중인 엔진의 버전을 적은 텍스트 파일입니다. 글의 환경(MongoDB 6.0.11)은 WiredTiger 10.0.2입니다. WiredTiger의 변경은 MongoDB 기능과 맞물려 있습니다. 3.0.0의 타임스탬프 기능으로 MongoDB 3.6부터 타임스탬프 연산을 지원했고, 10.0.0에서 도입된 히스토리 스토어는 MongoDB 4.4부터 WiredTigerLAS.wt를 대체했습니다.
- WiredTiger.lock: 다른 MongoDB 인스턴스가 데이터 파일에 동시에 접근하는 것을 막고, 서버가 정상 종료됐는지 판단하는 데 쓰입니다. 시작할 때 이 파일의 존재 여부로 복구 여부가 정해집니다. 비정상 종료 뒤 lock 파일이 남아 있으면 마지막 안정된 체크포인트로 복구하므로, 임의로 지우면 데이터 유실 위험이 있습니다.
- WiredTiger.wt: 모든 파일의 구성 정보와 최신 체크포인트 같은 메타데이터를 담습니다. 컬렉션과 인덱스 파일의 설정은 `file:` 항목에 들어 있고, 대부분 같지만 의도된 차이가 있습니다. 먼저 사용자 컬렉션의 데이터·인덱스 파일은 `log=(enabled=false)`, oplog 파일은 `log=(enabled=true)`입니다. 모든 파일에 저널링을 하면 변경마다 저널에 먼저 써야 하는데, MongoDB는 모든 변경을 oplog에 저장하므로 oplog 저널링만으로 복구가 되고 oplog는 가능하면 원본 대신 변경분만 저장한다는 점에서 이득이라는 것이 글쓴이의 설명입니다. 저널링이 꺼진 파일의 쓰기는 메모리에 있다가 이빅션이나 체크포인트로만 디스크에 쓰여 체크포인트 내구성만 보장됩니다. `id` 값은 파일 고유 식별자로, 다른 파일은 보통 이름 대신 이 id를 참조합니다. 체크포인트는 파일별로 수행되어 파일마다 다른 체크포인트 정보를 가질 수 있습니다.
- WiredTiger.turtle: WiredTiger.wt 자체의 최신 체크포인트 정보를 담습니다. WiredTiger.wt는 다른 파일의 체크포인트가 수행될 때마다 갱신되므로, 이 파일의 체크포인트는 전체 과정의 마지막 단계에서 수행하고 결과를 turtle에 따로 기록합니다. 이 과정은 스냅샷 격리 트랜잭션 안에서 실행되어 완료 전까지 일관된 뷰가 유지됩니다. 확장자의 뜻을 글쓴이는 추측으로만 풀며, 거북이 등껍질에 기록을 새긴 데서 왔을 수도, 단순히 느림을 뜻할 수도 있다고 농담처럼 적습니다.
- sizeStorer.wt: 컬렉션별 도큐먼트 수와 데이터 크기를 저장합니다. 쓰기마다 `_changeNumRecordsAndDataSize`로 갱신하고, `estimatedDocumentCount()`가 이 값을 참조합니다. 연산 실패에 대한 롤백은 고려되어 있지만 체크포인트 사이의 비정상 종료는 고려하지 않아서, 이때는 재시작 뒤 `validate()`로 값을 갱신할 수 있습니다. 샤드 클러스터에서는 각 샤드가 관리하는 값이라 고아 도큐먼트(청크 마이그레이션 실패나 비정상 종료로 이전 샤드에 남은 도큐먼트)를 걸러내지 못하므로, 정확한 값은 mongos에서 샤딩 필터를 쓰는 `countDocuments()`로 구합니다.
- _mdb_catalog.wt: 사용자에게 보이는 컬렉션과 인덱스의 메타데이터입니다. `md`에 네임스페이스, 옵션, UUID, 인덱스 정보가 있고, `idxIdent`와 `ident`가 인덱스·컬렉션 이름을 실제 파일 식별자(예: `kakao/collection-0-6574883217453298519`)에 매핑합니다. 내부 동작은 네임스페이스 대신 이 식별자로 파일에 접근하고, 인덱스 파일에는 값만 담아 효율을 높입니다.

## 히스토리 스토어 {#history-store}

WiredTigerHS.wt는 데이터 변경 이력을 관리하는 히스토리 스토어의 파일입니다. WiredTiger는 MVCC로 여러 버전의 변경을 메모리의 업데이트 체인(단일 연결 리스트, 최신이 맨 앞)에 유지합니다. 이빅션이나 체크포인트 때 여러 버전 중 하나가 디스크에 쓰이는데, 이 선택 과정을 리컨실리에이션이라 부릅니다. 스냅샷 격리 수준을 쓰기 때문에 오래 도는 트랜잭션은 과거 버전을 조회할 수 있어야 하고, 그래서 선택된 디스크 이미지보다 오래된 버전은 히스토리 스토어에 저장됩니다.

이전의 WiredTigerLAS.wt(Look Aside File)는 서버 부하가 높아 메모리를 확보하지 못할 때, 최신 변경이 커밋됐다는 조건만 맞으면 이빅션하면서 과거 버전을 임시로 적어 두던 파일이었습니다. 10.0.0의 히스토리 스토어는 이빅션 시 선택된 이미지보다 이전 버전을 기본적으로 모두 기록하므로 이 기능을 완전히 대체했습니다.

글쓴이는 같은 도큐먼트를 여러 번 갱신해(`AAA`를 1에서 3, 5, 7, 9로) 업데이트 체인을 만든 뒤 파일을 덤프했습니다. 최종값 9를 제외한 1, 3, 5, 7이 히스토리 스토어에 쌓였고, hs_value를 bsondump로 풀면 과거 버전의 도큐먼트 전문이 나옵니다. key와 value는 여러 값을 조합한 형태라서, 삽입 코드의 파라미터(btree id, key, start timestamp, counter 등)를 참고해 구분자를 가정하며 해석했습니다. 트랜잭션이 메모리에서 적절한 버전을 못 찾으면 이 파일에서 조회하고, 삭제되어 거기에도 없으면 WT_NOTFOUND 에러가 납니다. 보관 주기는 `minSnapshotHistoryWindowInSeconds`로 설정하며 6.0의 기본값은 300초입니다. Read Concern snapshot에 `atClusterTime`을 주면 이 주기 안의 과거 시점을 조회할 수 있고, 체크포인트 사이에 비정상 종료가 나면 히스토리 스토어로 가장 최근의 안정된 체크포인트 시점으로 복구합니다(Rollback To Stable).

## 저널 로그 {#journal}

journal 디렉터리는 WAL에 해당하는 저널 로그를 보관하고, 목적은 비정상 종료에도 내구성을 보장하는 것입니다. WiredTiger는 저널 파일을 재사용하지 않고 계속 새로 만듭니다. 빠른 전환을 위해 WiredTigerPreplog.* 파일을 미리 만들어 두고, WiredTigerLog.00000N을 다 쓰면 Preplog의 이름을 다음 번호로 바꿔 씁니다. 체크포인트 때 내용이 데이터 파일과 동기화되므로 그 이전의 저널은 삭제됩니다.

삽입, 갱신, 삭제를 차례로 실행하고 `wt printlog`로 저널을 뽑아 보니 세 연산의 optype이 모두 `row_put`이고 fileid는 모두 18(0x12)이었습니다. 갱신도 row_modify가 아닌 이유는, 저널링이 켜진 파일이 `local.oplog.rs`뿐이고 oplog는 복제를 위해 프라이머리의 모든 변경을 새 레코드로 기록해 삽입만 일어나기 때문입니다. fileid 18이 WiredTiger.wt에서 `local/collection-2-...`를, _mdb_catalog에서 `local.oplog.rs`를 가리키는 것으로 확인했고, 저널의 value를 bsondump로 풀면 `db.oplog.rs.find()`로 본 oplog와 같은 값이 나옵니다. 다만 standalone 배포에는 복제용 oplog가 없어 모든 컬렉션과 인덱스 파일을 저널링해야 하며, 글쓴이는 standalone이 MongoDB의 강점을 활용하기 어려우므로 테스트용으로만 쓰기를 권합니다.

## 컬렉션 파일과 인덱스 파일 {#collection-and-index}

MongoDB에서는 컬렉션과 인덱스가 논리적으로 구분되지만, WiredTiger는 모두 키-값 저장소로 취급해 컬렉션 파일과 인덱스 파일을 구분 없이 B+tree로 같은 방식으로 관리합니다.

- 컬렉션 파일: key는 WiredTiger가 부여하는 고유 식별자 RecordId(`showRecordId()`로 확인, 파일에서는 여기에 0x80이 더해진 값)이고 value는 BSON 원본 도큐먼트입니다.
- 인덱스 파일: BSON 대신 이진 비교가 가능한 KeyString 직렬화를 씁니다. 필드 순서가 정해져 있어 필드명은 저장하지 않고, 스키마리스라서 같은 필드에도 여러 타입이 올 수 있으므로 타입을 나타내는 Ctype 값을 앞에 둡니다. 숫자 100은 kNumeric(30)+13=43(0x2b)이고, 정수는 왼쪽으로 한 비트 시프트되어 200(0xc8)으로 저장됩니다. 문자열은 kStringLike(60, 0x3c), 객체는 kObject(70, 0x46)로 시작합니다.
- RecordId 인코딩: 처음과 마지막 바이트의 3비트에 두 바이트 사이의 바이트 수 N(0~7)을 저장해 2바이트에서 9바이트까지 길이가 달라지고, 64비트 값을 모두 표현합니다. RecordId 1은 `0008`이고 1024부터는 3바이트(N=1)입니다.
- _id 인덱스: 키는 _id 값, 값은 RecordId입니다. 글쓴이가 MySQL과의 차이로 짚는 부분이 여기입니다. MySQL은 기본 키가 클러스터드 인덱스지만 MongoDB의 _id 인덱스는 보조 인덱스처럼 논클러스터드라서 삽입에 두 번의 쓰기, 조회에 두 번의 읽기가 필요합니다. 이를 아쉬워하는 사용자를 위해 MongoDB 5.3부터는 _id를 클러스터드 인덱스로 두는 클러스터드 컬렉션을 선택할 수 있습니다. 이때 컬렉션 파일은 _id 순서로 도큐먼트를 저장하고, 보조 인덱스는 RecordId 대신 _id 값을 키에 붙이므로 _id 선택에 따라 인덱스가 커질 수 있습니다.
- 보조 인덱스: 해석은 같고, 중복 값이 있을 수 있어 키의 고유성을 보장하려는 목적으로 보이는 RecordId가 키 뒤에 붙습니다.

원문은 이런 세부 내용을 몰라도 MongoDB를 쓰는 데 지장이 없지만, 필수가 아닌 지식도 나중에 도움이 될 수 있다는 말로 글을 맺습니다.

{{% details title="MongoDB와 WiredTiger 버전 대응과 주요 값" closed="true" %}}
| 항목 | 값 |
|---|---|
| MongoDB 3.0.15 / 3.2.20 / 3.4.15 | WiredTiger 2.5.3 / 2.9.2 / 2.9.2 |
| MongoDB 3.6.4 / 4.0.16 / 4.2.1 | WiredTiger 3.0.1 / 3.1.1 / 3.2.2 |
| MongoDB 4.4.0 / 5.0.0 / 6.0.0 | WiredTiger 10.0.0 / 10.0.1 / 10.0.2 |
| MongoDB 7.0.0 / 8.0.0 | WiredTiger 11.2.0 / 11.3.0 |
| 글의 실험 환경 | MongoDB 6.0.11, WiredTiger 10.0.2 |
| 히스토리 스토어 도입 | WiredTiger 10.0.0, MongoDB 4.4부터 WiredTigerLAS.wt 대체 |
| 히스토리 스토어 기본 보관주기(6.0) | 300초 (`minSnapshotHistoryWindowInSeconds`) |
| 클러스터드 컬렉션 지원 | MongoDB 5.3부터 |
| 저널링 활성 파일 | local.oplog.rs 컬렉션 파일(file id 18) |
{{% /details %}}
