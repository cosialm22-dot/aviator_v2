# 03 — Admin Authentication

## Overview

Admin auth is **completely separate** from player auth. It uses its own table (`admin_users`), its own session management (`admin_sessions`), and does NOT use Supabase Auth.

## Why Separate?

1. **Security isolation** — Compromised player auth won't affect admin access
2. **Different session rules** — Shorter timeouts, 2FA requirement, IP restrictions
3. **Role-based access** — Granular permissions not needed for players
4. **Audit requirements** — Every admin action logged, not needed for players

## Authentication Flow

### Login
```
1. Admin navigates to /admin
2. Enters email + password
3. If 2FA enabled: enters TOTP code
4. Server validates credentials:
   a. Hash password with bcrypt, compare to stored hash
   b. If 2FA: validate TOTP token
   c. Generate session token (crypto.randomUUID)
   d. Store in admin_sessions with 30-min expiry
   e. Return session token + admin profile
5. Client stores token in memory (NOT localStorage for XSS protection)
6. All subsequent API calls include token in Authorization header
```

### Session Management
```
- Token stored in httpOnly cookie (preferred) or memory
- Every API request:
  1. Extract token from cookie/header
  2. Look up in admin_sessions
  3. Check expires_at > now()
  4. If valid: extend expires_at by 30 min (sliding window)
  5. If expired: return 401, redirect to login
- Explicit logout: delete session from DB
- Inactivity timeout: 30 minutes
- Max session duration: 8 hours (hard cap)
```

### Password Requirements
- Minimum 12 characters
- Must include: uppercase, lowercase, number, special character
- Bcrypt hash with cost factor 12
- No password reuse (store last 5 hashes)

### Two-Factor Authentication (2FA)
- TOTP-based (compatible with Google Authenticator, Authy)
- **Required** for super_admin role
- Optional but encouraged for other roles
- Recovery codes: 10 single-use codes generated at setup
- Admin can reset another admin's 2FA (super_admin only)

## Roles & Permissions

| Permission | Super Admin | Admin | Finance | Support | Marketing |
|-----------|:-----------:|:-----:|:-------:|:-------:|:---------:|
| View dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Game control (crash queue, overrides) | ✅ | ✅ | ❌ | ❌ | ❌ |
| View users | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ban/unban users | ✅ | ✅ | ❌ | ✅ | ❌ |
| Adjust balances | ✅ | ✅ | ✅ | ❌ | ❌ |
| Approve withdrawals | ✅ | ✅ | ✅ | ❌ | ❌ |
| M-Pesa config | ✅ | ❌ | ✅ | ❌ | ❌ |
| Manage affiliates | ✅ | ✅ | ❌ | ❌ | ✅ |
| Create promotions | ✅ | ✅ | ❌ | ❌ | ✅ |
| View analytics | ✅ | ✅ | ✅ | ❌ | ✅ |
| Chat moderation | ✅ | ✅ | ❌ | ✅ | ❌ |
| System settings | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage admins | ✅ | ❌ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ❌ | ❌ | ❌ |
| API key management | ✅ | ❌ | ❌ | ❌ | ❌ |

## Initial Setup

First super admin is created via a **seed script** (run once during deployment):

```sql
-- Run this manually or via migration to create first admin
INSERT INTO admin_users (email, password_hash, display_name, role)
VALUES (
  'admin@aviator.app',
  '$2b$12$...', -- bcrypt hash of initial password
  'Super Admin',
  'super_admin'
);
```

The seed script will:
1. Prompt for email and password
2. Hash the password
3. Insert into admin_users
4. Output: "Admin created. Please login and enable 2FA immediately."

## Security Considerations

1. **Rate limiting**: 5 failed login attempts → 15-minute lockout
2. **IP logging**: Every login attempt logged with IP
3. **Suspicious activity**: Alert if login from new IP/device
4. **Session invalidation**: All sessions killed on password change
5. **CORS**: Admin API endpoints restricted to admin domain/route
6. **CSP headers**: Strict Content-Security-Policy for admin pages
