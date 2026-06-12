# 🛠️ PHASE 1: IMPLEMENTATION ROADMAP
## Task Breakdown with Explicit Dependencies & Acceptance Criteria

**Status**: READY TO BUILD  
**Total Tasks**: 47  
**Estimated Duration**: 28 hours  
**Rigor Level**: Senior Engineer  

---

## SECTION A: DATABASE & INFRASTRUCTURE (6 hours)

### Task A1: Create M-Pesa STK Requests Table
**Depends On**: None  
**Duration**: 30 min  
**Owner**: Backend  

**Acceptance Criteria**:
- [ ] Table created with all columns
- [ ] All constraints applied (amount range, status enum)
- [ ] All indexes created
- [ ] RLS policies applied (users can only see own records)
- [ ] Migration file created and tested locally

**SQL File**: `supabase/migrations/20260611_create_mpesa_stk_requests.sql`

**Verification**:
```sql
-- Run these queries to verify
SELECT * FROM mpesa_stk_requests LIMIT 1;
SELECT indexname FROM pg_indexes WHERE tablename = 'mpesa_stk_requests';
SELECT policyname FROM pg_policies WHERE tablename = 'mpesa_stk_requests';
```

---

### Task A2: Create M-Pesa B2C Requests Table
**Depends On**: Task A1  
**Duration**: 30 min  
**Owner**: Backend  

**Acceptance Criteria**:
- [ ] Table created with all columns
- [ ] Foreign key to withdrawal_requests
- [ ] All indexes created
- [ ] RLS policies applied
- [ ] Migration file created

---

### Task A3: Enhance withdrawal_requests Table
**Depends On**: Task A2  
**Duration**: 45 min  
**Owner**: Backend  

**Acceptance Criteria**:
- [ ] All new columns added (risk_score, risk_flags, reviewed_by, etc.)
- [ ] Constraints applied
- [ ] Indexes created
- [ ] No data loss (ALTER TABLE with defaults)
- [ ] Migration tested

**Columns to Add**:
- risk_score (integer, 0-100)
- risk_flags (jsonb array)
- reviewed_by (uuid FK)
- reviewed_at (timestamptz)
- rejection_reason (text)
- auto_approved (boolean)
- mpesa_receipt (text)

---

### Task A4: Enhance game_rounds Table
**Depends On**: Task A3  
**Duration**: 30 min  
**Owner**: Backend  

**Acceptance Criteria**:
- [ ] source column added (algorithm/queue)
- [ ] queue_id FK added
- [ ] total_bets_amount, total_payouts added
- [ ] round_profit generated column added
- [ ] Indexes created
- [ ] No data loss

---

### Task A5: Enhance crash_queue Table
**Depends On**: Task A4  
**Duration**: 15 min  
**Owner**: Backend  

**Acceptance Criteria**:
- [ ] batch_id column added
- [ ] notes column added
- [ ] Indexes verified
- [ ] No data loss

---

### Task A6: Enhance profiles Table
**Depends On**: Task A5  
**Duration**: 30 min  
**Owner**: Backend  

**Acceptance Criteria**:
- [ ] All analytics columns added (total_deposited, total_withdrawn, etc.)
- [ ] risk_score column added
- [ ] last_active_at column added
- [ ] Indexes created
- [ ] No data loss

**Columns to Add**:
- total_deposited (decimal)
- total_withdrawn (decimal)
- total_wagered (decimal)
- total_won (decimal)
- last_active_at (timestamptz)
- risk_score (integer)

---

## SECTION B: M-PESA EDGE FUNCTIONS (6 hours)

### Task B1: Create M-Pesa Auth Edge Function
**Depends On**: None  
**Duration**: 1 hour  
**Owner**: Backend  

**File**: `supabase/functions/mpesa-auth/index.ts`

**Acceptance Criteria**:
- [ ] Function gets OAuth token from Daraja
- [ ] Token cached for 55 minutes (expires in 60)
- [ ] Handles network errors with retry logic
- [ ] Logs all requests
- [ ] Returns token in correct format
- [ ] Tested with real Daraja credentials

**Function Signature**:
```typescript
async function getMpesaToken(): Promise<{
  access_token: string;
  expires_in: number;
  token_type: string;
}>
```

**Error Handling**:
- Network timeout: Retry 3x with exponential backoff (1s, 2s, 4s)
- Invalid credentials: Log error, throw
- Rate limit (429): Wait 60s, retry once

---

### Task B2: Create STK Push Edge Function
**Depends On**: Task B1  
**Duration**: 1.5 hours  
**Owner**: Backend  

**File**: `supabase/functions/mpesa-stk-push/index.ts`

**Acceptance Criteria**:
- [ ] Validates input (amount, phone, user_id)
- [ ] Gets OAuth token
- [ ] Builds correct STK Push payload
- [ ] Sends to Daraja /stkpush/v1/processrequest
- [ ] Stores CheckoutRequestID in database
- [ ] Returns CheckoutRequestID to client
- [ ] Handles all error scenarios
- [ ] Logs all requests
- [ ] Rate limits per phone (5 per minute)
- [ ] Tested with sandbox credentials

**Request Validation**:
```typescript
// Must validate:
- amount: 100 ≤ x ≤ 150,000
- phone_number: matches ^254[0-9]{9}$
- user_id: matches authenticated user
- Rate limit: max 5 per phone per minute
```

**Database Insert**:
```typescript
// Insert into mpesa_stk_requests:
{
  user_id,
  phone_number,
  amount,
  checkout_request_id,
  merchant_request_id,
  status: 'initiated',
  created_at: now()
}
```

---

### Task B3: Create STK Callback Edge Function
**Depends On**: Task B2  
**Duration**: 2 hours  
**Owner**: Backend  

**File**: `supabase/functions/mpesa-stk-callback/index.ts`

**Acceptance Criteria**:
- [ ] Verifies IP is from Safaricom (196.201.214.200-208)
- [ ] Verifies CheckoutRequestID exists
- [ ] Implements idempotency (same callback twice = same result)
- [ ] Processes success (ResultCode == 0)
- [ ] Processes failure (ResultCode != 0)
- [ ] Credits wallet on success
- [ ] Creates transaction record
- [ ] Updates profiles.total_deposited
- [ ] Broadcasts to admin via Realtime
- [ ] Logs all callbacks
- [ ] Returns HTTP 200 within 5 seconds
- [ ] Tested with mock callbacks

**Processing Logic**:
```typescript
// 1. Verify IP
if (!isSafaricomIP(request.ip)) {
  logSecurityAlert('Invalid IP: ' + request.ip);
  return new Response('Forbidden', { status: 403 });
}

// 2. Verify CheckoutRequestID exists
const stk = await getSTKRequest(checkoutRequestId);
if (!stk) {
  logError('CheckoutRequestID not found');
  return new Response('Not Found', { status: 400 });
}

// 3. Check idempotency
if (stk.status !== 'initiated') {
  // Already processed, return 200
  return new Response(JSON.stringify({ ResultCode: 0 }), { status: 200 });
}

// 4. Process based on ResultCode
if (resultCode === 0) {
  // Success: credit wallet
  await creditWallet(stk.user_id, amount);
  await createTransaction(...);
  await updateSTKRequest(stk.id, { status: 'completed', ... });
  await broadcastToAdmin(...);
} else {
  // Failure: mark as failed
  await updateSTKRequest(stk.id, { status: 'failed', result_code: resultCode });
}

return new Response(JSON.stringify({ ResultCode: 0 }), { status: 200 });
```

---

### Task B4: Create B2C Edge Function
**Depends On**: Task B1  
**Duration**: 1.5 hours  
**Owner**: Backend  

**File**: `supabase/functions/mpesa-b2c/index.ts`

**Acceptance Criteria**:
- [ ] Validates withdrawal_request_id exists and status = pending
- [ ] Validates amount matches
- [ ] Validates phone matches
- [ ] Checks admin permissions
- [ ] Gets OAuth token
- [ ] Encrypts SecurityCredential
- [ ] Builds B2C payload
- [ ] Sends to Daraja /b2c/v1/paymentrequest
- [ ] Stores ConversationID in database
- [ ] Debits wallet
- [ ] Creates transaction record
- [ ] Updates withdrawal_requests status
- [ ] Broadcasts to admin
- [ ] Logs all requests
- [ ] Tested with sandbox credentials

**Request Validation**:
```typescript
// Must validate:
- withdrawal_request_id exists
- withdrawal_request.status === 'pending'
- amount === withdrawal_request.amount
- phone === withdrawal_request.phone
- admin has 'withdrawals.approve' permission
```

---

### Task B5: Create B2C Callback Edge Function
**Depends On**: Task B4  
**Duration**: 2 hours  
**Owner**: Backend  

**File**: `supabase/functions/mpesa-b2c-callback/index.ts`

**Acceptance Criteria**:
- [ ] Verifies IP from Safaricom
- [ ] Verifies ConversationID exists
- [ ] Implements idempotency
- [ ] Processes success (ResultCode == 0)
- [ ] Processes failure (ResultCode != 0)
- [ ] Updates withdrawal_requests status
- [ ] Updates mpesa_b2c_requests status
- [ ] Updates transaction status
- [ ] On failure: reverses wallet debit
- [ ] Broadcasts to admin
- [ ] Logs all callbacks
- [ ] Returns HTTP 200 within 5 seconds
- [ ] Tested with mock callbacks

**Processing Logic**:
```typescript
// Similar to STK callback but for B2C
// On success: mark withdrawal as completed
// On failure: reverse wallet debit, mark as failed
```

---

## SECTION C: ADMIN API ENDPOINTS (4 hours)

### Task C1: Create Analytics Endpoint
**Depends On**: Task A6  
**Duration**: 1 hour  
**Owner**: Backend  

**Endpoint**: `GET /api/admin/analytics/dashboard`

**Acceptance Criteria**:
- [ ] Returns all required metrics
- [ ] Calculates revenue correctly
- [ ] Calculates house edge correctly
- [ ] Returns top players
- [ ] Returns crash distribution
- [ ] Handles errors gracefully
- [ ] Tested with real data

**Response Schema**:
```typescript
{
  revenue_today: number;
  active_players_today: number;
  bets_today: number;
  pending_withdrawals: { count: number; amount: number };
  house_edge_actual: number;
  crash_distribution: Record<string, number>;
  top_players: Array<{
    username: string;
    wagered: number;
    net_pl: number;
  }>;
}
```

---

### Task C2: Create Withdrawals Queue Endpoint
**Depends On**: Task A3  
**Duration**: 45 min  
**Owner**: Backend  

**Endpoint**: `GET /api/admin/withdrawals/pending`

**Acceptance Criteria**:
- [ ] Returns pending withdrawals
- [ ] Includes risk scores
- [ ] Sortable by any column
- [ ] Paginable
- [ ] Filters by status
- [ ] Tested with real data

---

### Task C3: Create Withdrawal Approve Endpoint
**Depends On**: Task B4  
**Duration**: 45 min  
**Owner**: Backend  

**Endpoint**: `POST /api/admin/withdrawals/{id}/approve`

**Acceptance Criteria**:
- [ ] Validates withdrawal exists
- [ ] Checks admin permission
- [ ] Calls B2C Edge Function
- [ ] Updates withdrawal status
- [ ] Logs action
- [ ] Returns success/error
- [ ] Tested end-to-end

---

### Task C4: Create Withdrawal Reject Endpoint
**Depends On**: Task A3  
**Duration**: 30 min  
**Owner**: Backend  

**Endpoint**: `POST /api/admin/withdrawals/{id}/reject`

**Acceptance Criteria**:
- [ ] Validates withdrawal exists
- [ ] Requires rejection reason
- [ ] Updates status to rejected
- [ ] Reverses wallet debit (if already debited)
- [ ] Logs action
- [ ] Notifies player
- [ ] Tested

---

### Task C5: Create Crash Queue Endpoints
**Depends On**: Task A5  
**Duration**: 1 hour  
**Owner**: Backend  

**Endpoints**:
- `GET /api/admin/game/crash-queue`
- `POST /api/admin/game/crash-queue/add`
- `POST /api/admin/game/crash-queue/remove/{id}`
- `POST /api/admin/game/crash-queue/clear`

**Acceptance Criteria**:
- [ ] All endpoints working
- [ ] Validation on crash_point (1.0-80.0)
- [ ] Proper error handling
- [ ] Audit logging
- [ ] Tested

---

## SECTION D: FRONTEND COMPONENTS (6 hours)

### Task D1: Enhance Dashboard Page
**Depends On**: Task C1  
**Duration**: 2 hours  
**Owner**: Frontend  

**File**: `src/admin/pages/DashboardPage.tsx`

**Acceptance Criteria**:
- [ ] Fetches metrics from `/api/admin/analytics/dashboard`
- [ ] Displays metric cards
- [ ] Subscribes to Realtime for live updates
- [ ] Shows revenue chart (Recharts)
- [ ] Shows crash distribution
- [ ] Shows top players table
- [ ] Shows live feed
- [ ] Handles loading states
- [ ] Handles errors gracefully
- [ ] Tested with real data

**Components Used**:
- MetricCard (new)
- LineChart (Recharts)
- BarChart (Recharts)
- DataTable (new)
- LiveFeed (new)

---

### Task D2: Create Withdrawals Page
**Depends On**: Task C2, C3, C4  
**Duration**: 2 hours  
**Owner**: Frontend  

**File**: `src/admin/pages/WithdrawalsPage.tsx`

**Acceptance Criteria**:
- [ ] Fetches pending withdrawals
- [ ] Displays in sortable table
- [ ] Shows risk scores with color coding
- [ ] Approve button calls API
- [ ] Reject button shows reason dialog
- [ ] Bulk approve for low-risk
- [ ] Real-time updates
- [ ] Handles errors
- [ ] Tested

**Features**:
- Sortable columns
- Risk score color coding (green/yellow/orange/red)
- Approve/Reject buttons
- Bulk select + bulk approve
- Player detail preview on hover
- Real-time status updates

---

### Task D3: Create Crash Queue Page
**Depends On**: Task C5  
**Duration**: 1.5 hours  
**Owner**: Frontend  

**File**: `src/admin/pages/CrashQueuePage.tsx`

**Acceptance Criteria**:
- [ ] Displays current queue
- [ ] Add crash point form
- [ ] Remove button for each item
- [ ] Clear queue button (with confirmation)
- [ ] Batch add (comma-separated)
- [ ] Real-time updates
- [ ] Validation on input
- [ ] Tested

---

### Task D4: Enhance Game Control Page
**Depends On**: None  
**Duration**: 1 hour  
**Owner**: Frontend  

**File**: `src/admin/pages/GameControlPage.tsx`

**Acceptance Criteria**:
- [ ] Shows live round info
- [ ] Current multiplier display
- [ ] Active bets count
- [ ] Potential liability
- [ ] Force crash button (with confirmation)
- [ ] Pause game button
- [ ] Real-time updates
- [ ] Tested

---

## SECTION E: INTEGRATION & TESTING (4 hours)

### Task E1: Unit Tests - M-Pesa Functions
**Depends On**: Task B1-B5  
**Duration**: 1 hour  
**Owner**: QA  

**Test File**: `tests/mpesa.test.ts`

**Acceptance Criteria**:
- [ ] Test token generation
- [ ] Test STK Push payload validation
- [ ] Test callback processing
- [ ] Test idempotency
- [ ] Test error handling
- [ ] All tests passing

---

### Task E2: Integration Tests - Full Flow
**Depends On**: Task E1  
**Duration**: 1.5 hours  
**Owner**: QA  

**Test File**: `tests/integration.test.ts`

**Acceptance Criteria**:
- [ ] Test STK Push → Callback → Wallet Credit
- [ ] Test B2C → Callback → Wallet Debit
- [ ] Test Withdrawal Approval → B2C → Completion
- [ ] Test Error Scenarios
- [ ] All tests passing

---

### Task E3: Sandbox Testing - Real M-Pesa
**Depends On**: Task E2  
**Duration**: 1 hour  
**Owner**: QA  

**Acceptance Criteria**:
- [ ] Real STK Push with test phone
- [ ] Real B2C with test phone
- [ ] Callbacks received correctly
- [ ] Wallet updated correctly
- [ ] Admin dashboard shows updates
- [ ] No errors in logs

**Test Scenarios**:
1. Deposit KSh 500 via STK Push
2. Withdraw KSh 500 via B2C
3. Test callback retry (simulate network delay)
4. Test error scenarios (insufficient balance, etc.)

---

### Task E4: Load Testing
**Depends On**: Task E3  
**Duration**: 30 min  
**Owner**: QA  

**Acceptance Criteria**:
- [ ] Dashboard handles 100 concurrent users
- [ ] API endpoints respond < 500ms
- [ ] No database connection errors
- [ ] No memory leaks
- [ ] Realtime updates work under load

---

## SECTION F: DOCUMENTATION (2 hours)

### Task F1: API Documentation
**Depends On**: Task C1-C5  
**Duration**: 45 min  
**Owner**: Tech Writer  

**File**: `docs/admin-dashboard/API.md`

**Acceptance Criteria**:
- [ ] All endpoints documented
- [ ] Request/response examples
- [ ] Error codes explained
- [ ] Authentication explained
- [ ] Rate limits documented

---

### Task F2: M-Pesa Integration Guide
**Depends On**: Task B1-B5  
**Duration**: 45 min  
**Owner**: Tech Writer  

**File**: `docs/admin-dashboard/MPESA_INTEGRATION.md`

**Acceptance Criteria**:
- [ ] Setup instructions
- [ ] Callback handling explained
- [ ] Error scenarios documented
- [ ] Security best practices
- [ ] Troubleshooting guide

---

### Task F3: Deployment Guide
**Depends On**: All tasks  
**Duration**: 30 min  
**Owner**: DevOps  

**File**: `docs/admin-dashboard/DEPLOYMENT.md`

**Acceptance Criteria**:
- [ ] Pre-deployment checklist
- [ ] Deployment steps
- [ ] Post-deployment verification
- [ ] Rollback procedure
- [ ] Monitoring setup

---

## SECTION G: FINAL VERIFICATION (2 hours)

### Task G1: Code Review
**Depends On**: All code tasks  
**Duration**: 1 hour  
**Owner**: Senior Dev  

**Acceptance Criteria**:
- [ ] All code follows style guide
- [ ] No TypeScript errors
- [ ] No console.logs in production code
- [ ] All error handling present
- [ ] All edge cases handled
- [ ] Security best practices followed

---

### Task G2: Pre-Production Checklist
**Depends On**: Task G1  
**Duration**: 1 hour  
**Owner**: DevOps  

**Acceptance Criteria**:
- [ ] All tests passing
- [ ] All migrations applied
- [ ] Environment variables configured
- [ ] Edge Functions deployed
- [ ] Callbacks registered with Safaricom
- [ ] IP whitelist configured
- [ ] Monitoring configured
- [ ] Backup configured
- [ ] Rollback plan ready

---

## DEPENDENCY GRAPH

```
A1 → A2 → A3 → A4 → A5 → A6
                ↓
B1 → B2 → B3
     ↓
     B4 → B5
     
A3 → C2 → C3, C4
A5 → C5

C1 → D1
C2, C3, C4 → D2
C5 → D3

B1-B5 → E1 → E2 → E3 → E4
C1-C5 → E1

E1-E4 → F1, F2, F3
All → G1 → G2
```

---

## TASK ASSIGNMENT TEMPLATE

```
Task: [Task ID]
Assigned To: [Name]
Status: [ ] Not Started [ ] In Progress [ ] Complete
Start Date: ___________
End Date: ___________
Blockers: ___________
Notes: ___________
```

---

## SUCCESS METRICS

| Metric | Target | Current |
|--------|--------|---------|
| All tasks complete | 100% | 0% |
| Tests passing | 100% | 0% |
| Code review approved | 100% | 0% |
| Zero critical bugs | 100% | 0% |
| Documentation complete | 100% | 0% |
| Sandbox testing passed | 100% | 0% |

---

**Document Version**: 1.0  
**Last Updated**: 2026-06-11  
**Status**: READY FOR ASSIGNMENT  
