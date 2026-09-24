import { describe, it, expect } from 'vitest';
import { normalizeKenyanPhone, isValidKenyanPhone, toDarajaMsisdn, localNine } from './phone';

describe('normalizeKenyanPhone', () => {
  it('prepends 254 to a 9-digit 7XX/1XX number', () => {
    expect(normalizeKenyanPhone('712345678')).toBe('254712345678');
    expect(normalizeKenyanPhone('112345678')).toBe('254112345678');
  });
  it('converts a leading-0 10-digit number', () => {
    expect(normalizeKenyanPhone('0712345678')).toBe('254712345678');
  });
  it('passes through an already-canonical 254 number', () => {
    expect(normalizeKenyanPhone('254712345678')).toBe('254712345678');
  });
  it('strips spaces, dashes and +', () => {
    expect(normalizeKenyanPhone('+254 712-345 678')).toBe('254712345678');
    expect(normalizeKenyanPhone('0712 345 678')).toBe('254712345678');
  });
});

describe('isValidKenyanPhone', () => {
  it('accepts 7XX and 1XX mobiles in every accepted shape', () => {
    expect(isValidKenyanPhone('712345678')).toBe(true);
    expect(isValidKenyanPhone('0712345678')).toBe(true);
    expect(isValidKenyanPhone('254712345678')).toBe(true);
    expect(isValidKenyanPhone('254112345678')).toBe(true);
  });
  it('rejects non-mobile leading digits, wrong lengths and junk', () => {
    expect(isValidKenyanPhone('012345678')).toBe(false);   // leads with 0, not 7/1 after norm
    expect(isValidKenyanPhone('254012345678')).toBe(false); // 0 after country code
    expect(isValidKenyanPhone('71234567')).toBe(false);     // too short
    expect(isValidKenyanPhone('2547123456789')).toBe(false);// too long
    expect(isValidKenyanPhone('')).toBe(false);
    expect(isValidKenyanPhone('abcdefghi')).toBe(false);
  });
});

describe('toDarajaMsisdn', () => {
  it('returns the canonical MSISDN for valid input', () => {
    expect(toDarajaMsisdn('0712345678')).toBe('254712345678');
  });
  it('returns null for invalid input', () => {
    expect(toDarajaMsisdn('012345678')).toBeNull();
    expect(toDarajaMsisdn('')).toBeNull();
  });
});

describe('localNine (cashier phone field after +254)', () => {
  it('keeps the 9 local digits however the number is typed or pasted', () => {
    expect(localNine('712345678')).toBe('712345678');
    expect(localNine('0712345678')).toBe('712345678');
    expect(localNine('254712345678')).toBe('712345678');
    expect(localNine('+254 712 345 678')).toBe('712345678');
    expect(localNine('0110 123 456')).toBe('110123456');
  });
  it('never grows past 9 digits', () => {
    expect(localNine('71234567899')).toBe('712345678');
  });
});
