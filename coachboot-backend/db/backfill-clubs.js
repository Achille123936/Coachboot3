// =============================================================================
// BACKFILL MULTI-CLUB — assigne toute ligne EXISTANTE (créée avant la
// retrofit multi-tenant) à un club par défaut « CoachBoot FC ».
//
// Usage : node db/backfill-clubs.js
// Idempotent et rejouable sans risque : `ON CONFLICT DO NOTHING` pour le club,
// `WHERE club_id IS NULL` pour chaque UPDATE — relancer ce script sur une base
// déjà backfillée ne fait rien (0 lignes affectées partout).
//
// Ne concerne QUE la base Neon déjà peuplée avant l'ajout de `club_id` — une
// base neuve n'a jamais besoin de ce script, `db/seed.js` insère déjà
// `club_id` sur chaque ligne dès la création.
//
// À lancer AVANT db/enforce-club-not-null.sql (qui verrouille NOT NULL une
// fois qu'on a vérifié ici que 0 ligne ne reste orpheline).
// =============================================================================
require('dotenv').config();
const pool = require('../src/config/db');

// Tables avec club_id, hors `users` (traité séparément : NULL réservé à role='admin').
const CLUB_TABLES = [
  'teams', 'players', 'matches', 'trainings', 'scouting_profiles', 'reports',
  'notifications', 'injuries', 'gps_sessions', 'gps_points', 'gps_statistics',
  'matches_live', 'gps_live_tracking', 'live_events', 'ml_models',
  'video_clips', 'video_annotations',
];

async function backfill() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('→ Création/récupération du club par défaut « CoachBoot FC »...');
    await client.query(
      `INSERT INTO clubs (name, slug, invite_code) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`,
      ['CoachBoot FC', 'coachboot-fc', 'COACHBOOT-FC-2026']
    );
    const { rows: clubRows } = await client.query(`SELECT id FROM clubs WHERE slug = 'coachboot-fc'`);
    const defaultClubId = clubRows[0].id;
    console.log(`  club_id par défaut = ${defaultClubId}`);

    for (const table of CLUB_TABLES) {
      const { rowCount } = await client.query(
        `UPDATE ${table} SET club_id = $1 WHERE club_id IS NULL`, [defaultClubId]
      );
      console.log(`→ ${table} : ${rowCount} ligne(s) rattachée(s) au club par défaut.`);
    }

    console.log("→ users (hors role='admin', qui reste sans club — superadmin plateforme)...");
    const { rowCount: usersUpdated } = await client.query(
      `UPDATE users SET club_id = $1 WHERE club_id IS NULL AND role <> 'admin'`, [defaultClubId]
    );
    console.log(`  users : ${usersUpdated} ligne(s) rattachée(s).`);

    console.log('\n→ Vérification : lignes encore orphelines (club_id IS NULL) avant de valider :');
    let anyOrphan = false;
    for (const table of CLUB_TABLES) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE club_id IS NULL`);
      console.log(`  ${table} : ${rows[0].n} orpheline(s)`);
      if (rows[0].n > 0) anyOrphan = true;
    }
    const { rows: orphanUsers } = await client.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE club_id IS NULL AND role <> 'admin'`
    );
    console.log(`  users (hors admin) : ${orphanUsers[0].n} orpheline(s)`);
    if (orphanUsers[0].n > 0) anyOrphan = true;

    if (anyOrphan) {
      throw new Error('Des lignes restent sans club_id après le backfill — annulation (ROLLBACK). Voir le détail ci-dessus.');
    }

    await client.query('COMMIT');
    console.log('\n✅ Backfill terminé avec succès — 0 ligne orpheline. Vous pouvez maintenant lancer '
      + 'db/enforce-club-not-null.sql pour verrouiller la contrainte NOT NULL.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur pendant le backfill (annulé) :', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

backfill();
