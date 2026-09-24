import { describe, it, expect } from 'vitest';
import {
  adminDepositError, attentionReason, canCheckNow, canConfirmByHand, maskPhone, normaliseReceipt,
  ORPHAN_REASON, relTime, successRate, type DepositRow,
} from './deposits';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const row = (o: Partial<DepositRow>): DepositRow => ({
  id: 'd', created_at: '2026-09-25T11:55:00Z', user_id: 'u', phone_number: '254712345678', amount: 500,
  status: 'pending', provider_status: null, result_description: null, mpesa_receipt_number: null,
  checkout_request_id: 'TR1', merchant_request_id: null, check_count: 0, last_checked_at: null,
  completed_at: null, reference: 'AVIATOR', site_id: 's', ...o,
});

describe('deposit triage', () => {
  it('flags orphans, old unconfirmed deposits and amount mismatches — nothing else', () => {
    expect(attentionReason(row({}), NOW)).toBeNull();
    expect(attentionReason(row({ status: 'timeout', created_at: '2026-09-25T11:30:00Z' }), NOW)).toBeNull();
    expect(attentionReason(row({ status: 'timeout', created_at: '2026-09-25T10:30:00Z' }), NOW)).toMatch(/over an hour/);
    expect(attentionReason(row({ status: 'failed', result_description: ORPHAN_REASON }), NOW)).toMatch(/no answer/);
    expect(attentionReason(row({ status: 'failed', result_description: 'Mega Pay: Cancelled' }), NOW)).toBeNull();
    expect(attentionReason(row({ status: 'timeout', provider_status: 'AMOUNT_MISMATCH 10' }), NOW)).toMatch(/different amount/);
    expect(attentionReason(row({ status: 'completed', provider_status: 'AMOUNT_MISMATCH 10' }), NOW)).toBeNull();
  });
  it('allows a hand confirmation exactly where the server does', () => {
    expect(canConfirmByHand(row({ status: 'timeout' }))).toBe(true);
    expect(canConfirmByHand(row({ status: 'failed', result_description: ORPHAN_REASON }))).toBe(true);
    expect(canConfirmByHand(row({ status: 'failed', result_description: 'Mega Pay: Cancelled' }))).toBe(false);
    expect(canConfirmByHand(row({ status: 'pending' }))).toBe(false);
    expect(canConfirmByHand(row({ status: 'completed' }))).toBe(false);
    expect(canConfirmByHand(row({ status: 'timeout', provider_status: 'AMOUNT_MISMATCH 10' }))).toBe(false);
  });
  it('re-checks only open deposits that have a Mega Pay id', () => {
    expect(canCheckNow(row({ status: 'pending' }))).toBe(true);
    expect(canCheckNow(row({ status: 'timeout' }))).toBe(true);
    expect(canCheckNow(row({ status: 'pending', checkout_request_id: 'mp-pending:abc' }))).toBe(false);
    expect(canCheckNow(row({ status: 'completed' }))).toBe(false);
  });
});

describe('formatting', () => {
  it('normalises receipts like the server', () => {
    expect(normaliseReceipt(' sab12cd34x ')).toBe('SAB12CD34X');
    expect(normaliseReceipt('SAB1-234')).toBeNull();
    expect(normaliseReceipt('SHORT')).toBeNull();
  });
  it('masks phone numbers', () => {
    expect(maskPhone('254712345678')).toBe('0712 •••678');
    expect(maskPhone('0110123456')).toBe('0110 •••456');
    expect(maskPhone(null)).toBe('—');
  });
  it('relative times and success rate', () => {
    expect(relTime('2026-09-25T11:59:30Z', NOW)).toBe('30s ago');
    expect(relTime('2026-09-25T11:00:00Z', NOW)).toBe('1h ago');
    expect(relTime('2026-09-23T12:00:00Z', NOW)).toBe('2d ago');
    expect(relTime(null, NOW)).toBe('—');
    expect(successRate(3, 4)).toBe('75%');
    expect(successRate(0, 0)).toBe('—');
  });
  it('maps server errors to staff copy and passes range messages through', () => {
    expect(adminDepositError('RECEIPT_ALREADY_USED')).toMatch(/already attached/);
    expect(adminDepositError('INVALID_RANGE: minimum cannot exceed maximum')).toBe('minimum cannot exceed maximum');
    expect(adminDepositError('relation x does not exist')).toBe('Something went wrong. Please try again.');
  });
});
