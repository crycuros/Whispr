const WebSocket = require('ws');
const AMProto = require('./backend/core/amproto');
const crypto = require('crypto');

async function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

async function runTests() {
    console.log("Starting Whispr Integration Tests...");
    let passed = 0;
    let failed = 0;

    const assert = (condition, msg) => {
        if (condition) {
            console.log(`PASS: ${msg}`);
            passed++;
        } else {
            console.error(`FAIL: ${msg}`);
            failed++;
        }
    };

    let aliceId = null;
    let bobId = null;
    let groupId = null;
    let aliceWs = null;
    let bobWs = null;

    let aliceListeners = [];
    let bobListeners = [];

    try {
        // --- 1. Alice Register and Login ---
        aliceWs = new WebSocket('ws://localhost:3000');
        await new Promise(res => aliceWs.on('open', res));
        
        aliceWs.on('message', (data) => {
            const dec = AMProto.deobfuscate(data);
            const packet = AMProto.parsePacket(dec);
            aliceListeners.forEach(fn => fn(packet));
        });

        const waitAlicePacket = (cmd) => new Promise(res => {
            const listener = (p) => {
                if (p.command === cmd || !cmd) {
                    aliceListeners = aliceListeners.filter(l => l !== listener);
                    res(p);
                }
            };
            aliceListeners.push(listener);
        });

        // Register Alice
        const aliceUsername = 'alice_' + Date.now();
        const registerAlicePacket = AMProto.buildPacket(AMProto.CMD_REGISTER, 0, 0, JSON.stringify({ username: aliceUsername, password: 'password123' }));
        let waitAlice = waitAlicePacket(AMProto.CMD_REGISTER_OK);
        aliceWs.send(AMProto.obfuscate(registerAlicePacket));
        
        let p = await waitAlice;
        assert(p.command === AMProto.CMD_REGISTER_OK, "Alice registered successfully");

        // Login Alice
        const loginAlicePacket = AMProto.buildPacket(AMProto.CMD_LOGIN, 0, 0, JSON.stringify({ username: aliceUsername, password: 'password123' }));
        waitAlice = waitAlicePacket(AMProto.CMD_LOGIN_OK);
        aliceWs.send(AMProto.obfuscate(loginAlicePacket));

        p = await waitAlice;
        assert(p.command === AMProto.CMD_LOGIN_OK, "Alice logged in successfully");
        const aliceInfo = JSON.parse(p.payloadString);
        aliceId = aliceInfo.userId;

        // --- 2. Bob Register and Login ---
        bobWs = new WebSocket('ws://localhost:3000');
        await new Promise(res => bobWs.on('open', res));
        
        bobWs.on('message', (data) => {
            const dec = AMProto.deobfuscate(data);
            const packet = AMProto.parsePacket(dec);
            bobListeners.forEach(fn => fn(packet));
        });

        const waitBobPacket = (cmd) => new Promise(res => {
            const listener = (p) => {
                if (p.command === cmd || !cmd) {
                    bobListeners = bobListeners.filter(l => l !== listener);
                    res(p);
                }
            };
            bobListeners.push(listener);
        });

        const bobUsername = 'bob_' + Date.now();
        const registerBobPacket = AMProto.buildPacket(AMProto.CMD_REGISTER, 0, 0, JSON.stringify({ username: bobUsername, password: 'password123' }));
        let waitBob = waitBobPacket(AMProto.CMD_REGISTER_OK);
        bobWs.send(AMProto.obfuscate(registerBobPacket));
        
        p = await waitBob;
        assert(p.command === AMProto.CMD_REGISTER_OK, "Bob registered successfully");

        const loginBobPacket = AMProto.buildPacket(AMProto.CMD_LOGIN, 0, 0, JSON.stringify({ username: bobUsername, password: 'password123' }));
        waitBob = waitBobPacket(AMProto.CMD_LOGIN_OK);
        bobWs.send(AMProto.obfuscate(loginBobPacket));

        p = await waitBob;
        assert(p.command === AMProto.CMD_LOGIN_OK, "Bob logged in successfully");
        const bobInfo = JSON.parse(p.payloadString);
        bobId = bobInfo.userId;

        // --- 3. Resolve Username (Alice resolves Bob) ---
        const resolvePacket = AMProto.buildPacket(AMProto.CMD_RESOLVE, 0, aliceId, bobUsername);
        waitAlice = waitAlicePacket(AMProto.CMD_RESOLVE_OK);
        aliceWs.send(AMProto.obfuscate(resolvePacket));

        p = await waitAlice;
        assert(p.command === AMProto.CMD_RESOLVE_OK, "Alice resolved Bob's username");
        assert(JSON.parse(p.payloadString).userId === bobId, "Resolved correct Bob ID");

        // --- 4. Group Creation (Alice creates group and adds Bob) ---
        const createGroupPacket = AMProto.buildPacket(AMProto.CMD_GROUP_CREATE, 0, aliceId, JSON.stringify({ name: 'Test Group', members: [aliceId, bobId] }));
        waitAlice = waitAlicePacket(AMProto.CMD_GROUP_CREATE_OK);
        let waitBobGroup = waitBobPacket(AMProto.CMD_GROUP_INFO_OK);
        
        aliceWs.send(AMProto.obfuscate(createGroupPacket));
        
        p = await waitAlice;
        assert(p.command === AMProto.CMD_GROUP_CREATE_OK, "Alice received Group Create OK");
        
        let pBob = await waitBobGroup;
        assert(pBob.command === AMProto.CMD_GROUP_INFO_OK, "Bob received Group Info Relay");
        groupId = JSON.parse(pBob.payloadString).groupId;

        // --- 5. Group Message Relay ---
        const groupMsgPacket = AMProto.buildPacket(AMProto.CMD_GROUP_MSG, 0, aliceId, JSON.stringify({ groupId: groupId, text: JSON.stringify({ text: "Hello Group!" }) }));
        waitBobGroup = waitBobPacket(AMProto.CMD_GROUP_MSG_RELAY);
        aliceWs.send(AMProto.obfuscate(groupMsgPacket));

        pBob = await waitBobGroup;
        assert(pBob.command === AMProto.CMD_GROUP_MSG_RELAY, "Bob received group message relay");
        assert(pBob.senderId === aliceId, "Group message came from Alice");

        // --- 6. Vault Upload & List (Bob) ---
        const vaultUploadPacket = AMProto.buildPacket(AMProto.CMD_VAULT_UPLOAD, 0, bobId, JSON.stringify({
            encName: "dGVzdF9lbmM=",
            encMime: "dGVzdF9taW1l",
            size: 100,
            encData: "SGVsbG8gVmF1bHQh" // "Hello Vault!" in base64
        }));
        let waitBobVault = waitBobPacket(AMProto.CMD_VAULT_UPLOAD_OK);
        bobWs.send(AMProto.obfuscate(vaultUploadPacket));

        pBob = await waitBobVault;
        assert(pBob.command === AMProto.CMD_VAULT_UPLOAD_OK, "Bob uploaded to Vault");
        
        const vaultListPacket = AMProto.buildPacket(AMProto.CMD_VAULT_LIST, 0, bobId, JSON.stringify({}));
        waitBobVault = waitBobPacket(AMProto.CMD_VAULT_LIST_OK);
        bobWs.send(AMProto.obfuscate(vaultListPacket));

        pBob = await waitBobVault;
        assert(pBob.command === AMProto.CMD_VAULT_LIST_OK, "Bob listed Vault files");
        assert(JSON.parse(pBob.payloadString).files.length > 0, "Vault list is not empty");
        
        const fileId = JSON.parse(pBob.payloadString).files[0].id;
        
        const vaultDownloadPacket = AMProto.buildPacket(AMProto.CMD_VAULT_DOWNLOAD, 0, bobId, JSON.stringify({ id: fileId }));
        waitBobVault = waitBobPacket(AMProto.CMD_VAULT_DOWNLOAD_OK);
        bobWs.send(AMProto.obfuscate(vaultDownloadPacket));

        pBob = await waitBobVault;
        assert(pBob.command === AMProto.CMD_VAULT_DOWNLOAD_OK, "Bob downloaded from Vault");
        assert(JSON.parse(pBob.payloadString).encData === "SGVsbG8gVmF1bHQh", "Vault data matched");

        console.log(`\nTests completed. Passed: ${passed}, Failed: ${failed}`);
        
    } catch(err) {
        console.error("Test execution failed:", err);
    } finally {
        if (aliceWs) aliceWs.close();
        if (bobWs) bobWs.close();
        process.exit(failed > 0 ? 1 : 0);
    }
}

runTests();
