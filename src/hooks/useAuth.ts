import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, Wallet } from '../types';

/*
 * Phone-based signup/signin. No service key. No OTP.
 *
 * SIGNUP: supabase.auth.signUp() -> DB trigger creates profile + wallet + bonus
 * SIGNIN: supabase.auth.signInWithPassword()
 *
 * SECURITY: All error messages shown to users are generic.
 * Raw errors logged to console (dev only), never exposed to UI.
 */

function phoneToEmail(phone: string): string {
  return `${phone}@phone.aviator.ke`;
}

/**
 * Sanitize any error into a user-safe message.
 * NEVER expose raw backend errors, stack traces, or infrastructure details.
 */
function sanitizeAuthError(error: { message?: string } | null, context: 'signup' | 'signin'): string {
  if (!error?.message) return 'Something went wrong. Please try again.';

  const msg = error.message.toLowerCase();

  // --- Signup-specific mappings ---
  if (context === 'signup') {
    if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('user already exists')) {
      return 'This phone number is already registered. Sign in instead.';
    }
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('username')) {
      return 'Username is taken. Try another.';
    }
    if (msg.includes('email') && msg.includes('disabled')) {
      // "Email signups are disabled" - config issue, but user doesn't need to know why
      return 'Signup is temporarily unavailable. Please try again later.';
    }
    if (msg.includes('password') && (msg.includes('short') || msg.includes('weak') || msg.includes('length'))) {
      return 'Password is too short. Use at least 6 characters.';
    }
  }

  // --- Signin-specific mappings ---
  if (context === 'signin') {
    if (msg.includes('invalid') || msg.includes('credentials') || msg.includes('unauthorized')) {
      return 'Wrong phone number or password.';
    }
    if (msg.includes('banned') || msg.includes('disabled')) {
      return 'Account suspended. Contact support.';
    }
  }

  // --- Generic mappings (both contexts) ---
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
    return 'Connection error. Check your internet and try again.';
  }
  if (msg.includes('rate') || msg.includes('limit') || msg.includes('too many')) {
    return 'Too many attempts. Wait a moment and try again.';
  }

  // Fallback: NEVER show the raw message
  return 'Something went wrong. Please try again.';
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
      // Log full error for developer debugging (never shown to user)
      console.error('[Auth] Signup failed:', error.message, error);
      throw new Error(sanitizeAuthError(error, 'signup'));
    }

    if (!data.session) {
      // Config issue: email confirmation is still enabled.
      // Log for developer, show generic message to user.
      console.error('[Auth] No session returned. Email confirmation likely still enabled.');
      throw new Error('Signup is temporarily unavailable. Please try again later.');
    }
  };

  const signIn = async (phone: string, password: string) => {
    const email = phoneToEmail(phone);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('[Auth] Signin failed:', error.message, error);
      throw new Error(sanitizeAuthError(error, 'signin'));
    }
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
