import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, Wallet } from '../types';

export function useAuth() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (prof) setProfile(prof as Profile);

    const { data: wal } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (wal) setWallet(wal as Wallet);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email ?? '' });
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        if (session?.user) {
          setUser({ id: session.user.id, email: session.user.email ?? '' });
          await fetchProfile(session.user.id);
        } else {
          setUser(null);
          setProfile(null);
          setWallet(null);
        }
      })();
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signUp = async (email: string, password: string, username: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.user) throw new Error('Sign up failed');

    const colors = ['#ef4444', '#f97316', '#22c55e', '#06b6d4', '#3b82f6', '#ec4899', '#f59e0b'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      username,
      avatar_color: color,
    });
    if (profileError) throw profileError;

    // 🎁 Free signup bonus: KSh 500 so new users can play immediately
    await supabase.from('wallets').upsert({
      user_id: data.user.id,
      balance: 500,
      currency: 'KES',
    }, { onConflict: 'user_id' });

    await supabase.from('transactions').insert({
      user_id: data.user.id,
      type: 'deposit',
      amount: 500,
      description: 'Welcome bonus — KSh 500 free credits!',
      status: 'completed',
    });

    return data;
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshWallet = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) setWallet(data as Wallet);
  };

  return { user, profile, wallet, loading, signUp, signIn, signOut, refreshWallet };
}
