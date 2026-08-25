// ============================================================================
// MATCH LIVE — module « Match Live Camera + GPS Tracking »
// Sessions de diffusion caméra + suivi GPS multi-joueurs en temps réel.
// La caméra (WebRTC/MediaDevices) reste entièrement côté client : ce routeur
// ne gère que les métadonnées de session, les relevés GPS et les événements
// tagués sur la timeline (voir coachboot/match-live.html + assets/js/match-*).
// ============================================================================
const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');

router.param('id', validateUuidParam);

const STAFF_ROLES = ['head_coach', 'technical_director', 'fitness_coach', 'video_analyst', 'data_analyst'];

// Cycle de vie du MATCH (phase du jeu) — distinct du mode des données affichées
// (réel vs simulation), qui est calculé côté client à partir de l'état GPS et
// n'est jamais écrit ici : voir la bannière de mode dans match-live.html.
const MATCH_LIVE_STATUSES = ['scheduled', 'live', 'halftime', 'finished', 'cancelled'];

/** GET /api/match-live?status= */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = []; let where = '';
  if (status) { params.push(status); where = 'WHERE status = $1'; }
  const { rows } = await pool.query(
    `SELECT * FROM matches_live ${where} ORDER BY date DESC, created_at DESC`, params
  );
  res.json({ matches_live: rows });
}));

/** GET /api/match-live/:id */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM matches_live WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Session Match Live introuvable.' });
  res.json({ match_live: rows[0] });
}));

/** POST /api/match-live — démarre une nouvelle session Match Live */
router.post('/', requireAuth, requireRole(...STAFF_ROLES), [
  body('team_home').trim().notEmpty().withMessage('team_home est requis.'),
  body('team_away').trim().notEmpty().withMessage('team_away est requis.'),
  body('status').optional().isIn(MATCH_LIVE_STATUSES).withMessage(`status doit être l'un de : ${MATCH_LIVE_STATUSES.join(', ')}.`),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const { team_home, team_away, date, status, stream_url, match_id } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO matches_live (match_id, team_home, team_away, date, status, stream_url)
     VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE),COALESCE($5,'scheduled'),$6) RETURNING *`,
    [match_id || null, team_home, team_away, date || null, status || null, stream_url || null]
  );
  res.status(201).json({ match_live: rows[0] });
}));

/** PUT /api/match-live/:id — met à jour le statut (scheduled/live/halftime/finished/cancelled) et/ou l'URL du flux */
router.put('/:id', requireAuth, requireRole(...STAFF_ROLES), [
  body('status').optional().isIn(MATCH_LIVE_STATUSES).withMessage(`status doit être l'un de : ${MATCH_LIVE_STATUSES.join(', ')}.`),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const { status, stream_url } = req.body;
  const { rows } = await pool.query(
    `UPDATE matches_live SET status = COALESCE($1, status), stream_url = COALESCE($2, stream_url)
     WHERE id = $3 RETURNING *`,
    [status || null, stream_url || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Session Match Live introuvable.' });
  res.json({ match_live: rows[0] });
}));

const TRACKING_CHUNK_SIZE = 500;

/** POST /api/match-live/:id/gps — enregistre un lot de relevés GPS multi-joueurs */
router.post('/:id/gps', requireAuth, requireRole(...STAFF_ROLES), [
  body('points').isArray({ min: 1, max: 5000 }).withMessage('points doit être un tableau non vide (5000 max).'),
  body('points.*.player_id').isUUID().withMessage('Chaque point doit avoir un player_id UUID valide.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { rows: matchRows } = await pool.query('SELECT id FROM matches_live WHERE id = $1', [req.params.id]);
  if (!matchRows.length) return res.status(404).json({ error: 'Session Match Live introuvable.' });

  const { points } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < points.length; i += TRACKING_CHUNK_SIZE) {
      const chunk = points.slice(i, i + TRACKING_CHUNK_SIZE);
      const placeholders = []; const params = [];
      chunk.forEach((p) => {
        const base = params.length;
        placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
        params.push(
          req.params.id, p.player_id, p.latitude ?? null, p.longitude ?? null,
          p.speed ?? null, p.distance ?? null, p.timestamp ? new Date(p.timestamp) : new Date()
        );
      });
      await client.query(
        `INSERT INTO gps_live_tracking (match_id, player_id, latitude, longitude, speed, distance, timestamp)
         VALUES ${placeholders.join(',')}`,
        params
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ points_saved: points.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

/** GET /api/match-live/:id/gps?player_id=&limit= — relevés GPS d'une session (option: un joueur) */
router.get('/:id/gps', requireAuth, asyncHandler(async (req, res) => {
  const { player_id } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 2000, 5000);
  const params = [req.params.id]; let where = '';
  if (player_id) { params.push(player_id); where = 'AND player_id = $2'; }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT player_id, latitude, longitude, speed, distance, timestamp
     FROM gps_live_tracking WHERE match_id = $1 ${where}
     ORDER BY timestamp DESC LIMIT $${params.length}`,
    params
  );
  res.json({ points: rows });
}));

/** POST /api/match-live/:id/events — tague un événement (sprint, tir, passe, interception, récupération...) */
router.post('/:id/events', requireAuth, requireRole(...STAFF_ROLES), [
  body('event_type').trim().notEmpty().withMessage('event_type est requis.'),
  body('time').isInt({ min: 0 }).withMessage('time doit être un entier positif (secondes écoulées).'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { rows: matchRows } = await pool.query('SELECT id FROM matches_live WHERE id = $1', [req.params.id]);
  if (!matchRows.length) return res.status(404).json({ error: 'Session Match Live introuvable.' });

  const { player_id, event_type, time } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO live_events (match_id, player_id, event_type, time) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, player_id || null, event_type, time]
  );
  res.status(201).json({ event: rows[0] });
}));

/** GET /api/match-live/:id/events — timeline des événements d'une session */
router.get('/:id/events', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*, p.first_name, p.last_name FROM live_events e
     LEFT JOIN players p ON p.id = e.player_id
     WHERE e.match_id = $1 ORDER BY e.time ASC`,
    [req.params.id]
  );
  res.json({ events: rows });
}));

module.exports = router;
