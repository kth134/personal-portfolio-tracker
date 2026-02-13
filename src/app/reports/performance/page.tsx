'use client';

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { getPerformanceData } from '@/lib/finance';

const LENSES = [
  { value: 'total', label: 'Total Portfolio' },
  { value: 'asset', label: 'Asset' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'account', label: 'Account' },
  { value: 'geography', label: 'Geography' },
  { value: 'size_tag', label: 'Size' },
  { value: 'factor_tag', label: 'Factor' },
];

export default function PerformancePage() {
  const [lens, setLens] = useState('total');
  const [aggregate, setAggregate] = useState(true);

  const data = getPerformanceData();

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Performance Reports v1.1</h1>
      <div className="flex flex-wrap gap-4 items-end mb-8 bg-muted/20 p-4 rounded-lg">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs uppercase font-bold mb-1 block">Lens</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-full md:w-56 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LENSES.map(l => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {lens !== 'total' && (
          <div className="flex items-center gap-2 p-2 border rounded bg-background">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label className="text-sm cursor-pointer whitespace-nowrap">Aggregate</Label>
          </div>
        )}
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
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card p-6 rounded-lg border">
          <h3 className="text-lg font-bold mb-2">Totals</h3>
          <p>Dummy totals panel</p>
        </div>
        {/* More panels */}
      </div>
    </div>
  );
}
