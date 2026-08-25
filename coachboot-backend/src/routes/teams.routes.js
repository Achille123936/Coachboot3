const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { buildUpdateSet } = require('../utils/buildUpdate');
const { validateUuidParam } = require('../middleware/validateUuid');

router.param('id', validateUuidParam);

/** GET /api/teams — liste des équipes avec effectif calculé */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT t.*, COUNT(p.id)::int AS player_count
    FROM teams t LEFT JOIN players p ON p.team_id = t.id
    GROUP BY t.id ORDER BY t.name`);
  res.json({ teams: rows });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Équipe introuvable.' });
  res.json({ team: rows[0] });
}));

router.post('/', requireAuth, requireRole('technical_director', 'head_coach'), [
  body('name').trim().notEmpty().withMessage('Le nom de l\'équipe est requis.'),
  body('category').trim().notEmpty().withMessage('La catégorie est requise.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const { name, category, level, coach_name } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO teams (name, category, level, coach_name) VALUES ($1,$2,COALESCE($3,'Développement'),$4) RETURNING *`,
    [name, category, level, coach_name]
  );
  res.status(201).json({ team: rows[0] });
}));

router.put('/:id', requireAuth, requireRole('technical_director', 'head_coach'), asyncHandler(async (req, res) => {
  const fields = ['name', 'category', 'level', 'coach_name'];
  const { updates, params } = buildUpdateSet(fields, req.body);
  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  params.push(req.params.id);
  const { rows } = await pool.query(`UPDATE teams SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  if (!rows.length) return res.status(404).json({ error: 'Équipe introuvable.' });
  res.json({ team: rows[0] });
}));

router.delete('/:id', requireAuth, requireRole('technical_director'), asyncHandler(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Équipe introuvable.' });
  res.status(204).send();
}));

module.exports = router;
