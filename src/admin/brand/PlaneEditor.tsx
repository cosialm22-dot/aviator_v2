import { useRef, useState } from 'react';
import { Check, Upload } from 'lucide-react';
import { Button, Card, Notice } from '../ui/kit';
import PlaneMark from '../../components/brand/PlaneMark';
import BirdMark from '../../components/game/BirdMark';
import { PLANE_MODELS } from '../../brand/planes';
import { BIRDS } from '../../components/game/birds';
import { SettingsGrid } from './SettingField';
import { brandError, uploadBrandAsset } from './api';
import type { BrandDraft } from './useBrandDraft';

// Plane (what players see) and bird (what a marketer streams on TikTok): pick a model, tint it,
// or upload your own image; pick the streamer bird.
export default function PlaneEditor({ draft }: { draft: BrandDraft }) {
  const editable = !!draft.doc?.can.platform;
  const model = String(draft.value('plane.model'));
  const colors = { body: String(draft.value('plane.body')), accent: String(draft.value('plane.accent')), canopy: String(draft.value('plane.canopy')) };
  const image = draft.value('plane.image_url') as string | null;
  const bird = String(draft.value('stream.bird'));
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (f: File | undefined) => {
    if (!f || !draft.doc) return;
    setBusy(true); setErr(null);
    try {
      const url = await uploadBrandAsset(draft.doc.site_id, 'plane', f);
      draft.setMany({ 'plane.image_url': url, 'plane.model': 'custom' });
    } catch (e) { setErr(brandError(e)); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  };

  return (
    <div className="space-y-5">
      {!editable && <Notice tone="info">The plane and bird are set by the platform.</Notice>}
      <Card title="Plane" action={<span className="text-[12px] text-muted">Players see this</span>}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6" role="radiogroup" aria-label="Plane model">
          {PLANE_MODELS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={model === m.id} disabled={!editable || (m.id === 'custom' && !image)}
              onClick={() => draft.set('plane.model', m.id)} data-testid={`plane-${m.id}`}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl bg-raised/60 p-2.5 ring-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${model === m.id ? 'ring-2 ring-brand' : 'ring-white/[0.06] hover:ring-white/20'}`}>
              <div className="grid h-12 place-items-center">
                {m.id === 'custom' && !image ? <Upload size={18} className="text-faint" />
                  : <PlaneMark model={m.id} {...colors} imageUrl={image} width={76} />}
              </div>
              <span className="text-[12px] text-ink">{m.label}</span>
              {model === m.id && <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-brand text-white"><Check size={10} strokeWidth={3} /></span>}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input ref={file} type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="plane-upload" />
          <Button onClick={() => file.current?.click()} loading={busy} disabled={!editable}><Upload size={14} />Upload a plane</Button>
          <span className="text-[12px] text-faint">PNG or WebP, facing right, transparent background, up to 2 MB.</span>
          {image && <a href={image} target="_blank" rel="noreferrer" className="text-[12px] text-brand hover:underline">Current image</a>}
        </div>
        {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
        <div className="mt-4 border-t border-line pt-4">
          <SettingsGrid draft={draft} keys={['plane.body', 'plane.accent', 'plane.canopy', 'plane.scale', 'plane.exhaust']} />
        </div>
      </Card>

      <Card title="Streamer bird" action={<span className="text-[12px] text-muted">Marketers going live see this instead of the plane</span>}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-7" role="radiogroup" aria-label="Streamer bird">
          {BIRDS.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={bird === b.id} disabled={!editable} onClick={() => draft.set('stream.bird', b.id)}
              data-testid={`bird-${b.id}`}
              className={`flex flex-col items-center gap-1 rounded-xl bg-raised/60 p-2 ring-1 transition disabled:opacity-40 ${bird === b.id ? 'ring-2 ring-brand' : 'ring-white/[0.06] hover:ring-white/20'}`}>
              <BirdMark skin={b.id} width={58} />
              <span className="line-clamp-1 text-[11px] text-ink">{b.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <SettingsGrid draft={draft} sections={['stream']} keys={['stream.default_on', 'stream.curve', 'stream.show_domain']} />
        </div>
      </Card>
    </div>
  );
}
