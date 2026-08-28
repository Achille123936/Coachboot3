const router = require('express').Router();
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireClubScope } = require('../middleware/auth');
const { addClubFilter } = require('../utils/tenantScope');

router.use(requireAuth, requireClubScope);

/**
 * GET /api/dashboard/summary
 * Agrège plusieurs tables pour renseigner les cartes KPI et graphiques
 * du tableau de bord, en une seule requête côté client. Club-scopé : plus de
 * hardcode `CLUB_NAME`/correspondance de nom d'équipe en texte (single-tenant
 * historique) — les "matchs du club" sont simplement les matchs de ce club_id.
 * Admin (superadmin, req.clubId === null) : refuse explicitement plutôt que
 * d'agréger tous les clubs dans un seul tableau de bord trompeur.
 */
router.get('/summary', asyncHandler(async (req, res) => {
  if (req.clubId === null) {
    return res.status(400).json({ error: 'Le tableau de bord est propre à un club — sélectionnez un compte de club.' });
  }
  const clubId = req.clubId;
  const { rows: [club] } = await pool.query(`SELECT name FROM clubs WHERE id = $1`, [clubId]);
  const clubName = club?.name || '';

  const [matchesPlayed, availablePlayers, totalPlayers, xgSum, nextMatch, recentMatches, clubMatches] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM matches WHERE club_id = $1 AND status = 'Terminé'`, [clubId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM players WHERE club_id = $1 AND status = 'Disponible'`, [clubId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM players WHERE club_id = $1`, [clubId]),
    pool.query(`SELECT COALESCE(SUM(xg),0)::float AS total FROM matches WHERE club_id = $1 AND status = 'Terminé'`, [clubId]),
    pool.query(`SELECT * FROM matches WHERE club_id = $1 AND status = 'À venir' ORDER BY match_date ASC LIMIT 1`, [clubId]),
    pool.query(`SELECT * FROM matches WHERE club_id = $1 ORDER BY match_date DESC LIMIT 5`, [clubId]),
    pool.query(
      `SELECT home_team, away_team, home_score, away_score FROM matches
       WHERE club_id = $1 AND status = 'Terminé' AND (home_team = $2 OR away_team = $2)`,
      [clubId, clubName]
    ),
  ]);

  // Points réels calculés à partir des résultats enregistrés (3 pts victoire, 1 nul, 0 défaite).
  // "Notre" équipe = celle dont le nom correspond à clubs.name (matches n'a pas
  // de FK vers teams/clubs — texte libre home_team/away_team, voir schema.sql).
  let points = 0;
  for (const m of clubMatches.rows) {
    const isHome = m.home_team === clubName;
    const forScore = isHome ? m.home_score : m.away_score;
    const againstScore = isHome ? m.away_score : m.home_score;
    if (forScore == null || againstScore == null) continue;
    if (forScore > againstScore) points += 3;
    else if (forScore === againstScore) points += 1;
  }

  res.json({
    matches_played: matchesPlayed.rows[0].n,
    players_available: availablePlayers.rows[0].n,
    players_total: totalPlayers.rows[0].n,
    xg_total: Math.round(xgSum.rows[0].total * 10) / 10,
    points,
    next_match: nextMatch.rows[0] || null,
    recent_matches: recentMatches.rows,
  });
}));

module.exports = router;
