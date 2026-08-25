const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');
const { computeGpsMetricsFromPoints } = require('../utils/gpsMetrics');

router.param('id', validateUuidParam);

/** IDOR guard : un compte "player" ne doit voir que ses propres données GPS
 * (performance physique = donnée sensible), jamais celles d'un coéquipier
 * simplement en devinant/énumérant un UUID de session ou de joueur. Le staff
 * GPS-autorisé n'est pas concerné — même principe que canReportGpsFor côté
 * Socket.io (src/socket/gpsSocket.js), dupliqué ici volontairement car REST
 * et Socket.io restent deux surfaces indépendantes. */
async function requireOwnPlayerIfPlayerRole(req, res, playerId) {
  if (req.user.role !== 'player') return true;
  const { rows } = await pool.query('SELECT 1 FROM players WHERE id = $1 AND user_id = $2', [playerId, req.user.id]);
  if (!rows.length) {
    res.status(403).json({ error: "Vous n'êtes pas autorisé à consulter les données GPS d'un autre joueur." });
    return false;
  }
  return true;
}

/** GET /api/gps?player_id=...&limit=&offset= */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { player_id } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  if (req.user.role === 'player' && !player_id) {
    return res.status(400).json({ error: 'player_id est requis pour ce rôle.' });
  }
  if (player_id && !(await requireOwnPlayerIfPlayerRole(req, res, player_id))) return;

  const params = []; let where = '';
  if (player_id) { params.push(player_id); where = 'WHERE g.player_id = $1'; }
  params.push(limit, offset);
  const { rows } = await pool.query(`
    SELECT g.*, p.first_name, p.last_name FROM gps_sessions g
    JOIN players p ON p.id = g.player_id ${where}
    ORDER BY g.session_date DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ sessions: rows, limit, offset });
}));

router.post('/', requireAuth, requireRole('fitness_coach', 'data_analyst'), asyncHandler(async (req, res) => {
  const { player_id, match_id, session_date, distance_km, sprints, top_speed_kmh, high_intensity_km } = req.body;
  if (!player_id || !session_date) return res.status(400).json({ error: 'player_id et session_date sont requis.' });
  const { rows } = await pool.query(
    `INSERT INTO gps_sessions (player_id, match_id, session_date, distance_km, sprints, top_speed_kmh, high_intensity_km)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [player_id, match_id || null, session_date, distance_km, sprints, top_speed_kmh, high_intensity_km]
  );
  res.status(201).json({ session: rows[0] });
}));

/* ---------------------------------------------------------------------------
 * Suivi GPS en direct : session complète (métadonnées + statistiques + trace
 * de points bruts). Utilisé par assets/js/gps-live.js + gps-storage.js côté
 * frontend une fois qu'une session de tracking en direct est arrêtée et
 * sauvegardée par l'utilisateur.
 * ------------------------------------------------------------------------ */

const POINTS_CHUNK_SIZE = 500; // reste large sous la limite de 65535 paramètres/requête PostgreSQL

/** Insère les points GPS par lots pour rester sous la limite de paramètres d'une requête. */
async function insertPointsBatch(client, sessionId, points) {
  for (let i = 0; i < points.length; i += POINTS_CHUNK_SIZE) {
    const chunk = points.slice(i, i + POINTS_CHUNK_SIZE);
    const placeholders = [];
    const params = [];
    chunk.forEach((p, idx) => {
      const seq = i + idx;
      const base = params.length;
      placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`);
      params.push(
        sessionId, seq, p.lat, p.lng,
        p.altitude ?? null, p.accuracy ?? null, p.speed ?? null,
        p.t ? new Date(p.t) : new Date()
      );
    });
    await client.query(
      `INSERT INTO gps_points (session_id, seq, latitude, longitude, altitude_m, accuracy_m, speed_kmh, recorded_at)
       VALUES ${placeholders.join(',')}`,
      params
    );
  }
}

/**
 * POST /api/gps/session
 * Sauvegarde une session de tracking GPS en direct dans son intégralité :
 * métadonnées (gps_sessions), métriques calculées côté client (gps_statistics)
 * et trace brute point par point (gps_points), en une seule transaction.
 * Body attendu : { player_id, match_id?, session_date, duration_minutes?,
 *                  statistics: { distance_km, high_intensity_km, sprint_distance_km,
 *                                max_speed_kmh, avg_speed_kmh, acceleration_count,
 *                                deceleration_count, sprint_count, intense_sprint_count },
 *                  points: [{ lat, lng, altitude?, accuracy?, speed?, t }, ...] }
 */
router.post('/session', requireAuth, requireRole('fitness_coach', 'data_analyst', 'head_coach', 'player'), [
  body('player_id').isUUID().withMessage('player_id doit être un UUID valide.'),
  body('session_date').isISO8601().withMessage('session_date invalide (format ISO attendu).'),
  body('points').optional().isArray({ max: 20000 }).withMessage('points doit être un tableau de 20000 éléments maximum.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { player_id, match_id, session_date, duration_minutes, points = [], statistics: clientStatistics = {} } = req.body;

  // Ne jamais faire confiance aveuglément aux agrégats calculés côté client :
  // dès que suffisamment de points bruts sont fournis, on les recalcule
  // réellement côté serveur (même algorithme que le tracker en direct, voir
  // gpsMetrics.js) et ce sont CES valeurs qui sont persistées, pas celles
  // envoyées par le client. Ce n'est possible qu'avec ≥2 points exploitables ;
  // en dessous, on retombe sur les valeurs client (traçé via stats_source).
  const recomputed = computeGpsMetricsFromPoints(points);
  const statistics = recomputed || clientStatistics;
  const statsSource = recomputed ? 'server_recomputed' : 'client_trusted';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: sessionRows } = await client.query(
      `INSERT INTO gps_sessions (player_id, match_id, session_date, duration_minutes, distance_km, sprints, top_speed_kmh, high_intensity_km)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        player_id, match_id || null, session_date, duration_minutes ?? null,
        statistics.distance_km ?? null, statistics.sprint_count ?? null,
        statistics.max_speed_kmh ?? null, statistics.high_intensity_km ?? null,
      ]
    );
    const session = sessionRows[0];

    const { rows: statRows } = await client.query(
      `INSERT INTO gps_statistics (session_id, distance_km, high_intensity_km, sprint_distance_km, max_speed_kmh, avg_speed_kmh, acceleration_count, deceleration_count, sprint_count, intense_sprint_count, stats_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        session.id,
        statistics.distance_km ?? null, statistics.high_intensity_km ?? null, statistics.sprint_distance_km ?? null,
        statistics.max_speed_kmh ?? null, statistics.avg_speed_kmh ?? null,
        statistics.acceleration_count ?? null, statistics.deceleration_count ?? null,
        statistics.sprint_count ?? null, statistics.intense_sprint_count ?? null,
        statsSource,
      ]
    );

    await insertPointsBatch(client, session.id, points);

    await client.query('COMMIT');
    res.status(201).json({ session, statistics: statRows[0], points_saved: points.length, stats_source: statsSource });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

/** GET /api/gps/session/:id — session complète (métadonnées + statistiques + trace de points) */
router.get('/session/:id', requireAuth, asyncHandler(async (req, res) => {
  const { rows: sessionRows } = await pool.query('SELECT * FROM gps_sessions WHERE id = $1', [req.params.id]);
  if (!sessionRows.length) return res.status(404).json({ error: 'Session GPS introuvable.' });
  if (!(await requireOwnPlayerIfPlayerRole(req, res, sessionRows[0].player_id))) return;

  const [{ rows: statRows }, { rows: pointRows }] = await Promise.all([
    pool.query('SELECT * FROM gps_statistics WHERE session_id = $1', [req.params.id]),
    pool.query(
      `SELECT seq, latitude, longitude, altitude_m, accuracy_m, speed_kmh, recorded_at
       FROM gps_points WHERE session_id = $1 ORDER BY seq`,
      [req.params.id]
    ),
  ]);

  res.json({ session: sessionRows[0], statistics: statRows[0] || null, points: pointRows });
}));

/** GET /api/gps/player/:id/stats — agrégats de toutes les sessions GPS d'un joueur */
router.get('/player/:id/stats', requireAuth, asyncHandler(async (req, res) => {
  if (!(await requireOwnPlayerIfPlayerRole(req, res, req.params.id))) return;
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int                                 AS sessions_count,
       COALESCE(SUM(s.distance_km), 0)                AS total_distance_km,
       COALESCE(AVG(s.distance_km), 0)                AS avg_distance_km,
       COALESCE(MAX(s.top_speed_kmh), 0)              AS max_speed_kmh,
       COALESCE(AVG(st.avg_speed_kmh), 0)             AS avg_speed_kmh,
       COALESCE(SUM(s.sprints), 0)::int               AS total_sprints,
       COALESCE(SUM(st.acceleration_count), 0)::int   AS total_accelerations,
       COALESCE(SUM(st.deceleration_count), 0)::int   AS total_decelerations
     FROM gps_sessions s
     LEFT JOIN gps_statistics st ON st.session_id = s.id
     WHERE s.player_id = $1`,
    [req.params.id]
  );

  const { rows: recentSessions } = await pool.query(
    `SELECT id, session_date, duration_minutes, distance_km, top_speed_kmh, sprints
     FROM gps_sessions WHERE player_id = $1 ORDER BY session_date DESC LIMIT 10`,
    [req.params.id]
  );

  res.json({ stats: rows[0], recent_sessions: recentSessions });
}));

module.exports = router;
