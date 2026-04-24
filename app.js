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
        this.remoteStream = null;
        this.isMuted = false;
        this.isCameraOff = false;
        
        this.init();
    }

    init() {
        this.socket = io('/', {
            transports: ['websocket', 'polling']
        });
        
        this.setupSocketListeners();
        this.setupEventListeners();
        this.createAvatarOptions();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
        });

        this.socket.on('registered', (user) => {
            this.currentUser = user;
            if (user.friends) {
                user.friends.forEach(friendId => {
                    this.friends.set(friendId, true);
                });
            }
            document.getElementById('currentUsername').textContent = user.username;
            document.getElementById('currentUserAvatar').textContent = user.avatar || user.username[0].toUpperCase();
            this.showScreen('chatScreen');
            this.setupPeerConnection();
        });

        this.socket.on('loginError', (error) => {
            document.getElementById('loginError').textContent = error;
        });

        this.socket.on('usersList', (users) => {
            this.updateUsersList(users);
        });

        this.socket.on('userOnline', (user) => {
            this.updateUserStatus(user, true);
        });

        this.socket.on('userOffline', (data) => {
            this.updateUserStatus(data, false);
        });

        this.socket.on('newFriendRequest', (data) => {
            this.friendRequests.push(data);
            this.updateRequestsBadge();
            this.showNotification(`Заявка в друзья от ${data.fromUsername}`);
        });

        this.socket.on('friendRequestSent', (data) => {
            this.showNotification('Заявка отправлена');
        });

        this.socket.on('friendAdded', (user) => {
            this.friends.set(user.id, true);
            this.addUserToList(user);
            this.showNotification(`${user.username} теперь ваш друг!`);
        });

        this.socket.on('privateMessage', (message) => {
            this.receiveMessage(message);
        });

        this.socket.on('groupMessage', (message) => {
            this.receiveGroupMessage(message);
        });

        this.socket.on('groupCreated', (group) => {
            this.addGroupToChats(group);
            this.showNotification(`Группа "${group.name}" создана`);
        });

        this.socket.on('messageHistory', (data) => {
            this.loadMessageHistory(data);
        });

        this.socket.on('messageStatusUpdate', (data) => {
            this.updateMessageStatus(data);
        });

        this.socket.on('userTyping', (data) => {
            if (this.currentChat && this.currentChat.id === data.from) {
                this.showTypingIndicator(data.username, data.isTyping);
            }
        });

        // Call handlers
        this.socket.on('callUser', async (data) => {
            this.handleIncomingCall(data);
        });

        this.socket.on('callAccepted', (signal) => {
            if (this.callPeer) {
                this.callPeer.signal(signal);
            }
        });

        this.socket.on('callEnded', () => {
            this.endCall();
        });
    }

    setupPeerConnection() {
        if (this.currentUser && !this.peer) {
            this.peer = new Peer(this.currentUser.id, {
                host: window.location.hostname,
                port: window.location.port,
                path: '/peerjs',
                secure: window.location.protocol === 'https:'
            });

            this.peer.on('call', (call) => {
                this.showCallModal(false);
                navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                    .then((stream) => {
                        this.localStream = stream;
                        document.getElementById('localVideo').srcObject = stream;
                        call.answer(stream);
                        call.on('stream', (remoteStream) => {
                            document.getElementById('remoteVideo').srcObject = remoteStream;
                            this.remoteStream = remoteStream;
                            document.getElementById('callStatus').textContent = 'В разговоре';
                        });
                    })
                    .catch(err => {
                        console.error('Error accessing media:', err);
                        this.showNotification('Ошибка доступа к камере/микрофону');
                    });
            });
        }
    }

    setupEventListeners() {
        // Login
        document.getElementById('loginButton').addEventListener('click', () => this.login());
        document.getElementById('passwordInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });

        // Auto-resize textarea
        const textarea = document.getElementById('messageInput');
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
            this.handleTyping();
        });
        textarea.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        document.getElementById('sendMessageBtn').addEventListener('click', () => this.sendMessage());
        document.getElementById('attachBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileUpload(e));

        // Voice recording
        const recordBtn = document.getElementById('recordVoiceBtn');
        recordBtn.addEventListener('mousedown', () => this.startVoiceRecording());
        recordBtn.addEventListener('mouseup', () => this.stopVoiceRecording());
        recordBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startVoiceRecording();
        });
        recordBtn.addEventListener('touchend', () => this.stopVoiceRecording());

        // Calls
        document.getElementById('voiceCallBtn').addEventListener('click', () => this.startCall(false));
        document.getElementById('videoCallBtn').addEventListener('click', () => this.startCall(true));
        document.getElementById('endCallBtn').addEventListener('click', () => this.endCall());
        document.getElementById('muteBtn').addEventListener('click', () => this.toggleMute());
        document.getElementById('cameraBtn').addEventListener('click', () => this.toggleCamera());

        // Modals
        document.getElementById('friendRequestsBtn').addEventListener('click', () => this.showRequestsModal());
        document.getElementById('closeRequestsBtn').addEventListener('click', () => this.closeRequestsModal());
        document.getElementById('createGroupBtn').addEventListener('click', () => this.showGroupModal());
        document.getElementById('closeGroupBtn').addEventListener('click', () => this.closeGroupModal());
        document.getElementById('confirmCreateGroup').addEventListener('click', () => this.createGroup());

        // Image viewer
        document.getElementById('closeViewer').addEventListener('click', () => {
            document.getElementById('imageViewer').style.display = 'none';
        });

        // Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // Back button
        document.getElementById('backBtn').addEventListener('click', () => {
            this.closeChat();
            document.getElementById('sidebar').classList.add('open');
        });

        // Sidebar toggle
        document.getElementById('toggleSidebar').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => this.handleSearch(e.target.value));

        // Close sidebar on mobile when clicking chat
        document.getElementById('mainChat').addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
    }

    createAvatarOptions() {
        const avatars = ['😀', '😎', '🤖', '👽', '🦊', '🐱', '🐶', '🦁', '🐼', '🐨', '🐰', '🐯', '🐮', '🐷', '🐸'];
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
            ${!isFriend ? `<button class="btn-add-friend" onclick="event.stopPropagation(); app.sendFriendRequest('${user.id}')">
                <i class="fas fa-user-plus"></i>
            </button>` : ''}
        `;
        
        if (isFriend) {
            div.addEventListener('click', () => this.openPrivateChat(user));
        }
        contactsList.appendChild(div);
    }

    sendFriendRequest(userId) {
        this.socket.emit('sendFriendRequest', { toUserId: userId });
    }

    updateUserStatus(userOrData, isOnline) {
        const userId = userOrData.id || userOrData.userId;
        const contactElement = document.getElementById(`contact-${userId}`);
        if (contactElement) {
            const indicator = contactElement.querySelector('.online-indicator');
            if (indicator) {
                indicator.style.display = isOnline ? 'block' : 'none';
            }
        }
        
        if (this.currentChat && this.currentChat.id === userId) {
            document.getElementById('chatStatus').textContent = isOnline ? 'онлайн' : 'был(а) недавно';
        }
    }

    openPrivateChat(user) {
        this.currentChat = { type: 'private', id: user.id, name: user.username, avatar: user.avatar };
        this.showChat(user.username, user.avatar || user.username[0].toUpperCase(), user.online);
        
        const channelId = this.getChannelId(user.id);
        this.socket.emit('getMessages', { channelId });
        
        this.markMessagesAsRead(channelId);
    }

    openGroupChat(groupId) {
        const groupElement = document.getElementById(`group-${groupId}`);
        if (!groupElement) return;
        
        const groupName = groupElement.querySelector('.chat-name').textContent;
        this.currentChat = { type: 'group', id: groupId, name: groupName };
        this.showChat(groupName, '👥', false);
        this.socket.emit('getMessages', { channelId: groupId });
    }

    showChat(name, avatarEmoji, isOnline) {
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('activeChat').style.display = 'flex';
        document.getElementById('chatName').textContent = name;
        document.getElementById('chatAvatar').textContent = avatarEmoji;
        document.getElementById('chatStatus').textContent = isOnline ? 'онлайн' : '';
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
        const textarea = document.getElementById('messageInput');
        const message = textarea.value.trim();
        
        if (!message || !this.currentChat) return;

        const messageData = {
            message,
            timestamp: Date.now()
        };

        if (this.currentChat.type === 'private') {
            messageData.to = this.currentChat.id;
            this.socket.emit('privateMessage', messageData);
        } else if (this.currentChat.type === 'group') {
            messageData.groupId = this.currentChat.id;
            this.socket.emit('groupMessage', messageData);
        }

        textarea.value = '';
        textarea.style.height = 'auto';
        textarea.focus();
    }

    receiveMessage(messageData) {
        if (!this.currentChat) return;
        
        const isCurrentChat = this.currentChat.type === 'private' && 
            (this.currentChat.id === messageData.from || this.currentChat.id === messageData.to);
        
        if (isCurrentChat) {
            const type = messageData.from === this.currentUser.id ? 'sent' : 'received';
            this.displayMessage(messageData, type);
            
            if (type === 'received') {
                this.socket.emit('messageDelivered', {
                    messageId: messageData.id,
                    from: messageData.from
                });
                setTimeout(() => {
                    this.socket.emit('messageRead', {
                        messageId: messageData.id,
                        from: messageData.from
                    });
                }, 1000);
            }
        }
        
        if (messageData.from !== this.currentUser.id) {
            this.addToChatList(messageData);
        }
    }

    receiveGroupMessage(messageData) {
        if (!this.currentChat || this.currentChat.type !== 'group' || this.currentChat.id !== messageData.groupId) return;
        this.displayMessage(messageData, messageData.from === this.currentUser.id ? 'sent' : 'received', true);
    }

    displayMessage(data, type, showSender = false) {
        const messagesList = document.getElementById('messagesList');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.id = `msg-${data.id}`;
        
        let content = '';
        
        if (showSender && type === 'received') {
            content += `<div class="sender-name">${data.fromUsername}</div>`;
        }

        if (data.type === 'image') {
            content += `<img src="${data.fileUrl}" class="message-image" onclick="app.openImageViewer('${data.fileUrl}')" loading="lazy">`;
        } else if (data.type === 'audio') {
            content += `<audio controls class="message-audio"><source src="${data.fileUrl}"></audio>`;
        } else if (data.type === 'video') {
            content += `<video controls class="message-video" preload="metadata"><source src="${data.fileUrl}"></video>`;
        } else {
            content += `<div class="message-text">${this.escapeHtml(data.message)}</div>`;
        }
        
        let statusIcon = '';
        if (type === 'sent') {
            const status = data.status || 'sent';
            if (status === 'sent') statusIcon = '<i class="fas fa-check message-status-icon sent"></i>';
            else if (status === 'delivered') statusIcon = '<i class="fas fa-check-double message-status-icon delivered"></i>';
            else if (status === 'read') statusIcon = '<i class="fas fa-check-double message-status-icon read"></i>';
        }
        
        content += `
            <div class="message-meta">
                <span class="message-time">${this.formatTime(data.timestamp)}</span>
                ${statusIcon}
            </div>
        `;
        
        messageDiv.innerHTML = `<div class="message-content">${content}</div>`;
        messagesList.appendChild(messageDiv);
        messagesList.scrollTop = messagesList.scrollHeight;
    }

    addToChatList(messageData) {
        const channelId = this.getChannelId(messageData.from === this.currentUser.id ? messageData.to : messageData.from);
        let chatItem = document.getElementById(`chat-${channelId}`);
        const chatList = document.getElementById('chatList');
        
        if (!chatItem) {
            chatItem = document.createElement('div');
            chatItem.className = 'chat-item';
            chatItem.id = `chat-${channelId}`;
            chatItem.addEventListener('click', () => {
                const otherUser = {
                    id: messageData.from === this.currentUser.id ? messageData.to : messageData.from,
                    username: messageData.fromUsername
                };
                this.openPrivateChat(otherUser);
            });
            chatList.prepend(chatItem);
        }
        
        const preview = messageData.type === 'image' ? '📷 Фото' : 
                       messageData.type === 'audio' ? '🎤 Голосовое' : 
                       messageData.type === 'video' ? '📹 Видео' : 
                       messageData.message.substring(0, 30);
        
        chatItem.innerHTML = `
            <div class="avatar">${messageData.fromUsername[0].toUpperCase()}</div>
            <div class="chat-preview">
                <div class="chat-name">
                    ${messageData.fromUsername}
                    <span class="chat-time">${this.formatTime(messageData.timestamp)}</span>
                </div>
                <div class="last-message">
                    ${preview}
                    ${messageData.from === this.currentUser.id ? '<span class="message-status sent"><i class="fas fa-check"></i></span>' : ''}
                </div>
            </div>
        `;
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file || !this.currentChat) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            
            const messageData = {
                message: file.type.startsWith('image/') ? '📷 Фото' : 
                        file.type.startsWith('audio/') ? '🎤 Аудио' : '📹 Видео',
                type: file.type.split('/')[0],
                fileUrl: data.url,
                fileName: data.name,
                timestamp: Date.now()
            };

            if (this.currentChat.type === 'private') {
                messageData.to = this.currentChat.id;
                this.socket.emit('privateMessage', messageData);
            } else if (this.currentChat.type === 'group') {
                messageData.groupId = this.currentChat.id;
                this.socket.emit('groupMessage', messageData);
            }
        } catch (error) {
            console.error('Upload failed:', error);
            this.showNotification('Ошибка при загрузке файла');
        }
        
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
                console.error('Error accessing microphone:', err);
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

    async sendVoiceMessage(audioBlob) {
        const formData = new FormData();
        formData.append('file', audioBlob, 'voice-message.webm');

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            
            if (this.currentChat) {
                const messageData = {
                    message: '🎤 Голосовое сообщение',
                    type: 'audio',
                    fileUrl: data.url,
                    fileName: 'voice-message',
                    timestamp: Date.now()
                };

                if (this.currentChat.type === 'private') {
                    messageData.to = this.currentChat.id;
                    this.socket.emit('privateMessage', messageData);
                } else if (this.currentChat.type === 'group') {
                    messageData.groupId = this.currentChat.id;
                    this.socket.emit('groupMessage', messageData);
                }
            }
        } catch (error) {
            console.error('Failed to upload voice message:', error);
        }
    }

    handleTyping() {
        if (this.currentChat && this.currentChat.type === 'private') {
            this.socket.emit('typing', {
                to: this.currentChat.id,
                isTyping: true
            });
            
            clearTimeout(this.typingTimeout);
            this.typingTimeout = setTimeout(() => {
                this.socket.emit('typing', {
                    to: this.currentChat.id,
                    isTyping: false
                });
            }, 2000);
        }
    }

    showTypingIndicator(username, isTyping) {
        const indicator = document.getElementById('typingIndicator');
        const usernameEl = document.getElementById('typingUsername');
        if (isTyping) {
            usernameEl.textContent = username;
            indicator.style.display = 'flex';
        } else {
            indicator.style.display = 'none';
        }
    }

    async startCall(videoEnabled) {
        if (!this.currentChat || this.currentChat.type !== 'private') return;
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: videoEnabled, 
                audio: true 
            });
            
            this.localStream = stream;
            document.getElementById('localVideo').srcObject = stream;
            this.showCallModal(videoEnabled);
            document.getElementById('callStatus').textContent = 'Вызов...';
            
            this.callPeer = this.peer.call(this.currentChat.id, stream);

            this.callPeer.on('stream', (remoteStream) => {
                this.remoteStream = remoteStream;
                document.getElementById('remoteVideo').srcObject = remoteStream;
                document.getElementById('callStatus').textContent = 'В разговоре';
            });

            this.callPeer.on('close', () => {
                this.endCall();
            });

            this.callPeer.on('error', (err) => {
                console.error('Call error:', err);
                this.endCall();
            });
        } catch (error) {
            console.error('Error starting call:', error);
            this.showNotification('Не удалось начать звонок. Проверьте разрешения.');
        }
    }

    async handleIncomingCall(data) {
        const accept = confirm(`${data.username || 'Пользователь'} звонит вам. Принять?`);
        
        if (accept) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                this.localStream = stream;
                
                document.getElementById('localVideo').srcObject = stream;
                this.showCallModal(true);
                document.getElementById('callStatus').textContent = 'Соединение...';
                
                this.socket.emit('answerCall', {
                    to: data.from,
                    signal: null
                });
            } catch (error) {
                console.error('Error accepting call:', error);
            }
        }
    }

    showCallModal(videoEnabled) {
        document.getElementById('callModal').style.display = 'flex';
        document.getElementById('callTitle').textContent = videoEnabled ? 'Видеозвонок' : 'Аудиозвонок';
        document.getElementById('remoteVideo').style.display = videoEnabled ? 'block' : 'none';
    }

    endCall() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => track.stop());
            this.remoteStream = null;
        }
        
        if (this.callPeer) {
            this.callPeer.close();
            this.callPeer = null;
        }
        
        document.getElementById('callModal').style.display = 'none';
        document.getElementById('localVideo').srcObject = null;
        document.getElementById('remoteVideo').srcObject = null;
        
        if (this.currentChat) {
            this.socket.emit('endCall', { to: this.currentChat.id });
        }
    }

    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                this.isMuted = !this.isMuted;
                audioTrack.enabled = !this.isMuted;
                const muteBtn = document.getElementById('muteBtn');
                muteBtn.innerHTML = this.isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
            }
        }
    }

    toggleCamera() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                this.isCameraOff = !this.isCameraOff;
                videoTrack.enabled = !this.isCameraOff;
                const cameraBtn = document.getElementById('cameraBtn');
                cameraBtn.innerHTML = this.isCameraOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
            }
        }
    }

    showRequestsModal() {
        document.getElementById('requestsModal').style.display = 'flex';
        this.renderRequestsList();
    }

    closeRequestsModal() {
        document.getElementById('requestsModal').style.display = 'none';
    }

    renderRequestsList() {
        const list = document.getElementById('requestsList');
        if (this.friendRequests.length === 0) {
            list.innerHTML = '<p class="empty-text">Нет новых заявок</p>';
            return;
        }
        
        list.innerHTML = this.friendRequests.map(req => `
            <div class="request-item">
                <div class="request-info">
                    <div class="avatar">${req.fromUsername[0].toUpperCase()}</div>
                    <span>${req.fromUsername}</span>
                </div>
                <div>
                    <button class="btn-accept" onclick="app.acceptFriendRequest('${req.from}')">
                        <i class="fas fa-check"></i> Принять
                    </button>
                    <button class="btn-reject" onclick="app.rejectFriendRequest('${req.from}')">
                        <i class="fas fa-times"></i> Отклонить
                    </button>
                </div>
            </div>
        `).join('');
    }

    acceptFriendRequest(fromUserId) {
        this.socket.emit('acceptFriendRequest', { fromUserId });
        this.friendRequests = this.friendRequests.filter(r => r.from !== fromUserId);
        this.updateRequestsBadge();
        this.closeRequestsModal();
    }

    rejectFriendRequest(fromUserId) {
        this.friendRequests = this.friendRequests.filter(r => r.from !== fromUserId);
        this.updateRequestsBadge();
        if (this.friendRequests.length === 0) {
            this.closeRequestsModal();
        } else {
            this.renderRequestsList();
        }
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
        this.renderGroupMembersList();
    }

    closeGroupModal() {
        document.getElementById('groupModal').style.display = 'none';
    }

    renderGroupMembersList() {
        const membersList = document.getElementById('groupMembersList');
        const users = document.querySelectorAll('.contact-item');
        membersList.innerHTML = '';
        
        users.forEach(userEl => {
            const userId = userEl.id.replace('contact-', '');
            if (this.friends.has(userId)) {
                const name = userEl.querySelector('.chat-name').textContent;
                const avatar = userEl.querySelector('.avatar').textContent.trim();
                
                const div = document.createElement('div');
                div.className = 'member-checkbox';
                div.innerHTML = `
                    <input type="checkbox" class="group-member-checkbox" value="${userId}" id="member-${userId}">
                    <label for="member-${userId}">
                        <div class="avatar" style="width: 35px; height: 35px; font-size: 16px;">${avatar}</div>
                        <span>${name}</span>
                    </label>
                `;
                membersList.appendChild(div);
            }
        });
        
        if (membersList.children.length === 0) {
            membersList.innerHTML = '<p class="empty-text">Нет друзей для добавления</p>';
        }
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
            this.showNotification('Выберите хотя бы одного участника');
            return;
        }
        
        this.socket.emit('createGroup', {
            name: groupName,
            members: selectedMembers
        });
        
        this.closeGroupModal();
        document.getElementById('groupNameInput').value = '';
    }

    addGroupToChats(group) {
        const chatList = document.getElementById('chatList');
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        chatItem.id = `group-${group.id}`;
        chatItem.innerHTML = `
            <div class="avatar">👥</div>
            <div class="chat-preview">
                <div class="chat-name">${group.name}</div>
                <div class="last-message">${group.members.length} участников</div>
            </div>
        `;
        chatItem.addEventListener('click', () => this.openGroupChat(group.id));
        chatList.prepend(chatItem);
    }

    loadMessageHistory(data) {
        const messagesList = document.getElementById('messagesList');
        messagesList.innerHTML = '';
        
        data.messages.forEach(message => {
            const type = message.from === this.currentUser.id ? 'sent' : 'received';
            const showSender = this.currentChat?.type === 'group';
            this.displayMessage(message, type, showSender && type === 'received');
        });
        
        messagesList.scrollTop = messagesList.scrollHeight;
    }

    updateMessageStatus(data) {
        const messageEl = document.getElementById(`msg-${data.messageId}`);
        if (messageEl) {
            const statusIcon = messageEl.querySelector('.message-status-icon');
            if (statusIcon) {
                if (data.status === 'delivered') {
                    statusIcon.className = 'fas fa-check-double message-status-icon delivered';
                } else if (data.status === 'read') {
                    statusIcon.className = 'fas fa-check-double message-status-icon read';
                }
            }
        }
    }

    markMessagesAsRead(channelId) {
        const messages = document.querySelectorAll(`#messagesList .message.received`);
        messages.forEach(msg => {
            const messageId = msg.id.replace('msg-', '');
            if (messageId) {
                this.socket.emit('messageRead', {
                    messageId,
                    from: this.currentChat?.id
                });
            }
        });
    }

    openImageViewer(url) {
        document.getElementById('viewerImage').src = url;
        document.getElementById('imageViewer').style.display = 'flex';
    }

    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
        document.getElementById(`${tab}Tab`).classList.add('active');
    }

    handleSearch(query) {
        const searchTerm = query.toLowerCase();
        document.querySelectorAll('.chat-item, .contact-item').forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
        });
    }

    getChannelId(otherUserId) {
        return [this.currentUser.id, otherUserId].sort().join('-');
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();
        
        if (isToday) {
            return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showNotification(message) {
        // Simple notification
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
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new MessengerApp();
    window.app = app;
});
