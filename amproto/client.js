const net = require('net');
const crypto = require('crypto');
const AMProto = require('./amproto');

const PORT = 3000;
const HOST = '127.0.0.1';

const client = new net.Socket();
let clientDH;
let sharedSecret;

client.connect(PORT, HOST, () => {
    console.log(`[Client] Connected to AM Proto Server at ${HOST}:${PORT}`);

    // Step 1: Initialize DH Key Exchange
    console.log(`[Client] Generating Diffie-Hellman keys (this might take a second)...`);
    
    // We use a smaller prime (512 bit) here for faster generation in prototype,
    // in real life this should be 2048 or more.
    clientDH = crypto.createDiffieHellman(512); 
    clientDH.generateKeys();
    
    const payload = {
        prime: clientDH.getPrime('hex'),
        generator: clientDH.getGenerator('hex'),
        publicKey: clientDH.getPublicKey('hex')
    };

    console.log(`[Client] Sending DH_INIT to server...`);
    const initPacket = AMProto.buildPacket(AMProto.CMD_DH_INIT, payload);
    client.write(initPacket);
});

client.on('data', (data) => {
    try {
        const packet = AMProto.parsePacket(data);
        
        if (packet.command === AMProto.CMD_DH_REPLY) {
            console.log(`[Client] Received DH_REPLY from server.`);
            const payload = JSON.parse(packet.payloadString);
            
            // Step 2: Compute shared secret using server's public key
            const serverPublicKey = Buffer.from(payload.publicKey, 'hex');
            sharedSecret = clientDH.computeSecret(serverPublicKey);
            
            console.log(`[Client] Computed Shared Secret (first 4 bytes): ${sharedSecret.slice(0, 4).toString('hex')}...`);
            console.log(`[Client] Phase 2 DH Key Exchange SUCCESS!`);
            
            // Cleanly close connection after getting reply
            client.destroy();
        }
    } catch (err) {
        console.error(`[Client] Failed to parse reply:`, err.message);
    }
});

client.on('close', () => {
    console.log(`[Client] Connection closed`);
});

client.on('error', (err) => {
    console.error(`[Client] Socket error:`, err.message);
});
