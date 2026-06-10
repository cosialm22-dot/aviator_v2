import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export default function FinancePage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('transactions')
        .select('*, profiles!transactions_user_id_fkey(username)')
        .order('created_at', { ascending: false })
        .limit(50);
      setTransactions(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-white text-xl font-bold">Finance</h1>

      <div className="bg-[#1a1a2e] border border-[#2a2a45] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2a2a45]">
          <h2 className="text-white text-sm font-semibold">Recent Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2a2a45] text-left">
                <th className="px-4 py-2 text-slate-500 text-[10px] uppercase">Player</th>
                <th className="px-4 py-2 text-slate-500 text-[10px] uppercase">Type</th>
                <th className="px-4 py-2 text-slate-500 text-[10px] uppercase text-right">Amount</th>
                <th className="px-4 py-2 text-slate-500 text-[10px] uppercase">Status</th>
                <th className="px-4 py-2 text-slate-500 text-[10px] uppercase">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a45]/50">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Loading...</td></tr>
              ) : transactions.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">No transactions</td></tr>
              ) : transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="px-4 py-2 text-white text-xs">{(tx.profiles as any)?.username ?? 'Unknown'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      tx.type === 'deposit' ? 'bg-green-500/10 text-green-400' :
                      tx.type === 'withdrawal' ? 'bg-red-500/10 text-red-400' :
                      tx.type === 'win' ? 'bg-blue-500/10 text-blue-400' :
                      'bg-slate-500/10 text-slate-400'
                    }`}>{tx.type}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className={`text-xs font-medium tabular-nums ${Number(tx.amount) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {Number(tx.amount) >= 0 ? '+' : ''}KSh {Math.abs(Number(tx.amount)).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-[10px]">{tx.status}</td>
                  <td className="px-4 py-2 text-slate-500 text-[10px]">{new Date(tx.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
