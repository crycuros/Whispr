import { state } from '../core/store.js';
import { CMD_USER_UPDATE, CMD_GROUP_CREATE, buildPacket, obfuscate } from '../core/amproto.js';
import { initials, avatarColor, escapeHtml } from './chatList.js';

function updateCustomSelectUI(select) {
    if (!select) return;
    const wrapper = select.previousElementSibling;
    if (wrapper && wrapper.classList.contains('custom-select-wrapper')) {
        const selectedOpt = select.options[select.selectedIndex];
        if (selectedOpt) {
            wrapper.querySelector('.custom-select-trigger span').innerText = selectedOpt.text;
            wrapper.querySelectorAll('.custom-option').forEach(o => {
                o.classList.toggle('selected', o.dataset.value === select.value);
            });
        }
    }
}

function updateSliderBackground(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const p = Math.max(0, Math.min(1, (val - min) / (max - min)));
    const thumb = 16;
    slider.style.backgroundSize = `calc(${p * 100}% - ${p * thumb}px + ${thumb / 2}px) 100%`;
}

export function setupModals() {
    const settingsPanel = document.getElementById('panel-settings');
    const btnSettings = document.getElementById('btn-settings');
    const btnBackSettings = document.getElementById('btn-back-settings');
    const btnLogout = document.getElementById('btn-settings-logout');
    const colorSwatches = document.querySelectorAll('.color-swatch');

    const prefTheme = document.getElementById('pref-theme');
    const prefDisplay = document.getElementById('pref-display');
    const prefFontScale = document.getElementById('pref-font-scale');
    const prefMsgSpace = document.getElementById('pref-msg-space');
    const prefZoom = document.getElementById('pref-zoom');
    const prefPrivacy = document.getElementById('pref-privacy');
    const prefEmbeds = document.getElementById('pref-embeds');
    const prefReactions = document.getElementById('pref-reactions');
    const prefAutoplayGif = document.getElementById('pref-autoplay-gif');
    const prefReducedMotion = document.getElementById('pref-reduced-motion');

    function savePreferences() {
        state.myPreferences = {
            theme: prefTheme.value,
            display: prefDisplay.value,
            fontScale: prefFontScale.value,
            msgSpace: prefMsgSpace.value,
            zoom: prefZoom.value,
            privacy: prefPrivacy.value,
            embeds: prefEmbeds.checked,
            reactions: prefReactions.checked,
            autoplayGif: prefAutoplayGif.checked,
            reducedMotion: prefReducedMotion.checked
        };
        applyPreferences(state.myPreferences);
        
        const updatePacket = buildPacket(CMD_USER_UPDATE, 0, state.myId, JSON.stringify({ preferences: state.myPreferences }));
        if (state.myId && state.ws) state.ws.send(obfuscate(updatePacket));
    }

    function initCustomSelects() {
        document.querySelectorAll('.settings-select').forEach(select => {
            select.style.display = 'none';
            
            const wrapper = document.createElement('div');
            wrapper.className = 'custom-select-wrapper';
            
            const trigger = document.createElement('div');
            trigger.className = 'custom-select-trigger';
            
            const selectedOpt = select.options[select.selectedIndex];
            trigger.innerHTML = `<span>${selectedOpt ? selectedOpt.text : ''}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            
            const optionsDiv = document.createElement('div');
            optionsDiv.className = 'custom-options';
            
            Array.from(select.options).forEach((opt, idx) => {
                const optDiv = document.createElement('div');
                optDiv.className = 'custom-option';
                optDiv.dataset.value = opt.value;
                optDiv.innerText = opt.text;
                
                if (idx === select.selectedIndex) optDiv.classList.add('selected');
                
                optDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    select.value = opt.value;
                    select.dispatchEvent(new Event('change'));
                    
                    trigger.querySelector('span').innerText = opt.text;
                    optionsDiv.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                    optDiv.classList.add('selected');
                    optionsDiv.classList.remove('open');
                });
                optionsDiv.appendChild(optDiv);
            });
            
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.custom-options').forEach(o => {
                    if (o !== optionsDiv) o.classList.remove('open');
                });
                optionsDiv.classList.toggle('open');
            });
            
            wrapper.appendChild(trigger);
            wrapper.appendChild(optionsDiv);
            select.parentNode.insertBefore(wrapper, select);
        });
        
        document.addEventListener('click', () => {
            document.querySelectorAll('.custom-options').forEach(o => o.classList.remove('open'));
        });
    }
    initCustomSelects();

    updateSliderBackground(prefFontScale);
    updateSliderBackground(prefMsgSpace);

    [prefTheme, prefDisplay].forEach(el => el.addEventListener('change', savePreferences));
    [prefFontScale, prefMsgSpace].forEach(el => el.addEventListener('input', (e) => {
        updateSliderBackground(e.target);
        savePreferences();
    }));
    prefZoom.addEventListener('change', savePreferences);
    if (prefPrivacy) prefPrivacy.addEventListener('change', savePreferences);
    [prefEmbeds, prefReactions, prefAutoplayGif, prefReducedMotion].forEach(el => el.addEventListener('change', savePreferences));

    const savedColor = localStorage.getItem('whispr_accent_color');
    if (savedColor) applyThemeColor(savedColor);

    if (btnSettings) {
        btnSettings.addEventListener('click', () => {
            document.getElementById('settings-display-name').value = state.myUsername;
            document.getElementById('settings-bio').value = state.myBio;
            
            const avatarPicker = document.getElementById('settings-avatar-picker');
            if (state.myAvatarUrl) {
                avatarPicker.innerHTML = `<img src="${state.myAvatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
            }
            
            settingsPanel.classList.add('active');
        });
    }

    if (btnBackSettings) {
        btnBackSettings.addEventListener('click', () => {
            settingsPanel.classList.remove('active');
        });
    }

    const btnFiles = document.getElementById('btn-files');
    const panelVault = document.getElementById('panel-vault');
    if (btnFiles && panelVault) {
        btnFiles.addEventListener('click', () => {
            document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btnFiles.classList.add('active');
            
            // Re-use active class style, or set display block
            panelVault.style.display = 'flex';
            panelVault.classList.add('active');
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            localStorage.removeItem('whispr_session');
            location.reload();
        });
    }

    colorSwatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
            const color = swatch.dataset.color;
            applyThemeColor(color);
            
            const updatePacket = buildPacket(CMD_USER_UPDATE, 0, state.myId, JSON.stringify({ themeColor: color }));
            if (state.ws) state.ws.send(obfuscate(updatePacket));
        });
    });

    setupImagePicker('settings-avatar-picker', (croppedB64) => {
        state.pendingSpaceAvatar = croppedB64; 
    });

    document.getElementById('btn-save-profile').addEventListener('click', () => {
        const bio = document.getElementById('settings-bio').value;
        const updatePacket = buildPacket(CMD_USER_UPDATE, 0, state.myId, JSON.stringify({
            avatarUrl: state.pendingSpaceAvatar,
            bio: bio
        }));
        if (state.ws) state.ws.send(obfuscate(updatePacket));
        
        settingsPanel.classList.remove('active');
    });

    setupImagePicker('feed-avatar-picker', (b64) => state.pendingFeedAvatar = b64);
    setupImagePicker('space-avatar-picker', (b64) => state.pendingSpaceAvatar = b64);

    document.getElementById('btn-new-space').onclick = () => {
        const listEl = document.getElementById('space-member-list');
        listEl.innerHTML = '';
        state.chats.forEach(chat => {
            if (chat.isGroup || chat.peerId === state.myId) return;
            const row = document.createElement('label');
            row.className = 'group-member';
            row.innerHTML = `
                <input type="checkbox" value="${chat.peerId}">
                <span class="gm-avatar" style="background:${avatarColor(chat.username)}">${initials(chat.username)}</span>
                <span class="gm-name">${escapeHtml(chat.username)}</span>
            `;
            listEl.appendChild(row);
        });
        document.getElementById('panel-space-step1').classList.add('active');
    };

    document.getElementById('btn-space-next').onclick = () => {
        state.pendingSpaceMembers = Array.from(document.querySelectorAll('#space-member-list input:checked')).map(cb => parseInt(cb.value));
        
        const selEl = document.getElementById('space-selected-members');
        selEl.innerHTML = '';
        state.pendingSpaceMembers.forEach(id => {
            const chat = state.chats.get(id);
            if(chat) {
                selEl.innerHTML += `<div style="font-size:13px; margin-bottom:4px;">${escapeHtml(chat.username)}</div>`;
            }
        });

        document.getElementById('panel-space-step2').classList.add('active');
    };

    document.getElementById('btn-create-space-fab').onclick = () => {
        const name = document.getElementById('space-name').value.trim() || 'New Space';
        const description = document.getElementById('space-desc').value.trim();
        
        const payload = { name, members: state.pendingSpaceMembers, description, avatarUrl: state.pendingSpaceAvatar };
        const packet = buildPacket(CMD_GROUP_CREATE, 0, state.myId, JSON.stringify(payload));
        if (state.ws) state.ws.send(obfuscate(packet));

        document.getElementById('panel-space-step1').classList.remove('active');
        document.getElementById('panel-space-step2').classList.remove('active');
    };

    document.getElementById('btn-new-feed').onclick = () => {
        document.getElementById('feed-name').value = '';
        document.getElementById('feed-desc').value = '';
        state.pendingFeedAvatar = null;
        document.getElementById('feed-avatar-picker').style.backgroundImage = 'none';
        document.getElementById('feed-avatar-picker').innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`;
        
        document.getElementById('panel-new-feed').classList.add('active');
    };

    document.getElementById('btn-create-feed-fab').onclick = () => {
        const name = document.getElementById('feed-name').value.trim() || 'New Feed';
        const description = document.getElementById('feed-desc').value.trim();
        
        const payload = { name, members: [], isFeed: true, description, avatarUrl: state.pendingFeedAvatar };
        const packet = buildPacket(CMD_GROUP_CREATE, 0, state.myId, JSON.stringify(payload));
        if (state.ws) state.ws.send(obfuscate(packet));

        document.getElementById('panel-new-feed').classList.remove('active');
    };

    document.getElementById('btn-back-feed').onclick = () => document.getElementById('panel-new-feed').classList.remove('active');
    document.getElementById('btn-back-space1').onclick = () => document.getElementById('panel-space-step1').classList.remove('active');
    document.getElementById('btn-back-space2').onclick = () => document.getElementById('panel-space-step2').classList.remove('active');

    const myAvatar = document.getElementById('my-avatar');
    const profilePopover = document.getElementById('profile-popover');
    if (myAvatar && profilePopover) {
        myAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            profilePopover.style.display = profilePopover.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', (e) => {
            if (!profilePopover.contains(e.target)) {
                profilePopover.style.display = 'none';
            }
        });
    }

    document.getElementById('btn-apply-crop').onclick = () => {
        if (!state.currentCropper) return;
        
        state.currentCropper.result({
            type: 'base64',
            size: 'viewport',
            format: 'png',
            circle: false
        }).then(function (croppedB64) {
            document.getElementById(state.activeCropElementId).style.backgroundImage = `url(${croppedB64})`;
            document.getElementById(state.activeCropElementId).innerHTML = '';
            
            if (state.activeCropCallback) state.activeCropCallback(croppedB64);
            
            closeCropModal();
        });
    };

    document.getElementById('btn-cancel-crop').onclick = () => {
        closeCropModal();
    };

}

export function applyPreferences(prefs) {
    if (!prefs) return;
    
    const prefTheme = document.getElementById('pref-theme');
    const prefDisplay = document.getElementById('pref-display');
    const prefFontScale = document.getElementById('pref-font-scale');
    const prefMsgSpace = document.getElementById('pref-msg-space');
    const prefZoom = document.getElementById('pref-zoom');
    const prefPrivacy = document.getElementById('pref-privacy');
    const prefEmbeds = document.getElementById('pref-embeds');
    const prefReactions = document.getElementById('pref-reactions');
    const prefAutoplayGif = document.getElementById('pref-autoplay-gif');
    const prefReducedMotion = document.getElementById('pref-reduced-motion');

    if (prefs.theme) { prefTheme.value = prefs.theme; }
    if (prefs.display) { prefDisplay.value = prefs.display; }
    if (prefs.fontScale) { prefFontScale.value = prefs.fontScale; }
    if (prefs.msgSpace) { prefMsgSpace.value = prefs.msgSpace; }
    if (prefs.zoom) { prefZoom.value = prefs.zoom; }
    if (prefs.privacy) { prefPrivacy.value = prefs.privacy; }
    if (prefs.embeds !== undefined) prefEmbeds.checked = prefs.embeds;
    if (prefs.reactions !== undefined) prefReactions.checked = prefs.reactions;
    if (prefs.autoplayGif !== undefined) prefAutoplayGif.checked = prefs.autoplayGif;
    if (prefs.reducedMotion !== undefined) prefReducedMotion.checked = prefs.reducedMotion;

    document.body.dataset.theme = prefs.theme || 'light';
    document.body.dataset.display = prefs.display || 'cozy';
    document.body.dataset.reducedMotion = prefs.reducedMotion || false;
    
    if (prefs.fontScale) document.documentElement.style.setProperty('--chat-font-size', prefs.fontScale + 'px');
    if (prefs.msgSpace) document.documentElement.style.setProperty('--chat-msg-spacing', prefs.msgSpace + 'px');
    if (prefs.zoom) document.documentElement.style.setProperty('--app-zoom', prefs.zoom);

    [prefTheme, prefDisplay, prefZoom, prefPrivacy].forEach(updateCustomSelectUI);
    updateSliderBackground(prefFontScale);
    updateSliderBackground(prefMsgSpace);
}

export function applyThemeColor(color) {
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-light', color + '40');
    document.documentElement.style.setProperty('--accent-hover', color + 'dd');
    localStorage.setItem('whispr_accent_color', color);
    
    document.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color === color);
    });
}

function setupImagePicker(elementId, callback) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const b64 = ev.target.result;
                openCropModal(b64, elementId, callback);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    };
}

function openCropModal(imageSrc, elementId, callback) {
    const cropModal = document.getElementById('crop-modal');
    const container = document.getElementById('croppie-container');
    
    cropModal.style.display = 'flex';
    
    if (state.currentCropper) {
        state.currentCropper.destroy();
        state.currentCropper = null;
    }
    
    state.currentCropper = new Croppie(container, {
        viewport: { width: 256, height: 256, type: 'circle' },
        boundary: { width: '100%', height: 300 },
        showZoomer: true,
        enableOrientation: true
    });
    
    state.currentCropper.bind({
        url: imageSrc
    });
    
    state.activeCropCallback = callback;
    state.activeCropElementId = elementId;
}

function closeCropModal() {
    document.getElementById('crop-modal').style.display = 'none';
    if (state.currentCropper) {
        state.currentCropper.destroy();
        state.currentCropper = null;
    }
}
