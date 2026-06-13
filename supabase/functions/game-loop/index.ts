// ============================================================================
// AVIATOR V2 - GAME-LOOP DRIVER (Supabase Edge Function)  [Option B, ACTIVE]
// ============================================================================
// Advances the single shared round by calling the SECURITY DEFINER RPC
// public.game_tick() on a fast cadence. game_tick() is idempotent and protected
// by a transaction-level advisory lock, so overlapping invocations are safe.
//
// Lifecycle:
//   pg_cron fires this function every minute (keepalive / self-healing restart).
//   Each invocation runs an internal loop ticking every TICK_MS for ~RUN_MS,
//   then returns. The next cron minute restarts it. A small overlap at the
//   minute boundary is harmless (idempotent ticks).
//
// Auth: invoked by pg_cron via pg_net with a service-role Bearer token
//       (see migrations/20260612122000_phase4_driver_pgcron.sql). The function
//       talks to the DB using the SERVICE_ROLE key from the Edge runtime env,
//       which is the only role granted EXECUTE on game_tick().
//
// Deploy:  supabase functions deploy game-loop
// Enable:  apply the phase4 migration, then optionally invoke once to start now.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TICK_MS = 250;     // tick cadence - fine enough for fair auto-cashout timing
const RUN_MS = 58_000;   // run just under the cron minute; next minute restarts us
const MAX_CONSECUTIVE_ERRORS = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (_req: Request) => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startedAt = Date.now();
  const deadline = startedAt + RUN_MS;
  let ticks = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  let last: unknown = null;

  while (Date.now() < deadline) {
    const tickStart = Date.now();
    const { data, error } = await sb.rpc("game_tick");
    if (error) {
      errors++;
      consecutiveErrors++;
      console.error(`game_tick error: ${error.message}`);
      // Back off if the DB is unhappy; bail out if it persists (cron will retry).
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error("Too many consecutive errors - exiting; cron will restart.");
        break;
      }
      await sleep(Math.min(2000, TICK_MS * consecutiveErrors));
    } else {
      ticks++;
      consecutiveErrors = 0;
      last = data;
    }
    // Maintain a steady cadence regardless of RPC latency.
    const elapsed = Date.now() - tickStart;
    if (elapsed < TICK_MS) await sleep(TICK_MS - elapsed);
  }

  const body = {
    ok: true,
    ran_ms: Date.now() - startedAt,
    ticks,
    errors,
    last_action: last,
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
});
