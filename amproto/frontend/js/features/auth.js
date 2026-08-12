import { state } from '../core/store.js';
import { CMD_LOGIN, CMD_REGISTER, buildPacket, obfuscate, sha256 } from '../core/amproto.js';
import { loadPersistedKeys } from '../core/app.js'; // Need to be careful with circular imports

export function showError(msg) {
    const errDiv = document.getElementById('auth-error');
    errDiv.innerText = msg;
    errDiv.style.display = 'block';
    errDiv.style.color = '#ef4444';
    errDiv.style.background = 'rgba(239,68,68,0.1)';
    setTimeout(() => { errDiv.style.display = 'none'; }, 3000);
}

export function setupAuth() {
    document.getElementById('btn-login').onclick = async () => {
        if (state.ws && state.ws.readyState !== WebSocket.OPEN) {
            alert("Connecting to server... Please try again in a second.");
            return;
        }
        const user = document.getElementById('auth-username').value.trim();
        const pass = document.getElementById('auth-password').value.trim();
        if (!user || !pass) return showError("Please enter credentials");

        const hash = await sha256(pass);
        state.myPasswordHash = hash;
        state.myUsername = user;
        localStorage.setItem('whispr_session', JSON.stringify({ user, hash }));
        await loadPersistedKeys();

        const payload = JSON.stringify({ username: user, password: state.myPasswordHash });
        const packet = buildPacket(CMD_LOGIN, 0, 0, payload);
        state.ws.send(obfuscate(packet));
    };

    document.getElementById('btn-register').onclick = async () => {
        const user = document.getElementById('auth-username').value.trim();
        const pass = document.getElementById('auth-password').value.trim();
        if (!user || !pass) return showError("Please enter credentials");

        const hash = await sha256(pass);
        state.myPasswordHash = hash;

        const payload = JSON.stringify({ username: user, password: state.myPasswordHash });
        const packet = buildPacket(CMD_REGISTER, 0, 0, payload);
        if(state.ws) state.ws.send(obfuscate(packet));
    };
}
