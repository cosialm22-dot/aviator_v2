import { useState, useEffect, useRef, useCallback } from 'react';
import { Send } from 'lucide-react';
import type { ChatMessage } from '../../hooks/useChatStream';

interface Props {
  messages: ChatMessage[];
  sending: boolean;
  onSend: (text: string) => Promise<boolean>;
  userId?: string;
  username?: string;
}

// How close to the bottom (px) still counts as "pinned to newest".
const STICK_THRESHOLD_PX = 48;

// Chat panel (presentational): scroll-follow and the input box. The stream comes from
// useChatStream, which ChatSheet mounts only while chat is open.
export default function Chat({ messages, sending, onSend, userId, username }: Props) {
  const [input, setInput] = useState('');

  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);   // is the view currently pinned to the newest message?
  const forceRef = useRef(true);    // next auto-scroll must jump instantly (initial mount / own send)
  const rafRef = useRef(0);         // pending scroll frame, so bursts coalesce into one scroll

  // Track whether the user is pinned to the bottom. When they scroll up to read
  // history we stop auto-following so we never yank them away.
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }, []);

  // SINGLE source of truth for auto-scroll. Runs after every message change.
  // - forceRef: instant jump (initial mount, the user's own message) - no animation.
  // - otherwise: smooth follow, but only while pinned to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const force = forceRef.current;
    forceRef.current = false;
    if (!force && !pinnedRef.current) return;
    const behavior: ScrollBehavior = force ? 'auto' : 'smooth';
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior });
      pinnedRef.current = true;
    });
  }, [messages]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const sendMessage = async () => {
    const text = input;
    forceRef.current = true; // always follow our own message
    const ok = await onSend(text);
    if (ok) setInput('');
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-2 space-y-3 scrollbar-thin">
        {messages.map(msg => (
          <div key={msg.id} className="flex gap-2 items-start">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0 mt-0.5 border border-white/10"
              style={{ backgroundColor: msg.avatar_color }}
            >
              {msg.username[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[12px] font-bold" style={{ color: msg.avatar_color }}>
                {msg.username}
              </span>
              {msg.user_id === userId && (
                <span className="ml-1.5 text-[11px] text-slate-500">you</span>
              )}
              <p className="text-[13px] text-slate-200 break-words leading-snug mt-0.5">{msg.text}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-edge flex-shrink-0">
        {username ? (
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Message" aria-label="Message"
              maxLength={200}
              disabled={sending}
              className="h-11 flex-1 rounded-full border border-edge bg-panel-raised px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 transition-colors disabled:opacity-60"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              aria-label="Send"
              className="grid h-11 w-11 place-items-center rounded-full bg-win text-white disabled:opacity-40 transition active:scale-95 flex-shrink-0"
            >
              <Send size={16} />
            </button>
          </div>
        ) : (
          <p className="py-2 text-center text-sm text-slate-500">Log in to chat</p>
        )}
      </div>
    </div>
  );
}
