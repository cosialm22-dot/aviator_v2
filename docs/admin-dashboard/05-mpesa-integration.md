# 05 — M-Pesa Integration (Safaricom Daraja API)

## Overview

M-Pesa is the primary payment method for Kenyan users. We integrate via Safaricom's **Daraja API** for:
- **C2B (Customer to Business)**: Player deposits via STK Push
- **B2C (Business to Customer)**: Player withdrawals/payouts

## Sandbox vs Production

| | Sandbox | Production |
|--|---------|------------|
| Base URL | `https://sandbox.safaricom.co.ke` | `https://api.safaricom.co.ke` |
| Credentials | Test keys from Daraja portal | Real business credentials |
| Short Code | `174379` (test) | Your registered Paybill |
| Phone Numbers | Test numbers only | Real M-Pesa numbers |
| Money Movement | Simulated | Real money |
| Approval | Instant | Requires Safaricom review |

**Current status: SANDBOX** — All development uses sandbox credentials.

## Sandbox Setup

### 1. Register on Daraja
- URL: https://developer.safaricom.co.ke
- Create account → Create App → Get Consumer Key + Secret
- Enable: Lipa Na M-Pesa (STK Push), B2C

### 2. Sandbox Credentials
```
Consumer Key:     [from Daraja portal]
Consumer Secret:  [from Daraja portal]
Passkey:          bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
Business Short Code: 174379
Initiator Name:   testapi
Security Credential: [generated via Daraja cert tool]
```

### 3. Test Phone Numbers
- Use: `254708374149` (sandbox test number)
- STK Push will auto-succeed in sandbox

## C2B Flow (Deposits)

### STK Push (Lipa Na M-Pesa Online)

This is the preferred deposit method — sends a payment prompt directly to the player's phone.

```
Player Flow:
1. Player enters deposit amount in app (e.g., KSh 500)
2. App calls our Edge Function: POST /functions/v1/mpesa-stk-push
3. Edge Function:
   a. Gets OAuth token from Safaricom
   b. Sends STK Push request to player's phone
   c. Returns CheckoutRequestID to app
4. Player sees M-Pesa prompt on phone, enters PIN
5. Safaricom processes payment
6. Safaricom calls our callback URL with result
7. Edge Function (callback handler):
   a. Validates callback data
   b. Credits player's wallet
   c. Records in transactions + mpesa_transactions
   d. Sends realtime notification to player
```

### API Calls

#### Step 1: Get OAuth Token
```http
GET https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials
Authorization: Basic base64(consumer_key:consumer_secret)

Response:
{
  "access_token": "...",
  "expires_in": "3599"
}
```

#### Step 2: Initiate STK Push
```http
POST https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "BusinessShortCode": "174379",
  "Password": base64(BusinessShortCode + Passkey + Timestamp),
  "Timestamp": "20260610143000",  // YYYYMMDDHHmmss
  "TransactionType": "CustomerPayBillOnline",
  "Amount": 500,
  "PartyA": "254712345678",       // Player's phone
  "PartyB": "174379",              // Business short code
  "PhoneNumber": "254712345678",
  "CallBackURL": "https://yhfxgzfmcwinpgmzcgma.supabase.co/functions/v1/mpesa-callback",
  "AccountReference": "AviatorDeposit",
  "TransactionDesc": "Game Deposit"
}

Response:
{
  "MerchantRequestID": "...",
  "CheckoutRequestID": "ws_CO_...",
  "ResponseCode": "0",
  "ResponseDescription": "Success. Request accepted for processing"
}
```

#### Step 3: Callback (Safaricom → Our Server)
```http
POST /functions/v1/mpesa-callback

{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "...",
      "CheckoutRequestID": "ws_CO_...",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": {
        "Item": [
          {"Name": "Amount", "Value": 500},
          {"Name": "MpesaReceiptNumber", "Value": "QKJ3B1C5XY"},
          {"Name": "TransactionDate", "Value": 20260610143025},
          {"Name": "PhoneNumber", "Value": 254712345678}
        ]
      }
    }
  }
}
```

## B2C Flow (Withdrawals)

### Business to Customer Payment

```
Withdrawal Flow:
1. Player requests withdrawal (amount + phone number)
2. Request saved to withdrawal_requests (status: 'pending')
3. Admin reviews in dashboard OR auto-approved if < threshold
4. On approval:
   a. Edge Function calls Safaricom B2C API
   b. Safaricom sends money to player's M-Pesa
   c. Result callback confirms success/failure
   d. Update withdrawal_requests + transactions
```

### API Calls

#### B2C Payment Request
```http
POST https://sandbox.safaricom.co.ke/mpesa/b2c/v3/paymentrequest
Authorization: Bearer {access_token}

{
  "OriginatorConversationID": "unique-id-here",
  "InitiatorName": "testapi",
  "SecurityCredential": "encrypted_credential",
  "CommandID": "BusinessPayment",
  "Amount": 500,
  "PartyA": "174379",              // Business short code
  "PartyB": "254712345678",       // Player's phone
  "Remarks": "Aviator Withdrawal",
  "QueueTimeOutURL": "https://yhfxgzfmcwinpgmzcgma.supabase.co/functions/v1/mpesa-b2c-timeout",
  "ResultURL": "https://yhfxgzfmcwinpgmzcgma.supabase.co/functions/v1/mpesa-b2c-result",
  "Occasion": "Game Winnings"
}
```

## Edge Functions Required

| Function | Trigger | Purpose |
|----------|---------|----------|
| `mpesa-stk-push` | HTTP POST (from app) | Initiate deposit STK Push |
| `mpesa-callback` | HTTP POST (from Safaricom) | Handle deposit confirmation |
| `mpesa-b2c-payment` | HTTP POST (from admin) | Initiate withdrawal payment |
| `mpesa-b2c-result` | HTTP POST (from Safaricom) | Handle withdrawal result |
| `mpesa-b2c-timeout` | HTTP POST (from Safaricom) | Handle timeout/retry |
| `mpesa-token` | Internal | Get/cache OAuth token |

## Admin Dashboard: M-Pesa Config Page

```
┌────────────────────────────────────────────────────────┐
│  M-PESA CONFIGURATION                                  │
├────────────────────────────────────────────────────────┤
│  Environment: [● Sandbox] [○ Production]                 │
│                                                        │
│  Consumer Key:      [*************3f9a] [👁 Show]       │
│  Consumer Secret:   [*************8b2c] [👁 Show]       │
│  Passkey:           [*************c919] [👁 Show]       │
│  Business Code:     [174379          ]                 │
│  Initiator Name:    [testapi         ]                 │
│  Security Cred:     [*************] [👁 Show]           │
│                                                        │
│  Callback Base URL: [https://yhfxg...supabase.co]      │
│                                                        │
│  Status: ✅ Connected (last token: 2 min ago)            │
│                                                        │
│  [🔄 Test Connection]  [💾 Save Changes]                │
└────────────────────────────────────────────────────────┘
```

## Transaction Reconciliation

Admin can:
1. View all M-Pesa transactions (inbound + outbound)
2. Match with internal transactions table
3. Flag mismatches (payment received but wallet not credited)
4. Manually reconcile failed callbacks
5. Retry failed B2C payments
6. View daily settlement reports

## Error Handling

| Error | Action |
|-------|--------|
| STK Push timeout (player didn't enter PIN) | Mark as expired, notify player |
| Insufficient B2C balance | Alert admin, queue for retry |
| Callback URL unreachable | Safaricom retries 3x; implement query API as fallback |
| Duplicate transaction | Deduplicate by MpesaReceiptNumber |
| Invalid phone number | Validate format before sending (254XXXXXXXXX) |

## Security

1. **Validate callbacks**: Check that requests actually come from Safaricom IPs
2. **Idempotency**: Use MpesaReceiptNumber to prevent double-crediting
3. **Encryption**: Store credentials encrypted in DB (AES-256)
4. **Logging**: Full callback payloads stored for dispute resolution
5. **Amount validation**: Max single deposit/withdrawal limits enforced
