import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getAdminProfile } from '../AdminGuard';

export default function SettingsPage() {
  const [settings, setSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('system_settings').select('*').order('key');
      setSettings(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  async function updateSetting(key: string, newValue: string) {
    const admin = getAdminProfile();
    await supabase.from('system_settings').update({
      value: newValue,
      updated_by: admin?.id,
      updated_at: new Date().toISOString(),
    }).eq('key', key);

    setSettings(prev => prev.map(s => s.key === key ? { ...s, value: newValue } : s));

    if (admin) {
      await supabase.from('admin_audit_log').insert({
        admin_id: admin.id,
        action: 'setting_updated',
        target_type: 'setting',
        target_id: key,
        details: { new_value: newValue },
      });
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-white text-xl font-bold">System Settings</h1>

      <div className="bg-[#1a1a2e] border border-[#2a2a45] rounded-xl divide-y divide-[#2a2a45]">
        {loading ? (
          <div className="p-6 text-center text-slate-500 text-sm">Loading...</div>
        ) : settings.map((s) => (
          <div key={s.key} className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-white text-sm font-medium">{s.key}</div>
              {s.description && <div className="text-slate-500 text-[10px] mt-0.5">{s.description}</div>}
            </div>
            <input
              type="text"
              defaultValue={typeof s.value === 'string' ? s.value : JSON.stringify(s.value)}
              onBlur={(e) => {
                const val = e.target.value;
                if (val !== String(s.value)) updateSetting(s.key, val);
              }}
              className="bg-[#0d0d1a] border border-[#2a2a45] rounded px-3 py-1.5 text-white text-sm w-32 text-right focus:outline-none focus:border-[#c8001c]/50"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
