const router = require('express').Router();
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');

router.param('id', validateUuidParam);

/** GET /api/notifications — notifications de l'utilisateur (personnelles + diffusées à tous) */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM notifications WHERE user_id = $1 OR user_id IS NULL ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  const unread = rows.filter(n => !n.is_read).length;
  res.json({ notifications: rows, unread_count: unread });
}));

/** PUT /api/notifications/:id/read */
router.put('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) RETURNING *',
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Notification introuvable.' });
  res.json({ notification: rows[0] });
}));

module.exports = router;
