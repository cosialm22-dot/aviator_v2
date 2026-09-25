import { useState, useEffect, useCallback } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Save, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { staffError } from '../../ui/format';
import { Button, Card, ErrorState, Switch, inputCls } from '../../ui/kit';

// ============================================================================
// PaymentsTab — the M-Pesa (Daraja) paybill: B2C payouts for withdrawals (and STK only if
// deposits are switched back from Mega Pay). PLATFORM OWNER ONLY: the row is shared by every
// brand. The browser never receives secret values: admin_get_mpesa_config returns only
// "saved" flags, and admin_save_mpesa_config replaces a secret only when a new one is typed.
// Every save is audited server-side (names of rotated secrets only).
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

const labelCls = 'mb-1.5 block text-[13px] font-medium text-ink';
const helpCls = 'mt-1 text-[12px] text-faint';

export default function PaymentsTab() {
  const [cfg, setCfg] = useState<MpesaConfig>(EMPTY);
  // Secret inputs; empty string = "leave unchanged".
  const [secrets, setSecrets] = useState({ passkey: '', consumer_secret: '', security_credential: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = (d: Record<string, unknown> | null) => {
    if (!d) { setCfg(EMPTY); return; }
    setCfg({
      id: (d.id as string) ?? null,
      environment: (d.environment as string) ?? 'sandbox',
      consumer_key: (d.consumer_key as string) ?? '',
      passkey_set: Boolean(d.passkey_set),
      consumer_secret_set: Boolean(d.consumer_secret_set),
      security_credential_set: Boolean(d.security_credential_set),
      shortcode: (d.shortcode as string) ?? '',
      b2c_shortcode: (d.b2c_shortcode as string) ?? '',
      initiator_name: (d.initiator_name as string) ?? '',
      callback_base_url: (d.callback_base_url as string) ?? '',
      is_active: d.is_active !== false,
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.rpc('admin_get_mpesa_config');
    if (error) setErr(staffError(error, 'Could not load the M-Pesa configuration.'));
    else apply(data as Record<string, unknown> | null);
    setSecrets({ passkey: '', consumer_secret: '', security_credential: '' });
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof MpesaConfig>(k: K, v: MpesaConfig[K]) => { setCfg(c => ({ ...c, [k]: v })); setSaved(false); };

  async function save() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    const typed = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim()));
    const { data, error } = await supabase.rpc('admin_save_mpesa_config', {
      p_data: {
        environment: cfg.environment, consumer_key: cfg.consumer_key.trim(), shortcode: cfg.shortcode.trim(),
        b2c_shortcode: cfg.b2c_shortcode.trim(), initiator_name: cfg.initiator_name.trim(),
        callback_base_url: cfg.callback_base_url.trim(), is_active: cfg.is_active,
      },
      p_secrets: typed,
    });
    setSaving(false);
    if (error) { setErr(staffError(error, 'Could not save the M-Pesa configuration.')); return; }
    apply(data as Record<string, unknown>);
    setSecrets({ passkey: '', consumer_secret: '', security_credential: '' });
    setSaved(true);
  }

  if (loading) {
    return <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-40 rounded-xl bg-surface animate-pulse" />)}</div>;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {err && <ErrorState message={err} />}

      <p className="text-[13px] text-muted">
        The Safaricom Daraja paybill that pays out withdrawals (B2C). Player deposits go through Mega Pay — see Deposits.
        This paybill is shared by every brand. Secrets are write-only: saved values are never shown, and are replaced only when you type a new one.
      </p>

      {/* Status */}
      <Card title="Environment & status">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="env">Daraja environment</label>
            <select id="env" value={cfg.environment} onChange={e => set('environment', e.target.value)} className={inputCls}>
              <option value="sandbox">Sandbox (testing)</option>
              <option value="production">Production (live money)</option>
            </select>
            <p className={helpCls}>Switch to Production only with live Safaricom credentials.</p>
          </div>
          <div className="flex items-center justify-between gap-3 self-center rounded-lg bg-raised px-4 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-ink">Payments active</div>
              <div className="text-[12px] text-faint">Disable to pause all M-Pesa deposits &amp; payouts.</div>
            </div>
            <Switch checked={cfg.is_active} onChange={v => set('is_active', v)} label="Payments active" />
          </div>
        </div>
      </Card>

      {/* Receive money */}
      <Card title={<span className="flex items-center gap-2"><ArrowDownToLine size={15} className="text-up" />Receive money — STK push (only if deposits are switched back to Daraja)</span>}>
        <p className="mb-4 text-[13px] text-muted">The paybill/till that prompts players to pay into the platform.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="shortcode">Paybill / Till (shortcode)</label>
            <input id="shortcode" value={cfg.shortcode} onChange={e => set('shortcode', e.target.value.replace(/\D/g, ''))} placeholder="e.g. 174379" className={inputCls + ' tabular-nums'} inputMode="numeric" />
          </div>
          <div>
            <label className={labelCls} htmlFor="passkey">Passkey {cfg.passkey_set && <span className="font-normal text-faint">(saved)</span>}</label>
            <input id="passkey" type="password" value={secrets.passkey} onChange={e => { setSecrets(s => ({ ...s, passkey: e.target.value })); setSaved(false); }} placeholder={cfg.passkey_set ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 leave blank to keep' : 'Lipa Na M-Pesa passkey'} autoComplete="off" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ckey">Consumer key</label>
            <input id="ckey" value={cfg.consumer_key} onChange={e => set('consumer_key', e.target.value)} placeholder="Daraja app consumer key" autoComplete="off" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="csecret">Consumer secret {cfg.consumer_secret_set && <span className="font-normal text-faint">(saved)</span>}</label>
            <input id="csecret" type="password" value={secrets.consumer_secret} onChange={e => { setSecrets(s => ({ ...s, consumer_secret: e.target.value })); setSaved(false); }} placeholder={cfg.consumer_secret_set ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 leave blank to keep' : 'Daraja app consumer secret'} autoComplete="off" className={inputCls} />
          </div>
        </div>
      </Card>

      {/* Send money */}
      <Card title={<span className="flex items-center gap-2"><ArrowUpFromLine size={15} className="text-down" />Send money - B2C (payouts)</span>}>
        <p className="mb-4 text-[13px] text-muted">The shortcode and initiator used to pay withdrawals to players.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="b2c">B2C shortcode</label>
            <input id="b2c" value={cfg.b2c_shortcode} onChange={e => set('b2c_shortcode', e.target.value.replace(/\D/g, ''))} placeholder="e.g. 600000" className={inputCls + ' tabular-nums'} inputMode="numeric" />
            <p className={helpCls}>Defaults to the paybill if your B2C uses the same shortcode.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="init">Initiator name</label>
            <input id="init" value={cfg.initiator_name} onChange={e => set('initiator_name', e.target.value)} placeholder="e.g. testapi" autoComplete="off" className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="seccred">Security credential {cfg.security_credential_set && <span className="font-normal text-faint">(saved)</span>}</label>
            <input id="seccred" type="password" value={secrets.security_credential} onChange={e => { setSecrets(s => ({ ...s, security_credential: e.target.value })); setSaved(false); }} placeholder={cfg.security_credential_set ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 leave blank to keep' : 'Encrypted initiator password'} autoComplete="off" className={inputCls} />
            <p className={helpCls}>The Daraja-encrypted initiator password used to authorise B2C payouts.</p>
          </div>
        </div>
      </Card>

      {/* Callbacks */}
      <Card title={<span className="flex items-center gap-2"><ShieldCheck size={15} className="text-brand" />Callbacks</span>}>
        <label className={labelCls} htmlFor="cb">Callback base URL</label>
        <input id="cb" value={cfg.callback_base_url} onChange={e => set('callback_base_url', e.target.value.trim())} placeholder="https://<project-ref>.functions.supabase.co" className={inputCls} inputMode="url" />
        <p className={helpCls}>Base URL Safaricom calls back for STK and B2C results (your deployed edge functions).</p>
      </Card>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} loading={saving}>
          {!saving && <Save size={14} />}
          {saving ? 'Saving' : 'Save configuration'}
        </Button>
        {saved && <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-up"><Check size={15} /> Saved</span>}
      </div>
    </div>
  );
}
