const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { ExpressPeerServer } = require('peer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Static files
app.use(express.static(__dirname));

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}`, type: req.file.mimetype, name: req.file.originalname });
});

// PeerJS
const peerServer = ExpressPeerServer(server, { debug: false, path: '/' });
app.use('/peerjs', peerServer);

// Data stores
const users = new Map();
const groups = new Map();
const messages = new Map();
const friendRequests = new Map();
const userPasswords = new Map();

io.on('connection', (socket) => {
  console.log('✅ Connected:', socket.id);

  // REGISTER / LOGIN
  socket.on('register', (data) => {
    const { username, password, avatar } = data;
    let existingUser = null;
    
    for (let [id, user] of users) {
      if (user.username === username) { existingUser = user; break; }
    }
    
    if (existingUser) {
      if (userPasswords.get(existingUser.id) === password) {
        existingUser.online = true;
        existingUser.socketId = socket.id;
        users.delete(existingUser.id);
        existingUser.id = socket.id;
        users.set(socket.id, existingUser);
        socket.userId = socket.id;
        socket.emit('registered', existingUser);
        broadcastUsersList();
        console.log('✅ Login:', username);
      } else {
        socket.emit('loginError', 'Неверный пароль');
      }
      return;
    }
    
    const user = {
      id: socket.id,
      username,
      avatar: avatar || username[0].toUpperCase(),
      online: true,
      socketId: socket.id,
      friends: []
    };
    
    users.set(socket.id, user);
    userPasswords.set(socket.id, password);
    socket.userId = socket.id;
    socket.emit('registered', user);
    broadcastUsersList();
    console.log('✅ New user:', username);
  });

  // FRIEND REQUESTS
  socket.on('sendFriendRequest', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser || !users.has(data.toUserId)) return;
    
    if (!friendRequests.has(data.toUserId)) friendRequests.set(data.toUserId, []);
    
    const existing = friendRequests.get(data.toUserId).find(r => r.from === socket.id);
    if (existing) return;
    
    friendRequests.get(data.toUserId).push({ from: socket.id, fromUsername: fromUser.username, timestamp: Date.now() });
    io.to(data.toUserId).emit('newFriendRequest', { from: socket.id, fromUsername: fromUser.username });
    socket.emit('friendRequestSent', { toUserId: data.toUserId });
  });

  socket.on('acceptFriendRequest', (data) => {
    const user = users.get(socket.id);
    const fromUser = users.get(data.fromUserId);
    if (!user || !fromUser) return;
    
    if (!user.friends) user.friends = [];
    if (!fromUser.friends) fromUser.friends = [];
    
    user.friends.push(data.fromUserId);
    fromUser.friends.push(socket.id);
    
    if (friendRequests.has(socket.id)) {
      friendRequests.set(socket.id, friendRequests.get(socket.id).filter(r => r.from !== data.fromUserId));
    }
    
    io.to(socket.id).emit('friendAdded', fromUser);
    io.to(data.fromUserId).emit('friendAdded', user);
    broadcastUsersList();
  });

  // PRIVATE MESSAGES
  socket.on('privateMessage', (data) => {
    const { to, message, type = 'text', fileUrl, fileName } = data;
    const fromUser = users.get(socket.id);
    if (!fromUser || !to) return;
    
    const msgData = {
      id: uuidv4(),
      from: socket.id,
      fromUsername: fromUser.username,
      to, message, type,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      timestamp: Date.now(),
      status: 'sent'
    };
    
    const channelId = [socket.id, to].sort().join('-');
    if (!messages.has(channelId)) messages.set(channelId, []);
    messages.get(channelId).push(msgData);
    
    io.to(to).emit('privateMessage', msgData);
    socket.emit('privateMessage', msgData);
  });

  // MESSAGE STATUS
  socket.on('messageDelivered', (data) => {
    io.to(data.from).emit('messageStatusUpdate', { messageId: data.messageId, status: 'delivered' });
  });

  socket.on('messageRead', (data) => {
    io.to(data.from).emit('messageStatusUpdate', { messageId: data.messageId, status: 'read' });
  });

  // GROUP CHAT
  socket.on('createGroup', (data) => {
    const groupId = uuidv4();
    const user = users.get(socket.id);
    if (!user) return;
    
    const group = {
      id: groupId,
      name: data.name || 'New Group',
      avatar: '👥',
      members: [socket.id, ...(data.members || [])],
      createdBy: socket.id,
      createdAt: Date.now()
    };
    
    groups.set(groupId, group);
    group.members.forEach(memberId => {
      io.to(memberId).emit('groupCreated', group);
    });
  });

  socket.on('groupMessage', (data) => {
    const { groupId, message, type = 'text', fileUrl, fileName } = data;
    const fromUser = users.get(socket.id);
    const group = groups.get(groupId);
    if (!fromUser || !group || !group.members.includes(socket.id)) return;
    
    const msgData = {
      id: uuidv4(),
      from: socket.id,
      fromUsername: fromUser.username,
      groupId, message, type,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      timestamp: Date.now()
    };
    
    if (!messages.has(groupId)) messages.set(groupId, []);
    messages.get(groupId).push(msgData);
    
    group.members.forEach(memberId => {
      if (memberId !== socket.id) io.to(memberId).emit('groupMessage', msgData);
    });
    socket.emit('groupMessage', msgData);
  });

  // GET MESSAGES
  socket.on('getMessages', (data) => {
    const msgs = messages.get(data.channelId) || [];
    socket.emit('messageHistory', { channelId: data.channelId, messages: msgs });
  });

  // TYPING
  socket.on('typing', (data) => {
    io.to(data.to).emit('userTyping', { from: socket.id, username: users.get(socket.id)?.username, isTyping: data.isTyping });
  });

  // CALLS
  socket.on('callUser', (data) => {
    io.to(data.userToCall).emit('callUser', { signal: data.signalData, from: socket.id, username: users.get(socket.id)?.username });
  });

  socket.on('answerCall', (data) => {
    io.to(data.to).emit('callAccepted', data.signal);
  });

  socket.on('endCall', (data) => {
    io.to(data.to).emit('callEnded');
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', socket.id);
    const user = users.get(socket.id);
    if (user) {
      user.online = false;
      user.lastSeen = Date.now();
      broadcastUsersList();
      socket.broadcast.emit('userOffline', { userId: socket.id, lastSeen: user.lastSeen });
    }
  });
});

function broadcastUsersList() {
  const list = Array.from(users.values()).map(u => ({
    id: u.id, username: u.username, avatar: u.avatar, online: u.online, lastSeen: u.lastSeen, friends: u.friends
  }));
  io.emit('usersList', list);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
