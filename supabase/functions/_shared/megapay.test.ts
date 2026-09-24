// deno test supabase/functions/_shared/megapay.test.ts
// Recorded Mega Pay answers (invest254 megapay.endpoint.test.ts, verified against the live API).
// Tiny local asserts (no network imports, so the tests run anywhere).
function assert(c: unknown, msg = "assertion failed"): void { if (!c) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown, msg = ""): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} expected ${y}, got ${x}`);
}
async function assertRejects(fn: () => Promise<unknown>): Promise<void> {
  let threw = false; try { await fn(); } catch { threw = true; }
  if (!threw) throw new Error("expected a rejection");
}
import {
  initiateStk, mapStatus, reportedAmount, megapayConfig, MEGAPAY_PRODUCTION_BASE, MEGAPAY_SANDBOX_BASE, queryStatus, testCredentials, toLocal, toMsisdn, type Fetch,
} from "./megapay.ts";

const cfg = { env: "production" as const, apiKey: "KEY", email: "a@b.co", baseUrl: MEGAPAY_PRODUCTION_BASE };
function fake(reply: unknown, status = 200, seen: { url?: string; body?: Record<string, unknown> } = {}): Fetch {
  return async (url, init) => {
    seen.url = url; seen.body = JSON.parse(String(init.body));
    return new Response(JSON.stringify(reply), { status, headers: { "Content-Type": "application/json" } });
  };
}

Deno.test("config: production host by default; a sandbox base is never used with production", () => {
  assertEquals(megapayConfig((k) => ({ MEGAPAY_API_KEY: "k", MEGAPAY_EMAIL: "e" } as Record<string, string>)[k]).baseUrl, MEGAPAY_PRODUCTION_BASE);
  assertEquals(megapayConfig((k) => ({ MEGAPAY_API_BASE: MEGAPAY_SANDBOX_BASE } as Record<string, string>)[k]).baseUrl, MEGAPAY_PRODUCTION_BASE);
  assertEquals(megapayConfig((k) => ({ MEGAPAY_ENV: "sandbox" } as Record<string, string>)[k]).baseUrl, MEGAPAY_SANDBOX_BASE);
});

Deno.test("phone numbers: every common Kenyan form, nothing else", () => {
  for (const p of ["0712345678", "712345678", "254712345678", "+254 712 345 678", "0112345678"]) assert(toMsisdn(p), p);
  for (const p of ["0812345678", "12345", "2547123456789", "", "abc"]) assertEquals(toMsisdn(p), null, p);
  assertEquals(toLocal("254712345678"), "0712345678");
});

Deno.test("initiate: sends key, email, whole-shilling amount, local msisdn and reference", async () => {
  const seen: { url?: string; body?: Record<string, unknown> } = {};
  const r = await initiateStk(cfg, { amountKes: 250, msisdn: "254712345678", reference: "AVIATOR" },
    fake({ ResponseCode: "0", success: "200", transaction_request_id: "TR1", CheckoutRequestID: "ws_CO_1", MerchantRequestID: "MR1" }, 200, seen));
  assertEquals(r, { ok: true, transactionRequestId: "TR1", merchantRequestId: "MR1" });
  assertEquals(seen.url, `${MEGAPAY_PRODUCTION_BASE}/initiatestk`);
  assertEquals(seen.body, { api_key: "KEY", email: "a@b.co", amount: "250", msisdn: "0712345678", reference: "AVIATOR" });
});

Deno.test("initiate: a provider rejection is returned, not thrown", async () => {
  const r = await initiateStk(cfg, { amountKes: 250, msisdn: "254712345678", reference: "X" }, fake({ ResponseCode: "1", errorMessage: "Invalid phone" }));
  assertEquals(r, { ok: false, reason: "Invalid phone" });
});

Deno.test("initiate: HTTP errors and timeouts throw (row stays for staff/reconcile)", async () => {
  await assertRejects(() => initiateStk(cfg, { amountKes: 1, msisdn: "254712345678", reference: "X" }, fake({}, 500)));
  const hang: Fetch = (_u, init) => new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
  await assertRejects(() => initiateStk(cfg, { amountKes: 1, msisdn: "254712345678", reference: "X" }, hang, 30));
});

Deno.test("status: Completed → paid with the receipt", async () => {
  const s = await queryStatus(cfg, "TR1", fake({ ResultCode: "200", TransactionStatus: "Completed", TransactionReceipt: "SAB12CD34" }));
  assertEquals(s.outcome, "paid"); assertEquals(s.receipt, "SAB12CD34");
});

Deno.test("status: Pending, not found (102) and unknown statuses never credit", async () => {
  assertEquals((await queryStatus(cfg, "TR1", fake({ ResultCode: "200", TransactionStatus: "Pending" }))).outcome, "pending");
  assertEquals((await queryStatus(cfg, "TR1", fake({ ResultCode: "102", errorMessage: "Transaction request does not exist!" }))).outcome, "pending");
  assertEquals((await queryStatus(cfg, "TR1", fake({ ResultCode: "200", TransactionStatus: "Weird" }))).outcome, "pending");
  assertEquals((await queryStatus(cfg, "TR1", fake({ ResultCode: "200" }))).outcome, "pending");
});

Deno.test("status: cancelled / failed / timeout → failed, with no receipt", async () => {
  for (const st of ["Cancelled", "Failed", "Timeout", "declined"]) {
    const s = await queryStatus(cfg, "TR1", fake({ ResultCode: "200", TransactionStatus: st, TransactionReceipt: "N/A" }));
    assertEquals(s.outcome, "failed", st); assertEquals(s.receipt, null);
  }
  assertEquals(mapStatus("COMPLETED"), "paid");
});

Deno.test("status: a paid answer with 'N/A' receipt credits under the Mega Pay id instead", async () => {
  const s = await queryStatus(cfg, "TR1", fake({ ResultCode: "200", TransactionStatus: "Completed", TransactionReceipt: "N/A" }));
  assertEquals(s.outcome, "paid"); assertEquals(s.receipt, null);
});

Deno.test("credential check reads Mega Pay's messages", async () => {
  assertEquals((await testCredentials(cfg, fake({ ResultCode: "102", errorMessage: "Transaction request does not exist!" }))).ok, true);
  assertEquals((await testCredentials(cfg, fake({ ResultCode: "102", errorMessage: "Api Key does not exist!" }))).message, "Mega Pay rejected the API key.");
  assertEquals((await testCredentials(cfg, fake({ ResultCode: "102", errorMessage: "Email does not exist!" }))).message, "Mega Pay rejected the account email.");
  assertEquals((await testCredentials(cfg, fake({ ResultCode: "102", errorMessage: "Invalid Api Key. Use Test Api Key: X" }))).ok, false);
});

Deno.test("status: the paid amount Mega Pay reports is read when present", async () => {
  const s = await queryStatus(cfg, "TR1", fake({ ResultCode: "200", TransactionStatus: "Completed", TransactionReceipt: "SAB1", TransactionAmount: "1,500" }));
  assertEquals(s.amount, 1500);
  assertEquals(reportedAmount({}), null);
  assertEquals(reportedAmount({ TransactionAmount: "N/A" }), null);
  assertEquals(reportedAmount({ Amount: 100 }), 100);
});
