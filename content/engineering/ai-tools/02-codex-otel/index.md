---
title: "02 Codex CLI 관측과 공통 대시보드 — Claude Code와 한 화면에"
date: 2026-09-22
lastmod: 2026-10-04
weight: 2
url: "/ai-tools/02-codex-otel/"
---

# Codex CLI 관측과 공통 대시보드 — 두 CLI를 한 화면에서 보기

{{< callout type="info" >}}
10월 초에 수집 경로가 otel-gateway·VictoriaLogs·Tempo에서 HyperDX 컬렉터로 바뀌었습니다. 2026-10-04에 설정·경로·대시보드 쿼리 설명은 지금 기준으로 고쳤고, 함정과 14일 실측을 적은 절은 당시 경로 기준 기록으로 표시해 두었습니다. 바뀐 과정은 [관측 스택 일원화]({{< relref "/platform/homelab/03-observability-consolidation/index.md" >}})에 있습니다.
{{< /callout >}}

[지난 편]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})에서 Claude Code의 텔레메트리를 hub 클러스터로 끌어왔습니다. 같은 날 오후에는 Codex CLI도 같은 파이프라인에 붙였습니다. 요즘은 두 CLI를 섞어서 쓰는 편입니다. `~/.claude/CLAUDE.md`에 haiku < sonnet < opus < fable 순의 티어 사다리를 적어 두고, 1차 코드리뷰나 교차검증은 `codex-relay` 에이전트로 Codex에 넘기는 식입니다. Anthropic 쿼터를 아끼자고 세운 규칙이지만, 실제로 얼마나 넘어가는지는 두 CLI의 숫자를 나란히 놓아야 보입니다. 이 글에서는 Codex 쪽 설정과 함정을 먼저 다룬 뒤 둘을 한 화면에 올린 공통 대시보드 이야기로 넘어갑니다.

## Codex 설정은 config.toml 한 블록

Codex는 내보내기를 환경변수가 아니라 `~/.codex/config.toml`의 `[otel]` 테이블로 설정하고 로그·메트릭·트레이스 exporter를 각각 따로 둡니다. 파일 끝에 붙인 블록은 이렇습니다.

```toml
# --- OpenTelemetry export (2026-09-08) — Claude Code 와 같은 hub 파이프라인
#   logs    -> hdx-otel-collector:4328 -> ClickHouse
#   metrics -> hdx-otel-collector:4328 -> VictoriaMetrics 테넌트 0 (OTLP, delta)
#   traces  -> hdx-otel-collector:4328 -> ClickHouse
#   기본값 metrics_exporter = "statsig"(OpenAI 자체 수집) 이므로 반드시 명시한다.
[otel]
environment = "hub"
log_user_prompt = false

[otel.exporter.otlp-http]
endpoint = "http://hdx-otel-collector.hdx.svc.cluster.local:4328/v1/logs"
protocol = "binary"

[otel.metrics_exporter.otlp-http]
endpoint = "http://hdx-otel-collector.hdx.svc.cluster.local:4328/v1/metrics"
protocol = "binary"

[otel.trace_exporter.otlp-http]
endpoint = "http://hdx-otel-collector.hdx.svc.cluster.local:4328/v1/traces"
protocol = "binary"
```

Claude Code는 `OTEL_EXPORTER_OTLP_ENDPOINT`에 베이스 주소만 주면 SDK가 `/v1/metrics` 같은 경로를 알아서 붙여 줍니다. Codex의 endpoint는 그렇지 않아서 시그널마다 전체 경로를 끝까지 적어야 합니다. `metrics_exporter`는 비워 두면 기본값이 `statsig`인데, 이 기본값은 OpenAI가 자체 수집하는 쪽으로 데이터를 내보내므로 `otlp-http`를 명시해야 hub로 들어옵니다. 주석에 굳이 "반드시 명시한다"고 적어 둔 것도 그래서입니다.

리소스 속성에는 설정 키가 아예 없습니다. 대시보드에서 한 변수로 거르려면 Claude Code와 같은 `workspace.user` 라벨을 붙여야 해서, `~/.bashrc`에 환경변수를 넣었습니다. Codex가 쓰는 Rust OTel SDK의 환경변수 리소스 디텍터가 이 값을 읽어 갑니다.

```bash
export OTEL_RESOURCE_ATTRIBUTES="workspace.user=mont,deployment.environment=hub"
```

프롬프트 본문은 `log_user_prompt = false`로 내보내지 않게 했습니다. 작업 전 원본은 `config.toml.bak-pre-otel`로 떠 두었습니다. 지금 쓰는 버전은 `codex-cli 0.154.0`입니다.

| 신호 | 경로 | 저장소 |
|---|---|---|
| 이벤트 로그 | hdx 컬렉터 :4328 `/v1/logs` | ClickHouse `otel_logs` (90d) |
| 메트릭 | hdx 컬렉터 :4328 `/v1/metrics` → OTLP | VictoriaMetrics 테넌트 0 (delta 그대로) |
| 트레이스 | hdx 컬렉터 :4328 `/v1/traces` → ClickHouse + spanmetrics | ClickHouse `otel_traces` (90d), spanmetrics는 VictoriaMetrics |

컬렉터의 입구와 파이프라인은 [01편]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})에 적었습니다.

## 또 메트릭만 안 들어온다

이 절은 otel-gateway를 거치던 당시 경로 기준입니다.

첫 테스트에서 이벤트와 트레이스는 들어왔는데 메트릭만 VictoriaMetrics에 없었습니다. Claude Code 때와 증상이 똑같았고 원인도 delta temporality로 같았습니다. prometheusremotewrite exporter는 delta 데이터포인트를 에러 하나 없이 버립니다.

달랐던 건 손봐야 할 위치였습니다. Claude Code는 클라이언트에서 `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` 한 줄로 해결됐지만 Codex는 OTLP 메트릭을 delta로 고정해 내보냅니다. 게이트웨이 매니페스트 주석에 적어 둔 대로 이 동작은 소스(`codex-rs/otel/src/metrics/client.rs`)에 하드코딩돼 있어서 설정으로 바꿀 방법이 없습니다. 그래서 클라이언트 대신 게이트웨이 쪽을 손봤습니다.

```yaml
processors:
  # delta temporality 메트릭을 cumulative 로 변환. prometheusremotewrite 는 delta 를 조용히 버린다.
  # Codex CLI 는 OTLP 메트릭을 Delta 로 고정 내보내며(codex-rs/otel/src/metrics/client.rs) 설정으로 바꿀 수 없다.
  # cumulative 입력(Claude Code 등)은 그대로 통과한다. max_stale 뒤 사라진 스트림은 다음 등장 때 0 부터 다시 센다 → increase_pure() 로 집계.
  deltatocumulative:
    max_stale: 10m

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, k8sattributes, deltatocumulative, batch]
      exporters: [prometheusremotewrite/vm]
```

프로세서는 `metrics` 파이프라인에만 넣었고 spanmetrics 커넥터가 만드는 `metrics/spanmetrics` 파이프라인에는 넣지 않았습니다. cumulative로 들어오는 Claude Code 메트릭은 이 프로세서를 그대로 통과하니 서로 간섭할 일이 없습니다. montstrap 이력에도 이 순서가 남아 있습니다. `305a43a Add deltatocumulative processor to otel-gateway metrics pipeline` 바로 다음이 `f7341a3 Add Codex CLI OTel Grafana dashboards`입니다.

`max_stale: 10m`에는 부작용이 하나 따라옵니다. 10분 동안 데이터가 들어오지 않은 스트림은 게이트웨이가 상태를 잊어버리고 다음에 다시 나타나면 0부터 새로 셉니다. 그러면 한 시리즈 안에서 카운터가 리셋됩니다. 세션마다 0부터 시작하는 새 시리즈와 성질이 같으니 해법도 같습니다. 모든 쿼리에 `increase_pure()`를 씁니다. 그 원리는 [01편]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})에서 설명했습니다.

문제를 해결한 뒤에는 실제 codex-relay 경로와 같은 `codex exec`를 돌려, 토큰 메트릭이 VictoriaMetrics에 들어오는 것까지 확인했습니다.

지금은 게이트웨이도 `deltatocumulative` 설정도 없습니다. 컬렉터가 메트릭을 remote write를 거치지 않고 OTLP로 VictoriaMetrics에 바로 넣기 때문에 delta가 버려지지 않습니다. 컬렉터 이미지에는 `deltatocumulative`가 없어서 Codex 메트릭은 delta 그대로 저장되고, 새 시리즈는 샘플 하나하나가 이미 증가분이라 `increase_pure()`가 아니라 합산해야 합니다.

그런데 옛 경로로 쌓인 시리즈는 cumulative로 남아 있어서 대시보드 쿼리 하나가 둘을 다 읽어야 합니다. 옛 시리즈에만 `job` 라벨이 있는 점을 이용해 `or`로 이었습니다. Codex 대시보드의 메트릭 쿼리는 `increase_pure(M{sel}[r])` 자리에 `(increase_pure(M{sel,job!=""}[r]) or sum_over_time(M{sel,job=""}[r]))`를 씁니다. M은 메트릭, sel은 나머지 라벨 조건, r은 조회 범위입니다. 옛 시리즈가 90일 보관으로 사라지는 2026-12-27 이후에는 왼쪽 절을 걷어냅니다.

## 이름 규칙이 Claude와 다르다

메트릭이 들어오고 나서 쿼리를 짜다 보니 걸리는 것이 몇 가지 있었습니다.

토큰은 카운터가 아니라 히스토그램입니다. `codex_turn_token_usage`가 턴마다 한 번씩 관측되는 구조라 합계는 `codex_turn_token_usage_sum`을 `increase_pure()`로 잡아야 나옵니다. delta로 저장되는 새 시리즈는 앞 절 끝에 적은 대로 `sum_over_time()`으로 더합니다. `token_type` 라벨 값은 `total`, `input`, `cached_input`, `cache_write_input`, `output`, `reasoning_output` 여섯 가지입니다.

단위가 ms인 히스토그램은 이름에 단위 접미가 한 번 더 붙습니다. 그래서 첫 토큰 지연이 `codex_turn_ttft_duration_ms_milliseconds_bucket`처럼 이중 접미로 들어옵니다. 원본 이름만 보고 쿼리를 쓰면 아무것도 잡히지 않습니다. 이 이름은 remote write 경로에서 처음 봤지만 접미는 OTLP 경로에서도 그대로입니다. OTLP로 VictoriaMetrics의 별도 테넌트에 먼저 직접 넣어 본 카나리에서도 `codex_sqlite_logs_write_duration_ms_milliseconds_*`가 같은 이중 접미로 들어왔습니다.

모델 호출 수를 보려면 `codex_api_request_total`이 아니라 `codex_websocket_request_total`을 봐야 합니다. Codex가 모델과 WebSocket으로 통신하기 때문입니다. 이벤트 쪽도 사정이 비슷해서, `codex.api_request` 이벤트는 이름만 보면 모델 호출 같지만 대부분 `/models` 폴링입니다. Codex 이벤트 640건이 전부 `/models` 폴링이고 실제 턴은 0건인 날도 있었습니다. 처음엔 데이터가 빠졌나 의심했는데 astra의 마지막 턴 기록이 09-11이었습니다. 데이터는 제대로 들어왔고 그 사이 이 pod에서 Codex 턴이 없었을 뿐입니다.

`service.name`에는 originator가 들어갑니다. TUI로 쓰면 `codex_cli_rs`, `codex exec`로 돌리면 `codex_exec`입니다. codex-relay 위임은 exec 경로로 돌기 때문에, 이 라벨을 보면 직접 쓴 것과 위임한 것을 대략 구분할 수 있습니다. 한때 `codex exec`가 메트릭을 내보내지 않는 버그(#12913)가 있었고 2026-02에 닫혔습니다. 붙인 뒤에 exec 경로로 한 번 더 확인한 것도 그 때문입니다.

## 비용 신호가 없다

Codex는 API 키로 과금할 때만 `codex.turn_cost` 이벤트와 `codex_turn_cost_microusd_total` 메트릭을 냅니다. 저는 ChatGPT 계정으로 로그인해서 쓰기 때문에 둘 다 나오지 않습니다. 그래서 Codex 대시보드에는 비용 패널을 두지 않고 토큰과 턴 수로만 봅니다. 두 CLI의 비용을 나란히 놓고 싶었던 공통 대시보드에서는 이 공백을 다른 방식으로 메웠는데, 그 방법은 아래에서 다룹니다.

## Codex 대시보드 셋

공개 대시보드 중에서는 grafana.com의 [24641 OpenAI Codex (VictoriaStack)](https://grafana.com/grafana/dashboards/24641)가 우리 스택에 맞았는데, 쿼리가 전부 VictoriaLogs 기준으로 짜여 있기 때문입니다. 원저자 조직의 department·team 구조가 그대로 들어 있어서 처음에는 생성 스크립트 `build-codex-dashboards.py`가 해당 문자열을 치환했습니다. VictoriaLogs를 걷은 지금은 이 대시보드의 쿼리도 ClickHouse SQL이고 원본은 git의 YAML입니다. 원본의 표현이 지금은 어떤 값이 됐는지 표로 적습니다.

| 원본 | 지금 값 |
|---|---|
| `${lds}`, `${DS_VICTORIALOGS}` (로그 데이터소스) | `clickhouse-hdx` |
| `${tds}`, `${DS_VICTORIATRACES}` (트레이스 데이터소스) | `clickhouse-hdx`, 테이블은 `default.otel_traces` |
| `department:$department AND `, `team.id:$team AND ` | 제거 |
| `user.email:$user` | `ResourceAttributes['workspace.user'] IN (${user:singlequote})` |
| `count_uniq(user.email)` | `uniqExactIf(ResourceAttributes['workspace.user'], ResourceAttributes['workspace.user'] != '')` |
| `by (department, team.id)` | `concat(ResourceAttributes['workspace.user'], ' / ', LogAttributes['originator'])` |
| "Tokens usage by department / team" | "Tokens usage by user / originator" |

템플릿 변수에서는 datasource·department·team을 빼고, 나머지 변수는 전체 선택이 되도록 `includeAll`과 `multi`를 켰습니다. 변수 값은 `default.otel_logs`에서 `SELECT DISTINCT`로 가져오고, 전체 선택은 `$__conditionalAll()` 매크로가 조건을 빼는 것으로 처리합니다. Traces 테이블은 `default.otel_traces`에서 루트 스팬(`ParentSpanId = ''`)을 읽는 SQL 패널입니다. 처음에는 Tempo TraceQL 검색 패널(`{resource.service.name=~"codex.*"}`)이었습니다. `hideSeriesFrom` 오버라이드에 원저자 이메일이 들어 있어서 그것도 지웠습니다.

Claude 때와 마찬가지로 자체 대시보드도 두 개 더 만들었습니다. **Codex · Usage**는 20패널을 한 섹션에 모은 개요입니다. **Codex · Optimization**은 11행 92패널 규모이고 행 구성은 이렇습니다.

1. 세션 시작 고정비 · 캐시
2. 세션 프리픽스 구성 (스킬 카탈로그 · MCP 도구 · 플러그인)
3. 모델 · reasoning effort · originator 별 사용량
4. 위임 · 멀티에이전트
5. 마라톤 세션 · 컨텍스트 성장
6. 압축 · rollout
7. 훅 오버헤드
8. 오류 · 재시도 · 연결
9. 도구 프로파일
10. 모델 회귀 추적
11. 지연 프로파일 (Codex 고유)

ClickHouse에서는 응답 완료 이벤트를 `LogAttributes['event.name'] = 'codex.sse_event' AND LogAttributes['event.kind'] = 'response.completed'`로 걸러 냅니다. 이 이벤트에 `input_token_count`, `cached_token_count`, `model_reasoning_effort`가 붙어 있어서 요청 단위로 캐시 미스를 셀 수 있습니다. 쿼리 형태의 규칙은 [01편]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})에 적었습니다. Optimization 대시보드의 '캐시 미스 요청' 패널은 입력 토큰 가운데 캐시에서 읽은 것이 절반에 못 미치는 응답을 셉니다.

```sql
SELECT countIf(toFloat64OrZero(LogAttributes['input_token_count']) > 0
           AND toFloat64OrZero(LogAttributes['cached_token_count']) / toFloat64OrZero(LogAttributes['input_token_count']) < 0.5) AS misses
FROM default.otel_logs
WHERE match(ServiceName, 'codex.*')
  AND match(ResourceAttributes['workspace.user'], '${user:regex}')
  AND match(LogAttributes['model'], '${model:regex}')
  AND match(LogAttributes['originator'], '${originator:regex}')
  AND LogAttributes['event.name'] = 'codex.sse_event'
  AND LogAttributes['event.kind'] = 'response.completed'
  AND $__timeFilter(Timestamp)
```

## 공통 대시보드 ai-cli-common

이번 작업의 중심은 `AI CLI · Common (Claude Code ↔ Codex)`입니다. 생성기 `build-common-dashboard.py`는 원본 JSON을 두지 않고 코드만으로 대시보드를 생성했습니다. 이 생성기는 아직 VictoriaLogs를 전제로 하고 있어서 지금은 git의 YAML을 원본으로 봅니다. 처음엔 8섹션 24패널로 스펙을 잡았는데, 두 CLI를 대조할수록 축이 늘어나 결국 12행 80패널이 됐습니다.

### 토큰을 같은 축에 세우기

두 CLI는 토큰을 세는 방식부터 다릅니다. Claude의 `input`, `output`, `cacheRead`, `cacheCreation` 네 유형은 서로 겹치지 않습니다. Codex는 `total = input + output`입니다. `cached_input`은 `input`의 부분집합, `reasoning_output`은 `output`의 부분집합이라 그냥 더하면 캐시 읽기가 두 번 잡힙니다. 그래서 네 축으로 정규화했습니다.

| 정규화 축 | Claude | Codex |
|---|---|---|
| 비캐시 입력 | `type="input"` | `token_type="input"` − `token_type="cached_input"` |
| 캐시 읽기 | `type="cacheRead"` | `token_type="cached_input"` |
| 캐시 쓰기 | `type="cacheCreation"` | `token_type="cache_write_input"` |
| 출력 | `type="output"` | `token_type="output"` (reasoning_output 포함) |

총 토큰의 정의도 서로 다릅니다. Claude는 네 유형을 전부 더하지만 Codex는 `total`에 `cache_write_input`만 더합니다. 캐시 히트율 역시 Claude는 `cacheRead / (input + cacheRead)`, Codex는 `cached_input / input`로 식이 다르지만 "입력 중 캐시에서 읽은 비율"이라는 뜻은 같습니다.

### 티어 사다리를 라벨로

대시보드에서 CLAUDE.md의 라우팅 규칙을 확인하려면 먼저 모델 이름을 티어별로 묶어야 합니다. 그래서 두 CLI가 함께 쓰는 표를 하나 두었습니다.

```python
TIERS = [
    ("0 기타", ".*", ".*"),
    ("1 경량", ".*haiku.*", ".*luna.*"),
    ("2 표준", ".*sonnet.*", ".*sol.*"),
    ("3 심층", ".*opus.*", ".*astra.*"),
    ("4 최상", ".*fable.*", NOMATCH),
]
```

fable은 Anthropic 쪽에만 있는 예약 티어여서 Codex에는 대응하는 항목이 없습니다. 이 표를 PromQL로 옮기면 `label_replace()` 연쇄가 됩니다.

```python
def tier_tagged(raw_expr, side):
    e = raw_expr
    for name, c_re, x_re in TIERS:
        regex = c_re if side == "claude" else x_re
        e = f'label_replace({e}, "tier", "{name}", "model", "{regex}")'
    return e
```

`label_replace`는 정규식이 맞을 때만 라벨을 덮어쓰므로 표 뒤쪽 항목이 앞쪽보다 우선합니다. 첫 줄 `.*`가 모든 모델에 "0 기타"를 붙여 두면, 뒤에서 맞는 티어가 그 라벨을 덮어씁니다. 실제 쿼리는 이렇게 펼쳐집니다.

```promql
sum by (tier) (increase_pure(label_replace(label_replace(label_replace(label_replace(label_replace(
  claude_code_token_usage_tokens_total{workspace_user=~"$user"},
  "tier", "0 기타", "model", ".*"), "tier", "1 경량", "model", ".*haiku.*"), ...
```

이 표가 한 번 어긋난 적이 있습니다. 처음 매핑은 sol=표준, terra=심층, astra=최상이었는데, 그사이 CLAUDE.md의 Codex 티어가 standard=sol·high, deep=astra·medium으로 바뀌어 있었습니다. 그 탓에 대시보드는 심층 위임을 "최상"으로 분류하고 있었습니다. TIERS 한 줄을 고쳐 심층을 terra에서 astra로 옮겼고(`542af3f`), 라우팅 정책을 바꾸면 이 표도 같이 바꿔야 한다는 걸 이때 배웠습니다.

### 빈 벡터 가드

비율 패널은 분모가 0이거나 양쪽 다 매치가 없으면 Grafana에 "No data"가 뜹니다. Codex를 쓰지 않은 날에는 Codex 쪽 패널이 전부 그렇게 되기 때문에 나눗셈마다 가드를 넣었습니다.

```python
def safe_div(num, den):
    return f"(({num} or vector(0)) / ({den} > 0)) or vector(0)"
```

캐시 재사용 배수처럼 시계열로 그리는 비율에는 [01편]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})의 `default 0`을 붙이지 않고 분모가 0인 구간만 `safe_div`가 0으로 채웁니다.

### 비용 공백은 추정으로, 추정이라고 적어서

④ 쿼터 전가 효과 행에서 Claude는 `claude_code_cost_usage_USD_total` 실측 USD를 쓰지만 Codex에는 그런 신호가 없습니다. 단가를 따로 지어내는 대신, 같은 기간 Claude의 실측 평균단가(비용 ÷ 토큰)를 Codex 정규화 토큰에 곱한 패널을 두었습니다. 패널 제목은 "Codex 토큰 → Claude 단가 환산 (추정 USD)"이고, 설명에는 이 값이 실제 지출이 아니라 같은 토큰을 Claude로 돌렸다면 들었을 기회비용이라고 적었습니다. codex-relay로 넘긴 일이 Anthropic 쿼터를 얼마나 덜어 줬는지 가늠하려고 만든 패널입니다.

```promql
(sum(increase_pure(codex_turn_token_usage_sum{workspace_user=~"$user",token_type="total"}[$__range])) or vector(0))
  + (sum(increase_pure(codex_turn_token_usage_sum{workspace_user=~"$user",token_type="cache_write_input"}[$__range])) or vector(0))
```

위 식이 Codex 정규화 총 토큰이고, 여기에 Claude 비용 합 ÷ Claude 토큰 합을 `safe_div`로 곱합니다. 이 식은 게이트웨이를 거치던 때의 것입니다. 지금 이 패널의 식은 Codex 쪽 `increase_pure()`마다 앞에서 설명한 `or sum_over_time()` 절이 붙은 형태입니다.

### 이벤트 쿼리는 ServiceName으로만

리소스 속성을 넣기 전에 쌓인 구버전 Codex 로그 레코드에는 `workspace.user`가 없었습니다. 지금 ClickHouse에 들어온 Codex 이벤트에도 이 속성이 붙어 있지 않습니다. 그래서 `$user` 변수는 메트릭 쿼리에만 적용하고, 이벤트 쿼리는 `ServiceName = 'claude-code'`와 `match(ServiceName, 'codex.*')`로만 거릅니다. 사용자로 거르면 그 레코드가 경고 없이 결과에서 빠지기 때문입니다. '통합 이벤트 스트림' 패널은 두 CLI의 이벤트를 이 조건 하나로 같이 읽습니다.

```sql
SELECT Timestamp AS timestamp,
       concat(ServiceName, ' ', LogAttributes['event.name'], ' model=', LogAttributes['model'], ' tool=', LogAttributes['tool_name'], ' ms=', LogAttributes['duration_ms']) AS body,
       SeverityText AS level,
       LogAttributes AS labels
FROM default.otel_logs
WHERE ((ScopeName = 'com.anthropic.claude_code.events' AND ServiceName = 'claude-code')
       OR match(ServiceName, 'codex.*'))
  AND $__timeFilter(Timestamp)
ORDER BY Timestamp DESC
LIMIT 1000
```

### 12개 행

앞 네 행은 운영 판단용이고 뒤 여덟 행은 두 CLI를 같은 축에 놓고 비교하는 용도입니다.

1. 라우팅 실측 — 티어 사다리 · 위임
2. 캐시 경제 · 세션 위생
3. 단위 경제 — 한 번 돌리는 데 드는 값
4. 쿼터 전가 효과
5. 한눈에
6. 활동 타임라인
7. 토큰 구성 · 캐시
8. 모델 믹스
9. 지연 비교
10. 도구
11. 오류 · 신뢰성
12. 이벤트 · 트레이스

모든 표현식을 vmselect에 실제로 보내 빈 패널이 없는지 확인하는 것을 완료 조건으로 삼았습니다.

## 대조하다 보니 보인 것

이 절의 이벤트 수치는 VictoriaLogs에서 읽던 당시 값입니다.

두 CLI 대시보드를 나란히 두자 한쪽에만 있는 축이 드러났습니다. 공통 대시보드를 만든 커밋(`49f05f3`)에서 개별 대시보드도 서로 보강했습니다.

가장 컸던 건 Claude의 `api_request` 이벤트에 있는 `ttft_ms`였습니다. 첫 토큰 지연이 이벤트마다 찍혀 있었는데도 지금까지 어느 대시보드에서도 쓰지 않았습니다. Codex 쪽에는 지연 프로파일 행이 있었으니 Claude Optimization에도 같은 행을 만들었습니다. `subagent_completed` 이벤트도 사정이 비슷해서, `agent_type`, `model`, `final_model`, `model_swapped`, `total_tokens`, `total_tool_uses`가 모두 들어 있는데 쓰이지 않고 있었습니다.

MCP 연결 이벤트를 상태별로 나눠 보니 `connected`는 평균 2.3초, `disconnected`는 7.5~11초였습니다. 끊기는 쪽에서 붙는 쪽보다 세 배 넘는 시간이 걸립니다.

Codex Optimization의 `exec 호출 (command_category 별)`에 대응하는 Claude 패널도 만들었습니다. 01편 말미에 숙제로 남겨 두었던 Bash 명령별 집계가 바로 이 패널입니다. `tool_parameters`를 LogsQL `unpack_json`으로 풀면 `bash_command`가 나오는데, `cd` 136, `sed` 31, `grep` 28 순이었습니다. 지금 대시보드는 같은 값을 ClickHouse의 `JSONExtractString(LogAttributes['tool_parameters'], 'bash_command')`로 꺼냅니다.

| 대시보드 | 패널 수 |
|---|---|
| claude-code-optimization | 50 → 80 |
| codex-optimization | 56 → 92 |
| ai-cli-common | 신규 80 |

## 14일 실측

이 절은 당시 경로 기준입니다. 이벤트 수치는 VictoriaLogs에서 뽑았기 때문에 VictoriaLogs가 없어진 지금은 같은 쿼리로 다시 확인할 수 없습니다.

집계 기간은 2026-09-08부터 09-22까지 14일입니다. 메트릭은 VictoriaMetrics에서 `increase_pure()`로 뽑았고 Claude는 OTel로 들어온 것만(`source!="backfill"`) 셌습니다.

| 항목 | Claude Code | Codex |
|---|---|---|
| 비캐시 입력 | 8,666,709 | 4,516,015 |
| 캐시 읽기 | 613,740,921 | 90,867,840 |
| 캐시 쓰기 | 23,751,199 | 0 |
| 출력 | 5,168,454 | 622,691 (reasoning 66,827 포함) |
| 정규화 총 토큰 | 651,327,283 | 95,989,184 |
| 캐시 히트율 (대시보드 정의) | 98.6% | 95.3% |
| 세션 / 턴 | 세션 63 | 턴 106 (codex_cli_rs 50, codex_exec 56) |
| 비용 | $519.1 | 신호 없음 |

Claude 캐시 히트율은 캐시 쓰기까지 분모에 넣어 계산하면 95.0%입니다. 어느 쪽 정의로 보든 입력 대부분이 캐시에서 나옵니다. Codex는 캐시 쓰기 토큰이 14일 내내 0이었습니다. 토큰 총량으로 보면 Claude가 Codex의 약 6.8배입니다. Codex 턴 106건 중 56건이 exec 경로인데, codex-relay가 이 경로로 돌기 때문에 이 숫자로 위임 비중을 가늠합니다.

비용을 모델별로 나누면 이렇습니다.

| 모델 | 비용 |
|---|---|
| fable-5-1 | $211.8 |
| opus-5[1m] | $204.9 |
| sonnet-5 | $84.8 |
| haiku-4-5 | $17.6 |
| 합계 | $519.1 |

출처별로는 main $291.6, subagent $180.1, auxiliary $47.5입니다. 구독 요금제로 쓰고 있어서 이 금액은 청구액이 아니라 API 단가로 환산한 값입니다. 이 표에서 가장 먼저 눈에 걸린 건 예약 티어라고 적어 둔 fable이 비용 1위였다는 사실입니다.

Codex의 첫 토큰 지연은 p50이 4.7초, p95가 35.8초였습니다. 14일 동안 `codex_websocket_request_total`은 1,105건이었습니다. 훅은 PostToolUse가 1,267회로 압도적으로 많았고 그 뒤로 Stop 69, UserPromptSubmit 64, SessionStart 41 순입니다.

VictoriaLogs 보존 기간이 7일이라 이벤트 수치는 사실상 최근 7일치입니다. `event.name:codex.*`로 세면 `api_request` 2,776건이 가장 많은데, 앞서 말했듯 대부분 폴링입니다. 그 뒤로 `tool_result` 998, `tool_decision` 523, `websocket_request` 503, `sse_event` 484입니다. 이름별 도구 호출 수는 아래 표에 있습니다.

| 도구 | 호출 | 실패 |
|---|---|---|
| exec_command | 492 | 0 |
| exec | 339 | 2 |
| write_stdin | 39 | 0 |
| send_message | 35 | 0 |
| apply_patch | 33 | 2 |
| run | 22 | 0 |
| spawn_agent | 9 | 0 |
| view_image | 8 | 0 |

998건 가운데 실패한 호출은 4건이고 도구 실행 시간은 p50 133ms, p95 5,000ms였습니다. 실패 수는 당시 LogsQL `count() if (success:false)`로 셌습니다. 지금 대시보드는 `countIf(LogAttributes['success'] = 'false')`로 셉니다.

## GitOps와 사라진 커밋

배포는 Claude 대시보드와 같은 경로를 탑니다. montstrap `hub/opentelemetry/manifests/`의 YAML을 argocd가 클러스터에 반영합니다. 처음에는 생성 스크립트가 이 매니페스트를 뽑아 커밋했는데, 스크립트가 아직 VictoriaLogs 기준이라 이제는 git의 YAML을 원본으로 봅니다. 대시보드는 `victoria-metrics` 네임스페이스의 ConfigMap이며 Grafana 사이드카가 라벨 `vm_grafana_dashboard: "1"`을 보고 읽어 들입니다. 지금 이 라벨로 조회하면 `ai-cli-common-dashboard`와 Codex 대시보드 셋, Claude 대시보드 셋이 함께 나옵니다. 결과는 metrics.makgol.com에서 봅니다. 아래 사고는 스크립트로 올리던 때의 일입니다.

작업 첫날에는 사고도 한 번 났습니다. Claude 대시보드를 고치던 세션이 푸시한 커밋(`8d2ce4f`)이 곧바로 origin/main에서 사라진 것입니다. 이 Codex 작업을 하던 다른 세션이 deltatocumulative 커밋과 Codex 대시보드 커밋을 밀어 넣으면서 그 커밋이 빠진 것입니다. argocd selfHeal이 켜져 있던 탓에 클러스터의 ConfigMap까지 이전 버전으로 돌아갔습니다. origin/main 위로 rebase한 뒤 `a63310f`로 다시 올려서 수습했습니다.

그 뒤로는 montstrap에 올릴 때마다 정해 둔 순서를 지킵니다. `git fetch`와 `git rebase origin/main`으로 최신 커밋 위에 올리고, 푸시한 다음 `git ls-remote origin main`으로 HEAD가 내 커밋인지 확인한 뒤 argocd가 반영한 revision까지 대조합니다. 공통 대시보드를 올리던 세션은 메모리에 남아 있던 이 사고 기록을 읽고 푸시하기 전에 이 순서를 먼저 제안했습니다. 클러스터에 반영된 것처럼 보이더라도 커밋이 원격에 닿았는지는 따로 확인해야 합니다.

## 남은 것

- ChatGPT 로그인이라 Codex 비용은 여전히 추정뿐입니다. 환산 패널은 기회비용 참고치로만 봅니다.
- 맥이나 다른 머신에서 돌린 Codex는 hub로 들어오지 않습니다. 설정이 이 pod의 `~/.codex/config.toml`과 `~/.bashrc`에만 있기 때문입니다.
- 같은 code-server의 alice·bob pod에는 아직 Claude와 Codex 모두 적용하지 않았습니다. 설정 파일이 각자 홈에 있어서 따로 넣어야 합니다.
- ClickHouse에 들어온 Codex 이벤트에는 `workspace.user`가 붙어 있지 않습니다. 그래서 사용자 변수를 고르면 이벤트가 걸러지고, 사용자 수를 세는 패널은 0으로 나옵니다.
- Codex 대시보드 쿼리의 `or` 절은 옛 시리즈가 90일 보관으로 사라지는 2026-12-27 이후에 왼쪽 절을 걷어냅니다.
- 대시보드를 만들던 생성 스크립트는 아직 VictoriaLogs를 전제로 만들어져 있습니다. 이제는 git의 YAML을 원본으로 봅니다.
- 이관한 이벤트 패널은 SQL이 실행되는 것까지만 확인했습니다. 그룹 시계열 범례 같은 화면 렌더링은 Grafana에서 따로 확인해야 합니다.
