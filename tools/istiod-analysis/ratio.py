#!/usr/bin/env python3
"""보정 스로틀 쿼리(신규) vs 원 쿼리(구) 대조 + CPU와의 정렬."""
import csv, glob, os, statistics as st
from datetime import datetime

BASE = os.path.expanduser('~/evejuni/temp')

def load(key):
    path = glob.glob(f'{BASE}/*{key}*.csv')[0]
    rows = list(csv.reader(open(path, newline='')))
    names = [h.split('-')[-1] if h.startswith('istiod') else h for h in rows[0][1:]]
    times, series = [], {n: [] for n in names}
    for r in rows[1:]:
        if not r or not r[0].strip(): continue
        vals = r[1:]
        if all(v.strip() == '' for v in vals): continue
        try: parsed = [float(v) if v.strip() else None for v in vals]
        except ValueError: continue
        times.append(datetime.strptime(r[0], '%Y-%m-%d %H:%M:%S'))
        for n, x in zip(names, parsed): series[n].append(x)
    return times, series

def stats(key, label):
    times, series = load(key)
    flat = sorted(x for v in series.values() for x in v if x is not None)
    q = lambda p: flat[min(len(flat)-1, int(len(flat)*p))]
    print(f"\n{label}")
    print(f"  {times[0]:%H:%M}~{times[-1]:%H:%M}  계열 {len(series)}  표본 {len(flat)}")
    print(f"  min {min(flat):.5f}  p50 {q(.5):.5f}  p90 {q(.9):.5f}  p99 {q(.99):.5f}  max {max(flat):.5f}")
    print(f"  0인 표본 {sum(1 for x in flat if x==0)/len(flat)*100:.1f}%   1.0 초과 표본 {sum(1 for x in flat if x>1.0)}개")
    return times, series

def agg(times, series):
    out = {}
    for i, t in enumerate(times):
        vs = {n: series[n][i] for n in series if series[n][i] is not None}
        if vs:
            mx = max(vs, key=vs.get)
            out[t] = (vs[mx], st.mean(vs.values()), mx)
    return out

new = stats('20_28_04', '[신규] 보정 쿼리')
old = stats('18_36_57', '[기존] sum(rate(throttled_periods[2m])) by (pod)')
cpu = stats('18_36_49', '[참고] CPU 사용량(코어)')

N, O, C = agg(*new), agg(*old), agg(*cpu)
ts = sorted(set(N) & set(O) & set(C))

print(f"\n[구간별 대조]  신규최대  신규평균 | 기존최대  기존평균 | 비(기존/신규) | CPU최대")
print("-"*92)
def win(a, b, label):
    sel = [t for t in ts if a <= f"{t:%H:%M}" <= b]
    if not sel: return
    nmx = max(N[t][0] for t in sel); nmn = st.mean(N[t][1] for t in sel)
    omx = max(O[t][0] for t in sel); omn = st.mean(O[t][1] for t in sel)
    cmx = max(C[t][0] for t in sel)
    ratio = omx/nmx if nmx else float('nan')
    print(f"  {label:22s} {nmx:8.4f} {nmn:9.4f} | {omx:8.3f} {omn:9.4f} | {ratio:11.2f} | {cmx:.4f}")
win("09:30","09:39","평시 09:30~09:39")
win("09:40","09:47","파드 대량소멸")
win("09:48","10:00","쏠림 고착")
win("10:01","10:17","회복")
win("10:18","11:00","스케일아웃")

print(f"\n[신규 지표 상위 12 시점]")
for t in sorted(sorted(ts, key=lambda t: -N[t][0])[:12]):
    print(f"  {t:%H:%M:%S}  비율 {N[t][0]:.4f} ({N[t][2]})  평균 {N[t][1]:.4f}  "
          f"| 기존 {O[t][0]:6.3f}  | CPU최대 {C[t][0]:.4f}")

# 기존/신규 비율의 전역 추정 — 중복 합산 배수 판정
pairs = [(O[t][0], N[t][0]) for t in ts if N[t][0] > 0.01]
if pairs:
    rs = sorted(o/n for o, n in pairs)
    print(f"\n[기존 ÷ 신규] 표본 {len(rs)}개  p10 {rs[len(rs)//10]:.2f}  중앙값 {st.median(rs):.2f}  "
          f"p90 {rs[9*len(rs)//10]:.2f}")
    print("  10에 가까우면 신규=분율·기존=초당 period수 (같은 신호, 단위만 다름)")
    print("  20에 가까우면 기존이 계열 2개를 중복 합산한 것")
