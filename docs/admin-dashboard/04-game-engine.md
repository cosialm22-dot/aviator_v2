# 04 — Game Engine & Crash Control

## Overview

The crash point determines when the plane "crashes" each round. This is the core revenue mechanism. The admin dashboard provides full visibility and control over crash point generation.

## Crash Point Algorithm

### Current Implementation (Client-Side)
Currently, crash points are generated client-side in `gameEngine.ts`. This is **not secure for production** as players could inspect/predict values.

### Target Implementation (Server-Side + Pre-generation)

```
Server generates crash points in advance → stored in crash_queue
↓
When round starts, next point is pulled from queue
↓
Client receives hashed_seed before round (provably fair)
↓
After crash, server_seed is revealed for verification
```

### Algorithm (Provably Fair)

```javascript
// Server-side crash point generation
function generateCrashPoint(serverSeed: string, nonce: number, houseEdge: number = 0.04): number {
  const hash = HMAC_SHA256(serverSeed, String(nonce));
  const hex = hash.substring(0, 8);
  const int = parseInt(hex, 16);
  
  // House edge: 4% of rounds crash instantly at 1.00x
  if (int % 25 === 0) return 1.00; // ~4% chance
  
  // Exponential distribution for remaining rounds
  const e = 2 ** 32;
  const result = Math.floor((100 * e - int) / (e - int)) / 100;
  
  return Math.max(1.01, result);
}
```

**Distribution characteristics:**
- ~4% of rounds crash at 1.00x (instant crash)
- ~33% of rounds crash below 2x
- ~50% of rounds crash below 2.97x
- ~10% of rounds reach above 10x
- ~1% of rounds reach above 100x
- Theoretical max: unlimited (practically capped at 1000x)

## Admin Controls

### 1. View Crash Queue
- See next 50 pre-generated crash points
- Each shows: position, multiplier, source (algorithm/manual), hashed seed
- Color-coded: red (< 1.5x), yellow (1.5-3x), green (3-10x), gold (10x+)

### 2. Override / Inject Crash Points
**Use cases:**
- Force a low crash (1.01-1.5x) to recover house losses
- Force a high crash (20x+) for marketing "big win" screenshot moments
- Inject specific sequence for testing

**Controls:**
```
┌─────────────────────────────────────────┐
│  INJECT CRASH POINT                     │
├─────────────────────────────────────────┤
│  Multiplier: [____] x                   │
│  Position:  [Next] [After 5] [After 10] │
│  Reason:    [_________________________] │
│  [Inject] [Cancel]                      │
└─────────────────────────────────────────┘
```

**Audit:** Every override is logged with admin ID, reason, and timestamp.

### 3. Algorithm Settings

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| House Edge | 4% | 1-10% | Percentage of rounds that instant-crash |
| Max Multiplier | 1000x | 50-10000x | Hard cap on any single round |
| Min Crash | 1.01x | 1.00-1.10x | Floor for non-instant crashes |
| Max Consecutive High | 3 | 1-10 | Max rounds above 10x in a row |
| Emergency Threshold | KSh 50,000 | 10K-500K | If house loses this in 1hr, bias low |
| Emergency Bias | 70% | 50-90% | % of next 10 rounds forced below 2x |

### 4. Live Game Monitor

Real-time view:
```
┌─────────────────────────────────────────────────┐
│ LIVE ROUND #4,521        Status: FLYING  │
├─────────────────────────────────────────────────┤
│ Current: 3.45x    Crash at: 7.82x       │
│ Players: 14       Total wagered: KSh 12K │
│ Already cashed: 3 (KSh 4.2K paid)       │
│ Still flying: 11  (KSh 7.8K at risk)    │
│ Potential payout if all cash now: KSh 27K│
├─────────────────────────────────────────────────┤
│ [🚨 FORCE CRASH NOW] [⏸️ PAUSE AFTER]     │
└─────────────────────────────────────────────────┘
```

**Emergency Controls:**
- **Force Crash Now**: Immediately crash the current round (use sparingly)
- **Pause After**: Stop starting new rounds after current one crashes
- **Kill Switch**: Immediately stop everything, show maintenance

### 5. Round History (Admin View)

Enhanced history with financials:

| Round # | Crash | Wagered | Paid Out | Profit | Players | Overridden |
|---------|-------|---------|----------|--------|---------|------------|
| 4520 | 2.34x | 8,500 | 5,200 | +3,300 | 12 | No |
| 4519 | 1.02x | 11,000 | 200 | +10,800 | 15 | No |
| 4518 | 45.2x | 6,000 | 18,400 | -12,400 | 9 | No |

### 6. Hourly/Daily P&L Chart

Visualization of house profit over time to spot trends and validate house edge is performing as expected.

## Migration Path

### Phase 1: Move crash generation server-side
1. Create Edge Function for crash generation
2. Pre-generate 100 crash points on startup
3. Refill queue when < 20 remaining
4. Client fetches hashed_seed at round start

### Phase 2: Add admin override capability
1. Admin can inject points into queue
2. Override flag stored for audit
3. Provably fair still works (different seed source noted)

### Phase 3: Emergency controls
1. Force crash endpoint
2. Pause/resume game endpoint
3. Realtime admin → game communication (Supabase Realtime)
