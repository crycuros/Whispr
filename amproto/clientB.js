const net = require('net');
const crypto = require('crypto');
const AMProto = require('./amproto');

const PORT = 3000;
const HOST = '127.0.0.1';

const MY_ID = 1002;
const TARGET_ID = 1001;

const client = new net.Socket();
let clientDH;
let sharedSecret;

client.connect(PORT, HOST, () => {
    console.log(`\n[Client B - ${MY_ID}] Connected to Relay.`);

    // 1. Register with Server
    const authPacket = AMProto.buildPacket(AMProto.CMD_AUTH, 0, MY_ID.toString());
    client.write(AMProto.obfuscate(authPacket));
});

client.on('data', (rawData) => {
    try {
        const cleanData = AMProto.deobfuscate(rawData);
        const packet = AMProto.parsePacket(cleanData);
        
        if (packet.command === AMProto.CMD_DH_INIT) {
            console.log(`[Client B] Received DH_INIT from Client ${TARGET_ID}.`);
            const payload = JSON.parse(packet.payloadString);
            
            const prime = Buffer.from(payload.prime, 'hex');
            const generator = Buffer.from(payload.generator, 'hex');
            clientDH = crypto.createDiffieHellman(prime, generator);
            clientDH.generateKeys();
            
            const targetPublicKey = Buffer.from(payload.publicKey, 'hex');
            sharedSecret = clientDH.computeSecret(targetPublicKey);
            console.log(`[Client B] Computed E2E Shared Secret.`);

            const replyPayload = { publicKey: clientDH.getPublicKey('hex') };
            const replyPacket = AMProto.buildPacket(AMProto.CMD_DH_REPLY, TARGET_ID, replyPayload);
            client.write(AMProto.obfuscate(replyPacket));
        }
        else if (packet.command === AMProto.CMD_ENC_MSG) {
            console.log(`[Client B] Received Encrypted Message!`);
            const payload = JSON.parse(packet.payloadString);
            
            const decryptedMessage = AMProto.decryptPayload(payload, sharedSecret);
            console.log(`[Client B] 🔓 Decrypted E2EE Message: "${decryptedMessage}"`);
            
            client.destroy(); // Done with test
        }
    } catch (err) {
        console.error(`[Client B] Failed to parse:`, err.message);
    }
});

client.on('error', (err) => console.error(err.message));
