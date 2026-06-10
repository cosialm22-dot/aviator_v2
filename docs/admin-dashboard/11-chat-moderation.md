# 11 — Chat Moderation

## Features

### Live Monitor
- Real-time chat feed (same as player sees)
- Admin actions on hover: delete, mute user
- Highlighted messages: flagged words, reported

### Word Filter
- Configurable banned words list
- Auto-replace with *** or auto-delete
- Regex support for patterns
- Bypass for admins

### User Actions
| Action | Duration | Effect |
|--------|----------|--------|
| Mute | 1h / 24h / 7d / permanent | Can't send messages |
| Chat ban | Permanent | Removed from chat entirely |
| Delete message | Instant | Message removed for all |
| Pin message | Until unpinned | Shows at top of chat |

### Slow Mode
- Limit messages per user: 1 per 5/10/30 seconds
- Applied globally during peak spam times

### Report Queue
- Players can report messages
- Queue in admin with: message, reporter, reason
- Actions: Dismiss, Delete + Warn, Delete + Mute
