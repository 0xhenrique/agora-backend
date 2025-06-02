import express from 'express';
import db from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Create new comment
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { postId, body, replyToId } = req.body;

    // Validation
    if (!postId || !body || body.trim().length === 0) {
      return res.status(400).json({ error: 'Post ID and comment body are required' });
    }

    if (body.length > 5000) {
      return res.status(400).json({ error: 'Comment too long (max 5000 characters)' });
    }

    // Verify post exists
    const post = await db.get('SELECT id FROM posts WHERE id = ?', [postId]);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // If replying to a comment, verify it exists and belongs to the same post
    if (replyToId) {
      const parentComment = await db.get(
        'SELECT id FROM comments WHERE id = ? AND post_id = ?', 
        [replyToId, postId]
      );
      if (!parentComment) {
        return res.status(404).json({ error: 'Parent comment not found' });
      }
    }

    // Create comment
    const result = await db.run(`
      INSERT INTO comments (post_id, author_id, body, reply_to_id)
      VALUES (?, ?, ?, ?)
    `, [
      postId,
      req.user.id,
      body.trim(),
      replyToId || null
    ]);

    // Get the created comment with author info
    const newComment = await db.get(`
      SELECT 
        c.id,
        c.body,
        c.reply_to_id as replyToId,
        c.votes,
        c.created_at as createdAt,
        u.username as author
      FROM comments c
      JOIN users u ON c.author_id = u.id
      WHERE c.id = ?
    `, [result.id]);

    res.status(201).json({
      message: 'Comment created successfully',
      comment: {
        ...newComment,
        userVote: null
      }
    });

  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get comments for a specific post (alternative endpoint)
router.get('/post/:postId', async (req, res) => {
  try {
    const postId = parseInt(req.params.postId);

    // Verify post exists
    const post = await db.get('SELECT id FROM posts WHERE id = ?', [postId]);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Get comments
    const comments = await db.all(`
      SELECT 
        c.id,
        c.body,
        c.reply_to_id as replyToId,
        c.votes,
        c.created_at as createdAt,
        u.username as author
      FROM comments c
      JOIN users u ON c.author_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `, [postId]);

    res.json({ comments });

  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
