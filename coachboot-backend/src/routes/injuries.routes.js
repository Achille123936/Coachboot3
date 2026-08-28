const router = require('express').Router();
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
  const conditions = [];
  const params = [];
  addClubFilter(conditions, params, req.clubId, 'i.club_id');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT i.*, p.first_name, p.last_name
    FROM injuries i JOIN players p ON p.id = i.player_id
    ${where}
    ORDER BY i.start_date DESC`, params);
  res.json({ injuries: rows });
}));

/**
 * GET /api/injuries/risk-scores
 * Score de risque de blessure par joueur (0-100), calculé à partir de :
 *  - l'ACWR (Acute:Chronic Workload Ratio, charge des 7 derniers jours / charge
 *    moyenne des 28 derniers jours) sur les séances GPS — une "zone de forme" de
 *    0.8 à 1.3 est associée à un risque plus faible dans la littérature sportive
 *    (Gabbett, 2016) ; s'en écarter (pic de charge ou sous-charge après coupure)
 *    fait grimper le score.
 *  - l'historique de blessures (nombre passé + récidive < 6 mois).
 *  - le statut actuel du joueur (déjà blessé = risque maximal affiché).
 * Ce n'est pas un modèle entraîné (aucune donnée labellisée n'est disponible),
 * mais un score pondéré explicable sur des indicateurs réels de charge/historique.
 * Club-scopé : le pool de joueurs (et donc le calcul) ne mélange jamais deux clubs.
 */
router.get('/risk-scores', asyncHandler(async (req, res) => {
  const playersConditions = []; const playersParams = [];
  const sessionsConditions = []; const sessionsParams = [];
  const injuriesConditions = []; const injuriesParams = [];
  addClubFilter(playersConditions, playersParams, req.clubId);
  addClubFilter(sessionsConditions, sessionsParams, req.clubId);
  addClubFilter(injuriesConditions, injuriesParams, req.clubId);
  const playersWhere = playersConditions.length ? `WHERE ${playersConditions.join(' AND ')}` : '';
  const sessionsWhere = sessionsConditions.length ? `WHERE ${sessionsConditions.join(' AND ')}` : '';
  const injuriesWhere = injuriesConditions.length ? `WHERE ${injuriesConditions.join(' AND ')}` : '';

  const [{ rows: players }, { rows: sessions }, { rows: injuries }] = await Promise.all([
    pool.query(`SELECT id, first_name, last_name, status FROM players ${playersWhere}`, playersParams),
    pool.query(`SELECT player_id, session_date, distance_km, high_intensity_km FROM gps_sessions ${sessionsWhere}`, sessionsParams),
    pool.query(`SELECT player_id, start_date, status FROM injuries ${injuriesWhere}`, injuriesParams),
  ]);

  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  const byPlayer = new Map(players.map(p => [p.id, {
    player: p, acute: [], chronic: [], injuryCount: 0, recentInjury: false,
  }]));

  for (const s of sessions) {
    const bucket = byPlayer.get(s.player_id);
    if (!bucket) continue;
    const ageDays = (now - new Date(s.session_date).getTime()) / DAY;
    const load = Number(s.high_intensity_km ?? s.distance_km ?? 0) || 0;
    if (ageDays <= 28) bucket.chronic.push(load);
    if (ageDays <= 7) bucket.acute.push(load);
  }
  for (const inj of injuries) {
    const bucket = byPlayer.get(inj.player_id);
    if (!bucket) continue;
    bucket.injuryCount += 1;
    const ageDays = (now - new Date(inj.start_date).getTime()) / DAY;
    if (ageDays <= 180) bucket.recentInjury = true;
  }

  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const scores = [...byPlayer.values()].map(b => {
    const acuteAvg = avg(b.acute);
    const chronicAvg = avg(b.chronic);
    const hasLoadData = b.chronic.length > 0 || b.acute.length > 0;
    const acwr = chronicAvg > 0 ? acuteAvg / chronicAvg : (acuteAvg > 0 ? 2 : 1);

    const acwrPenalty = hasLoadData
      ? Math.max(0, acwr - 1.3) * 45 + Math.max(0, 0.8 - acwr) * 15
      : 0;
    const historyPenalty = Math.min(b.injuryCount * 8, 24) + (b.recentInjury ? 12 : 0);
    const statusPenalty = b.player.status === 'Blessé' ? 30 : 0;

    const score = Math.max(2, Math.min(98, Math.round(8 + acwrPenalty + historyPenalty + statusPenalty)));
    const category = score >= 66 ? 'Élevé' : score >= 35 ? 'Modéré' : 'Faible';

    return {
      player_id: b.player.id,
      name: `${b.player.first_name} ${b.player.last_name}`,
      status: b.player.status,
      score, category,
      acwr: hasLoadData ? Math.round(acwr * 100) / 100 : null,
      injury_count: b.injuryCount,
    };
  }).sort((a, b) => b.score - a.score);

  const category_counts = scores.reduce((acc, s) => {
    acc[s.category] = (acc[s.category] || 0) + 1;
    return acc;
  }, { Faible: 0, Modéré: 0, Élevé: 0 });

  res.json({ scores, category_counts });
}));

router.post('/', requireRole('fitness_coach', 'head_coach'), asyncHandler(async (req, res) => {
  const { player_id, type, start_date, expected_return, status, notes } = req.body;
  if (!player_id || !type || !start_date) {
    return res.status(400).json({ error: 'player_id, type et start_date sont requis.' });
  }

  // player_id est fourni par le client — vérifier qu'il appartient bien au
  // club de l'appelant avant d'écrire quoi que ce soit (sinon un club pourrait
  // créer une blessure sur le joueur d'un AUTRE club via un id deviné/copié).
  const playerConditions = ['id = $1'];
  const playerParams = [player_id];
  addClubFilter(playerConditions, playerParams, req.clubId);
  const { rows: playerRows } = await pool.query(`SELECT id, club_id, first_name, last_name FROM players WHERE ${playerConditions.join(' AND ')}`, playerParams);
  if (!playerRows.length) return res.status(404).json({ error: 'Joueur introuvable.' });
  const clubId = req.clubId ?? playerRows[0].club_id;

  const { rows } = await pool.query(
    `INSERT INTO injuries (club_id, player_id, type, start_date, expected_return, status, notes)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'En soins'),$7) RETURNING *`,
    [clubId, player_id, type, start_date, expected_return || null, status, notes || null]
  );
  // Un joueur blessé passe automatiquement au statut "Blessé"
  const { rows: [player] } = await pool.query(`UPDATE players SET status = 'Blessé' WHERE id = $1 RETURNING first_name, last_name`, [player_id]);
  await createNotification({
    clubId,
    title: 'Alerte blessure',
    body: player ? `${player.first_name} ${player.last_name} — ${type}` : `Nouvelle blessure enregistrée (${type})`,
    category: 'alerte',
  });
  res.status(201).json({ injury: rows[0] });
}));

router.put('/:id', requireRole('fitness_coach', 'head_coach'), asyncHandler(async (req, res) => {
  const fields = ['type', 'expected_return', 'status', 'notes'];
  const { updates, params } = buildUpdateSet(fields, req.body);
  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  const conditions = [];
  params.push(req.params.id);
  conditions.push(`id = $${params.length}`);
  addClubFilter(conditions, params, req.clubId);
  const { rows } = await pool.query(`UPDATE injuries SET ${updates.join(', ')} WHERE ${conditions.join(' AND ')} RETURNING *`, params);
  if (!rows.length) return res.status(404).json({ error: 'Blessure introuvable.' });

  if (req.body.status === 'Rétabli') {
    const { rows: [player] } = await pool.query(`UPDATE players SET status = 'Disponible' WHERE id = $1 RETURNING first_name, last_name`, [rows[0].player_id]);
    await createNotification({
      clubId: rows[0].club_id,
      title: 'Retour de blessure',
      body: player ? `${player.first_name} ${player.last_name} est de nouveau disponible.` : 'Un joueur est de nouveau disponible.',
      category: 'succès',
    });
  }
  res.json({ injury: rows[0] });
}));

module.exports = router;
