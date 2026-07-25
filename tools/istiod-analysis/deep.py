#!/usr/bin/env python3
"""2차 분석: 커넥션 턴오버(재연결 레이트) 추정, 파드 churn 타임라인, 이상 구간 확대."""
import csv, sys, statistics as st
from datetime import datetime, timedelta

def load(path):
    rows = list(csv.reader(open(path, newline='')))
    pods = [h.split('-')[-1] for h in rows[0][1:]]
    times, series = [], {p: [] for p in pods}
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        vals = r[1:]
        if all(v.strip() == '' for v in vals):
            continue
        try:
            parsed = [float(v) if v.strip() else None for v in vals]
        except ValueError:
            continue
        times.append(datetime.strptime(r[0], '%Y-%m-%d %H:%M:%S'))
        for p, x in zip(pods, parsed):
            series[p].append(x)
    return times, series

def turnover(times, series, N, step):
    """파드별 증가분의 합 = 새로 맺어진 커넥션 수 ≈ 재연결 레이트.
    파드 생성/소멸 순간(None↔값 전이)은 제외해 순수 재연결만 센다."""
    gained, lost, churn_gain, churn_lost = [], [], [], []
    for i in range(1, N):
        g = l = cg = cl = 0.0
        for p, v in series.items():
            a, b = v[i-1], v[i]
            if a is None and b is None:
                continue
            if a is None:                 # 파드 신규 등장
                cg += b or 0; continue
            if b is None:                 # 파드 소멸
                cl += a or 0; continue
            d = b - a
            if d > 0: g += d
            else:     l += -d
        gained.append(g); lost.append(l)
        churn_gain.append(cg); churn_lost.append(cl)
    return gained, lost, churn_gain, churn_lost

def report(path, label, zoom=None):
    times, series = load(path)
    N = len(times); step = (times[1]-times[0]).total_seconds()
    span_min = (times[-1]-times[0]).total_seconds()/60
    print(f"\n{'='*74}\n{label}\n{'='*74}")
    print(f"{times[0]:%m-%d %H:%M} ~ {times[-1]:%H:%M}  {span_min:.0f}분  step {step:.0f}s")

    act = [sum(1 for p in series if series[p][i] is not None) for i in range(N)]
    tot = [sum(series[p][i] for p in series if series[p][i] is not None) for i in range(N)]

    g, l, cg, cl = turnover(times, series, N, step)
    sec = span_min * 60
    print(f"\n[커넥션 턴오버 — 재연결 레이트 추정]")
    print(f"  기존 파드가 새로 받은 커넥션 총합 : {sum(g):8.0f}  →  {sum(g)/sec:5.2f} conn/s")
    print(f"  기존 파드가 잃은 커넥션 총합     : {sum(l):8.0f}  →  {sum(l)/sec:5.2f} conn/s")
    print(f"  파드 신규 등장으로 유입           : {sum(cg):8.0f}")
    print(f"  파드 소멸로 강제 이탈             : {sum(cl):8.0f}  ← 이만큼이 통째로 재접속해야 함")
    med_tot = st.median(tot)
    print(f"\n  관측 중앙 총 커넥션 {med_tot:.0f}개 기준 이론 재연결 레이트:")
    for age in (30, 15):
        print(f"    keepalive {age:2d}m → {med_tot/(age*60):5.2f} conn/s")
    print(f"  실측(기존 파드 순수 획득분)       → {sum(g)/sec:5.2f} conn/s")
    print(f"  실측(파드 소멸 유발 강제 재접속 포함) → {(sum(g)+sum(cl))/sec:5.2f} conn/s")

    # 파드 churn 타임라인
    print(f"\n[파드 등장·소멸 타임라인]")
    births, deaths = {}, {}
    for p, v in series.items():
        idx = [i for i, x in enumerate(v) if x is not None]
        if not idx: continue
        if idx[0] > 0: births.setdefault(times[idx[0]].replace(second=0), []).append(p)
        if idx[-1] < N-1: deaths.setdefault(times[idx[-1]].replace(second=0), []).append((p, v[idx[-1]]))
    for t in sorted(set(births) | set(deaths)):
        b = births.get(t, []); d = deaths.get(t, [])
        lostc = sum(c for _, c in d)
        print(f"  {t:%H:%M}  +{len(b):2d}  -{len(d):2d}"
              f"{'   소멸 파드가 들고 있던 커넥션 ' + str(int(lostc)) if d else ''}")

    # 이상 구간 확대
    if zoom:
        a, b = zoom
        print(f"\n[확대 {a}~{b}]  시각  활성  총합  최소  최대  CoV%   최대보유 파드")
        for i in range(N):
            hm = f"{times[i]:%H:%M}"
            if not (a <= hm <= b): continue
            if times[i].second % 30: continue
            vs = {p: series[p][i] for p in series if series[p][i] is not None}
            if not vs: continue
            m = st.mean(vs.values()); cov = st.pstdev(vs.values())/m*100 if m else 0
            mx = max(vs, key=vs.get)
            print(f"  {times[i]:%H:%M:%S}  {len(vs):3d}  {sum(vs.values()):6.0f}  "
                  f"{min(vs.values()):4.0f}  {max(vs.values()):5.0f}  {cov:5.1f}   {mx}({vs[mx]:.0f})")

    # 스케일아웃 후 재수렴 시간
    print(f"\n[CoV 추이 — 재수렴 속도]")
    covs = []
    for i in range(N):
        vs = [series[p][i] for p in series if series[p][i] is not None]
        m = st.mean(vs) if vs else 0
        covs.append(st.pstdev(vs)/m*100 if m else 0)
    over = [(times[i], covs[i], act[i]) for i in range(N) if covs[i] > 20]
    if over:
        print(f"  CoV>20% 인 시점 {len(over)}개 ({len(over)*step/60:.1f}분 상당)")
        runs, cur = [], [over[0]]
        for prev, nxt in zip(over, over[1:]):
            if (nxt[0]-prev[0]).total_seconds() <= step*3: cur.append(nxt)
            else: runs.append(cur); cur = [nxt]
        runs.append(cur)
        for r in runs:
            dur = (r[-1][0]-r[0][0]).total_seconds()/60
            print(f"    {r[0][0]:%H:%M:%S} ~ {r[-1][0]:%H:%M:%S}  ({dur:5.1f}분)  "
                  f"최대 CoV {max(x[1] for x in r):5.1f}%  활성 {r[0][2]}→{r[-1][2]}")
    return times, series

if __name__ == '__main__':
    zoom = (sys.argv[3], sys.argv[4]) if len(sys.argv) > 4 else None
    report(sys.argv[1], sys.argv[2], zoom)
