// IMO Voice Club - Production Client Engine (10 Seats, Intimacy & Gifts)

// Central Cloud Server Configuration (Domain based - ZERO IP addresses exposed)
const DEFAULT_CLOUD_SERVER = (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) 
  ? window.location.origin 
  : 'https://imo-voiceclub.loca.lt';

function getServerBaseUrl() {
  if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
    return window.location.origin;
  }
  let saved = localStorage.getItem('imo_server_url');
  if (saved && saved.trim()) {
    return saved.trim().replace(/\/+$/, '');
  }
  return DEFAULT_CLOUD_SERVER;
}

function getWsUrl() {
  const base = getServerBaseUrl();
  const protocol = base.startsWith('https') ? 'wss:' : 'ws:';
  const cleanHost = base.replace(/^https?:\/\//, '');
  return `${protocol}//${cleanHost}`;
}

function apiUrl(endpoint) {
  const base = getServerBaseUrl();
  const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  return `${base}${path}`;
}

function updateServerStatusUI(status) {
  const dot = document.getElementById('serverStatusDot');
  const text = document.getElementById('serverStatusText');
  const modalDisplay = document.getElementById('modalServerStatusDisplay');
  
  if (status === 'connected') {
    if (dot) dot.style.background = '#22c55e';
    if (text) text.innerText = 'Online';
    if (modalDisplay) {
      modalDisplay.innerHTML = '🟢 Connected to Cloud Server';
      modalDisplay.style.color = '#4ade80';
    }
  } else if (status === 'connecting') {
    if (dot) dot.style.background = '#eab308';
    if (text) text.innerText = 'Connecting...';
    if (modalDisplay) {
      modalDisplay.innerHTML = '🟡 Connecting to Server...';
      modalDisplay.style.color = '#eab308';
    }
  } else {
    if (dot) dot.style.background = '#ef4444';
    if (text) text.innerText = 'Offline';
    if (modalDisplay) {
      modalDisplay.innerHTML = '🔴 Server Offline (Reconnecting...)';
      modalDisplay.style.color = '#f87171';
    }
  }
}

function openServerConfigModal() {
  const input = document.getElementById('serverDomainInput');
  if (input) {
    input.value = getServerBaseUrl();
  }
  document.getElementById('serverConfigModal').classList.add('active');
}

function closeServerConfigModal() {
  document.getElementById('serverConfigModal').classList.remove('active');
}

function saveServerConfig() {
  const input = document.getElementById('serverDomainInput');
  if (!input) return;
  let val = input.value.trim();
  if (!val) {
    showToast('⚠️ කරුණාකර වලංගු Server Domain එකක් ඇතුළත් කරන්න.');
    return;
  }
  if (!val.startsWith('http://') && !val.startsWith('https://')) {
    val = 'https://' + val;
  }
  localStorage.setItem('imo_server_url', val);
  showToast('💾 Cloud Server සැකසුම් සුරකින ලදී! Reconnecting...');
  closeServerConfigModal();
  setTimeout(() => {
    window.location.reload();
  }, 1000);
}

function resetServerConfig() {
  localStorage.removeItem('imo_server_url');
  showToast('🔄 Default Server Domain වෙත යළි සකසන ලදී!');
  closeServerConfigModal();
  setTimeout(() => {
    window.location.reload();
  }, 1000);
}

let state = {
  currentUser: null,
  isSeller: false,
  sellerInfo: null,
  currentRoomId: 'room-global-1',
  room: null,
  allRooms: [],
  allUsers: [],
  sellers: [],
  relationships: [],
  selectedGift: { id: 1, name: 'Rose', icon: '🌹', diamonds: 1 },
  dataSaverMode: true,
  isMuted: true,
  isSpeaking: false,
  heartCombo: 0,
  heartComboTimer: null
};

let ws = null;

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  updateServerStatusUI('connecting');
  checkUserSession();
});

function checkUserSession() {
  const saved = localStorage.getItem('imo_user');
  if (saved) {
    try {
      state.currentUser = JSON.parse(saved);
      initAppAfterLogin();
      return;
    } catch (e) {}
  }
  document.getElementById('loginModal').classList.add('active');
}

async function submitLogin() {
  const phone = document.getElementById('loginPhoneInput').value.trim();
  const name = document.getElementById('loginNameInput').value.trim();

  if (!phone) {
    showToast('⚠️ කරුණාකර වලංගු දුරකථන අංකයක් ඇතුළත් කරන්න.');
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name })
    });
    const data = await res.json();

    if (data.success) {
      state.currentUser = data.user;
      state.isSeller = data.isSeller;
      state.sellerInfo = data.sellerInfo;
      localStorage.setItem('imo_user', JSON.stringify(data.user));
      document.getElementById('loginModal').classList.remove('active');
      initAppAfterLogin();
      showToast(`🎉 සාදරයෙන් පිළිගනිමු, ${data.user.name}!`);
    } else {
      showToast(`⚠️ ${data.error}`);
    }
  } catch (e) {
    showToast(`⚠️ සර්වර් සම්බන්ධතා දෝෂයක්: කරුණාකර සර්වරය පරීක්ෂා කරන්න.`);
  }
}

function logout() {
  localStorage.removeItem('imo_user');
  window.location.reload();
}

function initAppAfterLogin() {
  loadInitialData();
  initWebSocket();
}

// WebSocket Setup
function initWebSocket() {
  const wsUrl = getWsUrl();
  updateServerStatusUI('connecting');

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      updateServerStatusUI('connected');
      if (state.currentUser) {
        ws.send(JSON.stringify({
          type: 'JOIN_ROOM',
          payload: { roomId: state.currentRoomId, userId: state.currentUser.id }
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('WS Error:', e);
      }
    };

    ws.onerror = (err) => {
      updateServerStatusUI('offline');
    };

    ws.onclose = () => {
      updateServerStatusUI('offline');
      setTimeout(initWebSocket, 2500);
    };
  } catch (err) {
    updateServerStatusUI('offline');
    setTimeout(initWebSocket, 2500);
  }
}

function handleServerMessage(msg) {
  const { type, payload } = msg;

  switch (type) {
    case 'ROOM_STATE':
      state.room = payload.room;
      state.allUsers = payload.allUsers || [];
      state.relationships = payload.relationships || [];
      syncCurrentUser();
      updateAllUI();
      break;

    case 'ROOM_UPDATED':
      state.room = payload.room;
      render10Seats();
      renderRoomRoleBar();
      break;

    case 'USER_ENTERED_ROOM':
      if (payload.user.id !== state.currentUser.id) {
        showEntranceNotice(payload.user);
      }
      break;

    case 'USER_SPEAKING':
      if (state.room && payload.roomId === state.room.id) {
        setSeatSpeaking(payload.seatIndex, payload.isSpeaking);
      }
      break;

    case 'HEART_RECEIVED':
      if (state.room) {
        state.room.heartsCount = payload.heartsCount;
        document.getElementById('roomHeartsCount').innerText = payload.heartsCount.toLocaleString();
        spawnFloatingHeart();
        playSynthSound('heart');
      }
      break;

    case 'FRIENDSHIP_HAND_SHAKEN':
      appendSystemChat(`🤝 ${payload.senderName} සහ ${payload.targetName} අතට අත දුන්හ! (+${payload.bonus} Intimacy)`);
      playSynthSound('handshake');
      showToast(`🤝 අතට අත දීම සාර්ථකයි!`);
      if (payload.relationships) {
        state.relationships = payload.relationships;
        renderIntimacySpotlight();
        render10Seats();
      }
      break;

    case 'GIFT_BROADCAST':
      handleIncomingGift(payload);
      break;

    case 'USER_KICKED':
      if (payload.userId === state.currentUser.id) {
        alert(`කාමරයෙන් ඉවත් කරන ලදී: ${payload.message}`);
        window.location.reload();
      }
      break;

    case 'DIAMOND_RECHARGE_COMPLETED':
      if (payload.userId === state.currentUser.id) {
        state.currentUser.diamonds = payload.newBalance;
        localStorage.setItem('imo_user', JSON.stringify(state.currentUser));
        updateDiamondDisplays();
        showToast(`🎉 Diamonds +${payload.added} ක් ඔබගේ ගිණුමට ක්ෂණිකව බැර විය!`);
        playSynthSound('recharge');
      }
      break;

    case 'NEW_CHAT_MESSAGE':
      appendChatMessage(payload);
      playSynthSound('message');
      break;

    case 'ALL_DATA_SYNC':
      loadInitialData();
      break;

    case 'BANNED':
      alert(`⚠️ ${payload.message}`);
      break;

    case 'ERROR':
      showToast(`⚠️ ${payload.message}`);
      break;
  }
}

// Fetch Full Initial State
async function loadInitialData() {
  try {
    const res = await fetch(apiUrl('/api/data'));
    const data = await res.json();
    state.allRooms = data.rooms;
    state.allUsers = data.users;
    state.sellers = data.sellers;
    state.relationships = data.relationships;
    state.room = data.rooms.find(r => r.id === state.currentRoomId) || data.rooms[0];

    syncCurrentUser();
    updateAllUI();
  } catch (e) {
    console.error('Failed to load initial data:', e);
  }
}

function syncCurrentUser() {
  if (!state.currentUser) return;
  const dbUser = state.allUsers.find(u => u.phone === state.currentUser.phone);
  if (dbUser) {
    state.currentUser = dbUser;
    localStorage.setItem('imo_user', JSON.stringify(dbUser));
  }
  const seller = state.sellers.find(s => s.phone === state.currentUser.phone);
  state.isSeller = !!seller;
  state.sellerInfo = seller || null;
}

function updateAllUI() {
  updateDiamondDisplays();
  render10Seats();
  renderIntimacySpotlight();
  renderRoomRoleBar();
  renderMembersTab();
  renderDiamondsTab();
  renderSellerTab();
  renderProfileTab();
}

function updateDiamondDisplays() {
  if (!state.currentUser) return;
  const val = (state.currentUser.diamonds || 0).toLocaleString();
  document.getElementById('userDiamondCount').innerText = val;
  document.getElementById('storeDiamondBalance').innerText = val;
  document.getElementById('modalGiftUserDiamonds').innerText = `${val} 💎`;
}

// Entrance Notification Banner
function showEntranceNotice(user) {
  const banner = document.getElementById('entranceBanner');
  document.getElementById('entranceAvatar').innerText = user.avatar || '👤';
  document.getElementById('entranceName').innerText = user.name;
  banner.style.display = 'flex';
  setTimeout(() => { banner.style.display = 'none'; }, 3200);
}

// Editable Voice Club Room Title
async function openEditRoomTitlePrompt() {
  if (!state.room) return;
  const isOwner = state.room.ownerId === state.currentUser.id || state.currentUser.role === 'master';
  if (!isOwner) {
    showToast('⚠️ කාමරයේ නම වෙනස් කළ හැක්කේ Room Owner හට පමණි.');
    return;
  }

  const newTitle = prompt('කාමරයේ අලුත් නම ඇතුළත් කරන්න:', state.room.title);
  if (!newTitle || newTitle.trim() === state.room.title) return;

  try {
    const res = await fetch(apiUrl('/api/rooms/update-title'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: state.room.id, title: newTitle.trim(), userId: state.currentUser.id })
    });
    const d = await res.json();
    if (d.success) {
      showToast('🎉 කාමරයේ නම සාර්ථකව වෙනස් විය!');
      state.room.title = newTitle.trim();
      document.getElementById('roomTitle').innerText = newTitle.trim();
    }
  } catch (e) {
    showToast(`⚠️ දෝෂයක්: ${e.message}`);
  }
}

// Render 10 Microphone Stage & Adjacent Intimacy Links (Holding Hands / Heart)
function render10Seats() {
  if (!state.room) return;

  document.getElementById('roomTitle').innerText = state.room.title;
  document.getElementById('roomHeartsCount').innerText = (state.room.heartsCount || 0).toLocaleString();
  document.getElementById('roomOnlineCount').innerText = (state.room.audience || []).length;

  const grid = document.getElementById('seats10Grid');
  grid.innerHTML = '';

  // Render 10 seats
  for (let i = 0; i < state.room.seats.length; i++) {
    const seat = state.room.seats[i];
    const isOccupied = seat.userId !== null;
    const isMe = seat.userId === state.currentUser.id;

    const div = document.createElement('div');
    div.className = `mic-seat ${seat.index === 1 ? 'host' : ''} ${isOccupied ? 'occupied' : ''} ${seat.isSpeaking ? 'speaking' : ''}`;
    div.id = `mic-seat-${seat.index}`;
    div.onclick = () => handleSeatClick(seat.index);

    let avatar = `<div class="mic-avatar-wrapper">
      <span>${isOccupied ? seat.avatar : '+'}</span>
      <div class="seat-badge">${seat.index}</div>
      ${seat.isMuted && isOccupied ? '<div class="seat-mute-badge">🔇</div>' : ''}
    </div>`;

    let name = `<span class="seat-name">${isOccupied ? (isMe ? 'මම' : seat.userName) : 'හිස්'}</span>
    <span class="seat-tag">Mic ${seat.index}</span>`;

    div.innerHTML = avatar + name;

    // Check adjacent holding hands / heart intimacy connection with next seat
    // Check horizontal neighbors: 1-2, 2-3, 3-4, 4-5 and 6-7, 7-8, 8-9, 9-10
    if (i < 9 && i !== 4 && isOccupied) {
      const nextSeat = state.room.seats[i + 1];
      if (nextSeat && nextSeat.userId) {
        const intimacyData = getPairwiseIntimacy(seat.userId, nextSeat.userId);
        if (intimacyData && (intimacyData.intimacyPoints >= 100 || intimacyData.hasHandLink || intimacyData.hasHeartLink)) {
          const connector = document.createElement('div');
          const isHeart = intimacyData.intimacyPoints >= 5000 || intimacyData.hasHeartLink;
          connector.className = `intimacy-seat-connector ${isHeart ? '' : 'connector-hand'}`;
          connector.innerText = isHeart ? '❤️' : '🤝';
          connector.title = `Intimacy: ${intimacyData.intimacyPoints} Pts (Touch for details)`;
          connector.style.right = '-12px';
          connector.onclick = (e) => {
            e.stopPropagation();
            openSeatIntimacyModal(seat.userId, nextSeat.userId, intimacyData);
          };
          div.appendChild(connector);
        }
      }
    }

    grid.appendChild(div);
  }
}

function getPairwiseIntimacy(u1Id, u2Id) {
  return state.relationships.find(r =>
    (r.user1Id === u1Id && r.user2Id === u2Id) ||
    (r.user1Id === u2Id && r.user2Id === u1Id)
  ) || null;
}

// Interactive Modal for Adjacent Seats Holding Hands / Heart
function openSeatIntimacyModal(u1Id, u2Id, rel) {
  const u1 = state.allUsers.find(u => u.id === u1Id) || { name: 'Friend 1', avatar: '👤' };
  const u2 = state.allUsers.find(u => u.id === u2Id) || { name: 'Friend 2', avatar: '👤' };

  document.getElementById('seatIntimacyModalTitle').innerText = `🤝 ${u1.name} & ${u2.name}`;
  const body = document.getElementById('seatIntimacyModalBody');

  const canActivateHeart = rel.intimacyPoints >= 5000 && !rel.hasHeartLink;
  const canActivateHand = rel.intimacyPoints >= 100 && !rel.hasHandLink;

  body.innerHTML = `
    <div style="text-align: center; padding: 10px 0;">
      <div style="display: flex; justify-content: center; align-items: center; gap: 14px; font-size: 2.5rem;">
        <span>${u1.avatar}</span>
        <span style="font-size: 2rem;">${rel.hasHeartLink || rel.intimacyPoints >= 5000 ? '❤️' : '🤝'}</span>
        <span>${u2.avatar}</span>
      </div>
      <h3 style="color: #ff85a1; margin-top: 6px;">${u1.name} & ${u2.name}</h3>
      <div style="font-size: 0.85rem; color: var(--accent-gold); font-weight: 700; margin-top: 4px;">
        Intimacy Points: ${rel.intimacyPoints.toLocaleString()} Pts
      </div>

      <div style="background: #1e293b; border-radius: 12px; padding: 12px; margin: 12px 0; text-align: left; font-size: 0.75rem; color: #cbd5e1; line-height: 1.6;">
        <div>• <b>Holding Hands (🤝):</b> Intimacy 100 වූ විට අතට අත දීම ක්‍රියාත්මක වේ.</div>
        <div>• <b>Love Heart (❤️):</b> Intimacy 5,000 වූ විට 500 Diamonds වැය කර අසුන් දෙක මැදට Heart දැමිය හැක.</div>
      </div>

      ${canActivateHeart ? `
        <button class="btn-primary" style="background: linear-gradient(135deg, #ff4d6d, #e63946); margin-bottom: 8px;" onclick="activateIntimacyLink('${u1Id}', '${u2Id}', 'HEART')">
          💖 අසුන් දෙක මැදට Heart දමන්න (500 💎)
        </button>
      ` : ''}

      ${canActivateHand ? `
        <button class="btn-primary" style="background: linear-gradient(135deg, #3a86ff, #4361ee); margin-bottom: 8px;" onclick="activateIntimacyLink('${u1Id}', '${u2Id}', 'HAND')">
          🤝 Holding Hands ක්‍රියාත්මක කරන්න
        </button>
      ` : ''}

      <button class="btn-primary" onclick="closeSeatIntimacyModal(); openGiftForUser('${u2Id === state.currentUser.id ? u1Id : u2Id}')">
        🎁 Gift යවා Intimacy තවත් වැඩි කරන්න
      </button>
    </div>
  `;

  document.getElementById('seatIntimacyModal').classList.add('active');
}

function closeSeatIntimacyModal() {
  document.getElementById('seatIntimacyModal').classList.remove('active');
}

async function activateIntimacyLink(u1Id, u2Id, type) {
  try {
    const res = await fetch(apiUrl('/api/rooms/activate-intimacy-link'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: state.room.id, user1Id: u1Id, user2Id: u2Id, type })
    });
    const d = await res.json();
    if (d.success) {
      showToast(`🎉 ${type === 'HEART' ? 'Love Heart ❤️' : 'Holding Hands 🤝'} සාර්ථකව සක්‍රීය විය!`);
      closeSeatIntimacyModal();
      loadInitialData();
    } else {
      showToast(`⚠️ ${d.error}`);
    }
  } catch (e) {
    showToast(`⚠️ දෝෂයක්: ${e.message}`);
  }
}

// Seat Click Handler
function handleSeatClick(seatIndex) {
  const seat = state.room.seats.find(s => s.index === seatIndex);
  if (!seat) return;

  if (!seat.userId) {
    if (confirm(`🎙️ Seat ${seatIndex} (Microphone) හි වාඩිවීමට කැමතිද?`)) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'TAKE_SEAT',
          payload: { roomId: state.room.id, userId: state.currentUser.id, seatIndex }
        }));
      }
    }
  } else if (seat.userId === state.currentUser.id) {
    if (confirm(`🚶 ඔබ Seat ${seatIndex} අසුනෙන් නැගිට සවන්දෙන්නන් (Audience) වෙත යාමට කැමතිද?`)) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'LEAVE_SEAT',
          payload: { roomId: state.room.id, userId: state.currentUser.id }
        }));
      }
    }
  } else {
    openUserActionModal(seat.userId);
  }
}

// Room Role Indicator
function renderRoomRoleBar() {
  if (!state.room || !state.currentUser) return;
  const isOwner = state.room.ownerId === state.currentUser.id || state.currentUser.role === 'master';
  const isAdmin = (state.room.admins || []).includes(state.currentUser.id) || isOwner;
  const mySeat = state.room.seats.find(s => s.userId === state.currentUser.id);

  const statusText = document.getElementById('myRoomStatusText');
  if (isOwner) {
    statusText.innerHTML = '👑 <b>ඔබ මෙම Room එකේ Owner වේ</b>';
  } else if (isAdmin) {
    statusText.innerHTML = '🛡️ <b>ඔබ මෙම Room එකේ Admin වේ</b>';
  } else if (mySeat) {
    statusText.innerText = `🎙️ ඔබ Mic ${mySeat.index} හි කතා කරමින් සිටී`;
  } else {
    statusText.innerText = '🎧 ඔබ දැනට සවන්දෙන්නෙකු (Listener) ලෙස සිටී';
  }

  const adminCount = (state.room.admins || []).length;
  document.getElementById('roomAdminCountText').innerText = `Admins: ${adminCount} / 100`;
}

function setSeatSpeaking(seatIndex, isSpeaking) {
  const elem = document.getElementById(`mic-seat-${seatIndex}`);
  if (elem) {
    if (isSpeaking) elem.classList.add('speaking');
    else elem.classList.remove('speaking');
  }
}

// Mic Mute Toggle
function toggleMic() {
  const mySeat = state.room ? state.room.seats.find(s => s.userId === state.currentUser.id) : null;
  if (!mySeat) {
    showToast(`⚠️ කතා කිරීමට පෙර කරුණාකර හිස් අසුනක (Seat) වාඩිවෙන්න.`);
    return;
  }

  state.isMuted = !state.isMuted;
  const icon = document.getElementById('micIcon');
  const btn = document.getElementById('micBtn');

  if (state.isMuted) {
    icon.innerText = '🔇';
    btn.style.background = '#ef4444';
    stopSpeakingSim();
    showToast(`🔇 Microphone එක Mute කරන ලදී.`);
  } else {
    icon.innerText = '🎙️';
    btn.style.background = '#10b981';
    startSpeakingSim();
    showToast(`🎙️ Microphone එක On කරන ලදී. (Low Bitrate Audio Active)`);
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'TOGGLE_MUTE',
      payload: { roomId: state.room.id, userId: state.currentUser.id, isMuted: state.isMuted }
    }));
  }
}

let speakingInterval = null;
function startSpeakingSim() {
  if (speakingInterval) clearInterval(speakingInterval);
  speakingInterval = setInterval(() => {
    if (!state.isMuted) {
      const active = Math.random() > 0.35;
      if (active !== state.isSpeaking) {
        state.isSpeaking = active;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'SPEAKING_STATE',
            payload: { roomId: state.room.id, userId: state.currentUser.id, isSpeaking: state.isSpeaking }
          }));
        }
      }
    }
  }, 1000);
}

function stopSpeakingSim() {
  if (speakingInterval) clearInterval(speakingInterval);
  state.isSpeaking = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'SPEAKING_STATE',
      payload: { roomId: state.room.id, userId: state.currentUser.id, isSpeaking: false }
    }));
  }
}

// 13 GIFTS SYSTEM (NO MONEY PRICES SHOWN, TIERED ANIMATION DURATION & 50% REWARD)
function openGiftModal() {
  populateGiftReceivers();
  document.getElementById('giftModal').classList.add('active');
}

function openGiftForUser(userId) {
  populateGiftReceivers();
  document.getElementById('giftReceiverSelect').value = userId;
  document.getElementById('giftModal').classList.add('active');
}

function closeGiftModal() {
  document.getElementById('giftModal').classList.remove('active');
}

function selectGift(id, name, icon, diamonds) {
  state.selectedGift = { id, name, icon, diamonds };
  document.querySelectorAll('.gift-card').forEach(c => c.classList.remove('selected'));
  if (event && event.currentTarget) event.currentTarget.classList.add('selected');
}

function populateGiftReceivers() {
  const sel = document.getElementById('giftReceiverSelect');
  sel.innerHTML = '';

  const activePeople = [];
  if (state.room) {
    state.room.seats.forEach(s => {
      if (s.userId && s.userId !== state.currentUser.id) activePeople.push(s);
    });
    (state.room.audience || []).forEach(a => {
      if (a.id !== state.currentUser.id && !activePeople.some(p => p.userId === a.id)) {
        activePeople.push({ userId: a.id, userName: a.name, role: 'Listener' });
      }
    });
  }

  activePeople.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.userId;
    opt.text = `${p.userName} (${p.role || 'Member'})`;
    sel.appendChild(opt);
  });

  if (sel.options.length === 0) {
    const opt = document.createElement('option');
    opt.value = 'none';
    opt.text = 'කාමරයේ වෙනත් සාමාජිකයන් නොමැත';
    sel.appendChild(opt);
  }
}

function sendSelectedGift() {
  const receiverId = document.getElementById('giftReceiverSelect').value;
  if (!receiverId || receiverId === 'none') {
    showToast(`⚠️ කරුණාකර වලංගු සාමාජිකයෙකු තෝරන්න.`);
    return;
  }

  if (state.currentUser.diamonds < state.selectedGift.diamonds && state.currentUser.role !== 'master') {
    showToast(`⚠️ ඔබේ Diamonds ප්‍රමාණය ප්‍රමාණවත් නොවේ! කරුණාකර Diamond Seller මඟින් Recharge කරගන්න.`);
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'SEND_GIFT',
      payload: {
        roomId: state.room.id,
        senderId: state.currentUser.id,
        receiverId,
        giftName: state.selectedGift.name,
        icon: state.selectedGift.icon,
        diamonds: state.selectedGift.diamonds
      }
    }));
  }
  closeGiftModal();
}

function handleIncomingGift(payload) {
  if (payload.senderId === state.currentUser.id) {
    state.currentUser.diamonds = payload.updatedSenderDiamonds;
    localStorage.setItem('imo_user', JSON.stringify(state.currentUser));
    updateDiamondDisplays();
  }
  if (payload.receiverId === state.currentUser.id) {
    state.currentUser.diamonds = payload.updatedReceiverDiamonds;
    localStorage.setItem('imo_user', JSON.stringify(state.currentUser));
    updateDiamondDisplays();
    showToast(`🎉 ඔබට ${payload.giftName} ලැබුණි! (+${payload.receivedDiamonds} 💎 ඔබේ ශේෂයට බැර විය)`);
  }

  if (payload.relationships) {
    state.relationships = payload.relationships;
    renderIntimacySpotlight();
    render10Seats();
  }

  showTieredGiftAnimation(payload);
  appendSystemChat(`🎁 ${payload.senderName} විසින් ${payload.receiverName} වෙත ${payload.giftName} (💎 ${payload.diamonds}) යවන ලදී! (+${payload.receivedDiamonds} 💎 ලබන්නාට හිමිවිය)`);
  playSynthSound('gift');
}

// Tiered Grand Animations based on Diamond Value
function showTieredGiftAnimation(payload) {
  const overlay = document.getElementById('giftBroadcastOverlay');
  const icon = document.getElementById('flyingGiftIcon');
  const banner = document.getElementById('giftBroadcastBanner');

  icon.innerText = payload.icon;
  const d = payload.diamonds;

  // Determine Duration & Grandeur
  let durationMs = 2200;
  let grandeurClass = '';

  if (d >= 2500) {
    durationMs = 8000; // Tier 4: Wedding / Castle in the Sky (8 Seconds)
    icon.style.fontSize = '8rem';
  } else if (d >= 650) {
    durationMs = 5500; // Tier 3: King / Rose Ring / Rocket (5.5 Seconds)
    icon.style.fontSize = '7rem';
  } else if (d >= 100) {
    durationMs = 3800; // Tier 2: Big Heart / Golden Tree / Flower Box (3.8 Seconds)
    icon.style.fontSize = '6rem';
  } else {
    durationMs = 2200; // Tier 1: Rose / Teddy Bear / Bomb / Heart (2.2 Seconds)
    icon.style.fontSize = '5rem';
  }

  banner.innerHTML = `
    <div style="font-size: 1.15rem; color: #ffd166;">🎉 ${payload.senderName} ➡️ ${payload.receiverName}</div>
    <div style="font-size: 0.9rem; color: #fff; margin-top: 4px;">${payload.giftName} (💎 ${payload.diamonds})</div>
    <div style="font-size: 0.72rem; color: #6ee7b7; margin-top: 2px;">ලබන්නාට 50% ත්‍යාගය: +${payload.receivedDiamonds} 💎 | Intimacy +${payload.intimacyGained}!</div>
  `;

  overlay.style.display = 'flex';

  const heartCount = d >= 1000 ? 15 : 6;
  for (let i = 0; i < heartCount; i++) {
    setTimeout(spawnFloatingHeart, i * 140);
  }

  setTimeout(() => {
    overlay.style.display = 'none';
  }, durationMs);
}

// Friendship Hand
function openFriendshipModal() {
  const sel = document.getElementById('friendshipTargetSelect');
  sel.innerHTML = '';
  if (state.room) {
    state.room.seats.forEach(s => {
      if (s.userId && s.userId !== state.currentUser.id) {
        const opt = document.createElement('option');
        opt.value = s.userId; opt.text = `${s.userName} (Seat ${s.index})`;
        sel.appendChild(opt);
      }
    });
    (state.room.audience || []).forEach(a => {
      if (a.id !== state.currentUser.id && !sel.querySelector(`option[value="${a.id}"]`)) {
        const opt = document.createElement('option');
        opt.value = a.id; opt.text = `${a.name} (Listener)`;
        sel.appendChild(opt);
      }
    });
  }
  document.getElementById('friendshipModal').classList.add('active');
}

function closeFriendshipModal() {
  document.getElementById('friendshipModal').classList.remove('active');
}

function submitFriendshipHand() {
  const sel = document.getElementById('friendshipTargetSelect');
  if (!sel.value) return;
  quickShakeHand(sel.value);
  closeFriendshipModal();
}

function quickShakeHand(targetId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'FRIENDSHIP_HAND',
      payload: { roomId: state.room.id, senderId: state.currentUser.id, targetId }
    }));
  }
}

// Floating Hearts
function sendHeart() {
  state.heartCombo++;
  clearTimeout(state.heartComboTimer);
  state.heartComboTimer = setTimeout(() => { state.heartCombo = 0; }, 1200);

  spawnFloatingHeart();
  playSynthSound('heart');

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'SEND_HEART',
      payload: {
        roomId: state.room.id,
        userId: state.currentUser.id,
        userName: state.currentUser.name,
        count: 1,
        combo: state.heartCombo
      }
    }));
  }
}

function spawnFloatingHeart() {
  const container = document.getElementById('heartsContainer');
  const heart = document.createElement('div');
  heart.className = 'floating-heart';
  const icons = ['❤️', '💖', '💝', '💕', '💗', '💞', '✨'];
  heart.innerText = icons[Math.floor(Math.random() * icons.length)];
  heart.style.left = `${Math.floor(Math.random() * 60) + 20}px`;
  container.appendChild(heart);
  setTimeout(() => heart.remove(), 2400);
}

// Dedicated Members & Audience Modal
function openMembersModal() {
  if (!state.room) return;
  const list = document.getElementById('modalMembersList');
  list.innerHTML = '';

  const audience = state.room.audience || [];
  if (audience.length === 0) {
    list.innerHTML = '<div style="color: #94a3b8; font-size: 0.8rem; text-align: center; padding: 20px;">වෙනත් සවන්දෙන්නන් නැත</div>';
  } else {
    audience.forEach(u => {
      const isSeated = state.room.seats.some(s => s.userId === u.id);
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 10px; border-radius: 12px;';
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.6rem;">${u.avatar || '👤'}</span>
          <div>
            <b style="color: #fff; font-size: 0.82rem;">${u.name}</b>
            <div style="font-size: 0.7rem; color: #94a3b8;">${isSeated ? '🎙️ On Stage' : '🎧 Listener'}</div>
          </div>
        </div>
        <button class="action-btn-circle" style="width: auto; padding: 0 10px; font-size: 0.72rem;" onclick="closeMembersModal(); openUserActionModal('${u.id}')">
          විස්තර
        </button>
      `;
      list.appendChild(row);
    });
  }

  document.getElementById('membersModal').classList.add('active');
}

function closeMembersModal() {
  document.getElementById('membersModal').classList.remove('active');
}

// SELLER DASHBOARD (Tied to Seller Mobile Number)
function renderSellerTab() {
  const container = document.getElementById('sellerDashboardContent');
  if (!container || !state.currentUser) return;

  const seller = state.sellers.find(s => s.phone === state.currentUser.phone);

  if (!seller) {
    container.innerHTML = `
      <div class="card-box" style="text-align: center; padding: 30px 16px;">
        <div style="font-size: 3rem; margin-bottom: 8px;">🔒</div>
        <h3 style="color: #fff;">Seller Dashboard එක සංවෘතයි</h3>
        <p style="font-size: 0.78rem; color: var(--text-muted); margin-top: 6px; line-height: 1.6;">
          ඔබගේ දුරකථන අංකය (${state.currentUser.phone}) Diamond Seller කෙනෙකු ලෙස ලියාපදිංචි කර නොමැත.<br>
          Seller කෙනෙකු වීමට කරුණාකර Master Admin අමතන්න.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="card-box" style="background: linear-gradient(135deg, #1b2838, #16382e); border-color: #2ec4b6;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.8rem; color: #5eead4; font-weight: 700;">💼 SELLER DASHBOARD</span>
        <span class="verified-tag">VERIFIED SELLER</span>
      </div>
      <h2 style="margin: 6px 0; color: #fff;">${seller.storeName}</h2>
      <div style="font-size: 0.75rem; color: #94a3b8;">${seller.name} | ${seller.phone}</div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px;">
        <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 12px;">
          <div style="font-size: 0.7rem; color: #94a3b8;">ඔබේ Diamond තොගය</div>
          <div style="font-size: 1.3rem; font-weight: 800; color: var(--diamond-color);">${seller.diamondsStock.toLocaleString()} 💎</div>
        </div>
        <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 12px;">
          <div style="font-size: 0.7rem; color: #5eead4;">මුළු විකිණුම්</div>
          <div style="font-size: 1.3rem; font-weight: 800; color: #5eead4;">${seller.totalSold.toLocaleString()} 💎</div>
        </div>
      </div>
    </div>

    <div class="card-box">
      <h4 style="color: #fff; margin-bottom: 8px;">📱 Mobile Number එකට Diamonds Top-Up කරන්න</h4>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div>
          <label style="font-size: 0.72rem; color: #94a3b8;">සාමාජිකයාගේ Mobile Number:</label>
          <input type="tel" id="sellerTargetPhoneInput" class="chat-input" placeholder="+9477..." style="width: 100%; border-radius: 10px; margin-top: 4px;">
        </div>
        <div>
          <label style="font-size: 0.72rem; color: #94a3b8;">Diamonds ප්‍රමාණය:</label>
          <input type="number" id="sellerAmountInput" class="chat-input" value="250" style="width: 100%; border-radius: 10px; margin-top: 4px;">
        </div>
        <button class="btn-primary" onclick="submitSellerTopup()" style="background: linear-gradient(135deg, #10b981, #059669); margin-top: 4px;">
          🚀 Diamonds ක්ෂණිකව Top-Up කරන්න
        </button>
      </div>
    </div>
  `;
}

async function submitSellerTopup() {
  const targetPhone = document.getElementById('sellerTargetPhoneInput').value.trim();
  const amount = parseInt(document.getElementById('sellerAmountInput').value, 10);

  if (!targetPhone || !amount || amount <= 0) {
    showToast('⚠️ කරුණාකර වලංගු දුරකථන අංකයක් සහ ප්‍රමාණයක් ඇතුළත් කරන්න.');
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/seller/topup-member'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellerPhone: state.currentUser.phone,
        targetMemberPhone: targetPhone,
        amount
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🎉 ${data.message}`);
      playSynthSound('recharge');
      loadInitialData();
    } else {
      showToast(`⚠️ ${data.error}`);
    }
  } catch (e) {
    showToast(`⚠️ Topup අසාර්ථකයි: ${e.message}`);
  }
}

// USER ACTION & MODERATION MODAL
function openUserActionModal(targetUserId) {
  const target = state.allUsers.find(u => u.id === targetUserId);
  if (!target || !state.room) return;

  const isOwner = state.room.ownerId === state.currentUser.id || state.currentUser.role === 'master';
  const isAdmin = (state.room.admins || []).includes(state.currentUser.id) || isOwner;
  const targetIsAdmin = (state.room.admins || []).includes(target.id);

  document.getElementById('actionModalUserTitle').innerText = `${target.name} (${target.phone})`;
  const body = document.getElementById('userActionModalBody');

  let adminControlsHtml = '';
  if (isAdmin && target.id !== state.currentUser.id && target.role !== 'master') {
    adminControlsHtml = `
      <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 12px; padding: 12px; margin-top: 12px;">
        <h4 style="color: #f87171; margin-bottom: 8px; font-size: 0.8rem;">🛡️ Admin පාලන විධාන (Room Moderation):</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <button class="action-btn-circle" style="width: 100%; border-radius: 10px; font-size: 0.75rem; background: #334155;" onclick="submitModeration('FORCE_MUTE', '${target.id}')">
            🔇 Mute කරන්න
          </button>
          <button class="action-btn-circle" style="width: 100%; border-radius: 10px; font-size: 0.75rem; background: #eab308; color: #111;" onclick="submitModeration('BLOCK_MEMBER', '${target.id}')">
            ⛔ Block කරන්න
          </button>
          <button class="action-btn-circle" style="width: 100%; border-radius: 10px; font-size: 0.75rem; background: #f97316;" onclick="submitModeration('KICK_24H', '${target.id}')">
            ⏳ Kick 24 Hours
          </button>
          <button class="action-btn-circle" style="width: 100%; border-radius: 10px; font-size: 0.75rem; background: #ef4444;" onclick="submitModeration('BAN_PERMANENT', '${target.id}')">
            🚫 Permanent Ban
          </button>
        </div>
        ${isOwner ? `
          <div style="margin-top: 8px;">
            ${targetIsAdmin ? `
              <button class="btn-primary" style="background: #64748b; font-size: 0.75rem; padding: 8px;" onclick="submitModeration('REMOVE_ADMIN', '${target.id}')">
                🛡️ Admin තනතුර ඉවත් කරන්න
              </button>
            ` : `
              <button class="btn-primary" style="background: linear-gradient(135deg, #0084ff, #0066cc); font-size: 0.75rem; padding: 8px;" onclick="submitModeration('ASSIGN_ADMIN', '${target.id}')">
                🛡️ Room Admin තනතුර ලබාදෙන්න (උපරිම 100)
              </button>
            `}
          </div>
        ` : ''}
      </div>
    `;
  }

  body.innerHTML = `
    <div style="text-align: center; padding: 8px 0;">
      <div style="font-size: 3rem;">${target.avatar || '👤'}</div>
      <h3 style="color: #fff; margin-top: 4px;">${target.name}</h3>
      <div style="font-size: 0.75rem; color: var(--text-muted);">${target.phone}</div>
      <div style="font-size: 0.75rem; color: #38bdf8; margin: 4px 0;">${target.bio || 'IMO Member'}</div>

      <div style="display: flex; gap: 8px; justify-content: center; margin-top: 10px;">
        <button class="btn-primary" style="width: auto; padding: 8px 14px; background: linear-gradient(135deg, #3a86ff, #4361ee);" onclick="closeUserActionModal(); quickShakeHand('${target.id}');">
          🤝 අතට අත දෙන්න
        </button>
        <button class="btn-primary" style="width: auto; padding: 8px 14px; background: linear-gradient(135deg, #ffb703, #fb8500); color: #111;" onclick="closeUserActionModal(); openGiftForUser('${target.id}');">
          🎁 Gift යවන්න
        </button>
      </div>

      ${adminControlsHtml}
    </div>
  `;

  document.getElementById('userActionModal').classList.add('active');
}

function closeUserActionModal() {
  document.getElementById('userActionModal').classList.remove('active');
}

function submitModeration(action, targetUserId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'ROOM_MODERATION',
      payload: { roomId: state.room.id, action, operatorId: state.currentUser.id, targetUserId }
    }));
  }
  closeUserActionModal();
}

// MEMBERS TAB & PROFILE CUSTOMIZATION
function renderMembersTab() {
  const list = document.getElementById('chatsList');
  if (!list) return;

  list.innerHTML = state.allUsers.map(u => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #334155;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 2rem;">${u.avatar || '👤'}</span>
        <div>
          <b style="color: #fff; font-size: 0.85rem;">${u.name}</b>
          <div style="font-size: 0.72rem; color: var(--text-muted);">${u.phone}</div>
        </div>
      </div>
      <button class="action-btn-circle" style="width: auto; padding: 0 12px; border-radius: 12px; font-size: 0.75rem;" onclick="openUserActionModal('${u.id}')">
        👤 බලන්න
      </button>
    </div>
  `).join('');
}

function openProfileEditModal() {
  document.getElementById('editProfileName').value = state.currentUser.name;
  document.getElementById('editProfileAvatar').value = state.currentUser.avatar || '👤';
  document.getElementById('editProfileBio').value = state.currentUser.bio || '';
  document.getElementById('profileEditModal').classList.add('active');
}

function closeProfileEditModal() {
  document.getElementById('profileEditModal').classList.remove('active');
}

function selectAvatarEmoji(e) {
  document.getElementById('editProfileAvatar').value = e;
}

async function submitProfileUpdate() {
  const name = document.getElementById('editProfileName').value.trim();
  const avatar = document.getElementById('editProfileAvatar').value.trim();
  const bio = document.getElementById('editProfileBio').value.trim();

  try {
    const res = await fetch(apiUrl('/api/user/profile-update'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.currentUser.id, name, avatar, bio })
    });
    const d = await res.json();
    if (d.success) {
      state.currentUser = d.user;
      localStorage.setItem('imo_user', JSON.stringify(d.user));
      closeProfileEditModal();
      showToast('💾 Profile සාර්ථකව යාවත්කාලීන විය!');
      updateAllUI();
    }
  } catch (e) {
    showToast(`⚠️ දෝෂයක්: ${e.message}`);
  }
}

function renderProfileTab() {
  if (!state.currentUser) return;
  document.getElementById('profileAvatar').innerText = state.currentUser.avatar || '👤';
  document.getElementById('profileName').innerText = state.currentUser.name;
  document.getElementById('profilePhone').innerText = `${state.currentUser.phone} | ID: ${state.currentUser.id}`;
  document.getElementById('profileBio').innerText = state.currentUser.bio || 'IMO Voice Club Member';
}

function renderDiamondsTab() {
  const list = document.getElementById('agentsDirectoryList');
  if (!list) return;

  list.innerHTML = state.sellers.map(s => `
    <div class="agent-item">
      <div class="agent-info">
        <div class="agent-name">
          <span>${s.storeName}</span>
          <span class="verified-tag">✓ VERIFIED</span>
        </div>
        <div class="agent-location">📍 ${s.city} | ${s.phone}</div>
      </div>
      <div class="agent-actions">
        <a href="https://wa.me/${s.phone.replace('+', '')}?text=Hello, මට IMO Diamonds ලබාගැනීමට අවශ්‍යයි." target="_blank" class="btn-whatsapp">
          <span>💬</span> WhatsApp
        </a>
      </div>
    </div>
  `).join('');
}

// Room Browser & Creation
function openRoomListModal() {
  const container = document.getElementById('allRoomsContainer');
  container.innerHTML = state.allRooms.map(r => `
    <div style="background: #1e293b; padding: 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="joinSelectedRoom('${r.id}')">
      <div>
        <b style="color: #fff;">${r.title}</b>
        <div style="font-size: 0.72rem; color: #94a3b8;">Host: ${r.ownerName} | 👥 ${(r.audience || []).length} Listeners</div>
      </div>
      <button class="btn-primary" style="width: auto; padding: 6px 12px; font-size: 0.75rem;">පිවිසෙන්න</button>
    </div>
  `).join('');
  document.getElementById('roomListModal').classList.add('active');
}

function closeRoomListModal() {
  document.getElementById('roomListModal').classList.remove('active');
}

function joinSelectedRoom(roomId) {
  state.currentRoomId = roomId;
  closeRoomListModal();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { roomId, userId: state.currentUser.id }
    }));
  }
}

async function openCreateRoomPrompt() {
  const title = prompt('නව Voice Room එකෙහි නම ඇතුළත් කරන්න:', `${state.currentUser.name}'s Room 🎵`);
  if (!title) return;

  try {
    const res = await fetch(apiUrl('/api/rooms/create'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, ownerId: state.currentUser.id })
    });
    const d = await res.json();
    if (d.success) {
      showToast('🎉 නව Voice Room එක සාර්ථකව නිර්මාණය විය!');
      closeRoomListModal();
      joinSelectedRoom(d.room.id);
    }
  } catch (e) {
    showToast(`⚠️ දෝෂයක්: ${e.message}`);
  }
}

// Chat Box Functions
function handleChatKeyPress(event) {
  if (event.key === 'Enter') {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !state.room) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'CHAT_MESSAGE',
        payload: {
          roomId: state.room.id,
          senderId: state.currentUser.id,
          senderName: state.currentUser.name,
          text
        }
      }));
    }
    input.value = '';
  }
}

function appendChatMessage(msg) {
  const box = document.getElementById('chatBox');
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = `<span class="sender">${msg.senderName}:</span><span>${msg.text}</span>`;
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
}

function appendSystemChat(text) {
  const box = document.getElementById('chatBox');
  const evt = document.createElement('div');
  evt.className = 'chat-system-event';
  evt.innerText = text;
  box.appendChild(evt);
  box.scrollTop = box.scrollHeight;
}

function openIntimacyModal() {
  document.getElementById('intimacyModal').classList.add('active');
}

function closeIntimacyModal() {
  document.getElementById('intimacyModal').classList.remove('active');
}

function renderIntimacySpotlight() {
  const topRel = state.relationships[0];
  if (topRel) {
    document.getElementById('cpPointsText').innerText = `${topRel.intimacyPoints.toLocaleString()} Pts`;
    document.getElementById('modalCpScore').innerText = `Intimacy Points: ${topRel.intimacyPoints.toLocaleString()} Pts`;
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const tab = document.getElementById(`tab-${tabId}`);
  if (tab) tab.classList.add('active');

  const navs = document.querySelectorAll('.nav-item');
  const indexMap = { voiceclub: 0, chats: 1, diamonds: 2, agent: 3, profile: 4 };
  if (navs[indexMap[tabId]]) navs[indexMap[tabId]].classList.add('active');

  if (tabId === 'agent') renderSellerTab();
  if (tabId === 'profile') renderProfileTab();
}

// Web Audio API Synthesizer
let audioCtx = null;
function playSynthSound(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'heart') {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'gift') {
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(783.99, now + 0.15);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now); osc.stop(now + 0.35);
    } else if (type === 'recharge') {
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.25);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now); osc.stop(now + 0.25);
    }
  } catch (e) {}
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3200);
}

function openShareModal() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    showToast(`🔗 Voice Club Link එක Copy විය!`);
  }).catch(() => {
    showToast(`🔗 Link: ${url}`);
  });
}
