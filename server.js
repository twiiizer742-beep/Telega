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
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'audio/webm', 'audio/wav', 'audio/mpeg', 'audio/ogg',
      'video/mp4', 'video/webm'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

app.use(express.static(__dirname));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    url: fileUrl,
    type: req.file.mimetype,
    name: req.file.originalname,
    size: req.file.size
  });
});

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/'
});

app.use('/peerjs', peerServer);

// Enhanced data stores
const users = new Map(); // userId -> user object
const messages = new Map(); // channelId -> messages array
const groups = new Map(); // groupId -> group object
const friendRequests = new Map(); // userId -> [requests]
const userPasswords = new Map(); // userId -> password hash (simple for demo)

// Socket.io
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // User registration with password
  socket.on('register', (userData) => {
    const { username, password, avatar } = userData;
    
    // Check if username exists
    let existingUser = null;
    for (let [id, user] of users) {
      if (user.username === username) {
        existingUser = user;
        break;
      }
    }
    
    if (existingUser) {
      // Login attempt
      if (userPasswords.get(existingUser.id) === password) {
        existingUser.online = true;
        existingUser.socketId = socket.id;
        
        // Transfer data to new socket
        const oldId = existingUser.id;
        users.delete(oldId);
        users.set(socket.id, existingUser);
        existingUser.id = socket.id;
        
        socket.userId = socket.id;
        socket.emit('registered', existingUser);
        socket.emit('loadMessages', getAllUserMessages(existingUser.username));
        broadcastUsersList();
        socket.broadcast.emit('userOnline', existingUser);
      } else {
        socket.emit('loginError', 'Неверный пароль');
      }
      return;
    }
    
    // New registration
    const user = {
      id: socket.id,
      username: username,
      avatar: avatar || username[0].toUpperCase(),
      online: true,
      socketId: socket.id,
      lastSeen: Date.now()
    };
    
    users.set(socket.id, user);
    userPasswords.set(socket.id, password);
    socket.userId = socket.id;
    
    socket.emit('registered', user);
    broadcastUsersList();
    socket.broadcast.emit('userOnline', user);
  });

  // Friend request
  socket.on('sendFriendRequest', (data) => {
    const { toUserId } = data;
    const fromUser = users.get(socket.id);
    
    if (!fromUser || !users.has(toUserId)) return;
    
    if (!friendRequests.has(toUserId)) {
      friendRequests.set(toUserId, []);
    }
    
    // Check if already sent
    const existing = friendRequests.get(toUserId).find(r => r.from === socket.id);
    if (existing) return;
    
    friendRequests.get(toUserId).push({
      from: socket.id,
      fromUsername: fromUser.username,
      timestamp: Date.now()
    });
    
    io.to(toUserId).emit('newFriendRequest', {
      from: socket.id,
      fromUsername: fromUser.username
    });
    
    socket.emit('friendRequestSent', { toUserId });
  });

  // Accept friend request
  socket.on('acceptFriendRequest', (data) => {
    const { fromUserId } = data;
    const user = users.get(socket.id);
    const fromUser = users.get(fromUserId);
    
    if (!user || !fromUser) return;
    
    // Add to friends list
    if (!user.friends) user.friends = [];
    if (!fromUser.friends) fromUser.friends = [];
    
    user.friends.push(fromUserId);
    fromUser.friends.push(socket.id);
    
    // Remove request
    if (friendRequests.has(socket.id)) {
      friendRequests.set(socket.id, friendRequests.get(socket.id).filter(r => r.from !== fromUserId));
    }
    
    io.to(socket.id).emit('friendAdded', fromUser);
    io.to(fromUserId).emit('friendAdded', user);
  });

  // Private message with read receipts
  socket.on('privateMessage', (data) => {
    const { to, message, type = 'text', fileUrl, fileName } = data;
    const fromUser = users.get(socket.id);
    
    if (!fromUser || !to) return;
    
    const messageData = {
      id: uuidv4(),
      from: socket.id,
      fromUsername: fromUser.username,
      to: to,
      message,
      type,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      timestamp: Date.now(),
      status: 'sent', // sent, delivered, read
      statusHistory: [{
        status: 'sent',
        timestamp: Date.now()
      }]
    };
    
    const channelId = getPrivateChannelId(socket.id, to);
    if (!messages.has(channelId)) {
      messages.set(channelId, []);
    }
    messages.get(channelId).push(messageData);
    
    io.to(to).emit('privateMessage', messageData);
    socket.emit('privateMessage', messageData);
  });

  // Message delivered
  socket.on('messageDelivered', (data) => {
    const { messageId, from } = data;
    io.to(from).emit('messageStatusUpdate', {
      messageId,
      status: 'delivered',
      timestamp: Date.now()
    });
  });

  // Message read
  socket.on('messageRead', (data) => {
    const { messageId, from } = data;
    io.to(from).emit('messageStatusUpdate', {
      messageId,
      status: 'read',
      timestamp: Date.now()
    });
  });

  // Create group
  socket.on('createGroup', (data) => {
    const groupId = uuidv4();
    const user = users.get(socket.id);
    
    if (!user) return;
    
    const group = {
      id: groupId,
      name: data.name || 'New Group',
      avatar: data.avatar || '👥',
      members: [socket.id, ...(data.members || [])],
      admins: [socket.id],
      createdBy: socket.id,
      createdAt: Date.now()
    };
    
    groups.set(groupId, group);
    
    group.members.forEach(memberId => {
      io.to(memberId).emit('groupCreated', group);
    });
  });

  // Group message
  socket.on('groupMessage', (data) => {
    const { groupId, message, type = 'text', fileUrl, fileName } = data;
    const fromUser = users.get(socket.id);
    const group = groups.get(groupId);
    
    if (!fromUser || !group || !group.members.includes(socket.id)) return;
    
    const messageData = {
      id: uuidv4(),
      from: socket.id,
      fromUsername: fromUser.username,
      groupId,
      message,
      type,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      timestamp: Date.now(),
      status: 'sent'
    };
    
    if (!messages.has(groupId)) {
      messages.set(groupId, []);
    }
    messages.get(groupId).push(messageData);
    
    group.members.forEach(memberId => {
      if (memberId !== socket.id) {
        io.to(memberId).emit('groupMessage', messageData);
      }
    });
    socket.emit('groupMessage', messageData);
  });

  // Get messages
  socket.on('getMessages', (data) => {
    const { channelId } = data;
    const channelMessages = messages.get(channelId) || [];
    socket.emit('messageHistory', { channelId, messages: channelMessages });
  });

  // Typing indicator
  socket.on('typing', (data) => {
    const { to, isTyping } = data;
    io.to(to).emit('userTyping', {
      from: socket.id,
      username: users.get(socket.id)?.username,
      isTyping
    });
  });

  // WebRTC signaling
  socket.on('callUser', (data) => {
    io.to(data.userToCall).emit('callUser', {
      signal: data.signalData,
      from: socket.id,
      username: users.get(socket.id)?.username
    });
  });

  socket.on('answerCall', (data) => {
    io.to(data.to).emit('callAccepted', data.signal);
  });

  socket.on('endCall', (data) => {
    io.to(data.to).emit('callEnded');
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const user = users.get(socket.id);
    if (user) {
      user.online = false;
      user.lastSeen = Date.now();
      broadcastUsersList();
      socket.broadcast.emit('userOffline', { userId: socket.id, lastSeen: user.lastSeen });
    }
  });
});

// Helper functions
function getPrivateChannelId(user1, user2) {
  return [user1, user2].sort().join('-');
}

function broadcastUsersList() {
  const usersList = Array.from(users.values()).map(u => ({
    id: u.id,
    username: u.username,
    avatar: u.avatar,
    online: u.online,
    lastSeen: u.lastSeen
  }));
  io.emit('usersList', usersList);
}

function getAllUserMessages(username) {
  const userMessages = [];
  for (let [channelId, msgs] of messages) {
    msgs.forEach(msg => {
      if (msg.fromUsername === username || msg.to === username) {
        userMessages.push(msg);
      }
    });
  }
  return userMessages;
}

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
