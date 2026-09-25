import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Button, Card, Notice, inputCls } from '../ui/kit';
import { SettingsGrid } from './SettingField';
import { brandError, uploadBrandAsset, type Identity } from './api';
import type { BrandDraft } from './useBrandDraft';

// Identity (name, wordmark, logo, favicon, contact, licence line) and everything a brand says:
// words on the game, search & sharing, support contacts, social links, analytics, home-screen app.

function ImageSlot({ label, hint, url, onUrl, kind, draft, disabled, testId }: {
  label: string; hint: string; url: string | null; onUrl: (u: string | null) => void; kind: 'logo' | 'favicon' | 'icon' | 'og';
  draft: BrandDraft; disabled: boolean; testId: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-ink">{label}</div>
      <div className="flex items-center gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-raised ring-1 ring-white/[0.06]">
          {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[11px] text-faint">None</span>}
        </div>
        <input ref={ref} type="file" accept="image/png,image/webp,image/jpeg,image/x-icon" className="hidden" data-testid={testId}
          onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f || !draft.doc) return;
            setBusy(true); setErr(null);
            try { onUrl(await uploadBrandAsset(draft.doc.site_id, kind, f)); } catch (x) { setErr(brandError(x)); }
            finally { setBusy(false); e.target.value = ''; }
          }} />
        <Button size="sm" onClick={() => ref.current?.click()} loading={busy} disabled={disabled}><Upload size={13} />Upload</Button>
        {url && <Button size="sm" variant="ghost" onClick={() => onUrl(null)} disabled={disabled} aria-label={`Remove ${label}`}><X size={13} />Remove</Button>}
      </div>
      <p className="mt-1 text-[12px] text-faint">{hint}</p>
      {err && <p className="mt-1 text-[12px] text-down">{err}</p>}
    </div>
  );
}

export default function ContentEditor({ draft, only }: { draft: BrandDraft; only: 'content' | 'legal' }) {
  const id = draft.identity;
  const can = draft.doc?.can;
  if (!id || !can) return null;
  const text = (k: keyof Identity, label: string, hint?: string, max = 60, type = 'text', platformOnly = false) => (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      <input value={(id[k] as string | null) ?? ''} maxLength={max} type={type} disabled={platformOnly ? !can.platform : !can.brand} data-testid={`identity-${k}`}
        onChange={(e) => draft.setIdentity(k, (e.target.value || (k === 'name' ? '' : null)) as never)} className={inputCls} />
      {hint && <span className="mt-1 block text-[12px] text-faint">{hint}</span>}
    </label>
  );

  if (only === 'legal') {
    return (
      <div className="space-y-5">
        <Card title="Licence & operator">
          <div className="grid gap-4 sm:grid-cols-2">{text('licence_line', 'Licence line', 'Shown in the menu and on the legal pages.', 200)}</div>
          <div className="mt-2"><SettingsGrid draft={draft} keys={['legal.company', 'legal.licence_no', 'legal.min_age']} /></div>
        </Card>
        <Card title="Pages"><SettingsGrid draft={draft} keys={['legal.terms', 'legal.privacy', 'legal.responsible']} cols={1} />
          <p className="mt-2 text-[12px] text-faint">Plain text. A blank line starts a new paragraph; a line starting with # is a heading. Pages appear in the menu once they have text.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!can.brand && <Notice tone="info">Read-only for your role.</Notice>}
      <Card title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          {text('name', 'Brand name', 'Tab title and install name when no SEO title is set.')}
          {text('wordmark_text', 'Wordmark', 'The name in the header. Blank = brand name.', 40)}
          {text('support_email', 'Support email', undefined, 120, 'email')}
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Language & region</span>
            <select value={id.locale} disabled={!can.brand} onChange={(e) => draft.setIdentity('locale', e.target.value)} className={inputCls} aria-label="Language and region">
              <option value="en-KE">English (Kenya)</option><option value="sw-KE">Swahili (Kenya)</option><option value="en-GB">English (UK)</option><option value="en-US">English (US)</option>
            </select>
          </label>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <ImageSlot label="Logo" hint="Wide PNG with a transparent background. Used when the header shows the logo." url={id.logo_url} kind="logo" draft={draft} disabled={!can.brand}
            onUrl={(u) => draft.setIdentity('logo_url', u)} testId="upload-logo" />
          <ImageSlot label="Favicon" hint="Square PNG or ICO. Blank = generated from the plane and brand colour." url={id.favicon_url} kind="favicon" draft={draft} disabled={!can.brand}
            onUrl={(u) => draft.setIdentity('favicon_url', u)} testId="upload-favicon" />
        </div>
      </Card>
      <Card title="Words on the game"><SettingsGrid draft={draft} sections={['copy']} /></Card>
      <Card title="Search & sharing">
        <SettingsGrid draft={draft} keys={['seo.title', 'seo.description', 'seo.indexing']} />
        <div className="mt-3"><ImageSlot label="Share image" hint="1200 × 630 PNG or JPEG, shown when the link is shared." url={draft.value('seo.og_image') as string | null} kind="og" draft={draft} disabled={!can.brand}
          onUrl={(u) => draft.set('seo.og_image', u)} testId="upload-og" /></div>
      </Card>
      <Card title="Support"><SettingsGrid draft={draft} sections={['support']} /></Card>
      <Card title="Social"><SettingsGrid draft={draft} sections={['social']} /></Card>
      <Card title="Analytics"><SettingsGrid draft={draft} sections={['analytics']} /></Card>
      <Card title="Home-screen app">
        <SettingsGrid draft={draft} keys={['pwa.short_name']} />
        <div className="mt-3"><ImageSlot label="App icon" hint="Square 512 × 512 PNG." url={draft.value('pwa.icon_url') as string | null} kind="icon" draft={draft} disabled={!can.brand}
          onUrl={(u) => draft.set('pwa.icon_url', u)} testId="upload-icon" /></div>
      </Card>
    </div>
  );
}
