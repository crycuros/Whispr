const net = require('net');
const crypto = require('crypto');
const AMProto = require('./amproto');

const PORT = 3000;
const HOST = '127.0.0.1';

const MY_ID = 1001;
const TARGET_ID = 1002;

const client = new net.Socket();
let clientDH;
let sharedSecret;

client.connect(PORT, HOST, () => {
    console.log(`\n[Client A - ${MY_ID}] Connected to Relay.`);

    // 1. Register with Server
    const authPacket = AMProto.buildPacket(AMProto.CMD_AUTH, 0, MY_ID.toString());
    client.write(AMProto.obfuscate(authPacket));

    // 2. Initiate E2EE with Client B
    setTimeout(() => {
        console.log(`[Client A] Initiating E2EE Key Exchange with Client ${TARGET_ID}...`);
        clientDH = crypto.createDiffieHellman(512); 
        clientDH.generateKeys();
        
        const payload = {
            prime: clientDH.getPrime('hex'),
            generator: clientDH.getGenerator('hex'),
            publicKey: clientDH.getPublicKey('hex')
        };

        const initPacket = AMProto.buildPacket(AMProto.CMD_DH_INIT, TARGET_ID, payload);
        client.write(AMProto.obfuscate(initPacket)); // Anti-DPI Obfuscation!
    }, 1000); // wait for Client B to connect in our test
});

client.on('data', (rawData) => {
    try {
        const cleanData = AMProto.deobfuscate(rawData);
        const packet = AMProto.parsePacket(cleanData);
        
        if (packet.command === AMProto.CMD_DH_REPLY) {
            console.log(`[Client A] Received DH_REPLY from Client ${TARGET_ID}. Keys established!`);
            const payload = JSON.parse(packet.payloadString);
            
            const targetPublicKey = Buffer.from(payload.publicKey, 'hex');
            sharedSecret = clientDH.computeSecret(targetPublicKey);
            
            const secretMessage = "Mission accomplished. The server cannot read this.";
            console.log(`[Client A] 🔒 Sending E2EE Message: "${secretMessage}"`);
            
            const encryptedPayload = AMProto.encryptPayload(secretMessage, sharedSecret);
            const encPacket = AMProto.buildPacket(AMProto.CMD_ENC_MSG, TARGET_ID, encryptedPayload);
            client.write(AMProto.obfuscate(encPacket));
        }
    } catch (err) {
        console.error(`[Client A] Failed to parse:`, err.message);
    }
});

client.on('error', (err) => console.error(err.message));
