const net = require('net');
const AMProto = require('./amproto');

const PORT = 3000;

const server = net.createServer((socket) => {
    console.log(`[Server] New connection from ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', (data) => {
        console.log(`[Server] Received raw bytes:`, data);
        
        try {
            const packet = AMProto.parsePacket(data);
            console.log(`[Server] Parsed AM Proto Packet:`, packet);

            if (packet.command === AMProto.CMD_AUTH) {
                console.log(`[Server] Client attempting to AUTH with payload: ${packet.payloadString}`);
                // Reply with Ping
                const reply = AMProto.buildPacket(AMProto.CMD_PING, "Auth Success");
                socket.write(reply);
            }
            
        } catch (err) {
            console.error(`[Server] Failed to parse packet:`, err.message);
        }
    });

    socket.on('end', () => {
        console.log(`[Server] Client disconnected`);
    });

    socket.on('error', (err) => {
        console.error(`[Server] Socket error:`, err.message);
    });
});

server.listen(PORT, () => {
    console.log(`[Server] AM Proto Server listening on port ${PORT}`);
});
