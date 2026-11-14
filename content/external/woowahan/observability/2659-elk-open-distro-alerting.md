---
title: "ELK와 Open Distro로 구성하는 배치 알람"
description: "로컬 Docker로 ELK를 띄우고 Spring Batch 로그를 보내 Open Distro Alerting으로 배치 실패와 미실행 알람을 Slack으로 받는 과정을 정리했습니다. 알람 링크를 짧게 만드는 팁도 담았습니다."
date: 2026-11-14
weight: 5
---

# ELK와 Open Distro로 구성하는 배치 알람 (2020-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [ELK 셋팅부터 알람까지](https://techblog.woowahan.com/2659/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2020-01-16
- 저자: 이중석 (상품시스템팀 개발)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 글의 배경 {#background}

상품시스템팀은 로그 엔트리를 ELK로 옮기고 필요한 알람을 설정하는 작업을 했습니다. 알람 설정이 어렵지는 않았지만 쉽지도 않았고, 그 과정에서 알게 된 것을 정리한 글입니다. 로컬에서 ELK를 띄우고 Spring Batch 로그를 쌓는 데까지가 앞부분, 팀에서 쓰는 알람 설정이 뒷부분입니다.

## 로컬 ELK와 배치 로그 전송 {#local-elk}

ELK는 Docker Compose로 실행하며, GitHub의 docker-elk 프로젝트를 받아 씁니다. `logstash.conf`는 TCP 5000번 포트에서 json_lines 코덱으로 입력을 받아 Elasticsearch에 색인하도록 수정하고 `docker-compose up`으로 띄웁니다.

로그를 만들고 보낼 배치는 Spring Initializr로 Spring Batch, Lombok, H2를 넣어 만듭니다. 원문의 배치는 "Hello Job Batch Log" info 로그를 100번 찍는 단순한 Tasklet입니다. 로그는 `logstash-logback-encoder`의 TCP appender(`LogstashTcpSocketAppender`)로 127.0.0.1:5000의 Logstash에 직접 보내며, `logback.xml`에 콘솔과 stash appender를 등록하고 `application.yml`에서 이 설정을 가리킵니다.

## Open Distro Alerting 설치 {#open-distro}

알람은 Open Distro의 Alerting 기능으로 구성합니다. 순서는 이렇습니다.

- Elasticsearch Dockerfile에 `opendistro-alerting` 플러그인(1.3.0.1)을 설치하고, Kibana Dockerfile에는 Kibana용 `opendistro-alerting` 플러그인(1.3.0.0)을 설치합니다.
- Alerting 플러그인 최신판(1.3.0.1)이 지원하는 Elasticsearch 버전이 7.3.2라서 `.env`의 `ELK_VERSION`을 7.3.2로 맞춥니다.
- `elasticsearch.yml`에서 `xpack.security.enabled`와 `xpack.monitoring.collection.enabled`를 false로 바꿉니다. 그렇지 않으면 Alerting을 쓸 때 인증 관련 에러가 납니다.
- 이미지를 다시 빌드하고 이전 버전이 쓰던 elasticsearch volume을 지운 뒤 컨테이너를 띄웁니다.
- Kibana가 `caniuse-lite is outdated` 로그만 남기며 정상 기동하지 않으면 `NODE_OPTIONS`로 메모리 용량을 늘려 다시 실행합니다.

Kibana 왼쪽 메뉴에 Alerting 항목이 보이면 성공입니다.

## 배치 실패 알람 {#batch-failure-alert}

상품시스템팀에는 광고 데이터 생성, 결제 데이터 생성, 결제 시도처럼 매일 정해진 시간에 돌아야 하는 배치가 많습니다. 매번 정상 수행을 확인하기 힘들어 알람을 걸었습니다. 알람은 Destination, Monitor, Trigger 세 가지를 설정합니다.

먼저 Destination으로 이름, 타입, Slack webhook URL을 넣어 Slack 채널을 만듭니다. Monitor는 Define using extraction query로 로그 인덱스를 고르고 쿼리를 적습니다. 필자는 현재 시각부터 2분 이내에 들어온 Log Level이 ERROR인 로그를 조회하게 했고, Monitor Schedule은 By interval로 1분마다 돌립니다. Daily, Weekly, Monthly, Custom Cron Expression도 쓸 수 있습니다. Trigger 조건은 기본값 `ctx.results[0].hits.total.value > 0`을 그대로 써서 에러 로그가 하나라도 있으면 알람이 갑니다. Configure Action에서는 만든 Destination을 고르고 `Send test Message`로 Slack에 메시지가 오는지 확인합니다.

## 배치 미실행 알람 {#batch-not-run-alert}

실패 알람만으로는 배치가 아예 실행되지 않은 경우를 알 수 없습니다. 그래서 배치가 끝나면 "테스트 배치 완료!"라는 로그를 남기게 하고, Monitor 쿼리로 최근 1시간 안에 이 메시지가 있는지 찾습니다. Monitor Schedule은 배치가 끝나는 시각보다 뒤의 시각을 cron 표현식으로 정하며 필자는 7시 20분으로 했습니다. Trigger 조건은 `ctx.results[0].hits.total.value < 1`로 바꿔 조회되지 않으면 알람이 가게 하고, 나머지는 에러 알람과 같습니다.

## 링크 추가와 길이 줄이기 {#links}

Slack 메시지에 에러 로그를 바로 볼 수 있는 링크를 넣으면 편합니다. Kibana Discover에서 `level:ERROR` 필터와 최근 2분 범위로 조회한 URL을 복사해, 에러 Monitor의 Trigger Message에 `- Link: <URL|로그보러 가기>` 형태로 붙입니다.

조건이 조금만 늘어도 링크가 아주 길어지는데, Discover에서 조회 조건을 저장하면 `.../discover/<저장된 id>` 형태로 짧아집니다. 자주 보는 조건을 저장해 두고 조회하는 데도 유용합니다. 필자는 더 나은 사용법을 알게 되면 글을 보태겠다고 맺습니다.

{{% details title="설정값과 버전" closed="true" %}}

| 항목 | 값 |
|---|---|
| ELK 버전 | 7.3.2 |
| Open Distro Alerting (Elasticsearch 플러그인) | 1.3.0.1 |
| Open Distro Alerting (Kibana 플러그인) | 1.3.0.0 |
| logstash-logback-encoder | 6.3 |
| Logstash 입력 포트 | TCP 5000 (json_lines) |
| Kibana NODE_OPTIONS | `--max-old-space-size=2048` |
| 에러 Monitor 조회 범위 / 주기 | 최근 2분, 1분 간격 |
| 에러 Trigger 조건 | `ctx.results[0].hits.total.value > 0` |
| 미실행 Monitor 조회 범위 | 최근 1시간 |
| 미실행 Trigger 조건 | `ctx.results[0].hits.total.value < 1` |
| 미실행 Monitor 실행 시각 예 | 7시 20분 (cron) |

{{% /details %}}
