const router = require('express').Router();
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/dashboard/summary
 * Agrège plusieurs tables pour renseigner les cartes KPI et graphiques
 * du tableau de bord, en une seule requête côté client.
 */
router.get('/summary', requireAuth, asyncHandler(async (req, res) => {
  const CLUB_NAME = 'CoachBoot FC';
  const [matchesPlayed, availablePlayers, totalPlayers, xgSum, nextMatch, recentMatches, clubMatches] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM matches WHERE status = 'Terminé'`),
    pool.query(`SELECT COUNT(*)::int AS n FROM players WHERE status = 'Disponible'`),
    pool.query(`SELECT COUNT(*)::int AS n FROM players`),
    pool.query(`SELECT COALESCE(SUM(xg),0)::float AS total FROM matches WHERE status = 'Terminé'`),
    pool.query(`SELECT * FROM matches WHERE status = 'À venir' ORDER BY match_date ASC LIMIT 1`),
    pool.query(`SELECT * FROM matches ORDER BY match_date DESC LIMIT 5`),
    pool.query(
      `SELECT home_team, away_team, home_score, away_score FROM matches
       WHERE status = 'Terminé' AND (home_team = $1 OR away_team = $1)`,
      [CLUB_NAME]
    ),
  ]);

  // Points réels calculés à partir des résultats enregistrés (3 pts victoire, 1 nul, 0 défaite).
  let points = 0;
  for (const m of clubMatches.rows) {
    const isHome = m.home_team === CLUB_NAME;
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
