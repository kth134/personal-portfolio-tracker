# RAINvest

Personal investment portfolio tracker. Tracks holdings, cost basis (FIFO tax lots), realized and unrealized P&L, IRR/TWR performance, drift-based rebalancing across sub-portfolios, and a glide-path-aware Grok chat for what-if analysis.

Live at [rainvest.xyz](https://rainvest.xyz).

## Stack

- **App:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind 4, shadcn/ui
- **Data:** Supabase (Postgres + Auth + RLS), Vercel KV / Upstash Redis _(planned)_
- **Charts:** Recharts
- **Chat:** xAI Grok with web-search tool via Serper
- **Price feeds:** Finnhub (primary stocks) → Alpha Vantage (mutual-fund fallback), CoinGecko (crypto), Polygon _(unused — slated for consolidation)_
- **Tests:** Playwright
- **Deploy:** Vercel

## Local development

```bash
npm install
cp .env.local.example .env.local  # populate from your Supabase/Vercel envs
npm run dev                       # http://localhost:3000
npm run lint
npx playwright test               # full regression
```

## Required env vars

Set in `.env.local` for dev and in Vercel for deploys:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; for cron + privileged writes |
| `GROK_API_KEY` | xAI Grok API key |
| `GROK_MODEL` | Defaults to `grok-4.20-0309-reasoning`; also pinned in `vercel.json` |
| `FINNHUB_API_KEY` | Primary stock price feed |
| `ALPHA_VANTAGE_API_KEY` | Mutual-fund / fallback feed |
| `SERPER_API_KEY` | Grok web-search tool |
| `RAINVEST_EMAIL` / `RAINVEST_PASSWORD` | Test account for the Playwright suite |
| `CRON_SECRET` _(planned)_ | Lets the daily price-fetch cron bypass `proxy.ts` auth |

## Architecture notes

- `src/proxy.ts` is the auth gate on `/api/*` (Next 16 renamed `middleware.ts` → `proxy.ts`).
- Server Supabase client lives in `src/lib/supabase/server.ts`; browser client in `src/lib/supabase/client.ts`.
- Multi-step financial mutations (Buy + tax_lot, Sell + FIFO depletion + realized_gain) live in `src/app/actions/transactionactions.ts`. **Planned move to Postgres RPCs for atomicity** — see the audit report.
- Cash balances are computed in `src/lib/finance.ts:calculateEffectiveCashBalances`, which combines transaction flows with `account_cash_anchors` (manual end-of-day balances).
- Grok integration in `src/app/actions/grok.ts` does a server-only deep-analysis pass on tax-lot data before sending only aggregated, rounded data to xAI.

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the canonical runbook (pre-build checks → Playwright → deploy → post-deploy regression).

## Audit & roadmap

A full code/security/accuracy audit is captured in [`../RAINvest-audit-report.md`](../RAINvest-audit-report.md) (workspace root, not committed). Open issues are tracked in the project's backlog spreadsheet.
