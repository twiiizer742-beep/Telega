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

// Fix Socket.io for Render
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  pingTimeout: 60000,
  transports: ['websocket', 'polling']
});

// ЯВНО отдаём socket.io клиент
app.get('/socket.io/socket.io.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js'));
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

// Serve static files from root
app.use(express.static(__dirname));
// Also serve node_modules for socket.io client
app.use('/socket.io', express.static(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist')));

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

// Data stores
const users = new Map();
const groups = new Map();
const messages = new Map();
const friendRequests = new Map();
const userPasswords = new Map();

io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  socket.on('register', (userData) => {
    const { username, password, avatar } = userData;
    console.log('Register attempt:', username);
    
    let existingUser = null;
    for (let [id, user] of users) {
      if (user.username === username) {
        existingUser = user;
        break;
      }
    }
    
    if (existingUser) {
      if (userPasswords.get(existingUser.id) === password) {
        existingUser.online = true;
        existingUser.socketId = socket.id;
        existingUser.id = socket.id;
        
        users.delete(existingUser.id);
        users.set(socket.id, existingUser);
        
        socket.userId = socket.id;
        socket.emit('registered', existingUser);
        broadcastUsersList();
        console.log('✅ User logged in:', username);
      } else {
        socket.emit('loginError', 'Неверный пароль');
      }
      return;
    }
    
    const user = {
      id: socket.id,
      username: username,
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
    console.log('✅ New user registered:', username);
  });

  socket.on('sendFriendRequest', (data) => {
    const { toUserId } = data;
    const fromUser = users.get(socket.id);
    if (!fromUser || !users.has(toUserId)) return;
    
    if (!friendRequests.has(toUserId)) {
      friendRequests.set(toUserId, []);
    }
    
    friendRequests.get(toUserId).push({
      from: socket.id,
      fromUsername: fromUser.username,
      timestamp: Date.now()
    });
    
    io.to(toUserId).emit('newFriendRequest', {
      from: socket.id,
      fromUsername: fromUser.username
    });
  });

  socket.on('acceptFriendRequest', (data) => {
    const { fromUserId } = data;
    const user = users.get(socket.id);
    const fromUser = users.get(fromUserId);
    
    if (!user || !fromUser) return;
    
    if (!user.friends) user.friends = [];
    if (!fromUser.friends) fromUser.friends = [];
    
    user.friends.push(fromUserId);
    fromUser.friends.push(socket.id);
    
    if (friendRequests.has(socket.id)) {
      friendRequests.set(socket.id, 
        friendRequests.get(socket.id).filter(r => r.from !== fromUserId));
    }
    
    io.to(socket.id).emit('friendAdded', fromUser);
    io.to(fromUserId).emit('friendAdded', user);
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
    
    console.log('📨 Message from', fromUser.username, 'to', to, ':', message);
    
    const channelId = [socket.id, to].sort().join('-');
    if (!messages.has(channelId)) {
      messages.set(channelId, []);
    }
    messages.get(channelId).push(messageData);
    
    io.to(to).emit('privateMessage', messageData);
    socket.emit('privateMessage', messageData);
  });

  socket.on('getMessages', (data) => {
    const { channelId } = data;
    const channelMessages = messages.get(channelId) || [];
    socket.emit('messageHistory', { channelId, messages: channelMessages });
  });

  socket.on('createGroup', (data) => {
    const groupId = uuidv4();
    const user = users.get(socket.id);
    if (!user) return;
    
    const group = {
      id: groupId,
      name: data.name || 'New Group',
      avatar: '👥',
      members: [socket.id, ...(data.members || [])],
      createdBy: socket.id
    };
    
    groups.set(groupId, group);
    
    group.members.forEach(memberId => {
      io.to(memberId).emit('groupCreated', group);
    });
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
    const user = users.get(socket.id);
    if (user) {
      user.online = false;
      broadcastUsersList();
    }
  });
});

function broadcastUsersList() {
  const usersList = Array.from(users.values()).map(u => ({
    id: u.id,
    username: u.username,
    avatar: u.avatar,
    online: u.online
  }));
  io.emit('usersList', usersList);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
