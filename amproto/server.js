const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const AMProto = require('./amproto');

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
            
            if (packet.command === AMProto.CMD_AUTH) {
                myId = parseInt(packet.payloadString);
                clients.set(myId, ws);
                console.log(`[Server] Registered Web Client ID: ${myId}`);
            }
            else {
                const targetId = packet.targetId;
                if (clients.has(targetId)) {
                    console.log(`[Server] Relaying WS packet from ${myId} to ${targetId} (Zero Knowledge)`);
                    const targetWs = clients.get(targetId);
                    
                    if (targetWs.readyState === WebSocket.OPEN) {
                        // Forward the raw, obfuscated packet!
                        targetWs.send(rawData);
                    }
                } else {
                    console.log(`[Server] Target ${targetId} not found.`);
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
