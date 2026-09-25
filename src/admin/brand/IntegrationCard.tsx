import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Badge, Button, Card, ConfirmButton, Field, Notice, Select, Switch, inputCls } from '../ui/kit';
import { relTime } from '../ui/format';
import { brandError } from './api';
import { deleteIntegration, saveIntegration, type CatalogEntry, type Integration } from './domainsApi';

// One provider account at one scope, drawn from the server's catalog (admin_integrations):
// settings as fields, secrets as write-only inputs that show only "saved ••••1234". A secret left
// empty keeps what is stored; "Clear" removes it from Vault. The same card serves Cloudflare
// (System) and, in step 6, each payment gateway at System / platform / brand scope.
export default function IntegrationCard({ provider, entry, item, scope, scopeId, onSaved, onTest, testIdPrefix }: {
  provider: string; entry: CatalogEntry; item: Integration | null; scope: 'global' | 'platform' | 'site'; scopeId: string | null;
  onSaved: () => void; onTest?: () => Promise<{ ok: boolean; message: string }>; testIdPrefix?: string;
}) {
  const initial = () => Object.fromEntries(entry.config.map((f) => [f.name, String(item?.config?.[f.name] ?? f.default ?? '')]));
  const [cfg, setCfg] = useState<Record<string, string>>(initial);
  const [sec, setSec] = useState<Record<string, string>>({});
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const tid = testIdPrefix ?? `int-${provider}`;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(initial()) || Object.values(sec).some((v) => v.trim()) || Object.values(clear).some(Boolean) || enabled !== (item?.enabled ?? true);

  const save = async () => {
    setBusy('save'); setMsg(null);
    try {
      const secrets: Record<string, string | null> = {};
      for (const s of entry.secrets) { if (clear[s.name]) secrets[s.name] = null; else if (sec[s.name]?.trim()) secrets[s.name] = sec[s.name].trim(); }
      const config: Record<string, unknown> = {};
      for (const f of entry.config) config[f.name] = f.kind === 'bool' ? cfg[f.name] === 'true' : cfg[f.name];
      await saveIntegration({ provider, scope, scopeId, config, secrets, enabled });
      setSec({}); setClear({});
      setMsg({ tone: 'ok', text: 'Saved. Secrets are stored encrypted and never shown again.' });
      onSaved();
    } catch (e) { setMsg({ tone: 'error', text: brandError(e) }); } finally { setBusy(null); }
  };
  const test = async () => {
    if (!onTest) return;
    setBusy('test'); setMsg(null);
    try { const r = await onTest(); setMsg({ tone: r.ok ? 'ok' : 'error', text: r.message }); onSaved(); }
    catch (e) { setMsg({ tone: 'error', text: brandError(e) }); } finally { setBusy(null); }
  };

  return (
    <Card testId={tid} title={entry.label}
      action={item ? <Badge tone={!item.enabled ? 'muted' : item.test_ok === true ? 'up' : item.test_ok === false ? 'down' : 'warn'}>
        {!item.enabled ? 'Off' : item.test_ok === true ? 'Connected' : item.test_ok === false ? 'Failing' : 'Not tested'}</Badge> : <Badge>Not set up</Badge>}>
      {entry.help && <p className="mb-3 text-[12px] text-muted">{entry.help}</p>}
      {msg && <div className="mb-3"><Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        {entry.config.map((f) => (
          <Field key={f.name} label={`${f.label}${f.required ? '' : ' (optional)'}`} hint={f.help}>
            {f.kind === 'enum'
              ? <Select value={cfg[f.name] ?? ''} onChange={(v) => setCfg((c) => ({ ...c, [f.name]: v }))} label={f.label} className="w-full" options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
              : f.kind === 'bool'
                ? <Switch checked={cfg[f.name] === 'true'} onChange={(v) => setCfg((c) => ({ ...c, [f.name]: String(v) }))} label={f.label} />
                : <input value={cfg[f.name] ?? ''} onChange={(e) => setCfg((c) => ({ ...c, [f.name]: e.target.value }))} className={`${inputCls} font-mono`}
                    autoComplete="off" spellCheck={false} data-testid={`${tid}-cfg-${f.name}`} aria-label={f.label} />}
          </Field>
        ))}
        {entry.secrets.map((s) => {
          const stored = item?.secrets?.[s.name];
          return (
            <Field key={s.name} label={s.label} hint={<>{s.help}{stored && <span className="mt-1 flex items-center gap-1 text-faint"><KeyRound size={11} />Saved {stored.hint} · {relTime(stored.set_at)}</span>}</>}>
              <div className="flex gap-2">
                <input type="password" value={sec[s.name] ?? ''} onChange={(e) => { setSec((x) => ({ ...x, [s.name]: e.target.value })); setClear((x) => ({ ...x, [s.name]: false })); }}
                  placeholder={stored ? (clear[s.name] ? 'Will be removed' : 'Leave empty to keep') : 'Paste here'} className={`${inputCls} font-mono`}
                  autoComplete="new-password" spellCheck={false} data-testid={`${tid}-secret-${s.name}`} aria-label={s.label} />
                {stored && !s.required && <Button size="sm" variant="ghost" onClick={() => setClear((x) => ({ ...x, [s.name]: !x[s.name] }))}>{clear[s.name] ? 'Keep' : 'Clear'}</Button>}
              </div>
            </Field>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Switch checked={enabled} onChange={setEnabled} label="On" testId={`${tid}-enabled`} />
        {item?.tested_at && <span className="text-[12px] text-faint">Last test {relTime(item.tested_at)}{item.test_message ? `: ${item.test_message}` : ''}</span>}
        <span className="flex-1" />
        {item && onTest && <Button size="sm" loading={busy === 'test'} disabled={dirty} title={dirty ? 'Save first' : undefined} onClick={test} data-testid={`${tid}-test`}>Test connection</Button>}
        {item && <ConfirmButton confirmLabel="Delete account" onConfirm={async () => { try { await deleteIntegration(item.id); onSaved(); } catch (e) { setMsg({ tone: 'error', text: brandError(e) }); } }}>Delete</ConfirmButton>}
        <Button variant="primary" size="sm" loading={busy === 'save'} disabled={!dirty} onClick={save} data-testid={`${tid}-save`}>Save</Button>
      </div>
      {item?.updated_by && <p className="mt-2 text-[11px] text-faint">Last changed by {item.updated_by} {relTime(item.updated_at)}</p>}
    </Card>
  );
}
