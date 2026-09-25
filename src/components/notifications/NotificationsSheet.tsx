import { Info, CheckCircle2, AlertTriangle, AlertOctagon, X } from 'lucide-react';
import type { AppNotification } from '../../hooks/useNotifications';
import Sheet from '../ui/Sheet';
import { Button, Empty, Group } from '../ui/ios';

// Passive inbox: new items only light a dot on the menu (never a pop-up); the list opens on demand.
const LEVEL: Record<string, { icon: typeof Info; color: string }> = {
  info: { icon: Info, color: '#0a84ff' },
  success: { icon: CheckCircle2, color: '#30d158' },
  warning: { icon: AlertTriangle, color: '#ff9f0a' },
  error: { icon: AlertOctagon, color: '#ff453a' },
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
  const clearable = items.some((n) => n.dismissible);
  return (
    <Sheet title="Notifications" onClose={onClose}
      headerLeft={clearable ? <Button variant="plain" size="md" className="px-2" onClick={() => void dismissAll()}>Clear</Button> : null}>
      {items.length === 0 ? <Empty>Nothing new</Empty> : (
        <div className="px-4 pt-1">
          <Group on="sheet">
            {items.map((n) => {
              const L = LEVEL[n.level] ?? LEVEL.info;
              const Icon = L.icon;
              return (
                <div key={n.id} className="relative flex gap-3 py-3 pl-4 pr-1 after:absolute after:bottom-0 after:left-[52px] after:right-0 after:h-px after:origin-bottom after:scale-y-50 after:bg-ios-sep last:after:hidden">
                  <Icon size={22} strokeWidth={1.9} className="mt-px shrink-0" style={{ color: L.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 text-headline text-white">{n.title}</span>
                      <span className="shrink-0 text-footnote text-ios-label2">{ago(n.created_at)}</span>
                    </div>
                    {n.body ? <p className="mt-0.5 break-words text-subhead text-ios-label2">{n.body}</p> : null}
                  </div>
                  {n.dismissible ? (
                    <button onClick={() => void dismiss(n.id)} aria-label="Dismiss" className="-my-1 grid h-11 w-10 shrink-0 place-items-center text-ios-label3 active:text-white"><X size={16} strokeWidth={2.5} /></button>
                  ) : <span className="w-10 shrink-0" />}
                </div>
              );
            })}
          </Group>
        </div>
      )}
    </Sheet>
  );
}
