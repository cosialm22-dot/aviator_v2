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
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Jump to…"
            className="w-full bg-transparent py-3.5 text-sm text-ink outline-none placeholder:text-faint"
            aria-label="Search admin sections"
          />
          <kbd className="hidden shrink-0 rounded bg-raised px-1.5 py-0.5 text-[10px] text-faint sm:block">ESC</kbd>
        </div>

        <ul className="max-h-[52vh] overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-faint">No matches</li>
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
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    isActive ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60'
                  }`}
                >
                  <Icon size={16} strokeWidth={1.75} className={isActive ? 'text-ink' : 'text-faint'} />
                  <span className="flex-1">{cmd.label}</span>
                  <span className="text-xs text-faint">{cmd.hint}</span>
                  {isActive && <CornerDownLeft size={13} className="text-faint" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
