const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { buildUpdateSet } = require('../utils/buildUpdate');
const { validateUuidParam } = require('../middleware/validateUuid');
const { createNotification } = require('../utils/notify');

router.param('id', validateUuidParam);

/** GET /api/matches?status=À venir|Terminé */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = 'WHERE status = $1'; }
  const { rows } = await pool.query(`SELECT * FROM matches ${where} ORDER BY match_date DESC`, params);
  res.json({ matches: rows });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM matches WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Match introuvable.' });
  res.json({ match: rows[0] });
}));

router.post('/', requireAuth, requireRole('head_coach', 'technical_director'), [
  body('home_team').trim().notEmpty(),
  body('away_team').trim().notEmpty(),
  body('competition').trim().notEmpty(),
  body('match_date').isISO8601().withMessage('Date de match invalide (format ISO attendu).'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const { home_team, away_team, competition, match_date } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO matches (home_team, away_team, competition, match_date, status) VALUES ($1,$2,$3,$4,'À venir') RETURNING *`,
    [home_team, away_team, competition, match_date]
  );
  await createNotification({
    title: 'Nouveau match programmé',
    body: `${home_team} vs ${away_team} (${competition}) le ${new Date(match_date).toLocaleDateString('fr-FR')}.`,
    category: 'info',
  });
  res.status(201).json({ match: rows[0] });
}));

/** PUT /api/matches/:id — mettre à jour le score / statut / xG / possession */
router.put('/:id', requireAuth, requireRole('head_coach', 'technical_director', 'data_analyst'), asyncHandler(async (req, res) => {
  const fields = ['home_score', 'away_score', 'status', 'possession_pct', 'xg'];
  const { updates, params } = buildUpdateSet(fields, req.body);
  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  params.push(req.params.id);
  const { rows } = await pool.query(`UPDATE matches SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  if (!rows.length) return res.status(404).json({ error: 'Match introuvable.' });
  res.json({ match: rows[0] });
}));

router.delete('/:id', requireAuth, requireRole('technical_director'), asyncHandler(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM matches WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Match introuvable.' });
  res.status(204).send();
}));

module.exports = router;
