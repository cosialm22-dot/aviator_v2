import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button, Card, ErrorState, Modal, Notice, Skeleton, Switch } from '../ui/kit';
import { relTime, staffError } from '../ui/format';

// Platform kill switches (platform owner only). Each is enforced server-side:
//   deposits_enabled      → fn_megapay_begin          play_enabled       → place_bet
//   withdrawals_enabled   → request_withdrawal        registrations_enabled → handle_new_user
//   marketers_enabled     → admin_promote_to_marketer
// Every change asks for confirmation, is versioned and audited (fn_platform_set_global_config).

type Key = 'deposits_enabled' | 'withdrawals_enabled' | 'play_enabled' | 'registrations_enabled' | 'marketers_enabled';
const SWITCHES: { key: Key; label: string; off: string }[] = [
  { key: 'deposits_enabled', label: 'Deposits', off: 'No player on any brand can start a deposit.' },
  { key: 'withdrawals_enabled', label: 'Withdrawals', off: 'No player on any brand can request a withdrawal.' },
  { key: 'play_enabled', label: 'Real-money betting', off: 'No real-money bet can be placed on any brand. Demo keeps working.' },
  { key: 'registrations_enabled', label: 'New sign-ups', off: 'Nobody can create a new account on any brand.' },
  { key: 'marketers_enabled', label: 'New marketers', off: 'Staff cannot promote players to marketers.' },
];

interface Config extends Record<Key, boolean> { version: number; updated_at: string | null }

export default function GlobalControls() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: Key; to: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_platform_get_global_config');
    if (error) { setErr(staffError(error, 'Could not load the platform switches.')); return; }
    setErr(null); setCfg(data as Config);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function apply() {
    if (!pending) return;
    setSaving(true);
    const { data, error } = await supabase.rpc('fn_platform_set_global_config', { p_patch: { [pending.key]: pending.to } });
    setSaving(false);
    if (error) { setErr(staffError(error, 'Could not change the switch.')); setPending(null); return; }
    const sw = SWITCHES.find((s) => s.key === pending.key)!;
    setCfg(data as Config);
    setDone(`${sw.label} turned ${pending.to ? 'on' : 'off'} for every brand.`);
    setPending(null);
  }

  const offCount = cfg ? SWITCHES.filter((s) => !cfg[s.key]).length : 0;

  return (
    <Card title="Platform switches" testId="global-controls"
      action={cfg && <span className="text-[12px] tabular-nums text-faint">Version {cfg.version} · changed {relTime(cfg.updated_at)}</span>}>
      {err && <div className="mb-3"><ErrorState message={err} onRetry={() => void load()} /></div>}
      {done && <div className="mb-3"><Notice tone="ok" onClose={() => setDone(null)}>{done}</Notice></div>}
      {offCount > 0 && <div className="mb-3"><Notice tone="warn">{offCount} platform switch{offCount > 1 ? 'es are' : ' is'} off.</Notice></div>}
      {!cfg ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">{SWITCHES.map((s) => <Skeleton key={s.key} className="h-14 w-full" />)}</div> : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {SWITCHES.map((s) => {
            const on = cfg[s.key];
            return (
              <div key={s.key} className={`flex min-h-[56px] items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors ${on ? 'bg-raised' : 'bg-down/10'}`}>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">{s.label}</div>
                  <div className={`text-[12px] ${on ? 'text-up' : 'text-down'}`}>{on ? 'On' : 'Off'}</div>
                </div>
                <Switch checked={on} label={s.label} testId={`switch-${s.key}`} onChange={(to) => setPending({ key: s.key, to })} />
              </div>
            );
          })}
        </div>
      )}
      {pending && (() => {
        const sw = SWITCHES.find((s) => s.key === pending.key)!;
        return (
          <Modal title={`Turn ${pending.to ? 'on' : 'off'} ${sw.label.toLowerCase()}?`} tone={pending.to ? undefined : 'danger'} onClose={() => setPending(null)}
            subtitle="This applies to every brand immediately and is recorded in the audit log."
            footer={<>
              <Button onClick={() => setPending(null)}>Cancel</Button>
              <Button variant={pending.to ? 'primary' : 'danger'} loading={saving} onClick={() => void apply()} data-testid="confirm-switch">
                {pending.to ? 'Yes, turn on for all brands' : 'Yes, turn off for all brands'}
              </Button>
            </>}>
            <p className="text-[13px] leading-5 text-muted">{pending.to ? `Players on every brand can use ${sw.label.toLowerCase()} again.` : sw.off}</p>
          </Modal>
        );
      })()}
    </Card>
  );
}
