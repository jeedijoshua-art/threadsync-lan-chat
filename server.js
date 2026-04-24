const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { 
    initializeDatabase, 
    saveMessage, 
    loadMessagesForRoom, 
    saveLog, 
    loadLogsForRoom,
    recordUserEvent,
    getRoomStats,
    startMaintenanceScheduler,
    getDatabaseStats,
    runMaintenanceCycle,
    DB_CONFIG,
    createDatabaseSnapshot
} = require('./db');

/**
 * VIRTUAL LAN NETWORK ACCESS SERVER (OS PROJECT ENHANCED)
 * Demonstrates: Multithreading simulation, Synchronization, and Room Isolation.
 * WITH PERSISTENT MESSAGE STORAGE using SQLite
 */

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));
app.use(express.json());

// Initialize SQLite database on startup
initializeDatabase().then(() => {
    // Start automatic maintenance scheduler
    startMaintenanceScheduler();
    
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 [V-LAN OS ENGINE] RUNNING ON PORT: ${PORT}`);
        console.log(`📡 Multithreaded Synchronization Ready.\n`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});

// --- State Management ---
const THREAD_POOL_CAPACITY = 10; // Reduced for better UI visualization
let globalRequests = 0;
let activeUsers = {}; // socket.id -> userObject
let serverLogs = [];

// Room-specific metadata: roomID -> { requests: N, threads: [ { id, status, lastUsed } ] }
let roomMetadata = {};

// --- Helper Functions ---

/**
 * Generates a unique SHA-256 hash from network SSID and Password
 */
function hashNetwork(ssid, password) {
    const secret = `${ssid}:${password}:CoreOS`;
    return crypto.createHash('sha256').update(secret).digest('hex').substring(0, 16);
}

function initializeRoom(roomID) {
    if (!roomMetadata[roomID]) {
        roomMetadata[roomID] = {
            requests: 0,
            threads: Array.from({ length: THREAD_POOL_CAPACITY }, (_, i) => ({
                id: i + 1,
                status: 'IDLE',
                lastUsed: Date.now()
            }))
        };
    }
}

/**
 * Simulates thread allocation. Marks a thread as BUSY for a short duration.
 */
function allocateThread(roomID) {
    initializeRoom(roomID);
    const room = roomMetadata[roomID];
    
    // Simple allocation: find first idle or oldest busy thread (simulation)
    let threadIndex = room.threads.findIndex(t => t.status === 'IDLE');
    if (threadIndex === -1) {
        // Force pick one if all busy (synchronization bottleneck simulation)
        threadIndex = Math.floor(Math.random() * THREAD_POOL_CAPACITY);
    }

    const thread = room.threads[threadIndex];
    thread.status = 'BUSY';
    thread.lastUsed = Date.now();

    // Reset to IDLE after simulated "processing time" (800-1500ms)
    const processingTime = 800 + Math.random() * 700;
    setTimeout(() => {
        thread.status = 'IDLE';
        broadcastRoomStats(roomID);
    }, processingTime);

    return thread.id;
}

function addLog(type, message, roomID = 'global') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = { timestamp, type, message, roomID };
    serverLogs.push(logEntry);
    if (serverLogs.length > 200) serverLogs.shift();
    
    // Save to database
    saveLog(type, message, roomID, timestamp);
    
    // Broadcast live logs to room admins
    io.to(`admin_room_${roomID}`).emit('server_log', logEntry);
    // Also send to global if it's not already global
    if (roomID !== 'global') {
        io.to(`admin_room_global`).emit('server_log', logEntry);
    }
}

/**
 * Broadcasts statistics scoped to a specific virtual LAN
 */
function broadcastRoomStats(roomID) {
    initializeRoom(roomID);
    const room = roomMetadata[roomID];
    const roomUsers = Object.values(activeUsers).filter(u => u.roomID === roomID);
    
    io.to(roomID).emit('update_stats', {
        threadPool: room.threads,
        totalRequests: room.requests,
        globalRequests: globalRequests,
        activeClients: roomUsers.length,
        users: roomUsers,
        networkHash: roomID,
        threadCapacity: THREAD_POOL_CAPACITY
    });
}

// --- Socket.IO Logic ---

io.on('connection', (socket) => {
    addLog('SYSTEM', `Unidentified Node Connected: ${socket.id}`);

    socket.emit('init_pre_access', { id: socket.id });

    // Event: Joining a Virtual LAN
    socket.on('join_network', (credentials) => {
        const { ssid, password } = credentials;
        if (!ssid || !password) return socket.emit('error_message', 'Invalid Credentials');

        const roomID = hashNetwork(ssid, password);
        initializeRoom(roomID);
        
        const threadId = allocateThread(roomID);
        globalRequests++;
        roomMetadata[roomID].requests++;

        socket.join(roomID);

        activeUsers[socket.id] = {
            id: socket.id,
            username: `Node_${Math.floor(100 + Math.random() * 900)}`,
            threadId: threadId,
            isAdmin: false,
            roomID: roomID,
            ssid: ssid,
            joinedAt: Date.now()
        };

        // Record user join event
        recordUserEvent(roomID, socket.id, activeUsers[socket.id].username, 'join', null, threadId);

        addLog('INFO', `Node Joined Network [${ssid}] via Worker-${threadId}`, roomID);

        socket.emit('network_joined', {
            id: socket.id,
            ssid: ssid,
            roomID: roomID,
            threadId: threadId,
            threadCount: THREAD_POOL_CAPACITY,
            username: activeUsers[socket.id].username
        });

        // Load and emit persisted messages for this room
        const persistedMessages = loadMessagesForRoom(roomID, 50);
        persistedMessages.forEach(msg => {
            socket.emit('chat_broadcast', {
                id: msg.senderId,
                senderId: msg.senderId,
                senderName: msg.senderName,
                text: msg.text,
                roomName: msg.roomName,
                timestamp: msg.timestamp,
                senderThread: msg.senderThread,
                _restored: true  // Mark as restored from database
            });
        });

        broadcastRoomStats(roomID);
    });

    // Event: Identity Update
    socket.on('set_username', (name) => {
        const user = activeUsers[socket.id];
        if (!user) return;

        const sanitizedName = name.trim().substring(0, 20);
        if (sanitizedName) {
            const oldName = user.username;
            user.username = sanitizedName;
            
            // Record rename event to database
            recordUserEvent(user.roomID, socket.id, sanitizedName, 'rename', `from ${oldName}`);
            
            allocateThread(user.roomID);
            addLog('INFO', `Identity Re-sync: ${oldName} -> ${sanitizedName}`, user.roomID);
            
            io.to(user.roomID).emit('user_renamed', {
                oldName,
                newName: sanitizedName,
                id: socket.id
            });
            
            broadcastRoomStats(user.roomID);
        }
    });

    // Event: Chat Transmission
    socket.on('chat_message', (text) => {
        const user = activeUsers[socket.id];
        if (!user) return;

        const sanitizedText = text.trim();
        if (!sanitizedText) return;

        const threadId = allocateThread(user.roomID);
        globalRequests++;
        roomMetadata[user.roomID].requests++;

        const messageData = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            senderId: user.id,
            senderName: user.username,
            senderThread: threadId,
            text: sanitizedText,
            roomName: user.ssid,
            roomID: user.roomID,  // Add the hash roomID for database storage
            timestamp: new Date().toLocaleTimeString('en-US', { hour12: false })
        };
        
        // Save message to database (using roomID hash)
        saveMessage(messageData);
        
        io.to(user.roomID).emit('chat_broadcast', messageData);
        addLog('CHAT', `Broadcast from ${user.username} (Proc by W-${threadId})`, user.roomID);
        
        broadcastRoomStats(user.roomID);
    });

    // Event: Admin Authorization
    socket.on('auth_admin', (password) => {
        const user = activeUsers[socket.id];
        if (!user) return;

        if (password === 'admin123') {
            user.isAdmin = true;
            socket.join(`admin_room_${user.roomID}`);
            
            // Load persisted logs from database
            const roomLogs = loadLogsForRoom(user.roomID, 200);
            socket.emit('admin_auth_success', roomLogs);
            
            addLog('WARN', `Admin Escalation: ${user.username}`, user.roomID);
            broadcastRoomStats(user.roomID);
        } else {
            socket.emit('admin_auth_failed', 'Protocol Error: Unauthorized Access');
        }
    });

    // Event: Network Departure
    socket.on('leave_network', () => {
        const user = activeUsers[socket.id];
        if (user) {
            const roomID = user.roomID;
            
            // Record leave event
            recordUserEvent(roomID, socket.id, user.username, 'leave');
            
            addLog('INFO', `Node Terminated Connection: ${user.username}`, roomID);
            
            socket.leave(roomID);
            socket.leave(`admin_room_${roomID}`);
            
            delete activeUsers[socket.id];
            broadcastRoomStats(roomID);
        }
    });

    socket.on('disconnect', () => {
        const user = activeUsers[socket.id];
        if (user) {
            const roomID = user.roomID;
            
            // Record disconnect event
            recordUserEvent(roomID, socket.id, user.username, 'disconnect');
            
            addLog('SYSTEM', `Node Signal Lost: ${user.username}`, roomID);
            delete activeUsers[socket.id];
            broadcastRoomStats(roomID);
        }
    });
});

// ========== ADMIN REST ENDPOINTS FOR DATABASE MANAGEMENT ==========

/**
 * GET /api/admin/db-stats
 * Get current database statistics
 */
app.get('/api/admin/db-stats', (req, res) => {
    try {
        const stats = getDatabaseStats();
        res.json({
            success: true,
            data: stats,
            config: {
                MESSAGE_RETENTION_DAYS: DB_CONFIG.MESSAGE_RETENTION_DAYS,
                LOG_RETENTION_DAYS: DB_CONFIG.LOG_RETENTION_DAYS,
                USER_EVENT_RETENTION_DAYS: DB_CONFIG.USER_EVENT_RETENTION_DAYS,
                MAX_MESSAGES_PER_ROOM: DB_CONFIG.MAX_MESSAGES_PER_ROOM,
                MAX_DB_SIZE_MB: DB_CONFIG.MAX_DB_SIZE_MB,
                CLEANUP_INTERVAL_HOURS: DB_CONFIG.CLEANUP_INTERVAL_MS / (60 * 60 * 1000)
            }
        });
    } catch (err) {
        console.error('Error fetching DB stats:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/maintenance
 * Trigger immediate maintenance cycle
 */
app.post('/api/admin/maintenance', (req, res) => {
    try {
        const beforeStats = getDatabaseStats();
        runMaintenanceCycle();
        const afterStats = getDatabaseStats();
        
        res.json({
            success: true,
            message: 'Maintenance cycle completed',
            before: beforeStats,
            after: afterStats
        });
    } catch (err) {
        console.error('Error running maintenance:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/configure-retention
 * Update retention policies (use with caution)
 */
app.post('/api/admin/configure-retention', (req, res) => {
    try {
        const { messageDays, logDays, eventDays, maxMessagesPerRoom } = req.body;
        
        if (messageDays) DB_CONFIG.MESSAGE_RETENTION_DAYS = messageDays;
        if (logDays) DB_CONFIG.LOG_RETENTION_DAYS = logDays;
        if (eventDays) DB_CONFIG.USER_EVENT_RETENTION_DAYS = eventDays;
        if (maxMessagesPerRoom) DB_CONFIG.MAX_MESSAGES_PER_ROOM = maxMessagesPerRoom;
        
        res.json({
            success: true,
            message: 'Configuration updated',
            config: DB_CONFIG
        });
    } catch (err) {
        console.error('Error updating configuration:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/db-backup
 * Download a clean SQLite snapshot for offsite retention
 */
app.get('/api/admin/db-backup', (req, res) => {
    try {
        const expectedToken = process.env.BACKUP_TOKEN;
        const providedToken = req.query.token || req.header('x-backup-token');

        if (process.env.NODE_ENV === 'production' && !expectedToken) {
            return res.status(500).json({
                success: false,
                error: 'BACKUP_TOKEN is not configured on the server'
            });
        }

        if (expectedToken && providedToken !== expectedToken) {
            return res.status(403).json({ success: false, error: 'Unauthorized' });
        }

        const snapshotPath = createDatabaseSnapshot();
        if (!snapshotPath || !fs.existsSync(snapshotPath)) {
            return res.status(500).json({ success: false, error: 'Unable to create backup snapshot' });
        }

        const backupName = `chat-db-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
        res.setHeader('Cache-Control', 'no-store');
        return res.download(snapshotPath, backupName, (err) => {
            if (err) {
                console.error('Backup download failed:', err);
            }
            try {
                fs.unlinkSync(snapshotPath);
            } catch (cleanupErr) {
                console.error('Snapshot cleanup failed:', cleanupErr);
            }
        });
    } catch (err) {
        console.error('Error creating database backup:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
