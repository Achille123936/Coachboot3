const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole, requireClubScope } = require('../middleware/auth');
const { buildUpdateSet } = require('../utils/buildUpdate');
const { validateUuidParam } = require('../middleware/validateUuid');
const { createNotification } = require('../utils/notify');
const { addClubFilter } = require('../utils/tenantScope');

router.param('id', validateUuidParam);
router.use(requireAuth, requireClubScope);

/** GET /api/matches?status=À venir|Terminé */
router.get('/', asyncHandler(async (req, res) => {
  const { status } = req.query;
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  addClubFilter(conditions, params, req.clubId);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM matches ${where} ORDER BY match_date DESC`, params);
  res.json({ matches: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const conditions = ['id = $1'];
  const params = [req.params.id];
  addClubFilter(conditions, params, req.clubId);
  const { rows } = await pool.query(`SELECT * FROM matches WHERE ${conditions.join(' AND ')}`, params);
  if (!rows.length) return res.status(404).json({ error: 'Match introuvable.' });
  res.json({ match: rows[0] });
}));

router.post('/', requireRole('head_coach', 'technical_director'), [
  body('home_team').trim().notEmpty(),
  body('away_team').trim().notEmpty(),
  body('competition').trim().notEmpty(),
  body('match_date').isISO8601().withMessage('Date de match invalide (format ISO attendu).'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const clubId = req.clubId ?? req.body.club_id;
  if (!clubId) return res.status(400).json({ error: 'club_id est requis.' });
  const { home_team, away_team, competition, match_date } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO matches (club_id, home_team, away_team, competition, match_date, status) VALUES ($1,$2,$3,$4,$5,'À venir') RETURNING *`,
    [clubId, home_team, away_team, competition, match_date]
  );
  await createNotification({
    clubId,
    title: 'Nouveau match programmé',
    body: `${home_team} vs ${away_team} (${competition}) le ${new Date(match_date).toLocaleDateString('fr-FR')}.`,
    category: 'info',
  });
  res.status(201).json({ match: rows[0] });
}));

/** PUT /api/matches/:id — mettre à jour le score / statut / xG / possession */
router.put('/:id', requireRole('head_coach', 'technical_director', 'data_analyst'), asyncHandler(async (req, res) => {
  const fields = ['home_score', 'away_score', 'status', 'possession_pct', 'xg'];
  const { updates, params } = buildUpdateSet(fields, req.body);
  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  const conditions = [];
  params.push(req.params.id);
  conditions.push(`id = $${params.length}`);
  addClubFilter(conditions, params, req.clubId);
  const { rows } = await pool.query(`UPDATE matches SET ${updates.join(', ')} WHERE ${conditions.join(' AND ')} RETURNING *`, params);
  if (!rows.length) return res.status(404).json({ error: 'Match introuvable.' });
  res.json({ match: rows[0] });
}));

router.delete('/:id', requireRole('technical_director'), asyncHandler(async (req, res) => {
  const conditions = [];
  const params = [];
  params.push(req.params.id);
  conditions.push(`id = $${params.length}`);
  addClubFilter(conditions, params, req.clubId);
  const { rowCount } = await pool.query(`DELETE FROM matches WHERE ${conditions.join(' AND ')}`, params);
  if (!rowCount) return res.status(404).json({ error: 'Match introuvable.' });
  res.status(204).send();
}));

module.exports = router;
