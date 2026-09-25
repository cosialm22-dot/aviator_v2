// vitest (Node): Daraja B2C client request shapes, token caching, the sent/unknown classification
// that decides whether a payout may ever be resent, and parsing of Safaricom's callbacks
// (sample bodies from the Daraja documentation).
import { describe, expect, it } from 'vitest';
import { daraja, darajaConfig, DarajaError, missing, parseBalance, parseCallback } from './daraja';

const row = {
  config: { shortcode: '600000', initiator_name: 'apiop', command_id: 'BusinessPayment', env: 'production' },
  secrets: { consumer_key: 'ck', consumer_secret: 'cs', security_credential: 'SC==' },
};
type Call = { url: string; method?: string; body?: Record<string, unknown>; auth?: string };
function fake(responses: ((c: Call) => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  let i = 0;
  const f = async (url: string, init?: RequestInit) => {
    const c: Call = { url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>)?.Authorization };
    calls.push(c);
    const r = responses[Math.min(i++, responses.length - 1)];
    return r(c);
  };
  return { f, calls };
}
const ok = (j: unknown, status = 200) => () => new Response(JSON.stringify(j), { status });
const tokenOk = ok({ access_token: 'TKN', expires_in: '3599' });
const pay = { originatorId: '11111111-2222-3333-4444-555555555555', amountKes: 500, msisdn: '254712000001', remarks: 'Withdrawal', occasion: 'W-1', resultUrl: 'https://x/r', timeoutUrl: 'https://x/t' };

describe('config', () => {
  it('maps an integrations row, production by default', () => {
    const c = darajaConfig(row);
    expect(c).toMatchObject({ env: 'production', baseUrl: 'https://api.safaricom.co.ke', shortcode: '600000', initiatorName: 'apiop', commandId: 'BusinessPayment' });
    expect(missing(c)).toEqual([]);
    expect(darajaConfig({ config: { ...row.config, env: 'sandbox' }, secrets: row.secrets }).baseUrl).toBe('https://sandbox.safaricom.co.ke');
    expect(darajaConfig({ config: { ...row.config, api_base: 'https://mock.example/' }, secrets: row.secrets }).baseUrl).toBe('https://mock.example');
    expect(missing(darajaConfig({ config: {}, secrets: {} }))).toHaveLength(5);
  });
});

describe('B2C request', () => {
  it('signs in once and sends the documented v3 body with our OriginatorConversationID', async () => {
    const { f, calls } = fake([tokenOk, ok({ ConversationID: 'AG_1', OriginatorConversationID: pay.originatorId, ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' })]);
    const d = daraja(darajaConfig(row), f);
    const r = await d.b2c(pay);
    expect(calls[0].url).toBe('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials');
    expect(calls[0].auth).toBe(`Basic ${Buffer.from('ck:cs').toString('base64')}`);
    expect(calls[1].url).toBe('https://api.safaricom.co.ke/mpesa/b2c/v3/paymentrequest');
    expect(calls[1].auth).toBe('Bearer TKN');
    expect(calls[1].body).toEqual({
      OriginatorConversationID: pay.originatorId, InitiatorName: 'apiop', SecurityCredential: 'SC==', CommandID: 'BusinessPayment',
      Amount: 500, PartyA: '600000', PartyB: '254712000001', Remarks: 'Withdrawal', QueueTimeOutURL: 'https://x/t', ResultURL: 'https://x/r', Occasion: 'W-1',
    });
    expect(r).toMatchObject({ conversationId: 'AG_1', code: '0' });
  });
  it('reuses the token until it expires', async () => {
    let t = 0;
    const accepted = ok({ ConversationID: 'AG', ResponseCode: '0' });
    const { f, calls } = fake([tokenOk, accepted, accepted, tokenOk, accepted]);
    const d = daraja(darajaConfig(row), f, () => t);
    await d.b2c(pay); await d.b2c(pay);
    expect(calls.filter((c) => c.url.includes('oauth'))).toHaveLength(1);
    t = 4 * 3600 * 1000;
    await d.b2c(pay);
    expect(calls.filter((c) => c.url.includes('oauth'))).toHaveLength(2);
  });
  it('bad app credentials: definite (nothing was sent)', async () => {
    const { f } = fake([ok({ errorMessage: 'Invalid credentials' }, 400)]);
    const e = await daraja(darajaConfig(row), f).b2c(pay).catch((x) => x);
    expect(e).toBeInstanceOf(DarajaError);
    expect(e.definite).toBe(true);
  });
  it('a 4xx refusal is definite', async () => {
    const { f } = fake([tokenOk, ok({ requestId: 'r', errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid Initiator' }, 400)]);
    const e = await daraja(darajaConfig(row), f).b2c(pay).catch((x) => x);
    expect(e).toMatchObject({ definite: true, code: '400.002.02', message: 'Bad Request - Invalid Initiator' });
  });
  it('a 200 with a non-zero ResponseCode is definite', async () => {
    const { f } = fake([tokenOk, ok({ ResponseCode: '1', ResponseDescription: 'Rejected' })]);
    expect((await daraja(darajaConfig(row), f).b2c(pay).catch((x) => x)).definite).toBe(true);
  });
  it('a 5xx or no answer is UNKNOWN (may have been queued: never resend)', async () => {
    const five = fake([tokenOk, ok({ errorCode: '500.003.1001', errorMessage: 'Internal Server Error' }, 500)]);
    expect((await daraja(darajaConfig(row), five.f).b2c(pay).catch((x) => x)).definite).toBe(false);
    const empty = fake([tokenOk, () => new Response('', { status: 503 })]);
    expect((await daraja(darajaConfig(row), empty.f).b2c(pay).catch((x) => x)).definite).toBe(false);
    const dead = fake([tokenOk, () => { throw new Error('connection reset'); }]);
    expect((await daraja(darajaConfig(row), dead.f).b2c(pay).catch((x) => x)).definite).toBe(false);
  });
  it('never puts secrets in an error', async () => {
    const { f } = fake([tokenOk, ok({ errorCode: '400.002.02', errorMessage: 'bad' }, 400)]);
    const e = await daraja(darajaConfig(row), f).b2c(pay).catch((x) => x);
    expect(e.message).not.toMatch(/SC==|cs|ck:/);
  });
  it('transaction status and account balance bodies', async () => {
    const { f, calls } = fake([tokenOk, ok({ ResponseCode: '0' }), ok({ ResponseCode: '0' })]);
    const d = daraja(darajaConfig(row), f);
    await d.transactionStatus({ originatorId: pay.originatorId, resultUrl: 'https://x/s', timeoutUrl: 'https://x/st' });
    await d.accountBalance({ resultUrl: 'https://x/b', timeoutUrl: 'https://x/bt' });
    expect(calls[1].url).toMatch(/\/mpesa\/transactionstatus\/v1\/query$/);
    expect(calls[1].body).toMatchObject({ Initiator: 'apiop', CommandID: 'TransactionStatusQuery', OriginatorConversationID: pay.originatorId, PartyA: '600000', IdentifierType: '4', ResultURL: 'https://x/s' });
    expect(calls[1].body).not.toHaveProperty('TransactionID');
    expect(calls[2].url).toMatch(/\/mpesa\/accountbalance\/v1\/query$/);
    expect(calls[2].body).toMatchObject({ CommandID: 'AccountBalance', PartyA: '600000', IdentifierType: '4' });
  });
});

describe('callbacks', () => {
  const success = { Result: { ResultType: 0, ResultCode: 0, ResultDesc: 'The service request is processed successfully.', OriginatorConversationID: pay.originatorId,
    ConversationID: 'AG_20191219_00004e48cf7e3533f581', TransactionID: 'NLJ41HAY6Q', ResultParameters: { ResultParameter: [
      { Key: 'TransactionAmount', Value: 10 }, { Key: 'TransactionReceipt', Value: 'NLJ41HAY6Q' }, { Key: 'B2CRecipientIsRegisteredCustomer', Value: 'Y' },
      { Key: 'ReceiverPartyPublicName', Value: '254708374149 - John Doe' }, { Key: 'TransactionCompletedDateTime', Value: '19.12.2019 11:45:50' },
      { Key: 'B2CUtilityAccountAvailableFunds', Value: 10116.0 }] }, ReferenceData: { ReferenceItem: { Key: 'QueueTimeoutURL', Value: 'https://x' } } } };
  it('B2C success', () => {
    expect(parseCallback('result', success)).toMatchObject({ result_code: '0', originator_id: pay.originatorId, conversation_id: 'AG_20191219_00004e48cf7e3533f581',
      transaction_id: 'NLJ41HAY6Q', amount: 10, recipient_name: '254708374149 - John Doe', completed_at: '19.12.2019 11:45:50' });
  });
  it('B2C failure without parameters', () => {
    const r = parseCallback('result', { Result: { ResultType: 0, ResultCode: 2001, ResultDesc: 'The initiator information is invalid.', OriginatorConversationID: 'o', ConversationID: 'c', TransactionID: 'NLJ0000000' } });
    expect(r).toMatchObject({ result_code: '2001', result_desc: 'The initiator information is invalid.', amount: null, recipient_name: null });
  });
  it('a single parameter object (not a list) is read too', () => {
    expect(parseCallback('result', { Result: { ResultCode: 0, ResultParameters: { ResultParameter: { Key: 'TransactionAmount', Value: '5' } } } }).amount).toBe(5);
  });
  it('status result: the paid transaction is in the parameters; its own originator id is ignored', () => {
    const r = parseCallback('status', { Result: { ResultCode: 0, ResultDesc: 'The service request has been accepted successsfully.', OriginatorConversationID: 'status-query-id',
      ConversationID: 'AG_status', TransactionID: 'OEI2AK4Q16', ResultParameters: { ResultParameter: [
        { Key: 'ReceiptNo', Value: 'OEI2AK4Q16' }, { Key: 'TransactionStatus', Value: 'Completed' }, { Key: 'Amount', Value: 100 },
        { Key: 'FinalisedTime', Value: 20190927100436 }, { Key: 'CreditPartyName', Value: '254708374149 - John Doe' }] } } });
    expect(r).toMatchObject({ result_code: '0', transaction_status: 'Completed', transaction_id: 'OEI2AK4Q16', amount: 100, conversation_id: null });
    expect(r).not.toHaveProperty('originator_id');
  });
  it('garbage is harmless', () => {
    expect(parseCallback('result', null)).toMatchObject({ result_code: null, transaction_id: null });
    expect(parseCallback('timeout', 'x')).toMatchObject({ result_code: null });
  });
  it('balance result', () => {
    const r = parseBalance({ Result: { ResultCode: 0, ResultParameters: { ResultParameter: [{ Key: 'AccountBalance',
      Value: 'Working Account|KES|700000.00|700000.00|0.00|0.00&Utility Account|KES|228037.00|228037.00|0.00|0.00' }, { Key: 'BOCompletedTime', Value: 20200109125710 }] } } });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^Connected\. Working KES 700,000\.00 · Utility KES 228,037\.00$/);
    expect(parseBalance({ Result: { ResultCode: 2001, ResultDesc: 'The initiator information is invalid.' } })).toEqual({ ok: false, message: expect.stringMatching(/2001.*initiator information is invalid/) });
  });
});
