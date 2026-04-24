/**
 * SQLite Database Module for ThreadSync LAN Chat
 * Uses sql.js (pure JavaScript SQLite) for persistence without compilation
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'chat.db');

let db = null;
let SQL = null;

// ========== DATABASE MAINTENANCE CONFIGURATION ==========
const DB_CONFIG = {
    // Retention periods in days
    MESSAGE_RETENTION_DAYS: 30,  // Keep messages for 30 days
    LOG_RETENTION_DAYS: 14,       // Keep logs for 14 days
    USER_EVENT_RETENTION_DAYS: 7, // Keep user events for 7 days
    
    // Limits per room
    MAX_MESSAGES_PER_ROOM: 5000,  // Max 5000 messages per room
    MAX_LOGS_PER_ROOM: 10000,     // Max 10000 log entries per room
    
    // Cleanup scheduling
    CLEANUP_INTERVAL_MS: 6 * 60 * 60 * 1000, // Run cleanup every 6 hours
    MAX_DB_SIZE_MB: 100  // Alert if DB exceeds 100MB
};

/**
 * Initialize database with sql.js
 */
async function initializeDatabase() {
    try {
        SQL = await initSqlJs();
        
        // Try to load existing database
        if (fs.existsSync(dbPath)) {
            const buffer = fs.readFileSync(dbPath);
            db = new SQL.Database(buffer);
            console.log('✓ Database loaded from disk');
        } else {
            // Create new database
            db = new SQL.Database();
            console.log('✓ New database created');
        }
        
        // Create tables
        createTables();
        saveDatabase();
        console.log('✓ Database initialized successfully');
    } catch (err) {
        console.error('Database initialization error:', err);
        throw err;
    }
}

/**
 * Create database schema
 */
function createTables() {
    // Messages table
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            roomID TEXT NOT NULL,
            senderID TEXT NOT NULL,
            senderName TEXT NOT NULL,
            senderThread INTEGER NOT NULL,
            text TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Server logs table
    db.run(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            roomID TEXT NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // User events table
    db.run(`
        CREATE TABLE IF NOT EXISTS user_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            roomID TEXT NOT NULL,
            userID TEXT NOT NULL,
            username TEXT NOT NULL,
            eventType TEXT NOT NULL,
            details TEXT,
            threadID INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

/**
 * Save database to disk
 */
function saveDatabase() {
    try {
        if (db) {
            const data = db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(dbPath, buffer);
        }
    } catch (err) {
        console.error('Error saving database:', err);
    }
}

/**
 * Get the database file path on disk
 */
function getDatabasePath() {
    return dbPath;
}

/**
 * Create a consistent backup snapshot of the current database
 */
function createDatabaseSnapshot(backupPath = null) {
    try {
        if (!db) {
            throw new Error('Database is not initialized');
        }

        const targetPath = backupPath || path.join(
            __dirname,
            `chat-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
        );

        const data = db.export();
        fs.writeFileSync(targetPath, Buffer.from(data));
        return targetPath;
    } catch (err) {
        console.error('Error creating database snapshot:', err);
        return null;
    }
}

/**
 * Execute query and fetch results
 */
function queryDatabase(sql, params = []) {
    try {
        const result = db.exec(sql, params);
        if (result.length === 0) return [];
        
        const columns = result[0].columns;
        return result[0].values.map(row => {
            const obj = {};
            columns.forEach((col, idx) => {
                obj[col] = row[idx];
            });
            return obj;
        });
    } catch (err) {
        console.error('Query error:', err, sql);
        return [];
    }
}

/**
 * Save a chat message to database
 */
function saveMessage(messageData) {
    try {
        const sql = `
            INSERT INTO messages (id, roomID, senderID, senderName, senderThread, text, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        // Use roomID if provided, otherwise use roomName (for backwards compatibility)
        const roomID = messageData.roomID || messageData.roomName;
        db.run(sql, [
            messageData.id,
            roomID,
            messageData.senderId,
            messageData.senderName,
            messageData.senderThread,
            messageData.text,
            messageData.timestamp
        ]);
        saveDatabase();
    } catch (err) {
        console.error('Error saving message:', err);
    }
}

/**
 * Load all messages for a specific room
 */
function loadMessagesForRoom(roomID, limit = 50) {
    try {
        const sql = `
            SELECT id, senderID as senderId, senderName, senderThread, text, timestamp, roomID as roomName
            FROM messages
            WHERE roomID = ?
            ORDER BY createdAt ASC
            LIMIT ?
        `;
        return queryDatabase(sql, [roomID, limit]);
    } catch (err) {
        console.error('Error loading messages:', err);
        return [];
    }
}

/**
 * Save a server log entry
 */
function saveLog(type, message, roomID, timestamp) {
    try {
        const sql = `
            INSERT INTO logs (roomID, type, message, timestamp)
            VALUES (?, ?, ?, ?)
        `;
        db.run(sql, [roomID, type, message, timestamp]);
        saveDatabase();
    } catch (err) {
        console.error('Error saving log:', err);
    }
}

/**
 * Load logs for a specific room
 */
function loadLogsForRoom(roomID, limit = 200) {
    try {
        const sql = `
            SELECT timestamp, type, message, roomID
            FROM logs
            WHERE roomID = ?
            ORDER BY createdAt DESC
            LIMIT ?
        `;
        const results = queryDatabase(sql, [roomID, limit]);
        return results.reverse();  // Return in chronological order
    } catch (err) {
        console.error('Error loading logs:', err);
        return [];
    }
}

/**
 * Record user event
 */
function recordUserEvent(roomID, userID, username, eventType, details = null, threadID = null) {
    try {
        const sql = `
            INSERT INTO user_events (roomID, userID, username, eventType, details, threadID)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        db.run(sql, [roomID, userID, username, eventType, details || '', threadID || 0]);
        saveDatabase();
    } catch (err) {
        console.error('Error recording user event:', err);
    }
}

/**
 * Get room statistics from database
 */
function getRoomStats(roomID) {
    try {
        const msgCount = queryDatabase('SELECT COUNT(*) as count FROM messages WHERE roomID = ?', [roomID]);
        const joinCount = queryDatabase(
            'SELECT COUNT(*) as joins FROM user_events WHERE roomID = ? AND eventType = ?',
            [roomID, 'join']
        );
        
        return {
            totalMessages: msgCount.length > 0 ? msgCount[0].count : 0,
            totalJoins: joinCount.length > 0 ? joinCount[0].joins : 0
        };
    } catch (err) {
        console.error('Error getting room stats:', err);
        return { totalMessages: 0, totalJoins: 0 };
    }
}

/**
 * Clear all messages for a room (optional cleanup)
 */
function clearRoomMessages(roomID) {
    try {
        db.run('DELETE FROM messages WHERE roomID = ?', [roomID]);
        saveDatabase();
        return true;
    } catch (err) {
        console.error('Error clearing messages:', err);
        return false;
    }
}

// ========== DATABASE MAINTENANCE FUNCTIONS ==========

/**
 * Get current database file size in MB
 */
function getDatabaseSize() {
    try {
        if (fs.existsSync(dbPath)) {
            const stats = fs.statSync(dbPath);
            return (stats.size / (1024 * 1024)).toFixed(2);
        }
        return 0;
    } catch (err) {
        console.error('Error getting database size:', err);
        return 0;
    }
}

/**
 * Get database statistics
 */
function getDatabaseStats() {
    try {
        const msgCount = queryDatabase('SELECT COUNT(*) as count FROM messages');
        const logCount = queryDatabase('SELECT COUNT(*) as count FROM logs');
        const eventCount = queryDatabase('SELECT COUNT(*) as count FROM user_events');
        const roomCount = queryDatabase('SELECT DISTINCT roomID FROM messages');
        const dbSize = getDatabaseSize();
        
        return {
            totalMessages: msgCount[0]?.count || 0,
            totalLogs: logCount[0]?.count || 0,
            totalEvents: eventCount[0]?.count || 0,
            uniqueRooms: roomCount.length,
            databaseSizeMB: parseFloat(dbSize),
            timestamp: new Date().toISOString()
        };
    } catch (err) {
        console.error('Error getting database stats:', err);
        return {};
    }
}

/**
 * Clean up messages older than retention period
 */
function cleanupOldMessages(retentionDays = DB_CONFIG.MESSAGE_RETENTION_DAYS) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffISO = cutoffDate.toISOString();
        
        const result = queryDatabase(
            'SELECT COUNT(*) as count FROM messages WHERE createdAt < ?',
            [cutoffISO]
        );
        const deletedCount = result[0]?.count || 0;
        
        if (deletedCount > 0) {
            db.run('DELETE FROM messages WHERE createdAt < ?', [cutoffISO]);
            saveDatabase();
            console.log(`🧹 Cleaned up ${deletedCount} messages older than ${retentionDays} days`);
            return deletedCount;
        }
        return 0;
    } catch (err) {
        console.error('Error cleaning up old messages:', err);
        return 0;
    }
}

/**
 * Clean up logs older than retention period
 */
function cleanupOldLogs(retentionDays = DB_CONFIG.LOG_RETENTION_DAYS) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffISO = cutoffDate.toISOString();
        
        const result = queryDatabase(
            'SELECT COUNT(*) as count FROM logs WHERE createdAt < ?',
            [cutoffISO]
        );
        const deletedCount = result[0]?.count || 0;
        
        if (deletedCount > 0) {
            db.run('DELETE FROM logs WHERE createdAt < ?', [cutoffISO]);
            saveDatabase();
            console.log(`🧹 Cleaned up ${deletedCount} logs older than ${retentionDays} days`);
            return deletedCount;
        }
        return 0;
    } catch (err) {
        console.error('Error cleaning up old logs:', err);
        return 0;
    }
}

/**
 * Clean up user events older than retention period
 */
function cleanupOldUserEvents(retentionDays = DB_CONFIG.USER_EVENT_RETENTION_DAYS) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffISO = cutoffDate.toISOString();
        
        const result = queryDatabase(
            'SELECT COUNT(*) as count FROM user_events WHERE createdAt < ?',
            [cutoffISO]
        );
        const deletedCount = result[0]?.count || 0;
        
        if (deletedCount > 0) {
            db.run('DELETE FROM user_events WHERE createdAt < ?', [cutoffISO]);
            saveDatabase();
            console.log(`🧹 Cleaned up ${deletedCount} user events older than ${retentionDays} days`);
            return deletedCount;
        }
        return 0;
    } catch (err) {
        console.error('Error cleaning up old user events:', err);
        return 0;
    }
}

/**
 * Enforce maximum message count per room
 */
function enforceMaxMessagesPerRoom(maxMessages = DB_CONFIG.MAX_MESSAGES_PER_ROOM) {
    try {
        let totalDeleted = 0;
        
        // Get all unique rooms
        const rooms = queryDatabase('SELECT DISTINCT roomID FROM messages');
        
        rooms.forEach(room => {
            const countResult = queryDatabase(
                'SELECT COUNT(*) as count FROM messages WHERE roomID = ?',
                [room.roomID]
            );
            const count = countResult[0]?.count || 0;
            
            if (count > maxMessages) {
                const excessCount = count - maxMessages;
                // Delete oldest messages for this room
                db.run(`
                    DELETE FROM messages WHERE roomID = ? AND id NOT IN (
                        SELECT id FROM messages WHERE roomID = ? 
                        ORDER BY createdAt DESC LIMIT ?
                    )
                `, [room.roomID, room.roomID, maxMessages]);
                totalDeleted += excessCount;
                console.log(`🧹 Room ${room.roomID.substring(0, 8)}: Deleted ${excessCount} excess messages`);
            }
        });
        
        if (totalDeleted > 0) {
            saveDatabase();
        }
        return totalDeleted;
    } catch (err) {
        console.error('Error enforcing message limits:', err);
        return 0;
    }
}

/**
 * Run all cleanup tasks
 */
function runMaintenanceCycle() {
    try {
        console.log('\n🔧 Starting database maintenance cycle...');
        const startSize = getDatabaseSize();
        
        cleanupOldMessages();
        cleanupOldLogs();
        cleanupOldUserEvents();
        enforceMaxMessagesPerRoom();
        
        const endSize = getDatabaseSize();
        const stats = getDatabaseStats();
        
        console.log(`📊 DB Size: ${startSize}MB → ${endSize}MB`);
        console.log(`📈 Stats: ${stats.totalMessages} messages, ${stats.totalLogs} logs, ${stats.uniqueRooms} rooms\n`);
        
        // Alert if database is getting too large
        if (parseFloat(endSize) > DB_CONFIG.MAX_DB_SIZE_MB) {
            console.warn(`⚠️  WARNING: Database size (${endSize}MB) exceeds threshold (${DB_CONFIG.MAX_DB_SIZE_MB}MB)`);
        }
    } catch (err) {
        console.error('Error running maintenance cycle:', err);
    }
}

/**
 * Start automatic maintenance scheduler
 */
function startMaintenanceScheduler() {
    // Run cleanup immediately after database initialization
    setTimeout(() => {
        runMaintenanceCycle();
    }, 2000);
    
    // Then run on a recurring schedule
    setInterval(() => {
        runMaintenanceCycle();
    }, DB_CONFIG.CLEANUP_INTERVAL_MS);
    
    console.log(`⏰ Database maintenance scheduler started (runs every ${DB_CONFIG.CLEANUP_INTERVAL_MS / (60 * 60 * 1000)} hours)`);
}

/**
 * Export database functions
 */
module.exports = {
    initializeDatabase,
    saveMessage,
    loadMessagesForRoom,
    saveLog,
    loadLogsForRoom,
    recordUserEvent,
    getRoomStats,
    clearRoomMessages,
    getDatabaseSize,
    getDatabaseStats,
    cleanupOldMessages,
    cleanupOldLogs,
    cleanupOldUserEvents,
    enforceMaxMessagesPerRoom,
    runMaintenanceCycle,
    startMaintenanceScheduler,
    DB_CONFIG,
    getDatabasePath,
    createDatabaseSnapshot
};

