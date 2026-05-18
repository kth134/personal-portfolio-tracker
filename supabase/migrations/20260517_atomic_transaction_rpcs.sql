-- Atomic transaction RPCs (audit refs C3 + H4)
--
-- Replaces the multi-step server-action pattern (client INSERT + server
-- INSERTs) with single-transaction SECURITY DEFINER functions, so partial
-- failures roll back cleanly. recompute_fifo_for_asset re-runs FIFO over the
-- full history for a given (account, asset), making back-dated buys self-
-- healing (H4).

-- ---------------------------------------------------------------------------
-- recompute_fifo_for_asset
-- Resets all lots for (account, asset) and replays every Sell in
-- chronological order, writing the corrected realized_gain back to each
-- Sell. Raises if any Sell can't be fully covered by the available lots
-- (which rolls back the calling RPC).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_fifo_for_asset(
  p_account_id uuid,
  p_asset_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_sell record;
  v_lot record;
  v_remaining numeric;
  v_basis numeric;
  v_deplete numeric;
  v_proceeds numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = p_account_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: account access denied';
  END IF;

  UPDATE tax_lots
  SET remaining_quantity = quantity
  WHERE account_id = p_account_id
    AND asset_id = p_asset_id
    AND user_id = v_user_id;

  FOR v_sell IN
    SELECT id, quantity, price_per_unit, fees
    FROM transactions
    WHERE account_id = p_account_id
      AND asset_id = p_asset_id
      AND user_id = v_user_id
      AND type = 'Sell'
    ORDER BY date ASC, id ASC
  LOOP
    v_remaining := v_sell.quantity;
    v_basis := 0;

    FOR v_lot IN
      SELECT id, remaining_quantity, cost_basis_per_unit
      FROM tax_lots
      WHERE account_id = p_account_id
        AND asset_id = p_asset_id
        AND user_id = v_user_id
        AND remaining_quantity > 0
      ORDER BY purchase_date ASC, id ASC
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_deplete := LEAST(v_remaining, v_lot.remaining_quantity);
      v_basis := v_basis + v_deplete * v_lot.cost_basis_per_unit;
      v_remaining := v_remaining - v_deplete;

      UPDATE tax_lots
      SET remaining_quantity = remaining_quantity - v_deplete
      WHERE id = v_lot.id;
    END LOOP;

    IF v_remaining > 1e-9 THEN
      RAISE EXCEPTION 'Insufficient shares to cover sell % (qty %, short %)',
        v_sell.id, v_sell.quantity, v_remaining;
    END IF;

    v_proceeds := v_sell.quantity * v_sell.price_per_unit - COALESCE(v_sell.fees, 0);
    UPDATE transactions
    SET realized_gain = v_proceeds - v_basis
    WHERE id = v_sell.id;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- create_buy_with_lot
-- Inserts auto-Deposit (if external), Buy transaction, and tax_lot in one
-- transaction. Recomputes FIFO so back-dated buys reconcile prior sells.
-- ---------------------------------------------------------------------------
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
    remaining_quantity, user_id
  )
  VALUES (
    p_account_id, p_asset_id, p_date, p_quantity,
    abs(p_amount) / p_quantity, p_quantity, v_user_id
  );

  PERFORM public.recompute_fifo_for_asset(p_account_id, p_asset_id);

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'deposit_id', v_deposit_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- process_sell_fifo
-- Inserts the Sell transaction, then recomputes FIFO across all sells for
-- (account, asset) — this Sell and any prior ones — so realized_gain is
-- always self-consistent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_sell_fifo(
  p_account_id uuid,
  p_asset_id uuid,
  p_date date,
  p_quantity numeric,
  p_price_per_unit numeric,
  p_fees numeric,
  p_notes text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tx_id uuid;
  v_realized_gain numeric;
  v_proceeds numeric;
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
    RAISE EXCEPTION 'Sell quantity must be > 0';
  END IF;

  v_proceeds := p_quantity * p_price_per_unit - COALESCE(p_fees, 0);

  INSERT INTO transactions (
    account_id, asset_id, date, type, quantity, price_per_unit, amount, fees,
    notes, user_id
  )
  VALUES (
    p_account_id, p_asset_id, p_date, 'Sell', p_quantity, p_price_per_unit,
    v_proceeds, NULLIF(p_fees, 0), p_notes, v_user_id
  )
  RETURNING id INTO v_tx_id;

  PERFORM public.recompute_fifo_for_asset(p_account_id, p_asset_id);

  SELECT realized_gain INTO v_realized_gain FROM transactions WHERE id = v_tx_id;

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'realized_gain', v_realized_gain
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- bulk_import_transactions
-- Processes a chronologically-sorted JSONB array of rows in a single
-- transaction. FIFO is recomputed once per touched (account, asset) at the
-- end. The caller (JS) must pre-validate amount math (H3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_import_transactions(
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row jsonb;
  v_type text;
  v_account_id uuid;
  v_asset_id uuid;
  v_qty numeric;
  v_price numeric;
  v_amt numeric;
  v_fees numeric;
  v_notes text;
  v_funding text;
  v_date date;
  v_imported int := 0;
  v_touched jsonb := '[]'::jsonb;
  v_pair jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_type := v_row->>'type';
    v_account_id := (v_row->>'account_id')::uuid;
    v_asset_id := NULLIF(v_row->>'asset_id', '')::uuid;
    v_date := (v_row->>'date')::date;
    v_qty := NULLIF(v_row->>'quantity', '')::numeric;
    v_price := NULLIF(v_row->>'price_per_unit', '')::numeric;
    v_amt := NULLIF(v_row->>'amount', '')::numeric;
    v_fees := COALESCE(NULLIF(v_row->>'fees', '')::numeric, 0);
    v_notes := v_row->>'notes';
    v_funding := v_row->>'funding_source';

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_account_id AND user_id = v_user_id) THEN
      RAISE EXCEPTION 'Unauthorized account % at row %', v_account_id, v_imported + 1;
    END IF;

    IF v_type = 'Buy' AND v_asset_id IS NOT NULL AND v_qty IS NOT NULL AND v_price IS NOT NULL THEN
      IF v_funding = 'external' THEN
        INSERT INTO transactions (account_id, asset_id, date, type, amount, notes, user_id)
        VALUES (v_account_id, NULL, v_date, 'Deposit', abs(v_amt),
                'Auto-deposit for external buy', v_user_id);
      END IF;

      INSERT INTO transactions (
        account_id, asset_id, date, type, quantity, price_per_unit, amount, fees,
        notes, funding_source, user_id
      )
      VALUES (
        v_account_id, v_asset_id, v_date, 'Buy', v_qty, v_price, v_amt,
        NULLIF(v_fees, 0), v_notes, v_funding, v_user_id
      );

      INSERT INTO tax_lots (
        account_id, asset_id, purchase_date, quantity, cost_basis_per_unit,
        remaining_quantity, user_id
      )
      VALUES (
        v_account_id, v_asset_id, v_date, v_qty, abs(v_amt) / v_qty, v_qty, v_user_id
      );

      v_touched := v_touched || jsonb_build_array(
        jsonb_build_object('account', v_account_id, 'asset', v_asset_id)
      );

    ELSIF v_type = 'Sell' AND v_asset_id IS NOT NULL AND v_qty IS NOT NULL AND v_price IS NOT NULL THEN
      INSERT INTO transactions (
        account_id, asset_id, date, type, quantity, price_per_unit, amount, fees,
        notes, user_id
      )
      VALUES (
        v_account_id, v_asset_id, v_date, 'Sell', v_qty, v_price,
        v_qty * v_price - v_fees, NULLIF(v_fees, 0), v_notes, v_user_id
      );

      v_touched := v_touched || jsonb_build_array(
        jsonb_build_object('account', v_account_id, 'asset', v_asset_id)
      );

    ELSE
      INSERT INTO transactions (
        account_id, asset_id, date, type, quantity, price_per_unit, amount, fees,
        notes, user_id
      )
      VALUES (
        v_account_id, v_asset_id, v_date, v_type, v_qty, v_price, v_amt,
        NULLIF(v_fees, 0), v_notes, v_user_id
      );
    END IF;

    v_imported := v_imported + 1;
  END LOOP;

  FOR v_pair IN
    SELECT DISTINCT element FROM jsonb_array_elements(v_touched) AS element
  LOOP
    PERFORM public.recompute_fifo_for_asset(
      (v_pair->>'account')::uuid,
      (v_pair->>'asset')::uuid
    );
  END LOOP;

  RETURN jsonb_build_object('imported', v_imported);
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_fifo_for_asset(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_buy_with_lot(uuid, uuid, date, numeric, numeric, numeric, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_sell_fifo(uuid, uuid, date, numeric, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_transactions(jsonb) TO authenticated;
