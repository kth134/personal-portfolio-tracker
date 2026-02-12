'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const data = [
  { date: 'Jan', mwr: 2, twr: 1.5 },
  { date: 'Feb', mwr: 3, twr: 2.8 },
];

export default function PerformancePage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Performance Reports v1</h1>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="mwr" stroke="#8884d8" name="MWR" />
          <Line type="monotone" dataKey="twr" stroke="#82ca9d" name="TWR" />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-4">Full lenses/agg/benchmarks next.</p>
    </div>
  );
}
