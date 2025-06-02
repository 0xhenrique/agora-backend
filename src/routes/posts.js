import express from 'express';
import db from '../database/db.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { checkBanStatus } from '../middleware/moderation.js';

const router = express.Router();

// Get all posts (with pagination and user votes)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Get posts with author usernames, comment counts, and author ban status
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
        COUNT(c.id) as commentCount
      FROM posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN comments c ON p.id = c.post_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // If user is authenticated, get their votes
    let userVotes = {};
    if (req.user) {
      const votes = await db.all(`
        SELECT item_id, vote_type 
        FROM votes 
        WHERE user_id = ? AND item_type = 'post' AND item_id IN (${posts.map(() => '?').join(',')})
      `, [req.user.id, ...posts.map(p => p.id)]);
      
      userVotes = votes.reduce((acc, vote) => {
        acc[vote.item_id] = vote.vote_type;
        return acc;
      }, {});
    }

    // Add user vote info to posts and convert authorBanned to boolean
    const postsWithVotes = posts.map(post => ({
      ...post,
      authorBanned: Boolean(post.authorBanned),
      userVote: userVotes[post.id] || null
    }));

    res.json({
      posts: postsWithVotes,
      pagination: {
        page,
        limit,
        hasMore: posts.length === limit
      }
    });

  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single post with comments
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);

    // Get post with author info
    const post = await db.get(`
      SELECT 
        p.id,
        p.title,
        p.url,
        p.image_url as imageUrl,
        p.body,
        p.votes,
        p.created_at as createdAt,
        u.username as author,
        u.is_banned as authorBanned
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `, [postId]);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Get comments with author info
    const comments = await db.all(`
      SELECT 
        c.id,
        c.body,
        c.reply_to_id as replyToId,
        c.votes,
        c.created_at as createdAt,
        u.username as author,
        u.is_banned as authorBanned
      FROM comments c
      JOIN users u ON c.author_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `, [postId]);

    // Get user votes if authenticated
    let userVotes = {};
    if (req.user) {
      const allItemIds = [postId, ...comments.map(c => c.id)];
      const votes = await db.all(`
        SELECT item_id, item_type, vote_type 
        FROM votes 
        WHERE user_id = ? AND item_id IN (${allItemIds.map(() => '?').join(',')})
      `, [req.user.id, ...allItemIds]);
      
      userVotes = votes.reduce((acc, vote) => {
        const key = `${vote.item_type}_${vote.item_id}`;
        acc[key] = vote.vote_type;
        return acc;
      }, {});
    }

    // Add user vote info and convert authorBanned to boolean
    post.authorBanned = Boolean(post.authorBanned);
    post.userVote = userVotes[`post_${post.id}`] || null;
    
    const commentsWithVotes = comments.map(comment => ({
      ...comment,
      authorBanned: Boolean(comment.authorBanned),
      userVote: userVotes[`comment_${comment.id}`] || null
    }));

    res.json({
      post,
      comments: commentsWithVotes
    });

  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new post (now includes ban check)
router.post('/', authenticateToken, checkBanStatus, async (req, res) => {
  try {
    const { title, url, imageUrl, body } = req.body;

    // Validation
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (title.length > 300) {
      return res.status(400).json({ error: 'Title too long (max 300 characters)' });
    }

    if (body && body.length > 10000) {
      return res.status(400).json({ error: 'Body too long (max 10000 characters)' });
    }

    // URL validation (basic)
    if (url && url.trim() && !isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    if (imageUrl && imageUrl.trim() && !isValidUrl(imageUrl)) {
      return res.status(400).json({ error: 'Invalid image URL format' });
    }

    // Create post
    const result = await db.run(`
      INSERT INTO posts (title, url, image_url, body, author_id)
      VALUES (?, ?, ?, ?, ?)
    `, [
      title.trim(),
      url?.trim() || null,
      imageUrl?.trim() || null,
      body?.trim() || null,
      req.user.id
    ]);

    // Get the created post with author info
    const newPost = await db.get(`
      SELECT 
        p.id,
        p.title,
        p.url,
        p.image_url as imageUrl,
        p.body,
        p.votes,
        p.created_at as createdAt,
        u.username as author,
        u.is_banned as authorBanned
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `, [result.id]);

    res.status(201).json({
      message: 'Post created successfully',
      post: {
        ...newPost,
        authorBanned: Boolean(newPost.authorBanned),
        commentCount: 0,
        userVote: null
      }
    });

  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to validate URLs
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

export default router;
