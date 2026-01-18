'use server';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { refreshAssetPrices } from '@/app/dashboard/portfolio/actions';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const grokApiKey = process.env.GROK_API_KEY!;

interface GlidePathItem {
  age: number;
  target_allocation: any;
}

interface TaxLotWithJoins {
  id: string;
  account_id: string;
  asset_id: string;
  purchase_date: string;
  remaining_quantity: number;
  cost_basis_per_unit: number;
  accounts: {
    name: string;
    type: string;
    tax_status: string;
  } | null;
  assets: {
    ticker: string;
    asset_type: string;
    asset_subtype: string;
    geography: string;
    factor_tag: string;
    size_tag: string;
    sub_portfolio_id: string | null;
  } | null;
  sub_portfolios: {
    name: string;
    objective: string;
  } | null;
}

interface TaxLotSimple {
  id: string;
  account_id: string;
  asset_id: string;
  purchase_date: string;
  remaining_quantity: number;
  cost_basis_per_unit: number;
  accounts: {
    name: string;
    type: string;
  } | null;
  assets: {
    ticker: string;
    asset_type: string;
    asset_subtype: string;
    geography: string;
    factor_tag: string;
    size_tag: string;
  } | null;
}

// Server-only deep analysis – never sent to external API
async function performDeepPortfolioAnalysis(
  supabase: any,
  userId: string,
  userQuery: string
): Promise<string> {
  // Early exit if query doesn't seem to need deep data
  const lowerQuery = userQuery.toLowerCase();
  const needsDeep = /lot|basis|date|purchase|age|hold.*period|realized|unrealized.*by|breakdown.*by|factor|size|geography|subtype|account|sub-portfolio/i.test(lowerQuery);
  if (!needsDeep) return "";

  let analysis = "Deep analysis results:\n";

  // Fetch necessary data for analysis (to avoid multiple queries)
  const { data: taxLots } = await supabase
    .from('tax_lots')
    .select(`
      id, account_id, asset_id, purchase_date, remaining_quantity, cost_basis_per_unit,
      accounts(name, type, tax_status), assets(ticker, asset_type, asset_subtype, geography, factor_tag, size_tag, sub_portfolio_id),
      sub_portfolios(name, objective)
    `)
    .eq('user_id', userId)
    .gt('remaining_quantity', 0) as { data: TaxLotWithJoins[] | null };

  const tickers = [...new Set(taxLots?.map(lot => lot.assets?.ticker).filter(Boolean) || [])];

  const { data: latestPrices } = await supabase
    .from('asset_prices')
    .select('ticker, price')
    .in('ticker', tickers)
    .order('ticker', { ascending: true })
    .order('timestamp', { ascending: false }) as { data: { ticker: string; price: number }[] | null };

  const pricesMap = new Map();
  if (latestPrices) {
    latestPrices.forEach(p => {
      if (!pricesMap.has(p.ticker)) pricesMap.set(p.ticker, p.price);
    });
  }

  if (!taxLots?.length) {
    return "No detailed holdings found for deep analysis.";
  }

  // 1. Tax lots by age or purchase date
  if (/lot|age|purchase|hold.*period/i.test(lowerQuery)) {
    const tickerMatch = lowerQuery.match(/btc|bitcoin|([a-z]{3,4})/i);
    const targetTicker = tickerMatch ? tickerMatch[0].toUpperCase() : null;

    const filteredLots = taxLots.filter(lot => !targetTicker || lot.assets?.ticker === targetTicker);

    if (filteredLots.length) {
      const lotSummaries = filteredLots.map(lot => {
        const currentPrice = pricesMap.get(lot.assets?.ticker) || 0;
        const currentValue = lot.remaining_quantity * currentPrice;
        const unrealizedGain = currentValue - (lot.cost_basis_per_unit * lot.remaining_quantity);
        const ageDays = Math.floor((Date.now() - new Date(lot.purchase_date).getTime()) / (86400000));
        return `- Account: ${lot.accounts?.name || 'Unknown'} (${lot.accounts?.tax_status || ''}) | Ticker: ${lot.assets?.ticker} | Quantity: ${lot.remaining_quantity.toFixed(4)} | Basis: $${lot.cost_basis_per_unit.toFixed(2)} | Purchase: ${new Date(lot.purchase_date).toLocaleDateString()} | Age: ${ageDays} days | Unrealized Gain: $${unrealizedGain.toFixed(0)}`;
      });
      analysis += `Detailed lots${targetTicker ? ` for ${targetTicker}` : ''}:\n${lotSummaries.join('\n')}\n\n`;
    }
  }

  // 2. Breakdown by account or tax_status
  if (/account|tax_status/i.test(lowerQuery)) {
    const accountGains: Record<string, number> = {};
    taxLots.forEach(lot => {
      const accName = lot.accounts?.name || 'Untagged';
      const currentPrice = pricesMap.get(lot.assets?.ticker) || 0;
      const unrealizedGain = (lot.remaining_quantity * currentPrice) - (lot.cost_basis_per_unit * lot.remaining_quantity);
      accountGains[accName] = (accountGains[accName] || 0) + unrealizedGain;
    });

    const gainSummaries = Object.entries(accountGains).map(([acc, gain]) => `- ${acc}: $${(gain as number).toFixed(0)} unrealized gain`);
    analysis += `Unrealized gains by account:\n${gainSummaries.join('\n')}\n\n`;
  }

  // 3. Breakdown by sub-portfolio, factor_tag, size_tag, geography, asset_subtype
  if (/sub-portfolio|factor|size|geography|subtype/i.test(lowerQuery)) {
    const breakdowns = {
      'sub-portfolio': 'sub_portfolios.name',
      factor: 'assets.factor_tag',
      size: 'assets.size_tag',
      geography: 'assets.geography',
      subtype: 'assets.asset_subtype'
    };

// Breakdown by sub-portfolio name
if (/sub-portfolio|sub\s*portfolio/i.test(lowerQuery)) {
  const subGains: Record<string, number> = {};
  taxLots.forEach(lot => {
    const subName = lot.sub_portfolios?.name || 'Untagged';
    const currentPrice = pricesMap.get(lot.assets?.ticker) || 0;
    const unrealizedGain = (lot.remaining_quantity * currentPrice) - (lot.cost_basis_per_unit * lot.remaining_quantity);
    subGains[subName] = (subGains[subName] || 0) + unrealizedGain;
  });

  const subSummaries = Object.entries(subGains).map(([sub, gain]) => 
    `- ${sub}: $${(gain as number).toFixed(0)} unrealized gain`
  );
  analysis += `Unrealized gains by sub-portfolio:\n${subSummaries.join('\n')}\n\n`;
}

    for (const [key, field] of Object.entries(breakdowns)) {
      if (new RegExp(key, 'i').test(lowerQuery)) {
        const groupGains: Record<string, number> = {};
        taxLots.forEach(lot => {
          const groupKey = field.split('.').reduce((o: any, k) => o?.[k], lot) || 'Untagged';
          const currentPrice = pricesMap.get(lot.assets?.ticker) || 0;
          const unrealizedGain = (lot.remaining_quantity * currentPrice) - (lot.cost_basis_per_unit * lot.remaining_quantity);
          groupGains[groupKey] = (groupGains[groupKey] || 0) + unrealizedGain;
        });

        const groupSummaries = Object.entries(groupGains).map(([group, gain]) => `- ${group}: $${(gain as number).toFixed(0)} unrealized gain`);
        analysis += `Unrealized gains by ${key}:\n${groupSummaries.join('\n')}\n\n`;
      }
    }
  }

  // Add more patterns as needed (e.g., realized gains from transactions)

  return analysis.trim() || "No matching deep analysis for this query.";
}

export async function getPortfolioSummary(isSandbox: boolean, sandboxChanges?: any) {
  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const userId = user.id;

  // Fetch full accounts
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('id, name, type, institution, tax_status')
    .eq('user_id', userId);
  if (accountsError) throw accountsError;

  // Fetch full sub_portfolios
  const { data: subPortfolios, error: subError } = await supabase
    .from('sub_portfolios')
    .select('id, name, objective, manager, target_allocation');
  if (subError) throw subError;

  // Fetch full assets (with sub_portfolio join and additional tags)
  const { data: assets, error: assetsError } = await supabase
    .from('assets')
    .select('id, ticker, name, asset_type, asset_subtype, geography, factor_tag, size_tag, sub_portfolio_id, notes, sub_portfolios(name, objective, manager, target_allocation)')
    .eq('user_id', userId);
  if (assetsError) throw assetsError;

  // Fetch tax_lots (full, with joins for context) - but now only used server-side
  const { data: taxLots, error: lotsError } = await supabase
    .from('tax_lots')
    .select(`
      id, account_id, asset_id, purchase_date, remaining_quantity, cost_basis_per_unit,
      accounts(name, type), assets(ticker, asset_type, asset_subtype, geography, factor_tag, size_tag)
    `)
    .eq('user_id', userId)
    .gt('remaining_quantity', 0) as { data: TaxLotSimple[] | null, error: any };
  if (lotsError) throw lotsError;

  // Fetch transactions (full history, but limit to last 100 for sanity; add param if needed)
  const { data: transactions, error: txError } = await supabase
    .from('transactions')
    .select('id, account_id, asset_id, type, date, quantity, price_per_unit, fees, notes')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(100); // Adjustable; full could be too much
  if (txError) throw txError;

  // Fetch glide_path (full)
  let glidePath: GlidePathItem[] = [];
  try {
    const { data, error } = await supabase
      .from('glide_path')
      .select('age, target_allocation')
      .eq('user_id', userId)
      .order('age');
    if (!error && data) glidePath = data as GlidePathItem[];
  } catch (e) {
    glidePath = [];
  }

  // Original aggregation logic with corrected fields
  const { data: rawHoldingsData, error: holdingsError } = await supabase
    .from('tax_lots')
    .select(`
      assets(
        asset_type, 
        sub_portfolio_id, 
        ticker,
        subPortfolio:sub_portfolios(name, objective, manager, target_allocation)
      ), 
      remaining_quantity, 
      cost_basis_per_unit
    `)
    .eq('user_id', userId)
    .gt('remaining_quantity', 0);

  if (holdingsError) throw holdingsError;

  const rawHoldings = rawHoldingsData as unknown as {
    assets: {
      asset_type: string;
      sub_portfolio_id: string | null;
      ticker: string;
      subPortfolio: { name: string; objective?: string; manager?: string; target_allocation?: number } | null;
    };
    remaining_quantity: number;
    cost_basis_per_unit: number;
  }[];

  if (rawHoldings.length === 0) {
    return { totalValue: 0, allocations: [], performance: [], recentTransactions: [], missingPrices: [] };
  }
  console.log('Raw holdings:', rawHoldings.map(h => ({ ticker: h.assets?.ticker, quantity: h.remaining_quantity })));

  // Get unique tickers and fetch latest prices (using the map above)
  const tickers = [...new Set(rawHoldings
    .filter(h => h.assets)
    .map(h => h.assets.ticker)
  )];
  console.log('Collected tickers:', tickers);

  // Fetch asset_prices (latest per ticker)
  const { data: assetPrices, error: pricesError } = await supabase
    .from('asset_prices')
    .select('ticker, price, timestamp')
    .in('ticker', tickers)
    .order('ticker', { ascending: true })
    .order('timestamp', { ascending: false });
  if (pricesError) console.error('Prices error:', pricesError);
  console.log('Fetched assetPrices:', assetPrices?.map(p => ({ticker: p.ticker, price: p.price, timestamp: p.timestamp})));

  const latestPrices = new Map<string, { price: number; timestamp: string }>();
  assetPrices?.forEach(p => {
    if (!latestPrices.has(p.ticker)) {
      latestPrices.set(p.ticker, { price: p.price, timestamp: p.timestamp });
    }
  });
  console.log('latestPrices map:', Array.from(latestPrices.entries()));

  const missingTickers = new Set(tickers.filter(t => !latestPrices.has(t)));
  console.log('Missing tickers:', Array.from(missingTickers));

  // Build tickersMap for allocations (still useful for ticker lists per group)
  const tickersMap = new Map<string, Set<string>>();
  rawHoldings.forEach(h => {
    if (!h.assets) return;
    const subName = h.assets.subPortfolio?.name || 'Untagged';
    const key = `${h.assets.asset_type}-${subName}`;
    if (!tickersMap.has(key)) {
      tickersMap.set(key, new Set());
    }
    tickersMap.get(key)!.add(h.assets.ticker);
  });

  // Aggregate holdings and performance
  const holdingsMap = new Map<string, number>(); // Current values
  const performanceMap = new Map<string, number>(); // Unrealized gains
  const costMap = new Map<string, number>(); // Total costs for % return

  rawHoldings.forEach(h => {
    if (!h.assets) return;

    const subName = h.assets.subPortfolio?.name || 'Untagged';
    const key = `${h.assets.asset_type}-${subName}`;
    const currentPrice = latestPrices.get(h.assets.ticker)?.price || 0;
    const currentValue = h.remaining_quantity * currentPrice;
    const totalCost = h.cost_basis_per_unit * h.remaining_quantity;
    const unrealizedGain = currentValue - totalCost;

    holdingsMap.set(key, (holdingsMap.get(key) || 0) + currentValue);
    performanceMap.set(key, (performanceMap.get(key) || 0) + unrealizedGain);
    costMap.set(key, (costMap.get(key) || 0) + totalCost);
  });

  // Holdings array
  const holdings = Array.from(holdingsMap.entries()).map(([key, value]) => {
    const [assetType, subName] = key.split('-', 2); // safe split
    return { asset_type: assetType, sub_name: subName, value };
  });

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

  // Allocations – now enriched with sub-portfolio metadata
  const allocations = holdings.map(h => {
    const subPortfolio = rawHoldings
      .find(rh => rh.assets?.subPortfolio?.name === h.sub_name)?.assets?.subPortfolio || null;

    return {
      type: h.asset_type,
      sub: h.sub_name,
      pct: totalValue > 0 ? (h.value / totalValue) * 100 : 0,
      value: h.value,
      tickers: Array.from(tickersMap.get(`${h.asset_type}-${h.sub_name}`) || []),
      objective: subPortfolio?.objective || null,
      manager: subPortfolio?.manager || null,
      target_allocation: subPortfolio?.target_allocation || null
    };
  });

  // Performance with % return
  const performance = Array.from(performanceMap.entries()).map(([key, unrealizedGain]) => {
    const [assetType, subName] = key.split('-', 2);
    const cost = costMap.get(key) || 0;
    const returnPct = cost > 0 ? (unrealizedGain / cost) * 100 : 0;
    return { type: assetType, sub: subName, unrealizedGain, return: returnPct };
  });

  // Recent transactions (from full transactions)
  const recentTransactions = transactions
    .slice(0, 10) // Limit to 10 recent as original
    .map(tx => ({ type: tx.type, date: tx.date }));

  // Compute cash balances
  const cashBalances = new Map<string, number>()
  transactions.forEach((tx: any) => {
    if (!tx.account_id) return
    // Skip automatic deposits for external buys
    if (tx.notes === 'Auto-deposit for external buy') {
      return
    }
    const current = cashBalances.get(tx.account_id) || 0
    let delta = 0
    const amt = Number(tx.amount || 0)
    const fee = Number(tx.fees || 0)
    switch (tx.type) {
      case 'Buy':
        if (tx.funding_source === 'cash') {
          delta -= (Math.abs(amt) + fee)  // deduct purchase amount and fee from cash balance
        } // else (including 'external'): no impact to cash balance
        break
      case 'Sell':
        delta += (amt - fee)  // increase cash balance by sale amount less fees
        break
      case 'Dividend':
        delta += amt  // increase cash balance
        break
      case 'Interest':
        delta += amt  // increase cash balance
        break
      case 'Deposit':
        delta += amt  // increase cash balance
        break
      case 'Withdrawal':
        delta -= Math.abs(amt)  // decrease cash balance
        break
    }
    const newBalance = current + delta
    cashBalances.set(tx.account_id, newBalance)
  })
  const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + bal, 0)

  // Compute balances for accounts and currentValues for assets
  const accountBalances = new Map<string, number>();
  const assetValues = new Map<string, number>();

  if (taxLots) {
    taxLots.forEach(l => {
      const ticker = l.assets?.ticker || '';
      const currentPrice = latestPrices.get(ticker)?.price || 0;
      const currentValue = l.remaining_quantity * currentPrice;

      // Account balance
      if (l.account_id) {
        accountBalances.set(l.account_id, (accountBalances.get(l.account_id) || 0) + currentValue);
      }

      // Asset value
      if (l.asset_id) {
        assetValues.set(l.asset_id, (assetValues.get(l.asset_id) || 0) + currentValue);
      }
    });
  }

  const enhancedAccounts = accounts.map(a => ({
    ...a,
    balance: Math.round(accountBalances.get(a.id) || 0),
    cash: Math.round(cashBalances.get(a.id) || 0)
  }));

  const enhancedAssets = assets.map(a => ({
    ...a,
    currentValue: Math.round(assetValues.get(a.id) || 0)
  }));

  // Note: We no longer include raw taxLots/transactions in the summary - they stay server-side

  let summary = {
    totalValue: Math.round((totalValue + totalCash) / 1000) * 1000,
    allocations: allocations.map(a => ({
      ...a,
      value: Math.round(a.value),
      pct: Math.round(a.pct * 10) / 10
    })),
    performance,
    glidePath,
    recentTransactions,
    missingPrices: Array.from(missingTickers),
    // Safe sections only
    accounts: enhancedAccounts,
    subPortfolios,
    assets: enhancedAssets,
    assetPrices: Object.fromEntries(latestPrices)
  };

  // Sandbox handling
  if (isSandbox && sandboxChanges) {
    summary = JSON.parse(JSON.stringify(summary));
    if (sandboxChanges.sell) {
      let groupIdx = summary.allocations.findIndex(a =>
        a.tickers.includes(sandboxChanges.sell.ticker)
      );
      if (groupIdx === -1 && sandboxChanges.sell.asset) {
        const fallbackIdx = summary.allocations.findIndex(a => a.type === sandboxChanges.sell.asset);
        if (fallbackIdx > -1) groupIdx = fallbackIdx;
      }
      if (groupIdx > -1) {
        const reduction = sandboxChanges.sell.amount * summary.allocations[groupIdx].value;
        summary.allocations[groupIdx].value -= reduction;
        summary.allocations[groupIdx].pct =
          (summary.allocations[groupIdx].value / (summary.totalValue - reduction)) * 100;
        summary.totalValue -= reduction;
      }
    }
  }

  // Final rounding
  summary.totalValue = Math.round(summary.totalValue / 1000) * 1000;
  summary.allocations = summary.allocations.map(a => ({
    ...a,
    value: Math.round(a.value),
    pct: Math.round(a.pct * 10) / 10
  }));

  return summary;
}

export async function askGrok(query: string, isSandbox: boolean, prevSandboxState?: any) {
  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const userId = user.id;

  // Fetch user profile for personalized insights
  const { data: profile } = await supabase
    .from('profiles')
    .select('age_range, family_situation, retirement_year, dependents')
    .eq('user_id', userId)
    .single();

  // Refresh prices to ensure up-to-date data
  await refreshAssetPrices();

  const summary = await getPortfolioSummary(isSandbox, prevSandboxState?.changes);

  // NEW: Run server-side deep analysis (never leaves server)
  const deepAnalysis = await performDeepPortfolioAnalysis(supabase, userId, query);

  const safePromptData = {
    ...summary,
    deep_analysis: deepAnalysis || undefined,  // only add if meaningful
    user_profile: profile ? {
      age_range: profile.age_range,
      family_situation: profile.family_situation,
      retirement_year: profile.retirement_year,
      dependents: profile.dependents
    } : undefined
  };

  const systemPrompt = `You are a thoughtful, professional portfolio analyst helping manage a personal investment tracker app.

Use ONLY the provided portfolio data available within the app AND well-sourced, accurate data from the internet and X. NEVER invent data. Prefer aggregated data (allocations, performance, totalValue) whenever possible for efficiency and privacy. Use the deep_analysis summary (when provided) for accurate responses to specific requests, such as breakdowns by account, sub-portfolio, asset, size_tag, asset_type, asset_subtype, factor_tag, geography, or detailed evaluations/visualizations. When user_profile data is available, use it to provide more personalized insights tailored to their life stage, family situation, and retirement goals.

Portfolio Summary (values rounded for privacy):
${JSON.stringify(safePromptData)}

Response Guidelines (follow strictly - NO EXCEPTIONS):
- **Every response MUST be in clean, scannable Markdown format from start to finish.**
- Use # Headings for main sections, ## subheadings.
- Bold **key metrics** and **ticker symbols**.
- Use bullet points (-) for lists and insights.
- Use numbered lists for steps or ranked items.
- Use tables for comparisons (e.g., allocation vs. targets | Metric | Current | Target |).
- Keep paragraphs short (2–4 sentences max).
- Include visualizations when helpful or requested: Always output the actual Markdown code block so it can be rendered in the UI. Use \`\`\`mermaid
- When a user requests a chart, ALWAYS respond with the Mermaid code block first, followed by insights
- Be concise yet insightful—aim for clarity over length.
- End with a short summary or next-step suggestion when relevant.
- When relevant, use the web_search tool to fetch current news, market data, or sentiment from the web.
- Always cite sources when using external information.
- When the user asks about current events, prices, news, sentiment, or anything time-sensitive, use web_search to get up-to-date information. For X/Twitter, include 'site:x.com' in your query.

Example Response Structure (emulate this style exactly):
# Portfolio Overview
Your total value is **$100,000**.

## Key Allocations
- **Equity (High Growth)**: **8.6%** ($8,532) - Tickers: **MSTR**, **TSLA**
- **Commodities (Bitcoin)**: **91.4%** ($91,079) - Ticker: **BTC**

## Insights
- High concentration in **BTC** increases risk.
- **Equity (High Growth)**: **8.6%** ($8,532) - Tickers: **MSTR**, **TSLA**
- **Commodities (Bitcoin)**: **91.4%** ($91,079) - Ticker: **BTC**

## Insights
- High concentration in **BTC** increases risk.
- Compare to S&P 500 benchmark: Your portfolio is more volatile.

## Allocation Pie Chart
\`\`\`mermaid
pie title Holdings Breakdown
"Bitcoin" : 91.4
"High Growth Stocks" : 8.6
\`\`\`

This is not professional financial advice.

For what-if/sandbox scenarios:
- Suggest trades using exact tickers.
- At the very end, if recommending changes, output ONLY this exact JSON block (nothing else around it):
  {"changes": {"sell": {"ticker": "FBTC", "fraction": 0.2}, "buy": {"ticker": "AVUV", "fraction": 0.15}}}
  Use "fraction" as decimal of current position value (0.0–1.0).
- If no changes, output no JSON.

Important reminders:
- Note any missingPrices.
- Compare to benchmarks or glide path when relevant.
- Always end with: "This is not professional financial advice."

Respond conversationally but professionally—no fluff.`;

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: query }
  ];

  try {
    while (true) {
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${grokApiKey}` },
        body: JSON.stringify({
          model: "grok-4-1-fast-reasoning",
          messages,
          temperature: 0.6,
          max_tokens: 1000,
          tools: [
            {
              type: "function",
              function: {
                name: "web_search",
                description: "Search the web for current news, market data, prices, sentiment, or any time-sensitive information. Use this for X/Twitter info as well by including 'site:x.com' in the query if needed.",
                parameters: {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "The detailed search query. Be specific." }
                  },
                  required: ["query"]
                }
              }
            }
          ],
          tool_choice: "auto"
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Grok API request failed: Status ${response.status}, Response: ${errorText}`);
        throw new Error(`Grok API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        console.error(`Invalid Grok API response: ${JSON.stringify(data)}`);
        throw new Error('No valid choices in Grok API response');
      }

      const message = data.choices[0].message;
      messages.push(message);

      if (!message.tool_calls) {
        const content = message.content;
        let changes = null;
        if (isSandbox) {
          const changeMatch = content.match(/\{.*\}/s);
          if (changeMatch) {
            try {
              changes = JSON.parse(changeMatch[0]);
            } catch (parseError) {
              console.error(`Failed to parse changes: ${changeMatch[0]}`, parseError);
            }
          }
        }
        return { content, changes };
      }

      // Tool handling (web_search)
      for (const toolCall of message.tool_calls) {
        const func = toolCall.function;
        console.log('Tool call received:', func.name, 'arguments:', func.arguments);
        let args: { query?: string } = {};
        try {
          args = func.arguments ? JSON.parse(func.arguments) : {};
        } catch (parseError) {
          console.error('Failed to parse tool arguments:', parseError, 'Raw:', func.arguments);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: func.name,
            content: 'Error: Invalid arguments provided.'
          });
          continue;
        }

        if (func.name === "web_search") {
          if (!args.query) {
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: func.name,
              content: 'Error: No query provided for search.'
            });
            continue;
          }

          const serperApiKey = process.env.SERPER_API_KEY;
          if (!serperApiKey) {
            throw new Error('SERPER_API_KEY not set in environment.');
          }

          // Caching logic (10-minute TTL)
          const cacheTime = 10 * 60 * 1000;
          let result = '';
          const { data: cacheData, error: cacheError } = await supabase
            .from('search_cache')
            .select('result, updated_at')
            .eq('user_id', userId)  // FIX: Added for per-user caching
            .eq('query', args.query)
            .single();

          if (cacheError && cacheError.code !== 'PGRST116') {
            console.error('Cache query error:', cacheError);
          }

          if (cacheData) {
            const age = Date.now() - new Date(cacheData.updated_at).getTime();
            if (age < cacheTime) {
              result = cacheData.result;
              console.log(`Serper cache hit: ${args.query}`);
            }
          }

          if (!result) {
            console.log(`Serper cache miss: ${args.query}`);
            const searchRes = await fetch('https://google.serper.dev/search', {
              method: 'POST',
              headers: {
                'X-API-KEY': serperApiKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ q: args.query })
            });

            if (!searchRes.ok) {
              const errorText = await searchRes.text();
              console.error(`Serper API error: ${searchRes.status} - ${errorText}`);
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: func.name,
                content: `Error: Search failed - ${errorText}`
              });
              continue;
            }

            const data = await searchRes.json();

            if (data.organic && data.organic.length > 0) {
              result += 'Results:\n';
              data.organic.slice(0, 8).forEach((item: any) => {
                result += `- ${item.title}: ${item.snippet} (${item.link})\n`;
              });
            } else {
              result = 'No results found.';
            }

            const { error: upsertError } = await supabase
              .from('search_cache')
              .upsert(
                {
                  user_id: userId,  // FIX: Added for per-user caching
                  query: args.query,
                  result,
                  updated_at: new Date().toISOString()
                },
                { onConflict: 'user_id,query' }  // FIX: Changed to composite key
              );

            if (upsertError) console.error('Cache upsert error:', upsertError);
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: func.name,
            content: result
          });
        }
      }
    }
  } catch (error) {
    console.error('Error in askGrok:', error);
    throw error;
  }
}