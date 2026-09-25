import { Info, CheckCircle2, AlertTriangle, AlertOctagon, X } from 'lucide-react';
import type { AppNotification } from '../../hooks/useNotifications';
import Sheet from '../ui/Sheet';

// Passive inbox: new items only light a dot on the menu (never a pop-up); the list opens on demand.
const LEVEL: Record<string, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: 'text-info' },
  success: { icon: CheckCircle2, cls: 'text-win' },
  warning: { icon: AlertTriangle, cls: 'text-amber-400' },
  error: { icon: AlertOctagon, cls: 'text-danger' },
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function NotificationsSheet({ items, dismiss, dismissAll, onClose }: {
  items: AppNotification[]; dismiss: (id: number) => Promise<void>; dismissAll: () => Promise<void>; onClose: () => void;
}) {
  return (
    <Sheet title="Notifications" onClose={onClose}>
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-[#7b7b7b]">Nothing new</p>
      ) : (
        <>
          <ul>
            {items.map((n) => {
              const L = LEVEL[n.level] ?? LEVEL.info;
              const Icon = L.icon;
              return (
                <li key={n.id} className="flex gap-3 border-b border-[#232426] py-3 pl-4 pr-1">
                  <Icon size={16} className={`mt-0.5 shrink-0 ${L.cls}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-white">{n.title}</span>
                      <span className="shrink-0 text-[11px] text-[#7b7b7b]">{ago(n.created_at)}</span>
                    </div>
                    {n.body ? <p className="mt-0.5 break-words text-[13px] leading-snug text-[#9ea0a3]">{n.body}</p> : null}
                  </div>
                  {n.dismissible ? (
                    <button onClick={() => void dismiss(n.id)} aria-label="Dismiss" className="grid h-9 w-9 shrink-0 place-items-center text-[#7b7b7b] hover:text-white"><X size={15} /></button>
                  ) : <span className="w-9 shrink-0" />}
                </li>
              );
            })}
          </ul>
          <button onClick={() => void dismissAll()} className="h-12 w-full text-sm text-[#9ea0a3] hover:text-white">Clear all</button>
        </>
      )}
    </Sheet>
  );
}
