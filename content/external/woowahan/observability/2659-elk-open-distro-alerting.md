---
title: "실행 누락까지 살피는 ELK와 Open Distro 배치 알람"
description: "배치가 아예 실행되지 않으면 에러 로그를 찾는 알람으로는 알아챌 수 없습니다. ELK와 Open Distro Alerting으로 완료 로그의 유무까지 확인해 Slack 알람을 보냅니다."
date: 2026-11-14
weight: 5
---

# 실행 누락까지 살피는 ELK와 Open Distro 배치 알람 (2020-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [ELK 셋팅부터 알람까지](https://techblog.woowahan.com/2659/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2020-01-16
- 저자: 이중석 (상품시스템팀 개발)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 매번 확인하기에는 너무 많은 배치 {#background}

실패 알람을 설정해도 놓치는 배치가 있습니다. 어떤 이유로든 배치가 아예 실행되지 않았다면, 실행 중 에러를 감시하는 알람으로는 알아챌 수 없습니다. 완료 로그가 남았는지도 확인해야 하는 이유입니다.

상품시스템팀에는 광고 데이터 생성, 결제 데이터 생성, 결제 시도처럼 매일 정해진 시간에 돌아야 하는 배치가 많습니다. 매번 정상 수행 여부를 확인하기는 어렵습니다. 팀은 로그엔트리를 ELK로 옮기면서 에러 로그가 생겼을 때뿐 아니라, 배치가 끝나야 할 시각이 지난 뒤에도 완료 로그가 없을 때 알람을 받도록 설정했습니다.

## 최근 2분의 에러를 찾는 Monitor {#batch-failure-alert}

Open Distro Alerting에서 Monitor는 로그를 조회하고, Trigger는 조회 결과를 보고 알람을 보낼지 판단합니다. 메시지를 보낼 곳은 Destination입니다. 배치 실행 중 Exception이 발생하면 Slack으로 알리도록, 이름과 타입, Slack webhook URL을 입력해 Destination을 만듭니다.

Monitor에서는 `Define using extraction query`를 선택한 뒤 로그 인덱스와 쿼리를 지정합니다. 예제에서 찾는 대상은 최근 2분 안에 들어온 `ERROR` 로그입니다. 화면의 `RUN` 버튼으로 조회 결과를 확인한 뒤, Monitor Schedule을 `By interval`로 설정해 1분마다 조회합니다. 실행 주기는 `Daily`, `Weekly`, `Monthly`, `Custom Cron Expression`으로도 지정할 수 있습니다.

에러가 하나라도 있으면 알립니다. Trigger 조건은 기본값인 `ctx.results[0].hits.total.value > 0`을 그대로 씁니다. `Configure Action`에서 앞서 만든 Destination을 고르고 `Send test Message`로 Slack 수신을 확인합니다. 설정을 마친 뒤에는 배치에서 Exception을 발생시켜 실제 알람이 오는지도 시험합니다.

## 배치 종료 시각 뒤에 찾는 완료 로그 {#batch-not-run-alert}

미실행 알람은 조회 결과가 없을 때 울려야 합니다. 이를 위해 배치가 끝나면 “테스트 배치 완료!”라는 로그를 남기도록 코드를 추가하고, Monitor에서 최근 1시간 안에 이 메시지가 있는지 찾습니다.

조회 시점도 달라집니다. 에러를 주기적으로 찾는 대신 배치가 끝날 예정인 시각보다 뒤에 Monitor를 실행하도록 cron 표현식을 지정합니다. 저자의 예제에서는 7시 20분입니다. Trigger 조건을 `ctx.results[0].hits.total.value < 1`로 바꾸면 완료 로그가 조회되지 않을 때 알람이 갑니다. Destination과 나머지 설정은 에러 알람과 같습니다.

## 로컬에서 알람을 시험할 ELK {#local-elk}

알람이 조회할 로그를 쌓으려면 수집 환경부터 준비해야 합니다. 로컬 예제는 GitHub의 docker-elk 프로젝트를 받아 Docker Compose로 실행하는 구성입니다. `logstash.conf`에서 TCP 5000번 포트로 json_lines 입력을 받아 Elasticsearch에 색인하도록 설정한 뒤 `docker-compose up`으로 띄웁니다.

로그는 Spring Batch로 만듭니다. Spring Initializr에서 Spring Batch, Lombok, H2 Database를 추가하고, Tasklet이 “Hello Job Batch Log” info 로그를 100번 출력하도록 작성합니다. 전송에는 `logstash-logback-encoder`의 TCP appender인 `LogstashTcpSocketAppender`를 사용합니다. `logback.xml`에 콘솔과 stash appender를 등록하고 목적지를 127.0.0.1:5000으로 지정하면 Logstash에 직접 로그를 보냅니다. `application.yml`에서는 이 `logback.xml`을 사용하도록 설정합니다.

### Elasticsearch 7.3.2에 맞춘 Open Distro

로그를 모은 다음에는 Alerting 플러그인이 필요합니다. Elasticsearch Dockerfile에는 `opendistro-alerting` 1.3.0.1을, Kibana Dockerfile에는 Kibana용 `opendistro-alerting` 1.3.0.0을 설치하도록 추가합니다. 원문 작성 당시 최신판인 1.3.0.1이 지원하는 Elasticsearch 버전은 7.3.2였습니다. 이에 맞춰 `.env`의 `ELK_VERSION`도 7.3.2로 지정합니다.

원문의 구성에서는 X-PACK 설정도 바꿔야 합니다. `elasticsearch.yml`의 `xpack.security.enabled`와 `xpack.monitoring.collection.enabled`를 false로 바꾸지 않으면 Alerting을 사용할 때 인증 관련 에러가 납니다. 설정을 마치면 이미지를 다시 빌드하고, 이전 버전에서 사용하던 elasticsearch volume을 지운 뒤 컨테이너를 실행합니다.

Open Distro 설치 후 Kibana가 `caniuse-lite is outdated` 로그를 남기며 정상 실행되지 않는 경우에는 메모리 용량을 늘려 다시 실행합니다. 원문에서는 `docker-compose.yml`의 Kibana 환경 변수에 `NODE_OPTIONS: "--max-old-space-size=2048"`을 추가했습니다. Kibana 왼쪽 메뉴에 Alerting 항목이 보이면 설치 완료입니다.

## Slack에서 바로 여는 Kibana Discover {#links}

알람을 받은 뒤 에러 로그까지 바로 열 수 있도록 Slack 메시지에 링크를 붙입니다. Kibana Discover에서 `level:ERROR` 필터와 최근 2분 범위로 조회한 URL을 복사하고, 에러 Monitor의 Trigger Message에 `- Link: <URL|로그보러 가기>` 형태로 넣습니다. 메시지의 링크를 누르면 해당 조회 화면으로 이동합니다.

조회 조건을 더하다 보면 URL이 길어져 설정을 다루기 불편해집니다. 이때 Discover의 `save` 버튼으로 조회 조건을 저장하면 주소가 `.../discover/<저장된 id>` 형태로 짧아집니다. 저장한 조건은 `Open`에서 다시 불러올 수 있어 자주 쓰는 조회에도 유용합니다.

저자는 더 나은 사용법을 알게 되면 글에 추가하겠다고 덧붙였습니다.

{{% details title="예제에 사용한 설정값과 버전" closed="true" %}}

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
