const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const MASTER_KEY = 'MASTER@777';
const MASTER_PHONE = '+94770000000';

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading DB:', e);
  }
  return {
    users: [],
    sellers: [],
    rooms: [],
    relationships: [],
    friendships: [],
    transactions: []
  };
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving DB:', e);
  }
}

// Ensure rooms have 10 seats
function ensureRoomStructure() {
  if (!db.rooms || db.rooms.length === 0) {
    db.rooms = [{
      id: 'room-global-1',
      title: '🔥 Phoenix Voice Club 1 | Official Lounge 🎵',
      category: 'Chat & Music',
      ownerId: 'USR-MASTER',
      ownerPhone: MASTER_PHONE,
      ownerName: 'Master Owner 👑',
      admins: [],
      banned24h: {},
      permanentBanned: [],
      blocked: [],
      seats: Array.from({ length: 10 }, (_, i) => ({
        index: i + 1,
        userId: null,
        userName: null,
        avatar: null,
        phone: null,
        isMuted: false,
        isSpeaking: false,
        role: i === 0 ? 'host' : null
      })),
      audience: [],
      activeIntimacyLinks: [],
      heartsCount: 0
    }];
    saveDB();
  } else {
    db.rooms.forEach(room => {
      room.seats = room.seats || [];
      while (room.seats.length < 10) {
        const idx = room.seats.length + 1;
        room.seats.push({
          index: idx,
          userId: null,
          userName: null,
          avatar: null,
          phone: null,
          isMuted: false,
          isSpeaking: false,
          role: null
        });
      }
      room.activeIntimacyLinks = room.activeIntimacyLinks || [];
    });
    saveDB();
  }
}
ensureRoomStructure();

// WebSocket Connected Clients
const clients = new Set();

function broadcast(data, exclude = null) {
  const jsonStr = JSON.stringify(data);
  const frame = encodeWebSocketFrame(jsonStr);
  for (const client of clients) {
    if (client !== exclude && client.readyState === 'OPEN') {
      try {
        client.socket.write(frame);
      } catch (e) {
        clients.delete(client);
      }
    }
  }
}

function sendToClient(client, data) {
  if (client && client.readyState === 'OPEN') {
    try {
      client.socket.write(encodeWebSocketFrame(JSON.stringify(data)));
    } catch (e) {
      clients.delete(client);
    }
  }
}

function encodeWebSocketFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let header;

  if (length <= 125) {
    header = Buffer.from([0x81, length]);
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

function handleWebSocketConnection(socket, req) {
  const clientObj = {
    socket,
    readyState: 'OPEN',
    userId: null,
    userPhone: null,
    roomId: null
  };
  clients.add(clientObj);

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (buffer.length < 4) break;
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (buffer.length < 10) break;
        payloadLength = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLength = isMasked ? 4 : 0;
      if (buffer.length < offset + maskLength + payloadLength) break;

      let maskKey = null;
      if (isMasked) {
        maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      const payload = buffer.subarray(offset, offset + payloadLength);
      buffer = buffer.subarray(offset + payloadLength);

      if (opcode === 0x08) {
        clientObj.readyState = 'CLOSED';
        clients.delete(clientObj);
        socket.end();
        return;
      }

      if (opcode === 0x09) {
        socket.write(Buffer.from([0x8a, 0x00]));
        continue;
      }

      if (opcode === 0x01) {
        const unmasked = Buffer.alloc(payloadLength);
        if (isMasked) {
          for (let i = 0; i < payloadLength; i++) {
            unmasked[i] = payload[i] ^ maskKey[i % 4];
          }
        } else {
          payload.copy(unmasked);
        }

        try {
          const msg = JSON.parse(unmasked.toString('utf8'));
          processWSMessage(clientObj, msg);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      }
    }
  });

  socket.on('close', () => {
    clientObj.readyState = 'CLOSED';
    clients.delete(clientObj);
    handleClientDisconnect(clientObj);
  });

  socket.on('error', () => {
    clientObj.readyState = 'CLOSED';
    clients.delete(clientObj);
    handleClientDisconnect(clientObj);
  });
}

function handleClientDisconnect(client) {
  if (client.roomId && client.userId) {
    const room = db.rooms.find(r => r.id === client.roomId);
    if (room) {
      room.audience = (room.audience || []).filter(u => u.id !== client.userId);
      const seat = room.seats.find(s => s.userId === client.userId);
      if (seat && seat.role !== 'host') {
        seat.userId = null;
        seat.userName = null;
        seat.avatar = null;
        seat.phone = null;
        seat.isSpeaking = false;
      }
      saveDB();
      broadcast({ type: 'ROOM_UPDATED', payload: { room } });
    }
  }
}

function processWSMessage(client, msg) {
  const { type, payload } = msg;

  switch (type) {
    // 1. Join Room (Listener) & Broadcast Entrance Notice
    case 'JOIN_ROOM': {
      const room = db.rooms.find(r => r.id === payload.roomId);
      const user = db.users.find(u => u.id === payload.userId);

      if (!room || !user) {
        sendToClient(client, { type: 'ERROR', payload: { message: 'කාමරය හමු නොවීය.' } });
        return;
      }

      if (room.permanentBanned && room.permanentBanned.includes(user.id)) {
        sendToClient(client, { type: 'BANNED', payload: { message: 'ඔබව මෙම Voice Room එකෙන් ස්ථීරවම ඉවත් කර ඇත (Permanently Banned).' } });
        return;
      }

      if (room.banned24h && room.banned24h[user.id]) {
        const unbanTime = room.banned24h[user.id];
        if (Date.now() < unbanTime) {
          const remainingMinutes = Math.ceil((unbanTime - Date.now()) / (60 * 1000));
          sendToClient(client, { type: 'BANNED', payload: { message: `ඔබව මෙම Voice Room එකෙන් පැය 24 කට තාවකාලිකව ඉවත් කර ඇත. තව මිනිත්තු ${remainingMinutes} කින් අවසන් වේ.` } });
          return;
        } else {
          delete room.banned24h[user.id];
          saveDB();
        }
      }

      client.roomId = room.id;
      client.userId = user.id;
      client.userPhone = user.phone;

      room.audience = room.audience || [];
      const alreadyInAudience = room.audience.some(a => a.id === user.id);
      if (!alreadyInAudience) {
        room.audience.push({ id: user.id, name: user.name, avatar: user.avatar, phone: user.phone });
      }

      saveDB();

      sendToClient(client, {
        type: 'ROOM_STATE',
        payload: { room, allUsers: db.users, relationships: db.relationships }
      });

      broadcast({
        type: 'ROOM_UPDATED',
        payload: { room }
      });

      // Broadcast grand entrance notice if newly joined
      if (!alreadyInAudience) {
        broadcast({
          type: 'USER_ENTERED_ROOM',
          payload: {
            roomId: room.id,
            user: { id: user.id, name: user.name, avatar: user.avatar || '👤' }
          }
        });
      }
      break;
    }

    // 2. Take Seat (1 to 10)
    case 'TAKE_SEAT': {
      const room = db.rooms.find(r => r.id === payload.roomId);
      const user = db.users.find(u => u.id === payload.userId);

      if (room && user) {
        if (room.blocked && room.blocked.includes(user.id)) {
          sendToClient(client, { type: 'ERROR', payload: { message: 'ඔබට මෙම කාමරයේ කතා කිරීම තහනම් කර ඇත (Blocked).' } });
          return;
        }

        const seat = room.seats.find(s => s.index === payload.seatIndex);
        if (seat && !seat.userId) {
          room.seats.forEach(s => {
            if (s.userId === user.id && s.index !== payload.seatIndex) {
              s.userId = null; s.userName = null; s.avatar = null; s.phone = null;
            }
          });

          seat.userId = user.id;
          seat.userName = user.name;
          seat.avatar = user.avatar;
          seat.phone = user.phone;
          seat.role = (room.ownerId === user.id) ? 'host' : 'speaker';
          seat.isMuted = false;
          seat.isSpeaking = false;

          saveDB();
          broadcast({ type: 'ROOM_UPDATED', payload: { room } });
          broadcast({
            type: 'NEW_CHAT_MESSAGE',
            payload: {
              roomId: room.id,
              senderName: 'System',
              text: `🎙️ ${user.name} විසින් Seat ${seat.index} අසුන් ගන්නා ලදී.`
            }
          });
        }
      }
      break;
    }

    // 3. Leave Seat
    case 'LEAVE_SEAT': {
      const room = db.rooms.find(r => r.id === payload.roomId);
      if (room) {
        const seat = room.seats.find(s => s.userId === payload.userId);
        if (seat) {
          seat.userId = null;
          seat.userName = null;
          seat.avatar = null;
          seat.phone = null;
          seat.isSpeaking = false;
          saveDB();
          broadcast({ type: 'ROOM_UPDATED', payload: { room } });
        }
      }
      break;
    }

    // 4. Toggle Mute
    case 'TOGGLE_MUTE': {
      const room = db.rooms.find(r => r.id === payload.roomId);
      if (room) {
        const seat = room.seats.find(s => s.userId === payload.userId);
        if (seat) {
          seat.isMuted = payload.isMuted;
          saveDB();
          broadcast({ type: 'ROOM_UPDATED', payload: { room } });
        }
      }
      break;
    }

    // 5. Speaking State
    case 'SPEAKING_STATE': {
      const room = db.rooms.find(r => r.id === payload.roomId);
      if (room) {
        const seat = room.seats.find(s => s.userId === payload.userId);
        if (seat && !seat.isMuted) {
          seat.isSpeaking = payload.isSpeaking;
          broadcast({
            type: 'USER_SPEAKING',
            payload: { roomId: payload.roomId, seatIndex: seat.index, isSpeaking: payload.isSpeaking }
          });
        }
      }
      break;
    }

    // 6. Floating Hearts
    case 'SEND_HEART': {
      const room = db.rooms.find(r => r.id === payload.roomId);
      if (room) {
        room.heartsCount = (room.heartsCount || 0) + (payload.count || 1);
        saveDB();
        broadcast({
          type: 'HEART_RECEIVED',
          payload: {
            roomId: room.id,
            userId: payload.userId,
            userName: payload.userName,
            heartsCount: room.heartsCount,
            combo: payload.combo || 1
          }
        });
      }
      break;
    }

    // 7. Friendship Handshake
    case 'FRIENDSHIP_HAND': {
      const { roomId, senderId, targetId } = payload;
      const sender = db.users.find(u => u.id === senderId);
      const target = db.users.find(u => u.id === targetId);

      if (sender && target) {
        let rel = db.relationships.find(r =>
          (r.user1Id === senderId && r.user2Id === targetId) ||
          (r.user1Id === targetId && r.user2Id === senderId)
        );

        if (!rel) {
          rel = {
            id: 'rel-' + Date.now(),
            user1Id: senderId,
            user2Id: targetId,
            intimacyPoints: 25,
            intimacyLevel: 1,
            hasHandLink: false,
            hasHeartLink: false
          };
          db.relationships.push(rel);
        } else {
          rel.intimacyPoints += 25;
          rel.intimacyLevel = Math.min(10, Math.floor(rel.intimacyPoints / 1000) + 1);
        }

        saveDB();
        broadcast({
          type: 'FRIENDSHIP_HAND_SHAKEN',
          payload: {
            roomId,
            senderName: sender.name,
            targetName: target.name,
            bonus: 25,
            relationships: db.relationships
          }
        });
      }
      break;
    }

    // 8. Animated Gift Delivery: Receiver gets 50% value in Diamonds!
    case 'SEND_GIFT': {
      const { roomId, senderId, receiverId, giftName, icon, diamonds } = payload;
      const sender = db.users.find(u => u.id === senderId);
      const receiver = db.users.find(u => u.id === receiverId);

      if (!sender || !receiver) return;

      const isMaster = sender.role === 'master';
      if (!isMaster && sender.diamonds < diamonds) {
        sendToClient(client, {
          type: 'ERROR',
          payload: { message: 'ඔබේ Diamonds ප්‍රමාණය ප්‍රමාණවත් නොවේ!' }
        });
        return;
      }

      if (!isMaster) {
        sender.diamonds -= diamonds;
      }

      // Receiver gets 50% of the gift's diamond value!
      const receivedDiamonds = Math.floor(diamonds * 0.5);
      receiver.diamonds = (receiver.diamonds || 0) + receivedDiamonds;
      receiver.beans = (receiver.beans || 0) + receivedDiamonds;

      // Intimacy points: 1 Diamond = 10 Intimacy points
      const intimacyGained = diamonds * 10;
      let rel = db.relationships.find(r =>
        (r.user1Id === senderId && r.user2Id === receiverId) ||
        (r.user1Id === receiverId && r.user2Id === senderId)
      );

      if (!rel) {
        rel = {
          id: 'rel-' + Date.now(),
          user1Id: senderId,
          user2Id: receiverId,
          intimacyPoints: intimacyGained,
          intimacyLevel: Math.min(10, Math.floor(intimacyGained / 1000) + 1),
          hasHandLink: false,
          hasHeartLink: false
        };
        db.relationships.push(rel);
      } else {
        rel.intimacyPoints += intimacyGained;
        rel.intimacyLevel = Math.min(10, Math.floor(rel.intimacyPoints / 1000) + 1);
      }

      saveDB();

      const room = db.rooms.find(r => r.id === roomId);
      const senderSeat = room ? room.seats.find(s => s.userId === senderId) : null;
      const receiverSeat = room ? room.seats.find(s => s.userId === receiverId) : null;

      broadcast({
        type: 'GIFT_BROADCAST',
        payload: {
          roomId,
          senderId,
          senderName: sender.name,
          senderSeatIndex: senderSeat ? senderSeat.index : null,
          receiverId,
          receiverName: receiver.name,
          receiverSeatIndex: receiverSeat ? receiverSeat.index : null,
          giftName,
          icon,
          diamonds,
          receivedDiamonds, // 50% reward
          intimacyGained,
          updatedSenderDiamonds: sender.diamonds,
          updatedReceiverDiamonds: receiver.diamonds,
          relationships: db.relationships
        }
      });
      break;
    }

    // 9. Room Moderation (Owner / Admin)
    case 'ROOM_MODERATION': {
      const { roomId, action, operatorId, targetUserId } = payload;
      const room = db.rooms.find(r => r.id === roomId);
      const operator = db.users.find(u => u.id === operatorId);
      const target = db.users.find(u => u.id === targetUserId);

      if (!room || !operator || !target) return;

      const isOwner = room.ownerId === operator.id || operator.role === 'master';
      const isAdmin = (room.admins || []).includes(operator.id) || isOwner;

      if (!isAdmin) {
        sendToClient(client, { type: 'ERROR', payload: { message: 'අවසර නැත (Admin only).' } });
        return;
      }

      room.admins = room.admins || [];
      room.banned24h = room.banned24h || {};
      room.permanentBanned = room.permanentBanned || [];
      room.blocked = room.blocked || [];

      if (action === 'ASSIGN_ADMIN') {
        if (!isOwner) return;
        if (room.admins.length >= 100) {
          sendToClient(client, { type: 'ERROR', payload: { message: 'උපරිම Admin සංඛ්‍යාව 100 කි.' } });
          return;
        }
        if (!room.admins.includes(target.id)) {
          room.admins.push(target.id);
          saveDB();
          broadcast({ type: 'ROOM_UPDATED', payload: { room } });
          broadcast({ type: 'NEW_CHAT_MESSAGE', payload: { roomId: room.id, senderName: 'System', text: `🛡️ ${target.name} හට Room Admin තනතුර ලබාදෙන ලදී!` } });
        }
      } else if (action === 'REMOVE_ADMIN') {
        if (!isOwner) return;
        room.admins = room.admins.filter(id => id !== target.id);
        saveDB();
        broadcast({ type: 'ROOM_UPDATED', payload: { room } });
      } else if (action === 'FORCE_MUTE') {
        const seat = room.seats.find(s => s.userId === target.id);
        if (seat) {
          seat.isMuted = true;
          saveDB();
          broadcast({ type: 'ROOM_UPDATED', payload: { room } });
        }
      } else if (action === 'KICK_24H') {
        room.banned24h[target.id] = Date.now() + 24 * 60 * 60 * 1000;
        room.seats.forEach(s => {
          if (s.userId === target.id) {
            s.userId = null; s.userName = null; s.avatar = null; s.phone = null;
          }
        });
        room.audience = room.audience.filter(a => a.id !== target.id);
        saveDB();
        broadcast({ type: 'ROOM_UPDATED', payload: { room } });
        broadcast({ type: 'USER_KICKED', payload: { roomId: room.id, userId: target.id, message: 'ඔබව පැය 24 කට මෙම Voice Room එකෙන් ඉවත් කරන ලදී.' } });
      } else if (action === 'BAN_PERMANENT') {
        if (!room.permanentBanned.includes(target.id)) room.permanentBanned.push(target.id);
        room.seats.forEach(s => {
          if (s.userId === target.id) {
            s.userId = null; s.userName = null; s.avatar = null; s.phone = null;
          }
        });
        room.audience = room.audience.filter(a => a.id !== target.id);
        saveDB();
        broadcast({ type: 'ROOM_UPDATED', payload: { room } });
        broadcast({ type: 'USER_KICKED', payload: { roomId: room.id, userId: target.id, message: 'ඔබව මෙම Voice Room එකෙන් ස්ථීරවම ඉවත් කරන ලදී.' } });
      } else if (action === 'BLOCK_MEMBER') {
        if (!room.blocked.includes(target.id)) room.blocked.push(target.id);
        room.seats.forEach(s => {
          if (s.userId === target.id) {
            s.userId = null; s.userName = null; s.avatar = null; s.phone = null;
          }
        });
        saveDB();
        broadcast({ type: 'ROOM_UPDATED', payload: { room } });
      }
      break;
    }

    // 10. Live Chat
    case 'CHAT_MESSAGE': {
      const room = db.rooms.find(r => r.id === payload.roomId);
      if (room) {
        broadcast({
          type: 'NEW_CHAT_MESSAGE',
          payload: {
            roomId: room.id,
            senderId: payload.senderId,
            senderName: payload.senderName,
            text: payload.text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        });
      }
      break;
    }
  }
}

// HTTP REST Server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');

    // 1. User Login / Signup (1 Phone = 1 Account, starts with 0 Diamonds!)
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { phone, name } = JSON.parse(body);
          if (!phone) {
            res.writeHead(400); res.end(JSON.stringify({ error: 'දුරකථන අංකය ඇතුළත් කරන්න.' })); return;
          }

          const cleanPhone = phone.trim().replace(/\s+/g, '');
          let user = db.users.find(u => u.phone === cleanPhone);

          if (!user) {
            // New account starts with exactly 0 diamonds!
            user = {
              id: 'USR-' + (Date.now().toString().slice(-6)),
              phone: cleanPhone,
              name: name ? name.trim() : 'Member',
              avatar: '👤',
              bio: '',
              diamonds: 0,
              beans: 0,
              role: 'user',
              createdAt: new Date().toISOString().split('T')[0]
            };
            db.users.push(user);
            saveDB();
          } else if (name && name.trim()) {
            user.name = name.trim();
            saveDB();
          }

          const seller = db.sellers.find(s => s.phone === cleanPhone);

          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            user,
            isSeller: !!seller,
            sellerInfo: seller || null
          }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 2. Master Login (Used by MasterAdmin.exe)
    if (req.method === 'POST' && pathname === '/api/auth/master-login') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { masterKey } = JSON.parse(body);
          if (masterKey !== MASTER_KEY) {
            res.writeHead(403); res.end(JSON.stringify({ error: 'අවලංගු Master Key එකකි.' })); return;
          }

          let masterUser = db.users.find(u => u.role === 'master');
          if (!masterUser) {
            masterUser = {
              id: 'USR-MASTER',
              phone: MASTER_PHONE,
              name: 'Master Owner 👑',
              avatar: '👑',
              bio: 'Official App Owner & Master Administrator',
              diamonds: 999999999,
              beans: 999999999,
              role: 'master',
              createdAt: '2026-10-04'
            };
            db.users.push(masterUser);
            saveDB();
          }

          res.writeHead(200);
          res.end(JSON.stringify({ success: true, user: masterUser, isMaster: true }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 3. Update Voice Club Title (Owner can update anytime!)
    if (req.method === 'POST' && pathname === '/api/rooms/update-title') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { roomId, title, userId } = JSON.parse(body);
          const room = db.rooms.find(r => r.id === roomId);
          if (!room) {
            res.writeHead(404); res.end(JSON.stringify({ error: 'Room not found' })); return;
          }

          room.title = title ? title.trim() : room.title;
          saveDB();

          broadcast({ type: 'ROOM_UPDATED', payload: { room } });

          res.writeHead(200);
          res.end(JSON.stringify({ success: true, room }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 4. Activate Intimacy Hand (100 Pts) or Heart (5000 Pts + 500 Diamonds)
    if (req.method === 'POST' && pathname === '/api/rooms/activate-intimacy-link') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { roomId, user1Id, user2Id, type } = JSON.parse(body);
          const room = db.rooms.find(r => r.id === roomId);
          const u1 = db.users.find(u => u.id === user1Id);
          const u2 = db.users.find(u => u.id === user2Id);

          if (!room || !u1 || !u2) {
            res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid room or users' })); return;
          }

          let rel = db.relationships.find(r =>
            (r.user1Id === user1Id && r.user2Id === user2Id) ||
            (r.user1Id === user2Id && r.user2Id === user1Id)
          );

          if (!rel) {
            res.writeHead(400); res.end(JSON.stringify({ error: 'No relationship found between users' })); return;
          }

          if (type === 'HAND') {
            if (rel.intimacyPoints < 100) {
              res.writeHead(400); res.end(JSON.stringify({ error: 'අතට අත දීම සක්‍රීය කිරීමට Intimacy 100 ක් අවශ්‍ය වේ.' })); return;
            }
            rel.hasHandLink = true;
          } else if (type === 'HEART') {
            if (rel.intimacyPoints < 5000) {
              res.writeHead(400); res.end(JSON.stringify({ error: 'Heart සක්‍රීය කිරීමට Intimacy 5,000 ක් අවශ්‍ය වේ.' })); return;
            }
            if (u1.diamonds < 500 && u1.role !== 'master') {
              res.writeHead(400); res.end(JSON.stringify({ error: 'Heart දැමීමට Diamonds 500 ක් අවශ්‍ය වේ.' })); return;
            }
            if (u1.role !== 'master') {
              u1.diamonds -= 500;
            }
            rel.hasHeartLink = true;
          }

          room.activeIntimacyLinks = room.activeIntimacyLinks || [];
          room.activeIntimacyLinks.push({ user1Id, user2Id, type });

          saveDB();
          broadcast({ type: 'ROOM_UPDATED', payload: { room } });
          broadcast({ type: 'ALL_DATA_SYNC', payload: db });

          res.writeHead(200);
          res.end(JSON.stringify({ success: true, relationship: rel, user: u1 }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 5. Profile Update (Name, Avatar, Bio)
    if (req.method === 'POST' && pathname === '/api/user/profile-update') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { userId, name, avatar, bio } = JSON.parse(body);
          const user = db.users.find(u => u.id === userId);
          if (!user) {
            res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return;
          }
          if (name) user.name = name.trim();
          if (avatar) user.avatar = avatar.trim();
          if (bio !== undefined) user.bio = bio.trim();

          db.rooms.forEach(r => {
            r.seats.forEach(s => {
              if (s.userId === user.id) {
                s.userName = user.name; s.avatar = user.avatar;
              }
            });
          });

          saveDB();
          broadcast({ type: 'ALL_DATA_SYNC', payload: db });

          res.writeHead(200);
          res.end(JSON.stringify({ success: true, user }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 6. Master APIs (Used by MasterAdmin.exe)
    if (req.method === 'POST' && pathname === '/api/master/topup-user') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { targetPhone, amount } = JSON.parse(body);
          const cleanPhone = targetPhone.trim().replace(/\s+/g, '');
          let user = db.users.find(u => u.phone === cleanPhone);

          if (!user) {
            user = {
              id: 'USR-' + (Date.now().toString().slice(-6)),
              phone: cleanPhone,
              name: 'Member ' + cleanPhone.slice(-4),
              avatar: '👤',
              bio: '',
              diamonds: 0,
              beans: 0,
              role: 'user',
              createdAt: new Date().toISOString().split('T')[0]
            };
            db.users.push(user);
          }

          const diamonds = parseInt(amount, 10);
          user.diamonds += diamonds;

          saveDB();

          broadcast({
            type: 'DIAMOND_RECHARGE_COMPLETED',
            payload: { userId: user.id, newBalance: user.diamonds, added: diamonds }
          });

          res.writeHead(200);
          res.end(JSON.stringify({ success: true, user, message: `Diamonds ${diamonds} topup completed to ${user.phone}` }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/master/sellers/add') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { phone, name, storeName, city, whatsapp, initialStock } = JSON.parse(body);
          const cleanPhone = phone.trim().replace(/\s+/g, '');

          const newSeller = {
            id: 'SEL-' + (100 + db.sellers.length + 1),
            phone: cleanPhone,
            name: name || 'Seller',
            storeName: storeName || 'Diamond Shop',
            city: city || 'Sri Lanka',
            whatsapp: whatsapp || cleanPhone,
            diamondsStock: parseInt(initialStock || 5000, 10),
            totalSold: 0,
            totalProfitLKR: 0,
            isVerified: true,
            joinedAt: new Date().toISOString().split('T')[0]
          };

          db.sellers.push(newSeller);
          saveDB();
          broadcast({ type: 'ALL_DATA_SYNC', payload: db });

          res.writeHead(201);
          res.end(JSON.stringify({ success: true, seller: newSeller }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/master/sellers/delete') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { sellerId } = JSON.parse(body);
          db.sellers = db.sellers.filter(s => s.id !== sellerId);
          saveDB();
          broadcast({ type: 'ALL_DATA_SYNC', payload: db });
          res.writeHead(200); res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/master/sellers/transfer') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { sellerId, amount } = JSON.parse(body);
          const seller = db.sellers.find(s => s.id === sellerId);
          if (seller) {
            seller.diamondsStock += parseInt(amount, 10);
            saveDB();
          }
          res.writeHead(200); res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 7. Seller: Topup Member by Mobile Number (Instant Push Delivery)
    if (req.method === 'POST' && pathname === '/api/seller/topup-member') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { sellerPhone, targetMemberPhone, amount } = JSON.parse(body);
          const cleanSellerPhone = sellerPhone.trim().replace(/\s+/g, '');
          const cleanMemberPhone = targetMemberPhone.trim().replace(/\s+/g, '');

          const seller = db.sellers.find(s => s.phone === cleanSellerPhone);
          if (!seller) {
            res.writeHead(403); res.end(JSON.stringify({ error: 'අවලංගු Seller දුරකථන අංකයකි.' })); return;
          }

          const diamonds = parseInt(amount, 10);
          if (diamonds <= 0 || seller.diamondsStock < diamonds) {
            res.writeHead(400); res.end(JSON.stringify({ error: `තොගය ප්‍රමාණවත් නොවේ! (Stock: ${seller.diamondsStock})` })); return;
          }

          let member = db.users.find(u => u.phone === cleanMemberPhone);
          if (!member) {
            member = {
              id: 'USR-' + (Date.now().toString().slice(-6)),
              phone: cleanMemberPhone,
              name: 'Member ' + cleanMemberPhone.slice(-4),
              avatar: '👤',
              bio: '',
              diamonds: 0,
              beans: 0,
              role: 'user',
              createdAt: new Date().toISOString().split('T')[0]
            };
            db.users.push(member);
          }

          seller.diamondsStock -= diamonds;
          seller.totalSold += diamonds;
          seller.totalProfitLKR += (diamonds * 1.00);

          member.diamonds += diamonds;

          const txn = {
            id: 'TXN-' + Date.now().toString().slice(-6),
            sellerPhone: seller.phone,
            sellerName: seller.name,
            targetPhone: member.phone,
            userName: member.name,
            diamonds,
            date: new Date().toLocaleString()
          };
          db.transactions = db.transactions || [];
          db.transactions.unshift(txn);
          saveDB();

          // INSTANT REAL-TIME BALANCE PUSH
          broadcast({
            type: 'DIAMOND_RECHARGE_COMPLETED',
            payload: { userId: member.id, newBalance: member.diamonds, added: diamonds }
          });

          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            newStock: seller.diamondsStock,
            memberNewBalance: member.diamonds,
            message: `සාර්ථකයි! Diamonds ${diamonds} ක් ${member.phone} (${member.name}) වෙත ක්ෂණිකව බැර විය!`
          }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 8. Public Data Sync (Prices and profit formulas hidden)
    if (req.method === 'GET' && pathname === '/api/data') {
      // Create clean public view of sellers (hiding cost/profits)
      const publicSellers = db.sellers.map(s => ({
        id: s.id,
        name: s.name,
        storeName: s.storeName,
        phone: s.phone,
        city: s.city,
        whatsapp: s.whatsapp,
        diamondsStock: s.diamondsStock,
        totalSold: s.totalSold,
        totalProfitLKR: s.totalProfitLKR, // visible to seller only in their own view
        isVerified: s.isVerified
      }));

      res.writeHead(200);
      res.end(JSON.stringify({
        users: db.users,
        sellers: publicSellers,
        rooms: db.rooms,
        relationships: db.relationships,
        friendships: db.friendships
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
    return;
  }

  // Static files
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const extname = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.apk': 'application/vnd.android.package-archive',
    '.exe': 'application/octet-stream'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'public', 'index.html'), (err2, fallback) => {
          if (err2) {
            res.writeHead(404); res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fallback, 'utf-8');
          }
        });
      } else {
        res.writeHead(500); res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[extname] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(content);
    }
  });
});

server.on('upgrade', (req, socket, head) => {
  const upgradeHeader = req.headers['upgrade'];
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    socket.destroy(); return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy(); return;
  }
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];
  socket.write(responseHeaders.join('\r\n'));
  handleWebSocketConnection(socket, req);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Phoenix Voice Club Engine (10 Seats, Intimacy & Gifts) Started on Port ${PORT}`);
  console.log(`👑 Master App: Standalone PhoenixVoiceClub.exe Available`);
  console.log(`=======================================================`);
});
