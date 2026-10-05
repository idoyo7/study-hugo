---
title: "02 Codex CLI 관측과 공통 대시보드 — Claude Code와 한 화면에"
date: 2026-09-22
lastmod: 2026-10-04
weight: 2
url: "/ai-tools/02-codex-otel/"
---

# Codex CLI 관측과 공통 대시보드 — 두 CLI를 한 화면에서 보기

{{< callout type="info" >}}
2026-10-04 현재 Codex는 HyperDX 컬렉터로 보내며, 로그·트레이스는 ClickHouse에, delta 메트릭은 VictoriaMetrics에 저장합니다. otel-gateway·VictoriaLogs·Tempo를 쓰던 시기의 설정과 14일 실측은 당시 조건을 붙여 구분했습니다. 수집 경로를 바꾼 과정은 [관측 스택 일원화]({{< relref "/platform/homelab/03-observability-consolidation/index.md" >}})에 있습니다.
{{< /callout >}}

Claude Code로 작업하면서 1차 코드리뷰와 교차검증은 `codex-relay` 에이전트로 Codex에 넘깁니다. `~/.claude/CLAUDE.md`에는 haiku < sonnet < opus < fable 순의 티어 규칙을 두었습니다. Anthropic 쿼터를 줄이려는 이 운영 방식이 실제 사용량에 어떻게 나타나는지 보려면 두 CLI의 토큰과 호출을 함께 비교해야 했습니다.

[지난 편]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})에서 Claude Code를 연결한 날 오후에 Codex도 같은 hub 파이프라인에 붙였습니다. 수집 경로는 공유하지만 토큰의 정의와 메트릭 집계 방식, 비용 신호 유무가 달라 공통 대시보드에서 그 차이를 맞췄습니다.

## Codex의 exporter와 리소스 속성 {#codex-설정은-configtoml-한-블록}

Codex의 로그·메트릭·트레이스 exporter는 `~/.codex/config.toml`의 `[otel]` 테이블에서 각각 설정합니다. 사용 중인 `codex-cli 0.154.0`에서는 다음 블록으로 hub에 보냅니다.

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

Claude Code는 `OTEL_EXPORTER_OTLP_ENDPOINT`에 베이스 주소를 주면 SDK가 `/v1/metrics` 같은 경로를 붙입니다. Codex는 신호마다 endpoint 전체 경로를 적어야 합니다. `metrics_exporter`를 비워 두면 기본값인 `statsig`가 OpenAI 자체 수집 쪽으로 내보내므로, hub에 보내려면 `otlp-http`를 명시해야 합니다.

리소스 속성에는 설정 키가 없어 `~/.bashrc`에 환경변수를 넣었습니다. Rust OTel SDK의 환경변수 리소스 디텍터가 이 값을 읽습니다. Claude Code와 같은 `workspace.user` 라벨로 대시보드의 사용자 변수를 맞추려는 설정입니다.

```bash
export OTEL_RESOURCE_ATTRIBUTES="workspace.user=mont,deployment.environment=hub"
```

프롬프트 본문은 `log_user_prompt = false`로 내보내지 않습니다. 원래 설정은 `config.toml.bak-pre-otel`로 보관했습니다. 리소스 속성 환경변수를 설정했어도 현재 ClickHouse의 Codex 이벤트에는 `workspace.user`가 없습니다. 메트릭의 사용자 필터와 이벤트의 사용자 필터가 같은 결과를 낸다고 가정하면 안 됩니다.

| 신호 | 경로 | 저장소 |
|---|---|---|
| 이벤트 로그 | hdx 컬렉터 :4328 `/v1/logs` | ClickHouse `otel_logs` (90d) |
| 메트릭 | hdx 컬렉터 :4328 `/v1/metrics` → OTLP | VictoriaMetrics 테넌트 0 (delta 그대로) |
| 트레이스 | hdx 컬렉터 :4328 `/v1/traces` → ClickHouse + spanmetrics | ClickHouse `otel_traces` (90d), spanmetrics는 VictoriaMetrics |

컬렉터의 입구와 파이프라인은 [01편]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})에 적었습니다.

## delta 메트릭과 이전 cumulative 시리즈 집계 {#또-메트릭만-안-들어온다}

현재 HyperDX 컬렉터는 메트릭을 remote write를 거치지 않고 OTLP로 VictoriaMetrics에 보냅니다. `deltatocumulative`가 없는 컬렉터 이미지에서 Codex의 delta 메트릭은 그대로 저장됩니다. 새 시리즈의 샘플은 이미 증가분이므로 `sum_over_time()`으로 합산합니다.

이전 gateway가 cumulative로 바꿔 저장한 시리즈도 아직 남아 있습니다. 옛 시리즈에만 `job` 라벨이 있으므로 이 라벨로 집계 방식을 나눕니다. Codex 대시보드는 `increase_pure(M{sel}[r])` 대신 `(increase_pure(M{sel,job!=""}[r]) or sum_over_time(M{sel,job=""}[r]))`를 사용합니다. M은 메트릭, sel은 나머지 라벨 조건, r은 조회 범위입니다. 옛 시리즈가 90일 보관으로 사라지는 2026-12-27 이후에는 왼쪽 절을 제거합니다.

### 이전 gateway에서 delta를 변환했던 이유

다음 YAML과 장애 기록은 지금은 제거한 otel-gateway를 사용하던 때의 구성입니다.

당시 첫 테스트에서는 이벤트와 트레이스가 도착했지만 메트릭만 VictoriaMetrics에 없었습니다. Claude Code와 마찬가지로 prometheusremotewrite exporter가 delta 데이터포인트를 에러 없이 버린 것이 원인이었습니다.

Claude Code는 `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative`로 내보내기 설정을 바꿀 수 있었습니다. 그러나 Codex는 OTLP 메트릭을 delta로 고정합니다. 게이트웨이 매니페스트 주석에 적은 근거는 `codex-rs/otel/src/metrics/client.rs`의 하드코딩된 동작이며 설정으로 바꿀 수 없었습니다. 그래서 당시에는 gateway에서 cumulative로 변환했습니다.

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

프로세서는 `metrics` 파이프라인에만 추가하고 spanmetrics 커넥터의 `metrics/spanmetrics` 파이프라인에는 넣지 않았습니다. cumulative로 들어오는 Claude Code 메트릭은 그대로 통과했습니다. montstrap에서도 `305a43a Add deltatocumulative processor to otel-gateway metrics pipeline` 이후 `f7341a3 Add Codex CLI OTel Grafana dashboards` 순서로 반영했습니다.

`max_stale: 10m`를 쓰면 10분 동안 데이터가 없는 스트림의 상태를 gateway가 잊고, 다음 입력부터 0으로 다시 셉니다. 한 시리즈 안에서도 카운터가 리셋되므로 당시 대시보드 쿼리에는 `increase_pure()`를 적용했습니다. [01편]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})에서 설명한 세션별 새 시리즈와 같은 집계 방식입니다. 현재 delta 시리즈의 합산에는 이 규칙을 적용하지 않습니다.

문제를 해결한 뒤에는 실제 codex-relay 경로와 같은 `codex exec`를 돌려, 토큰 메트릭이 VictoriaMetrics에 들어오는 것까지 확인했습니다.

## 이름 규칙이 Claude와 다르다

Codex의 토큰·지연·호출 수는 이름만 보고 집계하면 다른 동작을 셀 수 있습니다.

`codex_turn_token_usage`는 턴마다 한 번 관측되는 히스토그램입니다. 토큰 합계를 읽을 대상은 `codex_turn_token_usage_sum`이며, 앞 절처럼 이전 cumulative 시리즈에는 `increase_pure()`, 현재 delta 시리즈에는 `sum_over_time()`을 적용합니다. `token_type` 라벨은 `total`, `input`, `cached_input`, `cache_write_input`, `output`, `reasoning_output`을 구분합니다.

단위가 ms인 히스토그램은 이름에 단위 접미가 한 번 더 붙습니다. 그래서 첫 토큰 지연이 `codex_turn_ttft_duration_ms_milliseconds_bucket`처럼 이중 접미로 들어옵니다. 원본 이름만 보고 쿼리를 쓰면 아무것도 잡히지 않습니다. 이 이름은 remote write 경로에서 처음 봤지만 접미는 OTLP 경로에서도 그대로입니다. OTLP로 VictoriaMetrics의 별도 테넌트에 먼저 직접 넣어 본 카나리에서도 `codex_sqlite_logs_write_duration_ms_milliseconds_*`가 같은 이중 접미로 들어왔습니다.

모델 호출 수는 WebSocket 통신을 세는 `codex_websocket_request_total`에서 봅니다. `codex_api_request_total`이나 `codex.api_request` 이벤트를 모델 호출 수로 읽으면 대부분의 `/models` 폴링까지 포함하게 됩니다. Codex 이벤트 640건이 전부 `/models` 폴링이고 실제 턴은 0건인 날도 있었습니다. astra의 마지막 턴 기록이 09-11인 것을 확인하니 수집 누락이 아니라 그 뒤 이 pod에서 Codex를 사용하지 않은 경우였습니다.

`service.name`에는 originator가 들어갑니다. TUI로 쓰면 `codex_cli_rs`, `codex exec`로 돌리면 `codex_exec`입니다. codex-relay 위임은 exec 경로로 돌기 때문에, 이 라벨을 보면 직접 쓴 것과 위임한 것을 대략 구분할 수 있습니다. 한때 `codex exec`가 메트릭을 내보내지 않는 버그(#12913)가 있었고 2026-02에 닫혔습니다. 붙인 뒤에 exec 경로로 한 번 더 확인한 것도 그 때문입니다.

## 비용 신호가 없다

Codex는 API 키로 과금할 때만 `codex.turn_cost` 이벤트와 `codex_turn_cost_microusd_total` 메트릭을 냅니다. 이 환경은 ChatGPT 계정으로 로그인하므로 둘 다 없습니다. Codex 개별 대시보드는 토큰과 턴 수를 보여 주고 비용 패널은 두지 않았습니다. 공통 대시보드에는 Claude의 평균단가를 적용한 환산 패널을 따로 두되 추정값으로 표시합니다.

## Codex 대시보드 셋

처음에는 VictoriaLogs용 쿼리가 있는 grafana.com의 [24641 OpenAI Codex (VictoriaStack)](https://grafana.com/grafana/dashboards/24641)를 가져왔습니다. 원저자 조직의 department·team 구조는 생성 스크립트 `build-codex-dashboards.py`에서 치환했습니다. 현재는 이 대시보드도 ClickHouse SQL로 옮겼고 수정 원본은 git의 YAML입니다.

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

별도로 만든 Codex · Usage는 20패널을 한 섹션에 모은 개요입니다. Codex · Optimization은 11행 92패널로, 다음 순서로 구성했습니다.

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

ClickHouse에서 응답 완료는 `LogAttributes['event.name'] = 'codex.sse_event' AND LogAttributes['event.kind'] = 'response.completed'`로 찾습니다. 이 이벤트의 `input_token_count`, `cached_token_count`, `model_reasoning_effort`를 사용하면 요청 단위 캐시 미스를 셀 수 있습니다. 쿼리 결과 열과 Grafana 매크로 규칙은 [01편]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})과 같습니다.

아래는 Optimization의 '캐시 미스 요청' 패널입니다. 입력 토큰 중 캐시 읽기가 절반 미만인 응답을 셉니다. 다만 이 개별 패널에는 사용자 필터가 남아 있습니다. 현재 Codex 이벤트에는 `workspace.user`가 없으므로 특정 사용자를 선택하면 해당 이벤트가 빠집니다. 공통 대시보드는 뒤에서 설명하는 대로 이벤트에 사용자 필터를 적용하지 않습니다.

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

`AI CLI · Common (Claude Code ↔ Codex)`에서는 토큰 정의와 모델 티어를 맞춰 두 CLI를 비교합니다. 초기 구성은 8섹션 24패널이었고, 비교 항목을 늘린 뒤에는 12행 80패널이 됐습니다. `build-common-dashboard.py`가 원본 JSON 없이 코드로 생성했지만 이 생성기 역시 VictoriaLogs 기준입니다. 현재는 git의 YAML을 수정합니다.

### 토큰 유형을 맞춰 비교하기 {#토큰을-같은-축에-세우기}

Claude의 `input`, `output`, `cacheRead`, `cacheCreation`은 서로 겹치지 않습니다. Codex는 `total = input + output`이고 `cached_input`은 `input`의 일부, `reasoning_output`은 `output`의 일부입니다. 모두 더하면 같은 토큰을 중복 집계하므로 공통 대시보드에서는 다음처럼 분류합니다.

| 정규화 축 | Claude | Codex |
|---|---|---|
| 비캐시 입력 | `type="input"` | `token_type="input"` − `token_type="cached_input"` |
| 캐시 읽기 | `type="cacheRead"` | `token_type="cached_input"` |
| 캐시 쓰기 | `type="cacheCreation"` | `token_type="cache_write_input"` |
| 출력 | `type="output"` | `token_type="output"` (reasoning_output 포함) |

총 토큰의 정의도 서로 다릅니다. Claude는 네 유형을 전부 더하지만 Codex는 `total`에 `cache_write_input`만 더합니다. 캐시 히트율 역시 Claude는 `cacheRead / (input + cacheRead)`, Codex는 `cached_input / input`로 식이 다르지만 "입력 중 캐시에서 읽은 비율"이라는 뜻은 같습니다.

### 모델 이름에 티어 라벨 붙이기 {#티어-사다리를-라벨로}

CLAUDE.md의 라우팅 규칙을 사용량과 비교하려고 모델 이름에 티어 라벨을 붙였습니다. 두 CLI의 모델을 하나의 표로 관리합니다.

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

모델 라우팅 정책을 바꾸면 이 표도 함께 바꿔야 합니다. 처음에는 sol=표준, terra=심층, astra=최상으로 매핑했지만 CLAUDE.md는 standard=sol·high, deep=astra·medium으로 변경된 상태였습니다. 대시보드가 심층 위임을 "최상"으로 분류하는 오류를 확인하고 TIERS의 심층을 terra에서 astra로 고쳤습니다(`542af3f`).

### 빈 벡터 가드

비율 패널은 분모가 0이거나 양쪽 다 매치가 없으면 Grafana에 "No data"가 뜹니다. Codex를 쓰지 않은 날에는 Codex 쪽 패널이 전부 그렇게 되기 때문에 나눗셈마다 가드를 넣었습니다.

```python
def safe_div(num, den):
    return f"(({num} or vector(0)) / ({den} > 0)) or vector(0)"
```

캐시 재사용 배수처럼 시계열로 그리는 비율에는 [01편]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})의 `default 0`을 붙이지 않고 분모가 0인 구간만 `safe_div`가 0으로 채웁니다.

### Codex 토큰을 Claude 단가로 환산하기 {#비용-공백은-추정으로-추정이라고-적어서}

쿼터 전가 효과 행은 Claude의 `claude_code_cost_usage_USD_total`로 집계한 USD를 사용합니다. Codex에는 비용 신호가 없으므로 같은 기간 Claude의 평균단가(비용 ÷ 토큰)를 Codex 정규화 토큰에 곱합니다. 패널 이름은 "Codex 토큰 → Claude 단가 환산 (추정 USD)"입니다. 실제 지출이 아니라 같은 토큰을 Claude로 처리했을 때의 기회비용 참고치이며, codex-relay가 Anthropic 쿼터를 얼마나 덜어 줬는지 가늠하는 용도입니다.

아래 코드는 gateway가 cumulative로 변환하던 때의 Codex 정규화 총 토큰 식입니다. 현재 패널에는 앞에서 설명한 `or sum_over_time()` 절이 각 Codex `increase_pure()`에 추가돼 있습니다.

```promql
(sum(increase_pure(codex_turn_token_usage_sum{workspace_user=~"$user",token_type="total"}[$__range])) or vector(0))
  + (sum(increase_pure(codex_turn_token_usage_sum{workspace_user=~"$user",token_type="cache_write_input"}[$__range])) or vector(0))
```

이 총 토큰에 Claude 비용 합 ÷ Claude 토큰 합을 `safe_div`로 곱합니다.

### 이벤트 쿼리는 ServiceName으로만

구버전 Codex 로그에는 `workspace.user`가 없었고, 현재 ClickHouse로 들어오는 Codex 이벤트에도 이 속성이 없습니다. 따라서 공통 대시보드의 `$user`는 메트릭 쿼리에만 적용합니다. 이벤트는 `ServiceName = 'claude-code'`와 `match(ServiceName, 'codex.*')`로 선택해야 사용자 속성이 없는 레코드도 포함할 수 있습니다. '통합 이벤트 스트림' 패널은 아래 조건으로 두 CLI의 이벤트를 읽습니다.

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
5. 사용량 개요(대시보드의 「한눈에」 행)
6. 활동 타임라인
7. 토큰 구성 · 캐시
8. 모델 믹스
9. 지연 비교
10. 도구
11. 오류 · 신뢰성
12. 이벤트 · 트레이스

메트릭 표현식은 vmselect에 직접 보내 결과를 확인했습니다. 이후 ClickHouse로 옮긴 이벤트 SQL은 실행까지 확인했으며, 그룹 시계열 범례 등 Grafana 화면 검증은 아직 남아 있습니다.

## 비교하면서 추가한 지연·도구 패널 {#대조하다-보니-보인-것}

이 절의 이벤트 수치는 VictoriaLogs에서 읽던 당시 값입니다.

각 CLI에만 있던 분석 항목을 비교해 공통 대시보드 커밋(`49f05f3`)에서 개별 대시보드도 보강했습니다.

Claude의 `api_request`에는 요청마다 첫 토큰 지연인 `ttft_ms`가 있었지만 대시보드에서 사용하지 않았습니다. Codex의 지연 프로파일 행을 참고해 Claude Optimization에도 같은 행을 추가했습니다. `subagent_completed`에 들어 있던 `agent_type`, `model`, `final_model`, `model_swapped`, `total_tokens`, `total_tool_uses`도 분석에 사용하기 시작했습니다.

MCP 연결 이벤트를 상태별로 나눠 보니 `connected`는 평균 2.3초, `disconnected`는 7.5~11초였습니다. 끊기는 쪽에서 붙는 쪽보다 세 배 넘는 시간이 걸립니다.

Codex Optimization의 `exec 호출 (command_category 별)`에 대응해 Claude의 Bash 명령 집계를 추가했습니다. 01편에서 남겨 두었던 작업입니다. 당시 LogsQL `unpack_json`으로 `tool_parameters`에서 `bash_command`를 꺼내 세니 `cd` 136, `sed` 31, `grep` 28 순이었습니다. 현재는 같은 값을 ClickHouse의 `JSONExtractString(LogAttributes['tool_parameters'], 'bash_command')`로 읽습니다.

| 대시보드 | 패널 수 |
|---|---|
| claude-code-optimization | 50 → 80 |
| codex-optimization | 56 → 92 |
| ai-cli-common | 신규 80 |

## 14일 실측

아래 집계는 otel-gateway·VictoriaLogs·Tempo를 쓰던 시기의 실측입니다. 이벤트 수치를 뽑은 VictoriaLogs가 지금은 없으므로 같은 쿼리를 그대로 재실행할 수는 없습니다.

메트릭 집계 기간은 2026-09-08부터 09-22까지 14일입니다. VictoriaMetrics에서 `increase_pure()`로 읽었으며 Claude는 OTel 데이터만(`source!="backfill"`) 포함했습니다. 당시 VictoriaLogs 보존 기간은 7일이어서 뒤의 이벤트 수치는 최근 7일치입니다.

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

Claude의 $519.1을 모델별로 나누면 fable-5-1과 opus-5[1m]의 비중이 컸습니다.

| 모델 | 비용 |
|---|---|
| fable-5-1 | $211.8 |
| opus-5[1m] | $204.9 |
| sonnet-5 | $84.8 |
| haiku-4-5 | $17.6 |
| 합계 | $519.1 |

출처별로는 main $291.6, subagent $180.1, auxiliary $47.5였습니다. 구독 요금제로 사용했으므로 청구액이 아니라 API 단가 환산액입니다. 예약 티어로 둔 fable이 모델별 환산 비용에서 가장 컸습니다.

Codex의 첫 토큰 지연은 p50이 4.7초, p95가 35.8초였습니다. 14일 동안 `codex_websocket_request_total`은 1,105건이었습니다. 훅은 PostToolUse가 1,267회로 압도적으로 많았고 그 뒤로 Stop 69, UserPromptSubmit 64, SessionStart 41 순입니다.

최근 7일 이벤트를 `event.name:codex.*`로 세면 대부분 폴링인 `api_request`가 2,776건으로 가장 많았습니다. 그 뒤로 `tool_result` 998, `tool_decision` 523, `websocket_request` 503, `sse_event` 484였습니다. 도구 호출은 exec_command와 exec가 많았습니다.

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

대시보드 YAML은 montstrap의 `hub/opentelemetry/manifests/`에서 argocd로 배포합니다. `victoria-metrics` 네임스페이스의 ConfigMap에 `vm_grafana_dashboard: "1"` 라벨을 붙이면 Grafana 사이드카가 읽습니다. 이 라벨로 조회되는 대시보드는 `ai-cli-common-dashboard`, Codex 셋, Claude 셋이며 metrics.makgol.com에서 봅니다. 초기에는 생성 스크립트가 매니페스트를 만들었고, 현재는 앞서 설명한 git의 YAML을 수정합니다.

초기 배포 때 Claude 대시보드 커밋(`8d2ce4f`)이 푸시 직후 origin/main에서 사라졌습니다. 다른 세션이 deltatocumulative와 Codex 대시보드 커밋을 올리면서 이 변경을 빠뜨렸고, argocd selfHeal이 ConfigMap까지 이전 버전으로 되돌렸습니다. origin/main 위로 rebase한 뒤 `a63310f`로 다시 올려 복구했습니다.

이후에는 `git fetch`, `git rebase origin/main`으로 최신 원격 커밋 위에 변경을 올립니다. 푸시 뒤 `git ls-remote origin main`으로 HEAD를 확인하고 argocd가 반영한 revision도 대조합니다. 클러스터의 현재 화면만으로는 원격 저장소에 원하는 변경이 남아 있는지 판단할 수 없기 때문입니다.

## 남은 것

- ChatGPT 로그인이라 Codex 비용은 여전히 추정뿐입니다. 환산 패널은 기회비용 참고치로만 봅니다.
- 맥이나 다른 머신에서 돌린 Codex는 hub로 들어오지 않습니다. 설정이 이 pod의 `~/.codex/config.toml`과 `~/.bashrc`에만 있기 때문입니다.
- 같은 code-server의 alice·bob pod에는 아직 Claude와 Codex 모두 적용하지 않았습니다. 설정 파일이 각자 홈에 있어서 따로 넣어야 합니다.
- ClickHouse의 Codex 이벤트에는 `workspace.user`가 없습니다. 사용자 필터가 남은 개별 대시보드는 사용자를 선택하면 이벤트가 빠지고, 사용자 수 패널은 0으로 나옵니다. 공통 대시보드의 이벤트는 이 필터를 적용하지 않습니다.
- Codex 대시보드 쿼리의 `or` 절은 옛 시리즈가 90일 보관으로 사라지는 2026-12-27 이후에 왼쪽 절을 걷어냅니다.
- 이관한 이벤트 패널은 SQL이 실행되는 것까지만 확인했습니다. 그룹 시계열 범례 같은 화면 렌더링은 Grafana에서 따로 확인해야 합니다.
