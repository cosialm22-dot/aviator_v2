import { useState, useEffect, useRef, useCallback } from 'react';
import { Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { CHAT_MESSAGES } from '../../lib/chatMessages';

interface ChatMessage {
  id: string;
  user_id: string | null;
  username: string;
  avatar_color: string;
  text: string;
  created_at: string;
}

interface Props {
  userId?: string;
  username?: string;
  avatarColor?: string;
}

// Fisher-Yates shuffle — returns a new shuffled copy
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Queue that cycles through all messages before repeating any
class MessageQueue {
  private queue: [string, string, string][] = [];
  next(): ChatMessage {
    if (this.queue.length === 0) this.queue = shuffle(CHAT_MESSAGES);
    const [text, username, avatar_color] = this.queue.pop()!;
    return { id: `bot-${Date.now()}-${Math.random()}`, user_id: null, username, avatar_color, text, created_at: new Date().toISOString() };
  }
}

const msgQueue = new MessageQueue();

// How close to the bottom (px) still counts as "pinned to newest".
const STICK_THRESHOLD_PX = 48;
// Hard cap on retained messages (single source of truth for all insert paths).
const MAX_MESSAGES = 120;

// Merge incoming messages into the existing list with three guarantees:
//   1. De-duplication by id (Realtime can re-deliver an INSERT).
//   2. Optimistic reconciliation — when the server echo for a message we
//      already rendered optimistically (id "opt-…") arrives, the placeholder
//      is replaced in place instead of producing a visible duplicate.
//   3. Stable chronological order (oldest → newest) and a bounded length,
//      so the three independent producers (history load, Realtime, bots,
//      own send) can never reorder or grow the list unpredictably.
function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) byId.set(m.id, m);

  for (const m of incoming) {
    if (m.user_id && !m.id.startsWith('opt-')) {
      // Drop a still-pending optimistic copy of this same user message.
      for (const [id, e] of byId) {
        if (id.startsWith('opt-') && e.user_id === m.user_id && e.text === m.text) {
          byId.delete(id);
          break;
        }
      }
    }
    if (!byId.has(m.id)) byId.set(m.id, m);
  }

  const merged = Array.from(byId.values());
  merged.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  return merged.length > MAX_MESSAGES ? merged.slice(merged.length - MAX_MESSAGES) : merged;
}

export default function Chat({ userId, username, avatarColor = '#3b82f6' }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);

  const listRef   = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);   // is the view currently pinned to the newest message?
  const forceRef  = useRef(true);   // next auto-scroll must jump instantly (initial load / own send)
  const rafRef    = useRef(0);      // pending scroll frame, so bursts coalesce into one scroll

  // Track whether the user is pinned to the bottom. When they scroll up to read
  // history we stop auto-following so we never yank them away.
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }, []);

  // SINGLE source of truth for auto-scroll. Runs after every message change.
  // - forceRef: instant jump (initial load, the user's own message) — no animation.
  // - otherwise: smooth follow, but only while pinned to the newest message.
  // Frames are coalesced (cancel + reschedule) so a burst of messages produces
  // exactly one scroll to the final bottom rather than stacked animations.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const force = forceRef.current;
    forceRef.current = false;
    if (!force && !pinnedRef.current) return;
    const behavior: ScrollBehavior = force ? 'auto' : 'smooth';
    cancelAnimationFrame(rafRef.current);
    // rAF: let the new message lay out before measuring scrollHeight.
    rafRef.current = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior });
      pinnedRef.current = true;
    });
  }, [messages]);

  // Cancel any pending scroll frame on unmount.
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Load last 50 real messages on mount, then jump to newest. We MERGE rather
  // than replace so seeded/bot messages already on screen are never wiped — an
  // empty table (typical for logged-out spectators) leaves the chat untouched
  // instead of flickering to blank.
  useEffect(() => {
    supabase
      .from('chat_messages').select('*')
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => {
        if (data && data.length) {
          forceRef.current = true;
          setMessages(prev => mergeMessages(prev, data as ChatMessage[]));
        }
      });
  }, []);

  // Supabase Realtime — new real messages from other signed-in users.
  useEffect(() => {
    const channel = supabase
      .channel('chat_messages_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
        setMessages(prev => mergeMessages(prev, [payload.new as ChatMessage]));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Bot messages — seeded then scheduled randomly every ~2–5s.
  useEffect(() => {
    const seed = Array.from({ length: 8 }, () => msgQueue.next());
    setMessages(prev => mergeMessages(prev, seed));

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = 1800 + Math.random() * 3800;
      timer = setTimeout(() => {
        setMessages(prev => mergeMessages(prev, [msgQueue.next()]));
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !userId || !username || sending) return;
    setInput('');
    setSending(true);
    const optimistic: ChatMessage = { id: `opt-${Date.now()}`, user_id: userId, username, avatar_color: avatarColor, text, created_at: new Date().toISOString() };
    forceRef.current = true; // always follow our own message
    setMessages(prev => mergeMessages(prev, [optimistic]));
    await supabase.from('chat_messages').insert({ user_id: userId, username, avatar_color: avatarColor, text });
    setSending(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
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
