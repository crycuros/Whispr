const net = require('net');
const crypto = require('crypto');
const AMProto = require('./amproto');

const PORT = 3000;

// Store connections and their negotiated secrets
const clients = new Map();

const server = net.createServer((socket) => {
    console.log(`\n[Server] New connection from ${socket.remoteAddress}:${socket.remotePort}`);
    
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
                
                const prime = Buffer.from(payload.prime, 'hex');
                const generator = Buffer.from(payload.generator, 'hex');
                context.dh = crypto.createDiffieHellman(prime, generator);
                context.dh.generateKeys();
                
                const clientPublicKey = Buffer.from(payload.publicKey, 'hex');
                context.sharedSecret = context.dh.computeSecret(clientPublicKey);
                console.log(`[Server] Shared Secret Established.`);

                const replyPayload = {
                    publicKey: context.dh.getPublicKey('hex')
                };
                const reply = AMProto.buildPacket(AMProto.CMD_DH_REPLY, replyPayload);
                socket.write(reply);
            }
            else if (packet.command === AMProto.CMD_ENC_MSG) {
                console.log(`[Server] Received Encrypted Message!`);
                const payload = JSON.parse(packet.payloadString);
                
                if (!context.sharedSecret) {
                    console.log(`[Server] Error: No shared secret established yet.`);
                    return;
                }

                // Decrypt the message
                const decryptedMessage = AMProto.decryptPayload(payload, context.sharedSecret);
                console.log(`[Server] 🔓 Decrypted Message: "${decryptedMessage}"`);
                
                // Send an encrypted reply
                const replyText = "Message received loud and clear!";
                const encReply = AMProto.encryptPayload(replyText, context.sharedSecret);
                const replyPacket = AMProto.buildPacket(AMProto.CMD_ENC_MSG, encReply);
                socket.write(replyPacket);
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
