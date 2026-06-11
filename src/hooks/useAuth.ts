import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, Wallet } from '../types';

/*
 * Phone-based signup/signin. No service key. No OTP.
 *
 * SIGNUP: supabase.auth.signUp() -> DB trigger creates profile + wallet + bonus
 * SIGNIN: supabase.auth.signInWithPassword()
 *
 * PREREQUISITE: Disable "Confirm email" in Supabase Auth settings.
 */

function phoneToEmail(phone: string): string {
  return `${phone}@phone.aviator.ke`;
}

export function useAuth() {
  const [user, setUser] = useState<{ id: string; phone: string } | null>(null);
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
        const phone = (session.user.email ?? '').replace('@phone.aviator.ke', '');
        setUser({ id: session.user.id, phone });
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const phone = (session.user.email ?? '').replace('@phone.aviator.ke', '');
        setUser({ id: session.user.id, phone });
        fetchProfile(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
        setWallet(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signUp = async (phone: string, password: string, username: string) => {
    const email = phoneToEmail(phone);
    const colors = ['#ef4444', '#f97316', '#22c55e', '#06b6d4', '#3b82f6', '#ec4899', '#f59e0b', '#a855f7', '#14b8a6'];
    const avatar_color = colors[Math.floor(Math.random() * colors.length)];

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { phone, username, avatar_color },
      },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already been registered')) {
        throw new Error('This phone number is already registered. Sign in instead.');
      }
      if (msg.includes('username') || msg.includes('unique') || msg.includes('duplicate')) {
        throw new Error('Username is taken. Try another.');
      }
      if (msg.includes('username is required')) {
        throw new Error('Username is required.');
      }
      if (msg.includes('at least 3 characters')) {
        throw new Error('Username must be at least 3 characters.');
      }
      throw error;
    }

    if (!data.session) {
      throw new Error(
        'Account created but session not established. ' +
        'Disable "Confirm email" in Supabase Auth settings.'
      );
    }
  };

  const signIn = async (phone: string, password: string) => {
    const email = phoneToEmail(phone);
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
