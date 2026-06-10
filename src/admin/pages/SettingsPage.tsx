import { useState, useEffect } from 'react';
import { Save, RotateCcw, Shield, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Setting {
  key: string;
  value: any;
  category: string;
  description: string | null;
  updated_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: any;
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
    setAuditLog((auditRes.data ?? []) as AuditEntry[]);
    setLoading(false);
  }

  async function saveSetting(key: string) {
    const newValue = editValues[key];
    const original = settings.find(s => s.key === key);
    if (!original || String(original.value) === newValue) return;

    setSaving(key);
    const { data: { session } } = await supabase.auth.getSession();

    // Parse value - try as number first, then boolean, then string
    let parsedValue: any = newValue;
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
    return <div className="animate-pulse space-y-4">{[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-[#111122] rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">System configuration and audit trail</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#111122] border border-[#1e1e35] rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'settings' ? 'bg-[#1e1e35] text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <span className="flex items-center gap-2"><Shield size={14} /> Settings</span>
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'audit' ? 'bg-[#1e1e35] text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <span className="flex items-center gap-2"><Clock size={14} /> Audit Log ({auditLog.length})</span>
        </button>
      </div>

      {activeTab === 'settings' && (
        <div className="space-y-6">
          {categories.map(category => (
            <div key={category} className="bg-[#111122] border border-[#1e1e35] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1e1e35]">
                <h3 className="text-sm font-semibold text-white capitalize">{category}</h3>
              </div>
              <div className="divide-y divide-[#1e1e35]/50">
                {settings.filter(s => s.category === category).map(setting => {
                  const hasChanged = editValues[setting.key] !== (typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value));
                  return (
                    <div key={setting.key} className="px-5 py-4 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-white font-medium font-mono">{setting.key}</div>
                        {setting.description && <div className="text-[11px] text-slate-500 mt-0.5">{setting.description}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editValues[setting.key] ?? ''}
                          onChange={e => setEditValues(prev => ({ ...prev, [setting.key]: e.target.value }))}
                          className={`w-28 px-3 py-1.5 bg-[#0a0a14] border rounded-lg text-sm text-right text-white font-mono focus:outline-none transition ${
                            hasChanged ? 'border-[#c8001c]/50 ring-1 ring-[#c8001c]/20' : 'border-[#2a2a45]'
                          }`}
                        />
                        {hasChanged && (
                          <>
                            <button
                              onClick={() => saveSetting(setting.key)}
                              disabled={saving === setting.key}
                              className="p-1.5 bg-green-500/10 border border-green-500/30 rounded text-green-400 hover:bg-green-500/20 transition disabled:opacity-50"
                              title="Save"
                            >
                              <Save size={12} />
                            </button>
                            <button
                              onClick={() => resetSetting(setting.key)}
                              className="p-1.5 bg-slate-500/10 border border-slate-500/30 rounded text-slate-400 hover:bg-slate-500/20 transition"
                              title="Reset"
                            >
                              <RotateCcw size={12} />
                            </button>
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
        <div className="bg-[#111122] border border-[#1e1e35] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-[#1e1e35]">
                  <th className="text-left px-5 py-3 font-medium">Admin</th>
                  <th className="text-left px-5 py-3 font-medium">Action</th>
                  <th className="text-left px-5 py-3 font-medium">Target</th>
                  <th className="text-left px-5 py-3 font-medium">Details</th>
                  <th className="text-left px-5 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-600">No audit entries yet</td></tr>
                ) : auditLog.map(entry => (
                  <tr key={entry.id} className="border-b border-[#1e1e35]/50">
                    <td className="px-5 py-3 text-white font-medium">
                      {(entry.profiles as any)?.username ?? 'System'}
                    </td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 bg-[#1a1a2e] rounded text-[10px] font-mono text-slate-300">
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {entry.target_type && `${entry.target_type}: ${entry.target_id?.slice(0, 8) ?? '-'}`}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs max-w-[200px] truncate font-mono">
                      {entry.details ? JSON.stringify(entry.details).slice(0, 60) : '-'}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
