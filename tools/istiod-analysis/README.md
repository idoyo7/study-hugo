# istiod 스케일링 분석 스크립트

`content/istio/09-istiod-scaling-connections.md` §7의 수치를 뽑은 스크립트다.
Grafana Explore의 CSV 내보내기를 입력으로 받는다.

**원본 CSV는 커밋하지 않는다** — 로컬 `~/evejuni/temp/`에만 둔다. 스크립트가 그 경로를 하드코딩하고 있으니 다른 환경에서는 `BASE` 상수를 고칠 것.

## 입력 데이터

Grafana Explore → 쿼리 실행 → **Download CSV**(join by field). 형식:

```csv
"Time","istiod-1-24-1-<rs>-<suffix>","istiod-1-24-1-<rs>-<suffix>",...
2026-07-25 09:30:00,32,42,25,...
```

- 1열이 `Time`, 나머지는 파드별 계열. 파드가 없던 구간은 빈 셀.
- 스크립트는 컬럼명의 마지막 `-` 뒤 5자를 파드 식별자로 쓴다.
- Grafana가 말미에 비정형 행을 끼워 넣는 경우가 있어 파싱 실패 행은 건너뛴다.

## 쿼리

§7에서 쓴 것들. **rate 창을 반드시 기록할 것** — 두 지표를 나눠 쓸 때 창이 다르면 산술이 어긋난다.

```promql
# 파드별 xDS 커넥션 수 (15초 해상도, 3시간)
sum(pilot_xds) by (pod)

# CPU 사용량 (코어)
sum(rate(container_cpu_usage_seconds_total{container="discovery"}[1m])) by (pod)

# 스로틀된 period의 분율 — 0~1. container 필터와 분모 둘 다 필수
sum(rate(container_cpu_cfs_throttled_periods_total{container="discovery"}[1m])) by (pod)
  /
sum(rate(container_cpu_cfs_periods_total{container="discovery"}[1m])) by (pod)

# 수렴·푸시 지연 p99
histogram_quantile(0.99, sum(rate(pilot_proxy_convergence_time_bucket[2m])) by (le))
histogram_quantile(0.99, sum(rate(pilot_xds_push_time_bucket[2m])) by (le))
```

> **주의.** 분모 없는 `sum(rate(container_cpu_cfs_throttled_periods_total[2m])) by (pod)` 형태는
> (a) `container` 필터가 없어 파드 샌드박스 계열까지 합산될 수 있고,
> (b) 단위가 "초당 스로틀된 period 수"라 해석에 "초당 10 period" 가정이 필요하다.
> §7 초안이 이 형태를 쓰다가 잘못된 결론으로 갔다.

## 스크립트

| 파일 | 역할 |
|---|---|
| `analyze.py` | 파드 churn·시점별 분포·CoV·커넥션 급감 이벤트 요약 |
| `deep.py` | 커넥션 턴오버(재연결 레이트) 추정, 파드 등장·소멸 타임라인, CoV 재수렴 구간 |
| `buckets.py` | 15분 버킷별로 **정상 순환**과 **파드 교체발 강제 재접속**을 분리 |
| `idmetric.py` | CSV 4종의 값 분포로 지표 정체를 판정 |
| `correlate.py` | CPU·스로틀·convergence·push_time을 한 시간축에 정렬 |
| `ratio.py` | 보정 쿼리 vs 원 쿼리 대조 |
| `perpod.py` | 같은 파드·같은 시각으로 CPU와 스로틀을 조인해 quota 산술 검증 |

```bash
cd ~/evejuni/temp
python3 <repo>/tools/istiod-analysis/analyze.py "Explore-data-....csv" "라벨"
python3 <repo>/tools/istiod-analysis/deep.py   "Explore-data-....csv" "라벨" 09:40 10:00
python3 <repo>/tools/istiod-analysis/buckets.py "Explore-data-....csv" "라벨" 15   # keepalive 분
python3 <repo>/tools/istiod-analysis/perpod.py   # 파일 키가 스크립트에 하드코딩
```

## 방법론에서 조심할 것

**턴오버 측정은 하한이다.** 파드별 커넥션 증가분의 합으로 재연결을 세기 때문에, 15초 스텝 안에서 끊기고 다시 붙어 상쇄된 건 안 잡힌다. 절대값이 아니라 기간 간 상대 비교로 읽을 것.

**"스로틀된 period는 quota를 다 썼다"고 가정하지 말 것.** CFS 슬라이스 잔류(kubernetes#67577) 때문에 실사용이 quota에 못 미쳐도 스로틀이 걸릴 수 있다. `perpod.py`가 이 전제로 limit을 역산하는 블록을 갖고 있는데, 그 출력은 **명목 limit이 아니라 실효 quota 상한**으로 읽어야 한다. 다만 커널은 슬라이스의 **1ms만 남기고 반환**하므로(`min_cfs_rq_runtime`) 잔류 규모는 CPU 방문당 1ms 수준이다 — 크게 잡지 말 것.

**역산에서 갓 뜬 파드를 반드시 제외할 것.** 이게 §7 초판이 "실효 210m"라는 틀린 결론에 간 원인이다. 파드가 뜬 직후에는 startup 버스트로 스로틀이 걸리는데 `rate(...[1m])`이 그 짧은 구간을 1분에 걸쳐 평균내 눌러버린다. 그러면 `avg / f` 제약이 과하게 조여진다. 실제로 나이 필터를 걸면 상한이 크게 달라졌다.

```
필터 없음        → Q_eff ≤ 21.5ms   (10:45:45에 뜬 파드의 첫 1분 표본)
파드 나이 ≥5분   → Q_eff ≤ 37.1ms
```

교차 검증으로 **"좌초가 전혀 없다(quota 명목값 그대로)"고 가정했을 때 모순되는 표본의 비율**을 같이 세라. 6.5%면 좌초는 2차 요인이라는 뜻이다.

**CPU 최대와 스로틀 최대를 다른 파드에서 가져와 섞지 말 것.** 반드시 (파드, 시각) 단위로 조인한다 — `perpod.py`가 그 역할이다.
