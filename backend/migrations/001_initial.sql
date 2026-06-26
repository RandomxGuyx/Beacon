CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  fullname TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  age INTEGER NOT NULL CHECK(age BETWEEN 13 AND 120),
  gender TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  onlineStatus INTEGER NOT NULL DEFAULT 0,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connections (
  id SERIAL PRIMARY KEY,
  senderId INTEGER NOT NULL,
  receiverId INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(senderId, receiverId),
  FOREIGN KEY(senderId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(receiverId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  channelUsername TEXT NOT NULL UNIQUE,
  passwordHash TEXT,
  createdBy INTEGER,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(createdBy) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_members (
  id SERIAL PRIMARY KEY,
  channelId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
  joinedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channelId, userId),
  FOREIGN KEY(channelId) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  senderId INTEGER NOT NULL,
  receiverId INTEGER,
  channelId INTEGER,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  replyToId INTEGER,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  editedAt TIMESTAMPTZ,
  readStatus TEXT NOT NULL DEFAULT 'sent' CHECK(readStatus IN ('sent','delivered','read')),
  deletedAt TIMESTAMPTZ,
  FOREIGN KEY(senderId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(receiverId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(channelId) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reactions (
  id SERIAL PRIMARY KEY,
  messageId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  UNIQUE(messageId, userId, emoji),
  FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  userId INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  isRead INTEGER NOT NULL DEFAULT 0,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channelId, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_direct ON messages(senderId, receiverId, id DESC);

INSERT INTO channels(id, name, channelUsername, createdBy)
VALUES(1, 'General', 'general', NULL)
ON CONFLICT DO NOTHING;