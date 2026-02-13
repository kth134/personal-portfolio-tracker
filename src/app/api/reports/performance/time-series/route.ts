// Dummy real-like series for charts (remove after full calcs)
const dummySeries = [
  { date: '2026-01', twr: 2.5, mwr: 2.0, benchmark: 1.8 },
  { date: '2026-02', twr: 3.2, mwr: 2.9, benchmark: 2.1 },
  { date: '2026-03', twr: 1.8, mwr: 1.5, benchmark: 1.2 },
];

return NextResponse.json({ series: dummySeries, metrics: [], benchmarks: null });
