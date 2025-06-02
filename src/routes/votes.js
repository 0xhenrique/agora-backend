import express from 'express';
import db from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Cast or update vote
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { itemId, itemType, voteType } = req.body;

    // Validation
    if (!itemId || !itemType || !voteType) {
      return res.status(400).json({ error: 'itemId, itemType, and voteType are required' });
    }

    if (!['post', 'comment'].includes(itemType)) {
      return res.status(400).json({ error: 'itemType must be "post" or "comment"' });
    }

    if (!['up', 'down'].includes(voteType)) {
      return res.status(400).json({ error: 'voteType must be "up" or "down"' });
    }

    // Verify item exists
    const tableName = itemType === 'post' ? 'posts' : 'comments';
    const item = await db.get(`SELECT id FROM ${tableName} WHERE id = ?`, [itemId]);
    if (!item) {
      return res.status(404).json({ error: `${itemType} not found` });
    }

    // Check if user already voted on this item
    const existingVote = await db.get(`
      SELECT id, vote_type FROM votes 
      WHERE user_id = ? AND item_id = ? AND item_type = ?
    `, [req.user.id, itemId, itemType]);

    let voteDelta = 0;
    let action = '';

    if (existingVote) {
      if (existingVote.vote_type === voteType) {
        // Same vote type - remove vote (toggle off)
        await db.run('DELETE FROM votes WHERE id = ?', [existingVote.id]);
        voteDelta = voteType === 'up' ? -1 : 1;
        action = 'removed';
      } else {
        // Different vote type - update vote
        await db.run('UPDATE votes SET vote_type = ? WHERE id = ?', [voteType, existingVote.id]);
        voteDelta = voteType === 'up' ? 2 : -2;
        action = 'updated';
      }
    } else {
      // New vote
      await db.run(`
        INSERT INTO votes (user_id, item_id, item_type, vote_type)
        VALUES (?, ?, ?, ?)
      `, [req.user.id, itemId, itemType, voteType]);
      voteDelta = voteType === 'up' ? 1 : -1;
      action = 'created';
    }

    // Update vote count on the item
    await db.run(`
      UPDATE ${tableName} SET votes = votes + ? WHERE id = ?
    `, [voteDelta, itemId]);

    // Get updated vote count
    const updatedItem = await db.get(`SELECT votes FROM ${tableName} WHERE id = ?`, [itemId]);

    // Get current user vote status
    const currentVote = await db.get(`
      SELECT vote_type FROM votes 
      WHERE user_id = ? AND item_id = ? AND item_type = ?
    `, [req.user.id, itemId, itemType]);

    res.json({
      message: `Vote ${action} successfully`,
      votes: updatedItem.votes,
      userVote: currentVote ? currentVote.vote_type : null
    });

  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get vote status for multiple items (useful for frontend)
router.post('/status', authenticateToken, async (req, res) => {
  try {
    const { items } = req.body; // Array of {id, type}

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }

    // Validate items
    const validItems = items.filter(item => 
      item.id && 
      item.type && 
      ['post', 'comment'].includes(item.type)
    );

    if (validItems.length === 0) {
      return res.json({ votes: {} });
    }

    // Build query for user votes
    const conditions = validItems.map(() => '(item_id = ? AND item_type = ?)').join(' OR ');
    const params = [req.user.id];
    validItems.forEach(item => {
      params.push(item.id, item.type);
    });

    const votes = await db.all(`
      SELECT item_id, item_type, vote_type 
      FROM votes 
      WHERE user_id = ? AND (${conditions})
    `, params);

    // Format response
    const voteStatus = {};
    votes.forEach(vote => {
      const key = `${vote.item_type}_${vote.item_id}`;
      voteStatus[key] = vote.vote_type;
    });

    res.json({ votes: voteStatus });

  } catch (error) {
    console.error('Vote status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router
