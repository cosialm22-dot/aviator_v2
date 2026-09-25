// Safaricom Daraja client for B2C payouts — pure, network injected (unit-tested by vitest in
// supabase/functions/_shared/daraja.spec.ts). Ported from invest254 apps/engine/src/daraja.ts and
// moved to B2C v3 so every request carries OUR OriginatorConversationID (the payout attempt id):
// a lost answer can then be looked up with a Transaction Status query instead of being resent.
//
//   POST /oauth/v1/generate                 client-credentials token (cached ~55 min per account)
//   POST /mpesa/b2c/v3/paymentrequest       pay a player (result arrives on ResultURL)
//   POST /mpesa/transactionstatus/v1/query  ask what happened to an attempt (result on ResultURL)
//   POST /mpesa/accountbalance/v1/query     "Test connection": proves initiator + credential and
//                                           reports the B2C float (result on ResultURL)
//
// Callback URLs must not contain words Safaricom filters (e.g. "mpesa", "safaricom", "query"), so
// the functions are named payouts-worker / payout-result.

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface DarajaConfig {
  env: 'production' | 'sandbox';
  baseUrl: string;
  consumerKey: string; consumerSecret: string;
  shortcode: string; initiatorName: string; securityCredential: string;
  commandId: 'BusinessPayment' | 'SalaryPayment' | 'PromotionPayment';
}

export const DARAJA_BASES = { production: 'https://api.safaricom.co.ke', sandbox: 'https://sandbox.safaricom.co.ke' } as const;

/** An integrations row (svc_integration_by_id) → client config. */
export function darajaConfig(i: { config: Record<string, unknown>; secrets: Record<string, unknown> }): DarajaConfig {
  const env = i.config.env === 'sandbox' ? 'sandbox' : 'production';
  const base = String(i.config.api_base ?? '').trim().replace(/\/+$/, '');
  const cmd = String(i.config.command_id ?? 'BusinessPayment');
  return {
    env, baseUrl: base || DARAJA_BASES[env],
    consumerKey: String(i.secrets.consumer_key ?? ''), consumerSecret: String(i.secrets.consumer_secret ?? ''),
    shortcode: String(i.config.shortcode ?? ''), initiatorName: String(i.config.initiator_name ?? ''),
    securityCredential: String(i.secrets.security_credential ?? ''),
    commandId: (['BusinessPayment', 'SalaryPayment', 'PromotionPayment'].includes(cmd) ? cmd : 'BusinessPayment') as DarajaConfig['commandId'],
  };
}

export function missing(cfg: DarajaConfig): string[] {
  const m: string[] = [];
  if (!cfg.consumerKey) m.push('consumer key');
  if (!cfg.consumerSecret) m.push('consumer secret');
  if (!cfg.shortcode) m.push('shortcode');
  if (!cfg.initiatorName) m.push('initiator name');
  if (!cfg.securityCredential) m.push('security credential');
  return m;
}

export class DarajaError extends Error {
  /** definite = Safaricom answered and refused: nothing was paid. Otherwise the outcome is unknown. */
  constructor(message: string, readonly definite: boolean, readonly code: string | null = null) { super(message); }
}

const b64 = (s: string) => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s).toString('base64'));

export function daraja(cfg: DarajaConfig, f: Fetch = fetch, now: () => number = Date.now) {
  let token: { value: string; until: number } | null = null;

  async function timed(url: string, init: RequestInit, ms: number): Promise<Response> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await f(url, { ...init, signal: ctl.signal }); }
    finally { clearTimeout(t); }
  }

  async function accessToken(): Promise<string> {
    if (token && now() < token.until) return token.value;
    let res: Response;
    try {
      res = await timed(`${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        { method: 'GET', headers: { Authorization: `Basic ${b64(`${cfg.consumerKey}:${cfg.consumerSecret}`)}` } }, 15_000);
    } catch (e) {
      // no payment request has been made yet, so this is a definite "not sent"
      throw new DarajaError(`Could not reach Safaricom to sign in (${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message})`, true, 'OAUTH_UNREACHABLE');
    }
    const j = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: string | number; errorMessage?: string };
    if (!res.ok || !j.access_token) throw new DarajaError(`Safaricom refused the app credentials (HTTP ${res.status}${j.errorMessage ? `: ${j.errorMessage}` : ''})`, true, 'OAUTH');
    const ttl = Math.max(60, Number(j.expires_in ?? 3599) - 300) * 1000;
    token = { value: j.access_token, until: now() + ttl };
    return token.value;
  }

  /** POST one request. Returns the JSON on an accepted request; throws DarajaError otherwise. */
  async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const tk = await accessToken();
    let res: Response;
    try {
      res = await timed(`${cfg.baseUrl}${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, 25_000);
    } catch (e) {
      // the request may or may not have reached Safaricom
      throw new DarajaError(`No answer from Safaricom (${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message})`, false, 'NO_ANSWER');
    }
    const j = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!j) {
      // 5xx without a body: we cannot tell whether it was queued
      throw new DarajaError(`Safaricom answered HTTP ${res.status} without a body`, res.status >= 400 && res.status < 500, `HTTP_${res.status}`);
    }
    const code = String(j.ResponseCode ?? j.errorCode ?? '');
    if (res.ok && code === '0') return j;
    const msg = String(j.ResponseDescription ?? j.errorMessage ?? `HTTP ${res.status}`);
    // A 4xx refusal or a 200 with a non-zero ResponseCode: not accepted, nothing paid. A 5xx may
    // have been queued before the error, so its outcome stays unknown (the status query decides).
    throw new DarajaError(msg, res.status < 500, code || `HTTP_${res.status}`);
  }

  return {
    config: cfg,
    signIn: accessToken,
    /** Pay a player. originatorId = our payout attempt id. */
    b2c: (a: { originatorId: string; amountKes: number; msisdn: string; remarks: string; occasion: string; resultUrl: string; timeoutUrl: string }) =>
      post('/mpesa/b2c/v3/paymentrequest', {
        OriginatorConversationID: a.originatorId, InitiatorName: cfg.initiatorName, SecurityCredential: cfg.securityCredential,
        CommandID: cfg.commandId, Amount: Math.round(a.amountKes), PartyA: cfg.shortcode, PartyB: a.msisdn,
        Remarks: a.remarks.slice(0, 100) || 'Withdrawal', QueueTimeOutURL: a.timeoutUrl, ResultURL: a.resultUrl, Occasion: a.occasion.slice(0, 100),
      }).then((j) => ({ conversationId: String(j.ConversationID ?? ''), originatorId: String(j.OriginatorConversationID ?? a.originatorId), code: String(j.ResponseCode), desc: String(j.ResponseDescription ?? '') })),
    /** Ask what happened to an attempt (by our OriginatorConversationID, or the receipt when known). */
    transactionStatus: (a: { originatorId: string; transactionId?: string | null; resultUrl: string; timeoutUrl: string }) =>
      post('/mpesa/transactionstatus/v1/query', {
        Initiator: cfg.initiatorName, SecurityCredential: cfg.securityCredential, CommandID: 'TransactionStatusQuery',
        ...(a.transactionId ? { TransactionID: a.transactionId } : {}), OriginatorConversationID: a.originatorId,
        PartyA: cfg.shortcode, IdentifierType: '4', ResultURL: a.resultUrl, QueueTimeOutURL: a.timeoutUrl,
        Remarks: 'Payout status', Occasion: 'Payout status',
      }),
    accountBalance: (a: { resultUrl: string; timeoutUrl: string }) =>
      post('/mpesa/accountbalance/v1/query', {
        Initiator: cfg.initiatorName, SecurityCredential: cfg.securityCredential, CommandID: 'AccountBalance',
        PartyA: cfg.shortcode, IdentifierType: '4', Remarks: 'Connection test', QueueTimeOutURL: a.timeoutUrl, ResultURL: a.resultUrl,
      }),
  };
}
export type Daraja = ReturnType<typeof daraja>;

// ── callbacks ─────────────────────────────────────────────────────────────────────────────────
type Param = { Key?: string; Value?: unknown };
function params(result: Record<string, unknown>): Record<string, unknown> {
  const rp = (result.ResultParameters as { ResultParameter?: Param | Param[] } | undefined)?.ResultParameter;
  const list = Array.isArray(rp) ? rp : rp ? [rp] : [];
  const out: Record<string, unknown> = {};
  for (const p of list) if (p && typeof p.Key === 'string') out[p.Key] = p.Value;
  return out;
}
const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
const num = (v: unknown) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** What svc_payout_callback needs from a B2C result / queue timeout / Transaction Status result. */
export interface ParsedResult {
  result_code: string | null; result_desc: string | null; originator_id?: string | null; conversation_id: string | null;
  transaction_id: string | null; amount: number | null; recipient_name: string | null; transaction_status?: string | null;
  completed_at: string | null; raw: unknown;
}

export function parseCallback(kind: 'result' | 'timeout' | 'status', body: unknown): ParsedResult {
  const r = ((body as { Result?: Record<string, unknown> } | null)?.Result ?? {}) as Record<string, unknown>;
  const p = params(r);
  const base = {
    result_code: str(r.ResultCode), result_desc: str(r.ResultDesc), conversation_id: str(r.ConversationID), raw: body,
  };
  if (kind === 'status') {
    // A status query has its OWN originator id; the paid transaction is described in the params.
    return {
      ...base, conversation_id: null,
      transaction_id: str(p.ReceiptNo) ?? str(r.TransactionID),
      amount: num(p.Amount), recipient_name: str(p.CreditPartyName),
      transaction_status: str(p.TransactionStatus), completed_at: str(p.FinalisedTime),
    };
  }
  return {
    ...base, originator_id: str(r.OriginatorConversationID),
    transaction_id: str(p.TransactionReceipt) ?? str(r.TransactionID),
    amount: num(p.TransactionAmount), recipient_name: str(p.ReceiverPartyPublicName),
    completed_at: str(p.TransactionCompletedDateTime),
  };
}

/** AccountBalance result → a short line for the account card ("Utility KES 12,345.00 · Working KES 0.00"). */
export function parseBalance(body: unknown): { ok: boolean; message: string } {
  const r = ((body as { Result?: Record<string, unknown> } | null)?.Result ?? {}) as Record<string, unknown>;
  const code = str(r.ResultCode);
  if (code !== '0') return { ok: false, message: `Safaricom refused the initiator or credential (${code ?? '?'}): ${str(r.ResultDesc) ?? 'no reason'}` };
  const raw = String(params(r).AccountBalance ?? '');
  const parts = raw.split('&').map((a) => a.split('|')).filter((a) => a.length >= 3)
    .map(([name, cur, amount]) => `${name.replace(/ Account$/, '')} ${cur} ${Number(amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  return { ok: true, message: `Connected. ${parts.length ? parts.join(' · ') : 'Balance received.'}` };
}
