---
title: "Cloud Composer에서 Kubernetes까지 3년간의 Airflow 운영"
description: "쏘카 데이터 그룹이 2018년부터 Airflow를 Cloud Composer, Docker Compose, GKE 순으로 옮겨 온 과정입니다. 단계마다의 문제와 브랜치별 테스트 환경, 직접 고친 설정을 요약합니다."
date: 2026-11-08
weight: 4
---

# Cloud Composer에서 Kubernetes까지 3년간의 Airflow 운영 (2021-06)

{{< callout type="info" >}}
**원문 정보**
- 원문: [쏘카 데이터 그룹 - Airflow와 함께한 데이터 환경 구축기(feat. Airflow on Kubernetes)](https://tech.socar.kr/data/2021/06/01/data-engineering-with-airflow)
- 매체 · 게시일: 쏘카 기술 블로그 · 2021-06-01
- 저자: 하디 (쏘카 데이터 엔지니어링팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Rundeck을 떠나 Composer로 {#시작과-composer}

2018년 데이터 그룹이 생겼을 때 쏘카 테크 조직은 작업 스케줄링에 Rundeck을 쓰고 있었습니다. 데이터 파이프라인 스케줄링을 고객 대상 서비스 작업과 분리해야 했고, BigQuery와 잘 붙고 워크플로우를 한눈에 보여 주는 도구가 필요했습니다. Rundeck으로는 부족하다고 보고 Apache Airflow를 택했습니다.

초기에는 데이터 엔지니어가 없어 분석가가 직접 파이프라인을 만들었습니다. 구축과 관리가 필요 없는 Google Cloud Composer를 쓴 이유입니다. DAG 파일을 Cloud Storage에 올리기만 하면 됐지만, 원인 모를 에러가 종종 났습니다. Airflow 1.10.3 자체의 버그도 있었고, 오류가 났을 때 로그를 제대로 볼 수 없는 것이 가장 큰 문제였습니다.

## Compute Engine과 Docker Compose에서 드러난 한계 {#docker-compose-시기}

몇 달 뒤 데이터 엔지니어링팀이 생기면서 Airflow를 직접 운영하기로 했습니다. 빠르게 배포하고, 누구나 DAG을 쉽게 쓰고, 운영이 수월해야 한다는 기준이었습니다. puckel/docker-airflow 이미지로 Compute Engine 위에 Webserver, Scheduler, Database, Worker, Redis를 Docker Compose로 띄웠고 Executor는 Celery였습니다. 분석가에게 익숙한 Jupyter Notebook을 같은 환경에 두고 DAG 폴더에 볼륨으로 마운트해, 저장하면 몇 초 안에 Airflow에 반영됐습니다.

간단했지만 조직이 커지며 문제가 네 가지로 나타났습니다.

- DAG이 늘면서 시작 시간이 밀렸고, 해법이 머신 사양을 올리는 것뿐이라 평소에는 자원이 놀았다
- 작성자마다 스타일이 달랐고 on_failure_callback 같은 값이 빠진 DAG이 있었으며, 파일명 규칙과 변경 이력이 없었다
- Airflow 버전이 바뀔 때마다 코드를 고쳐야 했고, 라이브러리는 모든 컨테이너에 설치해야 해서 의존성이 복잡해졌다
- 테스트 때 BigQuery 테이블 이름 끝에 `_test`를 붙이다가 빠뜨리면 운영 테이블을 덮어쓸 수 있었다

## GKE 위의 Airflow {#kubernetes-전환}

2년 사이 데이터 그룹은 7명에서 27명으로, DAG은 600개 넘게 늘었습니다. 위 문제를 풀려고 GKE를 도입하고 Airflow를 1.10.14로 올려 Kubernetes Executor를 썼습니다. Task마다 Worker Pod가 생겼다 사라지므로 노드 오토스케일링과 함께 쓰면 DAG이 늘어도 지연이 없습니다. 의존성이 강한 작업은 KubernetesPodOperator로 컨테이너 이미지째 실행합니다. 이미 성숙한 Cloud Composer와 새로 나온 AWS MWAA도 다시 고려했지만, 팀이 커져 운영할 사람이 있다는 이유로 직접 만든 클러스터를 택했습니다.

운영 환경 구성은 다음과 같습니다.

- 데이터베이스는 Stateful이라 Cloud SQL로 클러스터 밖에 두고 Cloud SQL Proxy를 DaemonSet으로 배포한다
- DAG은 GitHub 저장소의 main 브랜치에 두고 Webserver와 Scheduler의 git-sync가 주기적으로 pull하며, Worker는 처음에만 clone한다
- 로그는 Remote Logging으로 Cloud Storage에 모은다
- 배포는 ArgoCD로 하고, 커뮤니티 Airflow 차트 7.7.0을 고쳐 쓴다

## 브랜치마다 생기는 Airflow {#dag-작성과-테스트-환경}

개발 환경은 별도 GCP 프로젝트에 두고 운영 BigQuery는 읽기만 되게 했습니다. 저장소에 `feature/`로 시작하는 브랜치를 만들면 BuddyWorks 파이프라인이 Bastion Host를 거쳐 ArgoCD 클라이언트로 그 브랜치용 Airflow를 배포합니다. 브랜치를 지우면 앱도 삭제됩니다. 테스트가 끝나면 DB도 지워야 해서 개발 환경은 클러스터 내부 DB를 씁니다.

DAG은 로컬 IDE에서 쓰고 Pull Request를 올립니다. CI는 Black 포매팅을 검사하고, 리뷰 뒤 Squash & Merge합니다. DAG 뼈대는 직접 만든 Boilerplate CLI가 만들어 파일명과 dag_id 규칙을 일정하게 유지합니다. 모니터링은 KubeLens와 Grafana를 쓰고 CI/CD 알림은 슬랙으로 받습니다.

## 직접 고친 코드와 설정 {#airflow-커스터마이징}

Airflow 1.10.14 소스를 받아 일부를 고쳤습니다. Pod 이름에 dag_id와 task_id 사이 구분이 없던 것을 `{dag_id}.{task_id}-hash` 꼴로 바꿨습니다. 기본 weight_rule인 DOWNSTREAM은 뒤쪽 Task의 우선순위를 낮춰 DAG이 늘수록 전체 실행이 길어지므로 ABSOLUTE로 바꿨습니다. 자주 쓰는 라이브러리는 extra-requirements.txt에 적어 이미지 빌드 때 설치합니다.

{{% details title="바꾼 설정값" closed="true" %}}

| 설정 | 기본값 | 변경값 |
|---|---|---|
| AIRFLOW__SCHEDULER__PARSING_PROCESSES | 2 | 8 |
| AIRFLOW__WEBSERVER__PAGE_SIZE | 100 | 50 |
| AIRFLOW__WEBSERVER__WORKER_REFRESH_INTERVAL | 30 | 1800 |
| AIRFLOW__WEBSERVER__WEB_SERVER_WORKER_TIMEOUT | 120 | 300 |
| weight_rule | DOWNSTREAM | ABSOLUTE |

{{% /details %}}

남은 과제로는 Airflow 2.x 업그레이드, DAG별 처리 시간과 지연을 보여 주는 Grafana 고도화, RBAC와 Secret 관리 같은 클러스터 보안을 꼽았습니다. 원문 시점에는 2.1.0 업그레이드를 PoC 중이었습니다.
