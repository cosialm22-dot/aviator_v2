import { useState } from 'react';
import { X } from 'lucide-react';
import { useBrand } from '../../brand/useBrand';

// The brand's one-line announcement above the game (copy.announcement). Dismissed for this tab
// until the text changes.
const KEY = 'aviator_announcement_dismissed';

export default function Announcement() {
  const text = useBrand().config['copy.announcement'];
  const [dismissed, setDismissed] = useState(() => { try { return sessionStorage.getItem(KEY); } catch { return null; } });
  if (!text || dismissed === text) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-xl bg-g-accent/15 py-1.5 pl-3 pr-1 text-[13px] font-medium text-g-fg" role="note" data-testid="announcement">
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <button type="button" aria-label="Dismiss" onClick={() => { setDismissed(text); try { sessionStorage.setItem(KEY, text); } catch { /* ignore */ } }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-g-mute hover:text-g-fg"><X size={15} /></button>
    </div>
  );
}
