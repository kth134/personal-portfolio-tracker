'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

// Mock data
const chartData = [
  { name: 'Week 1', portfolio: 4000, benchmark: 2400 },
  { name: 'Week 2', portfolio: 3000, benchmark: 1398 },
  { name: 'Week 3', portfolio: 2000, benchmark: 9800 },
  { name: 'Week 4', portfolio: 2780, benchmark: 3908 },
  { name: 'Week 5', portfolio: 1890, benchmark: 4800 },
  { name: 'Week 6', portfolio: 2390, benchmark: 3800 },
  { name: 'Week 7', portfolio: 3490, benchmark: 4300 },
];

const aggData = {
  annualizedIRR: 0.12,
  totalReturn: 15.3,
  netGain: 25340,
};

export default function PerformanceReportPage() {
  return (
    <main className="flex min-h-screen flex-col p-8 md:p-24">
      <h1 className="text-4xl font-bold mb-12">Performance Reports</h1>
      <div className="grid gap-8">
        <Tabs defaultValue="charts" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="charts">Charts</TabsTrigger>
            <TabsTrigger value="lenses">Lenses</TabsTrigger>
            <TabsTrigger value="agg">Aggregations</TabsTrigger>
            <TabsTrigger value="bench">Benchmarks</TabsTrigger>
          </TabsList>
          <TabsContent value="charts" className="w-full">
            <p className="mb-4">Portfolio growth and returns over time.</p>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData.slice(0,4)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="portfolio" stroke="#3b82f6" name="Portfolio" />
              </LineChart>
            </ResponsiveContainer>
          </TabsContent>
          <TabsContent value="lenses" className="space-y-4">
            <p>Different views and filters (e.g. by asset, account, period).</p>
            <div className="grid grid-cols-2 gap-4">
              <div>Lens 1: Total Portfolio IRR: 12%</div>
              <div>Lens 2: Equities only: 15%</div>
            </div>
          </TabsContent>
          <TabsContent value="agg" className="space-y-4">
            <p>Key aggregation metrics.</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-6 bg-blue-50 rounded-lg"><h3>Annualized IRR</h3><p className="text-3xl font-bold text-green-600">{aggData.annualizedIRR * 100}%</p></div>
              <div className="p-6 bg-green-50 rounded-lg"><h3>Total Return</h3><p className="text-3xl font-bold">{aggData.totalReturn}%</p></div>
              <div className="p-6 bg-yellow-50 rounded-lg"><h3>Net Gain</h3><p className="text-3xl font-bold text-blue-600">${aggData.netGain.toLocaleString()}</p></div>
            </div>
          </TabsContent>
          <TabsContent value="bench" className="w-full">
            <p className="mb-4">Portfolio vs S&P 500 benchmark.</p>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="portfolio" fill="#3b82f6" />
                <Bar dataKey="benchmark" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}