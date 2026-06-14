import { useState, useEffect, useCallback } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Save, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { errMsg } from './shared';

// ============================================================================
// PaymentsTab - manage the M-Pesa paybills used to RECEIVE money from players
// (STK Push / C2B) and to SEND money to players (B2C payouts).
// ----------------------------------------------------------------------------
// Backed by the single `mpesa_config` row. RLS (`admin_full_access`) already
// restricts the table to admin/super_admin, and this whole Settings section is
// super_admin-only, so we read/write the row directly (same pattern as the
// system_settings tabs) rather than adding an RPC.
//
// SECRET HANDLING: the three credential secrets (passkey, consumer_secret,
// security_credential) are NEVER read back into the DOM. If a secret already
// has a value we show a "saved" placeholder and leave the input empty; the
// secret is only overwritten when the operator types a replacement. Non-secret
// fields are prefilled normally so they can be reviewed and edited.
// ============================================================================

interface MpesaConfig {
  id: string | null;
  environment: string;
  consumer_key: string;
  passkey_set: boolean;
  consumer_secret_set: boolean;
  security_credential_set: boolean;
  shortcode: string;
  b2c_shortcode: string;
  initiator_name: string;
  callback_base_url: string;
  is_active: boolean;
}

const EMPTY: MpesaConfig = {
  id: null, environment: 'sandbox', consumer_key: '', passkey_set: false,
  consumer_secret_set: false, security_credential_set: false, shortcode: '',
  b2c_shortcode: '', initiator_name: '', callback_base_url: '', is_active: true,
};

const inputCls =
  'w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition';
const labelCls = 'block text-[12px] font-medium text-ink mb-1.5';
const helpCls = 'text-[11px] text-faint mt-1';
const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';

export default function PaymentsTab() {
  const [cfg, setCfg] = useState<MpesaConfig>(EMPTY);
  // Secret inputs are tracked separately; empty string = "leave unchanged".
  const [secrets, setSecrets] = useState({ passkey: '', consumer_secret: '', security_credential: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('mpesa_config')
      .select('id, environment, consumer_key, consumer_secret, passkey, security_credential, shortcode, b2c_shortcode, initiator_name, callback_base_url, is_active')
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) { setErr(errMsg(error, 'Could not load M-Pesa configuration.')); setLoading(false); return; }
    if (data) {
      setCfg({
        id: data.id,
        environment: data.environment ?? 'sandbox',
        consumer_key: data.consumer_key ?? '',
        passkey_set: Boolean(data.passkey),
        consumer_secret_set: Boolean(data.consumer_secret),
        security_credential_set: Boolean(data.security_credential),
        shortcode: data.shortcode ?? '',
        b2c_shortcode: data.b2c_shortcode ?? '',
        initiator_name: data.initiator_name ?? '',
        callback_base_url: data.callback_base_url ?? '',
        is_active: data.is_active ?? true,
      });
    } else {
      setCfg(EMPTY);
    }
    setSecrets({ passkey: '', consumer_secret: '', security_credential: '' });
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof MpesaConfig>(k: K, v: MpesaConfig[K]) => { setCfg(c => ({ ...c, [k]: v })); setSaved(false); };

  async function save() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Build the row. Non-secret fields always written; secrets only when the
      // operator typed a replacement (empty input = keep existing value).
      const row: Record<string, unknown> = {
        environment: cfg.environment,
        consumer_key: cfg.consumer_key.trim(),
        shortcode: cfg.shortcode.trim(),
        b2c_shortcode: cfg.b2c_shortcode.trim() || null,
        initiator_name: cfg.initiator_name.trim() || null,
        callback_base_url: cfg.callback_base_url.trim(),
        is_active: cfg.is_active,
        updated_by: session?.user.id ?? null,
        updated_at: new Date().toISOString(),
      };
      if (secrets.passkey.trim()) row.passkey = secrets.passkey;
      if (secrets.consumer_secret.trim()) row.consumer_secret = secrets.consumer_secret;
      if (secrets.security_credential.trim()) row.security_credential = secrets.security_credential;

      const changedSecrets = Object.keys(secrets).filter(k => secrets[k as keyof typeof secrets].trim());

      let savedId = cfg.id;
      if (cfg.id) {
        const { error } = await supabase.from('mpesa_config').update(row).eq('id', cfg.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('mpesa_config').insert(row).select('id').single();
        if (error) throw error;
        savedId = data?.id ?? null;
      }

      // Best-effort audit. Never log secret VALUES - only which fields changed.
      if (session) {
        await supabase.from('admin_audit_log').insert({
          admin_id: session.user.id,
          action: 'mpesa_config_updated',
          target_type: 'mpesa_config',
          target_id: savedId,
          details: { environment: cfg.environment, is_active: cfg.is_active, secrets_rotated: changedSecrets },
        });
      }

      setSaved(true);
      await load();
    } catch (e) {
      setErr(errMsg(e, 'Could not save M-Pesa configuration.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-40 rounded-xl border border-line bg-surface animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {err && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-down text-[13px]">{err}</div>}

      <p className="text-[13px] text-muted">
        Configure the M-Pesa Daraja credentials used to collect deposits from players and to pay out withdrawals.
        Credentials are write-only here for safety: existing secrets are masked and only replaced when you enter a new value.
      </p>

      {/* Status */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h3 className={HEAD}>Environment &amp; status</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-4">
          <div>
            <label className={labelCls} htmlFor="env">Daraja environment</label>
            <select id="env" value={cfg.environment} onChange={e => set('environment', e.target.value)} className={inputCls}>
              <option value="sandbox">Sandbox (testing)</option>
              <option value="production">Production (live money)</option>
            </select>
            <p className={helpCls}>Switch to Production only with live Safaricom credentials.</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-2.5 self-end">
            <div>
              <div className="text-[13px] font-medium text-ink">Payments active</div>
              <div className="text-[11px] text-faint">Disable to pause all M-Pesa deposits &amp; payouts.</div>
            </div>
            <button
              role="switch"
              aria-checked={cfg.is_active}
              onClick={() => set('is_active', !cfg.is_active)}
              className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' + (cfg.is_active ? 'bg-up' : 'bg-slate-300')}
            >
              <span className={'inline-block h-4 w-4 transform rounded-full bg-white transition-transform ' + (cfg.is_active ? 'translate-x-6' : 'translate-x-1')} />
            </button>
          </div>
        </div>
      </section>

      {/* Receive money */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <div className="flex items-center gap-2">
          <ArrowDownToLine size={16} className="text-up" />
          <h3 className={HEAD}>Receive money - STK Push (deposits)</h3>
        </div>
        <p className="text-[12px] text-muted mt-1 mb-4">The paybill/till that prompts players to pay into the platform.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className={labelCls} htmlFor="shortcode">Paybill / Till (shortcode)</label>
            <input id="shortcode" value={cfg.shortcode} onChange={e => set('shortcode', e.target.value.replace(/\D/g, ''))} placeholder="e.g. 174379" className={inputCls} inputMode="numeric" />
          </div>
          <div>
            <label className={labelCls} htmlFor="passkey">Passkey {cfg.passkey_set && <span className="text-faint font-normal">(saved)</span>}</label>
            <input id="passkey" type="password" value={secrets.passkey} onChange={e => { setSecrets(s => ({ ...s, passkey: e.target.value })); setSaved(false); }} placeholder={cfg.passkey_set ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 leave blank to keep' : 'Lipa Na M-Pesa passkey'} autoComplete="off" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ckey">Consumer key</label>
            <input id="ckey" value={cfg.consumer_key} onChange={e => set('consumer_key', e.target.value)} placeholder="Daraja app consumer key" autoComplete="off" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="csecret">Consumer secret {cfg.consumer_secret_set && <span className="text-faint font-normal">(saved)</span>}</label>
            <input id="csecret" type="password" value={secrets.consumer_secret} onChange={e => { setSecrets(s => ({ ...s, consumer_secret: e.target.value })); setSaved(false); }} placeholder={cfg.consumer_secret_set ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 leave blank to keep' : 'Daraja app consumer secret'} autoComplete="off" className={inputCls} />
          </div>
        </div>
      </section>

      {/* Send money */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <div className="flex items-center gap-2">
          <ArrowUpFromLine size={16} className="text-down" />
          <h3 className={HEAD}>Send money - B2C (payouts)</h3>
        </div>
        <p className="text-[12px] text-muted mt-1 mb-4">The shortcode and initiator used to pay withdrawals to players.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className={labelCls} htmlFor="b2c">B2C shortcode</label>
            <input id="b2c" value={cfg.b2c_shortcode} onChange={e => set('b2c_shortcode', e.target.value.replace(/\D/g, ''))} placeholder="e.g. 600000" className={inputCls} inputMode="numeric" />
            <p className={helpCls}>Defaults to the paybill if your B2C uses the same shortcode.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="init">Initiator name</label>
            <input id="init" value={cfg.initiator_name} onChange={e => set('initiator_name', e.target.value)} placeholder="e.g. testapi" autoComplete="off" className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="seccred">Security credential {cfg.security_credential_set && <span className="text-faint font-normal">(saved)</span>}</label>
            <input id="seccred" type="password" value={secrets.security_credential} onChange={e => { setSecrets(s => ({ ...s, security_credential: e.target.value })); setSaved(false); }} placeholder={cfg.security_credential_set ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 leave blank to keep' : 'Encrypted initiator password'} autoComplete="off" className={inputCls} />
            <p className={helpCls}>The Daraja-encrypted initiator password used to authorise B2C payouts.</p>
          </div>
        </div>
      </section>

      {/* Callbacks */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand" />
          <h3 className={HEAD}>Callbacks</h3>
        </div>
        <div className="mt-4">
          <label className={labelCls} htmlFor="cb">Callback base URL</label>
          <input id="cb" value={cfg.callback_base_url} onChange={e => set('callback_base_url', e.target.value.trim())} placeholder="https://<project-ref>.functions.supabase.co" className={inputCls} inputMode="url" />
          <p className={helpCls}>Base URL Safaricom calls back for STK and B2C results (your deployed edge functions).</p>
        </div>
      </section>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-brand text-white text-[13px] font-semibold hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-50"
        >
          {saving ? <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : <Save size={15} />}
          {saving ? 'Saving' : 'Save configuration'}
        </button>
        {saved && <span className="inline-flex items-center gap-1.5 text-up text-[13px] font-medium"><Check size={15} /> Saved</span>}
      </div>
    </div>
  );
}
