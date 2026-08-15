const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const AMProto = require('./backend/core/amproto');
const db = require('./backend/config/database');

const authController = require('./backend/controllers/auth');
const messagesController = require('./backend/controllers/messages');
const groupsController = require('./backend/controllers/groups');
const usersController = require('./backend/controllers/users');
const friendsController = require('./backend/controllers/friends');
const vaultController = require('./backend/controllers/vault');
const keysController = require('./backend/controllers/keys');
const voiceController = require('./backend/controllers/voice');
const savedController = require('./backend/controllers/saved');
const linkPreview = require('./backend/utils/linkPreview');
const premiumController = require('./backend/controllers/premium');
const filesController = require('./backend/controllers/files');

const PORT = 3000;
const clients = new Map(); // Map of clientID -> ws connection

// 1. Static File Server + API routes for our UI
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method;

    // --- API routes ---
    if (method === 'POST' && pathname === '/api/premium/purchase') {
        premiumController.handlePurchase(req, res, db);
        return;
    }
    if (method === 'POST' && pathname === '/api/premium/status') {
        premiumController.handleStatus(req, res, db);
        return;
    }
    if (method === 'POST' && pathname === '/api/upload/init') {
        filesController.handleUploadInit(req, res, db);
        return;
    }
    const chunkMatch = /^\/api\/upload\/chunk\/([^/]+)\/(\d+)$/.exec(pathname);
    if (method === 'POST' && chunkMatch) {
        filesController.handleUploadChunk(req, res, db, chunkMatch[1], chunkMatch[2]);
        return;
    }
    const finishMatch = /^\/api\/upload\/finish\/([^/]+)$/.exec(pathname);
    if (method === 'POST' && finishMatch) {
        filesController.handleUploadFinish(req, res, db, finishMatch[1]);
        return;
    }
    const fileMetaMatch = /^\/api\/file\/(\d+)\/meta$/.exec(pathname);
    if (method === 'GET' && fileMetaMatch) {
        filesController.handleFileMeta(req, res, db, fileMetaMatch[1]);
        return;
    }
    const fileMatch = /^\/api\/file\/(\d+)$/.exec(pathname);
    if (method === 'GET' && fileMatch) {
        filesController.handleFileDownload(req, res, db, fileMatch[1]);
        return;
    }

    // --- Static files ---
    const frontendRoot = path.join(__dirname, 'frontend');
    let filePath = path.resolve(frontendRoot, '.' + decodeURIComponent(pathname));
    if (pathname === '/') filePath = path.join(frontendRoot, 'index.html');
    if (!filePath.startsWith(frontendRoot)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
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
            
            switch (packet.command) {
                case AMProto.CMD_REGISTER:
                    authController.handleRegister(ws, packet, clients, db);
                    break;
                case AMProto.CMD_LOGIN:
                    authController.handleLogin(ws, packet, clients, db, (id) => { myId = id; });
                    break;
                case AMProto.CMD_RESOLVE:
                    usersController.handleResolve(ws, packet, db);
                    break;
                case AMProto.CMD_USER_UPDATE:
                    usersController.handleUserUpdate(ws, packet, db);
                    break;
                case AMProto.CMD_REQ_SEND:
                    friendsController.handleReqSend(ws, packet, clients, db);
                    break;
                case AMProto.CMD_REQ_LIST:
                    friendsController.handleReqList(ws, packet, db);
                    break;
                case AMProto.CMD_REQ_ACCEPT:
                    friendsController.handleReqAccept(ws, packet, clients, db);
                    break;
                case AMProto.CMD_REQ_DECLINE:
                    friendsController.handleReqDecline(ws, packet, clients, db);
                    break;
                case AMProto.CMD_ENC_MSG:
                    messagesController.handleEncMsg(ws, packet, rawData, clients, db);
                    break;
                case AMProto.CMD_GROUP_CREATE:
                    groupsController.handleGroupCreate(ws, packet, clients, db);
                    break;
                case AMProto.CMD_GROUP_MSG:
                    groupsController.handleGroupMsg(ws, packet, clients, db);
                    break;
                case AMProto.CMD_GROUP_READ:
                    groupsController.handleGroupRead(ws, packet, db);
                    break;
                case AMProto.CMD_IDENTITY_KEY:
                    keysController.handleIdentityKeyUpload(ws, packet, db);
                    break;
                case AMProto.CMD_IDENTITY_KEY_REQ:
                    keysController.handleIdentityKeyReq(ws, packet, db);
                    break;
                case AMProto.CMD_GROUP_KEY_GET:
                    keysController.handleGroupKeyGet(ws, packet, db);
                    break;
                case AMProto.CMD_MSG_DELETE:
                    messagesController.handleMsgDelete(ws, packet, rawData, clients, db);
                    break;
                case AMProto.CMD_VAULT_UPLOAD:
                    vaultController.handleVaultUpload(ws, packet, clients, db);
                    break;
                case AMProto.CMD_VAULT_LIST:
                    vaultController.handleVaultList(ws, packet, clients, db);
                    break;
                case AMProto.CMD_VAULT_DOWNLOAD:
                    vaultController.handleVaultDownload(ws, packet, clients, db);
                    break;
                case AMProto.CMD_SAVED_SAVE:
                    savedController.handleSavedSave(ws, packet, clients, db);
                    break;
                case AMProto.CMD_SAVED_LIST:
                    savedController.handleSavedList(ws, packet, clients, db);
                    break;
                case AMProto.CMD_SAVED_DELETE:
                    savedController.handleSavedDelete(ws, packet, clients, db);
                    break;
                case AMProto.CMD_SAVED_MOVE:
                    savedController.handleSavedMove(ws, packet, clients, db);
                    break;
                case AMProto.CMD_VAULT_CAT_CREATE:
                    savedController.handleCatCreate(ws, packet, clients, db);
                    break;
                case AMProto.CMD_VAULT_CAT_LIST:
                    savedController.handleCatList(ws, packet, clients, db);
                    break;
                case AMProto.CMD_VAULT_CAT_DELETE:
                    savedController.handleCatDelete(ws, packet, clients, db);
                    break;
                case AMProto.CMD_VOICE_UPLOAD:
                    voiceController.handleVoiceUpload(ws, packet, db);
                    break;
                case AMProto.CMD_VOICE_GET:
                    voiceController.handleVoiceGet(ws, packet, db);
                    break;
                case AMProto.CMD_LINK_PREVIEW_REQ:
                    const { url } = JSON.parse(packet.payloadString);
                    linkPreview.fetchPreview(url).then(preview => {
                        const resPacket = AMProto.buildPacket(AMProto.CMD_LINK_PREVIEW_RES, packet.senderId, 0, JSON.stringify(preview || {}));
                        ws.send(AMProto.obfuscate(resPacket));
                    });
                    break;
                default:
                    // Relay other commands (DH_INIT, DH_REPLY, TYPING, READ)
                    const targetId = packet.targetId;
                    // Group typing: targetId = 0, payload has groupId
                    if (packet.command === AMProto.CMD_TYPING && targetId === 0 && packet.payloadString) {
                        try {
                            const { groupId } = JSON.parse(packet.payloadString);
                            if (groupId) {
                                db.all(`SELECT user_id FROM group_members WHERE group_id = ?`, [groupId], (err, rows) => {
                                    if (!err && rows) {
                                        rows.forEach(r => {
                                            if (r.user_id !== packet.senderId && clients.has(r.user_id)) {
                                                const tw = clients.get(r.user_id);
                                                if (tw.readyState === WebSocket.OPEN) tw.send(rawData);
                                            }
                                        });
                                    }
                                });
                            }
                        } catch(e) {}
                    } else if (clients.has(targetId)) {
                        // Only allow ECDH handshake with friends (or existing chat partners)
                        if (packet.command === AMProto.CMD_DH_INIT || packet.command === AMProto.CMD_DH_REPLY) {
                            friendsController.canMessage(db, packet.senderId, targetId, (allowed) => {
                                if (!allowed) return;
                                const targetWs = clients.get(targetId);
                                if (targetWs.readyState === WebSocket.OPEN) {
                                    targetWs.send(rawData);
                                }
                            });
                        } else {
                            const targetWs = clients.get(targetId);
                            if (targetWs.readyState === WebSocket.OPEN) {
                                targetWs.send(rawData);
                            }
                        }
                    } else {
                        console.log(`[Server] Target ${targetId} not found or offline.`);
                    }
                    break;
            }
        } catch (err) {
            console.error(`[Server] Error processing packet:`, err.message);
        }
    });

    ws.on('close', () => {
        if (myId && clients.get(myId) === ws) {
            clients.delete(myId);
            const now = Date.now();
            db.run(`UPDATE users SET last_seen = ? WHERE id = ?`, [now, myId], () => {
                friendsController.broadcastPresence(clients, db, myId, false, now);
                groupsController.broadcastPresenceToGroupMembers(clients, db, myId, false, now);
            });
            console.log(`[Server] Web Client ${myId} disconnected`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`[Server] Mensayo Web App running on http://localhost:${PORT}`);
});
