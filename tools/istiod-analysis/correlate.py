#!/usr/bin/env python3
"""CPU · 스로틀 · convergence · push_time 네 지표를 한 시간축에 정렬한다."""
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

def agg(times, series, how='max'):
    """시점별 집계 → {datetime: (max, mean, n, argmax)}"""
    out = {}
    for i, t in enumerate(times):
        vs = {n: series[n][i] for n in series if series[n][i] is not None}
        if not vs: continue
        mx = max(vs, key=vs.get)
        out[t] = (vs[mx], st.mean(vs.values()), len(vs), mx)
    return out

def single(times, series):
    """단일 계열(히스토그램 분위수) → {datetime: value}"""
    out = {}
    for i, t in enumerate(times):
        vs = [series[n][i] for n in series if series[n][i] is not None]
        if vs: out[t] = max(vs)
    return out

cpu   = agg(*load('18_36_49'))
thr   = agg(*load('18_36_57'))
conv  = single(*load('18_37_08'))
push  = single(*load('18_37_12'))

ts = sorted(set(cpu) & set(thr) & set(conv) & set(push))
print(f"정렬된 공통 시점 {len(ts)}개  {ts[0]:%H:%M} ~ {ts[-1]:%H:%M}\n")
print("  시각      파드  CPU최대  CPU평균 | 스로틀최대 스로틀평균 스로틀>0 | conv_p99 push_p99")
print("-"*100)
for i, t in enumerate(ts):
    if i % 8: continue
    cmx, cmn, cn, cwho = cpu[t]
    tmx, tmn, tn, twho = thr[t]
    nz = sum(1 for v in [thr[t][0]] if v > 0)
    print(f"  {t:%H:%M:%S}  {cn:3d}  {cmx:7.4f}  {cmn:7.4f} | "
          f"{tmx:9.3f} {tmn:10.3f} {'':8} | {conv[t]:8.4f} {push[t]:8.4f}")

# 상관
print("\n[구간별 요약]")
def window(a, b, label):
    sel = [t for t in ts if f"{a}" <= f"{t:%H:%M}" <= f"{b}"]
    if not sel: return
    cm = max(cpu[t][0] for t in sel); ca = st.mean(cpu[t][1] for t in sel)
    tm = max(thr[t][0] for t in sel); ta = st.mean(thr[t][1] for t in sel)
    cv = max(conv[t] for t in sel);   pu = max(push[t] for t in sel)
    frac = sum(1 for t in sel if thr[t][0] > 0) / len(sel) * 100
    print(f"  {label:24s} CPU최대 {cm:.3f}  CPU평균 {ca:.4f} | "
          f"스로틀최대 {tm:5.2f} 평균 {ta:5.3f} 발생시점 {frac:4.0f}% | "
          f"conv_p99 {cv:.3f}  push_p99 {pu:.3f}")

window("09:30", "09:39", "평시 09:30~09:39")
window("09:40", "09:47", "파드 대량소멸 09:40~09:47")
window("09:48", "10:00", "쏠림 고착 09:48~10:00")
window("10:01", "10:17", "회복 10:01~10:17")
window("10:18", "11:00", "스케일아웃 10:18~11:00")

# 스로틀 상위 시점
print("\n[스로틀 최대값 상위 12개 시점]")
tops = sorted(ts, key=lambda t: -thr[t][0])[:12]
for t in sorted(tops):
    tmx, tmn, tn, twho = thr[t]
    cmx, cmn, cn, cwho = cpu[t]
    print(f"  {t:%H:%M:%S}  스로틀 {tmx:5.2f}({twho})  그때 CPU최대 {cmx:.4f}({cwho})  "
          f"conv {conv[t]:.3f}  push {push[t]:.3f}")

# CPU 최대값이 limit(0.6)에 얼마나 근접했나
allcpu = [cpu[t][0] for t in ts]
print(f"\n[CPU vs limit 600m]")
print(f"  파드별 CPU 최대의 최대 {max(allcpu):.4f} 코어 = {max(allcpu)*1000:.0f}m  (limit 600m의 {max(allcpu)/0.6*100:.0f}%)")
print(f"  전 구간 CPU최대의 중앙값 {st.median(allcpu):.4f} 코어 = {st.median(allcpu)*1000:.0f}m")
