const WebSocket = require('ws');
const AMProto = require('./backend/core/amproto');
const crypto = require('crypto');

const WS_URL = 'ws://localhost:3000';

function makeClient(username, password) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        ws.on('open', () => {
            // Try login
            const loginPayload = JSON.stringify({ username, password });
            const loginPacket = AMProto.buildPacket(AMProto.CMD_LOGIN, 0, 0, loginPayload);
            ws.send(AMProto.obfuscate(loginPacket));
        });

        let userClient = null;

        ws.on('message', (data) => {
            const packet = AMProto.parsePacket(AMProto.deobfuscate(data));
            if (!userClient) {
                if (packet.command === AMProto.CMD_LOGIN_OK) {
                    const res = JSON.parse(packet.payloadString);
                    userClient = {
                        ws,
                        id: res.userId,
                        username: res.username,
                        sendRequest: (cmd, payload) => {
                            return new Promise((resProm, rejProm) => {
                                const p = AMProto.buildPacket(cmd, 0, res.userId, JSON.stringify(payload));
                                ws.send(AMProto.obfuscate(p));
                                pendingPromises.set(cmd, { resProm, rejProm });
                            });
                        },
                        handleMessage: (pkt) => {
                            let expectedCmd;
                            if (pkt.command === AMProto.CMD_ERROR) {
                                for (let p of pendingPromises.values()) {
                                    p.resProm(pkt); 
                                }
                                pendingPromises.clear();
                            } else {
                                if (pkt.command === AMProto.CMD_REQ_SEND_OK) expectedCmd = AMProto.CMD_REQ_SEND;
                                if (pkt.command === AMProto.CMD_CONTACT_BLOCK_OK) expectedCmd = AMProto.CMD_CONTACT_BLOCK;
                                if (pkt.command === AMProto.CMD_CONTACT_UNBLOCK_OK) expectedCmd = AMProto.CMD_CONTACT_UNBLOCK;
                                if (pkt.command === AMProto.CMD_CONTACT_REMOVE_OK) expectedCmd = AMProto.CMD_CONTACT_REMOVE;
                                if (pkt.command === AMProto.CMD_CONTACT_LIST_OK) expectedCmd = AMProto.CMD_CONTACT_LIST;
                                
                                if (expectedCmd && pendingPromises.has(expectedCmd)) {
                                    pendingPromises.get(expectedCmd).resProm(pkt);
                                    pendingPromises.delete(expectedCmd);
                                }
                            }
                        }
                    };
                    resolve(userClient);
                } else if (packet.command === AMProto.CMD_ERROR) {
                    const regPayload = JSON.stringify({ username, password });
                    const regPacket = AMProto.buildPacket(AMProto.CMD_REGISTER, 0, 0, regPayload);
                    ws.send(AMProto.obfuscate(regPacket));
                } else if (packet.command === AMProto.CMD_REGISTER_OK) {
                    const loginPayload = JSON.stringify({ username, password });
                    const loginPacket = AMProto.buildPacket(AMProto.CMD_LOGIN, 0, 0, loginPayload);
                    ws.send(AMProto.obfuscate(loginPacket));
                }
            } else {
                userClient.handleMessage(packet);
            }
        });
    });
}

async function runTests() {
    console.log('Connecting test clients...');
    const u1 = await makeClient('testuser_A_' + Date.now(), 'pass');
    const u2 = await makeClient('testuser_B_' + Date.now(), 'pass');
    
    console.log(`Connected: ${u1.username} (${u1.id}), ${u2.username} (${u2.id})`);

    // Edge Case 1: Block oneself
    console.log('\\n--- Test: Self Block ---');
    const res1 = await u1.sendRequest(AMProto.CMD_CONTACT_BLOCK, { userId: u1.id });
    console.log('Self block response:', res1.command === AMProto.CMD_ERROR ? 'ERROR (Expected)' : 'SUCCESS (Fail)');
    if (res1.command === AMProto.CMD_ERROR) console.log('Message:', JSON.parse(res1.payloadString).message);

    // Edge Case 2: Block another user
    console.log('\\n--- Test: Block User B ---');
    const res2 = await u1.sendRequest(AMProto.CMD_CONTACT_BLOCK, { userId: u2.id });
    console.log('Block User B response:', res2.command === AMProto.CMD_CONTACT_BLOCK_OK ? 'SUCCESS' : 'FAIL');

    // Edge Case 3: Check Contact List for Blocked User
    console.log('\\n--- Test: Check Contacts List (Should have B blocked) ---');
    const res3 = await u1.sendRequest(AMProto.CMD_CONTACT_LIST, {});
    const data3 = JSON.parse(res3.payloadString);
    console.log('Blocked count:', data3.blocked.length, 'Expected: >0');
    console.log('Is B blocked?', data3.blocked.some(b => b.userId === u2.id) ? 'Yes' : 'No');

    // Edge Case 4: Try to send friend request to blocked user
    console.log('\\n--- Test: Send Request to Blocked User ---');
    const res4 = await u1.sendRequest(AMProto.CMD_REQ_SEND, { toUsername: u2.username });
    console.log('Request to blocked response:', res4.command === AMProto.CMD_ERROR ? 'ERROR (Expected)' : 'SUCCESS (Fail)');
    if (res4.command === AMProto.CMD_ERROR) console.log('Message:', JSON.parse(res4.payloadString).message);

    // Edge Case 5: Unblock User B
    console.log('\\n--- Test: Unblock User B ---');
    const res5 = await u1.sendRequest(AMProto.CMD_CONTACT_UNBLOCK, { userId: u2.id });
    console.log('Unblock User B response:', res5.command === AMProto.CMD_CONTACT_UNBLOCK_OK ? 'SUCCESS' : 'FAIL');
    
    console.log('\\nAll tests completed. Closing connections.');
    u1.ws.close();
    u2.ws.close();
    process.exit(0);
}

runTests().catch(console.error);
