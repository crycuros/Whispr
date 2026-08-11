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
    db.run(`CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        is_feed INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now'))
    )`);
    db.run(`ALTER TABLE groups ADD COLUMN is_feed INTEGER DEFAULT 0`, (err) => { /* ignore error */ });
    db.run(`ALTER TABLE groups ADD COLUMN description TEXT`, (err) => { /* ignore error */ });
    db.run(`ALTER TABLE groups ADD COLUMN avatar_url TEXT`, (err) => { /* ignore error */ });
    db.run(`CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at INTEGER DEFAULT (strftime('%s','now')),
        PRIMARY KEY (group_id, user_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        sent_at INTEGER DEFAULT (strftime('%s','now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS group_read (
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        last_read INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, user_id)
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

                            // Send unread group messages
                            db.all(`
                                SELECT gm.id, gm.group_id, gm.sender_id, gm.text
                                FROM group_messages gm
                                JOIN group_members mem ON gm.group_id = mem.group_id
                                LEFT JOIN group_read gr ON gr.group_id = mem.group_id AND gr.user_id = mem.user_id
                                WHERE mem.user_id = ? 
                                AND gm.sent_at >= mem.joined_at
                                AND gm.id > IFNULL(gr.last_read, 0)
                            `, [myId], (err, rows) => {
                                if (!err && rows && rows.length > 0) {
                                    rows.forEach(msgRow => {
                                        const payload = JSON.stringify({
                                            groupId: msgRow.group_id,
                                            senderId: msgRow.sender_id,
                                            text: msgRow.text,
                                            messageId: msgRow.id
                                        });
                                        const groupMsgPacket = AMProto.buildPacket(AMProto.CMD_GROUP_MSG_RELAY, myId, msgRow.sender_id, payload);
                                        ws.send(AMProto.obfuscate(groupMsgPacket));
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
            } else if (packet.command === AMProto.CMD_GROUP_CREATE) {
                const { name, members, isFeed, description, avatarUrl } = JSON.parse(packet.payloadString);
                db.run(`INSERT INTO groups (name, created_by, is_feed, description, avatar_url) VALUES (?, ?, ?, ?, ?)`, [name, packet.senderId, isFeed ? 1 : 0, description, avatarUrl], function(err) {
                    if (err) {
                        const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Group creation failed' }));
                        ws.send(AMProto.obfuscate(errPacket));
                    } else {
                        const groupId = this.lastID;
                        const allMembers = Array.from(new Set([packet.senderId, ...members]));
                        
                        const stmt = db.prepare(`INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)`);
                        allMembers.forEach(userId => {
                            stmt.run(groupId, userId, userId === packet.senderId ? 'admin' : 'member');
                        });
                        stmt.finalize();
                        
                        const okPacket = AMProto.buildPacket(AMProto.CMD_GROUP_CREATE_OK, packet.senderId, 0, JSON.stringify({ groupId, name, members: allMembers, isFeed: !!isFeed, description, avatarUrl, creatorId: packet.senderId }));
                        ws.send(AMProto.obfuscate(okPacket));
                        
                        const infoPacketStr = JSON.stringify({ groupId, name, members: allMembers, isFeed: !!isFeed, description, avatarUrl, creatorId: packet.senderId });
                        allMembers.forEach(userId => {
                            if (userId !== packet.senderId && clients.has(userId)) {
                                const targetWs = clients.get(userId);
                                if (targetWs.readyState === WebSocket.OPEN) {
                                    const infoPacket = AMProto.buildPacket(AMProto.CMD_GROUP_INFO_OK, userId, 0, infoPacketStr);
                                    targetWs.send(AMProto.obfuscate(infoPacket));
                                }
                            }
                        });
                    }
                });
            } else if (packet.command === AMProto.CMD_GROUP_MSG) {
                const { groupId, text } = JSON.parse(packet.payloadString);
                const senderId = packet.senderId;
                
                db.get(`SELECT g.is_feed, gm.role FROM groups g JOIN group_members gm ON g.id = gm.group_id WHERE g.id = ? AND gm.user_id = ?`, [groupId, senderId], (err, row) => {
                    if (err || !row) {
                        const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, senderId, 0, JSON.stringify({ message: 'Not a member of group' }));
                        ws.send(AMProto.obfuscate(errPacket));
                    } else if (row.is_feed === 1 && row.role !== 'admin') {
                        const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, senderId, 0, JSON.stringify({ message: 'Only admins can post in feeds' }));
                        ws.send(AMProto.obfuscate(errPacket));
                    } else {
                        db.run(`INSERT INTO group_messages (group_id, sender_id, text) VALUES (?, ?, ?)`, [groupId, senderId, text], function(err) {
                            if (!err) {
                                const messageId = this.lastID;
                                
                                db.all(`SELECT user_id FROM group_members WHERE group_id = ?`, [groupId], (err, rows) => {
                                    if (!err && rows) {
                                        const payload = JSON.stringify({ groupId, senderId, text, messageId });
                                        
                                        rows.forEach(memberRow => {
                                            const memberId = memberRow.user_id;
                                            if (memberId !== senderId && clients.has(memberId)) {
                                                const targetWs = clients.get(memberId);
                                                if (targetWs.readyState === WebSocket.OPEN) {
                                                    const relayPacket = AMProto.buildPacket(AMProto.CMD_GROUP_MSG_RELAY, memberId, senderId, payload);
                                                    targetWs.send(AMProto.obfuscate(relayPacket));
                                                }
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            } else if (packet.command === AMProto.CMD_GROUP_READ) {
                const { groupId, lastReadMsgId } = JSON.parse(packet.payloadString);
                db.run(`
                    INSERT INTO group_read (group_id, user_id, last_read) 
                    VALUES (?, ?, ?) 
                    ON CONFLICT(group_id, user_id) DO UPDATE SET last_read = max(last_read, excluded.last_read)
                `, [groupId, packet.senderId, lastReadMsgId], (err) => {
                    if (err) console.error("Error upserting group_read", err);
                });
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
    console.log(`[Server] Mensayo Web App running on http://localhost:${PORT}`);
});
