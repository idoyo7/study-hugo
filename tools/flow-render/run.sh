#!/bin/sh
# 도식 검증 전부 — 스크립트나 스펙을 고쳤으면 이걸 돌린다.
set -e
cd "$(dirname "$0")/../.."
echo "== rstep 렌더 스모크 (좌표·NaN·이탈) =="
node tools/flow-render/rstep-smoke.js static/flow/rstep.js
echo "== rstep 의미 검사 (그림이 참말을 하나) =="
node tools/flow-render/rstep-assert.js static/flow/rstep.js
echo "== nextra 이식 모듈 ↔ Hugo 엔진 패리티 =="
node tools/flow-render/port-parity.js
echo "== flow·seq 스펙 린트 =="
node tools/flow-render/spec-lint.js $(find content -path '*/_flow/*.json' -o -path '*/_seq/*.json' | sort)
