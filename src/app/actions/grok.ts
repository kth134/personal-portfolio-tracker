'use server';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const grokApiKey = process.env.GROK_API_KEY!;

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

  // Query holdings: Fetch raw data and aggregate in JS
  const { data: rawHoldings, error: holdingsError } = await supabase
    .from('tax_lots')
    .select('assets!inner(asset_class, sub_portfolio), quantities, price')
    .eq('user_id', userId)
    .eq('sold', false); // Only unsold lots

  if (holdingsError) throw holdingsError;

  // Aggregate by asset_class and sub_portfolio
  const holdingsMap = new Map();
  rawHoldings.forEach(h => {
    const key = `${h.assets[0].asset_class}-${h.assets[0].sub_portfolio}`;
    const value = h.quantities * h.price;
    if (holdingsMap.has(key)) {
      holdingsMap.set(key, holdingsMap.get(key) + value);
    } else {
      holdingsMap.set(key, value);
    }
  });

  const holdings = Array.from(holdingsMap.entries()).map(([key, value]) => {
    const [assetClass, subPortfolio] = key.split('-');
    return { assets: { asset_class: assetClass, sub_portfolio: subPortfolio }, value };
  });

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

  // Allocations
  const allocations = holdings.map(h => ({
    class: h.assets.asset_class,
    sub: h.assets.sub_portfolio,
    pct: (h.value / totalValue) * 100,
    value: h.value,
  }));

  // Performance: Simple unrealized gains aggregate (expand with time-weighted calc later)
  const { data: performance, error: perfError } = await supabase
    .rpc('calculate_unrealized_gains') // Assume you create an RPC for this; fallback to JS calc
    .single(); // Or query tax_lots for (current_value - basis) sums by class

  if (perfError) throw perfError;

  // Glide path: Assume glide_path table with age/target_allocations
  //const { data: glidePath, error: glideError } = await supabase
    //.from('glide_path')
   // .select('age, target_allocation')
    //.eq('user_id', userId);

  //if (glideError) throw glideError;

  // Transaction summary: Recent count/types
  const { data: rawTransactions, error: txError } = await supabase
    .from('transactions')
    .select('type')
    .eq('user_id', userId)
    .gte('date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()); // Last 30 days

  if (txError) throw txError;

  // Group and count by type
  const transactionCounts = new Map<string, number>();
  rawTransactions.forEach(tx => {
    const count = transactionCounts.get(tx.type) || 0;
    transactionCounts.set(tx.type, count + 1);
  });
  const transactions = Array.from(transactionCounts.entries()).map(([type, count]) => ({ type, count }));

  let summary = {
    totalValue,
    allocations,
    performance: performance || [], // e.g., [{ class: 'stocks', unrealizedGain: 1234 }]
    //glidePath,
    recentTransactions: transactions,
  };

  // Anonymize further if needed (e.g., round values)
  summary.totalValue = Math.round(summary.totalValue);
  summary.allocations = summary.allocations.map(a => ({ ...a, value: Math.round(a.value) }));

  if (isSandbox && sandboxChanges) {
    summary = JSON.parse(JSON.stringify(summary)); // Deep copy
    // Apply changes: e.g., simulate sell
    if (sandboxChanges.sell) {
      const assetIdx = summary.allocations.findIndex(a => a.class === sandboxChanges.sell.asset);
      if (assetIdx > -1) {
        const reduction = sandboxChanges.sell.amount * summary.allocations[assetIdx].value;
        summary.allocations[assetIdx].value -= reduction;
        summary.allocations[assetIdx].pct = (summary.allocations[assetIdx].value / (summary.totalValue - reduction)) * 100;
        summary.totalValue -= reduction;
      }
    }
    // Add more simulation logic (buys, rebalances) as needed
  }

  return summary;
}

export async function askGrok(query: string, isSandbox: boolean, prevSandboxState?: any) {
  const summary = await getPortfolioSummary(isSandbox, prevSandboxState?.changes);

  const systemPrompt = `You are a financial advisor. Portfolio: ${JSON.stringify(summary)}. For what-if, suggest changes and simulate outcomes. Remind: Not professional advice. If query is scenario-based, output structured changes like {sell: {asset: 'BTC', amount: 0.5}} at end for simulation.`;

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${grokApiKey}` },
    body: JSON.stringify({
      model: 'grok-beta',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: query }],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  const data = await response.json();
  const content = data.choices[0].message.content;

  let changes = null;
  if (isSandbox) {
    const changeMatch = content.match(/\{.*\}/s);
    if (changeMatch) {
      try {
        changes = JSON.parse(changeMatch[0]);
      } catch {}
    }
  }

  return { content, changes };
}