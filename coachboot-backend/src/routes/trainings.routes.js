const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');

router.param('id', validateUuidParam);

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { team_id } = req.query;
  const params = []; let where = '';
  if (team_id) { params.push(team_id); where = 'WHERE t.team_id = $1'; }
  const { rows } = await pool.query(
    `SELECT t.*, tm.name AS team_name FROM trainings t LEFT JOIN teams tm ON tm.id = t.team_id ${where} ORDER BY t.session_date DESC`,
    params
  );
  res.json({ trainings: rows });
}));

router.post('/', requireAuth, requireRole('head_coach', 'fitness_coach'), [
  body('session_date').isISO8601().withMessage('Date de séance invalide.'),
  body('type').trim().notEmpty().withMessage('Le type de séance est requis.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const { team_id, session_date, type, duration_minutes, rpe, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO trainings (team_id, session_date, type, duration_minutes, rpe, notes)
     VALUES ($1,$2,$3,COALESCE($4,60),$5,$6) RETURNING *`,
    [team_id || null, session_date, type, duration_minutes, rpe || null, notes || null]
  );
  res.status(201).json({ training: rows[0] });
}));

router.delete('/:id', requireAuth, requireRole('head_coach', 'fitness_coach'), asyncHandler(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM trainings WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Séance introuvable.' });
  res.status(204).send();
}));

module.exports = router;
