const router = require('express').Router();
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireClubScope } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');

router.param('id', validateUuidParam);
router.use(requireAuth, requireClubScope);

/**
 * GET /api/notifications — notifications de l'utilisateur (personnelles +
 * diffusées à TOUT LE CLUB). `user_id IS NULL` = diffusion à tout le club
 * (club_id), plus jamais à la plateforme entière — voir chk multi-tenant.
 * Admin (superadmin, req.clubId === null) : ne peut avoir de notifications
 * personnelles club-scopées ; renvoie une liste vide plutôt que d'agréger
 * les diffusions de tous les clubs dans un seul flux (comportement honnête,
 * pas un "tous les clubs" implicite).
 */
router.get('/', asyncHandler(async (req, res) => {
  if (req.clubId === null) return res.json({ notifications: [], unread_count: 0 });
  const { rows } = await pool.query(
    `SELECT * FROM notifications WHERE club_id = $1 AND (user_id = $2 OR user_id IS NULL) ORDER BY created_at DESC LIMIT 50`,
    [req.clubId, req.user.id]
  );
  const unread = rows.filter(n => !n.is_read).length;
  res.json({ notifications: rows, unread_count: unread });
}));

/** PUT /api/notifications/:id/read */
router.put('/:id/read', asyncHandler(async (req, res) => {
  if (req.clubId === null) return res.status(404).json({ error: 'Notification introuvable.' });
  const { rows } = await pool.query(
    'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND club_id = $2 AND (user_id = $3 OR user_id IS NULL) RETURNING *',
    [req.params.id, req.clubId, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Notification introuvable.' });
  res.json({ notification: rows[0] });
}));

module.exports = router;
