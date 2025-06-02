import express from 'express';
import db from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Create new report (requires authentication, not moderation)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { itemId, itemType, reason } = req.body;

    // Validation
    if (!itemId || !itemType) {
      return res.status(400).json({ error: 'itemId and itemType are required' });
    }

    if (!['post', 'comment'].includes(itemType)) {
      return res.status(400).json({ error: 'itemType must be "post" or "comment"' });
    }

    if (reason && reason.length > 500) {
      return res.status(400).json({ error: 'Reason too long (max 500 characters)' });
    }

    // Verify item exists
    const tableName = itemType === 'post' ? 'posts' : 'comments';
    const item = await db.get(`SELECT id FROM ${tableName} WHERE id = ?`, [itemId]);
    if (!item) {
      return res.status(404).json({ error: `${itemType} not found` });
    }

    // Check if user already reported this item
    const existingReport = await db.get(`
      SELECT id FROM reports 
      WHERE reporter_id = ? AND reported_item_id = ? AND reported_item_type = ?
    `, [req.user.id, itemId, itemType]);

    if (existingReport) {
      return res.status(409).json({ error: 'You have already reported this content' });
    }

    // Create report
    await db.run(`
      INSERT INTO reports (reporter_id, reported_item_id, reported_item_type, reason)
      VALUES (?, ?, ?, ?)
    `, [req.user.id, itemId, itemType, reason?.trim() || null]);

    res.status(201).json({ message: 'Report submitted successfully' });

  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
