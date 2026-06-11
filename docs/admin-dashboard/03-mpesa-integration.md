# 💳 Module 3: M-Pesa Paybill Integration

## Overview
Replace the simulated deposit/withdrawal system with real Safaricom Daraja API integration for:
- **STK Push** — Player deposits (Lipa Na M-Pesa Online)
- **B2C** — Player withdrawals (Business to Customer)
- **C2B** — Paybill direct payments (fallback)
- **Transaction Status** — Query pending transactions
- **Reversal** — Correct erroneous payments

---

## 3.1 Prerequisites & Setup

### Safaricom Daraja Portal Setup
1. Register at `developer.safaricom.co.ke`
2. Create app: "AviatorV2-Payments"
3. Select APIs: Lipa na M-Pesa Online, C2B, B2C, Transaction Status, Reversal
4. Get credentials: Consumer Key + Consumer Secret
5. Apply for production Paybill shortcode (requires business registration)

### Shortcode Type: **Paybill** (Recommended)
- Supports `AccountReference` for player-ID tracking
- Enables automated reconciliation
- Required for B2C withdrawals

### Environment Variables
```env
# M-Pesa Daraja API
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=174379          # Sandbox; replace with production
MPESA_PASSKEY=your_passkey
MPESA_ENVIRONMENT=sandbox        # sandbox | production
MPESA_B2C_INITIATOR=testapi
MPESA_B2C_PASSWORD=encrypted_credential
MPESA_CALLBACK_BASE_URL=https://yourdomain.com/api/mpesa
```

---

## 3.2 STK Push (Player Deposits)

### Flow
```
Player clicks "Deposit" → Enters amount + phone
     │
     ▼
Edge Function: /api/mpesa/stk-push
     │
     ├── 1. Get OAuth token from Daraja
     ├── 2. Send STK Push request
     ├── 3. Store CheckoutRequestID in mpesa_stk_requests
     ├── 4. Return "Check your phone" to player
     │
     ▼
Player enters M-Pesa PIN on phone
     │
     ▼
Safaricom POSTs callback to /api/mpesa/callback/stk
     │
     ├── 5. Verify ResultCode == 0
     ├── 6. Match CheckoutRequestID to pending request
     ├── 7. Credit player wallet
     ├── 8. Create transaction record
     └── 9. Notify player via WebSocket/realtime
```

### STK Push Request Payload
```typescript
interface STKPushRequest {
  BusinessShortCode: string;       // Your Paybill number
  Password: string;                // Base64(Shortcode + Passkey + Timestamp)
  Timestamp: string;               // YYYYMMDDHHmmss
  TransactionType: 'CustomerPayBillOnline';
  Amount: number;                  // KSh amount
  PartyA: string;                  // Player phone (2547XXXXXXXX)
  PartyB: string;                  // Same as BusinessShortCode
  PhoneNumber: string;             // Player phone (2547XXXXXXXX)
  CallBackURL: string;             // Your HTTPS callback endpoint
  AccountReference: string;        // Player ID or username
  TransactionDesc: string;         // "Aviator Deposit"
}
```

### Callback Payload (Success)
```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "29115-34620561-1",
      "CheckoutRequestID": "ws_CO_191220191020363925",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": {
        "Item": [
          { "Name": "Amount", "Value": 500 },
          { "Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV" },
          { "Name": "TransactionDate", "Value": 20191219102115 },
          { "Name": "PhoneNumber", "Value": 254708374149 }
        ]
      }
    }
  }
}
```

### Error Codes to Handle
| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Credit wallet |
| 1 | Insufficient balance | Notify player |
| 1032 | Request cancelled by user | Mark as cancelled |
| 1037 | DS timeout | Allow retry |
| 2001 | Wrong PIN | Notify player |
| 1001 | Unable to lock subscriber | Retry once |

---

## 3.3 B2C (Player Withdrawals)

### Flow
```
Player requests withdrawal → Creates withdrawal_request
     │
     ▼
Admin reviews (or auto-approve if low risk)
     │
     ▼
Edge Function: /api/mpesa/b2c
     │
     ├── 1. Get OAuth token
     ├── 2. Encrypt SecurityCredential
     ├── 3. Send B2C request
     ├── 4. Store ConversationID
     │
     ▼
Safaricom processes payment (1-30 seconds)
     │
     ▼
Callback to /api/mpesa/callback/b2c
     │
     ├── 5. Verify ResultCode == 0
     ├── 6. Mark withdrawal as completed
     ├── 7. Record MpesaReceiptNumber
     └── 8. Notify player
```

### B2C Request Payload
```typescript
interface B2CRequest {
  InitiatorName: string;           // API user name
  SecurityCredential: string;      // Encrypted with Safaricom cert
  CommandID: 'BusinessPayment';    // For withdrawals
  Amount: number;
  PartyA: string;                  // Your shortcode
  PartyB: string;                  // Player phone (2547XXXXXXXX)
  Remarks: string;                 // "Aviator Withdrawal"
  QueueTimeOutURL: string;
  ResultURL: string;
  Occasion: string;                // Player ID
}
```

### Security: Credential Encryption
```typescript
import crypto from 'crypto';

function encryptB2CCredential(password: string, certPath: string): string {
  const cert = fs.readFileSync(certPath, 'utf8');
  const encrypted = crypto.publicEncrypt(
    { key: cert, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(password)
  );
  return encrypted.toString('base64');
}
```

---

## 3.4 Admin Dashboard — M-Pesa Management Panel

### 3.4.1 Transaction Monitor
```
┌────────────────────────────────────────────────────┐
│  📱 M-PESA TRANSACTIONS                                │
├────────────────────────────────────────────────────┤
│  Today's Summary:                                    │
│  ━ Deposits: 145 | KSh 287,450 | Success: 92%       │
│  ━ Withdrawals: 38 | KSh 156,200 | Success: 97%     │
│  ━ Pending: 3 | Failed: 12 | Reversed: 1            │
├────────────────────────────────────────────────────┤
│  Receipt     | Phone        | Amount | Type | Status │
│  NLJ7RT61SV | 0712***456   | 500    | STK  | ✅     │
│  PLK8YU92WX | 0722***789   | 2,000  | STK  | ✅     │
│  QMN3DF45AB | 0733***012   | 10,000 | B2C  | ⏳     │
│  ---        | 0701***345   | 1,000  | STK  | ❌ 1032│
└────────────────────────────────────────────────────┘
```

### 3.4.2 M-Pesa Configuration Page
| Setting | Description | Admin Action |
|---------|-------------|-------------|
| Paybill Number | Active shortcode | View only |
| Min Deposit | Minimum deposit amount | Editable |
| Max Deposit | Maximum deposit amount | Editable |
| Min Withdrawal | Minimum withdrawal | Editable |
| Max Withdrawal | Maximum withdrawal | Editable |
| Daily Withdrawal Limit | Per-player daily cap | Editable |
| Auto-Approve Threshold | Below this = auto-approve | Editable |
| B2C Balance | Float available for payouts | View + Alert |
| API Status | Connected / Error | Health check |

### 3.4.3 Reconciliation Tool
- Compare Safaricom statement vs internal records
- Flag mismatches (credited but not received, or received but not credited)
- One-click resolution actions
- Daily automated reconciliation report

### 3.4.4 Manual Override Actions
| Action | Description | Requires |
|--------|-------------|----------|
| Manual Credit | Credit wallet without M-Pesa | Reason + amount |
| Force Status Query | Query Safaricom for stuck transaction | Receipt number |
| Initiate Reversal | Reverse a completed deposit | Receipt + reason |
| Retry B2C | Retry failed withdrawal | Request ID |
| Mark as Reconciled | Manual reconciliation | Admin approval |

---

## 3.5 Supabase Edge Functions Structure

```
supabase/functions/
├── mpesa-auth/            # Get OAuth token
│   └── index.ts
├── mpesa-stk-push/        # Initiate STK Push
│   └── index.ts
├── mpesa-stk-callback/    # Handle STK Push callback
│   └── index.ts
├── mpesa-b2c/             # Initiate B2C payment
│   └── index.ts
├── mpesa-b2c-callback/    # Handle B2C result
│   └── index.ts
├── mpesa-c2b-validation/  # Validate C2B payment
│   └── index.ts
├── mpesa-c2b-confirm/     # Confirm C2B payment
│   └── index.ts
├── mpesa-status/          # Query transaction status
│   └── index.ts
└── mpesa-reversal/        # Initiate reversal
    └── index.ts
```

---

## 3.6 Database Tables for M-Pesa

```sql
-- Enhanced mpesa_stk_requests table
CREATE TABLE mpesa_stk_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  phone_number text NOT NULL,
  amount decimal(12,2) NOT NULL,
  checkout_request_id text UNIQUE,
  merchant_request_id text,
  mpesa_receipt_number text,
  result_code integer,
  result_desc text,
  status text DEFAULT 'initiated' CHECK (status IN (
    'initiated', 'pending', 'completed', 'failed', 'cancelled', 'timeout'
  )),
  callback_payload jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- B2C withdrawal tracking
CREATE TABLE mpesa_b2c_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_request_id uuid REFERENCES withdrawal_requests(id),
  user_id uuid NOT NULL REFERENCES profiles(id),
  phone_number text NOT NULL,
  amount decimal(12,2) NOT NULL,
  conversation_id text UNIQUE,
  originator_conversation_id text,
  mpesa_receipt_number text,
  result_code integer,
  result_desc text,
  status text DEFAULT 'initiated' CHECK (status IN (
    'initiated', 'pending', 'completed', 'failed', 'timeout'
  )),
  callback_payload jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- M-Pesa configuration (admin-manageable)
ALTER TABLE mpesa_config ADD COLUMN IF NOT EXISTS
  auto_approve_threshold decimal(12,2) DEFAULT 5000.00;
ALTER TABLE mpesa_config ADD COLUMN IF NOT EXISTS
  daily_withdrawal_limit decimal(12,2) DEFAULT 50000.00;
ALTER TABLE mpesa_config ADD COLUMN IF NOT EXISTS
  b2c_float_balance decimal(12,2) DEFAULT 0.00;
ALTER TABLE mpesa_config ADD COLUMN IF NOT EXISTS
  last_float_update timestamptz;
```

---

## 3.7 Security Best Practices

1. **TLS Only** — All callback URLs must be HTTPS
2. **IP Whitelist** — Only accept callbacks from Safaricom IPs: `196.201.214.200-208`
3. **Idempotency** — Check CheckoutRequestID/MpesaReceiptNumber before processing
4. **Credential Encryption** — Store all secrets in Supabase Vault or environment variables
5. **Request Signing** — Validate callback authenticity before crediting
6. **Rate Limiting** — Max 5 STK Push requests per phone per minute
7. **Audit Logging** — Log every M-Pesa interaction with timestamps
8. **Timeout Handling** — Auto-query status after 60s if no callback received
9. **Float Monitoring** — Alert admin when B2C balance drops below threshold
10. **Reconciliation** — Daily automated check against Safaricom statement
