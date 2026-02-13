import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { parseISO, format } from 'date-fns';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lens = 'total', aggregate = true, selectedValues = [], start = '2026-01-01', end = format(new Date(), 'yyyy-MM-dd') } = body;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Dummy data for now
    const dummySeries = [
      { date: '2026-01', twr: 2.5, mwr: 2.0, benchmark: 1.8 },
      { date: '2026-02', twr: 3.2, mwr: 2.9, benchmark: 2.1 },
    ];

    return NextResponse.json({ series: dummySeries, metrics: [], benchmarks: null });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
