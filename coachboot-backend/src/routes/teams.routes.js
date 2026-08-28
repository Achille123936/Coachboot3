const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole, requireClubScope } = require('../middleware/auth');
const { buildUpdateSet } = require('../utils/buildUpdate');
const { validateUuidParam } = require('../middleware/validateUuid');
const { addClubFilter } = require('../utils/tenantScope');

router.param('id', validateUuidParam);
router.use(requireAuth, requireClubScope);

/** GET /api/teams — liste des équipes avec effectif calculé */
router.get('/', asyncHandler(async (req, res) => {
  const conditions = [];
  const params = [];
  addClubFilter(conditions, params, req.clubId, 't.club_id');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT t.*, COUNT(p.id)::int AS player_count
    FROM teams t LEFT JOIN players p ON p.team_id = t.id
    ${where}
    GROUP BY t.id ORDER BY t.name`, params);
  res.json({ teams: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const conditions = ['id = $1'];
  const params = [req.params.id];
  addClubFilter(conditions, params, req.clubId);
  const { rows } = await pool.query(`SELECT * FROM teams WHERE ${conditions.join(' AND ')}`, params);
  if (!rows.length) return res.status(404).json({ error: 'Équipe introuvable.' });
  res.json({ team: rows[0] });
}));

router.post('/', requireRole('technical_director', 'head_coach'), [
  body('name').trim().notEmpty().withMessage('Le nom de l\'équipe est requis.'),
  body('category').trim().notEmpty().withMessage('La catégorie est requise.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const clubId = req.clubId ?? req.body.club_id;
  if (!clubId) return res.status(400).json({ error: 'club_id est requis.' });
  const { name, category, level, coach_name } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO teams (club_id, name, category, level, coach_name) VALUES ($1,$2,$3,COALESCE($4,'Développement'),$5) RETURNING *`,
    [clubId, name, category, level, coach_name]
  );
  res.status(201).json({ team: rows[0] });
}));

router.put('/:id', requireRole('technical_director', 'head_coach'), asyncHandler(async (req, res) => {
  const fields = ['name', 'category', 'level', 'coach_name'];
  const { updates, params } = buildUpdateSet(fields, req.body);
  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  const conditions = [];
  params.push(req.params.id);
  conditions.push(`id = $${params.length}`);
  addClubFilter(conditions, params, req.clubId);
  const { rows } = await pool.query(`UPDATE teams SET ${updates.join(', ')} WHERE ${conditions.join(' AND ')} RETURNING *`, params);
  if (!rows.length) return res.status(404).json({ error: 'Équipe introuvable.' });
  res.json({ team: rows[0] });
}));

router.delete('/:id', requireRole('technical_director'), asyncHandler(async (req, res) => {
  const conditions = [];
  const params = [];
  params.push(req.params.id);
  conditions.push(`id = $${params.length}`);
  addClubFilter(conditions, params, req.clubId);
  const { rowCount } = await pool.query(`DELETE FROM teams WHERE ${conditions.join(' AND ')}`, params);
  if (!rowCount) return res.status(404).json({ error: 'Équipe introuvable.' });
  res.status(204).send();
}));

module.exports = router;
