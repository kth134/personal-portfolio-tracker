'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getPerformanceData, lenses } from '@/lib/finance';

export default function PerformancePage() {
  const data = getPerformanceData();

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Performance Reports v1</h1>
      <div className="mb-8 flex gap-4">
        <label>Lens: </label>
        <select>
          {lenses.map(l => <option key={l}>{l}</option>)}
        </select>
        <label>Agg: </label>
        <input type="checkbox" />
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="mwr" stroke="#8884d8" name="MWR (%)" />
          <Line type="monotone" dataKey="twr" stroke="#82ca9d" name="TWR (%)" />
          <Line type="monotone" dataKey="benchmark" stroke="#ff7300" name="Benchmark" />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-4">Full Supabase/yfinance data next.</p>
    </div>
  );
}
