import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { Badge, Button, Card, Detail, ErrorState, Notice, PageHeader, Select, Skeleton, Tabs, inputCls } from '../ui/kit';
import { dateTime, num } from '../ui/format';
import { useAdmin } from '../roleContext';
import { useBrandDraft } from '../brand/useBrandDraft';
import BrandPreview from '../brand/BrandPreview';
import LookEditor from '../brand/LookEditor';
import PlaneEditor from '../brand/PlaneEditor';
import ContentEditor from '../brand/ContentEditor';
import PeopleTab from '../brand/PeopleTab';
import HistoryTab from '../brand/HistoryTab';
import DomainsTab from '../brand/DomainsTab';
import PaymentsTab from '../brand/PaymentsTab';
import { SettingsGrid } from '../brand/SettingField';
import type { Identity } from '../brand/api';

// ============================================================================
// Brand console — one brand, every setting (invest254's ClientDetail, for a crash game).
// Tabs edit one shared draft; the save bar sends everything in one versioned save. The phone on
// the right shows the draft live, as a player and as a marketer streaming.
// ============================================================================

type Tab = 'overview' | 'look' | 'plane' | 'content' | 'features' | 'limits' | 'payments' | 'domains' | 'legal' | 'people' | 'history';
const STATUS_TONE: Record<string, string> = { active: 'up', suspended: 'warn', disabled: 'down' };
const APP_ORIGIN = 'https://aviatorv2.cosialm22.workers.dev';

export default function BrandDetailPage() {
  const { siteId } = useParams();
  const me = useAdmin();
  const draft = useBrandDraft(siteId);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => setParams((p) => { p.set('tab', t); return p; }, { replace: true });
  const [note, setNote] = useState('');
  const [saveMsg, setSaveMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string; conflict?: boolean } | null>(null);

  // Unsaved work: warn before leaving the page.
  const dirty = draft.changes.length;
  // A success note fades after a few seconds; any new edit clears an old note.
  useEffect(() => { if (saveMsg?.tone !== 'ok') return; const t = setTimeout(() => setSaveMsg(null), 4000); return () => clearTimeout(t); }, [saveMsg]);
  useEffect(() => { if (dirty) setSaveMsg((m) => (m?.tone === 'ok' ? null : m)); }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const doc = draft.doc;
  const siteUrl = useMemo(() => {
    const primary = doc?.domains.find((d) => d.is_primary)?.hostname;
    return primary ? `https://${primary}/` : `${APP_ORIGIN}/?brand=${doc?.slug ?? ''}`;
  }, [doc]);

  if (draft.error) return <ErrorState message={draft.error} onRetry={draft.reload} />;
  if (draft.loading && !doc) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!doc || !draft.identity) return null;

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' }, { value: 'look', label: 'Look' }, { value: 'plane', label: 'Plane & bird' },
    { value: 'content', label: 'Content' }, { value: 'features', label: 'Features' }, { value: 'limits', label: 'Limits & bonuses' },
    { value: 'payments', label: 'Payments' }, { value: 'domains', label: 'Domains' }, { value: 'legal', label: 'Legal' },
    { value: 'people', label: 'People' }, { value: 'history', label: 'History' },
  ];

  const save = async () => {
    setSaveMsg(null);
    const r = await draft.save(note.trim() || undefined);
    if (r.ok) { setNote(''); setSaveMsg({ tone: 'ok', text: 'Saved. Open pages update within seconds.' }); }
    else setSaveMsg({ tone: r.conflict ? 'warn' : 'error', text: r.message, conflict: r.conflict });
  };

  return (
    <div>
      <Link to="/admin/brands" className="mb-2 inline-flex items-center gap-0.5 text-[13px] text-brand hover:underline"><ChevronLeft size={15} />Brands</Link>
      <PageHeader
        title={draft.identity.name || doc.slug}
        eyebrow={<span className="inline-flex items-center gap-2"><span className="font-mono">{doc.slug}</span><Badge tone={STATUS_TONE[draft.identity.status]}>{draft.identity.status}</Badge><span className="tabular-nums text-faint">v{doc.version}</span></span>}
        subtitle={doc.platform_name ? `Platform: ${doc.platform_name}` : undefined}
        actions={<a href={siteUrl} target="_blank" rel="noreferrer"><Button><ExternalLink size={14} />Open site</Button></a>}
      />

      <div className="mt-4 flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          <Tabs tabs={tabs} value={tab} onChange={setTab} label="Brand sections" />

          {tab === 'overview' && (
            <div className="space-y-5">
              <Card title="Status">
                <div className="flex flex-wrap items-center gap-3">
                  <Select value={draft.identity.status} label="Status" onChange={(s) => draft.setIdentity('status', s as Identity['status'])}
                    options={[{ value: 'active', label: 'Active — open to players' }, { value: 'suspended', label: 'Suspended — shows a notice' }, { value: 'disabled', label: 'Disabled' }]} />
                  {!doc.can.platform && <span className="text-[12px] text-faint">Only the platform can change the status.</span>}
                </div>
              </Card>
              <Card title="At a glance">
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Detail k="Players" v={num(doc.players)} />
                  <Detail k="Brand marketer" v={doc.default_marketer?.username ?? '—'} />
                  <Detail k="Domain" v={doc.domains.find((d) => d.is_primary)?.hostname ?? 'Not set'} />
                  <Detail k="Created" v={dateTime(doc.created_at)} />
                  <Detail k="Plane" v={String(draft.value('plane.model'))} />
                  <Detail k="Streamer bird" v={String(draft.value('stream.bird'))} />
                  <Detail k="Last saved" v={dateTime(doc.updated_at)} />
                  <Detail k="Preview" v={<a className="text-brand hover:underline" href={`${APP_ORIGIN}/?brand=${doc.slug}`} target="_blank" rel="noreferrer">?brand={doc.slug}</a>} />
                </dl>
              </Card>
              {draft.value('features.maintenance') === true && <Notice tone="warn">Maintenance is on for this brand: bets, deposits and withdrawals are paused.</Notice>}
            </div>
          )}
          {tab === 'look' && <LookEditor draft={draft} />}
          {tab === 'plane' && <PlaneEditor draft={draft} />}
          {tab === 'content' && <ContentEditor draft={draft} only="content" />}
          {tab === 'legal' && <ContentEditor draft={draft} only="legal" />}
          {tab === 'features' && <Card title="Features"><SettingsGrid draft={draft} sections={['features']} /></Card>}
          {tab === 'limits' && (
            <div className="space-y-5">
              <Card title="Limits"><SettingsGrid draft={draft} sections={['limits']} /></Card>
              <Card title="Bonuses"><SettingsGrid draft={draft} sections={['bonus']} /></Card>
            </div>
          )}
          {tab === 'payments' && <PaymentsTab draft={draft} />}
          {tab === 'domains' && <DomainsTab draft={draft} />}
          {tab === 'people' && <PeopleTab draft={draft} siteUrl={siteUrl} />}
          {tab === 'history' && <HistoryTab draft={draft} />}
        </div>

        <aside className="xl:sticky xl:top-4 xl:w-[330px] xl:shrink-0">
          <BrandPreview tokens={draft.tokens} value={draft.value} name={draft.identity.name} wordmark={draft.identity.wordmark_text} logoUrl={draft.identity.logo_url} />
        </aside>
      </div>

      {(dirty > 0 || saveMsg) && (
        <div className="sticky bottom-0 z-40 -mx-4 mt-6 border-t border-line bg-surface/95 backdrop-blur-xl sm:-mx-6" data-testid="save-bar">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
            {saveMsg && <span className={`text-[13px] ${saveMsg.tone === 'ok' ? 'text-up' : saveMsg.tone === 'warn' ? 'text-warn' : 'text-down'}`} role="status">{saveMsg.text}</span>}
            {saveMsg?.conflict && <Button size="sm" onClick={() => { setSaveMsg(null); void draft.reload(); }}>Reload</Button>}
            {dirty > 0 && (
              <>
                <details className="text-[13px] text-muted">
                  <summary className="cursor-pointer select-none">{dirty} unsaved change{dirty === 1 ? '' : 's'}</summary>
                  <ul className="mt-1 max-h-40 overflow-y-auto text-[12px]">{draft.changes.map((c) => <li key={c.path}>{c.label}</li>)}</ul>
                </details>
                <span className="flex-1" />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Change note" maxLength={120} className={`${inputCls} max-w-[220px]`} />
                <Button variant="ghost" onClick={() => { draft.discard(); setSaveMsg(null); }}>Discard</Button>
                <Button variant="primary" loading={draft.saving} onClick={save} data-testid="save-brand">Save</Button>
              </>
            )}
            {dirty === 0 && <span className="flex-1" />}
            {dirty === 0 && <Button size="sm" variant="ghost" onClick={() => setSaveMsg(null)}>Dismiss</Button>}
          </div>
        </div>
      )}
      {me.role === 'super_admin' && tab === 'overview' && <p className="mt-6 text-[12px] text-faint">You can edit this brand's words, contacts, SEO and legal pages. Look, plane, features, limits and payments are set by the platform.</p>}
    </div>
  );
}
