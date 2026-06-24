import json, collections
p = r"C:\Users\jiesh\AI codes hub\market_dashboard\apps\market_dashboard_backend\data\tv_screeners.json"
d = json.load(open(p, encoding="utf-8"))
print("fetched_at:", d["fetched_at"], "| market_open:", d["market_was_open"])
seen = collections.OrderedDict()
for sc in d["screeners"]:
    for h in sc["hits"]:
        t = h["ticker"]
        if t not in seen:
            seen[t] = h
rows = sorted(seen.values(), key=lambda h: -(h.get("score") or 0))
print(f"\nUnique tickers: {len(seen)}  |  Conviction bands GO>=75 / WAIT 50-74 / PASS<50\n")
print(f"{'TKR':<7}{'Conv':>5} {'V':<5}{'Setup':>6}{'Entry':>6}{'Theme':>6}{'Sent':>5}  {'pattern':<10}{'RVOL':>5}")
print("-"*68)
for h in rows[:14]:
    st = h.get("stages") or {}
    rv = h.get("relative_volume_10d_calc") or 0
    print(f"{h['ticker']:<7}{h.get('score',0):>5} {h.get('verdict','?'):<5}"
          f"{st.get('setup','?'):>6}{st.get('entry','?'):>6}{st.get('theme','?'):>6}{st.get('sentiment','?'):>5}  "
          f"{h.get('pattern','?'):<10}{rv:>5.1f}")
gos = [h for h in rows if h.get("verdict") == "GO"]
print(f"\nGO (>=75): {', '.join(h['ticker']+'('+str(h.get('score'))+')' for h in gos) or 'none'}")
# confirm keys are the new model
sample = rows[0].get("stages") or {}
print("stages keys:", list(sample.keys()))
