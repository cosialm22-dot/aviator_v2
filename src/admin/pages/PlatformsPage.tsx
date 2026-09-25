import { useCallback, useEffect, useState } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorState, Field, Modal, Notice, PageHeader, SearchInput, Select, Skeleton, inputCls } from '../ui/kit';
import { ROLE_LABEL } from '../ui/format';
import { brandError, findUsers, listPlatforms, setPlatformAdmin, upsertPlatform, type FoundUser, type Platform } from '../brand/api';

// ============================================================================
// Platforms (System owner) — invest254's platform tier: a platform is a group of brands run by its
// own platform admins (look, domains, payments, staff of ITS brands; never the shared engine).
// ============================================================================
export default function PlatformsPage() {
  const [rows, setRows] = useState<Platform[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Platform | 'new' | null>(null);
  const [addTo, setAddTo] = useState<Platform | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const load = useCallback(async () => { setErr(null); try { setRows(await listPlatforms()); } catch (e) { setErr(brandError(e)); } }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-5">
      <PageHeader title="Platforms" subtitle="Groups of brands run by their own platform admins."
        actions={<Button variant="primary" onClick={() => setEdit('new')} data-testid="new-platform"><Plus size={14} />New platform</Button>} />
      {msg && <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {err ? <ErrorState message={err} onRetry={load} /> : !rows ? <Skeleton className="h-32 w-full" />
        : rows.length === 0 ? <Empty title="No platforms yet" body="Every brand is run by the System until you create a platform and move brands into it." />
        : rows.map((p) => (
          <Card key={p.id} testId={`platform-${p.slug}`} title={p.name} action={<div className="flex items-center gap-2"><Badge tone={p.status === 'active' ? 'up' : 'warn'}>{p.status}</Badge><Button size="sm" onClick={() => setEdit(p)}>Edit</Button></div>}>
            <div className="flex flex-wrap gap-6 text-[13px]">
              <div><div className="text-faint">Brands</div><div className="tabular-nums text-ink">{p.brands}</div></div>
              <div><div className="text-faint">Address name</div><div className="font-mono text-ink">{p.slug}</div></div>
            </div>
            {p.notes && <p className="mt-2 text-[12px] text-muted">{p.notes}</p>}
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-medium text-ink">Platform admins</span>
                <Button size="sm" onClick={() => setAddTo(p)}><UserPlus size={13} />Add</Button></div>
              {p.admins.length === 0 ? <p className="text-[12px] text-faint">None yet.</p> : (
                <ul className="divide-y divide-line/60">{p.admins.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-1.5">
                    <span className="flex-1 text-[13px] text-ink">{a.username}</span>
                    <ConfirmButton confirmLabel="Remove" onConfirm={async () => { try { await setPlatformAdmin(a.id, null); setMsg({ tone: 'ok', text: `${a.username} is no longer a platform admin.` }); await load(); } catch (e) { setMsg({ tone: 'error', text: brandError(e) }); } }}>Remove</ConfirmButton>
                  </li>))}</ul>
              )}
            </div>
          </Card>
        ))}
      {edit && <PlatformModal p={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void load(); }} />}
      {addTo && <AddAdmin p={addTo} onClose={() => setAddTo(null)} onDone={(t) => { setAddTo(null); setMsg({ tone: 'ok', text: t }); void load(); }} />}
    </div>
  );
}

function PlatformModal({ p, onClose, onDone }: { p: Platform | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(p?.name ?? '');
  const [slug, setSlug] = useState(p?.slug ?? '');
  const [status, setStatus] = useState(p?.status ?? 'active');
  const [notes, setNotes] = useState(p?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={p ? 'Edit platform' : 'New platform'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} data-testid="platform-save"
        onClick={async () => { setBusy(true); setErr(null); try { await upsertPlatform({ id: p?.id, slug, name, status, notes: notes || null }); onDone(); } catch (e) { setErr(brandError(e)); setBusy(false); } }}>Save</Button></>}>
      {err && <Notice tone="error">{err}</Notice>}
      <Field label="Name"><input value={name} onChange={(e) => { setName(e.target.value); if (!p) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')); }} className={inputCls} maxLength={80} data-testid="platform-name" /></Field>
      <Field label="Address name"><input value={slug} onChange={(e) => setSlug(e.target.value)} className={`${inputCls} font-mono`} maxLength={40} /></Field>
      <Field label="Status"><Select value={status} onChange={setStatus} label="Status" className="w-full" options={[{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} /></Field>
      <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} maxLength={200} /></Field>
    </Modal>
  );
}

function AddAdmin({ p, onClose, onDone }: { p: Platform; onClose: () => void; onDone: (msg: string) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<FoundUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    let live = true;
    const t = setTimeout(() => { findUsers(q).then((r) => { if (live) setRows(r); }).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return (
    <Modal title={`Add a platform admin to ${p.name}`} subtitle="They will run this platform's brands. They can never see or steer the shared game." onClose={onClose}>
      {err && <Notice tone="error">{err}</Notice>}
      <SearchInput value={q} onChange={setQ} placeholder="Find by name or phone" label="Find user" />
      <ul className="divide-y divide-line/60">
        {rows.map((u) => (
          <li key={u.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 text-[13px] text-ink">{u.username} <Badge>{ROLE_LABEL[u.role] ?? u.role}</Badge></span>
            <Button size="sm" disabled={u.role === 'marketer'} title={u.role === 'marketer' ? 'Remove the marketer role first' : undefined}
              onClick={async () => { try { await setPlatformAdmin(u.id, p.id); onDone(`${u.username} is now a platform admin of ${p.name}.`); } catch (e) { setErr(brandError(e)); } }}>Make platform admin</Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
