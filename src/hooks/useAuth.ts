import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile, Wallet } from '../types';

/**
 * Phone-based auth hook.
 *
 * Architecture:
 * - Signup: Uses Supabase Admin API (service role) to create a pre-confirmed user.
 *   This bypasses email verification entirely. The phone number is stored in
 *   profiles.phone_number. A deterministic email is derived from the phone
 *   (e.g. 254712345678@phone.aviator.ke) so Supabase has a valid email field.
 *
 * - Signin: Uses standard signInWithPassword with the derived email.
 *
 * - No OTP, no email verification, no magic links.
 *
 * Security note: The service role key is used only for user creation (signup).
 * All other operations use the anon key with RLS. This is acceptable for a
 * gambling platform without a separate backend service.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY as string;

// Admin client — only used for creating pre-confirmed users during signup
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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
        const email = session.user.email ?? '';
        const phone = email.replace('@phone.aviator.ke', '');
        setUser({ id: session.user.id, phone });
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        if (session?.user) {
          const email = session.user.email ?? '';
          const phone = email.replace('@phone.aviator.ke', '');
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
   * Sign up: phone + password + username.
   *
   * Flow:
   * 1. Create user via admin API (pre-confirmed, no email verification)
   * 2. Create profile with phone_number
   * 3. Wait for wallet trigger, then set balance to 500 (signup bonus)
   * 4. Record bonus transaction
   * 5. Sign in with anon key to establish browser session
   */
  const signUp = async (phone: string, password: string, username: string) => {
    const email = phoneToEmail(phone);

    // Step 1: Create pre-confirmed user via admin API
    const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { phone, username },
    });
    if (adminError) throw adminError;
    if (!adminData.user) throw new Error('Sign up failed. Please try again.');

    const userId = adminData.user.id;

    // Step 2: Create profile
    const colors = ['#ef4444', '#f97316', '#22c55e', '#06b6d4', '#3b82f6', '#ec4899', '#f59e0b', '#a855f7', '#14b8a6'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: userId,
      username,
      avatar_color: color,
      phone_number: phone,
    });
    if (profileError) {
      // Rollback: delete the auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw profileError;
    }

    // Step 3: Wait for wallet trigger, then update balance to 500
    await new Promise(r => setTimeout(r, 400));
    await supabaseAdmin
      .from('wallets')
      .update({ balance: 500 })
      .eq('user_id', userId);

    // Step 4: Record bonus transaction
    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      type: 'deposit',
      amount: 500,
      description: 'Welcome bonus \u2014 KSh 500 free credits!',
      status: 'completed',
    });

    // Step 5: Sign in to establish session
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    return adminData;
  };

  /**
   * Sign in: phone + password.
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
