import db from '../database/db.js';

// Middleware to require moderator or admin role
export const requireModerator = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Get fresh user data with role
    const user = await db.get(
      'SELECT id, username, role, is_banned FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!['moderator', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Moderator access required' });
    }

    // Add role info to request
    req.user = user;
    next();
  } catch (error) {
    console.error('Moderator check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Middleware to check if user is banned (for posting/commenting)
export const checkBanStatus = async (req, res, next) => {
  if (!req.user) {
    return next(); // Let authenticateToken handle this
  }

  try {
    const user = await db.get(
      'SELECT is_banned FROM users WHERE id = ?',
      [req.user.id]
    );

    if (user && user.is_banned) {
      return res.status(403).json({ 
        error: 'Your account has been banned from posting content' 
      });
    }

    next();
  } catch (error) {
    console.error('Ban status check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Log moderation action
export const logModerationAction = async (moderatorId, action, targetType, targetId, details = null) => {
  try {
    await db.run(`
      INSERT INTO moderation_logs (moderator_id, action, target_type, target_id, details)
      VALUES (?, ?, ?, ?, ?)
    `, [moderatorId, action, targetType, targetId, details]);
  } catch (error) {
    console.error('Failed to log moderation action:', error);
    // Don't throw - logging failure shouldn't break the operation
  }
};
