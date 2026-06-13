// Marketing / affiliate types. Shapes mirror the SECURITY DEFINER RPCs in
// migration 20260613070000_marketing_affiliate_system.sql.

export type CommissionPayoutStatus = 'pending' | 'approved' | 'paid' | 'rejected';

export interface CommissionPayout {
  id: string;
  amount: number;
  phone_number: string;
  status: CommissionPayoutStatus;
  mpesa_receipt: string | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

// marketer_dashboard() return
export interface MarketerDashboard {
  referral_code: string;
  commission_rate: number;        // fraction in [0,1]
  referred_count: number;
  qualified_count: number;
  lifetime_ggr: number;
  commission_earned: number;
  commission_paid: number;
  commission_pending: number;
  commission_approved: number;
  commission_available: number;
  payouts: CommissionPayout[];
}

// admin_commission_overview() return
export interface AdminCommissionOverview {
  commission_rate: number;
  pending_count: number;
  pending_amount: number;
  paid_total: number;
  can_edit_rate: boolean;
}

// admin_list_commission_payouts() row
export interface AdminCommissionPayoutRow {
  id: string;
  marketer_id: string;
  marketer_username: string;
  amount: number;
  phone_number: string;
  status: CommissionPayoutStatus;
  review_note: string | null;
  rejection_reason: string | null;
  mpesa_receipt: string | null;
  reviewed_by: string | null;
  reviewer_username: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

// ============================================================================
// Admin Marketing hub types (affiliate + promotions management).
// Shapes mirror the RPCs in migration 20260613080000_marketing_admin_expansion.
// ============================================================================

// admin_affiliate_overview() return (jsonb)
export interface AdminAffiliateOverview {
  marketer_count: number;
  referred_count: number;
  qualified_count: number;
  lifetime_ggr: number;
  commission_earned: number;
  commission_paid: number;
  commission_available: number;
  commission_rate: number;        // fraction in [0,1]
  qualifying_deposit_min: number; // KSh
  can_edit_rate: boolean;         // true for super_admin
}

// admin_list_affiliates() row
export interface AffiliateRow {
  marketer_id: string;
  username: string;
  referral_code: string | null;
  is_banned: boolean;
  created_at: string;
  referred_count: number;
  qualified_count: number;
  lifetime_ggr: number;
  commission_earned: number;
  commission_paid: number;
  commission_pending: number;
  commission_approved: number;
  commission_available: number;
}

// admin_affiliate_referrals(marketer) row
export interface AffiliateReferralRow {
  player_id: string;
  username: string;
  status: 'pending' | 'qualified';
  first_deposit_amount: number | null;
  qualified_at: string | null;
  created_at: string;
  player_ggr: number;
}

export type PromotionCategory =
  | 'welcome' | 'deposit_match' | 'cashback' | 'free_bet' | 'tournament' | 'general';
export type PromotionRewardKind = 'percentage' | 'fixed' | 'none';
export type PromotionRuntimeStatus = 'inactive' | 'scheduled' | 'expired' | 'live';

// admin_list_promotions() row
export interface Promotion {
  id: string;
  title: string;
  description: string;
  category: PromotionCategory;
  reward_kind: PromotionRewardKind;
  reward_value: number;
  min_deposit: number;
  max_reward: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  display_order: number;
  runtime_status: PromotionRuntimeStatus;
  created_at: string;
  updated_at: string;
}

// Payload for admin_upsert_promotion(p_id, p_data jsonb). Dates are ISO strings
// or null; the RPC validates and persists.
export interface PromotionInput {
  title: string;
  description: string;
  category: PromotionCategory;
  reward_kind: PromotionRewardKind;
  reward_value: number;
  min_deposit: number;
  max_reward: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  display_order: number;
}
