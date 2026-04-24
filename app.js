// Simplified and fixed MessengerApp
class MessengerApp {
    constructor() {
        this.socket = null;
        this.peer = null;
        this.currentUser = null;
        this.currentChat = null;
        this.friends = new Map();
        this.friendRequests = [];
        this.isVoiceRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.callPeer = null;
        this.localStream = null;
        this.isMuted = false;
        
        this.init();
    }

    init() {
        // Connect to Socket.io
        this.socket = io('/', {
            transports: ['websocket', 'polling']
        });

        this.socket.on('connect', () => {
            console.log('Connected to server');
        });

        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            document.getElementById('loginError').textContent = 'Ошибка подключения к серверу';
        });

        this.setupSocketListeners();
        this.setupEventListeners();
        this.createAvatarOptions();
    }

    setupSocketListeners() {
        this.socket.on('registered', (user) => {
            console.log('Registered:', user);
            this.currentUser = user;
            document.getElementById('currentUsername').textContent = user.username;
            document.getElementById('currentUserAvatar').textContent = user.avatar || user.username[0].toUpperCase();
            this.showScreen('chatScreen');
        });

        this.socket.on('loginError', (error) => {
            console.error('Login error:', error);
            document.getElementById('loginError').textContent = error;
        });

        this.socket.on('usersList', (users) => {
            this.updateUsersList(users);
        });

        this.socket.on('privateMessage', (message) => {
            console.log('Received message:', message);
            this.handleIncomingMessage(message);
        });

        this.socket.on('newFriendRequest', (data) => {
            this.friendRequests.push(data);
            this.updateRequestsBadge();
        });

        this.socket.on('friendAdded', (user) => {
            this.friends.set(user.id, true);
            this.addUserToList(user);
        });
    }

    setupEventListeners() {
        // Login button
        document.getElementById('loginButton').addEventListener('click', () => {
            this.login();
        });

        // Enter key on password field
        document.getElementById('passwordInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });

        // Send message button
        document.getElementById('sendMessageBtn').addEventListener('click', () => {
            this.sendMessage();
        });

        // Enter to send message
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // File upload
        document.getElementById('attachBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileUpload(e);
        });

        // Voice recording
        const recordBtn = document.getElementById('recordVoiceBtn');
        recordBtn.addEventListener('mousedown', () => this.startVoiceRecording());
        recordBtn.addEventListener('mouseup', () => this.stopVoiceRecording());

        // Friend requests
        document.getElementById('friendRequestsBtn').addEventListener('click', () => {
            this.showRequestsModal();
        });
        document.getElementById('closeRequestsBtn').addEventListener('click', () => {
            document.getElementById('requestsModal').style.display = 'none';
        });

        // Create group
        document.getElementById('createGroupBtn').addEventListener('click', () => {
            this.showGroupModal();
        });
        document.getElementById('closeGroupBtn').addEventListener('click', () => {
            document.getElementById('groupModal').style.display = 'none';
        });
        document.getElementById('confirmCreateGroup').addEventListener('click', () => {
            this.createGroup();
        });

        // Image viewer
        document.getElementById('closeViewer').addEventListener('click', () => {
            document.getElementById('imageViewer').style.display = 'none';
        });

        // Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });

        // Back button (mobile)
        document.getElementById('backBtn').addEventListener('click', () => {
            this.closeChat();
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.add('open');
            }
        });

        // Sidebar toggle
        document.getElementById('toggleSidebar').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });

        // Click on chat header to close sidebar on mobile
        document.getElementById('mainChat').addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
    }

    createAvatarOptions() {
        const avatars = ['😀', '😎', '🤖', '👽', '🦊', '🐱', '🐶', '🦁', '🐼', '🐨'];
        const grid = document.getElementById('avatarGrid');
        avatars.forEach(avatar => {
            const div = document.createElement('div');
            div.className = 'avatar-option';
            div.textContent = avatar;
            div.addEventListener('click', () => {
                document.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
            });
            grid.appendChild(div);
        });
    }

    login() {
        const username = document.getElementById('usernameInput').value.trim();
        const password = document.getElementById('passwordInput').value.trim();
        const avatar = document.querySelector('.avatar-option.selected')?.textContent;
        
        console.log('Login attempt:', { username, password: '***', avatar });
        
        if (!username || !password) {
            document.getElementById('loginError').textContent = 'Введите имя и пароль';
            return;
        }

        document.getElementById('loginError').textContent = '';
        this.socket.emit('register', { username, password, avatar });
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    }

    updateUsersList(users) {
        const contactsList = document.getElementById('contactsList');
        contactsList.innerHTML = '';
        
        users.forEach(user => {
            if (user.id !== this.currentUser?.id) {
                this.addUserToList(user);
            }
        });
    }

    addUserToList(user) {
        if (user.id === this.currentUser?.id) return;
        
        const contactsList = document.getElementById('contactsList');
        const existingContact = document.getElementById(`contact-${user.id}`);
        
        if (existingContact) {
            const indicator = existingContact.querySelector('.online-indicator');
            if (indicator) {
                indicator.style.display = user.online ? 'block' : 'none';
            }
            return;
        }

        const isFriend = this.friends.has(user.id);
        
        const div = document.createElement('div');
        div.className = 'contact-item';
        div.id = `contact-${user.id}`;
        div.innerHTML = `
            <div class="avatar" style="position: relative;">
                ${user.avatar || user.username[0].toUpperCase()}
                <div class="online-indicator" style="display: ${user.online ? 'block' : 'none'}"></div>
            </div>
            <div class="chat-preview">
                <div class="chat-name">${user.username}</div>
                <div class="last-message">${isFriend ? '👥 Друг' : 'Нажмите, чтобы добавить'}</div>
            </div>
            ${!isFriend ? `
                <button class="btn-add-friend" onclick="event.stopPropagation(); window.app.sendFriendRequest('${user.id}')">
                    <i class="fas fa-user-plus"></i>
                </button>
            ` : ''}
        `;
        
        if (isFriend) {
            div.addEventListener('click', () => this.openPrivateChat(user));
        }
        contactsList.appendChild(div);
    }

    sendFriendRequest(userId) {
        this.socket.emit('sendFriendRequest', { toUserId: userId });
        this.showNotification('Заявка отправлена');
    }

    openPrivateChat(user) {
        this.currentChat = { type: 'private', id: user.id, name: user.username, avatar: user.avatar };
        
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('activeChat').style.display = 'flex';
        document.getElementById('chatName').textContent = user.username;
        document.getElementById('chatAvatar').textContent = user.avatar || user.username[0].toUpperCase();
        document.getElementById('chatStatus').textContent = user.online ? 'онлайн' : '';
        document.getElementById('messagesList').innerHTML = '';
        
        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').classList.remove('open');
        }
    }

    closeChat() {
        this.currentChat = null;
        document.getElementById('emptyState').style.display = 'flex';
        document.getElementById('activeChat').style.display = 'none';
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();
        
        if (!message || !this.currentChat) {
            console.log('Cannot send message:', { message, currentChat: this.currentChat });
            return;
        }

        console.log('Sending message:', message, 'to:', this.currentChat);

        if (this.currentChat.type === 'private') {
            this.socket.emit('privateMessage', {
                to: this.currentChat.id,
                message: message,
                type: 'text',
                timestamp: Date.now()
            });
        }

        input.value = '';
        input.focus();
    }

    handleIncomingMessage(messageData) {
        console.log('Handling incoming message:', messageData);
        
        if (!this.currentChat) return;
        
        const isCurrentChat = this.currentChat.type === 'private' && 
            (this.currentChat.id === messageData.from || this.currentChat.id === messageData.to);
        
        if (isCurrentChat) {
            this.displayMessage(messageData, messageData.from === this.currentUser?.id ? 'sent' : 'received');
        }
    }

    displayMessage(data, type) {
        const messagesList = document.getElementById('messagesList');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const time = new Date(data.timestamp).toLocaleTimeString('ru-RU', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-text">${data.message}</div>
                <div class="message-time">${time}</div>
            </div>
        `;
        
        messagesList.appendChild(messageDiv);
        messagesList.scrollTop = messagesList.scrollHeight;
    }

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file || !this.currentChat) return;

        const formData = new FormData();
        formData.append('file', file);

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            const messageData = {
                to: this.currentChat.id,
                message: '📷 Фото',
                type: 'image',
                fileUrl: data.url,
                timestamp: Date.now()
            };
            this.socket.emit('privateMessage', messageData);
        })
        .catch(error => {
            console.error('Upload failed:', error);
            this.showNotification('Ошибка загрузки файла');
        });
        
        event.target.value = '';
    }

    startVoiceRecording() {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                this.mediaRecorder = new MediaRecorder(stream);
                this.audioChunks = [];
                
                this.mediaRecorder.ondataavailable = (event) => {
                    this.audioChunks.push(event.data);
                };
                
                this.mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    this.sendVoiceMessage(audioBlob);
                };
                
                this.isVoiceRecording = true;
                this.mediaRecorder.start();
                document.getElementById('recordVoiceBtn').style.color = 'red';
            })
            .catch(err => {
                console.error('Error:', err);
                this.showNotification('Нет доступа к микрофону');
            });
    }

    stopVoiceRecording() {
        if (this.isVoiceRecording && this.mediaRecorder) {
            this.mediaRecorder.stop();
            this.isVoiceRecording = false;
            document.getElementById('recordVoiceBtn').style.color = '';
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    }

    sendVoiceMessage(audioBlob) {
        const formData = new FormData();
        formData.append('file', audioBlob, 'voice-message.webm');

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (this.currentChat) {
                this.socket.emit('privateMessage', {
                    to: this.currentChat.id,
                    message: '🎤 Голосовое сообщение',
                    type: 'audio',
                    fileUrl: data.url,
                    timestamp: Date.now()
                });
            }
        })
        .catch(error => {
            console.error('Failed to upload voice message:', error);
        });
    }

    showRequestsModal() {
        const modal = document.getElementById('requestsModal');
        modal.style.display = 'flex';
        
        const list = document.getElementById('requestsList');
        if (this.friendRequests.length === 0) {
            list.innerHTML = '<p class="empty-text">Нет новых заявок</p>';
        } else {
            list.innerHTML = this.friendRequests.map(req => `
                <div class="request-item">
                    <div class="request-info">
                        <div class="avatar">${req.fromUsername[0].toUpperCase()}</div>
                        <span>${req.fromUsername}</span>
                    </div>
                    <div>
                        <button class="btn-accept" onclick="window.app.acceptFriendRequest('${req.from}')">
                            ✓ Принять
                        </button>
                        <button class="btn-reject" onclick="window.app.rejectFriendRequest('${req.from}')">
                            ✕ Отклонить
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }

    acceptFriendRequest(fromUserId) {
        this.socket.emit('acceptFriendRequest', { fromUserId });
        this.friendRequests = this.friendRequests.filter(r => r.from !== fromUserId);
        this.updateRequestsBadge();
        document.getElementById('requestsModal').style.display = 'none';
    }

    rejectFriendRequest(fromUserId) {
        this.friendRequests = this.friendRequests.filter(r => r.from !== fromUserId);
        this.updateRequestsBadge();
        this.showRequestsModal();
    }

    updateRequestsBadge() {
        const badge = document.getElementById('requestsBadge');
        if (this.friendRequests.length > 0) {
            badge.textContent = this.friendRequests.length;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    showGroupModal() {
        document.getElementById('groupModal').style.display = 'flex';
    }

    createGroup() {
        const groupName = document.getElementById('groupNameInput').value.trim();
        if (!groupName) {
            this.showNotification('Введите название группы');
            return;
        }
        
        const selectedMembers = Array.from(document.querySelectorAll('.group-member-checkbox:checked'))
            .map(cb => cb.value);
        
        if (selectedMembers.length === 0) {
            this.showNotification('Выберите участников');
            return;
        }
        
        this.socket.emit('createGroup', {
            name: groupName,
            members: selectedMembers
        });
        
        document.getElementById('groupModal').style.display = 'none';
        document.getElementById('groupNameInput').value = '';
    }

    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        const tabBtn = document.querySelector(`[data-tab="${tab}"]`);
        const tabContent = document.getElementById(`${tab}Tab`);
        
        if (tabBtn) tabBtn.classList.add('active');
        if (tabContent) tabContent.classList.add('active');
    }

    handleSearch(query) {
        const searchTerm = query.toLowerCase();
        document.querySelectorAll('.chat-item, .contact-item').forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
        });
    }

    showNotification(message) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #333;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 9999;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => notification.remove(), 3000);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('App initializing...');
    window.app = new MessengerApp();
    console.log('App initialized');
});
