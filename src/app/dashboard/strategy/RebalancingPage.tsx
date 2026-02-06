'use client'

import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, Cell,
} from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { ArrowUpDown } from 'lucide-react'
import { formatUSD } from '@/lib/formatters'
import { cn } from '@/lib/utils'

const LENSES = [
  { value: 'total', label: 'Assets' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'account', label: 'Account' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'size_tag', label: 'Size' },
  { value: 'geography', label: 'Geography' },
  { value: 'factor_tag', label: 'Factor' },
]

export default function RebalancingPage() {
  const [lens, setLens] = useState('total')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [openItems, setOpenItems] = useState<string[]>([])

  // Sorting
  const [sortCol, setSortCol] = useState('drift_percentage')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rebalancing', { cache: 'no-store' })
      const payload = await res.json()
      setData(payload)
      if (payload.subPortfolios) {
        setOpenItems(payload.subPortfolios.map((p: any) => p.id))
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  if (loading || !data) return <div className="p-8 text-center text-lg animate-pulse">Loading...</div>

  const rebalanceNeeded = data.currentAllocations.some((a: any) => a.action !== 'hold')
  const netImpact = -data.cashNeeded 

  const chartSlices = lens === 'total' 
    ? [{ key: 'Full Portfolio', data: data.currentAllocations }]
    : (() => {
        const groups: any[] = []
        data.subPortfolios.forEach((sp: any) => {
          const items = data.currentAllocations.filter((a: any) => a.sub_portfolio_id === sp.id)
          if (items.length > 0) groups.push({ key: sp.name, data: items })
        })
        return groups
      })()

  const SortIcon = ({ col }: { col: string }) => (
    <ArrowUpDown className={cn("ml-1 h-3 w-3 inline cursor-pointer", sortCol === col ? "text-blue-600" : "text-zinc-500")} />
  )

  return (
    <div className="space-y-8 p-4 max-w-[1600px] mx-auto">
      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm">
            <p className="text-xs uppercase font-bold text-muted-foreground">Portfolio Value</p>
            <p className="text-2xl font-bold">{formatUSD(data.totalValue)}</p>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm">
            <p className="text-xs uppercase font-bold text-muted-foreground">Status</p>
            <p className={cn("text-2xl font-bold", rebalanceNeeded ? "text-yellow-600" : "text-green-600")}>
                {rebalanceNeeded ? "Action Needed" : "All Clear"}
            </p>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm">
            <p className="text-xs uppercase font-bold text-muted-foreground text-blue-600">Net Cash Impact</p>
            <p className={cn("text-2xl font-bold", netImpact >= 0 ? "text-green-600" : "text-red-600")}>
                {formatUSD(netImpact)}
            </p>
        </div>
      </div>

      <div className="w-64"><Label className="text-[10px] font-bold uppercase">View Lens</Label><Select value={lens} onValueChange={setLens}><SelectTrigger className="bg-background"><SelectValue/></SelectTrigger><SelectContent>{LENSES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent></Select></div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {chartSlices.map((slice: any, idx: number) => (
          <div key={idx} className="bg-card p-6 rounded-lg border shadow-sm space-y-4">
            <h3 className="font-bold text-center border-b pb-2 tracking-tight">{slice.key} Drift</h3>
            <div className="h-[350px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={[...slice.data].sort((a,b)=>b.drift_percentage - a.drift_percentage)} layout="vertical" margin={{ left: 10, right: 30 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" unit="%" /><YAxis dataKey="ticker" type="category" interval={0} fontSize={10} width={50} /><RechartsTooltip /><Bar dataKey="drift_percentage">{slice.data.map((entry: any, i: number) => (<Cell key={i} fill={Math.abs(entry.drift_percentage) > 5 ? '#ef4444' : '#10b981'} />))}</Bar></BarChart></ResponsiveContainer></div>
          </div>
        ))}
      </div>

      <div className="pt-8 border-t">
        <h2 className="text-xl font-bold mb-4">Tactical Execution Table</h2>
        <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
          {data.subPortfolios.map((sp: any) => {
            const items = data.currentAllocations.filter((a: any) => a.sub_portfolio_id === sp.id)
            if (items.length === 0) return null
            return (
              <AccordionItem key={sp.id} value={sp.id} className="border rounded-lg mb-4 overflow-hidden">
                <AccordionTrigger className="bg-black text-white px-4 hover:bg-zinc-800">
                    <div className="flex justify-between w-full mr-4 font-bold tracking-tight"><span>{sp.name}</span><span>{formatUSD(items.reduce((s:number, i:any) => s+i.current_value, 0))}</span></div>
                </AccordionTrigger>
                <AccordionContent className="p-0 bg-background overflow-x-auto">
                    <Table className="min-w-[1100px]">
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead className="w-[15%] cursor-pointer" onClick={()=>setSortCol('ticker')}>Asset <SortIcon col="ticker"/></TableHead>
                                <TableHead className="w-[12%] text-right cursor-pointer" onClick={()=>setSortCol('current_value')}>Current Value ($) <SortIcon col="current_value"/></TableHead>
                                <TableHead className="w-[10%] text-right cursor-pointer" onClick={()=>setSortCol('current_in_sp')}>Current Weight <SortIcon col="current_in_sp"/></TableHead>
                                <TableHead className="w-[10%] text-right text-blue-600">Target Weight</TableHead>
                                <TableHead className="w-[10%] text-right cursor-pointer" onClick={()=>setSortCol('implied_overall_target')}>Implied Overall % <SortIcon col="implied_overall_target"/></TableHead>
                                <TableHead className="w-[10%] text-right cursor-pointer" onClick={()=>setSortCol('drift_percentage')}>Drift <SortIcon col="drift_percentage"/></TableHead>
                                <TableHead className="w-[10%] text-center">Action</TableHead>
                                <TableHead className="w-[23%] text-right">Tactical Suggestion</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {[...items].sort((a,b)=>{
                              const aV = a[sortCol]; const bV = b[sortCol];
                              const res = aV < bV ? -1 : aV > bV ? 1 : 0;
                              return sortDir === 'asc' ? res : -res;
                            }).map((i: any) => (
                                <TableRow key={i.asset_id}>
                                    <TableCell className="font-bold">{i.ticker}</TableCell>
                                    <TableCell className="text-right tabular-nums">{formatUSD(i.current_value)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{i.current_in_sp.toFixed(1)}%</TableCell>
                                    <TableCell className="text-right"><Input defaultValue={i.sub_portfolio_target_percentage} className="h-7 text-right w-16 ml-auto"/></TableCell>
                                    <TableCell className="text-right tabular-nums">{i.implied_overall_target.toFixed(2)}%</TableCell>
                                    <TableCell className={cn("text-right tabular-nums font-bold", i.drift_percentage > 5 || i.drift_percentage < -5 ? "text-red-500" : "text-green-600")}>{i.drift_percentage.toFixed(1)}%</TableCell>
                                    <TableCell className="text-center font-bold">{i.action === 'hold' ? "-" : <div className="flex flex-col"><span className={i.action === 'buy' ? "text-green-600" : "text-red-600"}>{i.action.toUpperCase()}</span><span className="text-[10px] font-normal">{formatUSD(i.amount)}</span></div>}</TableCell>
                                    <TableCell className="text-right text-[10px] text-blue-800 leading-tight">
                                        {i.reinvestment_suggestions?.map((s:any, idx:number) => <div key={idx}>From {s.from_ticker}: {formatUSD(s.amount)}</div>) || "-"}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </div>
    </div>
  )
}
