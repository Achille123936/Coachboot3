const pool = require('../config/db');

/**
 * Insère une notification réelle (pas de simulation) déclenchée par un
 * événement métier effectif (blessure créée, match programmé...). `userId`
 * omis/null = diffusion à tous les comptes (même convention que db/seed.js).
 */
async function createNotification({ userId = null, title, body = null, category = 'info' }) {
  await pool.query(
    `INSERT INTO notifications (user_id, title, body, category) VALUES ($1,$2,$3,$4)`,
    [userId, title, body, category]
  );
}

module.exports = { createNotification };
