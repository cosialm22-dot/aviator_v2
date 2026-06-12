# 🚀 PHASE 1: COMPREHENSIVE IMPLEMENTATION SPECIFICATION
## Aviator V2 Admin Dashboard - Production-Grade Build

**Status**: SPECIFICATION PHASE  
**Rigor Level**: Senior Engineer (Zero Tolerance for Ambiguity)  
**Last Updated**: 2026-06-11  

---

## 1. PHASE 1 SCOPE (EXPLICIT & COMPLETE)

### 1.1 What We're Building
Four interconnected systems that form the critical path:

| System | Purpose | Dependencies | Complexity |
|--------|---------|--------------|-----------|
| **Enhanced Analytics** | Real-time revenue/player metrics | Supabase Realtime | Medium |
| **Real M-Pesa Integration** | Live deposits (STK Push) + withdrawals (B2C) | Daraja API + Edge Functions | High |
| **Withdrawal Workflow** | Risk-based approval + batch processing | M-Pesa + Database | High |
| **Game Control** | Crash queue + algorithm tuning + live monitor | Game engine + Database | High |

### 1.2 What We're NOT Building (Explicitly Out of Scope)
- Affiliate system (Phase 3)
- KYC verification (Phase 4)
- Bonus engine (Phase 3)
- Responsible gambling (Phase 4)
- RBAC (Phase 2)
- Fraud detection ML models (Phase 2)
- Notifications system (Phase 2)

---

## 2. TECHNICAL ARCHITECTURE (EXPLICIT)

### 2.1 Technology Stack (Non-Negotiable)
```
Frontend:
  - React 18.3.1 (existing)
  - TypeScript 5.5.3 (existing)
  - Tailwind CSS 3.4.1 (existing)
  - Recharts 2.12.0 (NEW - charts)
  - date-fns 3.3.0 (NEW - date handling)
  - Lucide React 0.344.0 (existing - icons)

Backend:
  - Supabase (existing)
    - PostgreSQL (existing)
    - Realtime (existing)
    - Edge Functions (NEW - M-Pesa callbacks)
    - Storage (existing)
  - Safaricom Daraja API (NEW - M-Pesa)

DevOps:
  - Git (existing)
  - Vite (existing)
  - TypeScript strict mode (REQUIRED)
```

### 2.2 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ADMIN DASHBOARD (React)                     │
├─────────────────────────────────────────────────────────────────┤
│  Analytics Module  │  Game Control  │  Withdrawals  │  M-Pesa   │
└──────────┬──────────────────────────┬──────────────────────────┘
           │                          │
           ├──────────────────────────┼──────────────────────────┐
           │                          │                          │
           ▼                          ▼                          ▼
    ┌─────────────────┐      ┌──────────────────┐      ┌──────────────────┐
    │  Supabase REST  │      │  Supabase        │      │  Edge Functions  │
    │  + Realtime     │      │  Realtime        │      │  (M-Pesa Proxy)  │
    └────────┬────────┘      └────────┬─────────┘      └────────┬─────────┘
             │                        │                         │
             ▼                        ▼                         ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │              PostgreSQL Database (Supabase)                     │
    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
    │  │ game_rounds  │  │ bets         │  │ withdrawal_requests  │  │
    │  │ crash_queue  │  │ transactions │  │ mpesa_stk_requests   │  │
    │  │ profiles     │  │ wallets      │  │ mpesa_b2c_requests   │  │
    │  └──────────────┘  └──────────────┘  └──────────────────────┘  │
    └─────────────────────────────────────────────────────────────────┘
             ▲                                          ▲
             │                                          │
             └──────────────────────────────────────────┘
                    (Callbacks from Safaricom)
                    
    ┌─────────────────────────────────────────────────────────────────┐
    │              Safaricom Daraja API (External)                    │
    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
    │  │ STK Push     │  │ B2C          │  │ Transaction Status   │  │
    │  │ (Deposits)   │  │ (Withdrawals)│  │ Reversal             │  │
    │  └──────────────┘  └──────────────┘  └──────────────────────┘  │
    └─────────────────────────────────────────────────────────────────┘
```

### 2.3 Request/Response Flow (Explicit)

#### Deposit Flow (STK Push)
```
1. Admin/Player initiates deposit
   → POST /api/mpesa/stk-push
   → { amount, phone, user_id }

2. Edge Function:
   a) Get OAuth token from Daraja
   b) Build STK Push payload
   c) Send to Daraja /stkpush/v1/processrequest
   d) Store CheckoutRequestID in mpesa_stk_requests (status: pending)
   e) Return CheckoutRequestID to client

3. Player enters M-Pesa PIN on phone

4. Safaricom POSTs callback to /api/mpesa/callback/stk
   a) Verify IP is from Safaricom (196.201.214.200-208)
   b) Verify ResultCode == 0
   c) Match CheckoutRequestID to pending request
   d) Extract MpesaReceiptNumber, Amount, PhoneNumber
   e) Credit player wallet
   f) Create transaction record
   g) Update mpesa_stk_requests (status: completed)
   h) Return HTTP 200 to Safaricom
   i) Broadcast via Realtime to admin dashboard

5. Admin sees deposit in real-time feed
```

#### Withdrawal Flow (B2C)
```
1. Player requests withdrawal
   → POST /api/withdrawals
   → { amount, phone, method: 'mpesa' }

2. Backend:
   a) Validate: KYC tier, daily limit, wagering requirement
   b) Calculate risk score
   c) If risk < threshold: auto-approve
   d) Else: add to withdrawal_requests (status: pending)
   e) Notify admin via Realtime

3. Admin reviews in withdrawal queue
   → Click "Approve"
   → POST /api/mpesa/b2c
   → { withdrawal_request_id, amount, phone }

4. Edge Function:
   a) Get OAuth token
   b) Encrypt SecurityCredential
   c) Build B2C payload
   d) Send to Daraja /b2c/v1/paymentrequest
   e) Store ConversationID in mpesa_b2c_requests (status: processing)
   f) Return ConversationID

5. Safaricom processes payment (1-30 seconds)

6. Safaricom POSTs callback to /api/mpesa/callback/b2c
   a) Verify IP
   b) Verify ResultCode == 0
   c) Match ConversationID
   d) Extract MpesaReceiptNumber
   e) Update withdrawal_requests (status: completed)
   f) Update mpesa_b2c_requests (status: completed)
   g) Debit player wallet (already done on approval)
   h) Create transaction record
   i) Return HTTP 200
   j) Broadcast to admin dashboard

7. Admin sees withdrawal completed in real-time
```

---

## 3. DATABASE SCHEMA (EXPLICIT & COMPLETE)

### 3.1 New Tables Required

#### mpesa_stk_requests (Deposits)
```sql
CREATE TABLE mpesa_stk_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  amount decimal(12,2) NOT NULL CHECK (amount > 0),
  checkout_request_id text UNIQUE NOT NULL,
  merchant_request_id text,
  mpesa_receipt_number text UNIQUE,
  result_code integer,
  result_desc text,
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'initiated', 'pending', 'completed', 'failed', 'cancelled', 'timeout'
  )),
  callback_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  
  -- Indexes
  CONSTRAINT valid_amount CHECK (amount >= 100 AND amount <= 150000)
);

CREATE INDEX idx_stk_user_id ON mpesa_stk_requests(user_id);
CREATE INDEX idx_stk_status ON mpesa_stk_requests(status) WHERE status IN ('initiated', 'pending');
CREATE INDEX idx_stk_checkout_id ON mpesa_stk_requests(checkout_request_id);
CREATE INDEX idx_stk_receipt ON mpesa_stk_requests(mpesa_receipt_number);
```

#### mpesa_b2c_requests (Withdrawals)
```sql
CREATE TABLE mpesa_b2c_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_request_id uuid NOT NULL REFERENCES withdrawal_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  amount decimal(12,2) NOT NULL CHECK (amount > 0),
  conversation_id text UNIQUE NOT NULL,
  originator_conversation_id text,
  mpesa_receipt_number text UNIQUE,
  result_code integer,
  result_desc text,
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'initiated', 'pending', 'processing', 'completed', 'failed', 'timeout'
  )),
  callback_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  
  CONSTRAINT valid_amount CHECK (amount >= 100 AND amount <= 150000)
);

CREATE INDEX idx_b2c_user_id ON mpesa_b2c_requests(user_id);
CREATE INDEX idx_b2c_status ON mpesa_b2c_requests(status) WHERE status IN ('initiated', 'pending', 'processing');
CREATE INDEX idx_b2c_conversation_id ON mpesa_b2c_requests(conversation_id);
CREATE INDEX idx_b2c_receipt ON mpesa_b2c_requests(mpesa_receipt_number);
CREATE INDEX idx_b2c_withdrawal_id ON mpesa_b2c_requests(withdrawal_request_id);
```

#### Enhanced withdrawal_requests
```sql
-- ALTER existing table
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  risk_score integer DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100);

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  risk_flags jsonb DEFAULT '[]'::jsonb;

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  reviewed_by uuid REFERENCES profiles(id);

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  reviewed_at timestamptz;

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  rejection_reason text;

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  auto_approved boolean DEFAULT false;

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  mpesa_receipt text;

-- Indexes
CREATE INDEX idx_wr_status_pending ON withdrawal_requests(status) WHERE status = 'pending';
CREATE INDEX idx_wr_risk_score ON withdrawal_requests(risk_score DESC);
CREATE INDEX idx_wr_user_id ON withdrawal_requests(user_id);
```

#### crash_queue (Game Control)
```sql
-- Already exists, verify structure:
-- id, crash_point, position, status, added_by, used_at, used_in_round, created_at

-- Add if missing:
ALTER TABLE crash_queue ADD COLUMN IF NOT EXISTS
  batch_id uuid;

ALTER TABLE crash_queue ADD COLUMN IF NOT EXISTS
  notes text;

CREATE INDEX idx_crash_queue_pending ON crash_queue(position) WHERE status = 'pending';
```

### 3.2 Modified Tables

#### profiles (Add analytics fields)
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  total_deposited decimal(12,2) DEFAULT 0;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  total_withdrawn decimal(12,2) DEFAULT 0;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  total_wagered decimal(12,2) DEFAULT 0;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  total_won decimal(12,2) DEFAULT 0;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  last_active_at timestamptz;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  risk_score integer DEFAULT 0;

CREATE INDEX idx_profiles_risk_score ON profiles(risk_score DESC);
```

#### game_rounds (Add tracking)
```sql
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS
  source text DEFAULT 'algorithm' CHECK (source IN ('algorithm', 'queue'));

ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS
  queue_id uuid REFERENCES crash_queue(id);

ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS
  total_bets_amount decimal(12,2) DEFAULT 0;

ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS
  total_payouts decimal(12,2) DEFAULT 0;

ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS
  round_profit decimal(12,2) GENERATED ALWAYS AS (total_bets_amount - total_payouts) STORED;

CREATE INDEX idx_game_rounds_source ON game_rounds(source);
CREATE INDEX idx_game_rounds_queue_id ON game_rounds(queue_id);
```

---

## 4. API SPECIFICATION (EXPLICIT)

### 4.1 M-Pesa Edge Functions (Supabase)

#### Function 1: `/api/mpesa/auth`
**Purpose**: Get OAuth token from Daraja  
**Method**: POST  
**Auth**: Service role key (server-side only)  
**Request**: None  
**Response**:
```json
{
  "access_token": "string",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```
**Error Handling**:
- Network timeout → Retry 3x with exponential backoff
- Invalid credentials → Log and alert admin
- Rate limit (429) → Queue and retry after 60s

---

#### Function 2: `/api/mpesa/stk-push`
**Purpose**: Initiate STK Push for deposit  
**Method**: POST  
**Auth**: User must be authenticated  
**Request**:
```json
{
  "amount": 500,
  "phone_number": "254712345678",
  "user_id": "uuid"
}
```
**Validation**:
- amount: 100 ≤ x ≤ 150,000
- phone_number: Must match regex `^254[0-9]{9}$`
- user_id: Must match authenticated user
- Rate limit: Max 5 requests per phone per minute

**Response**:
```json
{
  "success": true,
  "checkout_request_id": "string",
  "merchant_request_id": "string",
  "message": "Check your phone for M-Pesa prompt"
}
```

**Error Responses**:
```json
{
  "success": false,
  "error": "INVALID_AMOUNT | INVALID_PHONE | RATE_LIMITED | DARAJA_ERROR",
  "message": "Human-readable error"
}
```

**Side Effects**:
- Insert into mpesa_stk_requests (status: initiated)
- Log to admin_audit_log
- Broadcast to admin dashboard via Realtime

---

#### Function 3: `/api/mpesa/callback/stk`
**Purpose**: Handle STK Push callback from Safaricom  
**Method**: POST  
**Auth**: None (but verify IP + signature)  
**Request** (from Safaricom):
```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "string",
      "CheckoutRequestID": "string",
      "ResultCode": 0,
      "ResultDesc": "string",
      "CallbackMetadata": {
        "Item": [
          { "Name": "Amount", "Value": 500 },
          { "Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV" },
          { "Name": "TransactionDate", "Value": 20191219102115 },
          { "Name": "PhoneNumber", "Value": 254712345678 }
        ]
      }
    }
  }
}
```

**Processing Logic**:
```
1. Verify IP is from Safaricom (196.201.214.200-208)
   → If not: Log security alert, return 403
   
2. Verify CheckoutRequestID exists in mpesa_stk_requests
   → If not: Log error, return 400
   
3. Check if already processed (idempotency)
   → If status != 'initiated': Return 200 (already handled)
   
4. If ResultCode == 0 (Success):
   a) Extract Amount, MpesaReceiptNumber, PhoneNumber
   b) Update mpesa_stk_requests:
      - status = 'completed'
      - mpesa_receipt_number = MpesaReceiptNumber
      - result_code = 0
      - completed_at = now()
   c) Get player wallet
   d) Credit wallet: balance += Amount
   e) Create transaction record:
      - type = 'deposit'
      - amount = Amount
      - payment_method = 'mpesa'
      - reference = MpesaReceiptNumber
      - status = 'completed'
   f) Update profiles: total_deposited += Amount
   g) Broadcast to admin via Realtime
   h) Return HTTP 200
   
5. If ResultCode != 0 (Failed):
   a) Update mpesa_stk_requests:
      - status = 'failed'
      - result_code = ResultCode
      - result_desc = ResultDesc
   b) Log failure reason
   c) Broadcast to admin
   d) Return HTTP 200
```

**Response**:
```json
{
  "ResultCode": 0,
  "ResultDesc": "Accepted"
}
```

**Critical Requirements**:
- Must respond with HTTP 200 within 5 seconds (Safaricom will retry)
- Must be idempotent (same callback twice = same result)
- Must log every callback (for audit)
- Must handle network failures gracefully

---

#### Function 4: `/api/mpesa/b2c`
**Purpose**: Initiate B2C payment for withdrawal  
**Method**: POST  
**Auth**: Admin only (Finance Manager role)  
**Request**:
```json
{
  "withdrawal_request_id": "uuid",
  "amount": 5000,
  "phone_number": "254712345678"
}
```

**Validation**:
- withdrawal_request_id must exist and status = 'pending'
- amount must match withdrawal_request.amount
- phone_number must match withdrawal_request.phone_number
- Admin must have 'withdrawals.approve' permission

**Response**:
```json
{
  "success": true,
  "conversation_id": "string",
  "message": "Withdrawal processing"
}
```

**Side Effects**:
- Insert into mpesa_b2c_requests (status: initiated)
- Update withdrawal_requests (status: processing)
- Debit player wallet (amount)
- Create transaction record (type: withdrawal, status: pending)
- Log to admin_audit_log
- Broadcast to admin dashboard

---

#### Function 5: `/api/mpesa/callback/b2c`
**Purpose**: Handle B2C result callback from Safaricom  
**Method**: POST  
**Auth**: None (verify IP)  
**Processing Logic**:
```
1. Verify IP from Safaricom
2. Verify ConversationID exists
3. Check idempotency
4. If ResultCode == 0:
   a) Update mpesa_b2c_requests (status: completed)
   b) Update withdrawal_requests (status: completed)
   c) Update transaction (status: completed)
   d) Broadcast to admin
5. If ResultCode != 0:
   a) Update mpesa_b2c_requests (status: failed)
   b) Update withdrawal_requests (status: failed)
   c) CREDIT player wallet back (reversal)
   d) Create reversal transaction
   e) Alert admin
6. Return HTTP 200
```

---

### 4.2 Admin Dashboard API Endpoints

#### GET `/api/admin/analytics/dashboard`
**Purpose**: Get dashboard metrics  
**Response**:
```json
{
  "revenue_today": 45200,
  "active_players_today": 234,
  "bets_today": 1245,
  "pending_withdrawals": { "count": 12, "amount": 156000 },
  "house_edge_actual": 17.4,
  "crash_distribution": { "1.0x": 8, "1.01-1.49x": 27, ... },
  "top_players": [ { "username": "...", "wagered": 50000, "net_pl": -12000 } ]
}
```

#### GET `/api/admin/withdrawals/pending`
**Purpose**: Get pending withdrawal queue  
**Query Params**: `limit=20&offset=0&sort_by=created_at&order=desc`  
**Response**:
```json
{
  "total": 12,
  "items": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "username": "player123",
      "amount": 8500,
      "phone": "0712***456",
      "risk_score": 25,
      "status": "pending",
      "created_at": "2026-06-11T10:30:00Z",
      "auto_approved": false
    }
  ]
}
```

#### POST `/api/admin/withdrawals/{id}/approve`
**Purpose**: Approve withdrawal  
**Auth**: Finance Manager  
**Request**: `{}`  
**Response**:
```json
{
  "success": true,
  "message": "Withdrawal approved, B2C initiated",
  "conversation_id": "..."
}
```

#### POST `/api/admin/withdrawals/{id}/reject`
**Purpose**: Reject withdrawal  
**Auth**: Finance Manager  
**Request**: `{ "reason": "Suspicious activity" }`  
**Response**:
```json
{
  "success": true,
  "message": "Withdrawal rejected, funds returned to wallet"
}
```

#### GET `/api/admin/game/crash-queue`
**Purpose**: Get pending crash queue  
**Response**:
```json
{
  "queue": [
    { "position": 1, "crash_point": 1.23, "added_by": "admin", "added_at": "..." },
    { "position": 2, "crash_point": 1.05, "added_by": "admin", "added_at": "..." }
  ],
  "total_queued": 2
}
```

#### POST `/api/admin/game/crash-queue/add`
**Purpose**: Add crash point to queue  
**Auth**: Game Operator  
**Request**: `{ "crash_point": 1.23, "batch_id": "uuid" }`  
**Validation**: 1.0 ≤ crash_point ≤ 80.0  
**Response**:
```json
{
  "success": true,
  "position": 5,
  "message": "Added to queue"
}
```

#### POST `/api/admin/game/crash-queue/clear`
**Purpose**: Clear entire queue  
**Auth**: Game Operator  
**Requires**: Confirmation dialog  
**Response**:
```json
{
  "success": true,
  "cleared_count": 12,
  "message": "Queue cleared"
}
```

---

## 5. FRONTEND COMPONENTS (EXPLICIT)

### 5.1 New Pages

#### DashboardPage (Enhanced)
**Location**: `src/admin/pages/DashboardPage.tsx`  
**Responsibilities**:
- Fetch metrics via `/api/admin/analytics/dashboard`
- Subscribe to Realtime for live updates
- Render metric cards, charts, live feed
- Handle errors gracefully

**State Management**:
```typescript
interface DashboardState {
  metrics: DashboardMetrics | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}
```

**Realtime Subscriptions**:
- `admin-feed` channel for new transactions
- `admin-alerts` channel for fraud flags

---

#### WithdrawalsPage (New)
**Location**: `src/admin/pages/WithdrawalsPage.tsx`  
**Responsibilities**:
- Fetch pending withdrawals
- Display in sortable table
- Handle approve/reject actions
- Show risk scores with color coding
- Real-time updates

**Key Features**:
- Bulk approve (low-risk only)
- Individual review with player details
- Rejection reason required
- Audit trail

---

#### CrashQueuePage (New)
**Location**: `src/admin/pages/CrashQueuePage.tsx`  
**Responsibilities**:
- Display current queue
- Add/remove crash points
- Batch operations
- Clear queue (with confirmation)

---

#### GameControlPage (Enhanced)
**Location**: `src/admin/pages/GameControlPage.tsx`  
**Responsibilities**:
- Live round monitor
- Current multiplier display
- Active bets count
- Potential liability
- Emergency controls (Force Crash, Pause)

---

### 5.2 New Components

#### MetricCard
```typescript
interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: number; direction: 'up' | 'down' };
  color: 'green' | 'blue' | 'purple' | 'amber' | 'red';
  loading?: boolean;
}
```

#### WithdrawalTable
```typescript
interface WithdrawalTableProps {
  withdrawals: WithdrawalRequest[];
  loading: boolean;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onViewDetails: (id: string) => void;
}
```

#### CrashQueueList
```typescript
interface CrashQueueListProps {
  queue: CrashQueueItem[];
  onAdd: (crashPoint: number) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClear: () => Promise<void>;
  loading: boolean;
}
```

---

## 6. ERROR HANDLING (EXPLICIT & COMPREHENSIVE)

### 6.1 M-Pesa Callback Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| 1 | Insufficient balance | Notify player, no retry |
| 1032 | User cancelled | Mark as cancelled, no retry |
| 1037 | DS timeout | Retry via Transaction Status API |
| 2001 | Wrong PIN | Notify player, allow retry |
| 1001 | Unable to lock | Retry once after 5s |
| Network timeout | Connection lost | Retry 3x with exponential backoff |
| Invalid IP | Spoofed request | Log security alert, reject |
| Duplicate callback | Already processed | Return 200 (idempotent) |

### 6.2 Withdrawal Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| Insufficient balance | Player balance < amount | Reject withdrawal |
| Daily limit exceeded | Player hit daily cap | Reject withdrawal |
| KYC not verified | Player not verified | Reject withdrawal |
| B2C failed | Safaricom error | Reverse debit, mark failed |
| Phone mismatch | Phone doesn't match | Reject withdrawal |

### 6.3 Game Control Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| Queue empty | No crash points | Fall back to algorithm |
| Invalid crash point | Outside 1.0-80.0 range | Reject input |
| Round already started | Can't modify mid-round | Show error |
| Database error | Connection lost | Retry with exponential backoff |

---

## 7. SECURITY REQUIREMENTS (EXPLICIT & NON-NEGOTIABLE)

### 7.1 M-Pesa Callback Security
- ✅ Verify IP is from Safaricom (196.201.214.200-208)
- ✅ Verify HTTPS only (reject HTTP)
- ✅ Verify CheckoutRequestID/ConversationID exists
- ✅ Verify ResultCode is valid integer
- ✅ Implement idempotency (same callback twice = same result)
- ✅ Log every callback with raw payload
- ✅ Rate limit: Max 100 callbacks per minute per endpoint
- ✅ Timeout: Respond within 5 seconds

### 7.2 Admin API Security
- ✅ Require authentication (JWT)
- ✅ Verify role permissions (Finance Manager for withdrawals)
- ✅ Log all admin actions to audit_log
- ✅ Require confirmation for destructive actions
- ✅ Rate limit: Max 10 requests per second per admin

### 7.3 Credential Security
- ✅ Store Consumer Key/Secret in environment variables only
- ✅ Never log credentials
- ✅ Rotate credentials quarterly
- ✅ Use Supabase Vault for secrets (if available)
- ✅ Never commit .env to git

---

## 8. TESTING REQUIREMENTS (EXPLICIT)

### 8.1 Unit Tests
- M-Pesa payload validation
- Risk score calculation
- Withdrawal approval logic
- Crash queue operations

### 8.2 Integration Tests
- STK Push flow (mock Daraja)
- B2C flow (mock Daraja)
- Callback processing (idempotency)
- Database transactions

### 8.3 Manual Testing (Sandbox)
- Real STK Push with test phone
- Real B2C with test phone
- Callback verification
- Error scenarios

---

## 9. DEPLOYMENT CHECKLIST (EXPLICIT)

### Pre-Deployment
- [ ] All tests passing
- [ ] TypeScript strict mode: no errors
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Supabase Edge Functions deployed
- [ ] M-Pesa credentials verified
- [ ] Callback URLs registered with Safaricom
- [ ] IP whitelist configured
- [ ] Audit logging enabled
- [ ] Error monitoring configured (Sentry/similar)

### Post-Deployment
- [ ] Test STK Push with real phone
- [ ] Test B2C with real phone
- [ ] Monitor error logs for 24 hours
- [ ] Verify all metrics in dashboard
- [ ] Check audit log entries
- [ ] Confirm Realtime updates working

---

## 10. DELIVERABLES (EXPLICIT)

### Code
- [ ] Enhanced DashboardPage.tsx
- [ ] WithdrawalsPage.tsx (new)
- [ ] CrashQueuePage.tsx (new)
- [ ] GameControlPage.tsx (enhanced)
- [ ] M-Pesa Edge Functions (5 functions)
- [ ] Admin API endpoints (6 endpoints)
- [ ] Database migrations (SQL)
- [ ] TypeScript types (complete)
- [ ] Error handling (comprehensive)
- [ ] Tests (unit + integration)

### Documentation
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Database schema diagram
- [ ] Deployment guide
- [ ] Troubleshooting guide
- [ ] M-Pesa integration guide

### Configuration
- [ ] .env.example (updated)
- [ ] Supabase migrations
- [ ] Edge Functions deployment config

---

## 11. TIMELINE (EXPLICIT)

| Phase | Task | Duration | Owner |
|-------|------|----------|-------|
| 1 | Database schema + migrations | 2 hours | Backend |
| 2 | M-Pesa Edge Functions | 6 hours | Backend |
| 3 | Admin API endpoints | 4 hours | Backend |
| 4 | Frontend components | 6 hours | Frontend |
| 5 | Integration testing | 4 hours | QA |
| 6 | Sandbox testing | 4 hours | QA |
| 7 | Documentation | 2 hours | Tech Writer |
| **Total** | | **28 hours** | |

---

## 12. KNOWN CONSTRAINTS & ASSUMPTIONS

### Constraints
- Safaricom Daraja API is in sandbox (test mode)
- Max withdrawal: KSh 150,000 per transaction
- Max deposit: KSh 150,000 per transaction
- M-Pesa callbacks must be processed within 5 seconds
- Supabase has 100 concurrent connections limit

### Assumptions
- Player phone numbers are always in format 254XXXXXXXXX
- All timestamps are UTC
- Network is reliable (but we handle timeouts)
- Safaricom IP ranges don't change frequently
- Admin users are trusted (no additional 2FA required for Phase 1)

### Risks & Mitigations
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Safaricom API downtime | Medium | High | Implement retry logic + alert admin |
| Callback IP spoofing | Low | Critical | Verify IP + log all requests |
| Duplicate callbacks | Medium | High | Implement idempotency checks |
| Database connection loss | Low | High | Implement connection pooling + retry |
| Race condition on wallet update | Low | Critical | Use database transactions + locks |

---

## 13. SUCCESS CRITERIA (EXPLICIT)

Phase 1 is complete when:
1. ✅ All 5 M-Pesa Edge Functions deployed and tested
2. ✅ All 6 admin API endpoints working
3. ✅ Dashboard shows real-time metrics
4. ✅ Withdrawal queue functional with auto-approve logic
5. ✅ Crash queue operational
6. ✅ Real STK Push tested with sandbox phone
7. ✅ Real B2C tested with sandbox phone
8. ✅ All callbacks processed correctly
9. ✅ Audit logs complete
10. ✅ Zero unhandled errors in production logs
11. ✅ All tests passing
12. ✅ Documentation complete

---

**Document Version**: 1.0  
**Last Updated**: 2026-06-11  
**Status**: READY FOR IMPLEMENTATION  
**Approval**: Pending
