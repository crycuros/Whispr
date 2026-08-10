const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const AMProto = require('./amproto');
const sqlite3 = require('sqlite3').verbose();

const PORT = 3000;
const clients = new Map(); // Map of clientID -> ws connection

// Initialize SQLite DB
const db = new sqlite3.Database(path.join(__dirname, 'whispr.db'));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        payload TEXT,
        is_read INTEGER DEFAULT 0
    )`);
});

// 1. Static File Server for our UI
const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'frontend', req.url === '/' ? 'index.html' : req.url);
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    
    switch (extname) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// 2. AM Proto 2.0 WebSocket Relay
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log(`\n[Server] New WebSocket connection`);
    let myId = null;

    ws.on('message', (rawData) => {
        try {
            // In Node.js 'ws' package, binary data arrives as a Buffer
            const cleanData = AMProto.deobfuscate(rawData);
            const packet = AMProto.parsePacket(cleanData);
            
            if (packet.command === AMProto.CMD_REGISTER) {
                try {
                    const { username, password } = JSON.parse(packet.payloadString);
                    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, password], function(err) {
                        if (err) {
                            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Registration failed' }));
                            ws.send(AMProto.obfuscate(errPacket));
                        } else {
                            const okPacket = AMProto.buildPacket(AMProto.CMD_REGISTER_OK, packet.senderId, 0, JSON.stringify({ userId: this.lastID, username }));
                            ws.send(AMProto.obfuscate(okPacket));
                        }
                    });
                } catch (e) {
                    console.error("Register parsing error", e);
                }
            } else if (packet.command === AMProto.CMD_LOGIN) {
                try {
                    const { username, password } = JSON.parse(packet.payloadString);
                    db.get(`SELECT id, username FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
                        if (err || !row) {
                            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Login failed' }));
                            ws.send(AMProto.obfuscate(errPacket));
                        } else {
                            myId = row.id;
                            clients.set(myId, ws);
                            console.log(`[Server] Web Client ID ${myId} logged in`);
                            const okPacket = AMProto.buildPacket(AMProto.CMD_LOGIN_OK, packet.senderId, 0, JSON.stringify({ userId: myId, username: row.username }));
                            ws.send(AMProto.obfuscate(okPacket));
                            
                            // Send unread messages
                            db.all(`SELECT id, sender_id, payload FROM messages WHERE receiver_id = ? AND is_read = 0`, [myId], (err, rows) => {
                                if (!err && rows && rows.length > 0) {
                                    rows.forEach(msgRow => {
                                        const encMsgPacket = AMProto.buildPacket(AMProto.CMD_ENC_MSG, myId, msgRow.sender_id, msgRow.payload);
                                        ws.send(AMProto.obfuscate(encMsgPacket));
                                        
                                        db.run(`UPDATE messages SET is_read = 1 WHERE id = ?`, [msgRow.id]);
                                    });
                                }
                            });
                        }
                    });
                } catch (e) {
                    console.error("Login parsing error", e);
                }
            } else if (packet.command === AMProto.CMD_RESOLVE) {
                const targetUsername = packet.payloadString.trim();
                db.get(`SELECT id, username FROM users WHERE username = ?`, [targetUsername], (err, row) => {
                    if (err || !row) {
                        const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'User not found' }));
                        ws.send(AMProto.obfuscate(errPacket));
                    } else {
                        const okPacket = AMProto.buildPacket(AMProto.CMD_RESOLVE_OK, packet.senderId, 0, JSON.stringify({ userId: row.id, username: row.username }));
                        ws.send(AMProto.obfuscate(okPacket));
                    }
                });
            } else if (packet.command === AMProto.CMD_ENC_MSG) {
                const targetId = packet.targetId;
                const senderId = packet.senderId;
                const payloadStr = packet.payloadString;
                
                db.run(`INSERT INTO messages (sender_id, receiver_id, payload, is_read) VALUES (?, ?, ?, ?)`, 
                    [senderId, targetId, payloadStr, clients.has(targetId) ? 1 : 0], 
                    function(err) {
                        if (err) console.error("Error saving message", err);
                    }
                );
                
                if (clients.has(targetId)) {
                    console.log(`[Server] Relaying CMD_ENC_MSG from ${senderId} to ${targetId}`);
                    const targetWs = clients.get(targetId);
                    if (targetWs.readyState === WebSocket.OPEN) {
                        targetWs.send(rawData);
                    }
                } else {
                    console.log(`[Server] Target ${targetId} offline. Message saved.`);
                }
            } else {
                // Relay other commands (DH_INIT, DH_REPLY, TYPING, READ)
                const targetId = packet.targetId;
                if (clients.has(targetId)) {
                    console.log(`[Server] Relaying command ${packet.command} from ${myId || packet.senderId} to ${targetId}`);
                    const targetWs = clients.get(targetId);
                    
                    if (targetWs.readyState === WebSocket.OPEN) {
                        // Forward the raw, obfuscated packet
                        targetWs.send(rawData);
                    }
                } else {
                    console.log(`[Server] Target ${targetId} not found or offline.`);
                }
            }
        } catch (err) {
            console.error(`[Server] Error processing packet:`, err.message);
        }
    });

    ws.on('close', () => {
        if (myId) {
            clients.delete(myId);
            console.log(`[Server] Web Client ${myId} disconnected`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`[Server] Whispr Web App running on http://localhost:${PORT}`);
});
