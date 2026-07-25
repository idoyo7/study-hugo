#!/usr/bin/env python3
"""같은 파드·같은 시각에서 CPU와 스로틀 분율을 짝지어 quota 산술을 검증한다."""
import csv, glob, os, statistics as st
from datetime import datetime

BASE = os.path.expanduser('~/evejuni/temp')
LIMIT = 0.6          # CPU limit 600m 가정
PERIOD_MS = 100.0
QUOTA_MS = LIMIT * PERIOD_MS

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

tc, cpu = load('18_36_49')
tt, thr = load('20_28_04')
idx_c = {t: i for i, t in enumerate(tc)}
idx_t = {t: i for i, t in enumerate(tt)}
common_t = sorted(set(tc) & set(tt))
pods = sorted(set(cpu) & set(thr))
print(f"공통 시점 {len(common_t)}개, 공통 파드 {len(pods)}개\n")

# (파드, 시각) 단위 조인
rows = []
for t in common_t:
    i, j = idx_c[t], idx_t[t]
    for p in pods:
        c, r = cpu[p][i], thr[p][j]
        if c is None or r is None: continue
        rows.append((t, p, c, r))
print(f"조인된 (파드,시각) 표본 {len(rows)}개")

thr_pos = [x for x in rows if x[3] > 0]
print(f"스로틀>0 인 표본 {len(thr_pos)}개 ({len(thr_pos)/len(rows)*100:.1f}%)\n")

print("[스로틀 분율 상위 12 — 같은 파드의 CPU를 나란히]")
print("   시각        파드      스로틀분율  CPU(코어)  CPU(ms/period)  비스로틀period당")
for t, p, c, r in sorted(rows, key=lambda x: -x[3])[:12]:
    cpu_ms = c * PERIOD_MS
    # r 비율의 period는 quota를 다 씀 → 나머지 period의 평균 사용
    rest = (cpu_ms - r * QUOTA_MS) / (1 - r) if r < 1 else float('nan')
    print(f"  {t:%H:%M:%S}  {p:8s}  {r:9.4f}  {c:9.4f}  {cpu_ms:12.2f}  {rest:14.2f}")

print("\n[구간별 — 파드 단위 최대와 그 파드의 CPU]")
def win(a, b, label):
    sel = [x for x in rows if a <= f"{x[0]:%H:%M}" <= b]
    if not sel: return
    t, p, c, r = max(sel, key=lambda x: x[3])
    cs = [x[2] for x in sel]
    mean_r = st.mean(x[3] for x in sel)
    print(f"  {label:22s} 최대스로틀 {r:.4f} @{t:%H:%M:%S} {p:8s} (그 파드 CPU {c:.4f}={c*1000:.0f}m, "
          f"limit의 {c/LIMIT*100:3.0f}%) | 평균스로틀 {mean_r:.4f} | 구간 CPU최대 {max(cs):.4f}")
win("09:30","09:39","평시")
win("09:40","09:47","파드 대량소멸")
win("09:48","10:00","쏠림 고착")
win("10:01","10:17","회복")
win("10:18","11:00","스케일아웃")

# 전역: 스로틀 분율 가중 산술
peak = max(rows, key=lambda x: x[3])
t, p, c, r = peak
print(f"\n[피크 시점 산술]  {t:%H:%M:%S}  {p}")
print(f"  CPU {c:.4f} 코어 = period당 {c*PERIOD_MS:.2f}ms   (limit 600m의 {c/LIMIT*100:.0f}%)")
print(f"  스로틀된 period 분율 f = {r:.4f}")
print(f"  가정: 스로틀 period는 quota {QUOTA_MS:.0f}ms를 소진")
rest = (c*PERIOD_MS - r*QUOTA_MS) / (1-r)
print(f"  ⇒ 비스로틀 period 평균 사용 = ({c*PERIOD_MS:.2f} - {r:.4f}×{QUOTA_MS:.0f}) / {1-r:.4f} = {rest:.2f}ms")
if rest < 0:
    print(f"  ⚠ 음수 — 스로틀 period가 quota를 다 쓰지 않았거나 CPU limit이 600m가 아니라는 뜻")

# limit 추정: 스로틀이 걸린 표본에서 CPU/f 관계로 상한 역산
print(f"\n[CPU limit 역산 시도]")
for lo, hi in [(0.2,0.3),(0.3,0.4)]:
    sub = [x for x in rows if lo <= x[3] < hi]
    if len(sub) < 5: continue
    cs = sorted(x[2] for x in sub)
    print(f"  스로틀 {lo:.0%}~{hi:.0%} 인 표본 {len(sub)}개 → CPU 중앙값 {st.median(cs):.4f} "
          f"({st.median(cs)*1000:.0f}m), 최대 {max(cs):.4f} ({max(cs)*1000:.0f}m)")
