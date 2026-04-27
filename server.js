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

// Настройка Socket.io
const io = socketIO(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000
});

// Хранилище файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Статические файлы
app.use(express.static(__dirname));

// Загрузка файлов
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
});

// PeerJS
const peerServer = ExpressPeerServer(server, { debug: false, path: '/' });
app.use('/peerjs', peerServer);

// Хранилище данных
const users = new Map();
const messages = new Map();
const groups = new Map();
const friendRequests = new Map();
const passwords = new Map();

// Socket.io обработчики
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id.substring(0, 8));

  // РЕГИСТРАЦИЯ / ВХОД
  socket.on('register', (data) => {
    const { username, password, avatar } = data;
    
    // Ищем существующего пользователя
    let existingUser = null;
    for (let [id, user] of users) {
      if (user.username === username) {
        existingUser = user;
        break;
      }
    }

    if (existingUser) {
      // Вход
      if (passwords.get(existingUser.id) === password) {
        existingUser.online = true;
        existingUser.socketId = socket.id;
        users.delete(existingUser.id);
        existingUser.id = socket.id;
        users.set(socket.id, existingUser);
        socket.userId = socket.id;
        
        socket.emit('registered', existingUser);
        broadcastUsers();
        console.log('🔑 Login:', username);
      } else {
        socket.emit('loginError', 'Неверный пароль');
      }
      return;
    }

    // Регистрация
    const user = {
      id: socket.id,
      username,
      avatar: avatar || username[0].toUpperCase(),
      online: true,
      socketId: socket.id,
      friends: []
    };

    users.set(socket.id, user);
    passwords.set(socket.id, password);
    socket.userId = socket.id;
    
    socket.emit('registered', user);
    broadcastUsers();
    console.log('🆕 New user:', username);
  });

  // ЛИЧНЫЕ СООБЩЕНИЯ
  socket.on('privateMessage', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser || !data.to) return;

    const msg = {
      id: uuidv4(),
      from: socket.id,
      fromUsername: fromUser.username,
      to: data.to,
      message: data.message || '',
      type: data.type || 'text',
      fileUrl: data.fileUrl || null,
      timestamp: Date.now(),
      status: 'sent'
    };

    const channelId = [socket.id, data.to].sort().join('-');
    if (!messages.has(channelId)) messages.set(channelId, []);
    messages.get(channelId).push(msg);

    io.to(data.to).emit('privateMessage', msg);
    socket.emit('privateMessage', msg);
  });

  // СТАТУСЫ СООБЩЕНИЙ
  socket.on('messageDelivered', (data) => {
    io.to(data.from).emit('messageStatusUpdate', { messageId: data.messageId, status: 'delivered' });
  });

  socket.on('messageRead', (data) => {
    io.to(data.from).emit('messageStatusUpdate', { messageId: data.messageId, status: 'read' });
  });

  // ЗАЯВКИ В ДРУЗЬЯ
  socket.on('sendFriendRequest', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser || !users.has(data.toUserId)) return;

    if (!friendRequests.has(data.toUserId)) friendRequests.set(data.toUserId, []);
    
    const exists = friendRequests.get(data.toUserId).find(r => r.from === socket.id);
    if (exists) return;

    friendRequests.get(data.toUserId).push({
      from: socket.id,
      fromUsername: fromUser.username,
      timestamp: Date.now()
    });

    io.to(data.toUserId).emit('newFriendRequest', {
      from: socket.id,
      fromUsername: fromUser.username
    });
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
      friendRequests.set(socket.id, 
        friendRequests.get(socket.id).filter(r => r.from !== data.fromUserId));
    }

    io.to(socket.id).emit('friendAdded', fromUser);
    io.to(data.fromUserId).emit('friendAdded', user);
    broadcastUsers();
  });

  // ГРУППЫ
  socket.on('createGroup', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const group = {
      id: uuidv4(),
      name: data.name || 'New Group',
      avatar: '👥',
      members: [socket.id, ...(data.members || [])],
      createdBy: socket.id,
      createdAt: Date.now()
    };

    groups.set(group.id, group);

    group.members.forEach(memberId => {
      io.to(memberId).emit('groupCreated', group);
    });
  });

  socket.on('groupMessage', (data) => {
    const fromUser = users.get(socket.id);
    const group = groups.get(data.groupId);
    if (!fromUser || !group || !group.members.includes(socket.id)) return;

    const msg = {
      id: uuidv4(),
      from: socket.id,
      fromUsername: fromUser.username,
      groupId: data.groupId,
      message: data.message || '',
      type: data.type || 'text',
      fileUrl: data.fileUrl || null,
      timestamp: Date.now()
    };

    if (!messages.has(data.groupId)) messages.set(data.groupId, []);
    messages.get(data.groupId).push(msg);

    group.members.forEach(memberId => {
      if (memberId !== socket.id) {
        io.to(memberId).emit('groupMessage', msg);
      }
    });
    socket.emit('groupMessage', msg);
  });

  // ИСТОРИЯ СООБЩЕНИЙ
  socket.on('getMessages', (data) => {
    const msgs = messages.get(data.channelId) || [];
    socket.emit('messageHistory', { channelId: data.channelId, messages: msgs });
  });

  // ИНДИКАТОР ПЕЧАТИ
  socket.on('typing', (data) => {
    if (data.to) {
      io.to(data.to).emit('userTyping', {
        from: socket.id,
        username: users.get(socket.id)?.username,
        isTyping: data.isTyping
      });
    }
  });

  // ЗВОНКИ
  socket.on('callUser', (data) => {
    io.to(data.userToCall).emit('incomingCall', {
      from: socket.id,
      username: users.get(socket.id)?.username
    });
  });

  socket.on('endCall', (data) => {
    io.to(data.to).emit('callEnded');
  });

  // ОТКЛЮЧЕНИЕ
  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id.substring(0, 8));
    const user = users.get(socket.id);
    if (user) {
      user.online = false;
      user.lastSeen = Date.now();
      broadcastUsers();
      socket.broadcast.emit('userOffline', { userId: socket.id });
    }
  });
});

// Рассылка списка пользователей
function broadcastUsers() {
  const list = Array.from(users.values()).map(u => ({
    id: u.id,
    username: u.username,
    avatar: u.avatar,
    online: u.online,
    lastSeen: u.lastSeen,
    friends: u.friends
  }));
  io.emit('usersList', list);
}

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('🚀 Server running on port', PORT);
  console.log('📁 Static files:', __dirname);
});
