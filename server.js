const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

/**
 * VIRTUAL LAN NETWORK ACCESS SERVER (OS PROJECT ENHANCED)
 * Demonstrates: Multithreading simulation, Synchronization, and Room Isolation.
 */

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

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

        addLog('INFO', `Node Joined Network [${ssid}] via Worker-${threadId}`, roomID);

        socket.emit('network_joined', {
            id: socket.id,
            ssid: ssid,
            roomID: roomID,
            threadId: threadId,
            threadCount: THREAD_POOL_CAPACITY,
            username: activeUsers[socket.id].username
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
            timestamp: new Date().toLocaleTimeString('en-US', { hour12: false })
        };
        
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
            
            const roomLogs = serverLogs.filter(l => l.roomID === user.roomID);
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
            addLog('SYSTEM', `Node Signal Lost: ${user.username}`, roomID);
            delete activeUsers[socket.id];
            broadcastRoomStats(roomID);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 [V-LAN OS ENGINE] RUNNING ON PORT: ${PORT}`);
    console.log(`📡 Multithreaded Synchronization Ready.\n`);
});
