---
title: "데이터베이스·스토리지"
description: "우버 엔지니어링 블로그의 데이터베이스·스토리지 글 26편 목록입니다. 2020년 이후 글 14편은 한국어 요약으로, 나머지는 원문 링크로 정리했습니다."
date: 2026-11-10
weight: 6
comments: false
---

# 데이터베이스·스토리지

## 이 분류에서 찾기 {#section-navigation}

- [대규모에서도 굴러가는 MySQL Group Replication 운영 자동화 (2025-12)]({{< relref "/external/uber/database/improving-mysql-cluster-uptime-part2.md" >}})
- [Group Replication으로 설계한 MySQL 클러스터 장애 감지·완화와 합의 구조 (2025-12)]({{< relref "/external/uber/database/improving-mysql-cluster-uptime-part1.md" >}})
- [초당 1억 5천만 읽기를 처리하는 통합 캐시와 더 강한 일관성 (2025-08)]({{< relref "/external/uber/database/how-uber-serves-over-150-million-reads.md" >}})
- [상시 백업과 상시 복구로 만든 우버의 데이터베이스 백업 체계 (2025-05)]({{< relref "/external/uber/database/robust-database-backup-recovery-at-uber.md" >}})
- [2,300개 클러스터를 다루는 우버 MySQL 컨트롤 플레인 (2025-01)]({{< relref "/external/uber/database/mysql-at-uber.md" >}})
- [Odin의 작업 충돌을 막는 전역 조율기 The Accounter (2024-11)]({{< relref "/external/uber/database/the-accounter.md" >}})
- [MySQL 8.0으로 옮긴 우버의 대규모 플릿 업그레이드 (2024-08)]({{< relref "/external/uber/database/upgrading-ubers-mysql-fleet.md" >}})
- [SSTable 공유로 줄인 MyRocks 차등 백업 (2024-08)]({{< relref "/external/uber/database/differential-backups-on-myrocks.md" >}})
- [기술에 구애받지 않는 우버의 상태 저장 플랫폼 Odin (2024-07)]({{< relref "/external/uber/database/odin-stateful-platform.md" >}})
- [무중단으로 전환한 Cassandra의 단일 존 장애 내성 (2024-06)]({{< relref "/external/uber/database/single-zone-failure-tolerance.md" >}})
- [DynamoDB에서 LedgerStore로 옮긴 1조 건의 원장 데이터 (2024-04)]({{< relref "/external/uber/database/migrating-from-dynamodb-to-ledgerstore.md" >}})
- [수조 개의 인덱스를 받치는 LedgerStore 인덱싱 (2024-04)]({{< relref "/external/uber/database/how-ledgerstore-supports-trillions-of-indexes.md" >}})
- [초당 4,000만 읽기를 받아 내는 Docstore 통합 캐시 CacheFront (2024-02)]({{< relref "/external/uber/database/how-uber-serves-over-40-million-reads-per-second-using-an-integrated-cache.md" >}})
- [대규모 Cassandra 운영을 안정시킨 작은 개선들 (2023-07)]({{< relref "/external/uber/database/how-uber-optimized-cassandra-operations-at-scale.md" >}})

MySQL·MyRocks, Cassandra, Schemaless·Docstore, LedgerStore, 통합 캐시, 백업 복구처럼 상태를 저장하는 시스템 운영 글입니다.

## 요약하지 않은 원문 {#original-only}

2019년 이전 글이거나 아직 요약하지 않은 글입니다. 원문 제목 그대로 링크합니다.

- [MySQL to MyRocks Migration in Uber’s Distributed Datastores](https://www.uber.com/us/en/blog/mysql-to-myrocks-migration-in-uber-distributed-datastores/) · 2022-09-01
- [How Uber Migrated Financial Data from DynamoDB to Docstore](https://www.uber.com/us/en/blog/dynamodb-to-docstore-migration/) · 2021-11-10
- [Jellyfish: Cost-Effective Data Tiering for Uber’s Largest Storage System](https://www.uber.com/us/en/blog/jellyfish-cost-effective-data-tiering/) · 2021-09-09
- [Evolving Schemaless into a Distributed SQL Database](https://www.uber.com/us/en/blog/schemaless-sql-database/) · 2021-02-23
- [Herb: Multi-DC Replication Engine for Uber’s Schemaless Datastore](https://www.uber.com/us/en/blog/herb-datacenter-replication/) · 2018-07-25
- [Code Migration in Production: Rewriting the Sharding Layer of Uber’s Schemaless Datastore](https://www.uber.com/us/en/blog/schemaless-rewrite/) · 2018-02-22
- [Dockerizing MySQL at Uber Engineering](https://www.uber.com/us/en/blog/dockerizing-mysql/) · 2016-11-01
- [Why Uber Engineering Switched from Postgres to MySQL](https://www.uber.com/us/en/blog/postgres-to-mysql-migration/) · 2016-07-26
- [Using Triggers On Schemaless, Uber Engineering’s Datastore Using MySQL](https://www.uber.com/us/en/blog/schemaless-part-three-datastore-triggers/) · 2016-01-19
- [The Architecture of Schemaless, Uber Engineering’s Trip Datastore Using MySQL](https://www.uber.com/us/en/blog/schemaless-part-two-architecture/) · 2016-01-15
- [Designing Schemaless, Uber Engineering’s Scalable Datastore Using MySQL](https://www.uber.com/us/en/blog/schemaless-part-one-mysql-datastore/) · 2016-01-12
- [Project Mezzanine: The Great Migration](https://www.uber.com/us/en/blog/mezzanine-codebase-data-migration/) · 2015-07-28
