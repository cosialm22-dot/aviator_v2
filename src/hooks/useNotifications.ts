import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// In-app notifications for the signed-in player. Reads are RPC-gated
// (my_notifications returns only the caller's active rows); realtime keeps the
// bell live. Dismiss/resolve go through SECURITY DEFINER RPCs.
export interface AppNotification {
  id: number;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body: string;
  dismissible: boolean;
  category: string | null;
  created_at: string;
  dismissed_at: string | null;
}

export function useNotifications(enabled: boolean) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_notifications');
    if (!error) setItems((data ?? []) as AppNotification[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) { setItems([]); setLoading(false); return; }
    void load();
    // Filter on the server by my user id: without it Realtime RLS-checked every notification
    // row (a broadcast inserts one per player) against every open page.
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id;
      if (!alive || !uid) return;
      ch = supabase
        .channel(`my-notifications-${uid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${uid}` }, () => { void load(); })
        .subscribe();
    });
    return () => { alive = false; if (ch) void supabase.removeChannel(ch); };
  }, [enabled, load]);

  const dismiss = useCallback(async (id: number) => {
    setItems((prev) => prev.filter((n) => n.id !== id)); // optimistic
    await supabase.rpc('dismiss_notification', { p_id: id });
  }, []);

  const dismissAll = useCallback(async () => {
    setItems((prev) => prev.filter((n) => !n.dismissible)); // optimistic: keep sticky ones
    await supabase.rpc('dismiss_all_notifications');
    void load();
  }, [load]);

  return { items, unread: items.length, loading, dismiss, dismissAll, reload: load };
}
