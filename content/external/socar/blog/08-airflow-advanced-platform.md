---
title: "전사 구성원이 쓰는 Airflow 플랫폼의 고도화"
description: "쏘카 데이터 플랫폼 팀이 데이터 비즈니스 본부 전원이 쓰는 Airflow를 운영하며 겪은 문제와 개선 내용입니다. 로컬 개발 환경, Airflow 2 이전, 보안, 담당자 알림 모니터링을 요약합니다."
date: 2026-11-08
weight: 8
---

# 전사 구성원이 쓰는 Airflow 플랫폼의 고도화 (2022-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [전사 구성원들이 사용하는 배치 데이터 플랫폼 만들기 - Airflow Advanced](https://tech.socar.kr/data/2022/11/09/advanced-airflow-for-databiz)
- 매체 · 게시일: 쏘카 기술 블로그 · 2022-11-09
- 저자: 그랩 (데이터 플랫폼 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 사용자가 늘면서 드러난 다섯 가지 문제 {#문제}

쏘카의 Airflow는 GKE에서 돌고, 개발 환경은 운영과 분리되어 있습니다. 예전에는 브랜치를 만들면 CI/CD가 개발 클러스터에 브랜치별 Airflow를 띄웠고, 사용자는 커밋을 푸시해 Git Sync로 DAG를 반영했습니다. 데이터 분석가와 사이언티스트까지 쓰게 되자 다음 문제가 나왔습니다.

- 브랜치가 남아 있으면 유휴 Airflow가 노드 자원을 차지하고, 커뮤니티 Helm Chart에서는 원인 모를 에러가 간헐적으로 났습니다.
- Git Sync는 푸시마다 1분 넘게 걸려 피드백이 느렸고, 커밋 이력도 불필요하게 길어졌습니다.
- Airflow 1은 DAG가 수백 개로 늘며 파싱이 느려졌습니다. 노드를 키워도 크게 나아지지 않았습니다.
- API Key나 Secret이 코드에 하드코딩됐고, 팀 공용 계정이라 누가 Connection을 지웠는지 추적하기 어려웠습니다.
- 실패 알림은 슬랙 채널 하나뿐이어서 담당자를 찾는 데 시간이 걸렸습니다.

## 로컬 Docker Compose 개발 환경 {#로컬-개발-환경}

개발 환경을 노트북으로 옮겨 Docker Compose로 띄웠습니다. 서버 기동은 5분에서 1분으로, 피드백 루프는 1분에서 5초로 줄었고 유휴 Airflow가 잡던 VM도 2대 이상 절약했습니다.

인증은 개인별 GCP Service Account로 통일했습니다. Secret은 GCP Secret Manager로 옮겨 로컬에서 보안 정보를 없앴습니다. KubernetesPodOperator는 LocalExecutor에서 돌릴 수 없어서, DockerOperator로 바꿔 끼우는 팩토리는 두 오퍼레이터의 속성 차이 때문에 접었습니다. 대신 개발 클러스터의 로컬 전용 Namespace에 Pod을 직접 띄웠습니다. 미리 만든 kubeconfig를 이미지에 마운트하고 RBAC으로 해당 Namespace의 Pod 조작만 허용해, 사용자가 Kubernetes 설정을 몰라도 되게 했습니다.

DAG 파싱 부담은 `.airflowignore`로 줄였습니다. 개발용 디렉터리만 파싱하게 하고 README로 안내했습니다. 테스트는 변경된 DAG 파일만 DagBag으로 검사합니다. 문법, 쏘카 이메일 형식의 owner, 로컬 테스트용 설정을 되돌렸는지를 확인하며, GitHub Action을 통과하고 리뷰어 승인이 있어야 머지됩니다. 문서, 사내 세미나, 격주 오피스 아워, 슬랙 문의 채널, Makefile 명령으로 온보딩을 돕습니다.

## Airflow 2 이전과 스케줄러 안정화 {#airflow-2}

Airflow 2로 옮기며 DAG Serialization과 Fast-Follow로 스케줄링 지연이 크게 줄었습니다. 스케줄러 HA도 공식 Helm Chart로 쉽게 켰습니다. 스케줄러가 늘면 Row Level Lock 때문에 Meta DB 부하가 같이 오르므로 메트릭을 보며 증설해야 합니다. 글을 쓴 시점에는 2.3으로 올려 둔 상태였습니다. 설정은 `PARALLELISM`을 높이고 `MIN_FILE_PROCESS_INTERVAL`과 `POOL_METRICS_INTERVAL`을 늘렸으며, `PARSING_PROCESSES`는 효과가 작아 그대로 뒀습니다.

DAG가 700개를 넘어서 Worker Pod용 노드 풀을 분리하고 오토스케일링을 걸었습니다. Task별 CPU와 메모리는 `assign_operator_resources` 헬퍼로 지정합니다. 오래된 DAG와 Task Instance 기록은 정리용 DAG가 주기적으로 지우며, 그 뒤 DB 사용량이 상당히 줄고 스케줄러와 웹 서버가 빨라졌다고 합니다.

## 보안과 RBAC {#보안}

Connection과 Variable은 GCP Secret Backend로 옮겼고, 쿠버네티스 쪽은 External Secret으로 Secret 리소스를 만듭니다. RBAC은 아직 진행 중입니다. 현재는 기본 Role로 팀별 공용 계정을 운영하며 권한이 실제 사용보다 넉넉한 부분이 있습니다. 쏘카가 SSO로 쓰는 Keycloak에 인증을 위임하는 방안을 검토하고 있다고 합니다.

## 담당자 알림과 관리자 모니터링 {#모니터링}

10분마다 도는 DAG가 Meta DB에서 실패한 Task를 조회해 슬랙 채널에 올리고 owner를 멘션합니다. owner에 이메일을 필수로 받고 PR 단계에서 검증하며, 슬랙의 이메일 조회 API로 사용자 ID를 얻습니다. 관리자는 statsd 메트릭을 Datadog 대시보드로 보고, 쿠버네티스도 같은 도구로 봅니다.

남은 과제는 M1 맥 호환, 사용자가 Python 환경과 Docker를 알아야 하는 점, 의존성을 세 곳에 설치해야 하는 번거로움입니다. 간헐적으로 Pod 로그 없이 Task가 실패하는 문제도 있습니다.

{{% details title="개선 전후 수치와 규모" closed="true" %}}

| 항목 | 값 |
|---|---|
| Airflow 서버 기동 | 5분에서 1분 |
| 개발 피드백 루프 | 1분(Commit 후 Sync)에서 5초 |
| 유휴 Airflow로 낭비된 VM | 2대 이상 절약 |
| 운영 DAG 수 | 700개 이상 |
| 실패 알림 주기 | 10분 |
| 로컬 실행 Airflow 이미지 | `apache/airflow:2.3.2` |

{{% /details %}}
