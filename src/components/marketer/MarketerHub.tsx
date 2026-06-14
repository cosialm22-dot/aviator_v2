import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Copy, Check, RefreshCw, Users, BadgeCheck, TrendingUp, Wallet as WalletIcon,
  Target, Rocket, Trophy, Share2, MessageCircle, Send, Facebook, Megaphone,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { buildShareUrl, type SharePlatform } from '../../lib/share';
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
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('request_commission_payout', { p_amount: amt, p_phone: phone });
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
          action={<button onClick={onSignInRequired} className="px-6 py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl text-sm font-bold transition shadow-lg shadow-green-500/20">Sign In</button>}
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
          action={<Link to="/" className="px-6 py-3 bg-[#1a1a2e] border border-[#2a2a45] text-white rounded-xl text-sm font-bold transition">Back to Game</Link>}
        />
      </Shell>
    );
  }

  return (
    <Shell title="Marketer Hub">
      <div className="max-w-3xl mx-auto px-4 py-4 pb-24 space-y-5">
        {/* status line */}
        <div className="flex items-center justify-end gap-2 -mb-1 min-h-[28px]">
          {notice && <span role="status" className="px-3 py-1.5 bg-[#0f2a1a] border border-[#1f3d2a] rounded-lg text-[#22c55e] text-xs max-w-[260px] truncate" title={notice}>{notice}</span>}
          {err && <span role="alert" className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-xs max-w-[260px] truncate" title={err}>{err}</span>}
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2a45] bg-[#11111f] text-xs text-slate-300 hover:text-white transition disabled:opacity-50">
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

  // --- psychology: milestone + projection (grounded in the marketer's own data) ---
  const { milestoneTarget, milestoneProgress, projectionText } = useMemo(() => {
    const target = Math.max(5, Math.ceil((d.qualified_count + 1) / 5) * 5); // next multiple of 5, min 5
    const progress = target > 0 ? Math.min(100, (d.qualified_count / target) * 100) : 0;
    const perQualified = d.qualified_count > 0 ? d.commission_earned / d.qualified_count : 0;
    const remaining = Math.max(0, target - d.qualified_count);
    const projection = perQualified > 0
      ? `Reaching ${target} qualified players could add about ${ksh(perQualified * remaining)} to your earnings, based on your current average of ${ksh(perQualified)} per qualified player.`
      : `Each qualified player you refer earns you ${ratePct}% of the revenue they generate — forever. Get your first qualified referral to unlock your earnings rate.`;
    return { milestoneTarget: target, milestoneProgress: progress, projectionText: projection };
  }, [d.qualified_count, d.commission_earned, d.commission_rate, ratePct]);

  return (
    <>
      {/* Hero / income framing */}
      <div className="rounded-2xl bg-gradient-to-br from-[#11203a] via-[#11111f] to-[#11111f] border border-[#23314d] p-5">
        <div className="flex items-center gap-2 text-[#60a5fa]">
          <Rocket size={16} />
          <span className="text-[11px] uppercase tracking-wide font-bold">Your Marketing Business</span>
        </div>
        <h1 className="mt-1.5 text-white font-extrabold text-xl leading-tight">
          {username}, you've earned {ksh(d.commission_earned)} so far.
        </h1>
        <p className="text-slate-400 text-sm mt-1.5">
          This is real income. Every player you bring in keeps earning you {ratePct}% of the revenue they
          generate — month after month. Treat it like the business it is: share daily, grow your network, watch it compound.
        </p>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <Kpi icon={Users} label="Referred Players" value={d.referred_count.toLocaleString('en-KE')} accent="#60a5fa" />
        <Kpi icon={BadgeCheck} label="Qualified" value={d.qualified_count.toLocaleString('en-KE')} sub={`${conversion.toFixed(0)}% conversion`} accent="#22c55e" />
        <Kpi icon={TrendingUp} label="Revenue Generated" value={ksh(d.lifetime_ggr)} accent="#e0a80b" />
        <Kpi icon={Trophy} label="Commission Earned" value={ksh(d.commission_earned)} accent="#22c55e" />
      </div>

      {/* Available to withdraw - prominent */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0f2a1a] to-[#11111f] border border-[#1f3d2a] p-5 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[#22c55e]">
            <WalletIcon size={16} />
            <span className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Available to Withdraw</span>
          </div>
          <div className="mt-1 text-3xl font-extrabold tabular-nums" style={{ color: '#22c55e' }}>{ksh(d.commission_available)}</div>
        </div>
        <div className="text-right text-xs text-slate-500 leading-relaxed">
          <div>Paid: <span className="text-slate-300 font-semibold">{ksh(d.commission_paid)}</span></div>
          <div>Pending: <span className="text-slate-300 font-semibold">{ksh(d.commission_pending + d.commission_approved)}</span></div>
        </div>
      </div>

      {/* Charts: funnel + commission donut */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card title="Referral Funnel">
          <FunnelChart referred={d.referred_count} qualified={d.qualified_count} />
        </Card>
        <Card title="Commission Breakdown">
          <CommissionDonut
            paid={d.commission_paid}
            approved={d.commission_approved}
            pending={d.commission_pending}
            available={d.commission_available}
          />
        </Card>
      </div>

      {/* Cumulative payouts trend */}
      <Card title="Payouts Over Time">
        <PayoutTrend payouts={d.payouts} />
      </Card>

      {/* Goal + projection (psychology) */}
      <div className="rounded-2xl bg-[#11111f] border border-[#2a2a45] p-5">
        <div className="flex items-center gap-2 text-[#e0a80b]">
          <Target size={16} />
          <span className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Next Milestone</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-white font-semibold">{d.qualified_count} / {milestoneTarget} qualified players</span>
          <span className="text-slate-500">{Math.max(0, milestoneTarget - d.qualified_count)} to go</span>
        </div>
        <div className="mt-2 h-2.5 rounded-full bg-[#1a1a2e] overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-[#e0a80b] to-[#22c55e] transition-all" style={{ width: `${milestoneProgress}%` }} />
        </div>
        <p className="text-slate-400 text-xs mt-3 leading-relaxed">{projectionText}</p>
      </div>

      {/* Referral link + social share */}
      <div className="rounded-2xl bg-[#11111f] border border-[#2a2a45] p-5">
        <div className="flex items-center gap-2 text-[#60a5fa]">
          <Share2 size={16} />
          <span className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Your Referral Link</span>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <code className="flex-1 min-w-[200px] px-3 py-2.5 bg-[#0a0a14] border border-[#2a2a45] rounded-lg text-slate-200 text-[13px] font-mono break-all">{referralLink}</code>
          <button onClick={onCopy} className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-white text-[13px] font-bold transition">
            {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
          </button>
        </div>
        <p className="text-slate-500 text-xs mt-2">
          Share everywhere. New players who sign up through your link are attributed to you and qualify on their first M-Pesa deposit.
        </p>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ShareBtn onClick={() => onShare('whatsapp')} icon={MessageCircle} label="WhatsApp" color="#25D366" />
          <ShareBtn onClick={() => onShare('telegram')} icon={Send} label="Telegram" color="#229ED9" />
          <ShareBtn onClick={() => onShare('x')} icon={XLogo} label="X" color="#e2e8f0" />
          <ShareBtn onClick={() => onShare('facebook')} icon={Facebook} label="Facebook" color="#1877F2" />
        </div>
      </div>

      {/* Request payout */}
      <div className="rounded-2xl bg-[#11111f] border border-[#2a2a45] p-5">
        <div className="flex items-center gap-2 text-[#22c55e]">
          <WalletIcon size={16} />
          <span className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Request a Payout</span>
        </div>
        {hasPending ? (
          <p className="mt-3 text-slate-400 text-sm">You have a pending payout request. You can submit a new one once it's been reviewed.</p>
        ) : d.commission_available <= 0 ? (
          <p className="mt-3 text-slate-400 text-sm">No commission available to withdraw yet. Keep referring — commission accrues as your qualified players play.</p>
        ) : (
          <form onSubmit={onSubmitPayout} className="mt-4 flex flex-col gap-3">
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1.5">Amount (KSh)</label>
              <input
                type="number" inputMode="numeric" min={1} step={1} value={amount}
                onChange={e => setAmount(e.target.value)} required
                placeholder={`Up to ${Math.floor(d.commission_available)}`}
                className="w-full px-3 py-3 bg-[#0a0a14] border border-[#2a2a45] rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-[#22c55e] transition"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1.5">M-Pesa phone</label>
              <input
                type="tel" inputMode="numeric" value={phone}
                onChange={e => setPhone(e.target.value)} required
                placeholder="0712345678"
                className="w-full px-3 py-3 bg-[#0a0a14] border border-[#2a2a45] rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-[#22c55e] transition"
              />
            </div>
            <button type="submit" disabled={submitting} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-white text-sm font-bold transition disabled:opacity-50">
              {submitting && <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-r-transparent animate-spin" />}
              Request payout
            </button>
          </form>
        )}
        <p className="text-slate-600 text-xs mt-3">Every payout is reviewed and verified by an admin before settlement via M-Pesa.</p>
      </div>

      {/* Payout history */}
      <div className="rounded-2xl bg-[#11111f] border border-[#2a2a45] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#2a2a45]">
          <span className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Payout History</span>
        </div>
        {d.payouts.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-600 text-sm">No payout requests yet.</div>
        ) : (
          <div className="divide-y divide-[#1e1e30]">
            {d.payouts.map((p: CommissionPayout) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                <div className="min-w-0">
                  <div className="text-white font-semibold text-sm tabular-nums">{ksh(p.amount)}</div>
                  <div className="text-slate-500 text-xs mt-0.5">{p.phone_number} · {new Date(p.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
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
      <FunnelBar label="Referred" value={referred} widthPct={100} color="#60a5fa" />
      <FunnelBar label="Qualified" value={qualified} widthPct={Math.max(qPct, qualified > 0 ? 8 : 0)} color="#22c55e" />
      <div className="text-xs text-slate-500 pt-1">
        {referred > 0 ? `${((qualified / referred) * 100).toFixed(0)}% of referrals qualified` : 'No referrals yet — share your link to begin.'}
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
      <div className="h-3 rounded-full bg-[#1a1a2e] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${widthPct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function CommissionDonut({ paid, approved, pending, available }: { paid: number; approved: number; pending: number; available: number }) {
  const segs = [
    { label: 'Paid', value: paid, color: '#22c55e' },
    { label: 'Approved', value: approved, color: '#60a5fa' },
    { label: 'Pending', value: pending, color: '#e0a80b' },
    { label: 'Available', value: available, color: '#a78bfa' },
  ].filter(s => s.value > 0);
  const total = segs.reduce((s, x) => s + x.value, 0);

  const R = 34, C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width="84" height="84" viewBox="0 0 84 84" className="flex-shrink-0 -rotate-90">
        <circle cx="42" cy="42" r={R} fill="none" stroke="#1a1a2e" strokeWidth="12" />
        {total > 0 && segs.map((s) => {
          const len = (s.value / total) * C;
          const dash = `${len} ${C - len}`;
          const el = <circle key={s.label} cx="42" cy="42" r={R} fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={dash} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
      </svg>
      <div className="space-y-1.5 text-xs min-w-0">
        {total === 0 ? (
          <span className="text-slate-500">No commission recorded yet.</span>
        ) : segs.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-slate-400">{s.label}</span>
            <span className="text-white font-semibold ml-auto tabular-nums">{ksh(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PayoutTrend({ payouts }: { payouts: CommissionPayout[] }) {
  // Cumulative PAID amount over time (chronological).
  const points = useMemo(() => {
    const paid = payouts
      .filter(p => p.status === 'paid')
      .map(p => ({ t: new Date(p.paid_at ?? p.created_at).getTime(), amt: p.amount }))
      .sort((a, b) => a.t - b.t);
    let cum = 0;
    return paid.map(p => ({ t: p.t, cum: (cum += p.amt) }));
  }, [payouts]);

  if (points.length < 2) {
    return <div className="text-slate-500 text-sm py-4 text-center">Your paid-out earnings will chart here once you've received at least two payouts.</div>;
  }

  const W = 520, H = 120, pad = 8;
  const xs = points.map(p => p.t);
  const ys = points.map(p => p.cum);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const sx = (t: number) => pad + ((t - minX) / (maxX - minX || 1)) * (W - 2 * pad);
  const sy = (v: number) => H - pad - (v / (maxY || 1)) * (H - 2 * pad);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.t).toFixed(1)} ${sy(p.cum).toFixed(1)}`).join(' ');
  const area = `${line} L ${sx(points[points.length - 1].t).toFixed(1)} ${H - pad} L ${sx(points[0].t).toFixed(1)} ${H - pad} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none">
        <defs>
          <linearGradient id="payoutFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#payoutFill)" />
        <path d={line} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="text-xs text-slate-500 mt-1">Total paid out: <span className="text-[#22c55e] font-semibold">{ksh(maxY)}</span></div>
    </div>
  );
}

// ===========================================================================
// Small UI primitives
// ===========================================================================
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-[#0d0d1a] scrollbar-thin">
      <header className="sticky top-0 z-20 bg-[#0d0d1a]/95 backdrop-blur border-b border-[#2a2a45] h-12 flex items-center px-3 gap-2">
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
      <div className="w-14 h-14 rounded-2xl bg-[#1a1a2e] border border-[#2a2a45] flex items-center justify-center mx-auto mb-4">
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
    <div className="rounded-2xl bg-[#11111f] border border-[#2a2a45] p-4">
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
    <div className="rounded-2xl bg-[#11111f] border border-[#2a2a45] p-5">
      <div className="text-[11px] uppercase tracking-wide font-bold text-slate-400 mb-3">{title}</div>
      {children}
    </div>
  );
}

function ShareBtn({ onClick, icon: Icon, label, color }: { onClick: () => void; icon: React.ElementType; label: string; color: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#1a1a2e] border border-[#2a2a45] hover:border-[#3a3a55] text-slate-200 text-xs font-semibold transition active:scale-95"
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
      <div className="h-28 rounded-2xl bg-[#11111f] border border-[#2a2a45] animate-pulse" />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-[#11111f] border border-[#2a2a45] animate-pulse" />)}
      </div>
      <div className="h-24 rounded-2xl bg-[#11111f] border border-[#2a2a45] animate-pulse" />
    </div>
  );
}
