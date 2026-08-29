import { useState } from 'react';
import { Ticket, Check, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// Self-contained promo-code redemption. Calls the SECURITY DEFINER
// redeem_promo_code RPC (site-scoped, race-safe) and shows the result inline.
const ERR: Record<string, string> = {
  NOT_AUTHENTICATED: 'Please sign in first.',
  ONLY_PLAYERS: 'Only player accounts can redeem codes.',
  INVALID_CODE: 'That code isn\u2019t valid for this site.',
  CODE_INACTIVE: 'This code is no longer active.',
  CODE_EXPIRED: 'This code has expired.',
  CODE_EXHAUSTED: 'This code has been fully claimed.',
  ALREADY_REDEEMED: 'You\u2019ve already used this code.',
};
const friendly = (m?: string) => { if (!m) return 'Could not redeem code.'; for (const k in ERR) if (m.includes(k)) return ERR[k]; return 'Could not redeem code.'; };

export default function RedeemPromoCode({ onRedeemed }: { onRedeemed?: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function redeem() {
    const c = code.trim();
    if (!c) return;
    setBusy(true); setResult(null);
    const { data, error } = await supabase.rpc('redeem_promo_code', { p_code: c });
    setBusy(false);
    if (error) { setResult({ ok: false, msg: friendly(error.message) }); return; }
    setResult({ ok: true, msg: (data?.message as string) ?? 'Code redeemed!' });
    setCode('');
    onRedeemed?.();
  }

  return (
    <div className="rounded-xl border border-edge-strong bg-[#1c2237] px-4 py-3">
      <label className="flex items-center gap-1.5 text-white text-xs font-semibold mb-2">
        <Ticket size={13} className="text-info" /> Have a promo code?
      </label>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void redeem(); } }}
          placeholder="ENTER CODE"
          className="flex-1 bg-[#0f1424] border border-edge-strong rounded-lg px-3 py-2 text-white text-sm font-semibold tracking-wide uppercase placeholder:text-edge-strong focus:outline-none focus:border-info/60 transition"
        />
        <button
          onClick={() => void redeem()}
          disabled={busy || !code.trim()}
          className="px-4 py-2 rounded-lg bg-info/15 text-info border border-info/30 text-sm font-semibold hover:bg-info/25 transition disabled:opacity-50"
        >
          {busy ? '\u2026' : 'Redeem'}
        </button>
      </div>
      {result && (
        <div className={`mt-2 flex items-center gap-1.5 text-[12px] ${result.ok ? 'text-win' : 'text-danger'}`}>
          {result.ok ? <Check size={13} /> : <AlertCircle size={13} />} {result.msg}
        </div>
      )}
    </div>
  );
}
