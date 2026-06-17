import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, Gamepad2, Wallet, Users, ScrollText, Smartphone } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import SystemSettingsTab, { type SettingRecord } from './settings/SystemSettingsTab';
import { type SettingsTabId } from './settings/registry';
import PaymentsTab from './settings/PaymentsTab';
import StaffTab from './settings/StaffTab';
import AuditTab from './settings/AuditTab';
import { friendly } from './settings/shared';

// ============================================================================
// SettingsPage - the comprehensive, super_admin-only configuration hub. Six
// deep-linkable tabs (?tab=) cover every manageable surface:
//   General   - system availability (maintenance mode)
//   Game      - round timing, bet limits, RTP, crash distribution, engine, bots
//   Finance   - withdrawal thresholds
//   Payments  - M-Pesa / payment provider configuration
//   Staff     - role/RBAC management
//   Audit     - the append-only admin action log
//
// The affiliate commission program (rate + qualifying deposit) is NOT here - it
// lives in its one home, the Marketing hub's Overview tab, alongside the program
// KPIs, so there is a single place to view and edit it.
//
// system_settings rows (General/Game/Finance) are read here once and edited
// through SystemSettingsTab; persistence + audit live in saveSetting. Staff and
// Audit own their own data via their RPCs/queries. The route is already gated to
// super_admin (roleContext ACCESS); the RPCs are the real gate.
// ============================================================================

const TABS = [
  { k: 'general', label: 'General', icon: SlidersHorizontal },
  { k: 'game', label: 'Game', icon: Gamepad2 },
  { k: 'finance', label: 'Finance', icon: Wallet },
  { k: 'payments', label: 'Payments', icon: Smartphone },
  { k: 'staff', label: 'Staff & Roles', icon: Users },
  { k: 'audit', label: 'Audit Log', icon: ScrollText },
] as const;

type TabKey = (typeof TABS)[number]['k'];
const TAB_KEYS = TABS.map(t => t.k) as readonly string[];
const SYSTEM_TABS: TabKey[] = ['general', 'game', 'finance'];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? 'general';
  const tab: TabKey = (TAB_KEYS.includes(raw) ? raw : 'general') as TabKey;

  const setTab = (k: TabKey) => setParams(prev => {
    const next = new URLSearchParams(prev);
    next.set('tab', k);
    return next;
  }, { replace: true });

  const [rows, setRows] = useState<SettingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    const { data, error } = await supabase.from('system_settings').select('key, value, category, description, updated_at').order('key');
    if (error) { setLoadErr(friendly(error.message)); setRows([]); }
    else setRows((data ?? []) as SettingRecord[]);
    setLoading(false);
  }, []);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  // Persist a single system_settings value (jsonb) and record it in the audit
  // log. Returns a structured result so the field renderer can show inline state.
  const saveSetting = useCallback(async (key: string, value: string | number | boolean): Promise<{ ok: boolean; error?: string }> => {
    const original = rows.find(r => r.key === key);
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase
      .from('system_settings')
      .update({ value, updated_by: session?.user.id ?? null, updated_at: new Date().toISOString() })
      .eq('key', key);
    if (error) return { ok: false, error: friendly(error.message) };
    if (session) {
      // Best-effort audit; never fail the save if the log insert is rejected.
      await supabase.from('admin_audit_log').insert({
        admin_id: session.user.id, action: 'setting_updated', target_type: 'setting', target_id: key,
        details: { old: original?.value ?? null, new: value },
      });
    }
    setRows(rs => rs.map(r => (r.key === key ? { ...r, value, updated_at: new Date().toISOString() } : r)));
    return { ok: true };
  }, [rows]);

  const isSystemTab = SYSTEM_TABS.includes(tab);

  return (
    <div className="-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]">
      <div className="space-y-6">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Settings</h1>
          <p className="text-[13px] text-muted mt-1">System configuration, payments, staff roles, and the audit trail</p>
        </div>

        <div className="border-b border-line">
          <nav className="flex gap-1 -mb-px overflow-x-auto" role="tablist" aria-label="Settings sections">
            {TABS.map(({ k, label, icon: Icon }) => {
              const active = tab === k;
              return (
                <button key={k} role="tab" aria-selected={active} onClick={() => setTab(k)}
                  className={'inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 whitespace-nowrap transition-colors ' +
                    (active ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink')}>
                  <Icon size={15} strokeWidth={1.75} />{label}
                </button>
              );
            })}
          </nav>
        </div>

        {isSystemTab && loadErr && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-down text-sm">{loadErr}</div>
        )}

        {isSystemTab && !loadErr && (
          loading
            ? <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl border border-line bg-surface animate-pulse" />)}</div>
            : <SystemSettingsTab tab={tab as SettingsTabId} rows={rows} onSave={saveSetting} />
        )}

        {tab === 'payments' && <PaymentsTab />}
        {tab === 'staff' && <StaffTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  );
}
