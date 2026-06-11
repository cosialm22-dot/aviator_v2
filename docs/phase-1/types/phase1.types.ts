/**
 * AVIATOR V2 - PHASE 1 TYPESCRIPT TYPES
 * 
 * Comprehensive type definitions for all Phase 1 features
 * Strict mode enabled - no implicit any
 * 
 * @author Backend Team
 * @version 1.0
 */

// ============================================
// M-PESA TYPES
// ============================================

/**
 * STK Push Request to Daraja API
 */
export interface STKPushRequest {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  TransactionType: 'CustomerPayBillOnline';
  Amount: number;
  PartyA: string;
  PartyB: string;
  PhoneNumber: string;
  CallBackURL: string;
  AccountReference: string;
  TransactionDesc: string;
}

/**
 * STK Push Response from Daraja API
 */
export interface STKPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

/**
 * STK Callback from Safaricom
 */
export interface STKCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{
          Name: string;
          Value: string | number;
        }>;
      };
    };
  };
}

/**
 * B2C Request to Daraja API
 */
export interface B2CRequest {
  InitiatorName: string;
  SecurityCredential: string;
  CommandID: 'BusinessPayment';
  Amount: number;
  PartyA: string;
  PartyB: string;
  Remarks: string;
  QueueTimeOutURL: string;
  ResultURL: string;
  Occasion: string;
}

/**
 * B2C Response from Daraja API
 */
export interface B2CResponse {
  ConversationID: string;
  OriginatorConversationID: string;
  ResponseCode: string;
  ResponseDescription: string;
}

/**
 * B2C Callback from Safaricom
 */
export interface B2CCallback {
  Result: {
    ResultType: number;
    ResultCode: number;
    ResultDesc: string;
    OriginatorConversationID: string;
    ConversationID: string;
    TransactionID: string;
    ResultParameters?: {
      ResultParameter: Array<{
        Key: string;
        Value: string | number;
      }>;
    };
  };
}

/**
 * OAuth Token Response from Daraja
 */
export interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: 'Bearer';
}

// ============================================
// DATABASE TYPES
// ============================================

/**
 * M-Pesa STK Request Record
 */
export interface MpesaSTKRequest {
  id: string;
  user_id: string;
  phone_number: string;
  amount: number;
  checkout_request_id: string;
  merchant_request_id: string | null;
  mpesa_receipt_number: string | null;
  result_code: number | null;
  result_desc: string | null;
  status: 'initiated' | 'pending' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  callback_payload: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * M-Pesa B2C Request Record
 */
export interface MpesaB2CRequest {
  id: string;
  withdrawal_request_id: string;
  user_id: string;
  phone_number: string;
  amount: number;
  conversation_id: string;
  originator_conversation_id: string | null;
  mpesa_receipt_number: string | null;
  result_code: number | null;
  result_desc: string | null;
  status: 'initiated' | 'pending' | 'processing' | 'completed' | 'failed' | 'timeout';
  callback_payload: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Enhanced Withdrawal Request
 */
export interface WithdrawalRequest {
  id: string;
  user_id: string;
  amount: number;
  phone_number: string;
  method: 'mpesa' | 'bank';
  status: 'pending' | 'approved' | 'processing' | 'completed' | 'rejected' | 'failed' | 'cancelled';
  risk_score: number;
  risk_flags: string[];
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  auto_approved: boolean;
  mpesa_receipt: string | null;
  created_at: string;
}

/**
 * Enhanced Game Round
 */
export interface GameRound {
  id: string;
  round_number: number | null;
  crash_multiplier: number;
  status: 'waiting' | 'flying' | 'crashed';
  started_at: string | null;
  crashed_at: string | null;
  source: 'algorithm' | 'queue';
  queue_id: string | null;
  total_bets_amount: number;
  total_payouts: number;
  round_profit: number;
  created_at: string;
}

/**
 * Crash Queue Item
 */
export interface CrashQueueItem {
  id: string;
  crash_point: number;
  position: number;
  status: 'pending' | 'used' | 'cancelled';
  added_by: string | null;
  used_at: string | null;
  used_in_round: string | null;
  batch_id: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * Enhanced Profile
 */
export interface Profile {
  id: string;
  username: string;
  avatar_color: string;
  total_deposited: number;
  total_withdrawn: number;
  total_wagered: number;
  total_won: number;
  last_active_at: string | null;
  risk_score: number;
  created_at: string;
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

/**
 * STK Push API Request
 */
export interface STKPushAPIRequest {
  amount: number;
  phone_number: string;
  user_id: string;
}

/**
 * STK Push API Response
 */
export interface STKPushAPIResponse {
  success: boolean;
  checkout_request_id?: string;
  merchant_request_id?: string;
  message: string;
  error?: string;
}

/**
 * B2C API Request
 */
export interface B2CAPIRequest {
  withdrawal_request_id: string;
  amount: number;
  phone_number: string;
}

/**
 * B2C API Response
 */
export interface B2CAPIResponse {
  success: boolean;
  conversation_id?: string;
  message: string;
  error?: string;
}

/**
 * Withdrawal Approval Request
 */
export interface WithdrawalApprovalRequest {
  withdrawal_id: string;
}

/**
 * Withdrawal Rejection Request
 */
export interface WithdrawalRejectionRequest {
  withdrawal_id: string;
  reason: string;
}

/**
 * Crash Queue Add Request
 */
export interface CrashQueueAddRequest {
  crash_point: number;
  batch_id?: string;
  notes?: string;
}

/**
 * Crash Queue Clear Request
 */
export interface CrashQueueClearRequest {
  confirmed: boolean;
}

/**
 * Dashboard Analytics Response
 */
export interface DashboardAnalytics {
  revenue_today: number;
  active_players_today: number;
  bets_today: number;
  pending_withdrawals: {
    count: number;
    amount: number;
  };
  house_edge_actual: number;
  crash_distribution: Record<string, number>;
  top_players: Array<{
    username: string;
    wagered: number;
    net_pl: number;
  }>;
}

/**
 * Withdrawals Queue Response
 */
export interface WithdrawalsQueueResponse {
  total: number;
  items: Array<{
    id: string;
    user_id: string;
    username: string;
    amount: number;
    phone: string;
    risk_score: number;
    status: string;
    created_at: string;
    auto_approved: boolean;
  }>;
}

/**
 * Crash Queue Response
 */
export interface CrashQueueResponse {
  queue: CrashQueueItem[];
  total_queued: number;
}

// ============================================
// ERROR TYPES
// ============================================

/**
 * API Error Response
 */
export interface APIError {
  success: false;
  error: string;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * M-Pesa Error Codes
 */
export enum MpesaErrorCode {
  INSUFFICIENT_BALANCE = 1,
  USER_CANCELLED = 1032,
  DS_TIMEOUT = 1037,
  WRONG_PIN = 2001,
  UNABLE_TO_LOCK = 1001,
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INVALID_PHONE = 'INVALID_PHONE',
  RATE_LIMITED = 'RATE_LIMITED',
  DARAJA_ERROR = 'DARAJA_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_IP = 'INVALID_IP',
  DUPLICATE_CALLBACK = 'DUPLICATE_CALLBACK',
}

// ============================================
// VALIDATION TYPES
// ============================================

/**
 * Validation Result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Amount Validation
 */
export interface AmountValidation {
  min: number;
  max: number;
  currency: string;
}

/**
 * Phone Number Validation
 */
export interface PhoneValidation {
  pattern: RegExp;
  minLength: number;
  maxLength: number;
  countryCode: string;
}

// ============================================
// REALTIME TYPES
// ============================================

/**
 * Realtime Event Payload
 */
export interface RealtimeEventPayload {
  type: 'deposit' | 'withdrawal' | 'fraud_alert' | 'withdrawal_approved' | 'withdrawal_rejected';
  data: Record<string, unknown>;
  timestamp: string;
  admin_id?: string;
}

/**
 * Admin Alert
 */
export interface AdminAlert {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  acknowledged: boolean;
  acknowledged_by?: string;
  acknowledged_at?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// ============================================
// UTILITY TYPES
// ============================================

/**
 * Pagination Query
 */
export interface PaginationQuery {
  limit: number;
  offset: number;
  sort_by?: string;
  order?: 'asc' | 'desc';
}

/**
 * Pagination Response
 */
export interface PaginationResponse<T> {
  total: number;
  items: T[];
  limit: number;
  offset: number;
}

/**
 * Risk Score Breakdown
 */
export interface RiskScoreBreakdown {
  win_rate_score: number;
  bet_pattern_score: number;
  financial_score: number;
  account_age_score: number;
  session_score: number;
  multi_account_score: number;
  velocity_score: number;
  total_score: number;
}

/**
 * Audit Log Entry
 */
export interface AuditLogEntry {
  id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

// ============================================
// CONFIGURATION TYPES
// ============================================

/**
 * M-Pesa Configuration
 */
export interface MpesaConfig {
  consumer_key: string;
  consumer_secret: string;
  shortcode: string;
  passkey: string;
  environment: 'sandbox' | 'production';
  callback_base_url: string;
  min_deposit: number;
  max_deposit: number;
  min_withdrawal: number;
  max_withdrawal: number;
  auto_approve_threshold: number;
  daily_withdrawal_limit: number;
}

/**
 * Withdrawal Rules
 */
export interface WithdrawalRules {
  min_amount: number;
  max_amount: number;
  daily_limit: number;
  wagering_requirement: number;
  min_account_age_hours: number;
  auto_approve_max: number;
  cooldown_minutes: number;
  max_daily_requests: number;
}

/**
 * Risk Scoring Rules
 */
export interface RiskScoringRules {
  win_rate_weight: number;
  bet_pattern_weight: number;
  financial_weight: number;
  account_age_weight: number;
  session_weight: number;
  multi_account_weight: number;
  velocity_weight: number;
  high_risk_threshold: number;
  critical_risk_threshold: number;
}

// ============================================
// EXPORT ALL TYPES
// ============================================

export type {
  STKPushRequest,
  STKPushResponse,
  STKCallback,
  B2CRequest,
  B2CResponse,
  B2CCallback,
  OAuthTokenResponse,
  MpesaSTKRequest,
  MpesaB2CRequest,
  WithdrawalRequest,
  GameRound,
  CrashQueueItem,
  Profile,
  STKPushAPIRequest,
  STKPushAPIResponse,
  B2CAPIRequest,
  B2CAPIResponse,
  WithdrawalApprovalRequest,
  WithdrawalRejectionRequest,
  CrashQueueAddRequest,
  CrashQueueClearRequest,
  DashboardAnalytics,
  WithdrawalsQueueResponse,
  CrashQueueResponse,
  APIError,
  ValidationResult,
  AmountValidation,
  PhoneValidation,
  RealtimeEventPayload,
  AdminAlert,
  PaginationQuery,
  PaginationResponse,
  RiskScoreBreakdown,
  AuditLogEntry,
  MpesaConfig,
  WithdrawalRules,
  RiskScoringRules,
};
