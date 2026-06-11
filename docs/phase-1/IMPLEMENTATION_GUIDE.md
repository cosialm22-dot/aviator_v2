# 🔧 M-PESA EDGE FUNCTIONS IMPLEMENTATION
## Option 1: Complete Implementation with Uncompromising Rigor

**Status**: IMPLEMENTATION PHASE  
**Rigor Level**: Senior Engineer (Zero Tolerance for Shortcuts)  
**Date**: 2026-06-11  

---

## PART 1: FOUNDATION & EXPLICIT REASONING

### 1.1 Why Edge Functions?
**Reasoning**: 
- M-Pesa callbacks must be processed within 5 seconds (Safaricom requirement)
- Edge Functions run on Supabase's edge network (low latency)
- No cold start delays (unlike traditional serverless)
- Direct database access (no API round trips)
- Built-in authentication & authorization
- Automatic HTTPS (required by Safaricom)

### 1.2 Function Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    EDGE FUNCTIONS                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. mpesa-auth                                        │  │
│  │    Purpose: Get OAuth token from Daraja             │  │
│  │    Called by: All other functions                   │  │
│  │    Caching: 55 minutes (expires in 60)              │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 2. mpesa-stk-push                                    │  │
│  │    Purpose: Initiate STK Push for deposits          │  │
│  │    Input: amount, phone, user_id                    │  │
│  │    Output: checkout_request_id                      │  │
│  │    Stores: mpesa_stk_requests (status: initiated)   │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 3. mpesa-stk-callback                               │  │
│  │    Purpose: Handle STK Push callback from Safaricom │  │
│  │    Input: Callback payload from Safaricom           │  │
│  │    Processing: Verify, credit wallet, log           │  │
│  │    Output: HTTP 200 (within 5 seconds)              │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 4. mpesa-b2c                                         │  │
│  │    Purpose: Initiate B2C payment for withdrawals    │  │
│  │    Input: withdrawal_request_id, amount, phone      │  │
│  │    Output: conversation_id                          │  │
│  │    Stores: mpesa_b2c_requests (status: initiated)   │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 5. mpesa-b2c-callback                               │  │
│  │    Purpose: Handle B2C result callback from Safaricom│ │
│  │    Input: Callback payload from Safaricom           │  │
│  │    Processing: Verify, update status, log           │  │
│  │    Output: HTTP 200 (within 5 seconds)              │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Error Handling Strategy
**Principle**: Every error must be:
1. **Caught** (no unhandled exceptions)
2. **Logged** (for debugging)
3. **Classified** (error type)
4. **Handled** (appropriate response)
5. **Retryable** (if applicable)

**Error Categories**:
- **Network Errors**: Retry with exponential backoff
- **Validation Errors**: Return 400 (client error)
- **Authentication Errors**: Return 401 (auth error)
- **Authorization Errors**: Return 403 (forbidden)
- **Not Found Errors**: Return 404 (not found)
- **Server Errors**: Return 500 (server error)
- **Timeout Errors**: Return 504 (gateway timeout)

### 1.4 Security Strategy
**Principle**: Defense in depth

1. **Input Validation**: Validate all inputs before processing
2. **IP Verification**: Only accept from Safaricom IPs
3. **Signature Verification**: Verify callback authenticity
4. **Idempotency**: Same callback twice = same result
5. **Rate Limiting**: Prevent abuse
6. **Logging**: Audit trail for compliance
7. **Encryption**: Credentials in environment variables only

### 1.5 Performance Strategy
**Principle**: Minimal latency, maximum throughput

1. **Token Caching**: Cache OAuth token for 55 minutes
2. **Database Indexing**: All queries use indexes
3. **Connection Pooling**: Reuse database connections
4. **Async Operations**: Non-blocking where possible
5. **Early Returns**: Fail fast on validation errors

---

## PART 2: IMPLEMENTATION CHECKLIST

### Pre-Implementation Verification
- [ ] Supabase project accessible
- [ ] M-Pesa credentials verified
- [ ] Database migration applied
- [ ] All tables created
- [ ] All indexes created
- [ ] RLS policies applied
- [ ] Environment variables configured

### Function 1: mpesa-auth
- [ ] Get OAuth token from Daraja
- [ ] Cache token for 55 minutes
- [ ] Handle network errors (retry 3x)
- [ ] Handle invalid credentials
- [ ] Handle rate limiting (429)
- [ ] Log all requests
- [ ] Return token in correct format

### Function 2: mpesa-stk-push
- [ ] Validate input (amount, phone, user_id)
- [ ] Check rate limit (5 per phone per minute)
- [ ] Get OAuth token
- [ ] Build STK Push payload
- [ ] Send to Daraja
- [ ] Store CheckoutRequestID in database
- [ ] Return CheckoutRequestID to client
- [ ] Handle all error scenarios
- [ ] Log all requests

### Function 3: mpesa-stk-callback
- [ ] Verify IP is from Safaricom
- [ ] Verify CheckoutRequestID exists
- [ ] Check idempotency
- [ ] Process success (ResultCode == 0)
- [ ] Process failure (ResultCode != 0)
- [ ] Credit wallet on success
- [ ] Create transaction record
- [ ] Update profiles.total_deposited
- [ ] Broadcast to admin via Realtime
- [ ] Log all callbacks
- [ ] Return HTTP 200 within 5 seconds

### Function 4: mpesa-b2c
- [ ] Validate withdrawal_request_id exists
- [ ] Validate status = pending
- [ ] Validate amount matches
- [ ] Validate phone matches
- [ ] Check admin permissions
- [ ] Get OAuth token
- [ ] Encrypt SecurityCredential
- [ ] Build B2C payload
- [ ] Send to Daraja
- [ ] Store ConversationID in database
- [ ] Debit wallet
- [ ] Create transaction record
- [ ] Update withdrawal_requests status
- [ ] Broadcast to admin
- [ ] Log all requests

### Function 5: mpesa-b2c-callback
- [ ] Verify IP is from Safaricom
- [ ] Verify ConversationID exists
- [ ] Check idempotency
- [ ] Process success (ResultCode == 0)
- [ ] Process failure (ResultCode != 0)
- [ ] Update withdrawal_requests status
- [ ] Update mpesa_b2c_requests status
- [ ] Update transaction status
- [ ] On failure: reverse wallet debit
- [ ] Broadcast to admin
- [ ] Log all callbacks
- [ ] Return HTTP 200 within 5 seconds

---

## PART 3: EXPLICIT DEPENDENCIES

### External Dependencies
- `@supabase/supabase-js`: Database access
- `node-fetch` or `axios`: HTTP requests (built-in to Deno)
- `crypto`: Encryption (built-in to Deno)

### Internal Dependencies
- `mpesa_stk_requests` table
- `mpesa_b2c_requests` table
- `withdrawal_requests` table
- `wallets` table
- `profiles` table
- `transactions` table
- `admin_audit_log` table

### Environment Variables
- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `MPESA_SHORTCODE`
- `MPESA_PASSKEY`
- `MPESA_ENVIRONMENT` (sandbox or production)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## PART 4: EXPLICIT ASSUMPTIONS

### Assumption 1: Phone Number Format
**Assumption**: All phone numbers are in format `254XXXXXXXXX`
**Verification**: Regex validation `^254[0-9]{9}$`
**Fallback**: Reject if doesn't match

### Assumption 2: Amount Validation
**Assumption**: Amounts are in KSh, range 100-150,000
**Verification**: Check `amount >= 100 AND amount <= 150000`
**Fallback**: Reject if outside range

### Assumption 3: Safaricom IP Ranges
**Assumption**: Callbacks only from `196.201.214.200-208`
**Verification**: IP whitelist check
**Fallback**: Reject if not in range

### Assumption 4: Callback Timeout
**Assumption**: Must respond within 5 seconds
**Verification**: Measure response time
**Fallback**: Log if exceeds 5 seconds

### Assumption 5: Token Expiry
**Assumption**: OAuth token expires in 60 minutes
**Verification**: Cache for 55 minutes
**Fallback**: Refresh if expired

---

## PART 5: EXPLICIT EDGE CASES

### Edge Case 1: Duplicate Callbacks
**Scenario**: Safaricom sends same callback twice
**Handling**: Check if already processed (idempotency)
**Response**: Return 200 (already handled)

### Edge Case 2: Network Timeout
**Scenario**: Daraja API doesn't respond
**Handling**: Retry 3x with exponential backoff (1s, 2s, 4s)
**Response**: Return 504 after 3 retries

### Edge Case 3: Invalid Credentials
**Scenario**: Consumer Key/Secret are wrong
**Handling**: Log error, alert admin
**Response**: Return 401

### Edge Case 4: Rate Limit Exceeded
**Scenario**: Too many requests to Daraja
**Handling**: Wait 60 seconds, retry once
**Response**: Return 429

### Edge Case 5: Wallet Not Found
**Scenario**: Player wallet doesn't exist
**Handling**: Create wallet (should not happen)
**Response**: Return 500 (server error)

### Edge Case 6: Callback Before Request
**Scenario**: Callback arrives before STK Push request stored
**Handling**: Wait and retry (should not happen)
**Response**: Return 400 (not found)

### Edge Case 7: Concurrent Callbacks
**Scenario**: Two callbacks for same request simultaneously
**Handling**: Database transaction ensures only one processes
**Response**: Both return 200 (idempotent)

### Edge Case 8: Partial Callback Data
**Scenario**: Callback missing required fields
**Handling**: Log error, mark as failed
**Response**: Return 400 (bad request)

---

## PART 6: TESTING STRATEGY

### Unit Tests
- Input validation (valid/invalid amounts, phones)
- Token caching (expires correctly)
- Payload building (correct format)
- Error handling (all error types)

### Integration Tests
- Full STK Push flow (mock Daraja)
- Full B2C flow (mock Daraja)
- Callback processing (idempotency)
- Database transactions (atomicity)

### Sandbox Tests
- Real STK Push with test phone
- Real B2C with test phone
- Callback verification
- Error scenarios

### Load Tests
- 100 concurrent requests
- Response time < 500ms
- No database connection errors
- No memory leaks

---

## PART 7: DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] All functions tested locally
- [ ] All tests passing
- [ ] TypeScript strict mode: no errors
- [ ] Environment variables configured
- [ ] Database migration applied
- [ ] M-Pesa credentials verified
- [ ] Callback URLs registered with Safaricom
- [ ] IP whitelist configured
- [ ] Monitoring configured

### Deployment
- [ ] Deploy functions to Supabase
- [ ] Verify functions are accessible
- [ ] Test with sandbox credentials
- [ ] Monitor logs for errors

### Post-Deployment
- [ ] Test STK Push with real phone
- [ ] Test B2C with real phone
- [ ] Monitor error logs for 24 hours
- [ ] Verify all metrics in dashboard
- [ ] Check audit log entries

---

**Ready to implement. Let's build this with uncompromising rigor.**
