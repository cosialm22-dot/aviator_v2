import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile, Wallet } from '../types';

/*
 * ─── AUTH ARCHITECTURE ───────────────────────────────────────────────
 *
 * Phone-based authentication without OTP or email verification.
 *
 * HOW IT WORKS:
 * - Supabase requires an email for password auth. We derive a
 *   deterministic fake email from the phone: {phone}@phone.aviator.ke
 * - Signup uses the Admin API (service role key) to create a
 *   pre-confirmed user. This bypasses email verification entirely.
 * - Signin uses the anon key with signInWithPassword.
 * - The real phone number is stored in profiles.phone_number.
 * - No OTP, no email confirmation, no magic links.
 *
 * ENV VARS REQUIRED:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *   VITE_SUPABASE_SERVICE_KEY
 *
 * DB DEPENDENCIES:
 *   - profiles table (id, username, avatar_color, phone_number)
 *   - wallets table (user_id, balance, currency)
 *   - transactions table (user_id, type, amount, description, status)
 *   - Trigger: on_profile_created → auto-creates wallet with 0 balance
 *   - Signup bonus: wallet updated to 500 after creation
 *
 * ─────────────────────────────────────────────────────────────────────
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY as string;

// Admin client: used ONLY for user creation during signup.
// autoRefreshToken=false and persistSession=false because this client
// never holds a user session — it's purely for admin operations.
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Convert phone number to deterministic email for Supabase auth. */
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

  // Initialize session on mount + listen for auth changes
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
   * Steps:
   * 1. Create auth user via admin API (pre-confirmed)
   * 2. Insert profile row (triggers wallet creation via DB trigger)
   * 3. Wait for trigger → update wallet balance to 500 (signup bonus)
   * 4. Record bonus transaction
   * 5. Sign in to establish browser session
   */
  const signUp = async (phone: string, password: string, username: string) => {
    const email = phoneToEmail(phone);

    // 1. Create pre-confirmed user
    const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { phone, username },
    });

    if (adminError) {
      // Surface meaningful error messages
      if (adminError.message.includes('already been registered')) {
        throw new Error('This phone number is already registered. Sign in instead.');
      }
      throw adminError;
    }
    if (!adminData.user) throw new Error('Sign up failed. Please try again.');

    const userId = adminData.user.id;

    // 2. Create profile (this triggers wallet creation via DB trigger)
    const colors = ['#ef4444', '#f97316', '#22c55e', '#06b6d4', '#3b82f6', '#ec4899', '#f59e0b', '#a855f7', '#14b8a6'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: userId,
      username,
      avatar_color: color,
      phone_number: phone,
    });

    if (profileError) {
      // Rollback auth user if profile insert fails (e.g. duplicate username)
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw profileError;
    }

    // 3. Wait for wallet trigger to execute, then set signup bonus
    await new Promise(resolve => setTimeout(resolve, 400));
    await supabaseAdmin
      .from('wallets')
      .update({ balance: 500 })
      .eq('user_id', userId);

    // 4. Record the bonus transaction
    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      type: 'deposit',
      amount: 500,
      description: 'Welcome bonus \u2014 KSh 500 free credits!',
      status: 'completed',
    });

    // 5. Sign in to establish browser session (uses anon key)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw signInError;

    return adminData;
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

  /** Sign out and clear all state. */
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  /** Refresh wallet balance (call after bet/cashout/deposit/withdraw). */
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
