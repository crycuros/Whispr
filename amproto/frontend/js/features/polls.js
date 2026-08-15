import { state } from '../core/store.js';
import { buildPacket, obfuscate, CMD_GROUP_MSG, CMD_ENC_MSG } from '../core/amproto.js';
import { renderMessages } from '../ui/messages.js';
import { persistKeys } from '../core/app.js';
import { encryptGroupText } from '../core/grouplock.js';

export function setupPolls() {
    const pollModal = document.getElementById('poll-modal');
    if (!pollModal) return;

    document.getElementById('btn-poll-cancel').onclick = () => {
        pollModal.style.display = 'none';
    };

    document.getElementById('btn-poll-add-option').onclick = () => {
        const optionsList = document.getElementById('poll-options-list');
        if (optionsList.children.length >= 10) return; // Max 10 options
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'poll-option-input';
        input.placeholder = `Option ${optionsList.children.length + 1}`;
        optionsList.appendChild(input);
    };

    document.getElementById('btn-poll-create').onclick = async () => {
        const question = document.getElementById('poll-question').value.trim();
        if (!question) return;

        const options = [];
        document.querySelectorAll('.poll-option-input').forEach(input => {
            const val = input.value.trim();
            if (val) options.push(val);
        });

        if (options.length < 2) return;

        const pollId = 'poll-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        
        const payloadObj = {
            type: 'poll',
            pollId: pollId,
            question: question,
            options: options
        };

        const chat = state.chats.get(state.currentActiveChat);
        if (!chat || !chat.isGroup) return;

        const localMsg = { 
            id: 'msg-' + Date.now(),
            text: JSON.stringify(payloadObj),
            type: 'sent', 
            isRead: true, 
            time: Date.now(),
            senderId: state.myId,
            senderUsername: state.myUsername
        };
        
        chat.messages.push(localMsg);
        await persistKeys();
        renderMessages(state.currentActiveChat);

        const wireText = chat.groupKey ? await encryptGroupText(chat.groupKey, payloadObj) : JSON.stringify(payloadObj);
        const packet = buildPacket(CMD_GROUP_MSG, 0, state.myId, JSON.stringify({ groupId: chat.groupId, text: wireText }));
        if (state.ws) state.ws.send(obfuscate(packet));

        pollModal.style.display = 'none';
        document.getElementById('poll-question').value = '';
        const optionsList = document.getElementById('poll-options-list');
        optionsList.innerHTML = '';
        for(let i=0; i<2; i++) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'poll-option-input';
            input.placeholder = `Option ${i+1}`;
            optionsList.appendChild(input);
        }
    };
}

export async function castVote(pollId, optionIndex) {
    const chat = state.chats.get(state.currentActiveChat);
    if (!chat || !chat.isGroup) return;

    const payloadObj = {
        type: 'vote',
        pollId: pollId,
        optionIndex: optionIndex
    };

    const localMsg = { 
        id: 'msg-' + Date.now(),
        text: JSON.stringify(payloadObj),
        type: 'sent', 
        isRead: true, 
        time: Date.now(),
        senderId: state.myId,
        senderUsername: state.myUsername
    };
    
    chat.messages.push(localMsg);
    await persistKeys();
    renderMessages(state.currentActiveChat);

    const wireText = chat.groupKey ? await encryptGroupText(chat.groupKey, payloadObj) : JSON.stringify(payloadObj);
    const packet = buildPacket(CMD_GROUP_MSG, 0, state.myId, JSON.stringify({ groupId: chat.groupId, text: wireText }));
    if (state.ws) state.ws.send(obfuscate(packet));
}

export function renderPoll(msg, chat, payloadObj) {
    // Reconstruct poll state from vote messages
    const votes = {}; // userId -> optionIndex
    const voteCounts = new Array(payloadObj.options.length).fill(0);
    let totalVotes = 0;

    chat.messages.forEach(m => {
        let mPayload = {};
        try { mPayload = JSON.parse(m.text); } catch(e) {}
        if (mPayload.type === 'vote' && mPayload.pollId === payloadObj.pollId) {
            votes[m.senderId] = mPayload.optionIndex;
        }
    });

    Object.values(votes).forEach(optIdx => {
        if (optIdx >= 0 && optIdx < voteCounts.length) {
            voteCounts[optIdx]++;
            totalVotes++;
        }
    });

    const myVote = votes[state.myId];

    let html = `
        <div class="poll-container" id="poll-${payloadObj.pollId}">
            <div class="poll-question" style="font-weight: 600; margin-bottom: 12px; font-size: 1.1em;">${payloadObj.question}</div>
            <div class="poll-options">
    `;

    payloadObj.options.forEach((opt, idx) => {
        const count = voteCounts[idx];
        const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const isSelected = myVote === idx;
        
        html += `
            <div class="poll-option ${isSelected ? 'selected' : ''}" onclick="window.castVote('${payloadObj.pollId}', ${idx})" style="
                position: relative;
                padding: 10px 12px;
                margin-bottom: 8px;
                background: ${isSelected ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)'};
                border: 1px solid ${isSelected ? '#3b82f6' : 'rgba(255,255,255,0.1)'};
                border-radius: 8px;
                cursor: pointer;
                overflow: hidden;
            ">
                <div class="poll-option-fill" style="
                    position: absolute;
                    left: 0; top: 0; bottom: 0;
                    width: ${percent}%;
                    background: ${isSelected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.05)'};
                    z-index: 1;
                    transition: width 0.3s ease;
                "></div>
                <div style="position: relative; z-index: 2; display: flex; justify-content: space-between;">
                    <span style="${isSelected ? 'font-weight:bold; color: #60a5fa;' : ''}">${opt}</span>
                    <span style="font-size: 0.9em; color: #9ca3af;">${percent}%</span>
                </div>
            </div>
        `;
    });

    html += `
            </div>
            <div style="font-size: 0.85em; color: #9ca3af; margin-top: 8px; text-align: right;">${totalVotes} vote${totalVotes !== 1 ? 's' : ''}</div>
        </div>
    `;

    return html;
}
