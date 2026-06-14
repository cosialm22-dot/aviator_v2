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

// ============================================================================
// Chat - the full live-chat PANEL (presentational). The message stream itself
// is owned by useChatStream (lifted to AviatorGame) so this panel and the mobile
// ChatTicker always render the identical stream. This component owns only the
// scroll-follow behaviour and the input box.
// ============================================================================
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
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#2a2a45] flex-shrink-0">
        <span className="text-xs font-bold text-white uppercase tracking-wider">Live Chat</span>
        <span className="flex items-center gap-1.5 text-[10px] text-green-400 font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Live
        </span>
      </div>

      {/* Messages */}
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5 scrollbar-thin">
        {messages.map(msg => (
          <div key={msg.id} className="flex gap-2 items-start">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mt-0.5 border border-white/10"
              style={{ backgroundColor: msg.avatar_color }}
            >
              {msg.username[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-bold" style={{ color: msg.avatar_color }}>
                {msg.username}
              </span>
              {msg.user_id === userId && (
                <span className="ml-1.5 text-[9px] text-slate-500">(wewe)</span>
              )}
              <p className="text-[11px] text-slate-300 break-words leading-snug mt-0.5">{msg.text}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-[#2a2a45] flex-shrink-0">
        {username ? (
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Andika hapa..."
              maxLength={200}
              disabled={sending}
              className="flex-1 bg-[#1a1a2e] border border-[#2a2a45] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#c8001c]/70 transition-colors disabled:opacity-60"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="w-9 h-9 flex items-center justify-center bg-[#c8001c] rounded-lg text-white disabled:opacity-40 hover:bg-[#a80015] transition active:scale-95 flex-shrink-0"
            >
              <Send size={14} />
            </button>
          </div>
        ) : (
          <p className="text-center text-[11px] text-slate-500 py-1">Ingia ili ucheze chat</p>
        )}
      </div>
    </div>
  );
}
