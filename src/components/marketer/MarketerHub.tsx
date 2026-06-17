import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Copy, Check, RefreshCw, Users, BadgeCheck, TrendingUp, Wallet as WalletIcon,
  Target, Trophy, Share2, MessageCircle, Send, Facebook, Megaphone,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { buildShareUrl, type SharePlatform } from '../../lib/share';
import { isValidKenyanPhone, normalizeKenyanPhone } from '../../lib/phone';
import type { Profile } from '../../types';
import type { MarketerDashboard, CommissionPayout } from '../../types/marketing';

// ============================================================================
// MarketerHub - the marketer's OWN affiliate command centre, rendered INSIDE the
// player shell at /marketer (marketers are signed-in players; they must NOT be
// funnelled through the operator admin panel - see Phase 4 of the feature plan).
//
// Data path (all authorisation server-side, SECURITY DEFINER, _is_marketer()):
//   load    -> marketer_dashboard()                  (stats + referral code)
//   payout  -> request_commission_payout(amt, phone)  (validated vs available)
// Charts are derived purely from the dashboard payload - zero new backend.
// ============================================================================

function ksh(n: number, dp = 0): string {
  return 'KSh ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error ? e.message : fallback;
}
function friendly(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: 'This page is only available to marketers.',
    INVALID_PHONE: 'Enter a valid Kenyan phone number (e.g. 0712345678).',
    AMOUNT_TOO_LOW: 'Enter a payout amount greater than zero.',
    AMOUNT_NOT_INTEGER: 'Enter a whole number (no decimals).',
    PAYOUT_PENDING: 'You already have a pending payout request. Wait for it to be reviewed.',
    INSUFFICIENT_COMMISSION: 'That exceeds your available commission.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return code || 'Action failed. Please try again.';
}

// Design-token hexes for the JS/SVG color props that can't take Tailwind classes
// (kept in one place so the hub stays single-source with tailwind.config.js).
const C = { info: '#60a5fa', win: '#22c55e', gold: '#e0a80b', frost: '#e2e8f0' } as const;

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

  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
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
  const shareMessage = '✈️ Join me on Aviator — Kenya\'s hottest crash game! Cash out before the plane flies away. Sign up with my link & start flying:';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked - user can select manually */ }
  }

  function share(platform: SharePlatform) {
    const url = buildShareUrl(platform, { url: referralLink, message: shareMessage });
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function submitPayout(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setNotice(null);
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) { setErr('Enter a whole number greater than zero.'); return; }
    if (data && amt > data.commission_available) { setErr('That exceeds your available commission.'); return; }
    if (!isValidKenyanPhone(phone)) { setErr('Enter a valid Kenyan phone number (e.g. 0712345678).'); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('request_commission_payout', { p_amount: amt, p_phone: normalizeKenyanPhone(phone) });
      if (error) throw new Error(friendly(error.message));
      setNotice('Payout request submitted. An admin will review it shortly.');
      setAmount(''); setPhone('');
      await load();
    } catch (e2) {
      setErr(errMsg(e2, 'Could not submit payout request.'));
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Gating: not signed in / not a marketer ----
  if (!profile) {
    return (
      <Shell title="Marketer Hub">
        <Gate
          icon={Megaphone}
          title="Sign in to your marketer account"
          sub="Track your referrals, commission and payouts in one place."
          action={<button onClick={onSignInRequired} className="px-6 py-3 bg-win hover:bg-win-dark text-white rounded-xl text-sm font-bold transition shadow-lg shadow-green-500/20">Sign In</button>}
        />
      </Shell>
    );
  }
  if (!isMarketer) {
    return (
      <Shell title="Marketer Hub">
        <Gate
          icon={Megaphone}
          title="This area is for marketers"
          sub="Your account doesn't have a marketer role yet. Ask an admin to enable affiliate marketing for you."
          action={<Link to="/" className="px-6 py-3 bg-panel-raised border border-edge text-white rounded-xl text-sm font-bold transition">Back to Game</Link>}
        />
      </Shell>
    );
  }

  return (
    <Shell title="Marketer Hub">
      <div className="max-w-3xl mx-auto px-4 py-4 pb-24 space-y-5">
        {/* status line */}
        <div className="flex items-center justify-end gap-2 -mb-1 min-h-[28px]">
          {notice && <span role="status" className="px-3 py-1.5 bg-win/10 border border-win/30 rounded-lg text-win text-xs max-w-[260px] truncate" title={notice}>{notice}</span>}
          {err && <span role="alert" className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-xs max-w-[260px] truncate" title={err}>{err}</span>}
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-edge bg-panel text-xs text-slate-300 hover:text-white transition disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {loading && !data ? (
          <SkeletonHub />
        ) : err && !data ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300 text-sm">{err}</div>
        ) : data ? (
          <HubBody
            data={data}
            referralLink={referralLink}
            copied={copied}
            onCopy={copyLink}
            onShare={share}
            amount={amount} setAmount={setAmount}
            phone={phone} setPhone={setPhone}
            submitting={submitting}
            onSubmitPayout={submitPayout}
            username={profile.username}
          />
        ) : null}
      </div>
    </Shell>
  );
}

// ===========================================================================
// Body
// ===========================================================================
interface BodyProps {
  data: MarketerDashboard;
  referralLink: string;
  copied: boolean;
  onCopy: () => void;
  onShare: (p: SharePlatform) => void;
  amount: string; setAmount: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  submitting: boolean;
  onSubmitPayout: (e: React.FormEvent) => void;
  username: string;
}

function HubBody({ data: d, referralLink, copied, onCopy, onShare, amount, setAmount, phone, setPhone, submitting, onSubmitPayout, username }: BodyProps) {
  const ratePct = (d.commission_rate * 100).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const conversion = d.referred_count > 0 ? (d.qualified_count / d.referred_count) * 100 : 0;
  const hasPending = d.commission_pending > 0;

  // Next round-number milestone (next multiple of 5 qualified players) + progress.
  const { milestoneTarget, milestoneProgress } = useMemo(() => {
    const target = Math.max(5, Math.ceil((d.qualified_count + 1) / 5) * 5);
    const progress = target > 0 ? Math.min(100, (d.qualified_count / target) * 100) : 0;
    return { milestoneTarget: target, milestoneProgress: progress };
  }, [d.qualified_count]);

  return (
    <>
      {/* Greeting */}
      <div>
        <h1 className="text-white font-bold text-lg">Hi {username}</h1>
        <p className="text-slate-400 text-sm">Your referrals, commission and payouts at a glance.</p>
      </div>

      {/* 1. Cash out -- the money and the one action that matters, together. */}
      <div className="rounded-2xl bg-gradient-to-br from-win/10 to-panel border border-win/30 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-win">
              <WalletIcon size={16} />
              <span className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Available to withdraw</span>
            </div>
            <div className="mt-1 text-3xl font-extrabold tabular-nums text-win">{ksh(d.commission_available)}</div>
          </div>
          <div className="text-right text-xs text-slate-500 leading-relaxed">
            <div>Paid: <span className="text-slate-300 font-semibold">{ksh(d.commission_paid)}</span></div>
            <div>Pending: <span className="text-slate-300 font-semibold">{ksh(d.commission_pending + d.commission_approved)}</span></div>
          </div>
        </div>

        {hasPending ? (
          <p className="mt-4 text-slate-400 text-sm">You have a pending payout request. You can submit a new one once it&rsquo;s been reviewed.</p>
        ) : d.commission_available <= 0 ? (
          <p className="mt-4 text-slate-400 text-sm">Nothing to withdraw yet &mdash; commission accrues as your qualified players play.</p>
        ) : (
          <form onSubmit={onSubmitPayout} className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 sm:items-end">
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1.5">Amount (KSh)</label>
              <input
                type="number" inputMode="numeric" min={1} step={1} value={amount}
                onChange={e => setAmount(e.target.value)} required
                placeholder={`Up to ${Math.floor(d.commission_available)}`}
                className="w-full px-3 py-3 bg-night-deep border border-edge rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-win transition"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1.5">M-Pesa phone</label>
              <input
                type="tel" inputMode="numeric" value={phone}
                onChange={e => setPhone(e.target.value)} required
                placeholder="0712345678"
                className="w-full px-3 py-3 bg-night-deep border border-edge rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-win transition"
              />
            </div>
            <button type="submit" disabled={submitting} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-win hover:bg-win-dark text-white text-sm font-bold transition disabled:opacity-50">
              {submitting && <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-r-transparent animate-spin" />}
              Withdraw
            </button>
          </form>
        )}
        <p className="text-slate-600 text-xs mt-3">Every payout is reviewed by an admin before settlement via M-Pesa.</p>
      </div>

      {/* 2. Stats -- the four numbers that tell the whole story, shown once each. */}
      <div className="grid grid-cols-2 gap-3">
        <Kpi icon={Users} label="Referred Players" value={d.referred_count.toLocaleString('en-KE')} accent={C.info} />
        <Kpi icon={BadgeCheck} label="Qualified" value={d.qualified_count.toLocaleString('en-KE')} sub={`${conversion.toFixed(0)}% conversion`} accent={C.win} />
        <Kpi icon={TrendingUp} label="Revenue Generated" value={ksh(d.lifetime_ggr)} accent={C.gold} />
        <Kpi icon={Trophy} label="Commission Earned" value={ksh(d.commission_earned)} sub={`${ratePct}% revenue share`} accent={C.win} />
      </div>

      {/* 3. Growth -- referral funnel + next milestone in a single card. */}
      <Card title="Your Growth">
        <FunnelChart referred={d.referred_count} qualified={d.qualified_count} />
        <div className="mt-5 pt-4 border-t border-edge">
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1.5 text-slate-400"><Target size={14} style={{ color: C.gold }} /> Next milestone</span>
            <span className="text-white font-semibold tabular-nums">{d.qualified_count} / {milestoneTarget} qualified</span>
          </div>
          <div className="mt-2 h-2.5 rounded-full bg-panel-raised overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-gold to-win transition-all" style={{ width: `${milestoneProgress}%` }} />
          </div>
        </div>
      </Card>

      {/* 4. Referral link + social share -- how marketers grow. */}
      <div className="rounded-2xl bg-panel border border-edge p-5">
        <div className="flex items-center gap-2 text-info">
          <Share2 size={16} />
          <span className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Your Referral Link</span>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <code className="flex-1 min-w-[200px] px-3 py-2.5 bg-night-deep border border-edge rounded-lg text-slate-200 text-[13px] font-mono break-all">{referralLink}</code>
          <button onClick={onCopy} className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-win hover:bg-win-dark text-white text-[13px] font-bold transition">
            {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
          </button>
        </div>
        <p className="text-slate-500 text-xs mt-2">
          New players who sign up through your link are attributed to you and qualify on their first M-Pesa deposit.
        </p>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ShareBtn onClick={() => onShare('whatsapp')} icon={MessageCircle} label="WhatsApp" color="#25D366" />
          <ShareBtn onClick={() => onShare('telegram')} icon={Send} label="Telegram" color="#229ED9" />
          <ShareBtn onClick={() => onShare('x')} icon={XLogo} label="X" color={C.frost} />
          <ShareBtn onClick={() => onShare('facebook')} icon={Facebook} label="Facebook" color="#1877F2" />
        </div>
      </div>

      {/* 5. Payout history */}
      <div className="rounded-2xl bg-panel border border-edge overflow-hidden">
        <div className="px-5 py-3.5 border-b border-edge">
          <span className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Payout History</span>
        </div>
        {d.payouts.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-600 text-sm">No payout requests yet.</div>
        ) : (
          <div className="divide-y divide-panel-high">
            {d.payouts.map((p: CommissionPayout) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                <div className="min-w-0">
                  <div className="text-white font-semibold text-sm tabular-nums">{ksh(p.amount)}</div>
                  <div className="text-slate-500 text-xs mt-0.5">{p.phone_number} &middot; {new Date(p.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  {p.status === 'rejected' && p.rejection_reason && (
                    <div className="text-slate-500 text-xs mt-0.5 max-w-[220px] truncate" title={p.rejection_reason}>{p.rejection_reason}</div>
                  )}
                </div>
                <PayoutBadge status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ===========================================================================
// Charts (pure inline SVG, dark theme)
// ===========================================================================
function FunnelChart({ referred, qualified }: { referred: number; qualified: number }) {
  const max = Math.max(referred, 1);
  const qPct = (qualified / max) * 100;
  return (
    <div className="space-y-3">
      <FunnelBar label="Referred" value={referred} widthPct={100} color={C.info} />
      <FunnelBar label="Qualified" value={qualified} widthPct={Math.max(qPct, qualified > 0 ? 8 : 0)} color={C.win} />
      <div className="text-xs text-slate-500 pt-1">
        {referred > 0 ? `${((qualified / referred) * 100).toFixed(0)}% of referrals qualified` : 'No referrals yet \u2014 share your link to begin.'}
      </div>
    </div>
  );
}
function FunnelBar({ label, value, widthPct, color }: { label: string; value: number; widthPct: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="text-white font-semibold tabular-nums">{value.toLocaleString('en-KE')}</span>
      </div>
      <div className="h-3 rounded-full bg-panel-raised overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${widthPct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ===========================================================================
// Small UI primitives
// ===========================================================================
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-night scrollbar-thin">
      <header className="sticky top-0 z-20 bg-night/95 backdrop-blur border-b border-edge h-12 flex items-center px-3 gap-2">
        <Link to="/" className="p-2 -ml-1 text-slate-400 hover:text-white transition rounded-lg active:scale-90" aria-label="Back to game">
          <ArrowLeft size={20} />
        </Link>
        <span className="text-white font-semibold text-sm">{title}</span>
      </header>
      {children}
    </div>
  );
}

function Gate({ icon: Icon, title, sub, action }: { icon: typeof Megaphone; title: string; sub: string; action: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-panel-raised border border-edge flex items-center justify-center mx-auto mb-4">
        <Icon size={26} className="text-slate-500" />
      </div>
      <h2 className="text-white font-bold text-lg">{title}</h2>
      <p className="text-slate-400 text-sm mt-2">{sub}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, accent }: { icon: typeof Users; label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="rounded-2xl bg-panel border border-edge p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-bold text-slate-400">
        <Icon size={13} style={{ color: accent }} /> {label}
      </div>
      <div className="mt-1.5 text-xl font-extrabold tabular-nums" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-panel border border-edge p-5">
      <div className="text-[11px] uppercase tracking-wide font-bold text-slate-400 mb-3">{title}</div>
      {children}
    </div>
  );
}

function ShareBtn({ onClick, icon: Icon, label, color }: { onClick: () => void; icon: React.ElementType; label: string; color: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-panel-raised border border-edge hover:border-edge-strong text-slate-200 text-xs font-semibold transition active:scale-95"
    >
      <Icon size={15} style={{ color }} /> {label}
    </button>
  );
}

// Minimal X (Twitter) glyph - lucide has no brand mark.
function XLogo({ size = 15, style }: { size?: number; style?: React.CSSProperties }) {
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

function SkeletonHub() {
  return (
    <div className="space-y-4">
      <div className="h-28 rounded-2xl bg-panel border border-edge animate-pulse" />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-panel border border-edge animate-pulse" />)}
      </div>
      <div className="h-24 rounded-2xl bg-panel border border-edge animate-pulse" />
    </div>
  );
}
