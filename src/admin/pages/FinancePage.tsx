import { useState, useEffect, useCallback } from 'react';
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
    // supabase-js types the to-one `profiles` embed as an array, but at runtime
    // it is a single object; cast through unknown to our row shape.
    setTransactions((data ?? []) as unknown as Transaction[]);
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
    <div className="-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]">
      <div className="space-y-6">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Finance</h1>
          <p className="text-[13px] text-muted mt-1">Transaction history and financial overview</p>
        </div>

        {/* Summary strip */}
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-line">
            {[
              { label: 'Deposits Today', value: totals.deposits, tone: 'text-up' },
              { label: 'Withdrawals Today', value: totals.withdrawals, tone: 'text-down' },
              { label: 'Bets Volume', value: totals.betsVolume, tone: 'text-ink' },
              { label: 'Wins Paid', value: totals.wins, tone: 'text-ink' },
            ].map(card => (
              <div key={card.label} className="p-5 sm:p-6">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{card.label}</div>
                <div className={'mt-2.5 text-[22px] leading-none font-semibold tabular-nums tracking-tight ' + card.tone}>KSh {card.value.toLocaleString('en-KE')}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ' + (typeFilter === f.value ? 'bg-brand/10 text-brand border-brand/30' : 'bg-surface border-line text-muted hover:text-ink')}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Transactions */}
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
                  <th className="text-left px-5 py-3 font-medium">Player</th>
                  <th className="text-left px-5 py-3 font-medium">Type</th>
                  <th className="text-right px-5 py-3 font-medium">Amount</th>
                  <th className="text-left px-5 py-3 font-medium">Description</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-left px-5 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>
                    </tr>
                  ))
                ) : transactions.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-12 text-center text-faint">No transactions found</td></tr>
                ) : transactions.map(tx => (
                  <tr key={tx.id} className="hover:bg-canvas transition-colors">
                    <td className="px-5 py-3 text-ink font-medium">{tx.profiles?.username ?? 'Unknown'}</td>
                    <td className="px-5 py-3">
                      <span className={'inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase ' + (
                        tx.type === 'deposit' ? 'bg-emerald-50 text-up' :
                        tx.type === 'withdrawal' ? 'bg-rose-50 text-down' :
                        tx.type === 'win' ? 'bg-brand/10 text-brand' :
                        tx.type === 'bet' ? 'bg-amber-50 text-amber-600' :
                        'bg-slate-100 text-muted'
                      )}>{tx.type}</span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span className={Number(tx.amount) >= 0 ? 'text-up' : 'text-down'}>
                        {Number(tx.amount) >= 0 ? '+' : ''}KSh {Math.abs(Number(tx.amount)).toLocaleString('en-KE')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted text-xs max-w-[200px] truncate">{tx.description ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={'inline-flex items-center gap-1.5 text-[11px] font-medium ' + (
                        tx.status === 'completed' ? 'text-up' : tx.status === 'pending' ? 'text-amber-600' : 'text-muted'
                      )}>
                        <span className={'h-1.5 w-1.5 rounded-full ' + (tx.status === 'completed' ? 'bg-up' : tx.status === 'pending' ? 'bg-amber-500' : 'bg-faint')} />
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted text-xs whitespace-nowrap">{new Date(tx.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
