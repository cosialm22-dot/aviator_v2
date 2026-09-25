import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, type LucideIcon } from 'lucide-react';
import { useAdmin } from '../roleContext';
import { navFor } from '../layout/nav';

// ⌘K / Ctrl-K command palette: jump to any page the current role can reach (same list as the
// sidebar, from layout/nav.ts). ↑/↓ move, ↵ opens, Esc closes. The route guards and the
// server remain the real gate.

interface Cmd { id: string; label: string; hint: string; path: string; icon: LucideIcon }

export default function CommandPalette() {
  const { role } = useAdmin();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Only the sections this role can actually reach.
  const commands = useMemo<Cmd[]>(() => navFor(role).flatMap((g) => g.items.map((i) => ({ id: i.path, label: i.label, hint: i.hint, path: i.path, icon: i.icon }))), [role]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(s) || c.hint.toLowerCase().includes(s));
  }, [q, commands]);

  // Global ⌘K / Ctrl-K toggle; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (active >= filtered.length) setActive(filtered.length > 0 ? filtered.length - 1 : 0);
  }, [filtered, active]);

  const run = useCallback((cmd: Cmd | undefined) => {
    if (!cmd) return;
    setOpen(false);
    navigate(cmd.path);
  }, [navigate]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(filtered[active]); }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[16vh] animate-[fadeIn_0.15s_ease]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-[640px] overflow-hidden rounded-2xl bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.08] animate-[menuIn_0.2s_cubic-bezier(0.32,0.72,0,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-14 items-center gap-3 px-4">
          <Search size={20} strokeWidth={2} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Jump to…"
            className="h-full w-full bg-transparent text-[17px] tracking-[-0.01em] text-ink outline-none placeholder:text-faint"
            aria-label="Search admin sections"
          />
          <kbd className="hidden shrink-0 rounded-md bg-raised px-1.5 py-0.5 font-sans text-[11px] font-medium text-faint sm:block">ESC</kbd>
        </div>

        <ul className="max-h-[52vh] overflow-y-auto border-t border-line p-1.5">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-[13px] text-faint">No matches</li>
          )}
          {filtered.map((cmd, i) => {
            const Icon = cmd.icon;
            const isActive = i === active;
            return (
              <li key={cmd.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(cmd)}
                  className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] ${
                    isActive ? 'bg-brand text-white' : 'text-ink'
                  }`}
                >
                  <Icon size={16} strokeWidth={1.75} className={isActive ? 'text-white' : 'text-muted'} />
                  <span className="flex-1 truncate font-medium">{cmd.label}</span>
                  <span className={`truncate text-[12px] ${isActive ? 'text-white/70' : 'text-faint'}`}>{cmd.hint}</span>
                  {isActive && <CornerDownLeft size={13} className="shrink-0 text-white/70" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
