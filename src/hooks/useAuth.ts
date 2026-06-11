import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, Wallet } from '../types';

/**
 * Phone-based auth hook.
 *
 * Strategy: Supabase requires email for password auth. We derive a
 * deterministic fake email from the phone number (e.g. 254712345678@aviator.local).
 * The real phone is stored in profiles.phone_number.
 *
 * This avoids needing Supabase Phone Auth (which requires OTP/Twilio).
 * Login is phone + password. No email is ever shown to the user.
 */
function phoneToEmail(phone: string): string {
  return `${phone}@aviator.local`;
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
        const email = session.user.email ?? '';
        const phone = email.replace('@aviator.local', '');
        setUser({ id: session.user.id, phone });
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        if (session?.user) {
          const email = session.user.email ?? '';
          const phone = email.replace('@aviator.local', '');
          setUser({ id: session.user.id, phone });
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

  /**
   * Sign up with phone number + password + username.
   * Creates auth user, profile (with phone_number), wallet, and bonus transaction.
   */
  const signUp = async (phone: string, password: string, username: string) => {
    const email = phoneToEmail(phone);

    // Disable email confirmation by passing emailRedirectTo as undefined
    // Supabase project must have "Enable email confirmations" DISABLED in Auth settings
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { phone, username },
      },
    });
    if (error) throw error;
    if (!data.user) throw new Error('Sign up failed. Please try again.');

    // Generate random avatar color
    const colors = ['#ef4444', '#f97316', '#22c55e', '#06b6d4', '#3b82f6', '#ec4899', '#f59e0b', '#a855f7', '#14b8a6'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    // Create profile with phone number
    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      username,
      avatar_color: color,
      phone_number: phone,
    });
    if (profileError) throw profileError;

    // The DB trigger auto-creates a wallet with 0 balance.
    // We update it to 500 for the signup bonus.
    // Small delay to let trigger execute first.
    await new Promise(r => setTimeout(r, 300));

    await supabase
      .from('wallets')
      .update({ balance: 500 })
      .eq('user_id', data.user.id);

    // Record the bonus transaction
    await supabase.from('transactions').insert({
      user_id: data.user.id,
      type: 'deposit',
      amount: 500,
      description: 'Welcome bonus \u2014 KSh 500 free credits!',
      status: 'completed',
    });

    return data;
  };

  /**
   * Sign in with phone number + password.
   */
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
