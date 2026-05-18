-- Enable RLS on asset_prices and historical_prices (audit ref C1).
--
-- Both tables are exposed through PostgREST to the anon and authenticated
-- roles. Until now RLS was off, so any visitor with the NEXT_PUBLIC anon
-- key (which is in every browser bundle by design) could INSERT, UPDATE,
-- or DELETE every price row in the database.
--
-- Policy plan:
--   - Authenticated users can SELECT every row (prices are global, not
--     user-scoped; every dashboard page reads them).
--   - Only the service_role can INSERT / UPDATE / DELETE — used by the
--     consolidated refreshPrices() helper which now goes through a
--     service-role client.
--   - anon gets no access at all.
--
-- This change requires the matching code refactor (PR G) to be deployed,
-- or the dashboard's manual `Refresh prices` button will start returning
-- 403 errors. The new code path uses createServiceRoleClient() which
-- writes as service_role and bypasses RLS, so it'll work post-deploy.

-- Drop the pre-existing always-true policies. They were inert while RLS
-- was off, but would defeat the new restrictive policies once RLS is on.
DROP POLICY IF EXISTS asset_prices_authenticated_read ON public.asset_prices;
DROP POLICY IF EXISTS asset_prices_authenticated_write ON public.asset_prices;
DROP POLICY IF EXISTS asset_prices_authenticated_update ON public.asset_prices;
DROP POLICY IF EXISTS asset_prices_authenticated_delete ON public.asset_prices;
DROP POLICY IF EXISTS historical_prices_authenticated_read ON public.historical_prices;
DROP POLICY IF EXISTS historical_prices_authenticated_write ON public.historical_prices;
DROP POLICY IF EXISTS historical_prices_authenticated_update ON public.historical_prices;
DROP POLICY IF EXISTS historical_prices_authenticated_delete ON public.historical_prices;

ALTER TABLE public.asset_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "asset_prices read" ON public.asset_prices;
CREATE POLICY "asset_prices read"
  ON public.asset_prices FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "asset_prices service-role writes" ON public.asset_prices;
CREATE POLICY "asset_prices service-role writes"
  ON public.asset_prices FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "historical_prices read" ON public.historical_prices;
CREATE POLICY "historical_prices read"
  ON public.historical_prices FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "historical_prices service-role writes" ON public.historical_prices;
CREATE POLICY "historical_prices service-role writes"
  ON public.historical_prices FOR ALL
  TO service_role USING (true) WITH CHECK (true);
