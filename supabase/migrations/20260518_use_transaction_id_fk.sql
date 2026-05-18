-- Update create_buy_with_lot to populate the new transaction_id column.
-- Update delete_transaction to prefer the explicit FK (and only fall back
-- to the heuristic for the small set of pre-existing lots where the
-- backfill couldn't pair a Buy).
-- Add update_transaction for atomic full-field edits (Bug request: UI
-- currently disables qty/price/account/asset on Buy/Sell edits because the
-- old code had no safe way to keep lots in sync).

CREATE OR REPLACE FUNCTION public.create_buy_with_lot(
  p_account_id uuid,
  p_asset_id uuid,
  p_date date,
  p_quantity numeric,
  p_price_per_unit numeric,
  p_amount numeric,
  p_fees numeric,
  p_funding_source text,
  p_notes text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tx_id uuid;
  v_deposit_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = p_account_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: account access denied';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Buy quantity must be > 0';
  END IF;

  IF p_funding_source = 'external' THEN
    INSERT INTO transactions (account_id, asset_id, date, type, amount, notes, user_id)
    VALUES (p_account_id, NULL, p_date, 'Deposit', abs(p_amount),
            'Auto-deposit for external buy', v_user_id)
    RETURNING id INTO v_deposit_id;
  END IF;

  INSERT INTO transactions (
    account_id, asset_id, date, type, quantity, price_per_unit, amount, fees,
    notes, funding_source, user_id
  )
  VALUES (
    p_account_id, p_asset_id, p_date, 'Buy', p_quantity, p_price_per_unit,
    p_amount, NULLIF(p_fees, 0), p_notes, p_funding_source, v_user_id
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO tax_lots (
    account_id, asset_id, purchase_date, quantity, cost_basis_per_unit,
    remaining_quantity, user_id, transaction_id
  )
  VALUES (
    p_account_id, p_asset_id, p_date, p_quantity,
    abs(p_amount) / p_quantity, p_quantity, v_user_id, v_tx_id
  );

  PERFORM public.recompute_fifo_for_asset(p_account_id, p_asset_id);

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'deposit_id', v_deposit_id
  );
END;
$$;

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

  -- Prefer the explicit FK; fall back to the legacy heuristic for the
  -- handful of pre-existing lots where the backfill couldn't pair a Buy.
  IF v_tx.type = 'Buy' AND v_tx.asset_id IS NOT NULL THEN
    SELECT id INTO v_lot_id FROM tax_lots WHERE transaction_id = p_tx_id LIMIT 1;

    IF v_lot_id IS NULL AND v_tx.quantity IS NOT NULL THEN
      SELECT id INTO v_lot_id
      FROM tax_lots
      WHERE user_id = v_user_id
        AND account_id = v_tx.account_id
        AND asset_id = v_tx.asset_id
        AND purchase_date = v_tx.date
        AND abs(quantity - v_tx.quantity) < 0.0001
        AND transaction_id IS NULL
      ORDER BY created_at ASC NULLS LAST, id ASC
      LIMIT 1;
    END IF;

    IF v_lot_id IS NOT NULL THEN
      DELETE FROM tax_lots WHERE id = v_lot_id;
      v_lots_deleted := 1;
    END IF;
  END IF;

  DELETE FROM transactions WHERE id = p_tx_id;

  IF v_tx.account_id IS NOT NULL AND v_tx.asset_id IS NOT NULL THEN
    PERFORM public.recompute_fifo_for_asset(v_tx.account_id, v_tx.asset_id);
  END IF;

  RETURN jsonb_build_object(
    'deleted_transaction_id', p_tx_id,
    'lots_deleted', v_lots_deleted
  );
END;
$$;

-- update_transaction: full-field edit.
--
-- Type changes are forbidden — they require lot/realized-gain rewrites
-- that the user is better served by an explicit delete + re-create.
-- For Buy edits, the linked tax_lot is updated in place (account, asset,
-- date, quantity, basis); for Sell edits, the row is updated and FIFO is
-- recomputed across both the old and new (account, asset) pairs (so any
-- prior sells on either combination get correct realized_gain).
--
-- Auto-Deposit rows created by previous external-funding Buys are NOT
-- adjusted on Buy edits; they keep their original amount. Future work
-- could chain that, but for now the user can edit/delete the deposit row
-- separately if needed.
CREATE OR REPLACE FUNCTION public.update_transaction(
  p_tx_id uuid,
  p_account_id uuid,
  p_asset_id uuid,
  p_date date,
  p_type text,
  p_quantity numeric,
  p_price_per_unit numeric,
  p_amount numeric,
  p_fees numeric,
  p_notes text,
  p_funding_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_old record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, type, account_id, asset_id, date, quantity, user_id
  INTO v_old
  FROM transactions
  WHERE id = p_tx_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_old.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_old.type <> p_type THEN
    RAISE EXCEPTION 'Cannot change transaction type. Delete and re-create instead.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = p_account_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: new account access denied';
  END IF;

  IF p_type IN ('Buy', 'Sell') AND (p_quantity IS NULL OR p_quantity <= 0) THEN
    RAISE EXCEPTION 'Buy/Sell quantity must be > 0';
  END IF;

  UPDATE transactions SET
    account_id = p_account_id,
    asset_id = p_asset_id,
    date = p_date,
    quantity = p_quantity,
    price_per_unit = p_price_per_unit,
    amount = p_amount,
    fees = NULLIF(p_fees, 0),
    notes = p_notes,
    funding_source = CASE WHEN p_type = 'Buy' THEN p_funding_source ELSE NULL END
  WHERE id = p_tx_id;

  -- Buy: mirror the change onto the linked tax_lot (if we have an FK
  -- link). remaining_quantity is reset to the new full quantity; the
  -- recompute below redoes depletion.
  IF p_type = 'Buy' AND p_asset_id IS NOT NULL THEN
    UPDATE tax_lots
    SET account_id = p_account_id,
        asset_id = p_asset_id,
        purchase_date = p_date,
        quantity = p_quantity,
        cost_basis_per_unit = abs(p_amount) / NULLIF(p_quantity, 0),
        remaining_quantity = p_quantity
    WHERE transaction_id = p_tx_id;
  END IF;

  -- Recompute FIFO on the OLD (account, asset) — the edit may have
  -- removed a lot from there or invalidated a sell.
  IF v_old.type IN ('Buy', 'Sell')
     AND v_old.account_id IS NOT NULL AND v_old.asset_id IS NOT NULL THEN
    PERFORM public.recompute_fifo_for_asset(v_old.account_id, v_old.asset_id);
  END IF;

  -- And on the NEW (account, asset) if it differs.
  IF p_type IN ('Buy', 'Sell')
     AND p_account_id IS NOT NULL AND p_asset_id IS NOT NULL
     AND (p_account_id <> v_old.account_id
          OR p_asset_id IS DISTINCT FROM v_old.asset_id) THEN
    PERFORM public.recompute_fifo_for_asset(p_account_id, p_asset_id);
  END IF;

  RETURN jsonb_build_object('transaction_id', p_tx_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_transaction(uuid, uuid, uuid, date, text, numeric, numeric, numeric, numeric, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_transaction(uuid, uuid, uuid, date, text, numeric, numeric, numeric, numeric, text, text) FROM PUBLIC, anon;
