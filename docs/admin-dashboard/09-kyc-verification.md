# 🆔 Module 9: KYC Verification

## Overview
Know Your Customer verification workflow for regulatory compliance and fraud prevention.

---

## 9.1 KYC Tiers

| Tier | Requirements | Limits Unlocked |
|------|-------------|------------------|
| Tier 0 (Unverified) | Phone only | Deposit: KSh 5,000/day, Withdraw: KSh 2,000/day |
| Tier 1 (Basic) | National ID + Selfie | Deposit: KSh 50,000/day, Withdraw: KSh 50,000/day |
| Tier 2 (Full) | ID + Proof of Address + Source of Funds | Unlimited |

---

## 9.2 Verification Flow

```
Player triggers KYC (or limit hit)
       │
       ▼
Upload Documents:
  • National ID (front + back) OR Passport
  • Selfie with ID
  • Proof of address (utility bill < 3 months) [Tier 2]
       │
       ▼
Automated Checks:
  • Image quality validation
  • OCR extraction (name, ID number, DOB)
  • Face match (selfie vs ID photo)
  • ID number format validation
       │
       ▼
Status: Auto-approved OR Sent to manual review
       │
       ▼
Admin Review Queue (if manual):
  • View documents side by side
  • Approve / Reject with reason
  • Request additional documents
```

---

## 9.3 Admin KYC Queue

```
┌────────────────────────────────────────────────────┐
│ KYC REVIEW QUEUE (8 pending)                         │
├────────────────────────────────────────────────────┤
│ Player   | Tier | Docs        | Submitted  | Action  │
│ player12 | T1   | ID + Selfie | 2hr ago    | Review  │
│ player45 | T2   | ID + POA    | 5hr ago    | Review  │
└────────────────────────────────────────────────────┘
```

### Review UI
- Document viewer (zoom, rotate)
- OCR extracted data displayed
- Face comparison (side by side)
- Previous rejection history
- One-click: Approve / Reject (select reason) / Request more docs

---

## 9.4 Document Storage

Use Supabase Storage with restricted bucket:
```
storage/kyc-documents/
  {user_id}/
    national-id-front.jpg
    national-id-back.jpg
    selfie.jpg
    proof-of-address.pdf
```

Access: Admin-only via RLS policies.

---

## 9.5 Database Schema

```sql
CREATE TABLE kyc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  tier integer NOT NULL CHECK (tier IN (1, 2)),
  id_type text CHECK (id_type IN ('national_id', 'passport', 'alien_id')),
  id_number text,
  full_name text,
  date_of_birth date,
  id_front_url text,
  id_back_url text,
  selfie_url text,
  poa_url text,
  ocr_data jsonb,
  face_match_score decimal(5,2),
  auto_check_passed boolean,
  status text DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'more_info_needed')
  ),
  rejection_reason text,
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Add KYC status to profiles
ALTER TABLE profiles ADD COLUMN kyc_tier integer DEFAULT 0;
ALTER TABLE profiles ADD COLUMN kyc_status text DEFAULT 'unverified';
```
