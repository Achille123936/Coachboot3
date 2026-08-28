const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole, requireClubScope } = require('../middleware/auth');
const { buildUpdateSet } = require('../utils/buildUpdate');
const { validateUuidParam } = require('../middleware/validateUuid');
const { addClubFilter } = require('../utils/tenantScope');

router.param('id', validateUuidParam);
// Toute cette ressource est propre à un club — voir docs/API.md « Multi-tenant ».
router.use(requireAuth, requireClubScope);

/**
 * GET /api/players
 * Liste des joueurs, avec recherche (?q=) et filtre par équipe (?team_id=) ou statut (?status=).
 */
router.get('/', asyncHandler(async (req, res) => {
  const { q, team_id, status } = req.query;
  const conditions = [];
  const params = [];

  if (q) { params.push(`%${q}%`); conditions.push(`(p.first_name ILIKE $${params.length} OR p.last_name ILIKE $${params.length})`); }
  if (team_id) { params.push(team_id); conditions.push(`p.team_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`p.status = $${params.length}`); }
  addClubFilter(conditions, params, req.clubId, 'p.club_id');

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT p.*, t.name AS team_name
     FROM players p LEFT JOIN teams t ON t.id = p.team_id
     ${where} ORDER BY p.last_name ASC`,
    params
  );
  res.json({ players: rows, count: rows.length });
}));

/** GET /api/players/me — fiche du joueur lié au compte connecté (utilisé par player-live.html) */
router.get('/me', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*, t.name AS team_name FROM players p LEFT JOIN teams t ON t.id = p.team_id WHERE p.user_id = $1`,
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Aucune fiche joueur liée à ce compte.' });
  res.json({ player: rows[0] });
}));

/** GET /api/players/:id — fiche détaillée d'un joueur */
router.get('/:id', asyncHandler(async (req, res) => {
  const conditions = ['p.id = $1'];
  const params = [req.params.id];
  addClubFilter(conditions, params, req.clubId, 'p.club_id');
  const { rows } = await pool.query(
    `SELECT p.*, t.name AS team_name FROM players p LEFT JOIN teams t ON t.id = p.team_id WHERE ${conditions.join(' AND ')}`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Joueur introuvable.' });
  res.json({ player: rows[0] });
}));

/** POST /api/players — créer un joueur (staff uniquement) */
router.post('/', requireRole('head_coach', 'technical_director', 'fitness_coach'), [
  body('first_name').trim().notEmpty().withMessage('Le prénom est requis.'),
  body('last_name').trim().notEmpty().withMessage('Le nom est requis.'),
  body('position').trim().notEmpty().withMessage('Le poste est requis.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  // Admin (superadmin plateforme, req.clubId === null) doit préciser explicitement le club cible.
  const clubId = req.clubId ?? req.body.club_id;
  if (!clubId) return res.status(400).json({ error: 'club_id est requis.' });

  const { first_name, last_name, position, jersey_number, birthdate, team_id, status, form_score } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO players (club_id,first_name,last_name,position,jersey_number,birthdate,team_id,status,form_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'Disponible'),COALESCE($9,70)) RETURNING *`,
    [clubId, first_name, last_name, position, jersey_number || null, birthdate || null, team_id || null, status, form_score]
  );
  res.status(201).json({ player: rows[0] });
}));

/** PUT /api/players/:id — mettre à jour un joueur */
router.put('/:id', requireRole('head_coach', 'technical_director', 'fitness_coach'), asyncHandler(async (req, res) => {
  const fields = ['first_name', 'last_name', 'position', 'jersey_number', 'birthdate', 'team_id', 'status', 'form_score'];
  const { updates, params } = buildUpdateSet(fields, req.body);
  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });

  const conditions = [];
  params.push(req.params.id);
  conditions.push(`id = $${params.length}`);
  addClubFilter(conditions, params, req.clubId);
  const { rows } = await pool.query(
    `UPDATE players SET ${updates.join(', ')} WHERE ${conditions.join(' AND ')} RETURNING *`, params
  );
  if (!rows.length) return res.status(404).json({ error: 'Joueur introuvable.' });
  res.json({ player: rows[0] });
}));

/** DELETE /api/players/:id */
router.delete('/:id', requireRole('head_coach', 'technical_director'), asyncHandler(async (req, res) => {
  const conditions = [];
  const params = [];
  params.push(req.params.id);
  conditions.push(`id = $${params.length}`);
  addClubFilter(conditions, params, req.clubId);
  const { rowCount } = await pool.query(`DELETE FROM players WHERE ${conditions.join(' AND ')}`, params);
  if (!rowCount) return res.status(404).json({ error: 'Joueur introuvable.' });
  res.status(204).send();
}));

module.exports = router;
