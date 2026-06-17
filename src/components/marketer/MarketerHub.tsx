import { useState, useEffect, useCallback } from 'react';
import { errMsg } from '../../lib/errors';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, Check, RefreshCw, MessageCircle, Send, Facebook, Megaphone, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { buildShareUrl, type SharePlatform } from '../../lib/share';
import { isValidKenyanPhone, normalizeKenyanPhone } from '../../lib/phone';
import { useModalA11y } from '../../hooks/useModalA11y';
import type { Profile } from '../../types';
import type { MarketerDashboard, CommissionPayout } from '../../types/marketing';

// ============================================================================
// MarketerHub - the marketer's OWN page, rendered inside the player shell at
// /marketer. Designed like a wallet: one number (what you can withdraw), one
// action (withdraw), one link (to grow). Everything else is quiet.
//
// Data path (all authorisation server-side, SECURITY DEFINER, _is_marketer()):
//   load    -> marketer_dashboard()                   (stats + referral code)
//   payout  -> request_commission_payout(amt, phone)  (validated vs available)
// ============================================================================

function ksh(n: number): string {
  return 'KSh ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });
}
function friendly(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: 'This page is only available to marketers.',
    INVALID_PHONE: 'Enter a valid Kenyan phone number (e.g. 0712345678).',
    AMOUNT_TOO_LOW: 'Enter a payout amount greater than zero.',
    AMOUNT_NOT_INTEGER: 'Enter a whole number (no decimals).',
    PAYOUT_PENDING: 'You already have a pending payout request.',
    INSUFFICIENT_COMMISSION: 'That exceeds your available commission.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return code || 'Action failed. Please try again.';
}

interface Props {
  profile: Profile | null;
  onSignInRequired: () => void;
}

export default function MarketerHub({ profile, onSignInRequired }: Props) {
  const [data, setData] = useState<MarketerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [formErr, setFormErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isMarketer = profile?.role === 'marketer';

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data: d, error } = await supabase.rpc('marketer_dashboard');
    if (error) { setErr(friendly(error.message)); setData(null); }
    else setData(d as MarketerDashboard);
    setLoading(false);
  }, []);

  useEffect(() => { if (isMarketer) void load(); }, [isMarketer, load]);

  const referralLink = data ? `${window.location.origin}/?ref=${data.referral_code}` : '';
  const shareMessage = '\u2708\uFE0F Join me on Aviator \u2014 Kenya\'s hottest crash game! Cash out before the plane flies away. Sign up with my link & start flying:';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked - user can select manually */ }
  }

  function share(platform: SharePlatform) {
    window.open(buildShareUrl(platform, { url: referralLink, message: shareMessage }), '_blank', 'noopener,noreferrer');
  }

  function openWithdraw() {
    setFormErr(null);
    setAmount(''); setPhone('');
    setWithdrawOpen(true);
  }

  async function submitPayout(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) { setFormErr('Enter a whole number greater than zero.'); return; }
    if (data && amt > data.commission_available) { setFormErr('That exceeds your available commission.'); return; }
    if (!isValidKenyanPhone(phone)) { setFormErr('Enter a valid Kenyan phone number (e.g. 0712345678).'); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('request_commission_payout', { p_amount: amt, p_phone: normalizeKenyanPhone(phone) });
      if (error) throw new Error(friendly(error.message));
      setWithdrawOpen(false);
      setNotice('Payout requested. An admin will review it shortly.');
      setTimeout(() => setNotice(null), 4000);
      await load();
    } catch (e2) {
      setFormErr(errMsg(e2, 'Could not submit payout request.'));
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Gating: not signed in / not a marketer ----
  if (!profile) {
    return (
      <Shell>
        <Gate
          title="Sign in to your marketer account"
          sub="Track your commission and request payouts in one place."
          action={<button onClick={onSignInRequired} className="px-6 py-3 bg-win hover:bg-win-dark text-white rounded-xl text-sm font-bold transition">Sign in</button>}
        />
      </Shell>
    );
  }
  if (!isMarketer) {
    return (
      <Shell>
        <Gate
          title="This area is for marketers"
          sub="Your account doesn't have a marketer role yet. Ask an admin to enable it."
          action={<Link to="/" className="px-6 py-3 bg-panel-raised border border-edge text-white rounded-xl text-sm font-bold transition">Back to game</Link>}
        />
      </Shell>
    );
  }

  const refresh = (
    <button onClick={() => void load()} disabled={loading} aria-label="Refresh"
      className="ml-auto p-2 -mr-1 text-slate-400 hover:text-white transition rounded-lg disabled:opacity-50">
      <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
    </button>
  );

  return (
    <Shell action={refresh}>
      <div className="max-w-md mx-auto px-4 py-5 pb-24 space-y-4">
        {notice && <Toast tone="ok">{notice}</Toast>}
        {err && data && <Toast tone="err">{err}</Toast>}

        {loading && !data ? (
          <SkeletonHub />
        ) : err && !data ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-red-300 text-sm">{err}</div>
        ) : data ? (
          <HubBody
            data={data}
            referralLink={referralLink}
            copied={copied}
            onCopy={copyLink}
            onShare={share}
            onWithdraw={openWithdraw}
          />
        ) : null}
      </div>

      {withdrawOpen && data && (
        <WithdrawModal
          available={data.commission_available}
          amount={amount} setAmount={setAmount}
          phone={phone} setPhone={setPhone}
          err={formErr}
          submitting={submitting}
          onSubmit={submitPayout}
          onClose={() => !submitting && setWithdrawOpen(false)}
        />
      )}
    </Shell>
  );
}

// ===========================================================================
// Body - balance, link, stats, history. Nothing else.
// ===========================================================================
interface BodyProps {
  data: MarketerDashboard;
  referralLink: string;
  copied: boolean;
  onCopy: () => void;
  onShare: (p: SharePlatform) => void;
  onWithdraw: () => void;
}

function HubBody({ data: d, referralLink, copied, onCopy, onShare, onWithdraw }: BodyProps) {
  const ratePct = (d.commission_rate * 100).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const conv = d.referred_count > 0 ? Math.round((d.qualified_count / d.referred_count) * 100) : 0;
  const canWithdraw = d.commission_available > 0 && d.commission_pending <= 0;
  const disabledReason = d.commission_pending > 0 ? 'Payout pending review' : 'Nothing to withdraw yet';

  return (
    <>
      {/* The money + the one action. */}
      <div className="rounded-2xl bg-gradient-to-br from-win/10 to-panel border border-win/30 p-6 text-center">
        <div className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Available to withdraw</div>
        <div className="mt-2 text-4xl font-extrabold tabular-nums text-win">{ksh(d.commission_available)}</div>

        {canWithdraw ? (
          <button onClick={onWithdraw}
            className="mt-5 w-full py-3.5 rounded-xl bg-win hover:bg-win-dark text-white font-bold transition active:scale-[0.99]">
            Withdraw
          </button>
        ) : (
          <>
            <button disabled
              className="mt-5 w-full py-3.5 rounded-xl bg-panel-raised border border-edge text-slate-500 font-bold cursor-not-allowed">
              Withdraw
            </button>
            <p className="text-slate-500 text-xs mt-2">{disabledReason}</p>
          </>
        )}

        <div className="mt-5 pt-4 border-t border-edge/60 flex justify-center gap-5 text-xs text-slate-500">
          <span>Earned <span className="text-slate-300 font-semibold tabular-nums">{ksh(d.commission_earned)}</span></span>
          <span>Paid <span className="text-slate-300 font-semibold tabular-nums">{ksh(d.commission_paid)}</span></span>
          <span>Pending <span className="text-slate-300 font-semibold tabular-nums">{ksh(d.commission_pending + d.commission_approved)}</span></span>
        </div>
      </div>

      {/* The link. Copy or share in one tap. */}
      <div className="rounded-2xl bg-panel border border-edge p-5">
        <div className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Your link</div>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 min-w-0 px-3 py-2.5 bg-night-deep border border-edge rounded-lg text-slate-200 text-[13px] font-mono truncate">{referralLink}</code>
          <button onClick={onCopy} aria-label="Copy referral link"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-win hover:bg-win-dark text-white text-[13px] font-bold transition">
            {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <ShareBtn onClick={() => onShare('whatsapp')} icon={MessageCircle} label="WhatsApp" color="#25D366" />
          <ShareBtn onClick={() => onShare('telegram')} icon={Send} label="Telegram" color="#229ED9" />
          <ShareBtn onClick={() => onShare('x')} icon={XLogo} label="X" color="#e2e8f0" />
          <ShareBtn onClick={() => onShare('facebook')} icon={Facebook} label="Facebook" color="#1877F2" />
        </div>
      </div>

      {/* Three facts. No charts. */}
      <div className="rounded-2xl bg-panel border border-edge grid grid-cols-3 divide-x divide-edge">
        <Stat label="Referred" value={d.referred_count.toLocaleString('en-KE')} />
        <Stat label="Qualified" value={d.qualified_count.toLocaleString('en-KE')} sub={`${conv}%`} />
        <Stat label="Your rate" value={`${ratePct}%`} />
      </div>

      {/* Payouts. */}
      {d.payouts.length > 0 && (
        <div className="rounded-2xl bg-panel border border-edge overflow-hidden">
          <div className="px-5 py-3.5 border-b border-edge text-[11px] uppercase tracking-wide font-bold text-slate-400">Payouts</div>
          <div className="divide-y divide-panel-high">
            {d.payouts.map((p: CommissionPayout) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                <div className="min-w-0">
                  <div className="text-white font-semibold text-sm tabular-nums">{ksh(p.amount)}</div>
                  <div className="text-slate-500 text-xs mt-0.5">{p.phone_number} &middot; {new Date(p.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</div>
                  {p.status === 'rejected' && p.rejection_reason && (
                    <div className="text-slate-500 text-xs mt-0.5 max-w-[200px] truncate" title={p.rejection_reason}>{p.rejection_reason}</div>
                  )}
                </div>
                <PayoutBadge status={p.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ===========================================================================
// Withdraw - a focused modal, so the resting page stays a number and a button.
// ===========================================================================
interface WithdrawProps {
  available: number;
  amount: string; setAmount: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  err: string | null;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

function WithdrawModal({ available, amount, setAmount, phone, setPhone, err, submitting, onSubmit, onClose }: WithdrawProps) {
  const ref = useModalA11y(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Withdraw commission" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-panel border border-edge rounded-t-2xl sm:rounded-2xl p-5 pb-7 sm:pb-5">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Withdraw</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -mr-1 text-slate-400 hover:text-white transition rounded-lg">
            <X size={20} />
          </button>
        </div>
        <p className="text-slate-400 text-sm mt-1">Available <span className="text-win font-semibold tabular-nums">{ksh(available)}</span></p>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div>
            <label className="text-[11px] font-medium text-slate-400 block mb-1.5">Amount (KSh)</label>
            <input type="number" inputMode="numeric" min={1} step={1} value={amount}
              onChange={e => setAmount(e.target.value)} required placeholder={`Up to ${Math.floor(available)}`}
              className="w-full px-3 py-3 bg-night-deep border border-edge rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-win transition" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-400 block mb-1.5">M-Pesa phone</label>
            <input type="tel" inputMode="numeric" value={phone}
              onChange={e => setPhone(e.target.value)} required placeholder="0712345678"
              className="w-full px-3 py-3 bg-night-deep border border-edge rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-win transition" />
          </div>
          {err && <p role="alert" className="text-red-300 text-xs">{err}</p>}
          <button type="submit" disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-lg bg-win hover:bg-win-dark text-white text-sm font-bold transition disabled:opacity-50">
            {submitting && <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-r-transparent animate-spin" />}
            Request payout
          </button>
        </form>
        <p className="text-slate-600 text-xs mt-3">Reviewed by an admin before settlement via M-Pesa.</p>
      </div>
    </div>
  );
}

// ===========================================================================
// Primitives
// ===========================================================================
function Shell({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-night scrollbar-thin">
      <header className="sticky top-0 z-20 bg-night/95 backdrop-blur border-b border-edge h-12 flex items-center px-3 gap-2">
        <Link to="/" className="p-2 -ml-1 text-slate-400 hover:text-white transition rounded-lg active:scale-90" aria-label="Back to game">
          <ArrowLeft size={20} />
        </Link>
        <span className="text-white font-semibold text-sm">Marketer Hub</span>
        {action}
      </header>
      {children}
    </div>
  );
}

function Gate({ title, sub, action }: { title: string; sub: string; action: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-panel-raised border border-edge flex items-center justify-center mx-auto mb-4">
        <Megaphone size={26} className="text-slate-500" />
      </div>
      <h2 className="text-white font-bold text-lg">{title}</h2>
      <p className="text-slate-400 text-sm mt-2">{sub}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-3 py-4 text-center">
      <div className="text-[11px] uppercase tracking-wide font-bold text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-extrabold text-white tabular-nums">{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}

function ShareBtn({ onClick, icon: Icon, label, color }: { onClick: () => void; icon: React.ElementType; label: string; color: string }) {
  return (
    <button onClick={onClick} aria-label={`Share on ${label}`}
      className="flex items-center justify-center py-2.5 rounded-lg bg-panel-raised border border-edge hover:border-edge-strong text-slate-200 transition active:scale-95">
      <Icon size={17} style={{ color }} />
    </button>
  );
}

// Minimal X (Twitter) glyph - lucide has no brand mark.
function XLogo({ size = 17, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
    </svg>
  );
}

function PayoutBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    approved: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
    paid: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    rejected: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  };
  return <span className={'inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold capitalize flex-shrink-0 ' + (map[status] ?? map.rejected)}>{status}</span>;
}

function Toast({ tone, children }: { tone: 'ok' | 'err'; children: React.ReactNode }) {
  const cls = tone === 'ok'
    ? 'bg-win/10 border-win/30 text-win'
    : 'bg-red-500/10 border-red-500/30 text-red-300';
  return <div role={tone === 'ok' ? 'status' : 'alert'} className={'rounded-lg border px-3 py-2 text-xs ' + cls}>{children}</div>;
}

function SkeletonHub() {
  return (
    <div className="space-y-4">
      <div className="h-44 rounded-2xl bg-panel border border-edge animate-pulse" />
      <div className="h-32 rounded-2xl bg-panel border border-edge animate-pulse" />
      <div className="h-20 rounded-2xl bg-panel border border-edge animate-pulse" />
    </div>
  );
}
