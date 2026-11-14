---
title: "데이터베이스·스토리지"
description: "우버 엔지니어링 블로그의 데이터베이스·스토리지 글 25편 목록입니다. 2020년 이후 글 18편은 한국어 요약으로, 나머지는 원문 링크로 정리했습니다."
date: 2026-11-10
weight: 6
comments: false
---

# 데이터베이스·스토리지

## 이 분류에서 찾기 {#section-navigation}

- [장애마다 사람을 부르지 않는 MySQL Group Replication (2025-12)]({{< relref "/external/uber/database/improving-mysql-cluster-uptime-part2.md" >}})
- [장애 복구를 그룹 안으로 옮긴 MySQL Group Replication (2025-12)]({{< relref "/external/uber/database/improving-mysql-cluster-uptime-part1.md" >}})
- [더 긴 TTL을 위해 바꾼 CacheFront의 쓰기 경로 (2025-08)]({{< relref "/external/uber/database/how-uber-serves-over-150-million-reads.md" >}})
- [복구 시험까지 자동화한 Uber의 약 100PB 백업 체계 (2025-05)]({{< relref "/external/uber/database/robust-database-backup-recovery-at-uber.md" >}})
- [99.99% 가용성을 향해 다시 짠 우버 MySQL 컨트롤 플레인 (2025-01)]({{< relref "/external/uber/database/mysql-at-uber.md" >}})
- [Odin의 복구 작업을 조율하는 문지기 The Accounter (2024-11)]({{< relref "/external/uber/database/the-accounter.md" >}})
- [MySQL 8.0 승격 전까지 되돌릴 길을 남긴 우버 (2024-08)]({{< relref "/external/uber/database/upgrading-ubers-mysql-fleet.md" >}})
- [백업마다 쌓이던 중복을 줄인 MyRocks의 SSTable 풀 (2024-08)]({{< relref "/external/uber/database/differential-backups-on-myrocks.md" >}})
- [10만 대 넘는 호스트를 맡은 우버의 상태 저장 플랫폼 Odin (2024-07)]({{< relref "/external/uber/database/odin-stateful-platform.md" >}})
- [존 하나가 멈춰도 버티는 Cassandra의 새 ring (2024-06)]({{< relref "/external/uber/database/single-zone-failure-tolerance.md" >}})
- [DynamoDB에서 LedgerStore까지 1조 건의 무중단 이전 (2024-04)]({{< relref "/external/uber/database/migrating-from-dynamodb-to-ledgerstore.md" >}})
- [수조 개의 인덱스를 다시 설계한 LedgerStore의 선택 (2024-04)]({{< relref "/external/uber/database/how-ledgerstore-supports-trillions-of-indexes.md" >}})
- [Docstore의 읽기 확장을 바꾼 통합 캐시 CacheFront (2024-02)]({{< relref "/external/uber/database/how-uber-serves-over-40-million-reads-per-second-using-an-integrated-cache.md" >}})
- [멈춘 자동화를 되살린 Uber Cassandra의 작은 수정 (2023-07)]({{< relref "/external/uber/database/how-uber-optimized-cassandra-operations-at-scale.md" >}})
- [MySQL에서 MyRocks로 옮겨 간 Schemaless·Docstore (2022-09)]({{< relref "/external/uber/database/mysql-to-myrocks-migration-in-uber-distributed-datastores.md" >}})
- [DynamoDB를 떠난 LedgerStore의 새 백엔드 Docstore (2021-11)]({{< relref "/external/uber/database/dynamodb-to-docstore-migration.md" >}})
- [같은 티어에서 Schemaless의 비용을 줄인 Jellyfish (2021-09)]({{< relref "/external/uber/database/jellyfish-cost-effective-data-tiering.md" >}})
- [Schemaless의 제약에서 출발한 분산 SQL Docstore (2021-02)]({{< relref "/external/uber/database/schemaless-sql-database.md" >}})

MySQL·MyRocks, Cassandra, Schemaless·Docstore, LedgerStore, 통합 캐시, 백업 복구처럼 상태를 저장하는 시스템 운영 글입니다.

## 요약하지 않은 원문 {#original-only}

2019년 이전 글이거나 아직 요약하지 않은 글입니다. 원문 제목 그대로 링크합니다.

- [Herb: Multi-DC Replication Engine for Uber’s Schemaless Datastore](https://www.uber.com/us/en/blog/herb-datacenter-replication/) · 2018-07-25
- [Code Migration in Production: Rewriting the Sharding Layer of Uber’s Schemaless Datastore](https://www.uber.com/us/en/blog/schemaless-rewrite/) · 2018-02-22
- [Why Uber Engineering Switched from Postgres to MySQL](https://www.uber.com/us/en/blog/postgres-to-mysql-migration/) · 2016-07-26
- [Using Triggers On Schemaless, Uber Engineering’s Datastore Using MySQL](https://www.uber.com/us/en/blog/schemaless-part-three-datastore-triggers/) · 2016-01-19
- [The Architecture of Schemaless, Uber Engineering’s Trip Datastore Using MySQL](https://www.uber.com/us/en/blog/schemaless-part-two-architecture/) · 2016-01-15
- [Designing Schemaless, Uber Engineering’s Scalable Datastore Using MySQL](https://www.uber.com/us/en/blog/schemaless-part-one-mysql-datastore/) · 2016-01-12
- [Project Mezzanine: The Great Migration](https://www.uber.com/us/en/blog/mezzanine-codebase-data-migration/) · 2015-07-28
