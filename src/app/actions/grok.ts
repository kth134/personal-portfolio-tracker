'use server';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const grokApiKey = process.env.GROK_API_KEY!;

interface GlidePathItem {
  age: number;
  target_allocation: any; // Adjust type as needed based on actual data structure
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

  // Fetch raw tax lots with join to assets for type/sub/ticker
  const { data: rawHoldingsData, error: holdingsError } = await supabase
    .from('tax_lots')
    .select('assets(asset_type, sub_portfolio, ticker), remaining_quantity, cost_basis_per_unit')
    .eq('user_id', userId)
    .gt('remaining_quantity', 0); // Only unsold portions

  if (holdingsError) throw holdingsError;

  const rawHoldings = rawHoldingsData as unknown as {
    assets: { asset_type: string; sub_portfolio: string; ticker: string };
    remaining_quantity: number;
    cost_basis_per_unit: number;
  }[];

  if (rawHoldings.length === 0) {
    return { totalValue: 0, allocations: [], performance: [], recentTransactions: [], missingPrices: [] }; // Early return if no holdings
  }

  // Get unique tickers and fetch latest prices
  const tickers = [...new Set(rawHoldings
  .filter(h => h.assets)
  .map(h => h.assets.ticker)
)];
  const { data: rawPrices, error: pricesError } = await supabase
    .from('asset_prices')
    .select('ticker, price, timestamp')
    .in('ticker', tickers)
    .order('ticker', { ascending: true })
    .order('timestamp', { ascending: false });
  if (pricesError) throw pricesError;

  // Map to latest price per ticker (first per group since ordered desc timestamp)
  const latestPrices = new Map<string, number>();
  rawPrices.forEach(p => {
    if (!latestPrices.has(p.ticker)) {
      latestPrices.set(p.ticker, p.price);
    }
  });

  const missingTickers = new Set(tickers.filter(t => !latestPrices.has(t)));

  // Build tickersMap for allocations
  const tickersMap = new Map<string, Set<string>>();
  rawHoldings.forEach(h => {
  if (!h.assets) return; // Skip bad rows silently
  const key = `${h.assets.asset_type}-${h.assets.sub_portfolio}`;
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
  if (!h.assets) return; // Critical guard — skip if no linked asset

  const key = `${h.assets.asset_type}-${h.assets.sub_portfolio}`;
  const currentPrice = latestPrices.get(h.assets.ticker) || 0;
  const currentValue = h.remaining_quantity * currentPrice;
  const totalCost = h.cost_basis_per_unit * h.remaining_quantity;
  const unrealizedGain = currentValue - totalCost;

  holdingsMap.set(key, (holdingsMap.get(key) || 0) + currentValue);
  performanceMap.set(key, (performanceMap.get(key) || 0) + unrealizedGain);
  costMap.set(key, (costMap.get(key) || 0) + totalCost);
});

// Holdings array
const holdings = Array.from(holdingsMap.entries()).map(([key, value]) => {
  const [assetType, subPortfolio] = key.split('-');
  return { asset_type: assetType, sub_portfolio: subPortfolio, value };
});

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

  // Allocations
const allocations = holdings.map(h => ({  
  type: h.asset_type,  
  sub: h.sub_portfolio,  
  pct: totalValue > 0 ? (h.value / totalValue) * 100 : 0,  
  value: h.value,  
  tickers: Array.from(tickersMap.get(`${h.asset_type}-${h.sub_portfolio}`) || [])  
}));  

  // Performance with % return
  const performance = Array.from(performanceMap.entries()).map(([key, unrealizedGain]) => {
    const [assetType, subPortfolio] = key.split('-');
    const cost = costMap.get(key) || 0;
const returnPct = cost > 0 ? (unrealizedGain / cost) * 100 : 0; // Or 'N/A' if you prefer string      return { type: assetType, sub: subPortfolio, unrealizedGain, return: returnPct };
  });

  // Glide path
  let glidePath: GlidePathItem[] = [];
  try {
    const { data, error } = await supabase
      .from('glide_path')
      .select('age, target_allocation')
      .eq('user_id', userId)
      .order('age');
    if (!error && data) glidePath = data as GlidePathItem[];
  } catch (e) {
    // Table doesn't exist yet — safe to ignore
    glidePath = [];
  }

  // Recent transactions (unchanged)
  const { data: rawTransactions, error: txError } = await supabase  
  .from('transactions')  
  .select('type, date') // Add date for context  
  .eq('user_id', userId)  
  .gte('date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())  
  .order('date', { ascending: false })  
  .limit(10);  
  if (txError) throw txError;

  const transactionCounts = new Map<string, number>();
  rawTransactions.forEach(tx => {
    const count = transactionCounts.get(tx.type) || 0;
    transactionCounts.set(tx.type, count + 1);
  });
const transactions = rawTransactions.map(tx => ({ type: tx.type, date: tx.date }));  
  let summary = {
totalValue: Math.round(totalValue / 1000) * 1000, // Nearest $1k  
allocations: allocations.map(a => ({ ...a, value: Math.round(a.value), pct: Math.round(a.pct * 10) / 10 })), // 1 decimal pct  
    performance,
    glidePath,
    recentTransactions: transactions,
    missingPrices: Array.from(missingTickers),
  };

  if (isSandbox && sandboxChanges) {
    summary = JSON.parse(JSON.stringify(summary)); // Deep copy
        if (sandboxChanges.sell) {
        // Prefer ticker match first
        let groupIdx = summary.allocations.findIndex(a =>
            a.tickers.includes(sandboxChanges.sell.ticker)
        );
        if (groupIdx === -1 && sandboxChanges.sell.asset) {
            // Fallback to old type-based (for backward compatibility)
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
    // TODO: Adjust performance for changes if needed
  }

  // Apply consistent privacy rounding to both real and sandbox summaries
  summary.totalValue = Math.round(summary.totalValue / 1000) * 1000;
  summary.allocations = summary.allocations.map(a => ({
    ...a,
    value: Math.round(a.value),
    pct: Math.round(a.pct * 10) / 10  // One decimal place
  }));

  return summary;}

export async function askGrok(query: string, isSandbox: boolean, prevSandboxState?: any) {
  const summary = await getPortfolioSummary(isSandbox, prevSandboxState?.changes);

const systemPrompt = `You are a thoughtful, professional portfolio analyst helping manage a personal investment tracker app.

Use ONLY the provided portfolio data available within the app and well-sourced, accurate data from the internet—never invent data.

Portfolio Summary (values rounded for privacy):
${JSON.stringify(summary)}

Response Guidelines (follow strictly - NO EXCEPTIONS):
- **Every response MUST be in clean, scannable Markdown format from start to finish.**
- Use # Headings for main sections, ## subheadings.
- Bold **key metrics** and **ticker symbols**.
- Use bullet points (-) for lists and insights.
- Use numbered lists for steps or ranked items.
- Use tables for comparisons (e.g., allocation vs. targets | Metric | Current | Target |).
- Keep paragraphs short (2–4 sentences max).
- Include visualizations when helpful: Use Markdown code blocks (e.g., \`\`\`mermaid for simple charts/graphs, or \`\`\`python for quick plots).
- Be concise yet insightful—aim for clarity over length.
- End with a short summary or next-step suggestion when relevant.
- When relevant, use available tools to fetch current news, market data, or sentiment from the web or X.
- Always cite sources when using external information.
- When the user asks about current events, prices, news, sentiment, or anything time-sensitive, use live_search to get up-to-date information.

Example Response Structure (emulate this style exactly):
# Portfolio Overview
Your total value is **$100,000**.

## Key Allocations
- **Equity (High Growth)**: **8.6%** ($8,532) - Tickers: **MSTR**, **TSLA**
- **Commodities (Bitcoin)**: **91.4%** ($91,079) - Ticker: **BTC**

## Insights
- High concentration in **BTC** increases risk.
- Compare to S&P 500 benchmark: Your portfolio is more volatile.

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
 
try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${grokApiKey}` },
body: JSON.stringify({
  model: "grok-4-1-fast-reasoning",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: query }
  ],
  temperature: 0.6,
  max_tokens: 1000,
  tools: [
    {
      type: "live_search",
      sources: [
        { type: "web" },
        { type: "x" }
      ]
    }
  ],
  tool_choice: "auto"
}),
    });

    if (!response.ok) {
      const errorText = await response.text(); // Get raw text for debugging
      console.error(`Grok API request failed: Status ${response.status}, Response: ${errorText}`);
      throw new Error(`Grok API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      console.error(`Invalid Grok API response structure: ${JSON.stringify(data)}`);
      throw new Error('No valid choices in Grok API response');
    }

    const content = data.choices[0].message.content;

    let changes = null;
    if (isSandbox) {
      const changeMatch = content.match(/\{.*\}/s);
      if (changeMatch) {
        try {
          changes = JSON.parse(changeMatch[0]);
        } catch (parseError) {
          console.error(`Failed to parse changes from Grok response: ${changeMatch[0]}`, parseError);
          // Don't throw here—allow response to proceed without changes
        }
      }
    }

    return { content, changes };
  } catch (error) {
    console.error('Error in askGrok:', error);
    throw error; // Re-throw to propagate to caller/UI
  }
}    