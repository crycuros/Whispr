const net = require('net');
const AMProto = require('./amproto');

const PORT = 3000;
const clients = new Map(); // Map of clientID -> socket

const server = net.createServer((socket) => {
    console.log(`\n[Server] New connection from ${socket.remoteAddress}:${socket.remotePort}`);
    let myId = null;

    socket.on('data', (rawData) => {
        try {
            // Anti-DPI: Deobfuscate traffic to read the routing header
            const cleanData = AMProto.deobfuscate(rawData);
            const packet = AMProto.parsePacket(cleanData);
            
            if (packet.command === AMProto.CMD_AUTH) {
                // Client registering itself
                myId = parseInt(packet.payloadString);
                clients.set(myId, socket);
                console.log(`[Server] Registered Client ID: ${myId}`);
            }
            else {
                // E2EE Zero-Knowledge Relay
                const targetId = packet.targetId;
                if (clients.has(targetId)) {
                    console.log(`[Server] Relaying packet from ${myId} to ${targetId} (Zero Knowledge)`);
                    const targetSocket = clients.get(targetId);
                    
                    // Note: We route the OBFUSCATED rawData directly to avoid tampering
                    targetSocket.write(rawData);
                } else {
                    console.log(`[Server] Target ${targetId} not found.`);
                }
            }
        } catch (err) {
            console.error(`[Server] Error processing packet:`, err.message);
        }
    });

    socket.on('end', () => {
        if (myId) {
            clients.delete(myId);
            console.log(`[Server] Client ${myId} disconnected`);
        }
    });

    socket.on('error', (err) => {
        console.error(`[Server] Socket error:`, err.message);
    });
});

server.listen(PORT, () => {
    console.log(`[Server] AM Proto 2.0 ZERO-KNOWLEDGE RELAY listening on port ${PORT}`);
});
