-- delete_transaction RPC
--
-- Replaces the client's direct `DELETE FROM transactions WHERE id = ...`
-- with a SECURITY DEFINER function that ALSO:
--   - removes the matching tax_lot when the deleted row is a Buy;
--   - re-runs FIFO across remaining sells for (account, asset) so
--     realized_gain values are kept consistent.
--
-- Tax-lot matching is by (account_id, asset_id, purchase_date, quantity).
-- Ties are broken by `created_at ASC, id ASC` (the lot most likely created
-- alongside this Buy goes first). A proper transaction_id FK on tax_lots
-- is the long-term fix; this heuristic works for the common case and is
-- safe because the recompute that follows will RAISE if the resulting lot
-- state can't cover the user's existing sells.

CREATE OR REPLACE FUNCTION public.delete_transaction(
  p_tx_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tx record;
  v_lot_id uuid;
  v_lots_deleted int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, type, account_id, asset_id, date, quantity, user_id
  INTO v_tx
  FROM transactions
  WHERE id = p_tx_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_tx.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Remove the originating tax_lot if this is a Buy
  IF v_tx.type = 'Buy' AND v_tx.asset_id IS NOT NULL AND v_tx.quantity IS NOT NULL THEN
    SELECT id INTO v_lot_id
    FROM tax_lots
    WHERE user_id = v_user_id
      AND account_id = v_tx.account_id
      AND asset_id = v_tx.asset_id
      AND purchase_date = v_tx.date
      AND abs(quantity - v_tx.quantity) < 0.0001
    ORDER BY created_at ASC NULLS LAST, id ASC
    LIMIT 1;

    IF v_lot_id IS NOT NULL THEN
      DELETE FROM tax_lots WHERE id = v_lot_id;
      v_lots_deleted := 1;
    END IF;
  END IF;

  DELETE FROM transactions WHERE id = p_tx_id;

  -- Re-derive FIFO so any sells that touched this (account, asset) get
  -- correct realized_gain. If lots can no longer cover the user's sells,
  -- recompute RAISEs and the entire delete rolls back.
  IF v_tx.account_id IS NOT NULL AND v_tx.asset_id IS NOT NULL THEN
    PERFORM public.recompute_fifo_for_asset(v_tx.account_id, v_tx.asset_id);
  END IF;

  RETURN jsonb_build_object(
    'deleted_transaction_id', p_tx_id,
    'lots_deleted', v_lots_deleted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_transaction(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_transaction(uuid) FROM PUBLIC, anon;
