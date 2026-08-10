const net = require('net');
const crypto = require('crypto');
const AMProto = require('./amproto');

const PORT = 3000;

// Store connections and their negotiated secrets
const clients = new Map();

const server = net.createServer((socket) => {
    console.log(`[Server] New connection from ${socket.remoteAddress}:${socket.remotePort}`);
    
    // Create a context for this specific socket
    const context = {
        dh: null,
        sharedSecret: null
    };
    clients.set(socket, context);

    socket.on('data', (data) => {
        try {
            const packet = AMProto.parsePacket(data);
            
            if (packet.command === AMProto.CMD_DH_INIT) {
                console.log(`[Server] Received DH_INIT from client.`);
                const payload = JSON.parse(packet.payloadString);
                
                // 1. Initialize DH with client's prime and generator
                const prime = Buffer.from(payload.prime, 'hex');
                const generator = Buffer.from(payload.generator, 'hex');
                context.dh = crypto.createDiffieHellman(prime, generator);
                
                // 2. Generate server's keys
                context.dh.generateKeys();
                
                // 3. Compute shared secret using client's public key
                const clientPublicKey = Buffer.from(payload.publicKey, 'hex');
                context.sharedSecret = context.dh.computeSecret(clientPublicKey);
                
                console.log(`[Server] Computed Shared Secret (first 4 bytes): ${context.sharedSecret.slice(0, 4).toString('hex')}...`);

                // 4. Send DH_REPLY with server's public key
                const replyPayload = {
                    publicKey: context.dh.getPublicKey('hex')
                };
                const reply = AMProto.buildPacket(AMProto.CMD_DH_REPLY, replyPayload);
                socket.write(reply);
            }
            else if (packet.command === AMProto.CMD_AUTH) {
                console.log(`[Server] Client attempting to AUTH: ${packet.payloadString}`);
                const reply = AMProto.buildPacket(AMProto.CMD_PING, "Auth Success");
                socket.write(reply);
            }
            
        } catch (err) {
            console.error(`[Server] Error processing packet:`, err.message);
        }
    });

    socket.on('end', () => {
        console.log(`[Server] Client disconnected`);
        clients.delete(socket);
    });

    socket.on('error', (err) => {
        console.error(`[Server] Socket error:`, err.message);
    });
});

server.listen(PORT, () => {
    console.log(`[Server] AM Proto Server listening on port ${PORT}`);
});
