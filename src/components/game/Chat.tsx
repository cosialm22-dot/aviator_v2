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

// Queue that cycles through all 500 messages before repeating any
class MessageQueue {
  private queue: [string, string, string][] = [];
  next(): ChatMessage {
    if (this.queue.length === 0) this.queue = shuffle(CHAT_MESSAGES);
    const [text, username, avatar_color] = this.queue.pop()!;
    return { id: `bot-${Date.now()}-${Math.random()}`, user_id: null, username, avatar_color, text, created_at: new Date().toISOString() };
  }
}

const msgQueue = new MessageQueue();

export default function Chat({ userId, username, avatarColor = '#3b82f6' }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const endRef   = useRef<HTMLDivElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const scrollToBottom = useCallback((force = false) => {
    if (force || atBottom.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load last 50 real messages on mount
  useEffect(() => {
    supabase
      .from('chat_messages').select('*')
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => {
        if (data) {
          setMessages((data as ChatMessage[]).reverse());
          setTimeout(() => scrollToBottom(true), 50);
        }
      });
  }, [scrollToBottom]);

  // Supabase Realtime — new real messages from other signed-in users
  useEffect(() => {
    const channel = supabase
      .channel('chat_messages_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
        const msg = payload.new as ChatMessage;
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev.slice(-99), msg]);
        scrollToBottom();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scrollToBottom]);

  // Bot messages — seeded then scheduled randomly every 2–5s
  useEffect(() => {
    // Seed 8 staggered opening messages
    const seed = Array.from({ length: 8 }, () => msgQueue.next());
    setMessages(prev => [...seed, ...prev]);

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Variable interval: sometimes fast (active feel), sometimes slow
      const delay = 1800 + Math.random() * 3800;
      timer = setTimeout(() => {
        setMessages(prev => [...prev.slice(-120), msgQueue.next()]);
        scrollToBottom();
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [scrollToBottom]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !userId || !username || sending) return;
    setInput('');
    setSending(true);
    const optimistic: ChatMessage = { id: `opt-${Date.now()}`, user_id: userId, username, avatar_color: avatarColor, text, created_at: new Date().toISOString() };
    setMessages(prev => [...prev.slice(-120), optimistic]);
    scrollToBottom(true);
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
        <div ref={endRef} />
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
