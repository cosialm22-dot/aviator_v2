// A stand-in for Safaricom's Daraja API, deployed as a throwaway Cloudflare Worker by
// e2e/payouts_live_e2e.py so the real payout functions can be driven end to end without money.
// It behaves like Daraja: OAuth, B2C v3, Transaction Status and Account Balance, answering
// asynchronously on the ResultURL. The outcome is chosen by the last digit of the phone number:
//   …1 success   …2 recipient cannot receive (2040)   …3 low float (1)   …4 accepted, never answers
//   (Transaction Status then reports Completed)   …5 refused at once (400.002.02)   …6 HTTP 503 with
//   no body (unknown) — the payment "went through", so Transaction Status reports Completed.
const CK = 'mock-ck', CS = 'mock-cs', INITIATOR = 'mockop', CREDENTIAL = 'MOCK-SECURITY-CREDENTIAL';
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const receipt = (id) => ('MK' + id.replace(/-/g, '').slice(0, 8)).toUpperCase();
const later = (ctx, url, body, ms = 1500) => ctx.waitUntil(new Promise((r) => setTimeout(r, ms)).then(() =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).catch(() => {}));

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === '/oauth/v1/generate') {
      const want = 'Basic ' + btoa(`${CK}:${CS}`);
      if (req.headers.get('Authorization') !== want) return json({ errorMessage: 'Invalid credentials' }, 400);
      return json({ access_token: 'mock-token', expires_in: '3599' });
    }
    if (req.headers.get('Authorization') !== 'Bearer mock-token') return json({ errorCode: '404.001.03', errorMessage: 'Invalid Access Token' }, 401);
    const b = await req.json().catch(() => ({}));

    if (u.pathname === '/mpesa/b2c/v3/paymentrequest') {
      if (b.InitiatorName !== INITIATOR || b.SecurityCredential !== CREDENTIAL) return json({ errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid Initiator' }, 400);
      for (const k of ['OriginatorConversationID', 'CommandID', 'Amount', 'PartyA', 'PartyB', 'ResultURL', 'QueueTimeOutURL'])
        if (!b[k]) return json({ errorCode: '400.002.02', errorMessage: `Bad Request - Invalid ${k}` }, 400);
      const last = String(b.PartyB).slice(-1);
      if (last === '5') return json({ requestId: 'r', errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid PartyB' }, 400);
      if (last === '6') return new Response('', { status: 503 });
      const conv = 'AG_MOCK_' + b.OriginatorConversationID.slice(0, 8);
      const base = { ResultType: 0, OriginatorConversationID: b.OriginatorConversationID, ConversationID: conv };
      if (last === '1') later(ctx, b.ResultURL, { Result: { ...base, ResultCode: 0, ResultDesc: 'The service request is processed successfully.', TransactionID: receipt(b.OriginatorConversationID),
        ResultParameters: { ResultParameter: [{ Key: 'TransactionAmount', Value: b.Amount }, { Key: 'TransactionReceipt', Value: receipt(b.OriginatorConversationID) },
          { Key: 'ReceiverPartyPublicName', Value: `${b.PartyB} - MOCK PLAYER` }, { Key: 'TransactionCompletedDateTime', Value: '25.09.2026 12:00:00' },
          { Key: 'B2CUtilityAccountAvailableFunds', Value: 99000.0 }] } } });
      if (last === '2') later(ctx, b.ResultURL, { Result: { ...base, ResultCode: 2040, ResultDesc: "Credit Party customer type (Unregistered or Registered Customer) can't be supported by the service." } });
      if (last === '3') later(ctx, b.ResultURL, { Result: { ...base, ResultCode: 1, ResultDesc: 'The balance is insufficient for the transaction.' } });
      return json({ ConversationID: conv, OriginatorConversationID: b.OriginatorConversationID, ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' });
    }
    if (u.pathname === '/mpesa/transactionstatus/v1/query') {
      later(ctx, b.ResultURL, { Result: { ResultType: 0, ResultCode: 0, ResultDesc: 'The service request has been accepted successsfully.',
        OriginatorConversationID: 'status-' + Date.now(), ConversationID: 'AG_STATUS', TransactionID: receipt(b.OriginatorConversationID),
        ResultParameters: { ResultParameter: [{ Key: 'ReceiptNo', Value: receipt(b.OriginatorConversationID) }, { Key: 'TransactionStatus', Value: 'Completed' },
          { Key: 'FinalisedTime', Value: 20260925120000 }, { Key: 'CreditPartyName', Value: 'MOCK PLAYER' }] } } }, 1000);
      return json({ ConversationID: 'AG_STATUS', OriginatorConversationID: 'status', ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' });
    }
    if (u.pathname === '/mpesa/accountbalance/v1/query') {
      const ok = b.Initiator === INITIATOR && b.SecurityCredential === CREDENTIAL;
      later(ctx, b.ResultURL, ok
        ? { Result: { ResultType: 0, ResultCode: 0, ResultDesc: 'The service request is processed successfully.', ResultParameters: { ResultParameter: [
            { Key: 'AccountBalance', Value: 'Working Account|KES|0.00|0.00|0.00|0.00&Utility Account|KES|99000.00|99000.00|0.00|0.00' }] } } }
        : { Result: { ResultType: 0, ResultCode: 2001, ResultDesc: 'The initiator information is invalid.' } }, 800);
      return json({ ConversationID: 'AG_BAL', OriginatorConversationID: 'bal', ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' });
    }
    return json({ errorCode: '404.001.01', errorMessage: 'Resource not found' }, 404);
  },
};
