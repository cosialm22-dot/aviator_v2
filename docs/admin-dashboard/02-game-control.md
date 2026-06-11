# 🎮 Module 2: Game Control & Crash Queue

## Overview
Full control over the crash game algorithm, pre-defined crash sequences, live monitoring, and emergency controls.

---

## 2.1 Crash Queue (Future Crash Points)

### Purpose
Allow admins to pre-set upcoming crash points for strategic control over game outcomes. This enables:
- Ensuring house edge targets are met during losing streaks
- Creating "hype moments" with high multipliers at specific times
- Emergency profit recovery after abnormal winning streaks
- Marketing-driven events (e.g., "Happy Hour" with higher average crashes)

### UI Design

```
┌────────────────────────────────────────────────────┐
│  📝 CRASH QUEUE                              [+ Add] │
├────────────────────────────────────────────────────┤
│  Position  │  Crash Point  │  Added By  │  Actions   │
├───────────┼──────────────┼───────────┼───────────┤
│  Next      │    1.23x      │   admin   │  ✏️ 🗑️     │
│  +2        │    1.05x      │   admin   │  ✏️ 🗑️     │
│  +3        │    4.67x      │   admin   │  ✏️ 🗑️     │
│  +4        │    1.00x      │   admin   │  ✏️ 🗑️     │
│  +5        │   15.50x      │   admin   │  ✏️ 🗑️     │
└───────────┴──────────────┴───────────┴───────────┘
│  🛠️ Quick Actions:                                    │
│  [Add 10 Low (1.0-1.5x)]  [Add 5 Medium (2-5x)]     │
│  [Add 1 High (10-50x)]    [Clear Queue]              │
└────────────────────────────────────────────────────┘
```

### Queue Modes
1. **Manual Queue**: Admin manually adds specific crash points
2. **Batch Queue**: Add multiple points via comma-separated input (e.g., `1.2, 1.0, 3.5, 1.1, 1.8`)
3. **Pattern Generator**: Auto-generate sequences based on target house edge
4. **CSV Upload**: Bulk upload crash points from file

### Queue Logic (Modified Game Engine)
```typescript
// Modified generateCrashPoint() in gameEngine.ts
export async function getNextCrashPoint(): Promise<number> {
  // 1. Check if there's a queued crash point
  const { data: queued } = await supabase
    .from('crash_queue')
    .select('id, crash_point')
    .eq('status', 'pending')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (queued) {
    // Mark as used
    await supabase
      .from('crash_queue')
      .update({ status: 'used', used_at: new Date().toISOString() })
      .eq('id', queued.id);
    
    return queued.crash_point;
  }

  // 2. Fall back to algorithm-generated crash point
  return generateCrashPoint();
}
```

### Database Table
```sql
CREATE TABLE crash_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crash_point decimal(10,2) NOT NULL CHECK (crash_point >= 1.00),
  position integer NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'cancelled')),
  added_by uuid REFERENCES profiles(id),
  used_at timestamptz,
  used_in_round uuid REFERENCES game_rounds(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_crash_queue_pending ON crash_queue(status, position) WHERE status = 'pending';
```

---

## 2.2 Algorithm Configuration

### Adjustable Parameters
| Parameter | Current | Range | Description |
|-----------|---------|-------|---------|
| `instant_crash_pct` | 8% | 0-20% | Rounds that crash at exactly 1.00x |
| `low_crash_pct` | 27% | 10-50% | Crash between 1.01x-1.49x |
| `near_miss_pct` | 30% | 15-45% | Crash between 1.5x-2.49x |
| `medium_pct` | 20% | 10-35% | Crash between 2.5x-6x |
| `high_pct` | 10% | 3-20% | Crash between 6x-20x |
| `legendary_pct` | 5% | 1-10% | Crash between 20x-80x |
| `max_multiplier` | 80x | 50-200x | Maximum possible crash point |
| `target_house_edge` | 18% | 5-30% | Target RTP (100% - house_edge) |

### UI: Algorithm Tuner
```
┌────────────────────────────────────────────────────┐
│  ⚙️ ALGORITHM SETTINGS                                 │
├────────────────────────────────────────────────────┤
│  Target House Edge: [====●=======] 18%               │
│                                                      │
│  Instant Crash (1.00x):  [==●========] 8%            │
│  Low (1.01-1.49x):       [=====●=====] 27%           │
│  Near-Miss (1.5-2.49x):  [======●====] 30%           │
│  Medium (2.5-6x):        [====●======] 20%           │
│  High (6-20x):           [==●========] 10%           │
│  Legendary (20x+):       [=●=========] 5%            │
│                                                      │
│  ⚠️ Total must equal 100%    Current: 100% ✅         │
│                                                      │
│  Actual House Edge (last 1000 rounds): 17.4%         │
│  Expected vs Actual Deviation: -0.6% ✅              │
│                                                      │
│  [Save Changes]  [Reset to Default]  [Simulate 100]  │
└────────────────────────────────────────────────────┘
```

### Simulation Tool
Before applying new settings, the "Simulate 100" button generates 100 hypothetical rounds and shows:
- Predicted house edge
- Distribution chart
- Estimated revenue impact

---

## 2.3 Live Game Monitor

### Real-Time Round View
```
┌────────────────────────────────────────────────────┐
│  🔴 LIVE: Round #4,521           Status: FLYING     │
├────────────────────────────────────────────────────┤
│  Current Multiplier:  3.45x     ▲                    │
│  Crash Point:         [HIDDEN / 7.82x]              │
│  Time Elapsed:        12.4s                         │
│  Queue Source:        📝 Manual (pos #3)              │
│                                                      │
│  Active Bets: 23 real + 15 bots                      │
│  Total Staked: KSh 45,200                            │
│  Already Cashed Out: 8 players (KSh 12,100)          │
│  Potential Liability: KSh 156,000 (if all cashout)   │
│                                                      │
│  [Force Crash NOW]  [Extend +5s]  [Pause After]      │
└────────────────────────────────────────────────────┘
```

### Admin Powers During Live Round
| Action | Description | Use Case |
|--------|-------------|----------|
| Force Crash | Immediately crash the round | Emergency loss prevention |
| Pause Game | Stop accepting bets for next round | Maintenance, investigation |
| Kill Switch | Immediately halt all game activity | Critical incident |
| Void Round | Cancel current round, refund all bets | Technical malfunction |

---

## 2.4 Emergency Controls

### Kill Switch Panel
```
┌────────────────────────────────────────────────────┐
│  🚨 EMERGENCY CONTROLS                                │
├────────────────────────────────────────────────────┤
│  🔴 STOP ALL GAMES    │ Halts all rounds immediately  │
│  🟡 PAUSE DEPOSITS   │ Block new deposits            │
│  🟡 PAUSE WITHDRAWALS│ Block new withdrawal requests │
│  🟠 MAINTENANCE MODE │ Show maintenance page to all  │
│  🔵 FORCE LOGOUT ALL │ Invalidate all sessions       │
└────────────────────────────────────────────────────┘
All emergency actions require confirmation dialog + logged to audit.
```

---

## 2.5 Round History & Audit

### Detailed Round View
- Round ID, number, timestamp
- Crash point + source (algorithm or queue)
- All bets placed (real + bot)
- Cashouts with timestamps
- Round P&L for the house
- Seed values (for provably fair verification if implemented)

### Audit Trail
Every admin action on game control is logged:
- Queue additions/removals
- Algorithm parameter changes
- Emergency actions
- Force crashes
- With admin ID, timestamp, before/after values

---

## 2.6 Bot Configuration

### Bot Behavior Settings
| Setting | Description |
|---------|-------------|
| `bot_count_min` | Minimum bots per round |
| `bot_count_max` | Maximum bots per round |
| `bot_bet_min` | Min bot bet amount |
| `bot_bet_max` | Max bot bet amount |
| `bot_cashout_strategy` | Distribution of bot cashout multipliers |
| `bot_username_pool` | List of realistic Kenyan usernames |

### Why Bots Matter
- Create social proof (game looks active)
- Fill the live bets table
- Generate chat activity
- Make single players feel part of a crowd
