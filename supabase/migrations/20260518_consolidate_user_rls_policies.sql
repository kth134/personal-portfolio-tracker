-- Consolidate per-user RLS policies (audit refs H13 + H14).
--
-- Before this migration most user-scoped tables carried both a blanket
-- "User Access" FOR ALL policy AND four per-action policies that said the
-- exact same thing. Postgres evaluates every PERMISSIVE policy on every
-- row, so each query was paying the cost of redundant identical
-- expressions (Supabase's perf advisor flagged 103 such cases). On top of
-- that, every expression was a bare `auth.uid() = user_id`, which the
-- planner re-evaluates per row instead of init-planning once per query.
--
-- Replace with one `FOR ALL TO authenticated` policy per table using
-- `(SELECT auth.uid()) = user_id`. The subquery form lets Postgres
-- evaluate auth.uid() once per query as an InitPlan, and `TO authenticated`
-- skips evaluation for anon entirely.
--
-- Special cases:
--   - `account_cash_anchors` owns membership via accounts join; the same
--     subquery optimization applies. Anchors were previously immutable
--     (no UPDATE policy), so we recreate only SELECT / INSERT / DELETE.
--   - `asset_targets` had two parallel policy families ("Users can ..."
--     and `asset_targets_*_own`); both are dropped.

-- ============================================================================
-- accounts
-- ============================================================================
DROP POLICY IF EXISTS "User Access" ON public.accounts;
DROP POLICY IF EXISTS "Users can view own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can insert own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can update own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can delete own accounts" ON public.accounts;
CREATE POLICY accounts_self ON public.accounts
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- assets
-- ============================================================================
DROP POLICY IF EXISTS "User Access" ON public.assets;
DROP POLICY IF EXISTS "Users can view own assets" ON public.assets;
DROP POLICY IF EXISTS "Users can insert own assets" ON public.assets;
DROP POLICY IF EXISTS "Users can update own assets" ON public.assets;
DROP POLICY IF EXISTS "Users can delete own assets" ON public.assets;
CREATE POLICY assets_self ON public.assets
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- tax_lots
-- ============================================================================
DROP POLICY IF EXISTS "User Access" ON public.tax_lots;
DROP POLICY IF EXISTS "Users can view own tax lots" ON public.tax_lots;
DROP POLICY IF EXISTS "Users can insert own tax lots" ON public.tax_lots;
DROP POLICY IF EXISTS "Users can update own tax lots" ON public.tax_lots;
DROP POLICY IF EXISTS "Users can delete own tax lots" ON public.tax_lots;
CREATE POLICY tax_lots_self ON public.tax_lots
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- transactions
-- ============================================================================
DROP POLICY IF EXISTS "User Access" ON public.transactions;
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;
CREATE POLICY transactions_self ON public.transactions
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- asset_targets
-- ============================================================================
DROP POLICY IF EXISTS "Users can view their own asset targets" ON public.asset_targets;
DROP POLICY IF EXISTS "Users can insert their own asset targets" ON public.asset_targets;
DROP POLICY IF EXISTS "Users can update their own asset targets" ON public.asset_targets;
DROP POLICY IF EXISTS "Users can delete their own asset targets" ON public.asset_targets;
DROP POLICY IF EXISTS asset_targets_select_own ON public.asset_targets;
DROP POLICY IF EXISTS asset_targets_insert_own ON public.asset_targets;
DROP POLICY IF EXISTS asset_targets_update_own ON public.asset_targets;
CREATE POLICY asset_targets_self ON public.asset_targets
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- glide_path
-- ============================================================================
DROP POLICY IF EXISTS "Users can read own glide path" ON public.glide_path;
DROP POLICY IF EXISTS "Users can insert own glide path" ON public.glide_path;
DROP POLICY IF EXISTS "Users can update own glide path" ON public.glide_path;
DROP POLICY IF EXISTS "Users can delete own glide path" ON public.glide_path;
CREATE POLICY glide_path_self ON public.glide_path
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- profiles
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
CREATE POLICY profiles_self ON public.profiles
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- search_cache
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own search cache" ON public.search_cache;
DROP POLICY IF EXISTS "Users can insert own search cache" ON public.search_cache;
DROP POLICY IF EXISTS "Users can update own search cache" ON public.search_cache;
DROP POLICY IF EXISTS "Users can delete own search cache" ON public.search_cache;
CREATE POLICY search_cache_self ON public.search_cache
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- sub_portfolios
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own sub portfolios" ON public.sub_portfolios;
DROP POLICY IF EXISTS "Users can insert own sub portfolios" ON public.sub_portfolios;
DROP POLICY IF EXISTS "Users can update own sub portfolios" ON public.sub_portfolios;
DROP POLICY IF EXISTS "Users can delete own sub portfolios" ON public.sub_portfolios;
CREATE POLICY sub_portfolios_self ON public.sub_portfolios
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- account_cash_anchors (immutable: no UPDATE policy by design)
-- ============================================================================
DROP POLICY IF EXISTS "select own account cash anchors" ON public.account_cash_anchors;
DROP POLICY IF EXISTS "insert own account cash anchors" ON public.account_cash_anchors;
DROP POLICY IF EXISTS "delete own account cash anchors" ON public.account_cash_anchors;
CREATE POLICY account_cash_anchors_select ON public.account_cash_anchors
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = account_cash_anchors.account_id
        AND a.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY account_cash_anchors_insert ON public.account_cash_anchors
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = account_cash_anchors.account_id
        AND a.user_id = (SELECT auth.uid())
    )
    AND created_by = (SELECT auth.uid())
  );
CREATE POLICY account_cash_anchors_delete ON public.account_cash_anchors
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = account_cash_anchors.account_id
        AND a.user_id = (SELECT auth.uid())
    )
  );
