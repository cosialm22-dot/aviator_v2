import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUp } from 'lucide-react';
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
    <div className="flex h-full flex-col">
      <div ref={listRef} onScroll={onScroll} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-2">
        {messages.map((msg) => {
          const mine = !!userId && msg.user_id === userId;
          return mine ? (
            <div key={msg.id} className="flex justify-end">
              <p className="max-w-[78%] break-words rounded-[18px] rounded-br-[6px] bg-ios-cta px-3.5 py-2 text-callout text-ios-cta-fg">{msg.text}</p>
            </div>
          ) : (
            <div key={msg.id} className="flex items-end gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-caption1 font-semibold text-white" style={{ backgroundColor: msg.avatar_color }}>
                {msg.username[0]?.toUpperCase()}
              </span>
              <div className="min-w-0 max-w-[78%]">
                <span className="block px-3.5 pb-0.5 text-caption1 text-ios-label2">{msg.username}</span>
                <p className="break-words rounded-[18px] rounded-bl-[6px] bg-ios-elev2 px-3.5 py-2 text-callout text-white">{msg.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 px-4 pt-2">
        {username ? (
          <div className="flex items-center gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKey}
              placeholder="Message" aria-label="Message" maxLength={200} disabled={sending}
              className="h-10 min-w-0 flex-1 rounded-full border border-ios-sep bg-transparent px-4 text-body text-white placeholder:text-ios-label3 focus:border-ios-label3 focus:outline-none disabled:opacity-60" />
            <button onClick={sendMessage} disabled={!input.trim() || sending} aria-label="Send"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ios-cta text-ios-cta-fg transition-opacity disabled:bg-ios-fill disabled:text-ios-label3">
              <ArrowUp size={20} strokeWidth={2.6} />
            </button>
          </div>
        ) : (
          <p className="py-2 text-center text-subhead text-ios-label2">Log in to chat</p>
        )}
      </div>
    </div>
  );
}
