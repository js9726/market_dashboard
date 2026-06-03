# Fixing the equity snapshot (wrong `acc_id`)

**Symptom:** `/dashboard/equity` hides the broker "account value" line and warns
that the bridge total (e.g. **$103k**) doesn't reconcile with your real account
(cash + positions ≈ **$12k**). The bridge log shows
`equity reconciliation FAILED: total_assets=... vs cash+market_val=... (Nx)`.

**Cause:** `accinfo_query` is returning totals for the **wrong moomoo account**
(an aggregate/family view or a different sub-account), or a margin
buying-power figure — not your real trading account's net assets.

**The dashboard is safe meanwhile:** it shows your reliable **realized-P&L
curve** (from your sheet) and refuses to display the bad broker number. Fixing
the `acc_id` below makes the broker net-account-value line appear.

## Verify + set the correct `acc_id` (on the bridge PC, OpenD running)

```python
# verify_acc.py — run on the PC where OpenD is running
from moomoo import OpenSecTradeContext, TrdEnv, TrdMarket, RET_OK

ctx = OpenSecTradeContext(filter_trdmarket=TrdMarket.US, host="127.0.0.1", port=11111)

# 1. List every account + its id
ret, accs = ctx.get_acc_list()
print(accs[["acc_id", "trd_env", "acc_type", "trdmarket_auth"]] if ret == RET_OK else accs)

# 2. For each REAL acc_id, check which one matches your real ~$12k account
for acc_id in accs.loc[accs["trd_env"] == "REAL", "acc_id"]:
    ret, info = ctx.accinfo_query(trd_env=TrdEnv.REAL, acc_id=acc_id, refresh_cache=True)
    if ret == RET_OK:
        r = info.iloc[0]
        print(acc_id, "total_assets=", r.get("total_assets"),
              "cash=", r.get("us_cash") or r.get("cash"), "market_val=", r.get("market_val"))
ctx.close()
```

Pick the `acc_id` whose `total_assets` ≈ `cash + market_val` ≈ your real account
(~$12k), then set it in your bridge config:

```toml
# dashboard-bridge.toml
[opend]
acc_id = <the correct id>
```

Restart the bridge. The next snapshot reconciles and the account-value line
returns on `/dashboard/equity`.
