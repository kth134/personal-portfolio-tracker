import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TEST_EMAIL = process.env.RAINVEST_SEED_EMAIL || 'kth134+test3@gmail.com';

if (!url || !key) throw new Error('Missing Supabase env vars');
const supabase = createClient(url, key);

const SP = {
  equities: '9b49f2c7-3d3b-4b8f-bbc6-2b5f8a2a2a01',
  hard: 'f1a9f3c1-0f86-4c3f-93f2-9e5a12c2c102',
  growth: '5f0df3a8-9d8f-4c73-8b9e-3e0e6d9a2103',
};
const ACC = {
  taxable: '1a5f7c2e-3e1d-4b9d-9a1a-3b8a5f9f1101',
  trad: 'f6e1c1b1-2a4d-4c5e-8b7f-6a2b1c9e2202',
  roth: '8b0e4f7c-9d1a-4b7e-9e2f-5c8a2b3d3303',
};
const ASSET = {
  avuv: '0f1a2b3c-4d5e-6f70-8a9b-0c1d2e3f4001',
  iefa: '1f2a3b4c-5d6e-7f80-9a0b-1c2d3e4f5002',
  vfiax: '2f3a4b5c-6d7e-8f90-0a1b-2c3d4e5f6003',
  ivv: '3f4a5b6c-7d8e-9f00-1a2b-3c4d5e6f7004',
  dgs: '4f5a6b7c-8d9e-0f10-2a3b-4c5d6e7f8005',
  avdv: '5f6a7b8c-9d0e-1f20-3a4b-5c6d7e8f9006',
  gld: '6f7a8b9c-0d1e-2f30-4a5b-6c7d8e9f0007',
  btc: '7f8a9b0c-1d2e-3f40-5a6b-7c8d9e0f1118',
  iren: '8f9a0b1c-2d3e-4f50-6a7b-8c9d0e1f2229',
  tsla: '9f0a1b2c-3d4e-5f60-7a8b-9c0d1e2f333a',
  mstr: 'af1b2c3d-4e5f-6071-8a9b-0c1d2e3f444b',
  nvda: 'bf2c3d4e-5f60-7181-9a0b-1c2d3e4f555c',
  smh: 'cf3d4e5f-6071-8291-0a1b-2c3d4e5f666d',
};

async function getUserId(email: string) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const user = data.users.find(u => u.email === email);
  if (!user) throw new Error(`User not found: ${email}`);
  return user.id;
}

async function upsert(table: string, rows: any[], onConflict = 'id') {
  const { data, error } = await supabase.from(table).upsert(rows, { onConflict }).select();
  if (error) throw error;
  return data;
}

async function run() {
  const userId = await getUserId(TEST_EMAIL);

  await upsert('sub_portfolios', [
    { id: SP.equities, user_id: userId, name: 'Globally Diversified Equities', target_allocation: 50, upside_threshold: 7, downside_threshold: 7, band_mode: false },
    { id: SP.hard, user_id: userId, name: 'Hard Assets', target_allocation: 20, upside_threshold: 10, downside_threshold: 10, band_mode: true },
    { id: SP.growth, user_id: userId, name: 'High Growth Bets', target_allocation: 30, upside_threshold: 25, downside_threshold: 25, band_mode: false },
  ]);

  await upsert('accounts', [
    { id: ACC.taxable, user_id: userId, name: 'Kevin Brokerage', type: 'Brokerage', tax_status: 'Taxable' },
    { id: ACC.trad, user_id: userId, name: 'Kevin Traditional IRA', type: 'IRA', tax_status: 'Tax-Advantaged' },
    { id: ACC.roth, user_id: userId, name: 'Kevin Roth IRA', type: 'IRA', tax_status: 'Tax-Advantaged' },
  ]);

  await upsert('assets', [
    { id: ASSET.avuv, user_id: userId, ticker: 'AVUV', name: 'Avantis U.S. Small Cap Value', sub_portfolio_id: SP.equities, asset_type: 'Equity', asset_subtype: 'Small Cap Value', geography: 'US', size_tag: 'Small', factor_tag: 'Value' },
    { id: ASSET.iefa, user_id: userId, ticker: 'IEFA', name: 'iShares Core MSCI EAFE', sub_portfolio_id: SP.equities, asset_type: 'Equity', asset_subtype: 'International', geography: 'International', size_tag: 'Large', factor_tag: 'Blend' },
    { id: ASSET.vfiax, user_id: userId, ticker: 'VFIAX', name: 'Vanguard 500 Index Admiral', sub_portfolio_id: SP.equities, asset_type: 'Equity', asset_subtype: 'Large Cap', geography: 'US', size_tag: 'Large', factor_tag: 'Blend' },
    { id: ASSET.ivv, user_id: userId, ticker: 'IVV', name: 'iShares Core S&P 500', sub_portfolio_id: SP.equities, asset_type: 'Equity', asset_subtype: 'Large Cap', geography: 'US', size_tag: 'Large', factor_tag: 'Blend' },
    { id: ASSET.dgs, user_id: userId, ticker: 'DGS', name: 'WisdomTree EM SmallCap', sub_portfolio_id: SP.equities, asset_type: 'Equity', asset_subtype: 'Emerging', geography: 'International', size_tag: 'Small', factor_tag: 'Value' },
    { id: ASSET.avdv, user_id: userId, ticker: 'AVDV', name: 'Avantis Intl Small Cap Value', sub_portfolio_id: SP.equities, asset_type: 'Equity', asset_subtype: 'International', geography: 'International', size_tag: 'Small', factor_tag: 'Value' },

    { id: ASSET.gld, user_id: userId, ticker: 'GLD', name: 'SPDR Gold Shares', sub_portfolio_id: SP.hard, asset_type: 'Commodity', asset_subtype: 'Gold', geography: 'Global', size_tag: 'Large', factor_tag: 'Real' },
    { id: ASSET.btc, user_id: userId, ticker: 'BTC', name: 'Bitcoin', sub_portfolio_id: SP.hard, asset_type: 'Crypto', asset_subtype: 'Bitcoin', geography: 'Global', size_tag: 'Large', factor_tag: 'Growth' },

    { id: ASSET.iren, user_id: userId, ticker: 'IREN', name: 'Iris Energy', sub_portfolio_id: SP.growth, asset_type: 'Equity', asset_subtype: 'Growth', geography: 'US', size_tag: 'Small', factor_tag: 'Growth' },
    { id: ASSET.tsla, user_id: userId, ticker: 'TSLA', name: 'Tesla', sub_portfolio_id: SP.growth, asset_type: 'Equity', asset_subtype: 'Growth', geography: 'US', size_tag: 'Large', factor_tag: 'Growth' },
    { id: ASSET.mstr, user_id: userId, ticker: 'MSTR', name: 'MicroStrategy', sub_portfolio_id: SP.growth, asset_type: 'Equity', asset_subtype: 'Growth', geography: 'US', size_tag: 'Mid', factor_tag: 'Growth' },
    { id: ASSET.nvda, user_id: userId, ticker: 'NVDA', name: 'NVIDIA', sub_portfolio_id: SP.growth, asset_type: 'Equity', asset_subtype: 'Growth', geography: 'US', size_tag: 'Large', factor_tag: 'Growth' },
    { id: ASSET.smh, user_id: userId, ticker: 'SMH', name: 'VanEck Semiconductor', sub_portfolio_id: SP.growth, asset_type: 'Equity', asset_subtype: 'Growth', geography: 'US', size_tag: 'Large', factor_tag: 'Growth' },
  ]);

  await upsert('asset_targets', [
    { id: randomUUID(), user_id: userId, asset_id: ASSET.avuv, sub_portfolio_id: SP.equities, target_percentage: 25 },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.vfiax, sub_portfolio_id: SP.equities, target_percentage: 25 },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.iefa, sub_portfolio_id: SP.equities, target_percentage: 15 },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.ivv, sub_portfolio_id: SP.equities, target_percentage: 15 },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.dgs, sub_portfolio_id: SP.equities, target_percentage: 10 },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.avdv, sub_portfolio_id: SP.equities, target_percentage: 10 },

    { id: randomUUID(), user_id: userId, asset_id: ASSET.gld, sub_portfolio_id: SP.hard, target_percentage: 70 },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.btc, sub_portfolio_id: SP.hard, target_percentage: 30 },

    { id: randomUUID(), user_id: userId, asset_id: ASSET.iren, sub_portfolio_id: SP.growth, target_percentage: 20 },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.tsla, sub_portfolio_id: SP.growth, target_percentage: 25 },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.mstr, sub_portfolio_id: SP.growth, target_percentage: 20 },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.nvda, sub_portfolio_id: SP.growth, target_percentage: 20 },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.smh, sub_portfolio_id: SP.growth, target_percentage: 15 },
  ], 'asset_id,sub_portfolio_id,user_id');

  const now = new Date().toISOString();
  await upsert('asset_prices', [
    { id: randomUUID(), ticker: 'AVUV', price: 90, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'VFIAX', price: 420, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'IEFA', price: 70, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'IVV', price: 480, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'DGS', price: 50, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'AVDV', price: 65, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'GLD', price: 190, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'BTC', price: 45000, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'IREN', price: 6, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'TSLA', price: 220, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'MSTR', price: 1300, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'NVDA', price: 650, timestamp: now, source: 'seed' },
    { id: randomUUID(), ticker: 'SMH', price: 180, timestamp: now, source: 'seed' },
  ]);

  await upsert('tax_lots', [
    { id: randomUUID(), user_id: userId, asset_id: ASSET.avuv, account_id: ACC.taxable, quantity: 400, remaining_quantity: 400, cost_basis_per_unit: 80, purchase_date: '2023-06-01' },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.vfiax, account_id: ACC.taxable, quantity: 200, remaining_quantity: 200, cost_basis_per_unit: 380, purchase_date: '2022-11-15' },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.iefa, account_id: ACC.trad, quantity: 600, remaining_quantity: 600, cost_basis_per_unit: 65, purchase_date: '2023-02-01' },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.ivv, account_id: ACC.roth, quantity: 220, remaining_quantity: 220, cost_basis_per_unit: 410, purchase_date: '2021-05-20' },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.dgs, account_id: ACC.trad, quantity: 300, remaining_quantity: 300, cost_basis_per_unit: 40, purchase_date: '2023-08-01' },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.avdv, account_id: ACC.taxable, quantity: 280, remaining_quantity: 280, cost_basis_per_unit: 55, purchase_date: '2022-01-10' },

    { id: randomUUID(), user_id: userId, asset_id: ASSET.gld, account_id: ACC.taxable, quantity: 120, remaining_quantity: 120, cost_basis_per_unit: 170, purchase_date: '2022-04-01' },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.btc, account_id: ACC.roth, quantity: 0.8, remaining_quantity: 0.8, cost_basis_per_unit: 30000, purchase_date: '2021-12-01' },

    { id: randomUUID(), user_id: userId, asset_id: ASSET.iren, account_id: ACC.trad, quantity: 15000, remaining_quantity: 15000, cost_basis_per_unit: 4, purchase_date: '2023-03-01' },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.tsla, account_id: ACC.taxable, quantity: 250, remaining_quantity: 250, cost_basis_per_unit: 180, purchase_date: '2022-06-15' },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.mstr, account_id: ACC.roth, quantity: 80, remaining_quantity: 80, cost_basis_per_unit: 900, purchase_date: '2021-07-01' },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.nvda, account_id: ACC.taxable, quantity: 120, remaining_quantity: 120, cost_basis_per_unit: 500, purchase_date: '2022-09-01' },
    { id: randomUUID(), user_id: userId, asset_id: ASSET.smh, account_id: ACC.trad, quantity: 200, remaining_quantity: 200, cost_basis_per_unit: 150, purchase_date: '2023-01-01' },
  ]);

  await upsert('transactions', [
    { id: randomUUID(), user_id: userId, date: '2023-06-01', type: 'Buy', quantity: 400, price_per_unit: 80, amount: 32000, fees: 0, realized_gain: 0, asset_id: ASSET.avuv, account_id: ACC.taxable },
    { id: randomUUID(), user_id: userId, date: '2022-11-15', type: 'Buy', quantity: 200, price_per_unit: 380, amount: 76000, fees: 0, realized_gain: 0, asset_id: ASSET.vfiax, account_id: ACC.taxable },
    { id: randomUUID(), user_id: userId, date: '2023-02-01', type: 'Buy', quantity: 600, price_per_unit: 65, amount: 39000, fees: 0, realized_gain: 0, asset_id: ASSET.iefa, account_id: ACC.trad },
    { id: randomUUID(), user_id: userId, date: '2021-05-20', type: 'Buy', quantity: 220, price_per_unit: 410, amount: 90200, fees: 0, realized_gain: 0, asset_id: ASSET.ivv, account_id: ACC.roth },
    { id: randomUUID(), user_id: userId, date: '2023-08-01', type: 'Buy', quantity: 300, price_per_unit: 40, amount: 12000, fees: 0, realized_gain: 0, asset_id: ASSET.dgs, account_id: ACC.trad },
    { id: randomUUID(), user_id: userId, date: '2022-01-10', type: 'Buy', quantity: 280, price_per_unit: 55, amount: 15400, fees: 0, realized_gain: 0, asset_id: ASSET.avdv, account_id: ACC.taxable },
    { id: randomUUID(), user_id: userId, date: '2022-04-01', type: 'Buy', quantity: 120, price_per_unit: 170, amount: 20400, fees: 0, realized_gain: 0, asset_id: ASSET.gld, account_id: ACC.taxable },
    { id: randomUUID(), user_id: userId, date: '2021-12-01', type: 'Buy', quantity: 0.8, price_per_unit: 30000, amount: 24000, fees: 0, realized_gain: 0, asset_id: ASSET.btc, account_id: ACC.roth },
    { id: randomUUID(), user_id: userId, date: '2023-03-01', type: 'Buy', quantity: 15000, price_per_unit: 4, amount: 60000, fees: 0, realized_gain: 0, asset_id: ASSET.iren, account_id: ACC.trad },
    { id: randomUUID(), user_id: userId, date: '2022-06-15', type: 'Buy', quantity: 250, price_per_unit: 180, amount: 45000, fees: 0, realized_gain: 0, asset_id: ASSET.tsla, account_id: ACC.taxable },
    { id: randomUUID(), user_id: userId, date: '2021-07-01', type: 'Buy', quantity: 80, price_per_unit: 900, amount: 72000, fees: 0, realized_gain: 0, asset_id: ASSET.mstr, account_id: ACC.roth },
    { id: randomUUID(), user_id: userId, date: '2022-09-01', type: 'Buy', quantity: 120, price_per_unit: 500, amount: 60000, fees: 0, realized_gain: 0, asset_id: ASSET.nvda, account_id: ACC.taxable },
    { id: randomUUID(), user_id: userId, date: '2023-01-01', type: 'Buy', quantity: 200, price_per_unit: 150, amount: 30000, fees: 0, realized_gain: 0, asset_id: ASSET.smh, account_id: ACC.trad },

    { id: randomUUID(), user_id: userId, date: '2024-01-05', type: 'Deposit', quantity: 0, price_per_unit: 0, amount: 10000, fees: 0, realized_gain: 0, asset_id: null, account_id: ACC.taxable, funding_source: 'Bank' },
    { id: randomUUID(), user_id: userId, date: '2024-02-12', type: 'Dividend', quantity: 0, price_per_unit: 0, amount: 500, fees: 0, realized_gain: 0, asset_id: ASSET.vfiax, account_id: ACC.taxable },
    { id: randomUUID(), user_id: userId, date: '2024-03-10', type: 'Withdrawal', quantity: 0, price_per_unit: 0, amount: -2000, fees: 0, realized_gain: 0, asset_id: null, account_id: ACC.taxable, funding_source: 'Cash' },
    { id: randomUUID(), user_id: userId, date: '2024-04-01', type: 'Sell', quantity: 50, price_per_unit: 500, amount: 25000, fees: 0, realized_gain: 2000, asset_id: ASSET.nvda, account_id: ACC.taxable },
  ]);

  console.log('Seed complete:', { userId, subPortfolios: 3, accounts: 3, assets: 13 });
}

run().catch(err => { console.error(err); process.exit(1); });
