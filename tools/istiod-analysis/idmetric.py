#!/usr/bin/env python3
"""새 CSV 4종의 값 분포로 지표 정체를 판정하고 사건 구간을 확대한다."""
import csv, sys, statistics as st
from datetime import datetime

def load(path):
    rows = list(csv.reader(open(path, newline='')))
    pods = [h.split('-')[-1] if h.startswith('istiod') else h for h in rows[0][1:]]
    times, series = [], {p: [] for p in pods}
    for r in rows[1:]:
        if not r or not r[0].strip(): continue
        vals = r[1:]
        if all(v.strip() == '' for v in vals): continue
        try: parsed = [float(v) if v.strip() else None for v in vals]
        except ValueError: continue
        times.append(datetime.strptime(r[0], '%Y-%m-%d %H:%M:%S'))
        for p, x in zip(pods, parsed): series[p].append(x)
    return times, series

def summarize(path, label):
    times, series = load(path)
    N = len(times)
    flat = [x for v in series.values() for x in v if x is not None]
    print(f"\n{'='*78}\n{label}\n  {path.split('/')[-1]}")
    print(f"  {times[0]:%H:%M} ~ {times[-1]:%H:%M}  {N}포인트  계열 {len(series)}개  표본 {len(flat)}개")
    if not flat: return times, series
    flat.sort()
    q = lambda p: flat[min(len(flat)-1, int(len(flat)*p))]
    print(f"  min {min(flat):.5f}  p50 {q(.5):.5f}  p90 {q(.9):.5f}  p99 {q(.99):.5f}  max {max(flat):.5f}")
    print(f"  0인 표본 {sum(1 for x in flat if x==0)}개 ({sum(1 for x in flat if x==0)/len(flat)*100:.1f}%)")
    return times, series

def timeline(times, series, label, top=3, every=8):
    """시점별 max/mean과 최대 계열 이름"""
    print(f"\n  [{label}] 시각  계열수  평균     최대     최대계열")
    N = len(times)
    for i in range(0, N, every):
        vs = {p: series[p][i] for p in series if series[p][i] is not None}
        if not vs: continue
        mx = max(vs, key=vs.get)
        print(f"    {times[i]:%H:%M:%S}  {len(vs):3d}  {st.mean(vs.values()):8.5f}  "
              f"{vs[mx]:8.5f}  {mx}")

if __name__ == '__main__':
    import glob, os
    base = os.path.expanduser('~/evejuni/temp')
    files = [
        ('18_36_49', 'A — 파드별 계열 (68컬럼, 1-20-2 리비전 포함)'),
        ('18_36_57', 'B — 파드별 계열 (67컬럼)'),
        ('18_37_08', 'C — pilot_proxy_convergence_time p99'),
        ('18_37_12', 'D — pilot_xds_push_time p99'),
    ]
    store = {}
    for key, label in files:
        path = glob.glob(f'{base}/*{key}*.csv')[0]
        store[key] = summarize(path, label)
    # 사건 구간 확대
    for key, label in files[:2]:
        print(f"\n{'-'*78}\n{label} — 09:30~11:00 추이")
        timeline(*store[key], label=key, every=8)
