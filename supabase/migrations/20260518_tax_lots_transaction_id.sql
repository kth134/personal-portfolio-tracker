-- Link tax_lots to their originating Buy transaction.
--
-- Until now the lot ↔ Buy correspondence was implicit, matched at runtime
-- on (account_id, asset_id, purchase_date, quantity). That was fine when
-- only one Buy per (account, asset, date) existed, but ~87 of 634 lots
-- live in groups with multiple same-day Buys, making lot deletion / edit
-- ambiguous. This migration adds an explicit FK and backfills it.
--
-- Pairing strategy: within each (user_id, account_id, asset_id, date)
-- partition, sort lots and Buys by created_at then id and assign by row
-- number. In every multi-row partition the count of lots equals the count
-- of Buys, so this pairing is exact. Only 3 lots stay NULL (true orphans
-- inherited from before this fix).
--
-- FK uses ON DELETE RESTRICT — the only sanctioned delete path is the
-- delete_transaction RPC, which removes the lot first and then the
-- transaction. A bare `DELETE FROM transactions WHERE id = X` will now
-- fail loudly if a lot still references it, which is the desired safety
-- net against future accidents.

ALTER TABLE public.tax_lots
  ADD COLUMN IF NOT EXISTS transaction_id uuid;

WITH lot_rn AS (
  SELECT id, user_id, account_id, asset_id, purchase_date,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, account_id, asset_id, purchase_date
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.tax_lots
),
buy_rn AS (
  SELECT id, user_id, account_id, asset_id, date,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, account_id, asset_id, date
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.transactions WHERE type = 'Buy'
)
UPDATE public.tax_lots tl
SET transaction_id = b.id
FROM lot_rn l
JOIN buy_rn b ON
      l.user_id = b.user_id
  AND l.account_id = b.account_id
  AND ((l.asset_id IS NULL AND b.asset_id IS NULL) OR l.asset_id = b.asset_id)
  AND l.purchase_date = b.date
  AND l.rn = b.rn
WHERE tl.id = l.id;

ALTER TABLE public.tax_lots
  ADD CONSTRAINT tax_lots_transaction_id_fkey
  FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_tax_lots_transaction_id
  ON public.tax_lots(transaction_id) WHERE transaction_id IS NOT NULL;
