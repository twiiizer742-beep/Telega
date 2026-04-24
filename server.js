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
    const uploadDir = path.join(__dirname, 'public', 'uploads');
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
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

// Serve static files
app.use(express.static('public'));

// File upload endpoint
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

// PeerJS server for WebRTC
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/'
});

app.use('/peerjs', peerServer);

// In-memory data stores
const users = new Map(); // userId -> { id, username, avatar, online, socketId }
const groups = new Map(); // groupId -> { id, name, avatar, members: [], createdBy }
const messages = new Map(); // channelId -> [messages]

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // User registration/login
  socket.on('register', (userData) => {
    const user = {
      id: socket.id,
      username: userData.username || `User_${socket.id.substr(0, 5)}`,
      avatar: userData.avatar || null,
      online: true,
      socketId: socket.id
    };
    users.set(socket.id, user);
    socket.userId = socket.id;
    
    // Send back user data
    socket.emit('registered', user);
    
    // Broadcast online users list
    broadcastUsersList();
    
    // Notify others about new user
    socket.broadcast.emit('userJoined', user);
  });

  // Private message
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
      timestamp: Date.now()
    };
    
    // Store message
    const channelId = getPrivateChannelId(socket.id, to);
    if (!messages.has(channelId)) {
      messages.set(channelId, []);
    }
    messages.get(channelId).push(messageData);
    
    // Send to recipient
    io.to(to).emit('privateMessage', messageData);
    // Send back to sender for confirmation
    socket.emit('privateMessage', messageData);
  });

  // Group creation
  socket.on('createGroup', (data) => {
    const groupId = uuidv4();
    const user = users.get(socket.id);
    
    if (!user) return;
    
    const group = {
      id: groupId,
      name: data.name || 'New Group',
      avatar: data.avatar || null,
      members: [socket.id, ...(data.members || [])],
      createdBy: socket.id,
      createdAt: Date.now()
    };
    
    groups.set(groupId, group);
    
    // Notify all members
    group.members.forEach(memberId => {
      io.to(memberId).emit('groupCreated', group);
    });
    
    socket.emit('groupCreated', group);
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
      timestamp: Date.now()
    };
    
    // Store message
    if (!messages.has(groupId)) {
      messages.set(groupId, []);
    }
    messages.get(groupId).push(messageData);
    
    // Send to all group members
    group.members.forEach(memberId => {
      io.to(memberId).emit('groupMessage', messageData);
    });
  });

  // Get message history
  socket.on('getMessages', (data) => {
    const { channelId } = data;
    const channelMessages = messages.get(channelId) || [];
    socket.emit('messageHistory', { channelId, messages: channelMessages });
  });

  // Voice message
  socket.on('voiceMessage', (data) => {
    const { to, audioBlob } = data;
    // Handle voice message - in production, save to storage
    io.to(to).emit('voiceMessage', {
      from: socket.id,
      audioBlob,
      timestamp: Date.now()
    });
  });

  // Typing indicator
  socket.on('typing', (data) => {
    const { to, isTyping } = data;
    io.to(to).emit('userTyping', {
      from: socket.id,
      isTyping
    });
  });

  // Call initiation
  socket.on('callUser', (data) => {
    const { userToCall, signalData, from } = data;
    io.to(userToCall).emit('callUser', {
      signal: signalData,
      from,
    });
  });

  // Answer call
  socket.on('answerCall', (data) => {
    const { to, signal } = data;
    io.to(to).emit('callAccepted', signal);
  });

  // End call
  socket.on('endCall', (data) => {
    const { to } = data;
    io.to(to).emit('callEnded');
  });

  // Group call
  socket.on('joinGroupCall', (data) => {
    const { groupId } = data;
    socket.join(`groupCall:${groupId}`);
    socket.to(`groupCall:${groupId}`).emit('userJoinedCall', {
      userId: socket.id,
      username: users.get(socket.id)?.username
    });
  });

  socket.on('leaveGroupCall', (data) => {
    const { groupId } = data;
    socket.leave(`groupCall:${groupId}`);
    socket.to(`groupCall:${groupId}`).emit('userLeftCall', {
      userId: socket.id
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      user.online = false;
      users.delete(socket.id);
      broadcastUsersList();
      socket.broadcast.emit('userLeft', socket.id);
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
    online: u.online
  }));
  io.emit('usersList', usersList);
}

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`PeerJS server running on /peerjs`);
});
