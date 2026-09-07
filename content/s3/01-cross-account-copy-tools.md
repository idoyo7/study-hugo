---
title: "S3 계정 간 복사 — aws s3 sync · rclone · rsync"
linkTitle: "01 계정 간 복사 도구"
description: "aws s3 sync는 서버사이드 복사, rclone은 플래그 하나가 빠지면 클라이언트 경유, rsync는 S3 마운트 위에서 델타 전송을 잃습니다. 계정 간 S3 복사에서 세 도구가 갈리는 지점과 Replication으로 넘어갈 기준."
date: 2026-09-07
lastmod: 2026-09-07
weight: 1
---

# 01 · 계정 간 복사 — aws s3 sync · rclone · rsync는 어디서 갈리나

{{< callout type="info" >}}
- rsync는 선택지가 아니다. S3 API를 모르니 FUSE 마운트가 필요하고, 그 위에서는 델타 전송·rename·mtime이 전부 무너진다.
- 소규모 일회성 복사는 `aws s3 sync`. 서버사이드 CopyObject라 데이터가 내 머신을 거치지 않고, 같은 리전이면 요청 요금만 낸다.
- 객체 수십만 개 이상이거나 반복 동기화면 `rclone`. 단 `--server-side-across-configs`가 없으면 에러 없이 다운로드→업로드로 돌아서고, mtime 비교는 객체마다 HEAD를 한 번씩 더 부른다.
- 셋 다 현재 버전만 옮기고 태그·ACL·스토리지 클래스는 도구마다 다르게 잃는다. 버전 이력까지 보존해야 하면 S3 Replication(Batch Replication)으로 간다.
- 계정 간이면 도구와 무관하게 SSE-KMS 키 정책과 Object Ownership 설정이 먼저 걸린다.
{{< /callout >}}

기준일은 2026-09-07입니다. 요금은 버지니아 북부(us-east-1) S3 Standard 기준입니다.

## 1. 한눈에

| 항목 | aws s3 sync | rclone sync | rsync (+ s3fs / Mountpoint) |
|---|---|---|---|
| S3를 직접 아는가 | 예 | 예 | 아니오. FUSE 마운트 필요 |
| 데이터 경로 | 서버사이드 CopyObject. 클라이언트 미경유 | 기본은 서버사이드. 조건이 안 맞으면 조용히 다운로드→업로드로 전환 | 항상 다운로드→업로드 |
| 변경 감지 | 크기 + LastModified. 체크섬 없음 | 크기 + mtime 기본. `--checksum`이면 ETag(MD5) | 크기 + mtime. 마운트 위에서 mtime 불안정 |
| 동시성 | `max_concurrent_requests` 기본 10 | `--transfers` 4, `--checkers` 8 기본. 수백까지 상향 가능 | 단일 스트림 |
| 5 GB 초과 객체 | 멀티파트 카피 자동 | `--s3-copy-cutoff`(약 4.66 GiB) 초과 시 멀티파트 카피 | 통째로 재업로드 |
| 스토리지 클래스 | STANDARD로 바뀜. `--storage-class`로 지정 | 목적지 설정 따름. 원본 클래스는 읽기 전용 | 마운트 설정 따름 |
| 태그·사용자 메타데이터 | 기본값 `--copy-props default`가 둘 다 복사 | 메타데이터는 `--metadata`로 복사. 태그는 미지원 | 둘 다 유실 |
| 버전 이력 | 현재 버전만 | 현재 버전만 | 현재 버전만 |
| Glacier 계층 | 기본 스킵. 복원 전이면 실패 | 복원 전이면 실패 | 마운트 단계에서 실패 |
| 삭제 동기화 | `--delete`, 기본 꺼짐 | `sync`는 기본 삭제, `copy`는 삭제 안 함 | `--delete` |
| 자격 증명 | identity 하나가 양쪽 권한을 모두 가져야 함 | 원본·목적지 remote를 따로 설정 | 마운트마다 따로 |

## 2. aws s3 sync

S3 사이의 `sync`와 `cp`는 CopyObject로 처리됩니다. 원본을 내 머신으로 내려받았다가 다시 올리는 게 아니라, S3가 내부에서 객체를 옮깁니다. 5 GB를 넘는 객체는 UploadPartCopy로 쪼개서 옮기는데 이것도 cli가 알아서 합니다. 그래서 같은 리전 안에서는 전송 요금이 없고 COPY 요청 요금만 나옵니다.

| 항목 | 요금 |
|---|---|
| PUT/COPY 요청 | 1,000건당 $0.005 |
| 리전 간 전송 (버지니아→오하이오) | GB당 $0.01 |
| 인터넷 아웃바운드 | GB당 $0.09 |

### 권한은 한 identity가 양쪽을 다 가져야 한다

`aws s3 sync`는 자격 증명을 하나만 씁니다. 그 identity가 원본을 읽고 목적지에 써야 합니다. AWS가 권장하는 패턴은 원본 버킷 정책에서 목적지 계정의 principal에 `s3:GetObject`와 `s3:ListBucket`을 열어주고, 목적지 계정 자격으로 명령을 실행하는 쪽입니다.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::<목적지-계정-ID>:role/<복사-역할>" },
    "Action": ["s3:GetObject", "s3:ListBucket"],
    "Resource": ["arn:aws:s3:::<원본-버킷>", "arn:aws:s3:::<원본-버킷>/*"]
  }]
}
```

```bash
aws s3 sync s3://<원본-버킷>/ s3://<목적지-버킷>/ --profile <목적지-계정-프로필>
```

반대 방향, 즉 원본 계정 자격으로 목적지에 쓰는 것도 됩니다. 문제는 객체 소유자입니다. 쓴 쪽이 원본 계정이니 목적지 버킷 주인이 자기 버킷 안의 객체를 못 읽는 상황이 생겼고, 그래서 예전엔 `--acl bucket-owner-full-control`을 붙였습니다. 2023년 4월 이후 새 버킷의 기본값인 Object Ownership "Bucket owner enforced"는 ACL을 아예 끕니다. 이 설정에서는 ACL을 지정하는 요청이 `AccessControlListNotSupported`로 거부되고, 객체 소유권은 무조건 버킷 소유자에게 갑니다. 그러니 최근에 만든 버킷이면 `--acl`을 붙이지 말고 버킷 정책만 챙기면 됩니다.

### 변경 감지는 크기와 시각뿐이다

`sync`는 목적지에 같은 키가 없거나, 크기가 다르거나, 원본의 LastModified가 더 새로우면 복사합니다. 체크섬은 보지 않습니다. `--size-only`를 주면 크기만 봅니다. 그리고 실행 전에 양쪽 버킷을 끝까지 리스팅해 메모리에 올리므로, 객체가 수백만 개면 복사가 시작되기도 전에 한참 기다립니다. 동시성은 `~/.aws/config`에서 올릴 수 있습니다.

```ini
[profile <목적지-계정-프로필>]
s3 =
  max_concurrent_requests = 100
  max_queue_size = 10000
```

기본값은 각각 10과 1000입니다.

### 무엇을 잃는가

- 스토리지 클래스는 STANDARD로 바뀐다. 원본이 Intelligent-Tiering이든 IA든 `--storage-class`를 안 주면 STANDARD로 떨어진다.
- Glacier 계층 객체는 기본으로 건너뛴다. `--force-glacier-transfer`를 줘도 복원 전이면 실패한다.
- ACL은 옮기지 않는다. `--acl`로 목적지에서 새로 지정하는 것뿐이다.
- 버전 이력은 없다. 현재 버전만 본다.
- 태그와 사용자 메타데이터는 기본값 `--copy-props default`가 같이 복사한다. `--copy-props none`이면 둘 다 버린다.

## 3. rclone

rclone은 remote를 계정마다 따로 둡니다. 자격 증명이 두 벌이니 aws cli처럼 한 identity에 양쪽 권한을 몰아줄 필요가 없어 보입니다. 그런데 서버사이드 복사를 쓰려면 결국 같은 조건이 됩니다.

```ini
# ~/.config/rclone/rclone.conf
[src]
type = s3
provider = AWS
env_auth = true
region = ap-northeast-2

[dst]
type = s3
provider = AWS
env_auth = true
region = ap-northeast-2
```

```bash
rclone sync src:<원본-버킷> dst:<목적지-버킷> \
  --server-side-across-configs \
  --checksum --fast-list \
  --transfers 64 --checkers 128 \
  -vv --dry-run
```

### 서버사이드 복사는 플래그를 줘야 켜진다

rclone은 원본과 목적지가 같은 remote일 때만 서버사이드 복사를 기본으로 씁니다. remote 이름이 다르면 두 설정 사이에 서버사이드 연산이 통할지 rclone이 판단할 수 없다는 이유로 꺼 둡니다. `--server-side-across-configs`를 주면 시도합니다. 이때 CopyObject 요청은 목적지 remote의 자격으로 나갑니다. 그래서 목적지 자격이 원본 버킷을 읽을 수 있어야 하고, 결국 위의 버킷 정책이 똑같이 필요합니다.

이 조건이 안 맞으면 rclone은 멈추지 않습니다. 다운로드→업로드로 넘어가서 그냥 끝까지 갑니다. 대역폭도 쓰고 전송 요금도 냅니다. `-vv` 로그에서 객체마다 `Copied (server-side copy)`가 찍히는지 봐야 합니다. `Copied (new)`로 나오면 클라이언트를 거친 겁니다.

### mtime 비교는 HEAD를 한 번씩 더 부른다

S3에는 파일 수정 시각이란 개념이 없습니다. rclone은 이걸 `X-Amz-Meta-Mtime` 사용자 메타데이터에 넣어 흉내냅니다. 문제는 리스팅 응답에 사용자 메타데이터가 안 들어온다는 점입니다. mtime으로 비교하려면 객체마다 HEAD 요청을 한 번씩 더 보내야 하고, 객체가 백만 개면 HEAD도 백만 번입니다.

대안이 셋 있습니다.

- `--checksum`: ETag를 MD5로 쓴다. 리스팅에 들어오니 HEAD가 없다. 멀티파트로 올린 객체나 SSE-KMS 객체는 ETag가 MD5가 아니라서 rclone이 `X-Amz-Meta-Md5chksum`을 따로 본다.
- `--size-only`: 크기만 본다. 가장 빠르고 가장 거칠다.
- `--use-server-modtime`: S3의 LastModified를 mtime으로 쓴다. aws cli와 같은 기준이 된다.

`--fast-list`는 리스팅을 재귀 한 번으로 끝내 요청 수를 줄이는 대신 메모리를 더 씁니다.

### 나머지

- `--s3-copy-cutoff`(기본 4.656 GiB)를 넘는 객체는 멀티파트 카피로 간다.
- 목적지가 SSE-KMS면 `--s3-server-side-encryption aws:kms`와 `--s3-sse-kms-key-id <키-ARN>`을 준다.
- `--s3-acl`은 서버사이드 복사 때도 새로 적용된다. rclone 문서가 "S3는 원본 ACL을 복사하지 않는다"고 명시한다.
- `--metadata`를 주면 Content-Type·Cache-Control·mtime 같은 문서화된 메타데이터를 보존한다. 스토리지 클래스는 읽기 전용이고 태그는 S3 백엔드 메타데이터 체계에 없다.
- `--s3-versions`는 과거 버전을 리스팅에 보여줄 뿐 쓰기에는 못 쓴다.
- `--s3-no-check-bucket`을 주면 버킷 존재 확인·생성 시도를 건너뛴다. 목적지에 `s3:CreateBucket`이 없을 때 필요하다.

필터·`--dry-run`·재시도·진행률은 aws cli보다 훨씬 낫습니다. 같은 동기화를 반복 돌리는 자리라면 이쪽이 편합니다.

## 4. rsync

rsync는 S3 API를 모릅니다. 쓰려면 s3fs나 Mountpoint for Amazon S3로 양쪽 버킷을 로컬 경로에 마운트해야 합니다. 그 순간 rsync의 장점이 전부 사라집니다.

- 델타 전송이 무의미하다. S3는 객체 일부만 고칠 수 없다. 1 GB 파일에서 1 KB가 바뀌어도 1 GB를 다시 올린다. rsync가 차분을 계산해 봐야 마운트 계층이 전체를 다시 쓴다.
- 모든 바이트가 내 머신을 통과한다. 원본 마운트에서 읽고 목적지 마운트로 쓴다. 서버사이드 복사가 없다.
- Mountpoint는 rename을 거부한다. rsync는 임시 파일에 쓴 뒤 rename하는 게 기본 동작인데 Mountpoint는 S3 Express One Zone에서만 rename을 지원한다. `--inplace`를 줘야 하고, 그러면 파일 중간으로 seek해서 쓰는 요청이 나갈 수 있는데 Mountpoint는 순차 쓰기만 받는다.
- mtime이 흔들린다. Mountpoint는 객체의 Last-Modified를 mtime으로 보여줄 뿐 설정을 못 받는다. rsync의 변경 감지가 매번 "다르다"로 나온다. s3fs는 `x-amz-meta-mtime`에 저장해 흉내내지만 그 메타데이터를 모르는 다른 도구가 객체를 건드리면 깨진다.

기존 rsync 스크립트가 있어서 억지로 재사용하는 경우가 아니면 쓸 이유가 없습니다.

## 5. 도구와 무관하게 걸리는 것

### SSE-KMS

원본이 고객 관리형 KMS 키로 암호화돼 있으면 복사하는 identity에 원본 키의 `kms:Decrypt`가, 목적지 키의 `kms:GenerateDataKey`와 `kms:Encrypt`가 필요합니다. 키가 다른 계정에 있으면 키 정책에서 그 계정을 허용해야 합니다. AWS 관리형 키(`aws/s3`)는 키 정책을 못 고치니 계정 간 공유가 안 됩니다. 원본이 `aws/s3`로 암호화돼 있으면 원본 계정 자격으로 읽어서 옮기는 방향밖에 없습니다.

### 리전

리전이 다르면 어느 도구든 리전 간 전송 요금이 붙습니다. 서버사이드 복사여도 마찬가지입니다.

### 버전

셋 다 현재 버전만 옮깁니다. 삭제 마커 뒤에 숨은 과거 버전은 어느 도구로도 못 가져옵니다.

## 6. 규모가 커지면

| 방법 | 맞는 자리 | 한계 |
|---|---|---|
| S3 Batch Operations Copy | 인벤토리 기반 수억 객체. 메타데이터·스토리지 클래스 지정 가능 | 객체당 5 GB 상한. 작업을 목적지 리전에서 만들어야 함 |
| S3 Replication + Batch Replication | 버전·메타데이터·태그를 보존하며 기존 객체까지 옮길 때 | 양쪽 버저닝 필수. 계정 간이면 양쪽 버킷 정책과 KMS 키 정책을 다 열어야 함 |
| AWS DataSync | 계정 간·리전 간 S3→S3를 관리형으로 돌릴 때 | 원본 계정에 IAM 역할, 목적지 버킷 정책 필요 |
| s5cmd | cli 계열에서 처리량만 원할 때 | 서버사이드 복사 여부·권한 모델은 aws cli와 같음 |

한 번 옮기고 끝이면 `aws s3 sync`, 반복이면 `rclone`, 버전 이력이 걸리면 Replication입니다. 객체가 억 단위면 Batch Operations가 리스팅 시간 자체를 없애 줍니다.

## 참고 자료

**aws cli**
- [`aws s3 sync` reference](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html) — 변경 감지 기준, `--size-only`, `--exact-timestamps`, `--copy-props`, `--force-glacier-transfer`, `--storage-class`
- [S3 CLI configuration](https://docs.aws.amazon.com/cli/latest/topic/s3-config.html) — `max_concurrent_requests` 10, `max_queue_size` 1000, `multipart_threshold`·`multipart_chunksize` 8 MB
- [CopyObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html) — 단일 요청 5 GB 상한, 초과분은 UploadPartCopy

**계정 간 권한**
- [Copy data from an S3 bucket to another account and Region by using the AWS CLI](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/copy-data-from-an-s3-bucket-to-another-account-and-region-by-using-the-aws-cli.html) · [re:Post — copy S3 objects across accounts](https://repost.aws/knowledge-center/copy-s3-objects-account)
- [re:Post — bucket-owner-full-control ACL](https://repost.aws/knowledge-center/s3-bucket-owner-full-control-acl)
- [Controlling ownership of objects (Object Ownership)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html) — Bucket owner enforced에서 ACL 요청이 `AccessControlListNotSupported`로 거부됨
- [Replicating objects encrypted with SSE-KMS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-config-for-kms-objects.html) — 원본 `kms:Decrypt`, 목적지 `kms:Encrypt`/`GenerateDataKey`, AWS 관리형 키는 계정 간 불가

**rclone**
- [S3 backend](https://rclone.org/s3/) — `X-Amz-Meta-Mtime`, `--s3-copy-cutoff`, `--s3-versions`, `--s3-acl`이 서버사이드 복사에도 새로 적용됨, 메타데이터 표(스토리지 클래스 읽기 전용)
- [Global flags](https://rclone.org/docs/) — `--server-side-across-configs`("isn't enabled by default because it isn't easy for rclone to tell if it will work between any two configurations"), `--checksum`, `--size-only`, `--use-server-modtime`, `--fast-list`, `--transfers` 4, `--checkers` 8
- 소스 [`fs/features.go`](https://github.com/rclone/rclone/blob/master/fs/features.go) · [`backend/s3/s3.go`](https://github.com/rclone/rclone/blob/master/backend/s3/s3.go) — S3 백엔드가 `ServerSideAcrossConfigs`를 켜지 않음
- 이슈 [#4696](https://github.com/rclone/rclone/issues/4696) — 서버사이드 불가 시 다운로드→업로드로 넘어가는 설계

**rsync + 마운트**
- [Mountpoint for Amazon S3 — Semantics](https://github.com/awslabs/mountpoint-s3/blob/main/doc/SEMANTICS.md) — 순차 쓰기만 허용, rename은 S3 Express One Zone에서만, mtime은 Last-Modified
- [s3fs-fuse](https://github.com/s3fs-fuse/s3fs-fuse) · 이슈 [#299](https://github.com/s3fs-fuse/s3fs-fuse/issues/299) · [#897](https://github.com/s3fs-fuse/s3fs-fuse/issues/897) — `x-amz-meta-mtime`, 부분 쓰기 시 전체 객체 재작성

**요금·대안**
- [S3 pricing](https://aws.amazon.com/s3/pricing/) — PUT/COPY 1,000건당 $0.005, 리전 간 $0.01/GB(버지니아→오하이오), 인터넷 아웃바운드 $0.09/GB
- [S3 Batch Operations — Copy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops-copy-object.html) · [Replication](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html) · [Cross-account replication walkthrough](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-walkthrough-2.html) · [DataSync S3→S3 cross-account](https://docs.aws.amazon.com/datasync/latest/userguide/tutorial_s3-s3-cross-account-transfer.html) · [s5cmd](https://github.com/peak/s5cmd)
