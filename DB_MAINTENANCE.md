# Database Maintenance & Cleanup System

## Overview

The ThreadSync LAN Chat application now includes an **automatic database maintenance system** to prevent the SQLite database from growing too large, especially important for production deployment on Render.

---

## Features

### 1. **Automatic Cleanup Scheduler**
- Runs every **6 hours** automatically
- Executes on server startup (after 2 seconds initialization)
- Runs maintenance tasks in sequence:
  - Delete messages older than 30 days
  - Delete logs older than 14 days
  - Delete user events older than 7 days
  - Enforce maximum message limits per room

### 2. **Database Size Monitoring**
- Tracks database file size in MB
- Logs database stats after each cleanup
- Alerts if database exceeds threshold (100MB)
- Provides real-time statistics endpoint

### 3. **Configurable Retention Policies**
All configuration values can be adjusted in `db.js`:

```javascript
const DB_CONFIG = {
    MESSAGE_RETENTION_DAYS: 30,       // Keep messages for 30 days
    LOG_RETENTION_DAYS: 14,           // Keep logs for 14 days
    USER_EVENT_RETENTION_DAYS: 7,     // Keep user events for 7 days
    MAX_MESSAGES_PER_ROOM: 5000,      // Max 5000 messages per room
    MAX_LOGS_PER_ROOM: 10000,         // Max 10000 log entries per room
    CLEANUP_INTERVAL_MS: 6 * 60 * 60 * 1000,  // Run every 6 hours
    MAX_DB_SIZE_MB: 100               // Alert threshold
};
```

---

## Maintenance Strategies

### Strategy 1: Time-Based Retention (Default)
Messages are automatically deleted after the specified retention period:
- **Messages**: 30 days
- **Logs**: 14 days
- **User Events**: 7 days

**Best for**: Production where you want to keep recent history but not archive everything forever

### Strategy 2: Per-Room Message Limits
Each room is limited to a maximum number of messages (default: 5,000):
- Oldest messages are automatically deleted when limit is exceeded
- Prevents individual rooms from consuming excessive disk space

**Best for**: High-activity rooms that need bounded storage

### Strategy 3: Aggressive Cleanup
Reduce retention periods for more aggressive cleanup:
```javascript
DB_CONFIG.MESSAGE_RETENTION_DAYS = 7;  // Weekly cleanup
DB_CONFIG.LOG_RETENTION_DAYS = 3;      // Delete logs after 3 days
```

---

## Admin API Endpoints

### 1. **Get Database Statistics**
```bash
GET http://localhost:3000/api/admin/db-stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalMessages": 1250,
    "totalLogs": 8934,
    "totalEvents": 156,
    "uniqueRooms": 3,
    "databaseSizeMB": 2.45,
    "timestamp": "2026-04-24T15:30:00.000Z"
  },
  "config": {
    "MESSAGE_RETENTION_DAYS": 30,
    "LOG_RETENTION_DAYS": 14,
    "USER_EVENT_RETENTION_DAYS": 7,
    "MAX_MESSAGES_PER_ROOM": 5000,
    "MAX_DB_SIZE_MB": 100,
    "CLEANUP_INTERVAL_HOURS": 6
  }
}
```

### 2. **Trigger Immediate Maintenance**
```bash
POST http://localhost:3000/api/admin/maintenance
```

**Response shows before/after statistics:**
```json
{
  "success": true,
  "message": "Maintenance cycle completed",
  "before": { "databaseSizeMB": 5.32, "totalMessages": 8900 },
  "after": { "databaseSizeMB": 3.12, "totalMessages": 6200 }
}
```

### 3. **Update Retention Configuration**
```bash
POST http://localhost:3000/api/admin/configure-retention
Content-Type: application/json

{
  "messageDays": 14,
  "logDays": 7,
  "eventDays": 3,
  "maxMessagesPerRoom": 3000
}
```

---

## Production Recommendations

### For Render Deployment

1. **Aggressive Retention** (tight disk space):
   ```javascript
   MESSAGE_RETENTION_DAYS: 7      // 1 week
   LOG_RETENTION_DAYS: 3          // 3 days
   MAX_MESSAGES_PER_ROOM: 2000    // Strict limit
   CLEANUP_INTERVAL_MS: 3 * 60 * 60 * 1000  // Every 3 hours
   ```

### GitHub Actions Backup Flow

If you want durable backups on GitHub, use the scheduled workflow in [`.github/workflows/backup-db.yml`](.github/workflows/backup-db.yml).

Set these Render secrets or environment variables:

```bash
RENDER_DB_BACKUP_URL=https://your-render-app.onrender.com/api/admin/db-backup
RENDER_DB_BACKUP_TOKEN=some-long-random-secret
BACKUP_TOKEN=some-long-random-secret
```

The backup endpoint returns a clean SQLite snapshot, and GitHub Actions uploads it to a GitHub Release asset. That gives you offsite retention without storing the live database inside the repo.

Recommended schedule:
- Daily backup if the chat is active
- Weekly backup if traffic is low and you want fewer releases

2. **Balanced Retention** (recommended):
   ```javascript
   MESSAGE_RETENTION_DAYS: 30     // 1 month
   LOG_RETENTION_DAYS: 14         // 2 weeks
   MAX_MESSAGES_PER_ROOM: 5000    // Default
   CLEANUP_INTERVAL_MS: 6 * 60 * 60 * 1000  // Every 6 hours
   ```

3. **Archive Strategy** (high activity):
   - Enable time-based cleanup
   - Use per-room limits (3,000-5,000 messages)
   - Consider exporting old messages to CSV before deletion
   - Maintain database size < 50MB for reliability

### Environment Variables (Optional)

You can override config via environment variables:
```bash
# In Render deployment settings:
RETENTION_MESSAGE_DAYS=14
RETENTION_LOG_DAYS=7
MAX_DB_SIZE_MB=50
```

To implement this, add to `db.js` after DB_CONFIG definition:
```javascript
if (process.env.RETENTION_MESSAGE_DAYS) {
    DB_CONFIG.MESSAGE_RETENTION_DAYS = parseInt(process.env.RETENTION_MESSAGE_DAYS);
}
// ... repeat for other config values
```

---

## Monitoring & Logging

### Console Output

When maintenance runs, you'll see:
```
🔧 Starting database maintenance cycle...
🧹 Cleaned up 234 messages older than 30 days
🧹 Cleaned up 1250 logs older than 14 days
🧹 Cleaned up 45 user events older than 7 days
📊 DB Size: 5.32MB → 3.12MB
📈 Stats: 6200 messages, 2100 logs, 3 rooms

⏰ Database maintenance scheduler started (runs every 6 hours)
```

### Warning Alerts

If database exceeds threshold:
```
⚠️  WARNING: Database size (125.5MB) exceeds threshold (100MB)
```

---

## Manual Cleanup Functions

Available functions in `db.js`:

```javascript
// Cleanup old data
cleanupOldMessages(days)      // Delete messages older than X days
cleanupOldLogs(days)          // Delete logs older than X days
cleanupOldUserEvents(days)    // Delete user events older than X days
enforceMaxMessagesPerRoom()   // Delete excess messages per room

// Get information
getDatabaseSize()             // Returns size in MB
getDatabaseStats()            // Returns full statistics object
runMaintenanceCycle()         // Run all cleanup tasks immediately
```

### Example: Manual Cleanup via Server Code

```javascript
const { cleanupOldMessages, runMaintenanceCycle } = require('./db');

// Immediately clean messages older than 7 days
cleanupOldMessages(7);

// Run full maintenance cycle
runMaintenanceCycle();
```

---

## Troubleshooting

### Database Growing Despite Cleanup

**Check:**
1. Verify maintenance is running: Look for "🧹 Cleaned up..." messages in logs
2. Check retention values: `DB_CONFIG` - ensure they're realistic
3. Run manual cleanup: `POST /api/admin/maintenance`
4. Check per-room limits: May need to reduce `MAX_MESSAGES_PER_ROOM`

### Database Size Not Decreasing

**Known behavior:** SQLite doesn't automatically reclaim disk space. After cleanup:
```bash
# Compact database (optional, requires SQL-level optimization)
# Consider rebuilding with: VACUUM command
```

To add automatic VACUUM to `db.js`:
```javascript
function compactDatabase() {
    db.run('VACUUM');  // Reclaim unused space
    saveDatabase();
}
```

### Too Much Data Being Deleted

**Solution:** Increase retention periods in `DB_CONFIG`:
```javascript
MESSAGE_RETENTION_DAYS: 60   // Extended to 2 months
LOG_RETENTION_DAYS: 30       // Extended to 1 month
```

---

## Database Schema

### Messages Table
```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    roomID TEXT NOT NULL,
    senderID TEXT NOT NULL,
    senderName TEXT NOT NULL,
    senderThread INTEGER NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP  -- Used for cleanup
)
```

### Logs Table
```sql
CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roomID TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP  -- Used for cleanup
)
```

### User Events Table
```sql
CREATE TABLE user_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roomID TEXT NOT NULL,
    userID TEXT NOT NULL,
    username TEXT NOT NULL,
    eventType TEXT NOT NULL,
    details TEXT,
    threadID INTEGER,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP  -- Used for cleanup
)
```

---

## Performance Impact

- **Cleanup Cycle Duration**: Typically < 1 second for small databases
- **Frequency**: Every 6 hours (adjustable)
- **No Real-Time Impact**: Scheduled to run during idle periods
- **Network**: Doesn't affect Socket.IO connections during cleanup

---

## Summary

| Feature | Enabled | Default |
|---------|---------|---------|
| Auto Cleanup | ✅ | Every 6 hours |
| Message Retention | ✅ | 30 days |
| Log Retention | ✅ | 14 days |
| Event Retention | ✅ | 7 days |
| Per-Room Limits | ✅ | 5,000 messages |
| Size Monitoring | ✅ | 100MB threshold |
| Admin API | ✅ | `/api/admin/db-stats` |

**Your database will now stay efficient and production-ready! 🚀**
