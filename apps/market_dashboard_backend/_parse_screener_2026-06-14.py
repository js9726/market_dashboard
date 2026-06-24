import json, collections
p = r"C:\Users\jiesh\AI codes hub\market_dashboard\apps\market_dashboard_backend\data\tv_screeners.json"
d = json.load(open(p, encoding="utf-8"))
print("fetched_at:", d["fetched_at"], "| market_open:", d["market_was_open"])
seen = collections.OrderedDict()
inds = collections.Counter()
USER = {"INTC","ARM","QCOM","RVMD","IREN","SANM","FORM","VMI","CIFR","VSH","SIMO","VICR","NOKBF","ALGM","TWLO","NTAP"}
for sc in d["screeners"]:
    print(f"\n=== {sc['name']} ({sc['id']}) - {len(sc['hits'])} hits ===")
    rows = sorted(sc["hits"], key=lambda h: (h.get("score") or 0), reverse=True)
    for h in rows[:8]:
        t = h["ticker"]; chg = h.get("change") or 0; p1m = h.get("Perf.1M") or 0
        rv = h.get("relative_volume_10d_calc") or 0; mc = (h.get("market_cap_basic") or 0)/1e9
        ind = h.get("industry") or "?"
        flag = " <-USER" if t in USER else ""
        print(f"  {t:<7} {h.get('verdict','?'):<4} sc={h.get('score',0):>3} {h.get('pattern','?'):<10} d={chg:+6.1f}% 1M={p1m:+7.1f}% RVOL={rv:>4.1f} ${mc:>6.1f}B {ind[:22]}{flag}")
        if t not in seen: seen[t] = h
        inds[ind] += 1
print("\n=== TOP INDUSTRIES (appearances across screeners) ===")
for ind, c in inds.most_common(12):
    print(f"  {c:>2}  {ind}")
print("\n=== GO-verdict unique tickers (score>=80) ===")
gos = [(t, h) for t, h in seen.items() if h.get("verdict") == "GO"]
for t, h in sorted(gos, key=lambda x: -(x[1].get("score") or 0)):
    rv = h.get("relative_volume_10d_calc") or 0
    print(f"  {t:<7} sc={h.get('score')} {h.get('pattern')} RVOL={rv:.1f} d={h.get('change'):+.1f}% 1M={h.get('Perf.1M'):+.1f}% {h.get('industry','?')[:28]}")
print("\n=== Overlap: USER tickers appearing in screeners ===")
for t in USER:
    if t in seen:
        h = seen[t]
        print(f"  {t}: {h.get('verdict')} sc={h.get('score')} {h.get('pattern')} RVOL={h.get('relative_volume_10d_calc'):.1f}")
