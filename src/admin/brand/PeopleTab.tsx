import { useEffect, useState } from 'react';
import { Copy, UserPlus } from 'lucide-react';
import { Badge, Button, Card, ConfirmButton, Notice, SearchInput, Select } from '../ui/kit';
import { ROLE_LABEL, maskPhone } from '../ui/format';
import { useAdmin } from '../roleContext';
import { assignMarketer, brandError, findUsers, listPlatforms, setRole, setSitePlatform, type FoundUser, type Platform } from './api';
import type { BrandDraft } from './useBrandDraft';

// People: the marketer who owns this brand's audience, the brand's staff, and (owner) which
// platform the brand belongs to.

function useUserSearch() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<FoundUser[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => { findUsers(q).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); }).finally(() => { if (live) setBusy(false); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return { q, setQ, rows, busy };
}

export default function PeopleTab({ draft, siteUrl }: { draft: BrandDraft; siteUrl: string }) {
  const me = useAdmin();
  const doc = draft.doc!;
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const mk = useUserSearch();
  const staff = useUserSearch();
  const [newRole, setNewRole] = useState('support');
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  useEffect(() => { if (me.isPlatform) listPlatforms().then(setPlatforms).catch(() => {}); }, [me.isPlatform]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ tone: 'ok', text: ok }); await draft.reload(); } catch (e) { setMsg({ tone: 'error', text: brandError(e) }); }
  };
  const refLink = doc.default_marketer?.referral_code ? `${siteUrl}${siteUrl.includes('?') ? '&' : '?'}ref=${doc.default_marketer.referral_code}` : null;
  const roleOptions = ['support', 'finance_admin', 'admin', ...(me.isPlatformTier ? ['super_admin'] : [])];

  return (
    <div className="space-y-5">
      {msg && <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <Card title="Brand marketer" action={<span className="text-[12px] text-muted">Owns this site's audience; streams it live</span>}>
        {doc.default_marketer ? (
          <div className="flex flex-wrap items-center gap-3" data-testid="brand-marketer">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-raised text-[13px] font-semibold text-ink">{doc.default_marketer.username[0]?.toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-ink">{doc.default_marketer.username}</div>
              <div className="text-[12px] text-faint">{maskPhone(doc.default_marketer.phone)} · players who arrive without a link are credited to them</div>
            </div>
            {refLink && <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(refLink); setMsg({ tone: 'ok', text: 'Referral link copied.' }); }}><Copy size={13} />Copy referral link</Button>}
            {doc.can.platform && <ConfirmButton confirmLabel="Remove" onConfirm={() => run(() => assignMarketer(doc.site_id, null), 'Marketer removed from this brand.')}>Remove</ConfirmButton>}
          </div>
        ) : <p className="text-[13px] text-muted">No marketer yet.</p>}
        {doc.can.platform && (
          <div className="mt-4 border-t border-line pt-4">
            <SearchInput value={mk.q} onChange={mk.setQ} placeholder="Find a marketer or player by name or phone" label="Find marketer" />
            <ul className="mt-2 divide-y divide-line/60">
              {mk.rows.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-ink">{u.username} <Badge>{ROLE_LABEL[u.role] ?? u.role}</Badge></div>
                    <div className="text-[12px] text-faint">{u.site_name ?? '—'}{u.owns_brand ? ` · owns ${u.owns_brand}` : ''}{u.referred_players ? ` · ${u.referred_players} players` : ''}</div>
                  </div>
                  <Button size="sm" disabled={!['marketer', 'player'].includes(u.role)} onClick={() => run(() => assignMarketer(doc.site_id, u.id), `${u.username} now owns this brand's audience.`)}>Make brand marketer</Button>
                </li>
              ))}
              {mk.q.trim().length >= 2 && !mk.busy && mk.rows.length === 0 && <li className="py-2 text-[13px] text-muted">No one found.</li>}
            </ul>
          </div>
        )}
        {doc.marketers.length > 1 && <p className="mt-3 text-[12px] text-faint">Other marketers on this brand: {doc.marketers.filter((m) => m.id !== doc.default_marketer?.id).map((m) => m.username).join(', ')}</p>}
      </Card>

      <Card title="Staff" pad={false}>
        <ul className="divide-y divide-line/60">
          {doc.staff.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.username}</span>
              {me.isSuperAdmin && s.id !== me.userId && (s.role !== 'super_admin' || me.isPlatformTier) ? (
                <Select value={s.role} label={`Role of ${s.username}`} onChange={(r) => run(() => setRole(s.id, r), `${s.username} is now ${ROLE_LABEL[r]}.`)}
                  options={[...new Set([s.role, ...roleOptions, 'player'])].map((r) => ({ value: r, label: r === 'player' ? 'Remove from staff' : ROLE_LABEL[r] ?? r }))} />
              ) : <Badge>{ROLE_LABEL[s.role] ?? s.role}</Badge>}
            </li>
          ))}
          {doc.staff.length === 0 && <li className="px-4 py-3 text-[13px] text-muted">No staff on this brand yet.</li>}
        </ul>
        {me.isSuperAdmin && (
          <div className="border-t border-line p-4">
            <div className="flex flex-wrap gap-2">
              <SearchInput value={staff.q} onChange={staff.setQ} placeholder="Add someone from this brand" label="Find staff" className="min-w-[220px] flex-1" />
              <Select value={newRole} onChange={setNewRole} label="Role" options={roleOptions.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            </div>
            <ul className="mt-2 divide-y divide-line/60">
              {staff.rows.filter((u) => u.site_id === doc.site_id).map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 text-[13px] text-ink">{u.username} <Badge>{ROLE_LABEL[u.role] ?? u.role}</Badge></span>
                  <Button size="sm" onClick={() => run(() => setRole(u.id, newRole), `${u.username} is now ${ROLE_LABEL[newRole]}.`)}><UserPlus size={13} />Add as {ROLE_LABEL[newRole]}</Button>
                </li>
              ))}
            </ul>
            {!me.isPlatformTier && <p className="mt-2 text-[12px] text-faint">Search is available to the platform. Brand owners add staff from Settings → Staff.</p>}
          </div>
        )}
      </Card>

      {me.isPlatform && (
        <Card title="Platform">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={doc.platform_id ?? ''} label="Platform" onChange={(p) => run(() => setSitePlatform(doc.site_id, p || null), p ? 'Brand moved to the platform.' : 'Brand is now run by the System.')}
              options={[{ value: '', label: 'System (no platform)' }, ...platforms.map((p) => ({ value: p.id, label: p.name }))]} />
            <span className="text-[12px] text-faint">A platform's admins run its brands: look, domains, payments and staff.</span>
          </div>
        </Card>
      )}
    </div>
  );
}
