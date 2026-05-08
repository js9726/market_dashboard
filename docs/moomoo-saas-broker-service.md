# MooMoo SaaS Broker Service

## Decision

MooMoo should become a tenant-aware broker and quote provider for market_dashboard, but it should be separate from generic runtime trading skills.

Start with Jie Sheng's own MooMoo/OpenD connection for read-only quotes and paper-trading experiments. Later, each SaaS user must connect their own MooMoo/OpenD before using broker-powered quotes, paper trading, backtesting, positions, or live trading.

## Why It Is Separate

`packages/core-skills/` should hold portable prompt and knowledge artifacts. Broker connectivity is different:

- It has user credentials and account permissions.
- It is tenant-specific.
- It can place orders in the future.
- It may require a local OpenD process or a secure bridge that Vercel cannot directly reach.

So MooMoo belongs behind a broker service boundary, not inside a general skill folder.

## Target Architecture

```text
Next.js SaaS app
  -> Broker API routes
  -> Broker service interface
  -> MooMoo connector
  -> User-owned OpenD / hosted bridge / secure sidecar
```

The app should call a provider-neutral interface:

```text
getQuote(symbol, tenantId)
getCandles(symbol, range, tenantId)
getAccountSnapshot(tenantId)
getPositions(tenantId)
placePaperOrder(order, tenantId)
```

Live order methods stay disabled until explicit safety controls exist.

## Data Provider Policy

Use MooMoo when the user has connected it:

- Live ticker quotation
- Candles and intraday data if available
- Account snapshot
- Positions
- Paper order status

Use existing public data providers as fallback:

- yfinance
- yahoo-finance2
- Finviz
- Google Finance fallback in the Python pipeline

The UI should show which provider powered the data so users can trust freshness and understand limitations.

## Phases

### Phase 1: Owner-only read-only connector

- Add a `BrokerProvider` interface.
- Add `MooMooProvider` behind a feature flag.
- Support quotes/candles only.
- Store no live trading credentials in repo.
- Keep Vercel separated from local OpenD unless a secure bridge is present.

### Phase 2: Paper trading and backtesting

- Add paper orders.
- Add simulated fills.
- Add strategy backtest runner using historical candles.
- Require the user to connect MooMoo/OpenD before enabling this feature.

### Phase 3: Multi-client SaaS connections

- Add per-user broker connection records.
- Encrypt credentials/tokens.
- Add connection health checks.
- Add audit logs for every broker request.
- Add quota/rate-limit controls per tenant.

### Phase 4: Live trading, if ever approved

- Require a separate permission level.
- Require order preview and explicit confirmation.
- Add kill switch and max-loss controls.
- Add full audit trail and email alerts.

## Skill Relationship

Global skills stay as operator guidance:

- `C:/Users/jiesh/.claude/skills/moomooapi`
- `C:/Users/jiesh/.claude/skills/install-moomoo-opend`

The SaaS must not read those folders at runtime. If their knowledge is needed in the app, sync a deployable artifact through `packages/core-skills/skill-sync.manifest.json` after the broker service exists.
