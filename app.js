// Main Application Class
class MessengerApp {
    constructor() {
        this.socket = null;
        this.peer = null;
        this.currentUser = null;
        this.currentChat = null;
        this.isVoiceRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.callPeer = null;
        this.localStream = null;
        this.remoteStream = null;
        this.isMuted = false;
        
        this.init();
    }

    init() {
        this.setupSocketConnection();
        this.setupEventListeners();
        this.createAvatarOptions();
    }

    setupSocketConnection() {
        // Connect to Socket.io server
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
        });

        this.socket.on('registered', (user) => {
            this.currentUser = user;
            document.getElementById('currentUsername').textContent = user.username;
            document.getElementById('currentUserAvatar').textContent = user.username[0].toUpperCase();
            this.showScreen('chatScreen');
        });

        this.socket.on('usersList', (users) => {
            this.updateUsersList(users);
        });

        this.socket.on('userJoined', (user) => {
            this.addUserToList(user);
        });

        this.socket.on('userLeft', (userId) => {
            this.removeUserFromList(userId);
        });

        this.socket.on('privateMessage', (message) => {
            this.receiveMessage(message);
        });

        this.socket.on('groupMessage', (message) => {
            this.receiveGroupMessage(message);
        });

        this.socket.on('groupCreated', (group) => {
            this.addGroupToChats(group);
        });

        this.socket.on('messageHistory', (data) => {
            this.loadMessageHistory(data);
        });

        this.socket.on('userTyping', (data) => {
            if (this.currentChat && this.currentChat.id === data.from) {
                this.showTypingIndicator(data.isTyping);
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
        if (this.currentUser) {
            this.peer = new Peer(this.currentUser.id, {
                host: window.location.hostname,
                port: window.location.port,
                path: '/peerjs'
            });

            this.peer.on('call', (call) => {
                navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                    .then((stream) => {
                        this.localStream = stream;
                        document.getElementById('localVideo').srcObject = stream;
                        call.answer(stream);
                        call.on('stream', (remoteStream) => {
                            document.getElementById('remoteVideo').srcObject = remoteStream;
                            this.remoteStream = remoteStream;
                        });
                    });
            });
        }
    }

    setupEventListeners() {
        // Login
        document.getElementById('loginButton').addEventListener('click', () => this.login());
        document.getElementById('usernameInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });

        // Message input
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        document.getElementById('sendMessageBtn').addEventListener('click', () => this.sendMessage());
        document.getElementById('messageInput').addEventListener('input', () => this.handleTyping());

        // File upload
        document.getElementById('attachBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileUpload(e));

        // Voice recording
        const recordBtn = document.getElementById('recordVoiceBtn');
        recordBtn.addEventListener('mousedown', () => this.startVoiceRecording());
        recordBtn.addEventListener('mouseup', () => this.stopVoiceRecording());

        // Call buttons
        document.getElementById('voiceCallBtn').addEventListener('click', () => this.startCall(false));
        document.getElementById('videoCallBtn').addEventListener('click', () => this.startCall(true));
        document.getElementById('endCallBtn').addEventListener('click', () => this.endCall());
        document.getElementById('muteBtn').addEventListener('click', () => this.toggleMute());

        // Group creation
        document.getElementById('createGroupBtn').addEventListener('click', () => this.showGroupModal());
        document.getElementById('confirmCreateGroup').addEventListener('click', () => this.createGroup());

        // Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // Back button
        document.getElementById('backBtn').addEventListener('click', () => this.closeChat());

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => this.handleSearch(e.target.value));

        // Sidebar toggle
        document.getElementById('toggleSidebar').addEventListener('click', () => this.toggleSidebar());
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
        const avatar = document.querySelector('.avatar-option.selected')?.textContent;
        
        if (!username) {
            alert('Пожалуйста, введите имя');
            return;
        }

        this.socket.emit('register', { username, avatar });
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
        
        if (screenId === 'chatScreen') {
            this.setupPeerConnection();
        }
    }

    updateUsersList(users) {
        const contactsList = document.getElementById('contactsList');
        contactsList.innerHTML = '';
        
        users.forEach(user => {
            if (user.id !== this.currentUser.id) {
                this.addUserToList(user);
            }
        });
    }

    addUserToList(user) {
        if (user.id === this.currentUser?.id) return;
        
        const contactsList = document.getElementById('contactsList');
        const existingContact = document.getElementById(`contact-${user.id}`);
        
        if (existingContact) {
            existingContact.querySelector('.online-indicator').style.display = user.online ? 'block' : 'none';
            return;
        }

        const div = document.createElement('div');
        div.className = 'contact-item';
        div.id = `contact-${user.id}`;
        div.innerHTML = `
            <div class="avatar" style="position: relative;">
                ${user.avatar || user.username[0].toUpperCase()}
                <div class="online-indicator" style="display: ${user.online ? 'block' : 'none'}"></div>
            </div>
            <div class="contact-name">${user.username}</div>
        `;
        div.addEventListener('click', () => this.openPrivateChat(user));
        contactsList.appendChild(div);
    }

    removeUserFromList(userId) {
        const contactElement = document.getElementById(`contact-${userId}`);
        if (contactElement) {
            const indicator = contactElement.querySelector('.online-indicator');
            if (indicator) indicator.style.display = 'none';
        }
    }

    openPrivateChat(user) {
        this.currentChat = { type: 'private', id: user.id, name: user.username };
        this.showChat(user.username, user.avatar || user.username[0].toUpperCase());
        
        const channelId = this.getChannelId(user.id);
        this.socket.emit('getMessages', { channelId });
    }

    openGroupChat(groupId) {
        const group = this.groups?.find(g => g.id === groupId);
        if (group) {
            this.currentChat = { type: 'group', id: groupId, name: group.name };
            this.showChat(group.name, group.avatar || '👥');
            this.socket.emit('getMessages', { channelId: groupId });
        }
    }

    showChat(name, avatarEmoji) {
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('activeChat').style.display = 'flex';
        document.getElementById('chatName').textContent = name;
        document.getElementById('chatAvatar').textContent = avatarEmoji;
        document.getElementById('messagesList').innerHTML = '';
    }

    closeChat() {
        this.currentChat = null;
        document.getElementById('emptyState').style.display = 'flex';
        document.getElementById('activeChat').style.display = 'none';
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();
        
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

        input.value = '';
        input.focus();
    }

    receiveMessage(messageData) {
        if (!this.currentChat) return;
        
        const isCurrentChat = this.currentChat.type === 'private' && 
            (this.currentChat.id === messageData.from || this.currentChat.id === messageData.to);
        
        if (isCurrentChat) {
            this.displayMessage(messageData, messageData.from === this.currentUser.id ? 'sent' : 'received');
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
        
        let content = '';
        
        if (showSender && type === 'received') {
            content += `<div class="sender-name">${data.fromUsername}</div>`;
        }

        if (data.type === 'image') {
            content += `<img src="${data.fileUrl}" class="message-image" onclick="window.open(this.src)">`;
        } else if (data.type === 'audio') {
            content += `<audio controls class="message-audio"><source src="${data.fileUrl}"></audio>`;
        } else if (data.type === 'video') {
            content += `<video controls class="message-video"><source src="${data.fileUrl}"></video>`;
        } else {
            content += `<div class="message-text">${data.message}</div>`;
        }
        
        content += `<div class="message-time">${this.formatTime(data.timestamp)}</div>`;
        
        messageDiv.innerHTML = `<div class="message-content">${content}</div>`;
        messagesList.appendChild(messageDiv);
        messagesList.scrollTop = messagesList.scrollHeight;
    }

    addToChatList(messageData) {
        // Add or update chat in sidebar
        const channelId = this.getChannelId(messageData.from);
        let chatItem = document.getElementById(`chat-${channelId}`);
        
        if (!chatItem) {
            const chatList = document.getElementById('chatList');
            chatItem = document.createElement('div');
            chatItem.className = 'chat-item';
            chatItem.id = `chat-${channelId}`;
            chatItem.addEventListener('click', () => {
                const otherUser = messageData.from === this.currentUser.id ? messageData.to : messageData.from;
                this.openPrivateChat({ id: otherUser, username: messageData.fromUsername });
            });
            chatList.prepend(chatItem);
        }
        
        chatItem.innerHTML = `
            <div class="avatar">${messageData.fromUsername[0].toUpperCase()}</div>
            <div class="chat-preview">
                <div class="chat-name">${messageData.fromUsername}</div>
                <div class="last-message">${messageData.message.substring(0, 30)}</div>
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
                message: '',
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
            alert('Ошибка при загрузке файла');
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
                alert('Нет доступа к микрофону');
            });
    }

    stopVoiceRecording() {
        if (this.isVoiceRecording && this.mediaRecorder) {
            this.mediaRecorder.stop();
            this.isVoiceRecording = false;
            document.getElementById('recordVoiceBtn').style.color = '';
            
            // Stop all tracks
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
            
            // Stop typing after 2 seconds of inactivity
            clearTimeout(this.typingTimeout);
            this.typingTimeout = setTimeout(() => {
                this.socket.emit('typing', {
                    to: this.currentChat.id,
                    isTyping: false
                });
            }, 2000);
        }
    }

    showTypingIndicator(isTyping) {
        const indicator = document.getElementById('typingIndicator');
        indicator.style.display = isTyping ? 'flex' : 'none';
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
            document.getElementById('callModal').style.display = 'flex';
            document.getElementById('callTitle').textContent = videoEnabled ? 'Видеозвонок' : 'Аудиозвонок';
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
        } catch (error) {
            console.error('Error starting call:', error);
            alert('Не удалось начать звонок. Проверьте разрешения камеры и микрофона.');
        }
    }

    async handleIncomingCall(data) {
        const accept = confirm(`${data.from.username || 'Пользователь'} звонит вам. Принять?`);
        
        if (accept) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                this.localStream = stream;
                
                document.getElementById('localVideo').srcObject = stream;
                document.getElementById('callModal').style.display = 'flex';
                document.getElementById('callStatus').textContent = 'Соединение...';
                
                this.socket.emit('answerCall', {
                    to: data.from,
                    signal: null
                });
                
                // Setup peer connection
                this.setupPeerConnection();
            } catch (error) {
                console.error('Error accepting call:', error);
            }
        }
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

    showGroupModal() {
        document.getElementById('groupModal').style.display = 'flex';
        this.renderGroupMembersList();
    }

    renderGroupMembersList() {
        const membersList = document.getElementById('groupMembersList');
        membersList.innerHTML = '';
        
        this.socket.emit('getUsers');
    }

    createGroup() {
        const groupName = document.getElementById('groupNameInput').value.trim();
        if (!groupName) {
            alert('Введите название группы');
            return;
        }
        
        const selectedMembers = Array.from(document.querySelectorAll('.group-member-checkbox:checked'))
            .map(cb => cb.value);
        
        if (selectedMembers.length === 0) {
            alert('Выберите хотя бы одного участника');
            return;
        }
        
        this.socket.emit('createGroup', {
            name: groupName,
            members: selectedMembers
        });
        
        document.getElementById('groupModal').style.display = 'none';
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

    toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('open');
    }

    getChannelId(otherUserId) {
        return [this.currentUser.id, otherUserId].sort().join('-');
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
}

// Close group modal
function closeGroupModal() {
    document.getElementById('groupModal').style.display = 'none';
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new MessengerApp();
    window.closeGroupModal = closeGroupModal;
});
