import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Megaphone, Send, Plus, Trash2, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAdmin } from '../roleContext';

// Admin Notifications: broadcast an in-app message to an audience, and (for
// super admins) manage reusable templates. Server RPCs enforce site scoping
// (brand admins reach only their own brand; the platform owner reaches all).

const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';
const inputCls = 'w-full px-3 py-2.5 bg-canvas border border-line rounded-lg text-ink text-[13px] focus:outline-none focus:border-brand';
const labelCls = 'block text-[12px] font-medium text-muted mb-1.5';

interface Template {
  key: string; level: string; title: string; body: string; category: string;
  resolves_category: string | null; active: boolean; description: string | null;
}

const LEVELS = ['info', 'success', 'warning', 'error'];
const ERR: Record<string, string> = {
  FORBIDDEN: 'You do not have permission for this action.',
  INVALID_LEVEL: 'Pick a valid level.', INVALID_TITLE: 'Title must be 1–120 characters.',
  BODY_TOO_LONG: 'Body must be ≤ 1000 characters.', INVALID_KEY: 'Key: lowercase letters, numbers, . _ - (2–61 chars).',
  CATEGORY_REQUIRED: 'Category is required.', TEMPLATE_NOT_FOUND: 'Template not found.', NOT_FOUND: 'Not found.',
};
const friendly = (m?: string) => { if (!m) return 'Something went wrong.'; for (const k in ERR) if (m.includes(k)) return ERR[k]; return m; };

export default function NotificationsPage() {
  const { isSuperAdmin } = useAdmin();
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);

  // ---- Broadcast ----
  const [level, setLevel] = useState('info');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('');
  const [audience, setAudience] = useState<'active' | 'all'>('active');
  const [sending, setSending] = useState(false);

  async function broadcast(e: React.FormEvent) {
    e.preventDefault();
    setSending(true); setFlash(null);
    const aud = { status: audience === 'all' ? 'all' : 'active', roles: ['player'] };
    const { data, error } = await supabase.rpc('admin_broadcast_notification', {
      p_level: level, p_title: title.trim(), p_body: body, p_category: category.trim() || null,
      p_dismissible: true, p_audience: aud,
    });
    setSending(false);
    if (error) { setFlash({ ok: false, msg: friendly(error.message) }); return; }
    setFlash({ ok: true, msg: `Sent to ${data?.recipients ?? 0} player(s).` });
    setTitle(''); setBody(''); setCategory('');
  }

  // ---- Templates ----
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [showNew, setShowNew] = useState(false);

  const loadTemplates = useCallback(async () => {
    if (!isSuperAdmin) return;
    const { data } = await supabase.rpc('admin_list_notification_templates');
    setTemplates((data ?? []) as Template[]);
  }, [isSuperAdmin]);
  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  async function sendTemplate(key: string) {
    setFlash(null);
    const { data, error } = await supabase.rpc('admin_broadcast_from_template', { p_key: key });
    if (error) { setFlash({ ok: false, msg: friendly(error.message) }); return; }
    setFlash({ ok: true, msg: `Template "${key}" sent to ${data?.recipients ?? 0} player(s).` });
  }
  async function removeTemplate(key: string) {
    const { error } = await supabase.rpc('admin_delete_notification_template', { p_key: key });
    if (error) { setFlash({ ok: false, msg: friendly(error.message) }); return; }
    void loadTemplates();
  }

  return (
    <div className="w-full max-w-[1100px]">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-xl bg-brand/15 flex items-center justify-center">
          <Megaphone size={20} className="text-brand" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-ink tracking-tight">Notifications</h1>
          <p className="text-[13px] text-muted">Broadcast in-app messages to your players.</p>
        </div>
      </div>

      {flash && (
        <div className={`mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] border ${flash.ok ? 'bg-up/10 border-up/30 text-up' : 'bg-down/10 border-down/30 text-down'}`}>
          {flash.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />} {flash.msg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Broadcast */}
        <section className="bg-surface border border-line rounded-xl p-5">
          <span className={HEAD}>New broadcast</span>
          <form onSubmit={broadcast} className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Level</label>
                <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Audience</label>
                <select className={inputCls} value={audience} onChange={(e) => setAudience(e.target.value as 'active' | 'all')}>
                  <option value="active">Active players</option>
                  <option value="all">All players (incl. banned)</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Title <span className="text-faint">({title.length}/120)</span></label>
              <input className={inputCls} value={title} maxLength={120} required placeholder="e.g. Weekend bonus is live!" onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Body <span className="text-faint">({body.length}/1000)</span></label>
              <textarea className={inputCls + ' min-h-[80px] resize-y'} value={body} maxLength={1000} placeholder="Optional details…" onChange={(e) => setBody(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Category <span className="text-faint">(optional — dedupes & lets you clear later)</span></label>
              <input className={inputCls} value={category} placeholder="e.g. weekend_promo" onChange={(e) => setCategory(e.target.value)} />
            </div>
            <button type="submit" disabled={sending} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand/90 text-white text-[13px] font-medium transition disabled:opacity-50">
              <Send size={15} /> {sending ? 'Sending…' : 'Send broadcast'}
            </button>
          </form>
        </section>

        {/* Templates (super admin) */}
        {isSuperAdmin && (
          <section className="bg-surface border border-line rounded-xl p-5">
            <div className="flex items-center justify-between">
              <span className={HEAD}>Templates</span>
              <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink hover:border-brand text-[12px] transition">
                <Plus size={14} /> New
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {templates.length === 0 ? (
                <div className="text-[13px] text-muted py-6 text-center">No templates yet.</div>
              ) : templates.map((t) => (
                <div key={t.key} className="flex items-center gap-3 p-3 rounded-lg border border-line">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink truncate">{t.title} <span className="text-faint">· {t.key}</span></div>
                    <div className="text-[11px] text-muted">{t.level} · {t.category}{t.active ? '' : ' · inactive'}</div>
                  </div>
                  <button onClick={() => void sendTemplate(t.key)} className="px-2.5 py-1 rounded-md bg-brand/15 text-brand text-[12px] hover:bg-brand/25 transition">Send</button>
                  <button onClick={() => setEditing(t)} className="px-2 py-1 rounded-md border border-line text-muted hover:text-ink text-[12px] transition">Edit</button>
                  <button onClick={() => void removeTemplate(t.key)} aria-label="Delete" className="text-muted hover:text-down transition"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {(showNew || editing) && (
        <TemplateModal
          template={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onDone={() => { setShowNew(false); setEditing(null); void loadTemplates(); }}
          onError={(m) => setFlash({ ok: false, msg: m })}
        />
      )}
    </div>
  );
}

function TemplateModal({ template, onClose, onDone, onError }: {
  template: Template | null; onClose: () => void; onDone: () => void; onError: (m: string) => void;
}) {
  const [key, setKey] = useState(template?.key ?? '');
  const [level, setLevel] = useState(template?.level ?? 'info');
  const [title, setTitle] = useState(template?.title ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [category, setCategory] = useState(template?.category ?? '');
  const [resolves, setResolves] = useState(template?.resolves_category ?? '');
  const [active, setActive] = useState(template?.active ?? true);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.rpc('admin_upsert_notification_template', {
      p_key: key.trim(), p_level: level, p_title: title.trim(), p_body: body,
      p_category: category.trim(), p_dismissible: true,
      p_resolves_category: resolves.trim() || null, p_active: active,
    });
    setBusy(false);
    if (error) { onError(friendly(error.message)); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md bg-surface border border-line rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-semibold text-ink">{template ? 'Edit template' : 'New template'}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>
        <form onSubmit={save} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Key</label>
              <input className={inputCls} value={key} disabled={!!template} required placeholder="weekend_promo" onChange={(e) => setKey(e.target.value)} /></div>
            <div><label className={labelCls}>Level</label>
              <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></div>
          </div>
          <div><label className={labelCls}>Title</label><input className={inputCls} value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label className={labelCls}>Body</label><textarea className={inputCls + ' min-h-[70px]'} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Category</label><input className={inputCls} value={category} required onChange={(e) => setCategory(e.target.value)} /></div>
            <div><label className={labelCls}>Resolves category</label><input className={inputCls} value={resolves} placeholder="(optional)" onChange={(e) => setResolves(e.target.value)} /></div>
          </div>
          <label className="flex items-center justify-between py-2 px-3 rounded-lg bg-canvas border border-line cursor-pointer">
            <span className="text-[13px] text-ink">Active</span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-brand" />
          </label>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-line text-muted hover:text-ink text-[13px] transition">Cancel</button>
            <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-lg bg-brand hover:bg-brand/90 text-white font-medium text-[13px] transition disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
