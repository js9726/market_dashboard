import json
d = json.load(open(r"C:\Users\jiesh\AI codes hub\market_dashboard\apps\market_dashboard_backend\data\tv_screeners.json", encoding="utf-8"))
seen = {}
for sc in d["screeners"]:
    for h in sc["hits"]:
        seen.setdefault(h["ticker"], h)
for t in ["PAYO", "SABS", "TRIP", "QNC", "CHEF", "FA", "ELVR"]:
    h = seen.get(t)
    if not h:
        print(t, "not found"); continue
    print(f"{t:<6} {h.get('verdict'):<4} conv={h.get('score'):<3} {h.get('pattern'):<9} "
          f"day={(h.get('change') or 0):+6.1f}% 1M={(h.get('Perf.1M') or 0):+6.1f}% "
          f"RVOL={(h.get('relative_volume_10d_calc') or 0):>5.1f} ${(h.get('market_cap_basic') or 0)/1e9:>6.2f}B "
          f"{str(h.get('sector'))[:20]} | {str(h.get('industry'))[:28]}")
