import express from 'express';
import db from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireModerator, logModerationAction } from '../middleware/moderation.js';

const router = express.Router();

// All moderation routes require moderator access
router.use(authenticateToken);
router.use(requireModerator);

// Get moderation statistics
router.get('/stats', async (req, res) => {
  try {
    const [
      totalPosts,
      totalComments,
      reportedPosts,
      reportedComments,
      totalUsers,
      bannedUsers
    ] = await Promise.all([
      db.get('SELECT COUNT(*) as count FROM posts'),
      db.get('SELECT COUNT(*) as count FROM comments'),
      db.get(`
        SELECT COUNT(DISTINCT reported_item_id) as count 
        FROM reports 
        WHERE reported_item_type = 'post' AND status = 'pending'
      `),
      db.get(`
        SELECT COUNT(DISTINCT reported_item_id) as count 
        FROM reports 
        WHERE reported_item_type = 'comment' AND status = 'pending'
      `),
      db.get('SELECT COUNT(*) as count FROM users'),
      db.get('SELECT COUNT(*) as count FROM users WHERE is_banned = 1')
    ]);

    res.json({
      totalPosts: totalPosts.count,
      totalComments: totalComments.count,
      reportedPosts: reportedPosts.count,
      reportedComments: reportedComments.count,
      totalUsers: totalUsers.count,
      bannedUsers: bannedUsers.count
    });
  } catch (error) {
    console.error('Get mod stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get posts with moderation info
router.get('/posts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const author = req.query.author || '';
    const sortBy = req.query.sortBy || 'created_at';
    const status = req.query.status || 'all'; // all, reported, normal

    let whereClause = 'WHERE 1=1';
    let params = [];

    if (search) {
      whereClause += ' AND (p.title LIKE ? OR p.body LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (author) {
      whereClause += ' AND u.username LIKE ?';
      params.push(`%${author}%`);
    }

    if (status === 'reported') {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM reports r 
        WHERE r.reported_item_id = p.id 
        AND r.reported_item_type = 'post' 
        AND r.status = 'pending'
      )`;
    } else if (status === 'normal') {
      whereClause += ` AND NOT EXISTS (
        SELECT 1 FROM reports r 
        WHERE r.reported_item_id = p.id 
        AND r.reported_item_type = 'post' 
        AND r.status = 'pending'
      )`;
    }

    const orderBy = sortBy === 'votes' ? 'p.votes DESC' : 'p.created_at DESC';

    const posts = await db.all(`
      SELECT 
        p.id,
        p.title,
        p.url,
        p.image_url as imageUrl,
        p.body,
        p.votes,
        p.created_at as createdAt,
        u.username as author,
        u.is_banned as authorBanned,
        COUNT(c.id) as commentCount,
        CASE WHEN r.reported_item_id IS NOT NULL THEN 1 ELSE 0 END as isReported
      FROM posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN comments c ON p.id = c.post_id
      LEFT JOIN (
        SELECT DISTINCT reported_item_id 
        FROM reports 
        WHERE reported_item_type = 'post' AND status = 'pending'
      ) r ON p.id = r.reported_item_id
      ${whereClause}
      GROUP BY p.id
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.json({
      posts,
      pagination: {
        page,
        limit,
        hasMore: posts.length === limit
      }
    });

  } catch (error) {
    console.error('Get mod posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete specific post
router.delete('/posts/:id', async (req, res) => {
  try {
    const postId = parseInt(req.params.id);

    // Verify post exists
    const post = await db.get('SELECT id, title FROM posts WHERE id = ?', [postId]);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Delete post (cascade will handle comments and votes)
    await db.run('DELETE FROM posts WHERE id = ?', [postId]);

    // Log action
    await logModerationAction(
      req.user.id, 
      'delete_post', 
      'post', 
      postId, 
      `Deleted post: "${post.title}"`
    );

    res.json({ message: 'Post deleted successfully' });

  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk delete posts
router.post('/posts/bulk-delete', async (req, res) => {
  try {
    const { postIds } = req.body;

    if (!Array.isArray(postIds) || postIds.length === 0) {
      return res.status(400).json({ error: 'postIds array is required' });
    }

    // Get post titles for logging
    const posts = await db.all(`
      SELECT id, title FROM posts WHERE id IN (${postIds.map(() => '?').join(',')})
    `, postIds);

    if (posts.length === 0) {
      return res.status(404).json({ error: 'No posts found' });
    }

    // Delete posts
    await db.run(`
      DELETE FROM posts WHERE id IN (${postIds.map(() => '?').join(',')})
    `, postIds);

    // Log action
    await logModerationAction(
      req.user.id,
      'bulk_delete_posts',
      'post',
      null,
      `Bulk deleted ${posts.length} posts: ${posts.map(p => p.title).join(', ')}`
    );

    res.json({ 
      message: `${posts.length} posts deleted successfully`,
      deletedCount: posts.length
    });

  } catch (error) {
    console.error('Bulk delete posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get comments with moderation info
router.get('/comments', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const author = req.query.author || '';
    const sortBy = req.query.sortBy || 'created_at';
    const status = req.query.status || 'all';

    let whereClause = 'WHERE 1=1';
    let params = [];

    if (search) {
      whereClause += ' AND (c.body LIKE ? OR p.title LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (author) {
      whereClause += ' AND u.username LIKE ?';
      params.push(`%${author}%`);
    }

    if (status === 'reported') {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM reports r 
        WHERE r.reported_item_id = c.id 
        AND r.reported_item_type = 'comment' 
        AND r.status = 'pending'
      )`;
    } else if (status === 'normal') {
      whereClause += ` AND NOT EXISTS (
        SELECT 1 FROM reports r 
        WHERE r.reported_item_id = c.id 
        AND r.reported_item_type = 'comment' 
        AND r.status = 'pending'
      )`;
    }

    const orderBy = sortBy === 'votes' ? 'c.votes DESC' : 'c.created_at DESC';

    const comments = await db.all(`
      SELECT 
        c.id,
        c.body,
        c.votes,
        c.created_at as createdAt,
        u.username as author,
        u.is_banned as authorBanned,
        p.id as postId,
        p.title as postTitle,
        CASE WHEN r.reported_item_id IS NOT NULL THEN 1 ELSE 0 END as isReported
      FROM comments c
      JOIN users u ON c.author_id = u.id
      JOIN posts p ON c.post_id = p.id
      LEFT JOIN (
        SELECT DISTINCT reported_item_id 
        FROM reports 
        WHERE reported_item_type = 'comment' AND status = 'pending'
      ) r ON c.id = r.reported_item_id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.json({
      comments,
      pagination: {
        page,
        limit,
        hasMore: comments.length === limit
      }
    });

  } catch (error) {
    console.error('Get mod comments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete specific comment
router.delete('/comments/:id', async (req, res) => {
  try {
    const commentId = parseInt(req.params.id);

    // Verify comment exists
    const comment = await db.get('SELECT id, body FROM comments WHERE id = ?', [commentId]);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Delete comment
    await db.run('DELETE FROM comments WHERE id = ?', [commentId]);

    // Log action
    await logModerationAction(
      req.user.id,
      'delete_comment',
      'comment',
      commentId,
      `Deleted comment: "${comment.body.substring(0, 50)}..."`
    );

    res.json({ message: 'Comment deleted successfully' });

  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk delete comments
router.post('/comments/bulk-delete', async (req, res) => {
  try {
    const { commentIds } = req.body;

    if (!Array.isArray(commentIds) || commentIds.length === 0) {
      return res.status(400).json({ error: 'commentIds array is required' });
    }

    // Get comment info for logging
    const comments = await db.all(`
      SELECT id, body FROM comments WHERE id IN (${commentIds.map(() => '?').join(',')})
    `, commentIds);

    if (comments.length === 0) {
      return res.status(404).json({ error: 'No comments found' });
    }

    // Delete comments
    await db.run(`
      DELETE FROM comments WHERE id IN (${commentIds.map(() => '?').join(',')})
    `, commentIds);

    // Log action
    await logModerationAction(
      req.user.id,
      'bulk_delete_comments',
      'comment',
      null,
      `Bulk deleted ${comments.length} comments`
    );

    res.json({ 
      message: `${comments.length} comments deleted successfully`,
      deletedCount: comments.length
    });

  } catch (error) {
    console.error('Bulk delete comments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get users list with stats
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'created_at';

    let whereClause = 'WHERE 1=1';
    let params = [];

    if (search) {
      whereClause += ' AND u.username LIKE ?';
      params.push(`%${search}%`);
    }

    const orderBy = sortBy === 'posts' ? 'postCount DESC' : 
                   sortBy === 'comments' ? 'commentCount DESC' : 
                   'u.created_at DESC';

    const users = await db.all(`
      SELECT 
        u.id,
        u.username,
        u.role,
        u.is_banned as isBanned,
        u.created_at as createdAt,
        COUNT(DISTINCT p.id) as postCount,
        COUNT(DISTINCT c.id) as commentCount
      FROM users u
      LEFT JOIN posts p ON u.id = p.author_id
      LEFT JOIN comments c ON u.id = c.author_id
      ${whereClause}
      GROUP BY u.id
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.json({
      users,
      pagination: {
        page,
        limit,
        hasMore: users.length === limit
      }
    });

  } catch (error) {
    console.error('Get mod users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile with content
router.get('/users/:username', async (req, res) => {
  try {
    const { username } = req.params;

    // Get user info
    const user = await db.get(`
      SELECT 
        u.id,
        u.username,
        u.role,
        u.is_banned as isBanned,
        u.created_at as createdAt,
        COUNT(DISTINCT p.id) as postCount,
        COUNT(DISTINCT c.id) as commentCount
      FROM users u
      LEFT JOIN posts p ON u.id = p.author_id
      LEFT JOIN comments c ON u.id = c.author_id
      WHERE u.username = ?
      GROUP BY u.id
    `, [username]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's posts
    const posts = await db.all(`
      SELECT 
        p.id,
        p.title,
        p.url,
        p.image_url as imageUrl,
        p.body,
        p.votes,
        p.created_at as createdAt,
        COUNT(c.id) as commentCount
      FROM posts p
      LEFT JOIN comments c ON p.id = c.post_id
      WHERE p.author_id = ?
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [user.id]);

    // Get user's comments
    const comments = await db.all(`
      SELECT 
        c.id,
        c.body,
        c.votes,
        c.created_at as createdAt,
        p.id as postId,
        p.title as postTitle
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      WHERE c.author_id = ?
      ORDER BY c.created_at DESC
    `, [user.id]);

    res.json({
      ...user,
      posts,
      comments
    });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ban user
router.post('/users/:username/ban', async (req, res) => {
  try {
    const { username } = req.params;

    // Get user
    const user = await db.get('SELECT id, username, is_banned FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.is_banned) {
      return res.status(400).json({ error: 'User is already banned' });
    }

    // Ban user
    await db.run('UPDATE users SET is_banned = 1 WHERE id = ?', [user.id]);

    // Log action
    await logModerationAction(
      req.user.id,
      'ban_user',
      'user',
      user.id,
      `Banned user: ${username}`
    );

    res.json({ message: `User ${username} has been banned` });

  } catch (error) {
    console.error('Ban user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unban user
router.post('/users/:username/unban', async (req, res) => {
  try {
    const { username } = req.params;

    // Get user
    const user = await db.get('SELECT id, username, is_banned FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.is_banned) {
      return res.status(400).json({ error: 'User is not banned' });
    }

    // Unban user
    await db.run('UPDATE users SET is_banned = 0 WHERE id = ?', [user.id]);

    // Log action
    await logModerationAction(
      req.user.id,
      'unban_user',
      'user',
      user.id,
      `Unbanned user: ${username}`
    );

    res.json({ message: `User ${username} has been unbanned` });

  } catch (error) {
    console.error('Unban user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete all user's content
router.delete('/users/:username/content', async (req, res) => {
  try {
    const { username } = req.params;

    // Get user
    const user = await db.get('SELECT id, username FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get counts for logging
    const postCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE author_id = ?', [user.id]);
    const commentCount = await db.get('SELECT COUNT(*) as count FROM comments WHERE author_id = ?', [user.id]);

    // Delete user's posts and comments (cascade will handle votes)
    await db.run('DELETE FROM posts WHERE author_id = ?', [user.id]);
    await db.run('DELETE FROM comments WHERE author_id = ?', [user.id]);

    // Log action
    await logModerationAction(
      req.user.id,
      'delete_user_content',
      'user',
      user.id,
      `Deleted all content for user ${username}: ${postCount.count} posts, ${commentCount.count} comments`
    );

    res.json({ 
      message: `All content for user ${username} has been deleted`,
      deletedPosts: postCount.count,
      deletedComments: commentCount.count
    });

  } catch (error) {
    console.error('Delete user content error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all reports
router.get('/reports', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status || 'pending';

    const reports = await db.all(`
      SELECT 
        r.id,
        r.reported_item_id as itemId,
        r.reported_item_type as itemType,
        r.reason,
        r.status,
        r.created_at as createdAt,
        reporter.username as reporter,
        CASE 
          WHEN r.reported_item_type = 'post' THEN p.title
          WHEN r.reported_item_type = 'comment' THEN SUBSTR(c.body, 1, 50) || '...'
        END as itemTitle,
        CASE 
          WHEN r.reported_item_type = 'post' THEN author_p.username
          WHEN r.reported_item_type = 'comment' THEN author_c.username
        END as itemAuthor
      FROM reports r
      JOIN users reporter ON r.reporter_id = reporter.id
      LEFT JOIN posts p ON r.reported_item_type = 'post' AND r.reported_item_id = p.id
      LEFT JOIN users author_p ON p.author_id = author_p.id
      LEFT JOIN comments c ON r.reported_item_type = 'comment' AND r.reported_item_id = c.id
      LEFT JOIN users author_c ON c.author_id = author_c.id
      WHERE r.status = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [status, limit, offset]);

    res.json({
      reports,
      pagination: {
        page,
        limit,
        hasMore: reports.length === limit
      }
    });

  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dismiss report
router.post('/reports/:id/dismiss', async (req, res) => {
  try {
    const reportId = parseInt(req.params.id);

    // Verify report exists
    const report = await db.get('SELECT * FROM reports WHERE id = ?', [reportId]);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Update report status
    await db.run('UPDATE reports SET status = ? WHERE id = ?', ['dismissed', reportId]);

    // Log action
    await logModerationAction(
      req.user.id,
      'dismiss_report',
      'report',
      reportId,
      `Dismissed report for ${report.reported_item_type} ${report.reported_item_id}`
    );

    res.json({ message: 'Report dismissed successfully' });

  } catch (error) {
    console.error('Dismiss report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
