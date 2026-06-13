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
