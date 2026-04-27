const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve ALL static files from current directory
app.use(express.static(__dirname));

// Main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Users storage
const users = new Map();
const messages = [];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Send current users list
  socket.emit('usersList', Array.from(users.values()));

  socket.on('register', (data) => {
    const user = {
      id: socket.id,
      username: data.username,
      online: true
    };
    users.set(socket.id, user);
    
    // Send back user data
    socket.emit('registered', user);
    
    // Notify everyone about new user
    socket.broadcast.emit('userJoined', user);
    io.emit('usersList', Array.from(users.values()));
  });

  socket.on('privateMessage', (data) => {
    const messageData = {
      id: Date.now().toString(),
      from: socket.id,
      fromUsername: users.get(socket.id)?.username || 'Unknown',
      message: data.message,
      timestamp: Date.now()
    };
    
    // Send to recipient
    io.to(data.to).emit('privateMessage', messageData);
    // Send back to sender
    socket.emit('privateMessage', messageData);
  });

  socket.on('sendFriendRequest', (data) => {
    io.to(data.toUserId).emit('newFriendRequest', {
      from: socket.id,
      fromUsername: users.get(socket.id)?.username
    });
  });

  socket.on('acceptFriendRequest', (data) => {
    const fromUser = users.get(data.fromUserId);
    const currentUser = users.get(socket.id);
    
    if (fromUser && currentUser) {
      io.to(data.fromUserId).emit('friendAdded', currentUser);
      socket.emit('friendAdded', fromUser);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    users.delete(socket.id);
    io.emit('usersList', Array.from(users.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
