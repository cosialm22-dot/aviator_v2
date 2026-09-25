import { useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { Button, Field } from '../ui/ios';
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
    <div>
      <Field value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void redeem(); } }}
        placeholder="Promo code" aria-label="Promo code" autoFocus autoCapitalize="characters" spellCheck={false}
        className="[&_input]:font-semibold [&_input]:tracking-wide"
        trailing={<Button size="sm" variant="tinted" className="-mr-2" onClick={() => void redeem()} disabled={busy || !code.trim()}>{busy ? '\u2026' : 'Apply'}</Button>} />
      {result && (
        <p role="status" className={`flex items-center gap-1.5 px-4 pt-1.5 text-footnote ${result.ok ? 'text-ios-green' : 'text-ios-red'}`}>
          {result.ok ? <Check size={14} /> : <AlertCircle size={14} />}{result.msg}
        </p>
      )}
    </div>
  );
}
