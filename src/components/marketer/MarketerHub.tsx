import { useState, useEffect, useCallback } from 'react';
import { errMsg } from '../../lib/errors';
import { Link } from 'react-router-dom';
import { Copy, Check, RefreshCw, MessageCircle, Send, Facebook } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { buildShareUrl, type SharePlatform } from '../../lib/share';
import { isValidKenyanPhone, normalizeKenyanPhone } from '../../lib/phone';
import Sheet from '../ui/Sheet';
import NavPage from '../ui/NavPage';
import { Button, Empty, Field, Group, Row, Spinner } from '../ui/ios';
import type { Profile } from '../../types';
import type { MarketerDashboard, CommissionPayout } from '../../types/marketing';

// ============================================================================
// MarketerHub - the marketer's OWN page at /marketer, on the player iOS kit.
// Designed like a wallet: one number (what you can withdraw), one action
// (withdraw), one link (to grow). Everything else is quiet.
//
// Data path (all authorisation server-side, SECURITY DEFINER, _is_marketer()):
//   load    -> marketer_dashboard()                   (stats + referral code)
//   payout  -> request_commission_payout(amt, phone)  (validated vs available)
// ============================================================================

function ksh(n: number): string {
  return 'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });
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

  const referralLink = data?.referral_code ? `${window.location.origin}/?ref=${data.referral_code}` : '';
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
      <NavPage title="Marketer hub">
        <Gate text="Log in to your marketer account."><Button className="mx-auto mt-5 max-w-[280px]" onClick={onSignInRequired}>Log in</Button></Gate>
      </NavPage>
    );
  }
  if (!isMarketer) {
    return (
      <NavPage title="Marketer hub">
        <Gate text="This area is for marketers. Ask an admin to enable it."><Link to="/" className="mx-auto mt-5 flex h-[50px] max-w-[280px] items-center justify-center rounded-xl bg-ios-fill text-headline text-white">Back to game</Link></Gate>
      </NavPage>
    );
  }

  const refresh = (
    <button onClick={() => void load()} disabled={loading} aria-label="Refresh"
      className="grid h-11 w-11 place-items-center text-ios-green disabled:opacity-40">
      <RefreshCw size={19} strokeWidth={2.2} className={loading ? 'animate-spin' : ''} />
    </button>
  );

  return (
    <NavPage title="Marketer hub" action={refresh}>
      <div className="space-y-6 px-4 pt-2">
        {notice && <p role="status" className="rounded-xl bg-[rgba(48,209,88,0.12)] px-4 py-3 text-subhead text-ios-green">{notice}</p>}
        {err && data && <p role="alert" className="rounded-xl bg-[rgba(255,69,58,0.12)] px-4 py-3 text-subhead text-ios-red">{err}</p>}

        {loading && !data ? (
          <div className="grid place-items-center py-16"><Spinner /></div>
        ) : err && !data ? (
          <Empty>{err}</Empty>
        ) : data ? (
          <HubBody data={data} referralLink={referralLink} copied={copied} onCopy={copyLink} onShare={share} onWithdraw={openWithdraw} />
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
    </NavPage>
  );
}

// ===========================================================================
// Body - balance, link, stats, payouts. Nothing else.
// ===========================================================================
interface BodyProps {
  data: MarketerDashboard;
  referralLink: string;
  copied: boolean;
  onCopy: () => void;
  onShare: (p: SharePlatform) => void;
  onWithdraw: () => void;
}

const PAYOUT: Record<string, string> = { pending: 'text-ios-orange', approved: 'text-ios-blue', paid: 'text-ios-green', rejected: 'text-ios-label2' };

function HubBody({ data: d, referralLink, copied, onCopy, onShare, onWithdraw }: BodyProps) {
  const ratePct = (d.commission_rate * 100).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const conv = d.referred_count > 0 ? Math.round((d.qualified_count / d.referred_count) * 100) : 0;
  const canWithdraw = d.commission_available > 0 && d.commission_pending <= 0;
  const disabledReason = d.commission_pending > 0 ? 'Payout pending review' : 'Nothing to withdraw yet';

  return (
    <>
      {/* The money and the one action. */}
      <div className="pb-1 pt-4 text-center">
        <p className="text-footnote text-ios-label2">Available to withdraw</p>
        <p className="text-large-title tabular-nums text-white">{ksh(d.commission_available)}</p>
        <Button className="mt-5" disabled={!canWithdraw} onClick={onWithdraw}>Withdraw</Button>
        {!canWithdraw ? <p className="mt-2 text-footnote text-ios-label2">{disabledReason}</p> : null}
      </div>

      <Group>
        <Row title="Earned" detail={ksh(d.commission_earned)} />
        <Row title="Paid out" detail={ksh(d.commission_paid)} />
        <Row title="Pending" detail={ksh(d.commission_pending + d.commission_approved)} />
      </Group>

      <Group header="Your link" footer={referralLink ? 'Players who sign up with it are yours.' : undefined}>
        {referralLink ? (
          <Row title={<span className="font-mono text-subhead text-ios-label2">{referralLink.replace(/^https?:\/\//, '')}</span>}
            trailing={<Button size="sm" variant="tinted" onClick={onCopy} aria-label="Copy referral link">{copied ? <><Check size={14} />Copied</> : <><Copy size={14} />Copy</>}</Button>} />
        ) : <Row title={<span className="text-ios-label2">Your link is being set up</span>} />}
        {referralLink ? (
          <div className="grid grid-cols-4 gap-2 p-3">
            <ShareBtn onClick={() => onShare('whatsapp')} icon={MessageCircle} label="WhatsApp" color="#25D366" />
            <ShareBtn onClick={() => onShare('telegram')} icon={Send} label="Telegram" color="#229ED9" />
            <ShareBtn onClick={() => onShare('x')} icon={XLogo} label="X" color="#ffffff" />
            <ShareBtn onClick={() => onShare('facebook')} icon={Facebook} label="Facebook" color="#1877F2" />
          </div>
        ) : null}
      </Group>

      <Group header="Referrals">
        <Row title="Referred" detail={d.referred_count.toLocaleString('en-KE')} />
        <Row title="Qualified" detail={d.qualified_count.toLocaleString('en-KE')} subtitle={`${conv}% of referred`} />
        <Row title="Your rate" detail={`${ratePct}%`} />
      </Group>

      {d.payouts.length > 0 && (
        <Group header="Payouts">
          {d.payouts.map((p: CommissionPayout) => (
            <Row key={p.id} title={<span className="tabular-nums">{ksh(p.amount)}</span>}
              subtitle={[p.phone_number, new Date(p.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }), p.status === 'rejected' ? p.rejection_reason : null].filter(Boolean).join(' · ')}
              detail={<span className={`capitalize ${PAYOUT[p.status] ?? 'text-ios-label2'}`}>{p.status}</span>} />
          ))}
        </Group>
      )}
    </>
  );
}

// ===========================================================================
// Withdraw - a sheet, so the resting page stays a number and a button.
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
  return (
    <Sheet title="Withdraw" label="Withdraw commission" onClose={onClose}>
      <form onSubmit={onSubmit} className="px-4">
        <p className="pb-4 text-center text-subhead text-ios-label2">Available <span className="font-semibold tabular-nums text-ios-green">{ksh(available)}</span></p>
        <div className="space-y-3">
          <Field type="number" inputMode="numeric" min={1} step={1} value={amount} onChange={e => setAmount(e.target.value)} required
            placeholder={`Up to ${Math.floor(available).toLocaleString('en-KE')}`} aria-label="Amount in KES" leading="KES" />
          <Field type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} required placeholder="M-Pesa number" aria-label="M-Pesa phone" />
        </div>
        {err && <p role="alert" className="mt-3 text-center text-footnote text-ios-red">{err}</p>}
        <Button type="submit" disabled={submitting} className="mt-5">{submitting ? <Spinner size={16} /> : null}Request payout</Button>
        <p className="mt-3 text-center text-footnote text-ios-label2">An admin reviews it, then it is paid to M-Pesa.</p>
      </form>
    </Sheet>
  );
}

// ===========================================================================
// Primitives
// ===========================================================================
function Gate({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="px-4 pt-16 text-center">
      <p className="text-subhead text-ios-label2">{text}</p>
      {children}
    </div>
  );
}

function ShareBtn({ onClick, icon: Icon, label, color }: { onClick: () => void; icon: React.ElementType; label: string; color: string }) {
  return (
    <button onClick={onClick} aria-label={`Share on ${label}`}
      className="flex h-11 items-center justify-center rounded-[10px] bg-ios-fill transition-colors active:bg-ios-elev3">
      <Icon size={19} style={{ color }} />
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
