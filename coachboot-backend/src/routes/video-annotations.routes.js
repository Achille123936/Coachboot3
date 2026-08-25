// ============================================================================
// TÉLESTRATION VIDÉO — annotations tactiques manuelles sur vidéo (flèches,
// cercles, lignes, zones, texte, markers joueur) posées par le staff sur un
// "clip" (voir coachboot/video-analysis.html). La vidéo elle-même n'est
// JAMAIS reçue ni stockée ici : un clip référence soit une URL directement
// lisible par <video> (même contrainte que le repli réseau de Match Live),
// soit un fichier choisi localement par l'utilisateur (source_type='local',
// video_url NULL, jamais envoyé au serveur). Seules les annotations (les
// tracés + leur fenêtre temporelle) sont persistées — c'est le cœur réel de
// la fonctionnalité. Pas de tracking automatique joueur/ballon ici (vision
// par ordinateur) : ça reste BLOCKED_EXTERNAL, voir docs/API.md.
// ============================================================================
const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { buildUpdateSet } = require('../utils/buildUpdate');
const { validateUuidParam } = require('../middleware/validateUuid');

router.param('id', validateUuidParam);
router.param('clipId', validateUuidParam);

// fitness_coach ajouté : propriétaire naturel des données GPS, doit pouvoir
// créer/lier des annotations GPS sans dépendre d'un autre rôle pour le faire.
const ANNOTATION_STAFF_ROLES = ['video_analyst', 'head_coach', 'technical_director', 'data_analyst', 'fitness_coach'];
const ANNOTATION_TYPES = ['arrow', 'circle', 'line', 'rectangle', 'freehand', 'text', 'player_marker'];
const SOURCE_TYPES = ['url', 'local'];
const GPS_CORRELATION_TOLERANCE_SEC = 120;

// Copie locale volontaire de la même garde IDOR que gps.routes.js — surfaces
// indépendantes, cohérent avec le choix déjà fait pour gpsSocket.js plutôt
// que d'extraire une abstraction partagée prématurée.
async function requireOwnPlayerIfPlayerRole(req, res, playerId) {
  if (req.user.role !== 'player') return true;
  const { rows } = await pool.query('SELECT 1 FROM players WHERE id = $1 AND user_id = $2', [playerId, req.user.id]);
  if (!rows.length) {
    res.status(403).json({ error: "Vous n'êtes pas autorisé à consulter les données GPS d'un autre joueur." });
    return false;
  }
  return true;
}

/** GET /api/video/clips?match_id= — liste des clips (lecture ouverte à tout utilisateur authentifié) */
router.get('/clips', requireAuth, asyncHandler(async (req, res) => {
  const { match_id } = req.query;
  const params = []; let where = '';
  if (match_id) { params.push(match_id); where = 'WHERE match_id = $1'; }
  const { rows } = await pool.query(
    `SELECT c.*, u.full_name AS created_by_name FROM video_clips c
     LEFT JOIN users u ON u.id = c.created_by
     ${where} ORDER BY c.created_at DESC`, params
  );
  res.json({ clips: rows });
}));

/** POST /api/video/clips — crée un clip (titre + URL ou fichier local) */
router.post('/clips', requireAuth, requireRole(...ANNOTATION_STAFF_ROLES), [
  body('title').trim().notEmpty().withMessage('title est requis.'),
  body('source_type').optional().isIn(SOURCE_TYPES).withMessage(`source_type doit être l'un de : ${SOURCE_TYPES.join(', ')}.`),
  body('recorded_at_start').optional({ nullable: true }).isISO8601().withMessage('recorded_at_start doit être une date ISO 8601 valide.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const { title, video_url, source_type, match_id, player_id, recorded_at_start } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO video_clips (title, video_url, source_type, match_id, player_id, recorded_at_start, created_by)
     VALUES ($1,$2,COALESCE($3,'url'),$4,$5,$6,$7) RETURNING *`,
    [title, video_url || null, source_type || null, match_id || null, player_id || null, recorded_at_start || null, req.user.id]
  );
  res.status(201).json({ clip: rows[0] });
}));

/** PUT /api/video/clips/:id — modifie un clip (joueur par défaut, ancrage horaire réel...) */
router.put('/clips/:id', requireAuth, requireRole(...ANNOTATION_STAFF_ROLES), [
  body('recorded_at_start').optional({ nullable: true }).isISO8601().withMessage('recorded_at_start doit être une date ISO 8601 valide.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const fields = ['title', 'video_url', 'match_id', 'player_id', 'recorded_at_start'];
  const { updates, params } = buildUpdateSet(fields, req.body);
  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE video_clips SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params
  );
  if (!rows.length) return res.status(404).json({ error: 'Clip introuvable.' });
  res.json({ clip: rows[0] });
}));

/** DELETE /api/video/clips/:id — supprime un clip (cascade sur ses annotations) */
router.delete('/clips/:id', requireAuth, requireRole(...ANNOTATION_STAFF_ROLES), asyncHandler(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM video_clips WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Clip introuvable.' });
  res.status(204).send();
}));

/** GET /api/video/clips/:clipId/annotations — annotations d'un clip, triées par timestamp */
router.get('/clips/:clipId/annotations', requireAuth, asyncHandler(async (req, res) => {
  const { rows: clipRows } = await pool.query('SELECT id FROM video_clips WHERE id = $1', [req.params.clipId]);
  if (!clipRows.length) return res.status(404).json({ error: 'Clip introuvable.' });
  const { rows } = await pool.query(
    `SELECT * FROM video_annotations WHERE clip_id = $1 ORDER BY timestamp_start_sec ASC, created_at ASC`,
    [req.params.clipId]
  );
  res.json({ annotations: rows });
}));

/** POST /api/video/clips/:clipId/annotations — crée une annotation sur un clip */
router.post('/clips/:clipId/annotations', requireAuth, requireRole(...ANNOTATION_STAFF_ROLES), [
  body('type').isIn(ANNOTATION_TYPES).withMessage(`type doit être l'un de : ${ANNOTATION_TYPES.join(', ')}.`),
  body('data').isObject().withMessage('data (objet) est requis.'),
  body('timestamp_start_sec').isFloat({ min: 0 }).withMessage('timestamp_start_sec doit être un nombre positif.'),
  body('timestamp_end_sec').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('timestamp_end_sec doit être un nombre positif.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { rows: clipRows } = await pool.query('SELECT id FROM video_clips WHERE id = $1', [req.params.clipId]);
  if (!clipRows.length) return res.status(404).json({ error: 'Clip introuvable.' });

  const { type, data, timestamp_start_sec, timestamp_end_sec, player_id } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO video_annotations (clip_id, type, data, timestamp_start_sec, timestamp_end_sec, player_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.clipId, type, JSON.stringify(data), timestamp_start_sec, timestamp_end_sec ?? null, player_id || null, req.user.id]
  );
  res.status(201).json({ annotation: rows[0] });
}));

/**
 * GET /api/video/annotations/:id/gps — corrèle une annotation à une vraie
 * position GPS, en pontant l'horloge vidéo (timestamp_start_sec) et
 * l'horloge réelle des données GPS existantes via l'ancrage horaire du clip
 * (video_clips.recorded_at_start). Ne fabrique jamais de position : réponse
 * honnête à 3 issues (found:true, ou found:false avec la raison exacte).
 * Interroge les DEUX sources GPS déjà existantes — gps_points (sessions
 * post-match) et gps_live_tracking (Match Live) — retient la plus proche
 * dans le temps, dans une tolérance de ${GPS_CORRELATION_TOLERANCE_SEC}s.
 */
router.get('/annotations/:id/gps', requireAuth, asyncHandler(async (req, res) => {
  const { rows: annoRows } = await pool.query(
    `SELECT a.id, a.player_id, a.timestamp_start_sec, c.recorded_at_start, c.match_id
     FROM video_annotations a JOIN video_clips c ON c.id = a.clip_id
     WHERE a.id = $1`,
    [req.params.id]
  );
  if (!annoRows.length) return res.status(404).json({ error: 'Annotation introuvable.' });
  const anno = annoRows[0];

  if (!anno.player_id || !anno.recorded_at_start) {
    return res.json({ found: false, reason: 'no_time_anchor' });
  }

  const allowed = await requireOwnPlayerIfPlayerRole(req, res, anno.player_id);
  if (!allowed) return; // réponse 403 déjà envoyée

  // Horaire réel cible = ancrage du clip + position dans la vidéo.
  const targetTimeExpr = `$1::timestamptz + ($2 || ' seconds')::interval`;

  const [fromPoints, fromLive] = await Promise.all([
    pool.query(
      `SELECT gp.latitude, gp.longitude, gp.speed_kmh,
              ABS(EXTRACT(EPOCH FROM (gp.recorded_at - (${targetTimeExpr})))) AS delta_seconds
       FROM gps_points gp JOIN gps_sessions gs ON gs.id = gp.session_id
       WHERE gs.player_id = $3
       ORDER BY delta_seconds ASC LIMIT 1`,
      [anno.recorded_at_start, anno.timestamp_start_sec, anno.player_id]
    ),
    pool.query(
      `SELECT glt.latitude, glt.longitude, glt.speed AS speed_kmh,
              ABS(EXTRACT(EPOCH FROM (glt.timestamp - (${targetTimeExpr})))) AS delta_seconds
       FROM gps_live_tracking glt
       WHERE glt.player_id = $3
         AND ($4::uuid IS NULL OR glt.match_id IN (SELECT id FROM matches_live WHERE match_id = $4))
       ORDER BY delta_seconds ASC LIMIT 1`,
      [anno.recorded_at_start, anno.timestamp_start_sec, anno.player_id, anno.match_id]
    ),
  ]);

  const candidates = [
    fromPoints.rows[0] && { ...fromPoints.rows[0], source: 'gps_points' },
    fromLive.rows[0] && { ...fromLive.rows[0], source: 'gps_live_tracking' },
  ].filter(Boolean).filter((c) => Number(c.delta_seconds) <= GPS_CORRELATION_TOLERANCE_SEC);

  if (!candidates.length) return res.json({ found: false, reason: 'no_nearby_gps_data' });

  const best = candidates.sort((a, b) => Number(a.delta_seconds) - Number(b.delta_seconds))[0];
  res.json({
    found: true,
    latitude: best.latitude != null ? Number(best.latitude) : null,
    longitude: best.longitude != null ? Number(best.longitude) : null,
    speed_kmh: best.speed_kmh != null ? Number(best.speed_kmh) : null,
    source: best.source,
    delta_seconds: Math.round(Number(best.delta_seconds)),
  });
}));

/** PUT /api/video/annotations/:id — modifie une annotation (position, style, fenêtre temporelle) */
router.put('/annotations/:id', requireAuth, requireRole(...ANNOTATION_STAFF_ROLES), asyncHandler(async (req, res) => {
  const fields = ['type', 'timestamp_start_sec', 'timestamp_end_sec', 'player_id'];
  const { updates, params } = buildUpdateSet(fields, req.body);
  if (req.body.data !== undefined) {
    params.push(JSON.stringify(req.body.data));
    updates.push(`data = $${params.length}`);
  }
  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE video_annotations SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params
  );
  if (!rows.length) return res.status(404).json({ error: 'Annotation introuvable.' });
  res.json({ annotation: rows[0] });
}));

/** DELETE /api/video/annotations/:id — supprime une annotation */
router.delete('/annotations/:id', requireAuth, requireRole(...ANNOTATION_STAFF_ROLES), asyncHandler(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM video_annotations WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Annotation introuvable.' });
  res.status(204).send();
}));

module.exports = router;
