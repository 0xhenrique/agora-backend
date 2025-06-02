-- Migration script for moderation system
-- Run this to add moderation features to existing database

-- Add role and ban status to users table
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin'));
ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT FALSE;

-- Create reports table
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  reported_item_id INTEGER NOT NULL,
  reported_item_type TEXT NOT NULL CHECK (reported_item_type IN ('post', 'comment')),
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE(reporter_id, reported_item_id, reported_item_type)
);

-- Create moderation logs table
CREATE TABLE IF NOT EXISTS moderation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moderator_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT CHECK (target_type IN ('post', 'comment', 'user', 'report')),
  target_id INTEGER,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (moderator_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_item ON reports(reported_item_id, reported_item_type);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(is_banned);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_moderator ON moderation_logs(moderator_id);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_created ON moderation_logs(created_at);

-- Update existing users to have default role (already handled by DEFAULT clause)
-- No need to update existing data since DEFAULT will apply
