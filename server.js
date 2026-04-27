const express=require('express');
if(sid) io.to(sid).emit('channelPost',{
channelId:c.id,
post
});
}
});

socket.on('loadChannels',()=>{
let d=db();
socket.emit('channelsList',d.channels);
});

socket.on('loadGroups',()=>{
let d=db();
socket.emit(
'groupsList',
d.groups.filter(g=>g.members.includes(socket.userId))
);
});

/* calls signaling */
socket.on('callUser',data=>{
let target=online.get(data.to);
if(target){
io.to(target).emit('incomingCall',{
from:socket.userId,
username:data.username,
offer:data.offer
});
}
});

socket.on('answerCall',data=>{
let target=online.get(data.to);
if(target){
io.to(target).emit('callAnswered',{
answer:data.answer
});
}
});

socket.on('iceCandidate',data=>{
let target=online.get(data.to);
if(target){
io.to(target).emit('iceCandidate',data.candidate);
}
});

socket.on('endCall',to=>{
let t=online.get(to);
if(t) io.to(t).emit('callEnded');
});

socket.on('disconnect',()=>{
if(socket.userId){
online.delete(socket.userId);
emitUsers();
}
});

});

server.listen(3000,()=>
console.log('Матрешка работает :3000')
)
