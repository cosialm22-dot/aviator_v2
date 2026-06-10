import { useState, useEffect, useCallback } from 'react';
import { DollarSign, ArrowUpRight, ArrowDownRight, Filter } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type TxType = 'all' | 'deposit' | 'withdrawal' | 'bet' | 'win';

interface Transaction {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  description: string | null;
  status: string;
  created_at: string;
  profiles?: { username: string } | null;
}

export default function FinancePage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TxType>('all');
  const [totals, setTotals] = useState({ deposits: 0, withdrawals: 0, betsVolume: 0, wins: 0 });

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('transactions')
      .select('id, user_id, type, amount, description, status, created_at, profiles!inner(username)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (typeFilter !== 'all') {
      query = query.eq('type', typeFilter);
    }

    const { data } = await query;
    setTransactions((data ?? []) as Transaction[]);
    setLoading(false);
  }, [typeFilter]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    // Fetch summary totals
    async function fetchTotals() {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('transactions')
        .select('type, amount')
        .gte('created_at', today);

      if (!data) return;
      const deps = data.filter(t => t.type === 'deposit').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      const wdrw = data.filter(t => t.type === 'withdrawal').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      const bets = data.filter(t => t.type === 'bet').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      const wins = data.filter(t => t.type === 'win').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      setTotals({ deposits: deps, withdrawals: wdrw, betsVolume: bets, wins });
    }
    fetchTotals();
  }, []);

  const FILTERS: { value: TxType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'deposit', label: 'Deposits' },
    { value: 'withdrawal', label: 'Withdrawals' },
    { value: 'bet', label: 'Bets' },
    { value: 'win', label: 'Wins' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Finance</h1>
        <p className="text-sm text-slate-500 mt-1">Transaction history and financial overview</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Deposits Today', value: totals.deposits, icon: ArrowDownRight, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'Withdrawals Today', value: totals.withdrawals, icon: ArrowUpRight, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Bets Volume', value: totals.betsVolume, icon: DollarSign, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Wins Paid', value: totals.wins, icon: DollarSign, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-[#111122] border border-[#1e1e35] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center`}>
                  <Icon size={16} className={card.color} />
                </div>
              </div>
              <div className="text-lg font-bold text-white">KSh {card.value.toLocaleString('en-KE')}</div>
              <div className="text-xs text-slate-500 mt-0.5">{card.label}</div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter size={14} className="text-slate-500" />
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              typeFilter === f.value
                ? 'bg-[#c8001c]/10 text-[#ff3344] border border-[#c8001c]/20'
                : 'bg-[#111122] border border-[#1e1e35] text-slate-400 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Transactions Table */}
      <div className="bg-[#111122] border border-[#1e1e35] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-[#1e1e35]">
                <th className="text-left px-5 py-3 font-medium">Player</th>
                <th className="text-left px-5 py-3 font-medium">Type</th>
                <th className="text-right px-5 py-3 font-medium">Amount</th>
                <th className="text-left px-5 py-3 font-medium">Description</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="border-b border-[#1e1e35]/50">
                    <td colSpan={6} className="px-5 py-3"><div className="h-4 bg-[#1a1a2e] rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : transactions.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-600">No transactions found</td></tr>
              ) : transactions.map(tx => (
                <tr key={tx.id} className="border-b border-[#1e1e35]/50 hover:bg-[#1a1a2e]/30">
                  <td className="px-5 py-3 text-white font-medium">
                    {(tx.profiles as any)?.username ?? 'Unknown'}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      tx.type === 'deposit' ? 'bg-green-500/10 text-green-400' :
                      tx.type === 'withdrawal' ? 'bg-red-500/10 text-red-400' :
                      tx.type === 'win' ? 'bg-blue-500/10 text-blue-400' :
                      tx.type === 'bet' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-slate-500/10 text-slate-400'
                    }`}>
                      {tx.type}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono">
                    <span className={Number(tx.amount) >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {Number(tx.amount) >= 0 ? '+' : ''}KSh {Math.abs(Number(tx.amount)).toLocaleString('en-KE')}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs max-w-[200px] truncate">
                    {tx.description ?? '-'}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] font-medium ${
                      tx.status === 'completed' ? 'text-green-400' :
                      tx.status === 'pending' ? 'text-amber-400' : 'text-slate-400'
                    }`}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                    {new Date(tx.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
