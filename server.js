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

// Serve static files - ИСПРАВЛЕНО: теперь ищет файлы в корне
app.use(express.static(__dirname));

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
const users = new Map();
const groups = new Map();
const messages = new Map();

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

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
    
    socket.emit('registered', user);
    broadcastUsersList();
    socket.broadcast.emit('userJoined', user);
  });

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
    
    const channelId = getPrivateChannelId(socket.id, to);
    if (!messages.has(channelId)) {
      messages.set(channelId, []);
    }
    messages.get(channelId).push(messageData);
    
    io.to(to).emit('privateMessage', messageData);
    socket.emit('privateMessage', messageData);
  });

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
    
    group.members.forEach(memberId => {
      io.to(memberId).emit('groupCreated', group);
    });
    
    socket.emit('groupCreated', group);
  });

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
    
    if (!messages.has(groupId)) {
      messages.set(groupId, []);
    }
    messages.get(groupId).push(messageData);
    
    group.members.forEach(memberId => {
      io.to(memberId).emit('groupMessage', messageData);
    });
  });

  socket.on('getMessages', (data) => {
    const { channelId } = data;
    const channelMessages = messages.get(channelId) || [];
    socket.emit('messageHistory', { channelId, messages: channelMessages });
  });

  socket.on('voiceMessage', (data) => {
    const { to, audioBlob } = data;
    io.to(to).emit('voiceMessage', {
      from: socket.id,
      audioBlob,
      timestamp: Date.now()
    });
  });

  socket.on('typing', (data) => {
    const { to, isTyping } = data;
    io.to(to).emit('userTyping', {
      from: socket.id,
      isTyping
    });
  });

  socket.on('callUser', (data) => {
    const { userToCall, signalData, from } = data;
    io.to(userToCall).emit('callUser', {
      signal: signalData,
      from,
    });
  });

  socket.on('answerCall', (data) => {
    const { to, signal } = data;
    io.to(to).emit('callAccepted', signal);
  });

  socket.on('endCall', (data) => {
    const { to } = data;
    io.to(to).emit('callEnded');
  });

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

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`PeerJS server running on /peerjs`);
});
