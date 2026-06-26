CREATE TABLE IF NOT EXISTS connection_requests (
  id SERIAL PRIMARY KEY,
  senderId INTEGER NOT NULL,
  receiverId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','rejected')),
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(senderId, receiverId),
  FOREIGN KEY(senderId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(receiverId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_connection_requests_receiver ON connection_requests(receiverId, status);