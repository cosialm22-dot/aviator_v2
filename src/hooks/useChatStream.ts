import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { CHAT_MESSAGES } from '../lib/chatMessages';

// ============================================================================
// useChatStream - the SINGLE source of truth for the live chat message stream.
// ----------------------------------------------------------------------------
// Mounted by ChatSheet only while chat is open (no channel or bot timer otherwise).
//
// Producers (merged, de-duplicated, bounded, chronologically ordered):
//   1. history load  - last 50 real messages from chat_messages on mount,
//   2. Realtime       - INSERTs from other signed-in users,
//   3. bots           - a seeded + randomly scheduled simulated chatter stream,
//   4. own send       - optimistic insert reconciled with the server echo.
// ============================================================================

export interface ChatMessage {
  id: string;
  user_id: string | null;
  username: string;
  avatar_color: string;
  text: string;
  created_at: string;
}

// Hard cap on retained messages (single source of truth for all insert paths).
const MAX_MESSAGES = 120;

// Fisher-Yates shuffle - returns a new shuffled copy.
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Queue that cycles through all bot messages before repeating any.
class MessageQueue {
  private queue: [string, string, string][] = [];
  next(): ChatMessage {
    if (this.queue.length === 0) this.queue = shuffle(CHAT_MESSAGES);
    const [text, username, avatar_color] = this.queue.pop()!;
    return { id: `bot-${Date.now()}-${Math.random()}`, user_id: null, username, avatar_color, text, created_at: new Date().toISOString() };
  }
}
const msgQueue = new MessageQueue();

// Merge incoming messages into the existing list with three guarantees:
//   1. De-duplication by id (Realtime can re-deliver an INSERT).
//   2. Optimistic reconciliation - when the server echo for a message we
//      already rendered optimistically (id "opt-…") arrives, the placeholder
//      is replaced in place instead of producing a visible duplicate.
//   3. Stable chronological order (oldest -> newest) and a bounded length.
function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) byId.set(m.id, m);

  for (const m of incoming) {
    if (m.user_id && !m.id.startsWith('opt-')) {
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

export interface ChatIdentity {
  userId?: string;
  username?: string;
  avatarColor?: string;
}

export interface ChatStream {
  messages: ChatMessage[];
  sending: boolean;
  /** Send a chat message. Resolves when the optimistic insert + DB write settle.
   *  Returns false (without sending) if the user is not signed in or `text` is empty. */
  send: (text: string) => Promise<boolean>;
}

export function useChatStream({ userId, username, avatarColor = '#3b82f6' }: ChatIdentity): ChatStream {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  // Load last 50 real messages, then MERGE (never replace) so seeded/bot
  // messages already on screen are preserved and an empty table is a no-op.
  useEffect(() => {
    supabase
      .from('chat_messages').select('id, user_id, username, avatar_color, text, created_at')
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => {
        if (data && data.length) setMessages(prev => mergeMessages(prev, data as ChatMessage[]));
      });
  }, []);

  // Realtime - new real messages, pushed on the public broadcast topic "chat" by a DB trigger
  // (cheaper than postgres_changes, which RLS-checked every insert once per open page).
  useEffect(() => {
    const channel = supabase
      .channel('chat')
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        if (payload?.id) setMessages(prev => mergeMessages(prev, [payload as ChatMessage]));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Bot messages - seeded then scheduled randomly every ~2-5s.
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

  const send = useCallback(async (text: string): Promise<boolean> => {
    const body = text.trim();
    if (!body || !userId || !username || sending) return false;
    setSending(true);
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`, user_id: userId, username, avatar_color: avatarColor,
      text: body, created_at: new Date().toISOString(),
    };
    setMessages(prev => mergeMessages(prev, [optimistic]));
    await supabase.from('chat_messages').insert({ user_id: userId, username, avatar_color: avatarColor, text: body });
    setSending(false);
    return true;
  }, [userId, username, avatarColor, sending]);

  return { messages, sending, send };
}
