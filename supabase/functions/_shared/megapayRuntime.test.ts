// deno test supabase/functions/_shared/megapayRuntime.test.ts
// settleOne against a fake Mega Pay and a fake database: what reaches fn_megapay_settle.
import { settleOne } from "./megapayRuntime.ts";
import { MEGAPAY_PRODUCTION_BASE, type Fetch } from "./megapay.ts";

function assertEquals(a: unknown, b: unknown, msg = ""): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} expected ${y}, got ${x}`);
}
const cfg = { env: "production" as const, apiKey: "KEY", email: "a@b.co", baseUrl: MEGAPAY_PRODUCTION_BASE };
const mp = (reply: unknown): Fetch => async () => new Response(JSON.stringify(reply), { status: 200 });

function fakeDb(rowAmount: number | null) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const chain = {
    select: () => chain, eq: () => chain,
    maybeSingle: async () => ({ data: rowAmount == null ? null : { amount: rowAmount }, error: null }),
  };
  const db = {
    from: () => chain,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: { result: args.p_outcome === "paid" ? "credited" : String(args.p_outcome) }, error: null };
    },
  };
  // deno-lint-ignore no-explicit-any
  return { db: db as any, rpcCalls };
}

Deno.test("settleOne: paid with a matching amount is settled as paid", async () => {
  const { db, rpcCalls } = fakeDb(500);
  const r = await settleOne(db, cfg, "TR1", mp({ ResultCode: "200", TransactionStatus: "Completed", TransactionReceipt: "SAB1", TransactionAmount: "500" }));
  assertEquals(r, { result: "credited", outcome: "paid" });
  assertEquals(rpcCalls[0].args, { p_trid: "TR1", p_outcome: "paid", p_receipt: "SAB1", p_provider_status: "Completed" });
});

Deno.test("settleOne: paid with a DIFFERENT amount is never credited", async () => {
  const { db, rpcCalls } = fakeDb(150000);
  const r = await settleOne(db, cfg, "TR1", mp({ ResultCode: "200", TransactionStatus: "Completed", TransactionReceipt: "SAB1", TransactionAmount: "10" }));
  assertEquals(r.outcome, "pending");
  assertEquals(rpcCalls[0].args.p_outcome, "pending");
  assertEquals(rpcCalls[0].args.p_provider_status, "AMOUNT_MISMATCH 10");
});

Deno.test("settleOne: paid without an amount in the answer is settled as paid (row amount is ours)", async () => {
  const { db, rpcCalls } = fakeDb(500);
  await settleOne(db, cfg, "TR1", mp({ ResultCode: "200", TransactionStatus: "Completed", TransactionReceipt: "SAB1" }));
  assertEquals(rpcCalls[0].args.p_outcome, "paid");
});

Deno.test("settleOne: failed and pending pass straight through", async () => {
  const a = fakeDb(500); await settleOne(a.db, cfg, "TR1", mp({ ResultCode: "200", TransactionStatus: "Cancelled" }));
  assertEquals(a.rpcCalls[0].args.p_outcome, "failed");
  const b = fakeDb(500); await settleOne(b.db, cfg, "TR1", mp({ ResultCode: "102", errorMessage: "Transaction request does not exist!" }));
  assertEquals(b.rpcCalls[0].args.p_outcome, "pending");
});

Deno.test("settleOne: a database error surfaces instead of being swallowed", async () => {
  const db = { from: () => ({}), rpc: async () => ({ data: null, error: { message: "boom" } }) };
  let msg = "";
  // deno-lint-ignore no-explicit-any
  try { await settleOne(db as any, cfg, "TR1", mp({ ResultCode: "200", TransactionStatus: "Pending" })); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "SETTLE_FAILED:boom");
});
