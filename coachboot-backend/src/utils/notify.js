const pool = require('../config/db');

/**
 * Insère une notification réelle (pas de simulation) déclenchée par un
 * événement métier effectif (blessure créée, match programmé...). `userId`
 * omis/null = diffusion à TOUT LE CLUB `clubId` (jamais à tous les clubs —
 * voir notifications.routes.js GET /, qui filtre désormais `club_id = $1 AND
 * (user_id = $2 OR user_id IS NULL)`). `clubId` est requis : chaque appelant
 * doit passer `req.clubId` (jamais null en pratique ici, ces routes sont
 * toutes protégées par requireClubScope et appelées par du staff de club).
 */
async function createNotification({ clubId, userId = null, title, body = null, category = 'info' }) {
  if (!clubId) throw new Error('createNotification: clubId est requis.');
  await pool.query(
    `INSERT INTO notifications (club_id, user_id, title, body, category) VALUES ($1,$2,$3,$4,$5)`,
    [clubId, userId, title, body, category]
  );
}

module.exports = { createNotification };
