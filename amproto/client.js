const net = require('net');
const AMProto = require('./amproto');

const PORT = 3000;
const HOST = '127.0.0.1';

const client = new net.Socket();

client.connect(PORT, HOST, () => {
    console.log(`[Client] Connected to AM Proto Server at ${HOST}:${PORT}`);

    // Build and send an AUTH packet
    console.log(`[Client] Sending AUTH packet...`);
    const authPacket = AMProto.buildPacket(AMProto.CMD_AUTH, "User_Jessie_123");
    
    // Log the raw binary before sending
    console.log(`[Client] Raw binary to send:`, authPacket);
    client.write(authPacket);
});

client.on('data', (data) => {
    console.log(`[Client] Received raw bytes from server:`, data);
    
    try {
        const packet = AMProto.parsePacket(data);
        console.log(`[Client] Parsed Reply:`, packet);
        
        if (packet.command === AMProto.CMD_PING) {
            console.log(`[Client] Received PING with message: ${packet.payloadString}`);
            
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
