'use server';

import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const grokApiKey = process.env.GROK_API_KEY!;

export async function getPortfolioSummary(isSandbox: boolean, sandboxChanges?: any) {
  const cookieStore = await cookies();  // Await the cookies() call
  const supabaseAuth = createServerClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
    },
  });
  const { data: { session } } = await supabaseAuth.auth.getSession();
  if (!session) throw new Error('Unauthorized');

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch real data (adapt to schema)
  const { data: holdings } = await supabase.from('holdings').select('asset_class, sub_portfolio, value, performance');
  if (!holdings) throw new Error('Failed to fetch holdings data');
  const { data: glidePath } = await supabase.from('glide_path').select('age, target_allocation');
  // Fetch transactions, etc., for full duplication if needed

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  let summary = {
    totalValue,
    allocations: holdings.map(h => ({ class: h.asset_class, sub: h.sub_portfolio, pct: (h.value / totalValue) * 100, value: h.value })),
    performance: holdings.map(h => ({ class: h.asset_class, return: h.performance })),
    glidePath,
    // Add summaries: recent transactions, benchmarks
  };

  if (isSandbox && sandboxChanges) {
    // Apply changes: e.g., simulate trades (this is simplistic; expand as needed)
    // Parse changes from Grok's prior response or query, e.g., { sell: { asset: 'BTC', amount: 0.5 } }
    // Duplicate and modify summary in-memory
    summary = JSON.parse(JSON.stringify(summary)); // Deep copy
    // Example simulation: Adjust for sell
    if (sandboxChanges.sell) {
      const asset = summary.allocations.find(a => a.class === sandboxChanges.sell.asset);
      if (asset) {
        asset.pct -= sandboxChanges.sell.amount * asset.pct;
        summary.totalValue -= sandboxChanges.sell.amount * (asset.value || 0); // Adjust value too
      }
    }
    // Recompute performance, allocations, etc., using your calc logic (e.g., FIFO for gains)
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

  // If sandbox, parse for structured changes (e.g., regex or JSON.parse if formatted)
  let changes = null;
  if (isSandbox) {
    const changeMatch = content.match(/\{[\s\S]*\}/); // Simple parse; improve with JSON
    if (changeMatch) changes = JSON.parse(changeMatch[0]);
  }

  return { content, changes };
}