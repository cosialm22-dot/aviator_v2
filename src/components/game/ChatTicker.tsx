import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { ChatMessage } from '../../hooks/useChatStream';

interface Props {
  messages: ChatMessage[];
  onOpenChat?: () => void; // optional: tap the ticker to jump to the full chat
}

// Rotate through this many of the most recent messages.
const WINDOW = 25;
const ROTATE_MS = 4000;

// ============================================================================
// ChatTicker - a single-line, auto-rotating view of the live chat for layouts
// without a side chat panel (mobile / tablet / lg). It lets players SEE what
// others are saying without leaving the betting view or switching tabs. It is
// read-only and consumes the SAME stream as the chat panel (useChatStream), so
// the two can never diverge. Behaviour:
//   - cycles through the last WINDOW messages every ROTATE_MS, and
//   - jumps to the newest message the moment one arrives (so live chatter is
//     never missed), then resumes cycling.
// ============================================================================
export default function ChatTicker({ messages, onOpenChat }: Props) {
  const recent = messages.slice(-WINDOW);
  const [idx, setIdx] = useState(0);
  const lenRef = useRef(messages.length);

  // Jump to the newest message when the stream grows.
  useEffect(() => {
    if (messages.length > lenRef.current && recent.length > 0) {
      setIdx(recent.length - 1);
    }
    lenRef.current = messages.length;
  }, [messages.length, recent.length]);

  // Auto-rotate through the recent window.
  useEffect(() => {
    if (recent.length < 2) return;
    const t = setInterval(() => setIdx(p => (p + 1) % recent.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [recent.length]);

  if (recent.length === 0) return null;
  const msg = recent[Math.min(idx, recent.length - 1)];

  return (
    <button
      type="button"
      onClick={onOpenChat}
      title={onOpenChat ? 'Open chat' : undefined}
      aria-label="Latest chat message"
      className="xl:hidden w-full flex items-center gap-2 px-3 py-1.5 bg-[#0d0d1a] border-t border-[#2a2a45] text-left active:bg-[#12121f] transition-colors"
    >
      <MessageSquare size={12} className="text-slate-500 flex-shrink-0" />
      {/* key on id => remount triggers the fade-in each time the message changes */}
      <div key={msg.id} className="min-w-0 flex-1 flex items-center gap-1.5 animate-[fadeIn_0.25s_ease]">
        <span className="text-[11px] font-bold flex-shrink-0" style={{ color: msg.avatar_color }}>
          {msg.username}
        </span>
        <span className="text-[11px] text-slate-300 truncate">{msg.text}</span>
      </div>
      <span className="flex items-center gap-1 text-[9px] text-green-400 font-semibold flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        Live
      </span>
    </button>
  );
}
