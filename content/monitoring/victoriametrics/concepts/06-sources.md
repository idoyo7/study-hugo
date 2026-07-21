---
title: "소스맵"
weight: 6
aliases: ["/monitoring/victoriametrics/08-sources/"]
---

# 06 · 소스맵 — 발표 영상·기사·전사본 가이드

이 지식베이스는 네이버 D2/DEVIEW의 VictoriaMetrics 자료 **5건**(발표 영상 2편 + 텍스트 기사 3편)을 재구성한 것이다. 주제별 재구성은 개념/실전/우리 운영 문서가 담고, 원문별로 하나씩 충실히 정리한 판은 [원문별 정리]({{< relref "../by-source/_index.md" >}})에 있다. 여기서는 각 문서가 어떤 원본에서 나왔는지, 원본을 직접 확인하려면 어디를 보면 되는지 정리한다.

> 관련 문서: [개념 인덱스]({{< relref "_index.md" >}}) · [원문별 정리]({{< relref "../by-source/_index.md" >}})

## 원본 소스

### ① VictoriaMetrics: 시계열 데이터, 대혼돈의 멀티버스 (DEVIEW 2023)

- **발표자**: 손주식, 이선규 (NAVER 검색 SRE) · 33분 50초
- **영상**: https://youtu.be/OUyXPgVcdw4
- **관련 D2 게시글**: [네이버 검색 SRE의 시계열 데이터베이스 운영기](https://d2.naver.com/helloworld/6867189) (2024-02)
  - 게시글 임베드 영상(`tv.naver.com/v/48174751`)은 55초 트레일러라, 전체본은 YouTube 원본에서 확보.
- **원본 파일** (작업 저장소 `evejuni/monitoring/d2-victoriametrics/`, GitBook 미포함): `01_deview2023_victoriametrics_멀티버스.mp4` · `01_대사집_VictoriaMetrics_시계열데이터_대혼돈의_멀티버스.md` · `01_transcript.srt|txt`
- **다루는 범위**: 시계열/대용량 정의, TSDB 히스토리(Prometheus·Gorilla·Thanos·Cortex), IndexDB/DataDB 분리, LSM 트리, TSID/역색인, Gorilla 계열 압축, 그리고 후반부(≈25:00~)의 멀티클러스터 "멀티버스" 실전 운영기.
- **주로 반영된 문서**: [01]({{< relref "01-tsdb-and-victoriametrics.md" >}}), [02]({{< relref "02-architecture.md" >}}), [04]({{< relref "04-storage-and-compression.md" >}}), [실전 02]({{< relref "../practice/02-operations-at-scale.md" >}}).

### ② Inside VictoriaMetrics (2026-06)

- **발표자**: 강민구 (NAVER Container Platform, N3R Standard) · 40분 37초
- **영상**: https://tv.naver.com/v/100672029
- **관련 D2 게시글**: [Inside VictoriaMetrics](https://d2.naver.com/helloworld/9290861) — 게시글 본문은 영상 래퍼(메타+목차)이고 실제 내용은 영상에 있음.
- **원본 파일** (작업 저장소 `evejuni/monitoring/d2-victoriametrics/`, GitBook 미포함): `02_inside_victoriametrics.mp4` · `02_대사집_Inside_VictoriaMetrics.md` · `02_transcript.srt|txt`
- **다루는 범위**: 6섹션 구성 — 아키텍처 오버뷰 / vmagent / vminsert / vmstorage / vmselect / best·worst case. VM 내부 동작의 가장 완전한 1차 소스.
- **주로 반영된 문서**: [01]({{< relref "01-tsdb-and-victoriametrics.md" >}}), [02]({{< relref "02-architecture.md" >}}), [03]({{< relref "03-ingestion.md" >}}), [04]({{< relref "04-storage-and-compression.md" >}}), [05]({{< relref "05-query-and-ops-components.md" >}}), [실전 01]({{< relref "../practice/01-cardinality.md" >}}).

### ③ 네이버 검색의 대규모 메트릭 저장소, VictoriaMetrics 운영기 1편 (텍스트, 2026-04)

- **출처**: https://d2.naver.com/helloworld/6475419
- **원본 파일** (작업 저장소, GitBook 미포함): `03_기사_6475419_대규모메트릭저장소.md`
- **다루는 범위**: 12.5억 활성 시계열·555조 데이터포인트·180노드·0.92바이트/DP 실측, 글로벌 사례 비교, Hot/Warm 2계층, 메모리 한계(128→512GB), 무중단 장비 전환(Hot=랑데부 역순 추가, Warm=vmbackup/vmrestore).
- **주로 반영된 문서**: [실전 02]({{< relref "../practice/02-operations-at-scale.md" >}}), 일부 [04]({{< relref "04-storage-and-compression.md" >}})(0.92B 압축 실증). 원문 단위 정리는 [원문별 02]({{< relref "../by-source/02-2026-04-large-scale-metric-store.md" >}}).

### ④ 네이버 검색 SRE의 시계열 데이터베이스 운영기 (텍스트, 2024-02)

- **출처**: https://d2.naver.com/helloworld/6867189
- **원본 파일** (작업 저장소, GitBook 미포함): `04_기사_6867189_SRE시계열운영기.md`
- **성격**: DEVIEW 2023 발표(①)를 요약한 얇은 래퍼 기사(약 4KB, 55초 트레일러 임베드). 실질 내용은 ① 영상 전사본이 담당하고, 이 기사는 보조 참고용.

### ⑤ VictoriaMetrics 운영기 2편 — 3단계 최적화 전략 (텍스트, 2026-07)

- **출처**: https://d2.naver.com/helloworld/5788040
- **저자**: 강지훈·이윤석·정솔 (NAVER Metric&Monitoring) — ③ 1편의 후속편.
- **원본 파일** (작업 저장소, GitBook 미포함): `05_기사_5788040_운영기2편_3단계최적화.md`
- **다루는 범위**: 장비 증설 없이 리소스 위기를 해결한 소프트웨어 최적화 3단계 — ① 조회(vmselect OOM을 레이블 접두사 기준 쿼리 분할로 해결) ② 저장(IndexDB 3슬롯 로테이션 분석 후 Hot Tier RetentionPeriod 6개월 축소) ③ 수집(비서비스 컨테이너 제외로 메트릭 유입 통제).
- **주로 반영된 문서**: [원문별 04]({{< relref "../by-source/04-2026-07-three-stage-optimization.md" >}}). 관련 원리는 [03 수집]({{< relref "03-ingestion.md" >}})·[04 저장·압축]({{< relref "04-storage-and-compression.md" >}})·[05 쿼리·운영]({{< relref "05-query-and-ops-components.md" >}}).

## 전사(transcription) 방법

- 도구: **whisper.cpp `large-v3-turbo`** (Metal GPU), 한국어 자동 전사.
- 모델 파일: 작업 저장소 `evejuni/monitoring/d2-victoriametrics/models/ggml-large-v3-turbo.bin` (약 1.6GB, GitBook 미포함). 재전사가 필요 없으면 삭제해도 무방.
- **주의**: STT 자동 전사라 고유명사 표기 오류가 있다. 각 문서는 정규 표기로 교정해 반영했다.
  - 예: "빅토리아 매트릭스" → VictoriaMetrics · "VM 에이전트" → vmagent · "아파트 2.0" → Apache 2.0 · "프롬키" → PromQL · "리모트라이트" → remote_write · "고릴라" → Gorilla · "미드" → read.

## 원본 대사집을 직접 볼 때

문서는 요약·재구성본이다. 발표자의 정확한 워딩, 타임스탬프, 맥락이 필요하면 작업 저장소 `evejuni/monitoring/d2-victoriametrics/`의 `01_대사집_*.md`, `02_대사집_*.md`를 보라(GitBook 미포함). 두 대사집은 5분 단위 타임스탬프(`## 00:00 ~`)로 구획돼 있어 영상과 대조하기 쉽다.
