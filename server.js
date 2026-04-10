const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

/**
 * PRODUCTION-READY LAN & CLOUD SERVER
 * Optimized for local LAN environments and Render deployment.
 */

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from current directory
app.use(express.static(__dirname));

// --- State Management ---
const THREAD_POOL_CAPACITY = 20; // Expanded for production
let totalRequests = 0;
let activeUsers = {}; // socketId -> userObject
let serverLogs = [];
let nextThreadId = 1;

// --- Helper Functions ---

/**
 * Tracks and broadcasts system logs
 */
function addLog(type, message) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, type, message };
    serverLogs.push(logEntry);
    
    // Keep internal log buffer manageable
    if (serverLogs.length > 200) serverLogs.shift();
    
    // Broadcast live logs to authenticated admins
    io.to('admin_room').emit('server_log', logEntry);
}

/**
 * Broadcasts real-time statistics to all connected clients
 */
function broadcastStats() {
    const stats = {
        threadCount: THREAD_POOL_CAPACITY,
        totalRequests: totalRequests,
        activeClients: Object.keys(activeUsers).length,
        users: Object.values(activeUsers)
    };
    io.emit('update_stats', stats);
}

// --- Socket.IO Logic ---

io.on('connection', (socket) => {
    totalRequests++; // Initial connection request
    
    // Auto-assign a unique worker thread ID (Round Robin strategy)
    const assignedThread = nextThreadId;
    nextThreadId = (nextThreadId % THREAD_POOL_CAPACITY) + 1;

    // Initialize user session
    activeUsers[socket.id] = {
        id: socket.id,
        username: `User_${Math.floor(1000 + Math.random() * 9000)}`,
        threadId: assignedThread,
        isAdmin: false,
        online: true
    };

    addLog('INFO', `Node Connection: ${socket.id} (Worker-${assignedThread})`);

    // Initial configuration handshake
    socket.emit('init_config', {
        id: socket.id,
        threadId: assignedThread,
        threadCount: THREAD_POOL_CAPACITY,
        username: activeUsers[socket.id].username
    });

    broadcastStats();

    // Event: Identity Update
    socket.on('set_username', (name) => {
        const sanitizedName = name.trim().substring(0, 20);
        if (sanitizedName) {
            const oldName = activeUsers[socket.id].username;
            activeUsers[socket.id].username = sanitizedName;
            
            addLog('INFO', `Identity Change: ${oldName} -> ${sanitizedName}`);
            
            // Broadcast specialized rename event for UI sounds/notifications
            io.emit('user_renamed', {
                oldName,
                newName: sanitizedName,
                id: socket.id
            });
            
            broadcastStats();
        }
    });

    // Event: Chat Transmission
    socket.on('chat_message', (text) => {
        const sanitizedText = text.trim();
        if (!sanitizedText) return;

        totalRequests++; // Message counts as a processed request
        const sender = activeUsers[socket.id];
        
        const messageData = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            senderId: sender.id,
            senderName: sender.username,
            senderThread: sender.threadId,
            text: sanitizedText,
            timestamp: new Date().toLocaleTimeString('en-US', { hour12: false })
        };
        
        io.emit('chat_broadcast', messageData);
        addLog('CHAT', `Message Transmitted from ${sender.username}`);
        
        broadcastStats();
    });

    // Event: Admin Authorization
    socket.on('auth_admin', (password) => {
        // Simple secure password verification for demo purposes
        if (password === 'admin123') {
            activeUsers[socket.id].isAdmin = true;
            socket.join('admin_room');
            socket.emit('admin_auth_success', serverLogs);
            addLog('WARN', `Admin Session Authenticated: ${sender.username}`);
            broadcastStats();
        } else {
            socket.emit('admin_auth_failed', 'Authentication Error: Invalid Key');
        }
    });

    // Event: Termination
    socket.on('disconnect', () => {
        const user = activeUsers[socket.id];
        if (user) {
            addLog('INFO', `Node Termination: ${user.username} (${socket.id})`);
            delete activeUsers[socket.id];
            broadcastStats();
        }
    });
});

// --- Server Startup ---

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n================================================`);
    console.log(`🚀 Core-OS PROJECT SERVER ACTIVE`);
    console.log(`📡 Local Access:  http://localhost:${PORT}`);
    console.log(`🌐 LAN Network:   http://0.0.0.0:${PORT}`);
    console.log(`☁️ Cloud Ready:   Port ${PORT} (Environment Variable)`);
    console.log(`================================================\n`);
    addLog('SYSTEM', `Production runtime initialized on port ${PORT}`);
});
