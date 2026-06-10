# Aviator Admin Dashboard — Technical Documentation

## Overview

The Aviator Admin Dashboard is a comprehensive management interface for operating the crash game platform. It provides tools for game control, financial management, user oversight, marketing/affiliates, and risk management.

**Access:** `/admin` route within the same aviator_v2 application  
**Auth:** Separate admin authentication system (not shared with player auth)  
**Target:** Desktop-first (responsive but optimized for large screens)  
**Tech:** React + TypeScript + Tailwind CSS + shadcn/ui + Recharts

---

## Table of Contents

1. [Architecture](./01-architecture.md)
2. [Database Schema](./02-database-schema.md)
3. [Admin Authentication](./03-admin-auth.md)
4. [Game Engine & Crash Control](./04-game-engine.md)
5. [M-Pesa Integration](./05-mpesa-integration.md)
6. [User Management](./06-user-management.md)
7. [Affiliate System](./07-affiliate-system.md)
8. [Financial Management](./08-financial-management.md)
9. [Risk & Fraud](./09-risk-fraud.md)
10. [Marketing & Promotions](./10-marketing-promotions.md)
11. [Chat Moderation](./11-chat-moderation.md)
12. [Analytics & Reporting](./12-analytics-reporting.md)
13. [System Settings](./13-system-settings.md)
14. [API Endpoints](./14-api-endpoints.md)
15. [Implementation Plan](./15-implementation-plan.md)
16. [UI Routes & Pages](./16-ui-routes.md)

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Admin route | `/admin` in same repo | Single deployment, shared components |
| Admin auth | Separate system | Security isolation from player accounts |
| M-Pesa | Sandbox first | No Daraja production account yet |
| Affiliates | Promoted users | No separate registration — admin elevates existing players |
| Phasing | Efficiency-first | Core revenue features before nice-to-haves |

---

## Quick Start (Development)

```bash
# All admin routes are under /admin/*
# Admin auth is stored in admin_users table
# Default super admin created via seed script
# M-Pesa uses sandbox credentials (auto-configured)
```
