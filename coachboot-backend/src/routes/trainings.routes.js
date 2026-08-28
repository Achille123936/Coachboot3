const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole, requireClubScope } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');
const { addClubFilter } = require('../utils/tenantScope');

router.param('id', validateUuidParam);
router.use(requireAuth, requireClubScope);

router.get('/', asyncHandler(async (req, res) => {
  const { team_id } = req.query;
  const conditions = [];
  const params = [];
  if (team_id) { params.push(team_id); conditions.push(`t.team_id = $${params.length}`); }
  addClubFilter(conditions, params, req.clubId, 't.club_id');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT t.*, tm.name AS team_name FROM trainings t LEFT JOIN teams tm ON tm.id = t.team_id ${where} ORDER BY t.session_date DESC`,
    params
  );
  res.json({ trainings: rows });
}));

router.post('/', requireRole('head_coach', 'fitness_coach'), [
  body('session_date').isISO8601().withMessage('Date de séance invalide.'),
  body('type').trim().notEmpty().withMessage('Le type de séance est requis.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const clubId = req.clubId ?? req.body.club_id;
  if (!clubId) return res.status(400).json({ error: 'club_id est requis.' });
  const { team_id, session_date, type, duration_minutes, rpe, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO trainings (club_id, team_id, session_date, type, duration_minutes, rpe, notes)
     VALUES ($1,$2,$3,$4,COALESCE($5,60),$6,$7) RETURNING *`,
    [clubId, team_id || null, session_date, type, duration_minutes, rpe || null, notes || null]
  );
  res.status(201).json({ training: rows[0] });
}));

router.delete('/:id', requireRole('head_coach', 'fitness_coach'), asyncHandler(async (req, res) => {
  const conditions = [];
  const params = [];
  params.push(req.params.id);
  conditions.push(`id = $${params.length}`);
  addClubFilter(conditions, params, req.clubId);
  const { rowCount } = await pool.query(`DELETE FROM trainings WHERE ${conditions.join(' AND ')}`, params);
  if (!rowCount) return res.status(404).json({ error: 'Séance introuvable.' });
  res.status(204).send();
}));

module.exports = router;
