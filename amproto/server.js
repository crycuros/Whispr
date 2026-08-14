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
const vaultController = require('./backend/controllers/vault');

const PORT = 3000;
const clients = new Map(); // Map of clientID -> ws connection

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
                case AMProto.CMD_MSG_DELETE:
                    messagesController.handleMsgDelete(ws, packet, clients, db);
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
                default:
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
                    break;
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
