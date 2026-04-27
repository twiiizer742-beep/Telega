const express=require('express');
 let c={
 id:uuid(),
 name:esc(name),
 owner:socket.userId,
 posts:[]
 };
 d.channels.push(c);
 save(d);
 socket.emit('channelAdded',c);
});

socket.on('channelList',()=>{
 let d=load();
 socket.emit('channelListData',d.channels);
});

socket.on('channelPost',data=>{
 let d=load();
 let c=d.channels.find(x=>x.id===data.id);
 if(!c||c.owner!==socket.userId) return;
 let p={
 id:uuid(),
 text:esc(data.text),
 ts:Date.now()
 };
 c.posts.unshift(p);
 save(d);
 io.emit('channelPost',{channelId:c.id,post:p});
});

/* WEBRTC SIGNAL */
socket.on('callOffer',d=>{
 let t=online.get(d.to);
 if(t) io.to(t).emit('callOffer',{
 from:socket.userId,
 offer:d.offer,
 name:d.name
 });
});

socket.on('callAnswer',d=>{
 let t=online.get(d.to);
 if(t) io.to(t).emit('callAnswer',d.answer)
});

socket.on('ice',d=>{
 let t=online.get(d.to);
 if(t) io.to(t).emit('ice',d.candidate)
});

socket.on('hangup',to=>{
 let t=online.get(to);
 if(t) io.to(t).emit('hangup')
});

socket.on('disconnect',()=>{
 if(socket.userId){
 online.delete(socket.userId);
 broadcastUsers();
 }
});

});

const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>{
console.log('Matreshka running',PORT)
});
