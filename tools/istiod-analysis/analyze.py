#!/usr/bin/env python3
"""istiod pilot_xds 파드별 시계열 패턴 분석 (Grafana Explore CSV)."""
import csv, sys, statistics as st
from datetime import datetime

def load(path):
    with open(path, newline='') as fh:
        rows = list(csv.reader(fh))
    hdr = rows[0]
    pods = [h.split('-')[-1] for h in hdr[1:]]
    times, series = [], {p: [] for p in pods}
    skipped = []
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        vals = r[1:]
        if all(v.strip() == '' for v in vals):
            continue                      # 전 파드 공백 = 수집 경계, 버린다
        try:
            parsed = [float(v) if v.strip() else None for v in vals]
        except ValueError:
            skipped.append(r[0])          # Grafana export가 끼워넣은 비정형 행
            continue
        times.append(datetime.strptime(r[0], '%Y-%m-%d %H:%M:%S'))
        for p, x in zip(pods, parsed):
            series[p].append(x)
    if skipped:
        print(f"  [주의] 비정형 행 {len(skipped)}개 건너뜀: {skipped[:3]}")
    return times, series

def alive_span(v):
    idx = [i for i, x in enumerate(v) if x is not None]
    return (idx[0], idx[-1]) if idx else None

def report(path, label):
    times, series = load(path)
    N = len(times)
    step = (times[1] - times[0]).total_seconds()
    span = (times[-1] - times[0]).total_seconds() / 60
    print(f"\n{'='*72}\n{label}\n{'='*72}")
    print(f"구간 {times[0]} ~ {times[-1]}  ({span:.0f}분, {N}포인트, step {step:.0f}s)")
    print(f"파드 컬럼 {len(series)}개")

    # ── 파드 생애 ──
    spans = {p: alive_span(v) for p, v in series.items()}
    spans = {p: s for p, s in spans.items() if s}
    lifetimes = []
    born_after_start, died_before_end = [], []
    for p, (a, b) in spans.items():
        mins = (times[b] - times[a]).total_seconds() / 60
        lifetimes.append((mins, p, a, b))
        if a > 0: born_after_start.append(p)
        if b < N - 1: died_before_end.append(p)
    lifetimes.sort()
    print(f"\n[파드 churn]")
    print(f"  관측 중 새로 뜬 파드 : {len(born_after_start)}")
    print(f"  관측 중 사라진 파드 : {len(died_before_end)}")
    print(f"  전 구간 생존 : {sum(1 for _,_,a,b in lifetimes if a==0 and b==N-1)}")
    print(f"  수명 중앙값 {st.median(m for m,_,_,_ in lifetimes):.0f}분, "
          f"최단 {lifetimes[0][0]:.0f}분({lifetimes[0][1]}), 최장 {lifetimes[-1][0]:.0f}분")
    short = [(m, p) for m, p, a, b in lifetimes if m < 20 and a > 0]
    if short:
        print(f"  20분 미만 단명 파드 {len(short)}개: " +
              ", ".join(f"{p}({m:.0f}m)" for m, p in short[:12]))

    # ── 시점별 집계 ──
    print(f"\n[시점별 분포]  시각 활성 총합 평균 최소 최대 CoV%")
    agg = []
    for i in range(N):
        vs = [series[p][i] for p in series if series[p][i] is not None]
        if not vs:
            agg.append(None); continue
        m = st.mean(vs)
        cov = (st.pstdev(vs) / m * 100) if m else 0
        agg.append({'n': len(vs), 'sum': sum(vs), 'mean': m,
                    'min': min(vs), 'max': max(vs), 'cov': cov})
    every = max(1, int(300 / step))       # 5분 간격 출력
    for i in range(0, N, every):
        a = agg[i]
        if not a: continue
        print(f"  {times[i]:%H:%M}  {a['n']:3d}  {a['sum']:6.0f}  {a['mean']:6.1f}  "
              f"{a['min']:5.0f}  {a['max']:5.0f}  {a['cov']:5.1f}")

    covs = [a['cov'] for a in agg if a]
    sums = [a['sum'] for a in agg if a]
    ns = [a['n'] for a in agg if a]
    print(f"\n  CoV        중앙값 {st.median(covs):.1f}%  최소 {min(covs):.1f}%  최대 {max(covs):.1f}%")
    print(f"  총 커넥션  중앙값 {st.median(sums):.0f}  범위 {min(sums):.0f}~{max(sums):.0f}")
    print(f"  활성 파드  중앙값 {st.median(ns):.0f}  범위 {min(ns)}~{max(ns)}")

    # ── 재연결 이벤트 탐지: 파드별 커넥션 급감 ──
    # 15초 스텝에서 직전 대비 큰 폭 하락 = GoAway로 커넥션이 끊긴 순간
    drops = []
    for p, v in series.items():
        for i in range(1, N):
            a, b = v[i-1], v[i]
            if a is None or b is None or a < 5:
                continue
            d = a - b
            if d >= max(3, a * 0.25):     # 25% 이상 또는 3개 이상 감소
                drops.append((times[i], p, a, b, d))
    drops.sort()
    print(f"\n[커넥션 급감(=강제 종료 추정) 이벤트]  총 {len(drops)}건")
    if drops:
        per_min = len(drops) / span
        print(f"  분당 {per_min:.2f}건, 파드당 시간당 "
              f"{len(drops)/ (span/60) / st.median(ns):.2f}건")
        # 파드별 급감 간격 → 주기성
        bypod = {}
        for t, p, a, b, d in drops:
            bypod.setdefault(p, []).append(t)
        gaps = []
        for p, ts in bypod.items():
            for x, y in zip(ts, ts[1:]):
                gaps.append((y - x).total_seconds() / 60)
        if gaps:
            gaps.sort()
            print(f"  같은 파드 연속 급감 간격 {len(gaps)}쌍 — "
                  f"중앙값 {st.median(gaps):.1f}분, "
                  f"25%tile {gaps[len(gaps)//4]:.1f}분, 75%tile {gaps[3*len(gaps)//4]:.1f}분")
            hist = {}
            for g in gaps:
                hist[int(g // 2.5) * 2.5] = hist.get(int(g // 2.5) * 2.5, 0) + 1
            print("  간격 히스토그램(2.5분 bin):")
            for k in sorted(hist):
                if hist[k] >= 2:
                    print(f"    {k:5.1f}~{k+2.5:5.1f}분 : {'#' * min(hist[k], 60)} {hist[k]}")
        # 분당 급감 건수 시계열 (재연결 물결 확인)
        bucket = {}
        for t, *_ in drops:
            key = t.replace(second=0, microsecond=0)
            bucket[key] = bucket.get(key, 0) + 1
        vals = sorted(bucket.values())
        print(f"  급감이 발생한 분(minute) {len(bucket)}개 / 전체 {span:.0f}분 — "
              f"분당 최대 {max(vals)}건, 중앙값 {st.median(vals):.0f}건")
        top = sorted(bucket.items(), key=lambda kv: -kv[1])[:8]
        print("  급감 집중 분: " + ", ".join(f"{t:%H:%M}({c})" for t, c in top))
    return times, series, agg, drops

if __name__ == '__main__':
    for path, label in [(sys.argv[1], sys.argv[2])] if len(sys.argv) > 2 else []:
        report(path, label)
