import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import { Send, Plus, Trash2 } from 'lucide-react';
import { useAdmin } from '../roleContext';
import { Button, Card, Empty, Modal, Notice, PageHeader, Select, Switch, inputCls } from '../ui/kit';

// Admin Notifications: broadcast an in-app message to an audience, and (for
// super admins) manage reusable templates. Server RPCs enforce site scoping
// (brand admins reach only their own brand; the platform owner reaches all).

const areaCls = inputCls.replace('h-9 ', '') + ' py-2 resize-y';

/** Form row: a label (which may carry a faint qualifier) above its control. */
function FormField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

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
    <>
      <PageHeader title="Notifications" subtitle="Broadcast in-app messages to your players." />

      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.msg}</Notice>}

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        {/* Broadcast */}
        <Card title="New broadcast">
          <form onSubmit={broadcast} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Level">
                <Select label="Level" className="h-9 w-full" value={level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l, label: l }))} />
              </FormField>
              <FormField label="Audience">
                <Select<'active' | 'all'> label="Audience" className="h-9 w-full" value={audience} onChange={setAudience}
                  options={[{ value: 'active', label: 'Active players' }, { value: 'all', label: 'All players (incl. banned)' }]} />
              </FormField>
            </div>
            <FormField label={<>Title <span className="font-normal tabular-nums text-faint">({title.length}/120)</span></>}>
              <input className={inputCls} value={title} maxLength={120} required placeholder="e.g. Weekend bonus is live!" onChange={(e) => setTitle(e.target.value)} />
            </FormField>
            <FormField label={<>Body <span className="font-normal tabular-nums text-faint">({body.length}/1000)</span></>}>
              <textarea className={areaCls + ' min-h-[80px]'} value={body} maxLength={1000} placeholder="Optional details…" onChange={(e) => setBody(e.target.value)} />
            </FormField>
            <FormField label={<>Category <span className="font-normal text-faint">(optional — dedupes & lets you clear later)</span></>}>
              <input className={inputCls + ' font-mono text-[12px]'} value={category} placeholder="e.g. weekend_promo" onChange={(e) => setCategory(e.target.value)} />
            </FormField>
            <Button type="submit" variant="primary" disabled={sending}>
              <Send size={14} /> {sending ? 'Sending…' : 'Send broadcast'}
            </Button>
          </form>
        </Card>

        {/* Templates (super admin) */}
        {isSuperAdmin && (
          <Card title="Templates" action={<Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} /> New</Button>}>
            {templates.length === 0 ? (
              <Empty title="No templates yet." />
            ) : (
              <ul className="-mb-2 divide-y divide-line">
                {templates.map((t) => (
                  <li key={t.key} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink">{t.title} <span className="font-mono text-[12px] font-normal text-faint">· {t.key}</span></div>
                      <div className="text-[12px] text-muted">{t.level} · {t.category}{t.active ? '' : ' · inactive'}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void sendTemplate(t.key)}>Send</Button>
                    <Button size="sm" onClick={() => setEditing(t)}>Edit</Button>
                    <button onClick={() => void removeTemplate(t.key)} aria-label="Delete" className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-ink"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
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
    </>
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
    <Modal title={template ? 'Edit template' : 'New template'} onClose={onClose} width={440}
      footer={<>
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="notification-template" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}>
      <form id="notification-template" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Key">
            <input className={inputCls + ' font-mono text-[12px] disabled:opacity-50'} value={key} disabled={!!template} required placeholder="weekend_promo" onChange={(e) => setKey(e.target.value)} />
          </FormField>
          <FormField label="Level">
            <Select label="Level" className="h-9 w-full" value={level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l, label: l }))} />
          </FormField>
        </div>
        <FormField label="Title"><input className={inputCls} value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} /></FormField>
        <FormField label="Body"><textarea className={areaCls + ' min-h-[72px]'} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Category"><input className={inputCls + ' font-mono text-[12px]'} value={category} required onChange={(e) => setCategory(e.target.value)} /></FormField>
          <FormField label="Resolves category"><input className={inputCls + ' font-mono text-[12px]'} value={resolves} placeholder="(optional)" onChange={(e) => setResolves(e.target.value)} /></FormField>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-raised px-3 py-2">
          <span className="text-[13px] text-ink">Active</span>
          <Switch checked={active} onChange={setActive} label="Active" />
        </div>
      </form>
    </Modal>
  );
}
