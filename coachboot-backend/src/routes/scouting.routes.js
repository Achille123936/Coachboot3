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

router.get('/', asyncHandler(async (req, res) => {
  const { q, favorite } = req.query;
  const params = []; const clauses = [];
  if (q) { params.push(`%${q}%`); clauses.push(`(name ILIKE $${params.length} OR current_club ILIKE $${params.length})`); }
  if (favorite === 'true') { clauses.push('is_favorite = TRUE'); }
  addClubFilter(clauses, params, req.clubId);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM scouting_profiles ${where} ORDER BY rating DESC NULLS LAST`, params);
  res.json({ profiles: rows });
}));

router.post('/', requireRole('technical_director', 'head_coach'), [
  body('name').trim().notEmpty().withMessage('Le nom du joueur est requis.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const clubId = req.clubId ?? req.body.club_id;
  if (!clubId) return res.status(400).json({ error: 'club_id est requis.' });
  const { name, current_club, position, age, rating, tag, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO scouting_profiles (club_id, name, current_club, position, age, rating, tag, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [clubId, name, current_club, position, age || null, rating || null, tag || null, notes || null]
  );
  await createNotification({
    clubId,
    title: 'Nouveau profil de scouting',
    body: `${name}${current_club ? ` (${current_club})` : ''} ajouté à la base de recrutement.`,
    category: 'info',
  });
  res.status(201).json({ profile: rows[0] });
}));

router.put('/:id', requireRole('technical_director', 'head_coach'), asyncHandler(async (req, res) => {
  const fields = ['name', 'current_club', 'position', 'age', 'rating', 'tag', 'notes', 'is_favorite'];
  const { updates, params } = buildUpdateSet(fields, req.body);
  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  const conditions = [];
  params.push(req.params.id);
  conditions.push(`id = $${params.length}`);
  addClubFilter(conditions, params, req.clubId);
  const { rows } = await pool.query(`UPDATE scouting_profiles SET ${updates.join(', ')} WHERE ${conditions.join(' AND ')} RETURNING *`, params);
  if (!rows.length) return res.status(404).json({ error: 'Profil introuvable.' });
  res.json({ profile: rows[0] });
}));

router.delete('/:id', requireRole('technical_director'), asyncHandler(async (req, res) => {
  const conditions = [];
  const params = [];
  params.push(req.params.id);
  conditions.push(`id = $${params.length}`);
  addClubFilter(conditions, params, req.clubId);
  const { rowCount } = await pool.query(`DELETE FROM scouting_profiles WHERE ${conditions.join(' AND ')}`, params);
  if (!rowCount) return res.status(404).json({ error: 'Profil introuvable.' });
  res.status(204).send();
}));

module.exports = router;
