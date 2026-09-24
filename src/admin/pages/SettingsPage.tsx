import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, Gamepad2, Wallet, Users, Smartphone, Palette } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import SystemSettingsTab, { type SettingRecord } from './settings/SystemSettingsTab';
import { type SettingsTabId } from './settings/registry';
import PaymentsTab from './settings/PaymentsTab';
import StaffTab from './settings/StaffTab';
import { useAdmin } from '../roleContext';
import SiteThemePanel from './settings/SiteThemePanel';
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

// `platform`: settings shared by every brand — only the platform owner sees and edits them.
const TABS = [
  { k: 'general', label: 'General', icon: SlidersHorizontal, platform: true },
  { k: 'game', label: 'Game', icon: Gamepad2, platform: true },
  { k: 'finance', label: 'Finance', icon: Wallet, platform: true },
  { k: 'payments', label: 'M-Pesa paybill', icon: Smartphone, platform: true },
  { k: 'theme', label: 'Brand theme', icon: Palette, platform: false },
  { k: 'staff', label: 'Staff & roles', icon: Users, platform: false },
] as const;

type TabKey = (typeof TABS)[number]['k'];
const TAB_KEYS = TABS.map(t => t.k) as readonly string[];
const SYSTEM_TABS: TabKey[] = ['general', 'game', 'finance'];

export default function SettingsPage() {
  const { isPlatform } = useAdmin();
  const visible = TABS.filter((t) => isPlatform || !t.platform);
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? visible[0].k;
  const tab: TabKey = (TAB_KEYS.includes(raw) && visible.some((t) => t.k === raw) ? raw : visible[0].k) as TabKey;

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

  useEffect(() => { if (isPlatform) void loadSettings(); else setLoading(false); }, [loadSettings, isPlatform]);

  // Persist a single system_settings value through the server-authoritative
  // admin_set_setting RPC. The RPC is the SOLE write path: it enforces the
  // super_admin gate, validates type/bounds/cross-field invariants (e.g.
  // min_bet <= max_bet, house edge band), and writes the value + audit row
  // atomically. Direct table writes are revoked, so a bad value can never be
  // saved silently. Returns a structured result for inline field state.
  const saveSetting = useCallback(async (key: string, value: string | number | boolean): Promise<{ ok: boolean; error?: string }> => {
    const { error } = await supabase.rpc('admin_set_setting', { p_key: key, p_value: value });
    if (error) return { ok: false, error: friendly(error.message) };
    setRows(rs => rs.map(r => (r.key === key ? { ...r, value, updated_at: new Date().toISOString() } : r)));
    return { ok: true };
  }, []);

  const isSystemTab = isPlatform && SYSTEM_TABS.includes(tab);

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Settings</h1>
          <p className="text-[13px] text-muted mt-1">
            {isPlatform ? 'Platform-wide game, finance and paybill settings, plus each brand\'s theme and staff.' : 'Your brand\'s theme and staff. Game and payment settings are managed by the platform owner.'}
            {' '}Every change is recorded in the <Link to="/admin/audit" className="text-brand hover:underline">audit log</Link>.
          </p>
        </div>

        <div className="border-b border-line">
          <nav className="flex gap-1 -mb-px overflow-x-auto" role="tablist" aria-label="Settings sections">
            {visible.map(({ k, label, icon: Icon }) => {
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
          <div role="alert" className="rounded-xl border border-down/30 bg-down/10 p-6 text-down text-sm">{loadErr}</div>
        )}

        {isSystemTab && !loadErr && (
          loading
            ? <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl border border-line bg-surface animate-pulse" />)}</div>
            : <SystemSettingsTab tab={tab as SettingsTabId} rows={rows} onSave={saveSetting} />
        )}

        {tab === 'theme' && <SiteThemePanel />}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'staff' && <StaffTab />}
      </div>
    </div>
  );
}
