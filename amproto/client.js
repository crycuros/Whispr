const net = require('net');
const crypto = require('crypto');
const AMProto = require('./amproto');

const PORT = 3000;
const HOST = '127.0.0.1';

const client = new net.Socket();
let clientDH;
let sharedSecret;

client.connect(PORT, HOST, () => {
    console.log(`\n[Client] Connected to AM Proto Server at ${HOST}:${PORT}`);

    console.log(`[Client] Initiating Key Exchange...`);
    clientDH = crypto.createDiffieHellman(512); 
    clientDH.generateKeys();
    
    const payload = {
        prime: clientDH.getPrime('hex'),
        generator: clientDH.getGenerator('hex'),
        publicKey: clientDH.getPublicKey('hex')
    };

    const initPacket = AMProto.buildPacket(AMProto.CMD_DH_INIT, payload);
    client.write(initPacket);
});

client.on('data', (data) => {
    try {
        const packet = AMProto.parsePacket(data);
        
        if (packet.command === AMProto.CMD_DH_REPLY) {
            console.log(`[Client] Received DH_REPLY. Keys established!`);
            const payload = JSON.parse(packet.payloadString);
            
            const serverPublicKey = Buffer.from(payload.publicKey, 'hex');
            sharedSecret = clientDH.computeSecret(serverPublicKey);
            
            // Now that we have a shared secret, let's send a secret message
            const secretMessage = "Hello from Jessie! This is top secret.";
            console.log(`[Client] 🔒 Encrypting message: "${secretMessage}"`);
            
            const encryptedPayload = AMProto.encryptPayload(secretMessage, sharedSecret);
            console.log(`[Client] Sending Ciphertext: ${encryptedPayload.encryptedData.slice(0,20)}...`);
            
            const encPacket = AMProto.buildPacket(AMProto.CMD_ENC_MSG, encryptedPayload);
            client.write(encPacket);
        }
        else if (packet.command === AMProto.CMD_ENC_MSG) {
            console.log(`[Client] Received Encrypted Reply from server!`);
            const payload = JSON.parse(packet.payloadString);
            
            const decryptedMessage = AMProto.decryptPayload(payload, sharedSecret);
            console.log(`[Client] 🔓 Decrypted Reply: "${decryptedMessage}"`);
            
            // Cleanly close connection
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
