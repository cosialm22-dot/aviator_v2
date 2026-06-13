import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Setting {
  key: string;
  value: unknown;
  category: string;
  description: string | null;
  updated_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: unknown;
  created_at: string;
  profiles?: { username: string } | null;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'settings' | 'audit'>('settings');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const [settingsRes, auditRes] = await Promise.all([
      supabase.from('system_settings').select('*').order('key'),
      supabase.from('admin_audit_log')
        .select('id, action, target_type, target_id, details, created_at, profiles:admin_id(username)')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    const s = (settingsRes.data ?? []) as Setting[];
    setSettings(s);
    setEditValues(Object.fromEntries(s.map(x => [x.key, typeof x.value === 'string' ? x.value : JSON.stringify(x.value)])));
    setAuditLog((auditRes.data ?? []) as unknown as AuditEntry[]);
    setLoading(false);
  }

  async function saveSetting(key: string) {
    const newValue = editValues[key];
    const original = settings.find(s => s.key === key);
    if (!original || String(original.value) === newValue) return;

    setSaving(key);
    const { data: { session } } = await supabase.auth.getSession();

    // Parse value - try as number first, then boolean, then string
    let parsedValue: string | number | boolean = newValue;
    if (newValue === 'true') parsedValue = true;
    else if (newValue === 'false') parsedValue = false;
    else if (!isNaN(Number(newValue)) && newValue.trim() !== '') parsedValue = Number(newValue);

    await supabase.from('system_settings').update({
      value: parsedValue,
      updated_by: session?.user.id,
      updated_at: new Date().toISOString(),
    }).eq('key', key);

    // Audit log
    if (session) {
      await supabase.from('admin_audit_log').insert({
        admin_id: session.user.id,
        action: 'setting_updated',
        target_type: 'setting',
        target_id: key,
        details: { old_value: original.value, new_value: parsedValue },
      });
    }

    setSaving(null);
    fetchData();
  }

  function resetSetting(key: string) {
    const original = settings.find(s => s.key === key);
    if (original) {
      setEditValues(prev => ({ ...prev, [key]: typeof original.value === 'string' ? original.value : JSON.stringify(original.value) }));
    }
  }

  const categories = [...new Set(settings.map(s => s.category))];

  if (loading) {
    return (
      <div className="-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)] space-y-4">
        {[...Array(6)].map((_, i) => <div key={i} className="h-14 rounded-xl border border-line bg-surface animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]">
      <div className="space-y-6">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Settings</h1>
          <p className="text-[13px] text-muted mt-1">System configuration and audit trail</p>
        </div>

        {/* Tabs (segmented, text-only) */}
        <div className="inline-flex gap-1 bg-slate-100 border border-line rounded-lg p-1">
          <button onClick={() => setActiveTab('settings')} className={'px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors ' + (activeTab === 'settings' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>Settings</button>
          <button onClick={() => setActiveTab('audit')} className={'px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors ' + (activeTab === 'audit' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>Audit Log ({auditLog.length})</button>
        </div>

        {activeTab === 'settings' && (
          <div className="space-y-6">
            {categories.map(category => (
              <div key={category} className="rounded-xl border border-line bg-surface overflow-hidden">
                <div className="px-5 py-3.5 border-b border-line">
                  <h3 className="text-[11px] font-semibold text-muted uppercase tracking-[0.1em] capitalize">{category}</h3>
                </div>
                <div className="divide-y divide-line">
                  {settings.filter(s => s.category === category).map(setting => {
                    const hasChanged = editValues[setting.key] !== (typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value));
                    return (
                      <div key={setting.key} className="px-5 py-4 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] text-ink font-medium font-mono">{setting.key}</div>
                          {setting.description && <div className="text-[11px] text-muted mt-0.5">{setting.description}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editValues[setting.key] ?? ''}
                            onChange={e => setEditValues(prev => ({ ...prev, [setting.key]: e.target.value }))}
                            className={'w-28 px-3 py-1.5 bg-surface border rounded-lg text-sm text-right text-ink font-mono focus:outline-none transition ' + (hasChanged ? 'border-brand/50 ring-1 ring-brand/20' : 'border-line')}
                          />
                          {hasChanged && (
                            <>
                              <button onClick={() => saveSetting(setting.key)} disabled={saving === setting.key} className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-brand text-white hover:bg-brand-dark transition-colors disabled:opacity-50">Save</button>
                              <button onClick={() => resetSetting(setting.key)} className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-line text-muted hover:text-ink transition-colors">Reset</button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
                    <th className="text-left px-5 py-3 font-medium">Admin</th>
                    <th className="text-left px-5 py-3 font-medium">Action</th>
                    <th className="text-left px-5 py-3 font-medium">Target</th>
                    <th className="text-left px-5 py-3 font-medium">Details</th>
                    <th className="text-left px-5 py-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {auditLog.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-12 text-center text-faint">No audit entries yet</td></tr>
                  ) : auditLog.map(entry => (
                    <tr key={entry.id}>
                      <td className="px-5 py-3 text-ink font-medium">{entry.profiles?.username ?? 'System'}</td>
                      <td className="px-5 py-3"><span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-mono text-muted">{entry.action}</span></td>
                      <td className="px-5 py-3 text-muted text-xs">{entry.target_type && `${entry.target_type}: ${entry.target_id?.slice(0, 8) ?? '-'}`}</td>
                      <td className="px-5 py-3 text-muted text-xs max-w-[200px] truncate font-mono">{entry.details ? JSON.stringify(entry.details).slice(0, 60) : '-'}</td>
                      <td className="px-5 py-3 text-muted text-xs whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
