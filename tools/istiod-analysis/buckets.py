#!/usr/bin/env python3
"""15분 버킷별 재연결 레이트 — 정상 순환 vs 파드 교체발 강제 재접속 분리."""
import csv, sys, statistics as st
from datetime import datetime

def load(path):
    rows = list(csv.reader(open(path, newline='')))
    pods = [h.split('-')[-1] for h in rows[0][1:]]
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

def run(path, label, keepalive_min):
    times, series = load(path)
    N = len(times); step = (times[1]-times[0]).total_seconds()
    print(f"\n{'='*96}\n{label}   (keepalive 가정 {keepalive_min}m)\n{'='*96}")
    print(f"{'버킷':>11} {'활성':>4} {'총conn':>7} {'정상재연결':>10} {'교체발강제':>10} "
          f"{'합계':>7} {'이론치':>7} {'배수':>5} {'CoV%':>6} {'파드-':>5}")
    print("-"*96)
    B = int(15*60/step)
    for s in range(0, N-1, B):
        e = min(s+B, N-1)
        if e - s < B//3: continue
        gain = dead = 0.0; deaths = 0
        for p, v in series.items():
            for i in range(s+1, e+1):
                a, b = v[i-1], v[i]
                if a is None and b is None: continue
                if a is None: continue
                if b is None:
                    dead += a or 0; deaths += 1; continue
                if b > a: gain += b - a
        secs = (times[e]-times[s]).total_seconds()
        vs = [series[p][e] for p in series if series[p][e] is not None]
        tot = sum(vs); act = len(vs)
        m = st.mean(vs) if vs else 0
        cov = st.pstdev(vs)/m*100 if m else 0
        theo = tot/(keepalive_min*60)
        rate_g, rate_d = gain/secs, dead/secs
        total_rate = rate_g + rate_d
        print(f"{times[s]:%H:%M}~{times[e]:%H:%M} {act:4d} {tot:7.0f} "
              f"{rate_g:9.2f}/s {rate_d:9.2f}/s {total_rate:6.2f}/s {theo:6.2f}/s "
              f"{(total_rate/theo if theo else 0):4.1f}x {cov:5.1f} {deaths:5d}")

if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2], float(sys.argv[3]))
