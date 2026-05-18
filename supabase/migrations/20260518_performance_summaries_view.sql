-- Replace performance_summaries table with a derived view (audit ref C5).
--
-- The table was maintained by a trigger whose DELETE branch was a stub
-- comment, so deleting a transaction silently desynced the summaries
-- (`backfill_performance_summaries` body was likewise stubbed). Worse, the
-- live data contained stale rows for grouping_types the trigger never
-- updated (`asset_type`, `geography`, `factor_tag`, `size_tag`,
-- `asset_subtype`, `sub_portfolio`) — populated by some historical code
-- path and never refreshed. None of those grouping_types are referenced
-- in src/ today; the only reader is `src/app/dashboard/page.tsx:681`
-- which filters on `grouping_type = 'asset'`.
--
-- Replacing the table with a view eliminates the staleness, the broken
-- DELETE branch, and the lurking stale-grouping rows in one step. The
-- view always reflects current transactions, with no trigger to maintain.
-- `security_invoker = true` makes the view execute under the calling
-- user's RLS on `transactions`, so per-user isolation is preserved.

DROP TRIGGER IF EXISTS update_performance_summaries ON public.transactions;
DROP FUNCTION IF EXISTS public.update_performance_summaries() CASCADE;
DROP FUNCTION IF EXISTS public.backfill_performance_summaries() CASCADE;
DROP TABLE IF EXISTS public.performance_summaries CASCADE;

CREATE VIEW public.performance_summaries
WITH (security_invoker = true) AS
SELECT
  user_id,
  'asset'::text AS grouping_type,
  asset_id::text AS grouping_id,
  COALESCE(SUM(realized_gain) FILTER (WHERE type = 'Sell'), 0)::numeric AS realized_gain,
  COALESCE(SUM(amount) FILTER (WHERE type = 'Dividend'), 0)::numeric AS dividends,
  COALESCE(SUM(amount) FILTER (WHERE type = 'Interest'), 0)::numeric AS interest,
  COALESCE(SUM(fees), 0)::numeric AS fees
FROM public.transactions
WHERE asset_id IS NOT NULL
GROUP BY user_id, asset_id

UNION ALL

SELECT
  user_id,
  'account'::text AS grouping_type,
  account_id::text AS grouping_id,
  COALESCE(SUM(realized_gain) FILTER (WHERE type = 'Sell'), 0)::numeric AS realized_gain,
  COALESCE(SUM(amount) FILTER (WHERE type = 'Dividend'), 0)::numeric AS dividends,
  COALESCE(SUM(amount) FILTER (WHERE type = 'Interest'), 0)::numeric AS interest,
  COALESCE(SUM(fees), 0)::numeric AS fees
FROM public.transactions
WHERE account_id IS NOT NULL
GROUP BY user_id, account_id;

GRANT SELECT ON public.performance_summaries TO authenticated;
