-- Auto-deposit ↔ Buy linkage.
--
-- create_buy_with_lot inserts a Deposit row when funding_source='external'
-- so the auto-cash balance reflects the external inflow that funded the
-- Buy. Until now that auto-Deposit was loose: deleting the Buy left it
-- behind, and editing the Buy's amount didn't propagate to the Deposit.
--
-- Add a self-referencing FK `parent_transaction_id` on transactions
-- (ON DELETE CASCADE) so the auto-Deposit is removed automatically with
-- its parent Buy, and so update_transaction can find it for in-place edits.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS parent_transaction_id uuid;

WITH dep_rn AS (
  SELECT id, user_id, account_id, date,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, account_id, date
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.transactions
  WHERE type = 'Deposit' AND asset_id IS NULL AND notes ILIKE 'Auto-deposit%'
),
buy_external AS (
  SELECT id, user_id, account_id, date,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, account_id, date
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.transactions WHERE type = 'Buy' AND funding_source = 'external'
)
UPDATE public.transactions t
SET parent_transaction_id = b.id
FROM dep_rn d
JOIN buy_external b
  ON d.user_id = b.user_id
 AND d.account_id = b.account_id
 AND d.date = b.date
 AND d.rn = b.rn
WHERE t.id = d.id;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_parent_transaction_id_fkey
  FOREIGN KEY (parent_transaction_id)
  REFERENCES public.transactions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_transactions_parent_transaction_id
  ON public.transactions(parent_transaction_id)
  WHERE parent_transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- create_buy_with_lot: set parent_transaction_id on the auto-Deposit so we
-- can find/update/cascade it later.
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

  -- Insert the Buy first so we have its id to link the auto-Deposit to.
  INSERT INTO transactions (
    account_id, asset_id, date, type, quantity, price_per_unit, amount, fees,
    notes, funding_source, user_id
  )
  VALUES (
    p_account_id, p_asset_id, p_date, 'Buy', p_quantity, p_price_per_unit,
    p_amount, NULLIF(p_fees, 0), p_notes, p_funding_source, v_user_id
  )
  RETURNING id INTO v_tx_id;

  IF p_funding_source = 'external' THEN
    INSERT INTO transactions (
      account_id, asset_id, date, type, amount, notes, user_id, parent_transaction_id
    )
    VALUES (
      p_account_id, NULL, p_date, 'Deposit', abs(p_amount),
      'Auto-deposit for external buy', v_user_id, v_tx_id
    )
    RETURNING id INTO v_deposit_id;
  END IF;

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

-- ---------------------------------------------------------------------------
-- update_transaction: keep the linked auto-Deposit in sync when a Buy edits.
--
-- - If the funding_source stays 'external': update the auto-Deposit's
--   amount, date, and account_id to match.
-- - If funding_source changes external → cash: delete the auto-Deposit.
-- - If funding_source changes cash → external: insert a new auto-Deposit
--   linked to the Buy.
-- - For non-Buy edits, no-op (other types never had an auto-Deposit).
-- ---------------------------------------------------------------------------
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
  v_existing_dep_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, type, account_id, asset_id, date, quantity, funding_source, user_id
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

  -- Auto-Deposit lifecycle: only relevant for Buy edits.
  IF p_type = 'Buy' THEN
    SELECT id INTO v_existing_dep_id
    FROM transactions
    WHERE parent_transaction_id = p_tx_id
      AND type = 'Deposit'
    LIMIT 1;

    IF v_old.funding_source = 'external' AND p_funding_source = 'external' THEN
      IF v_existing_dep_id IS NOT NULL THEN
        UPDATE transactions
        SET account_id = p_account_id,
            date = p_date,
            amount = abs(p_amount)
        WHERE id = v_existing_dep_id;
      ELSE
        -- Existed in spirit (the OLD buy was external) but the deposit row
        -- was previously unlinked. Re-create one.
        INSERT INTO transactions (
          account_id, asset_id, date, type, amount, notes, user_id, parent_transaction_id
        )
        VALUES (
          p_account_id, NULL, p_date, 'Deposit', abs(p_amount),
          'Auto-deposit for external buy', v_user_id, p_tx_id
        );
      END IF;

    ELSIF v_old.funding_source = 'external' AND p_funding_source IS DISTINCT FROM 'external' THEN
      IF v_existing_dep_id IS NOT NULL THEN
        DELETE FROM transactions WHERE id = v_existing_dep_id;
      END IF;

    ELSIF v_old.funding_source IS DISTINCT FROM 'external' AND p_funding_source = 'external' THEN
      IF v_existing_dep_id IS NULL THEN
        INSERT INTO transactions (
          account_id, asset_id, date, type, amount, notes, user_id, parent_transaction_id
        )
        VALUES (
          p_account_id, NULL, p_date, 'Deposit', abs(p_amount),
          'Auto-deposit for external buy', v_user_id, p_tx_id
        );
      END IF;
    END IF;
  END IF;

  IF v_old.type IN ('Buy', 'Sell')
     AND v_old.account_id IS NOT NULL AND v_old.asset_id IS NOT NULL THEN
    PERFORM public.recompute_fifo_for_asset(v_old.account_id, v_old.asset_id);
  END IF;

  IF p_type IN ('Buy', 'Sell')
     AND p_account_id IS NOT NULL AND p_asset_id IS NOT NULL
     AND (p_account_id <> v_old.account_id
          OR p_asset_id IS DISTINCT FROM v_old.asset_id) THEN
    PERFORM public.recompute_fifo_for_asset(p_account_id, p_asset_id);
  END IF;

  RETURN jsonb_build_object('transaction_id', p_tx_id);
END;
$$;
