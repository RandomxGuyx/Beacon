import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';
import { z } from 'zod';
import { db, migrate } from './db.js';
import { authenticate, signToken, verifyToken } from './auth.js';
import { startLanServer, stopLanServer } from './lan.js';

const app = express();
const server = http.createServer(app);
const origin = process.env.CLIENT_ORIGIN || '*';

app.use(helmet());
app.use(cors({ origin }));
app.use(express.json({ limit: '32kb' }));
app.use('/api/auth', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));

const io = new Server(server, { cors: { origin }, transports: ['websocket', 'polling'] });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicUser = u => ({ id: u.id, fullname: u.fullname, name: u.fullname, username: u.username, age: u.age, gender: u.gender, onlineStatus: Boolean(u.onlinestatus ?? u.onlineStatus), createdAt: u.createdat ?? u.createdAt });

const notify = async (userId, type, payload) => {
  const x = await db.prepare('INSERT INTO notifications(userId,type,payload) VALUES(?,?,?)').run(userId, type, JSON.stringify(payload));
  const n = { id: Number(x.lastInsertRowid), type, payload, isRead: false, createdAt: new Date().toISOString() };
  io.to(`user:${userId}`).emit('notification', n);
  return n;
};

app.get('/api/health', (_q, r) => r.json({ status: 'ok' }));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const s = z.object({
    fullname: z.string().trim().min(2).max(80),
    username: z.string().trim().regex(/^[a-zA-Z0-9_]{3,24}$/),
    age: z.coerce.number().int().min(13).max(120),
    gender: z.string().min(1).max(30),
    password: z.string().min(8).max(72),
    confirmPassword: z.string()
  }).refine(x => x.password === x.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] });
  const p = s.parse(req.body);
  if (await db.prepare('SELECT 1 FROM users WHERE username=?').get(p.username)) return res.status(409).json({ message: 'That username is already taken.' });
  const hash = await bcrypt.hash(p.password, 12);
  const x = await db.prepare('INSERT INTO users(fullname,username,age,gender,passwordHash) VALUES(?,?,?,?,?)').run(p.fullname, p.username, p.age, p.gender, hash);
  const u = await db.prepare('SELECT * FROM users WHERE id=?').get(x.lastInsertRowid);
  res.status(201).json({ message: 'Account created. Please log in.', username: u.username });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const p = z.object({ username: z.string().trim(), password: z.string() }).parse(req.body);
  const u = await db.prepare('SELECT * FROM users WHERE username=?').get(p.username);
  if (!u || !await bcrypt.compare(p.password, u.passwordhash ?? u.passwordHash)) return res.status(401).json({ message: 'Incorrect username or password.' });
  await db.prepare('UPDATE users SET lastLoginAt = NOW() WHERE id = ?').run(u.id);
  res.json({ token: signToken(u), user: publicUser(u) });
}));

app.get('/api/auth/me', authenticate, asyncRoute(async (req, res) => {
  const u = await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.sub);
  if (!u) return res.status(404).json({ message: 'Account not found.' });
  res.json(publicUser(u));
}));

app.get('/api/bootstrap', authenticate, asyncRoute(async (req, res) => {
  const id = +req.user.sub;
  const users = (await db.prepare('SELECT id,fullname,username,age,gender,onlineStatus,createdAt FROM users WHERE id<>? ORDER BY onlineStatus DESC,fullname').all(id)).map(publicUser);
  const connections = (await db.prepare("SELECT c.id,c.status,u.id userId,u.fullname,u.username,u.age,u.gender,u.onlineStatus,u.createdAt FROM connections c JOIN users u ON u.id=CASE WHEN c.senderid=? THEN c.receiverid ELSE c.senderid END WHERE (c.senderid=? OR c.receiverid=?) AND c.status='accepted'").all(id, id, id)).map(x => ({ ...x, onlineStatus: Boolean(x.onlinestatus ?? x.onlineStatus) }));
  const channels = await db.prepare('SELECT c.*,cm.role,(SELECT COUNT(*) FROM channel_members WHERE channelId=c.id) memberCount,(SELECT COUNT(*) FROM channel_members x JOIN users u ON u.id=x.userId WHERE x.channelId=c.id AND u.onlineStatus=1) onlineCount FROM channels c JOIN channel_members cm ON cm.channelId=c.id WHERE cm.userId=? AND c.id<>1').all(id);
  const notifications = (await db.prepare('SELECT * FROM notifications WHERE userId=? ORDER BY id DESC LIMIT 50').all(id)).map(x => ({ ...x, payload: JSON.parse(x.payload), isRead: Boolean(x.isread ?? x.isRead) }));
  res.json({ users, connections, channels, notifications });
}));

app.get('/api/messages', authenticate, asyncRoute(async (req, res) => {
  const id = +req.user.sub, limit = Math.min(+req.query.limit || 50, 100), before = +req.query.before || 2147483647;
  let rows;
  if (req.query.channelId) {
    rows = await db.prepare('SELECT m.*,u.username,u.fullname FROM messages m JOIN users u ON u.id=m.senderId WHERE m.channelId=? AND m.id<? ORDER BY m.id DESC LIMIT ?').all(+req.query.channelId, before, limit);
  } else {
    const other = +req.query.userId;
    rows = await db.prepare('SELECT m.*,u.username,u.fullname FROM messages m JOIN users u ON u.id=m.senderId WHERE ((senderId=? AND receiverId=?) OR (senderId=? AND receiverId=?)) AND m.id<? ORDER BY m.id DESC LIMIT ?').all(id, other, other, id, before, limit);
  }
  res.json(rows.reverse());
}));

app.delete('/api/messages', authenticate, asyncRoute(async (req, res) => {
  const me = +req.user.sub, other = +req.query.userId;
  if (!other) return res.status(400).json({ message: 'userId is required.' });
  if (!await db.prepare("SELECT 1 FROM connections WHERE status='accepted' AND ((senderId=? AND receiverId=?) OR (senderId=? AND receiverId=?))").get(me, other, other, me)) return res.status(403).json({ message: 'Only connections can clear a private chat.' });
  await db.prepare('DELETE FROM messages WHERE (senderId=? AND receiverId=?) OR (senderId=? AND receiverId=?)').run(me, other, other, me);
  io.to(`user:${me}`).to(`user:${other}`).emit('chat_cleared', { userIds: [me, other] });
  res.status(204).end();
}));

app.patch('/api/users/me', authenticate, asyncRoute(async (req, res) => {
  const p = z.object({ fullname: z.string().trim().min(2).max(80), age: z.coerce.number().int().min(13).max(120), gender: z.string().min(1).max(30) }).parse(req.body);
  await db.prepare('UPDATE users SET fullname=?,age=?,gender=? WHERE id=?').run(p.fullname, p.age, p.gender, req.user.sub);
  res.json(publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.sub)));
}));

app.delete('/api/users/me', authenticate, asyncRoute(async (req, res) => {
  await db.prepare('DELETE FROM users WHERE id=?').run(req.user.sub);
  io.in(`user:${req.user.sub}`).disconnectSockets();
  res.status(204).end();
}));

async function createConnectionRequest(from, to, res) {
  if (from === to) return res.status(400).json({ message: 'You cannot connect with yourself.' });
  if (await db.prepare("SELECT 1 FROM connections WHERE status='accepted' AND ((senderId=? AND receiverId=?) OR (senderId=? AND receiverId=?))").get(from, to, to, from)) return res.status(409).json({ message: 'Already connected.' });
  const pending = await db.prepare("SELECT * FROM connection_requests WHERE status='pending' AND ((senderId=? AND receiverId=?) OR (senderId=? AND receiverId=?))").get(from, to, to, from);
  if (pending) return res.status(409).json({ message: pending.senderid === from ? 'Connection request already sent.' : 'This user already sent you a request. Check notifications.' });
  await db.prepare("INSERT INTO connection_requests(senderId,receiverId,status) VALUES(?,?,'pending') ON CONFLICT(senderId,receiverId) DO UPDATE SET status='pending',createdAt=NOW()").run(from, to);
  const request = await db.prepare("SELECT * FROM connection_requests WHERE senderId=? AND receiverId=?").get(from, to);
  const sender = publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(from));
  const n = await notify(to, 'connection_request', { connectionId: request.id, from: sender });
  io.to(`user:${to}`).emit('connection_request', { id: request.id, from: sender, notification: n });
  return res.status(201).json({ id: request.id, status: 'pending' });
}

app.post('/api/connections/by-username', authenticate, asyncRoute(async (req, res) => {
  const username = z.string().trim().min(1).parse(req.body.username);
  const target = await db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (!target) return res.status(404).json({ message: 'User not found.' });
  return createConnectionRequest(+req.user.sub, target.id, res);
}));

app.post('/api/connections/:userId', authenticate, asyncRoute(async (req, res) => {
  return createConnectionRequest(+req.user.sub, +req.params.userId, res);
}));

app.patch('/api/connections/:id', authenticate, asyncRoute(async (req, res) => {
  const status = z.enum(['accepted', 'rejected']).parse(req.body.status);
  const c = await db.prepare("SELECT * FROM connection_rerquests WHERE id=? AND receiverId=? AND status='pending'").get(req.params.id, req.user.sub);
  if (!c) return res.status(404).json({ message: 'Request not found.' });
  if (status === 'accepted') {
    await db.prepare("UPDATE connection_requests SET status='accepted' WHERE id=?").run(c.id);
await db.prepare("INSERT INTO connections(senderId,receiverId,status) VALUES(?,?,'accepted')").run(c.senderid, c.receiverid);
    await notify(c.senderid ?? c.senderId, 'connection_accept', { connectionId: c.id, userId: +req.user.sub });
    const update = { id: c.id, status: 'accepted', userId: +req.user.sub };
    io.to(`user:${c.senderid ?? c.senderId}`).to(`user:${c.receiverid ?? c.receiverId}`).emit('connection_accepted', update);
    io.to(`user:${c.senderid ?? c.senderId}`).to(`user:${c.receiverid ?? c.receiverId}`).emit('connection_accept', update);
  } else {
    await db.prepare("UPDATE connections SET status='rejected' WHERE id=?").run(c.id);
    io.to(`user:${c.senderid ?? c.senderId}`).emit('connection_rejected', { id: c.id, status });
  }
  res.json({ id: c.id, status });
}));

app.delete('/api/connections/user/:userId', authenticate, asyncRoute(async (req, res) => {
  const me = +req.user.sub, other = +req.params.userId;
  const result = await db.prepare("DELETE FROM connections WHERE status='accepted' AND ((senderId=? AND receiverId=?) OR (senderId=? AND receiverId=?))").run(me, other, other, me);
  if (!result.changes) return res.status(404).json({ message: 'Connection not found.' });
  io.to(`user:${me}`).to(`user:${other}`).emit('connection_removed', { userIds: [me, other] });
  res.status(204).end();
}));

app.post('/api/channels', authenticate, asyncRoute(async (req, res) => {
  const p = z.object({
    name: z.string().trim().min(2).max(60),
    channelUsername: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,30}$/),
    password: z.string().max(72).optional(),
    members: z.array(z.string()).default([])
  }).parse(req.body);
  const members = [...new Set(p.members.map(x => x.toLowerCase()).filter(x => x !== req.user.username.toLowerCase()))];
  const found = members.length > 0
    ? await db.prepare(`SELECT id,username FROM users WHERE username IN (${members.map(() => '?').join(',')})`).all(...members)
    : [];
  if (found.length !== members.length) return res.status(400).json({ message: 'One or more usernames do not exist.' });
  const hash = p.password ? await bcrypt.hash(p.password, 12) : null;
  const x = await db.prepare('INSERT INTO channels(name,channelUsername,passwordHash,createdBy) VALUES(?,?,?,?)').run(p.name, p.channelUsername, hash, req.user.sub);
  const channelId = x.lastInsertRowid;
  await db.prepare("INSERT INTO channel_members(channelId,userId,role) VALUES(?,?,'admin')").run(channelId, req.user.sub);
  for (const u of found) await notify(u.id, 'channel_invitation', { channelId: Number(channelId), channelName: p.name, invitedBy: req.user.username });
  const channel = await db.prepare('SELECT * FROM channels WHERE id=?').get(channelId);
  res.status(201).json(channel);
}));

app.post('/api/channels/join', authenticate, asyncRoute(async (req, res) => {
  const p = z.object({ channelUsername: z.string().trim(), password: z.string().default('') }).parse(req.body);
  const c = await db.prepare('SELECT * FROM channels WHERE channelUsername=? AND id<>1').get(p.channelUsername);
  if (!c || (c.passwordhash ?? c.passwordHash) && !await bcrypt.compare(p.password, c.passwordhash ?? c.passwordHash)) return res.status(401).json({ message: 'Invalid channel username or password.' });
  await db.prepare("INSERT INTO channel_members(channelId,userId,role) VALUES(?,?,'member') ON CONFLICT DO NOTHING").run(c.id, req.user.sub);
  res.json(c);
}));

app.post('/api/channels/:id/invitation', authenticate, asyncRoute(async (req, res) => {
  const action = z.enum(['join', 'reject']).parse(req.body.action);
  const allNotifs = await db.prepare("SELECT * FROM notifications WHERE userId=? AND type='channel_invitation' AND isRead=0 ORDER BY id DESC").all(req.user.sub);
  const n = allNotifs.find(x => JSON.parse(x.payload).channelId === +req.params.id);
  if (!n) return res.status(404).json({ message: 'Invitation not found.' });
  if (action === 'join') await db.prepare("INSERT INTO channel_members(channelId,userId,role) VALUES(?,?,'member') ON CONFLICT DO NOTHING").run(req.params.id, req.user.sub);
  await db.prepare('UPDATE notifications SET isRead=1 WHERE id=?').run(n.id);
  res.json({ joined: action === 'join' });
}));

app.post('/api/channels/:id/members', authenticate, asyncRoute(async (req, res) => {
  const admin = await db.prepare("SELECT 1 FROM channel_members WHERE channelId=? AND userId=? AND role='admin'").get(req.params.id, req.user.sub);
  if (!admin) return res.status(403).json({ message: 'Admin access required.' });
  const username = z.string().trim().parse(req.body.username);
  const u = await db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u) return res.status(404).json({ message: 'Username not found.' });
  const ch = await db.prepare('SELECT name FROM channels WHERE id=?').get(req.params.id);
  await notify(u.id, 'channel_invitation', { channelId: +req.params.id, channelName: ch.name, invitedBy: req.user.username });
  res.status(201).json({ invited: true });
}));

app.patch('/api/messages/:id', authenticate, asyncRoute(async (req, res) => {
  const content = z.string().trim().min(1).max(4000).parse(req.body.content);
  const m = await db.prepare('SELECT * FROM messages WHERE id=? AND senderId=? AND deletedAt IS NULL').get(req.params.id, req.user.sub);
  if (!m) return res.status(404).json({ message: 'Message not found.' });
  await db.prepare('UPDATE messages SET content=?,editedAt=NOW() WHERE id=?').run(content, m.id);
  const updated = await db.prepare('SELECT * FROM messages WHERE id=?').get(m.id);
  io.to((m.channelid ?? m.channelId) ? `channel:${m.channelid ?? m.channelId}` : `user:${m.receiverid ?? m.receiverId}`).emit('message_updated', updated);
  res.json(updated);
}));

app.delete('/api/messages/:id', authenticate, asyncRoute(async (req, res) => {
  const m = await db.prepare('SELECT * FROM messages WHERE id=? AND senderId=?').get(req.params.id, req.user.sub);
  if (!m) return res.status(404).json({ message: 'Message not found.' });
  await db.prepare("UPDATE messages SET content='',deletedAt=NOW() WHERE id=?").run(m.id);
  io.to((m.channelid ?? m.channelId) ? `channel:${m.channelid ?? m.channelId}` : `user:${m.receiverid ?? m.receiverId}`).emit('message_deleted', { messageId: m.id });
  res.status(204).end();
}));

app.post('/api/messages/:id/reactions', authenticate, asyncRoute(async (req, res) => {
  const emoji = z.string().min(1).max(16).parse(req.body.emoji);
  await db.prepare('INSERT INTO reactions(messageId,userId,emoji) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(req.params.id, req.user.sub, emoji);
  res.status(201).json({ messageId: +req.params.id, emoji });
}));

app.delete('/api/channels/:id', authenticate, asyncRoute(async (req, res) => {
  const c = await db.prepare("SELECT 1 FROM channel_members WHERE channelId=? AND userId=? AND role='admin'").get(req.params.id, req.user.sub);
  if (!c || +req.params.id === 1) return res.status(403).json({ message: 'Only the channel admin can delete it.' });
  await db.prepare('DELETE FROM channels WHERE id=?').run(req.params.id);
  io.to(`channel:${req.params.id}`).emit('leave_channel', { channelId: +req.params.id, deleted: true });
  res.status(204).end();
}));

app.delete('/api/channels/:id/members/:userId', authenticate, asyncRoute(async (req, res) => {
  const admin = await db.prepare("SELECT 1 FROM channel_members WHERE channelId=? AND userId=? AND role='admin'").get(req.params.id, req.user.sub);
  if (!admin) return res.status(403).json({ message: 'Admin access required.' });
  await db.prepare('DELETE FROM channel_members WHERE channelId=? AND userId=?').run(req.params.id, req.params.userId);
  io.to(`user:${req.params.userId}`).emit('leave_channel', { channelId: +req.params.id });
  res.status(204).end();
}));

app.patch('/api/notifications/:id/read', authenticate, asyncRoute(async (req, res) => {
  await db.prepare('UPDATE notifications SET isRead=1 WHERE id=? AND userId=?').run(req.params.id, req.user.sub);
  res.status(204).end();
}));

// ── LAN routes ──────────────────────────────────────────────────────────────
let lanServer = null;
app.post('/api/lan/host', authenticate, (req, res) => {
  if (lanServer) return res.status(409).json({ message: 'LAN server already running.' });
  const port = Number(process.env.LAN_PORT) || 8081;
  lanServer = startLanServer(port, origin);
  res.json({ message: `LAN server started on http://localhost:${port}`, address: `http://localhost:${port}` });
});
app.post('/api/lan/stop', authenticate, (req, res) => {
  if (!lanServer) return res.status(409).json({ message: 'LAN server not running.' });
  stopLanServer();
  lanServer = null;
  res.json({ message: 'LAN server stopped.' });
});

// ── Socket.IO ────────────────────────────────────────────────────────────────
io.use((socket, next) => {
  try { socket.user = verifyToken(socket.handshake.auth.token); next(); }
  catch { next(new Error('unauthorized')); }
});

const online = new Map();
const broadcastPresence = async () => {
  const users = await db.prepare('SELECT id,fullname,username,onlineStatus FROM users ORDER BY fullname').all();
  io.emit('presence', users.map(publicUser));
};

io.on('connection', async socket => {
  const id = +socket.user.sub;
  socket.join(`user:${id}`);
  const count = (online.get(id) || 0) + 1;
  online.set(id, count);
  await db.prepare('UPDATE users SET onlineStatus=1 WHERE id=?').run(id);
  socket.emit('ready', { userId: id });
  io.emit('user_online', { userId: id });
  await broadcastPresence();
  const channelIds = await db.prepare('SELECT channelId FROM channel_members WHERE userId=?').all(id);
  channelIds.forEach(x => socket.join(`channel:${x.channelid ?? x.channelId}`));

  socket.on('send_message', async (payload, ack = () => {}) => {
    try {
      const p = z.object({
        content: z.string().trim().min(1).max(4000),
        receiverId: z.number().int().optional(),
        channelId: z.number().int().optional(),
        replyToId: z.number().int().optional()
      }).refine(x => Boolean(x.receiverId) !== Boolean(x.channelId)).parse(payload);
      if (p.channelId && !await db.prepare('SELECT 1 FROM channel_members WHERE channelId=? AND userId=?').get(p.channelId, id)) throw Error('Not a channel member.');
      if (p.receiverId && !await db.prepare("SELECT 1 FROM connections WHERE status='accepted' AND ((senderId=? AND receiverId=?) OR (senderId=? AND receiverId=?))").get(id, p.receiverId, p.receiverId, id)) throw Error('Private messages require an accepted connection.');
      const x = await db.prepare('INSERT INTO messages(senderId,receiverId,channelId,content,replyToId) VALUES(?,?,?,?,?)').run(id, p.receiverId || null, p.channelId || null, p.content, p.replyToId || null);
      const m = { ...await db.prepare('SELECT m.*,u.username,u.fullname FROM messages m JOIN users u ON u.id=m.senderId WHERE m.id=?').get(x.lastInsertRowid), readStatus: 'sent' };
      if (p.channelId) {
        io.to(`channel:${p.channelId}`).emit('receive_message', m);
        io.to(`channel:${p.channelId}`).emit('channel_message', m);
      } else {
        io.to(`user:${id}`).to(`user:${p.receiverId}`).emit('receive_message', m);
        io.to(`user:${id}`).to(`user:${p.receiverId}`).emit('private_message', m);
        if (online.has(p.receiverId)) {
          await db.prepare("UPDATE messages SET readStatus='delivered' WHERE id=?").run(m.id);
          m.readStatus = 'delivered';
        }
      }
      ack({ ok: true, message: m });
    } catch (e) { ack({ ok: false, message: e.message }); }
  });

  socket.on('typing', p => { const room = p.channelId ? `channel:${p.channelId}` : `user:${p.receiverId}`; socket.to(room).emit('typing', { userId: id, ...p }); });
  socket.on('stop_typing', p => { const room = p.channelId ? `channel:${p.channelId}` : `user:${p.receiverId}`; socket.to(room).emit('stop_typing', { userId: id, ...p }); });

  socket.on('join_channel', async ({ channelId }, ack = () => {}) => {
    if (await db.prepare('SELECT 1 FROM channel_members WHERE channelId=? AND userId=?').get(channelId, id)) {
      socket.join(`channel:${channelId}`);
      ack({ ok: true });
    } else ack({ ok: false, message: 'Not a channel member.' });
  });

  socket.on('message_read', async ({ messageId }) => {
    const m = await db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
    if (m && (m.receiverid ?? m.receiverId) === id) {
      await db.prepare("UPDATE messages SET readStatus='read' WHERE id=?").run(messageId);
      io.to(`user:${m.senderid ?? m.senderId}`).emit('message_read', { messageId });
    }
  });

  socket.on('disconnect', async () => {
    const left = (online.get(id) || 1) - 1;
    if (left <= 0) {
      online.delete(id);
      await db.prepare('UPDATE users SET onlineStatus=0 WHERE id=?').run(id);
      io.emit('user_offline', { userId: id });
      await broadcastPresence();
    } else online.set(id, left);
  });
});

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid input.', issues: err.issues });
  if (err.code === '23505') return res.status(409).json({ message: 'That value already exists.' }); // PostgreSQL unique violation
  console.error(err);
  res.status(500).json({ message: 'Unexpected server error.' });
});

// ── Inactive user cleanup ────────────────────────────────────────────────────
const cleanupInactiveUsers = async () => {
  console.log('Running inactive user cleanup task...');
  try {
    const inactiveUsers = await db.prepare(`
      SELECT id FROM users
      WHERE id <> 1 AND (
        (lastLoginAt IS NOT NULL AND lastLoginAt < NOW() - INTERVAL '15 days') OR
        (lastLoginAt IS NULL AND createdAt < NOW() - INTERVAL '15 days')
      )
    `).all();
    if (inactiveUsers.length > 0) {
      const idsToDelete = inactiveUsers.map(u => u.id);
      const placeholders = idsToDelete.map((_, i) => `$${i + 1}`).join(',');
      await db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...idsToDelete);
      idsToDelete.forEach(id => io.in(`user:${id}`).disconnectSockets());
      console.log(`Cleaned up ${idsToDelete.length} inactive user(s).`);
    }
  } catch (error) { console.error('Error during inactive user cleanup:', error); }
};

// ── Start server ─────────────────────────────────────────────────────────────
migrate().then(() => {
  setInterval(cleanupInactiveUsers, 24 * 60 * 60 * 1000);
  cleanupInactiveUsers();
  server.listen(Number(process.env.PORT) || 8080, '0.0.0.0', () =>
    console.log(`Beacon listening on http://0.0.0.0:${process.env.PORT || 8080}`)
  );
}).catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});