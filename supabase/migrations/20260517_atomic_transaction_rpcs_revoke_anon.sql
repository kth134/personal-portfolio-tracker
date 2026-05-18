-- Revoke default PUBLIC EXECUTE on the new SECURITY DEFINER RPCs.
-- Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION; that
-- means the anon role can call these endpoints (they would still fail
-- inside on the `auth.uid() IS NULL` check, but the advisor flags it
-- correctly: principle of least privilege).

REVOKE EXECUTE ON FUNCTION public.recompute_fifo_for_asset(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_buy_with_lot(uuid, uuid, date, numeric, numeric, numeric, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.process_sell_fifo(uuid, uuid, date, numeric, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bulk_import_transactions(jsonb) FROM PUBLIC, anon;
