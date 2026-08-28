// =============================================================================
// SECOND CLUB DE DÉMONSTRATION — fixture additive, structurellement parallèle
// à db/seed.js, utilisée UNIQUEMENT pour vérifier l'isolation multi-club
// (test/multi-tenant-isolation.test.js). N'écrit jamais dans le club
// "CoachBoot FC" créé par seed.js — ne le lance qu'APRÈS `node db/seed.js`.
//
// Additif et rejouable : `ON CONFLICT (slug) DO NOTHING` sur le club lui-même,
// mais les lignes filles (users/teams/players/...) NE sont PAS protégées par
// un ON CONFLICT — relancer ce script sur une base où le club existe déjà
// créerait des doublons. Usage prévu : une fois par environnement de test.
//
// Usage : node db/seed-second-club.js
// =============================================================================
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');

async function seedSecondClub() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('→ Création du second club de démonstration...');
    const { rows: existing } = await client.query(`SELECT id FROM clubs WHERE slug = 'fc-riviere-test'`);
    if (existing.length) {
      console.log('⚠️  Le club "fc-riviere-test" existe déjà (id=' + existing[0].id + ') — abandon pour éviter les doublons.');
      await client.query('ROLLBACK');
      return;
    }
    const { rows: clubRows } = await client.query(
      `INSERT INTO clubs (name, slug, invite_code) VALUES ($1,$2,$3) RETURNING id`,
      ['FC Rivière (test)', 'fc-riviere-test', 'FC-RIVIERE-TEST-2026']
    );
    const clubId = clubRows[0].id;

    console.log('→ Création des utilisateurs...');
    const passwordHash = await bcrypt.hash('CoachBoot2026!', 10);
    const usersToInsert = [
      ['Yanis Duflot', 'entraineur@fc-riviere-test.app', 'head_coach', 'YD'],
      ['Camille Roussel', 'directeur.technique@fc-riviere-test.app', 'technical_director', 'CR'],
      ['Théo Marchal', 'joueur@fc-riviere-test.app', 'player', 'TM'],
    ];
    const userIds = {};
    for (const [full_name, email, role, initials] of usersToInsert) {
      const { rows } = await client.query(
        `INSERT INTO users (full_name, email, password_hash, role, avatar_initials, club_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [full_name, email, passwordHash, role, initials, clubId]
      );
      userIds[email] = rows[0].id;
    }

    console.log('→ Création d\'une équipe...');
    const { rows: teamRows } = await client.query(
      `INSERT INTO teams (club_id, name, category, level, coach_name) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [clubId, 'Équipe A (Senior)', 'Senior', 'Développement', 'Y. Duflot']
    );
    const teamId = teamRows[0].id;

    console.log('→ Création des joueurs...');
    const players = [
      ['Théo', 'Marchal', 'Milieu', 7, '2001-06-19', 'Disponible', 80, userIds['joueur@fc-riviere-test.app']],
      ['Malo', 'Girardin', 'Défenseur', 3, '1999-02-11', 'Disponible', 75, null],
      ['Yanis', 'Pelletier', 'Attaquant', 9, '2003-10-05', 'Disponible', 82, null],
    ];
    const playerIds = [];
    for (const [first_name, last_name, position, jersey_number, birthdate, status, form_score, user_id] of players) {
      const { rows } = await client.query(
        `INSERT INTO players (club_id,first_name,last_name,position,jersey_number,birthdate,team_id,status,form_score,user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [clubId, first_name, last_name, position, jersey_number, birthdate, teamId, status, form_score, user_id]
      );
      playerIds.push(rows[0].id);
    }

    console.log('→ Création d\'un match...');
    // home_team utilise EXACTEMENT clubs.name (comme seed.js le fait pour "CoachBoot FC")
    // — c'est ce qui permet à GET /api/dashboard/summary de déterminer "notre" équipe.
    const { rows: matchRows } = await client.query(
      `INSERT INTO matches (club_id,home_team,away_team,competition,match_date,home_score,away_score,status,possession_pct,xg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [clubId, 'FC Rivière (test)', 'US Plateau', 'Ligue 2 Amateur', '2026-07-20T15:00:00Z', 2, 0, 'Terminé', 53.0, 1.9]
    );
    const matchId = matchRows[0].id;

    console.log('→ Création d\'un rapport...');
    await client.query(
      `INSERT INTO reports (club_id, title, type, report_date, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [clubId, 'Rapport tactique — vs US Plateau', 'Tactique', '2026-07-20', userIds['entraineur@fc-riviere-test.app']]
    );

    console.log('→ Création d\'une notification (broadcast club)...');
    await client.query(
      `INSERT INTO notifications (club_id, user_id, title, body, category) VALUES ($1,$2,$3,$4,$5)`,
      [clubId, null, 'Bilan de match', 'Victoire 2-0 contre US Plateau', 'succès']
    );

    console.log('→ Création d\'une blessure...');
    await client.query(
      `INSERT INTO injuries (club_id, player_id, type, start_date, expected_return, status) VALUES ($1,$2,$3,$4,$5,$6)`,
      [clubId, playerIds[1], 'Genou (gêne légère)', '2026-07-22', '2026-08-05', 'Sous surveillance']
    );

    await client.query('COMMIT');
    console.log('\n✅ Second club de démonstration créé avec succès.');
    console.log(`   Club : FC Rivière (test) — code d'invitation : FC-RIVIERE-TEST-2026`);
    console.log('   Comptes (mot de passe : CoachBoot2026!) :');
    usersToInsert.forEach(([, email, role]) => console.log(`   - ${email}  (${role})`));
    console.log(`\n   IDs pour les tests d'isolation : club_id=${clubId}, match_id=${matchId}, player_ids=${JSON.stringify(playerIds)}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur pendant le seed du second club :', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seedSecondClub();
