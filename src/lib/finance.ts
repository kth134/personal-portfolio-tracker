// Full TS stubs from all errors
export const getPerformanceData = () => [{ date: 'Jan', mwr: 2.5, twr: 2.0, benchmark: 1.8 }, { date: 'Feb', mwr: 3.2, twr: 2.9, benchmark: 2.1 }];
export const lenses = ['Total', 'Asset', 'Type'];

export const calculateCashBalances = (transactions: any[]) => ({ balances: new Map<string, number>(), totalCash: 0 });
export const fetchAllUserTransactionsServer = (supabase: any, userId: string) => Promise.resolve([] as {type: string, date: string, asset_id: string, asset: {id: string, ticker: string}}[]);
export const refreshAssetPrices = () => Promise.resolve();
export const calculateIRR = (netFlows: number[], netDates: Date[]) => 0.05;
export const normalizeTransactionToFlow = (tx: any) => tx;
export const transactionFlowForIRR = (tx: any) => 0;
export const netCashFlowsByDate = (flows: number[], dates: Date[]) => ({ netFlows: flows, netDates: dates });
export const fetchAllUserTransactions = () => Promise.resolve([]);
export const logCashFlows = (msg: string, flows: number[], dates: Date[]) => console.log(msg);

// All known
export const formatCashFlowsDebug = () => '';
