---
title: "S3"
description: "S3 데이터를 다른 계정으로 옮길 때 aws s3 sync, rclone, rsync가 각각 어디까지 해 주고 어디서 멈추는지를 정리합니다."
date: 2026-09-07
lastmod: 2026-09-07
weight: 170
cascade:
  type: docs
comments: false
---

# S3

버킷 사이에서 데이터를 옮기는 일은 자주 있는데도 매번 도구 선택에서 멈칫하게 됩니다. 손에 익은 rsync를 쓰고 싶고, 어디선가 rclone이 빠르다는 얘기를 들었고, aws cli에도 sync가 있습니다. 이 챕터는 그 세 도구가 계정 간 복사에서 실제로 무엇을 하는지, 그리고 규모가 커지면 어디로 넘어가야 하는지를 다룹니다.

## 문서 지도

| 문서 | 다루는 것 |
|---|---|
| [01 계정 간 복사: aws s3 sync · rclone · rsync]({{< relref "01-cross-account-copy-tools.md" >}}) | 세 도구의 데이터 경로·변경 감지·권한 모델 차이, rclone이 서버사이드 복사를 조용히 포기하는 조건, rsync가 S3 마운트 위에서 잃는 것, 그리고 Batch Operations·Replication으로 넘어가는 기준 |
