# 🔐 Module 11: Role-Based Access Control (RBAC)

## Overview
Granular permission system for multiple admin users with different access levels.

---

## 11.1 Roles

| Role | Description | Access Level |
|------|-------------|-------------|
| Super Admin | Platform owner | Full access to everything |
| Admin | Senior manager | All except system settings & RBAC |
| Finance Manager | Handles money | Withdrawals, deposits, reconciliation |
| Game Operator | Manages game | Crash queue, algorithm, bot settings |
| Support Agent | Player support | View players, adjust balances (limited) |
| Marketing Manager | Growth | Affiliates, bonuses, campaigns |
| Compliance Officer | Regulatory | KYC, responsible gambling, reports |
| Viewer | Read-only | Dashboard analytics only |

---

## 11.2 Permission Matrix

| Permission | Super Admin | Admin | Finance | Game Op | Support | Marketing | Compliance | Viewer |
|-----------|:-----------:|:-----:|:-------:|:-------:|:-------:|:---------:|:----------:|:------:|
| View Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View Players | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Ban/Unban | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Adjust Balance | ✅ | ✅ | ✅ | ❌ | ⚠️* | ❌ | ❌ | ❌ |
| Approve Withdrawals | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Crash Queue | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Edit Algorithm | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Emergency Controls | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage Affiliates | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Create Bonuses | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Review KYC | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| System Settings | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View Audit Log | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| M-Pesa Config | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Export Data | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |

*Support can adjust up to KSh 1,000 only

---

## 11.3 Implementation

### Database
```sql
CREATE TABLE admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  permissions jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

-- Update profiles to support multiple roles
ALTER TABLE profiles ADD COLUMN admin_role uuid REFERENCES admin_roles(id);
ALTER TABLE profiles ADD COLUMN permissions_override jsonb DEFAULT '[]';
```

### Permission Check Hook
```typescript
function usePermission(permission: string): boolean {
  const { user } = useAuth();
  const role = user?.admin_role;
  if (!role) return false;
  return role.permissions.includes(permission) ||
         user.permissions_override?.includes(permission) ||
         role.permissions.includes('*');  // Super admin wildcard
}

// Usage in components
const canApproveWithdrawals = usePermission('withdrawals.approve');
```

---

## 11.4 Admin Management UI

- Invite new admin (email invite)
- Assign/change role
- Override specific permissions
- View admin activity log
- Disable/enable admin account
- Require 2FA for admin login
