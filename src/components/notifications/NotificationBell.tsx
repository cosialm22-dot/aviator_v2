import { useState, useRef, useEffect } from 'react';
import { Bell, X, CheckCheck, Info, CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';
import { useNotifications, type AppNotification } from '../../hooks/useNotifications';

// Player notification bell: unread badge + dropdown list with per-item dismiss
// and "clear all". Live via the realtime hook. Only mounted when signed in.
const LEVEL: Record<string, { icon: typeof Info; cls: string }> = {
  info:    { icon: Info,         cls: 'text-info' },
  success: { icon: CheckCircle2, cls: 'text-win' },
  warning: { icon: AlertTriangle,cls: 'text-amber-400' },
  error:   { icon: AlertOctagon, cls: 'text-danger' },
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationBell() {
  const { items, unread, dismiss, dismissAll } = useNotifications(true);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg border border-edge hover:border-[#3a3a55] text-slate-300 hover:text-white transition"
      >
        <Bell size={17} strokeWidth={1.9} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[320px] max-w-[calc(100vw-1.5rem)] bg-panel border border-edge rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-edge">
            <span className="text-sm font-semibold text-frost">Notifications</span>
            {items.length > 0 && (
              <button onClick={() => void dismissAll()} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition">
                <CheckCheck size={13} /> Clear all
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500 text-[13px]">You&apos;re all caught up.</div>
            ) : (
              items.map((n: AppNotification) => {
                const L = LEVEL[n.level] ?? LEVEL.info;
                const Icon = L.icon;
                return (
                  <div key={n.id} className="flex gap-2.5 px-4 py-3 border-b border-edge/60 last:border-0 hover:bg-panel-raised/60">
                    <Icon size={16} className={`mt-0.5 flex-shrink-0 ${L.cls}`} strokeWidth={2} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-frost leading-snug">{n.title}</div>
                      {n.body && <div className="text-[12px] text-slate-400 mt-0.5 leading-snug break-words">{n.body}</div>}
                      <div className="text-[10px] text-slate-600 mt-1">{timeAgo(n.created_at)}</div>
                    </div>
                    {n.dismissible && (
                      <button onClick={() => void dismiss(n.id)} aria-label="Dismiss" className="flex-shrink-0 text-slate-600 hover:text-white transition h-fit">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
