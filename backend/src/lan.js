import { createServer } from 'http';
import { Server } from 'socket.io';
import { verifyToken } from './auth.js';

const publicUser = u => ({ id:u.id, fullname:u.fullname, name:u.fullname, username:u.username, age:u.age, gender:u.gender, onlineStatus:true, createdAt:u.createdAt });

let io;
let httpServer;
const connectedUsers = new Map();

const broadcastPresence = () => {
  const users = Array.from(connectedUsers.values()).map(publicUser);
  io.emit('presence', users);
};

export function startLanServer(port, origin) {
  httpServer = createServer();
  io = new Server(httpServer, {
    cors: { origin },
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    try {
      const user = verifyToken(socket.handshake.auth.token);
      socket.user = user;
      next();
    } catch (e) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`LAN client ${socket.user.username} connected.`);
    connectedUsers.set(socket.user.sub, { ...socket.user, id: socket.user.sub });
    
    socket.emit('ready', { userId: socket.user.sub });
    broadcastPresence();

    socket.on('send_message', (payload, ack = () => {}) => {
      try {
        const message = {
          id: `${Date.now()}-${socket.user.sub}`,
          senderId: socket.user.sub,
          content: payload.content,
          replyToId: payload.replyToId,
          createdAt: new Date().toISOString(),
          username: socket.user.username,
          fullname: socket.user.fullname,
          readStatus: 'sent',
        };
        socket.broadcast.emit('receive_message', message);
        ack({ ok: true, message });
      } catch (e) {
        ack({ ok: false, message: e.message });
      }
    });

    socket.on('typing', (payload) => {
      socket.broadcast.emit('typing', { userId: socket.user.sub, ...payload });
    });

    socket.on('stop_typing', (payload) => {
      socket.broadcast.emit('stop_typing', { userId: socket.user.sub, ...payload });
    });

    socket.on('disconnect', () => {
      console.log(`LAN client ${socket.user.username} disconnected.`);
      connectedUsers.delete(socket.user.sub);
      broadcastPresence();
    });
  });

 httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} already in use. Try stopping the LAN server first.`);
  } else {
    console.error('LAN server error:', err);
  }
});
httpServer.listen(port);
}

export function stopLanServer() {
  if (io) {
    io.close();
    io = null;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  connectedUsers.clear();
  console.log('LAN server stopped.');
}
