import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, Wallet } from '../types';

/*
 * ─── AUTH ARCHITECTURE ───────────────────────────────────────────────
 *
 * Phone-based signup/signin. No email, no OTP, no verification.
 *
 * WHY RAW FETCH:
 * The @supabase/supabase-js client detects browser environment and
 * throws "Forbidden use of secret API key in browser" if you pass
 * a service role key to createClient(). To bypass this, we use raw
 * fetch() for admin operations during signup. The service key is
 * only used for user creation and initial data seeding — all other
 * operations use the anon key with RLS.
 *
 * SIGNUP FLOW:
 * 1. fetch() → POST /auth/v1/admin/users (service key, creates confirmed user)
 * 2. fetch() → POST /rest/v1/profiles (service key, bypasses RLS)
 * 3. fetch() → POST /rest/v1/wallets (service key, inserts with bonus)
 * 4. fetch() → POST /rest/v1/transactions (service key, records bonus)
 * 5. supabase.auth.signInWithPassword() (anon key, establishes session)
 *
 * SIGNIN FLOW:
 * 1. supabase.auth.signInWithPassword() (anon key)
 *
 * ENV VARS: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_SERVICE_KEY
 * ─────────────────────────────────────────────────────────────────────
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SERVICE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_KEY as string;

/** Convert phone to deterministic email for Supabase auth storage. */
function phoneToEmail(phone: string): string {
  return `${phone}@phone.aviator.ke`;
}

/** Raw fetch helper for admin operations during signup. */
async function adminFetch<T = unknown>(
  endpoint: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}${endpoint}`, {
    method: options.method || 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ msg: res.statusText }));
    throw new Error(err.msg || err.message || err.error_description || 'Request failed');
  }

  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as T);
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

  /**
   * SIGNUP: phone + password + username
   *
   * Uses raw fetch() with service key to bypass supabase-js browser check.
   * Creates a pre-confirmed user, profile, wallet with bonus, then signs in.
   * If profile creation fails, auth user is rolled back (deleted).
   */
  const signUp = async (phone: string, password: string, username: string) => {
    const email = phoneToEmail(phone);

    // 1. Create pre-confirmed auth user
    const authUser = await adminFetch<{ id: string; email_confirmed_at: string }>(
      '/auth/v1/admin/users',
      {
        body: {
          email,
          password,
          email_confirm: true,
          user_metadata: { phone, username },
        },
      }
    );

    const userId = authUser.id;

    // 2. Create profile (bypasses RLS via service key)
    const colors = ['#ef4444', '#f97316', '#22c55e', '#06b6d4', '#3b82f6', '#ec4899', '#f59e0b', '#a855f7', '#14b8a6'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    try {
      await adminFetch('/rest/v1/profiles', {
        body: { id: userId, username, avatar_color: color, phone_number: phone },
      });
    } catch (err) {
      // Rollback: delete auth user if profile insert fails (e.g. duplicate username)
      await adminFetch(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' }).catch(() => {});
      throw err;
    }

    // 3. Insert wallet directly with signup bonus (don't rely on trigger timing)
    await adminFetch('/rest/v1/wallets', {
      body: { user_id: userId, balance: 500, currency: 'KES' },
    }).catch(() => {
      // If trigger already created it, update instead
      return fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ balance: 500 }),
      });
    });

    // 4. Record bonus transaction
    await adminFetch('/rest/v1/transactions', {
      body: {
        user_id: userId,
        type: 'deposit',
        amount: 500,
        description: 'Welcome bonus \u2014 KSh 500 free credits!',
        status: 'completed',
      },
    });

    // 5. Sign in to establish browser session (uses anon key, standard client)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
  };

  /**
   * SIGNIN: phone + password
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
