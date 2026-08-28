// Seed the database with demo data consistent with the static frontend mockups.
// Usage: node db/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('→ Nettoyage des tables (ordre respectant les clés étrangères)...');
    await client.query(`TRUNCATE gps_sessions, injuries, notifications, reports, certificates,
      quiz_attempts, quizzes, course_progress, courses, scouting_profiles, trainings,
      matches, players, teams, users, clubs RESTART IDENTITY CASCADE`);

    console.log('→ Création du club par défaut...');
    const { rows: clubRows } = await client.query(
      `INSERT INTO clubs (name, slug, invite_code) VALUES ($1,$2,$3) RETURNING id`,
      ['CoachBoot FC', 'coachboot-fc', 'COACHBOOT-FC-2026']
    );
    const clubId = clubRows[0].id;

    console.log('→ Création des utilisateurs de démonstration...');
    const passwordHash = await bcrypt.hash('CoachBoot2026!', 10);
    const usersToInsert = [
      ['Carmie Boot', 'carmie.boot@coachboot.app', 'head_coach', 'CB'],
      ['Amélie Fontaine', 'president@coachboot.app', 'president', 'AF'],
      ['Marc Lefevre', 'directeur.technique@coachboot.app', 'technical_director', 'ML'],
      ['Sofia Martins', 'prepa.physique@coachboot.app', 'fitness_coach', 'SM'],
      ['Paul Costa', 'gardiens@coachboot.app', 'goalkeeper_coach', 'PC'],
      ['Léa Bernard', 'video@coachboot.app', 'video_analyst', 'LB'],
      ['Rayan Nguyen', 'data@coachboot.app', 'data_analyst', 'RN'],
      ['Lucas Ferreira', 'joueur@coachboot.app', 'player', 'LF'],
      ['Nadia Haddad', 'parent@coachboot.app', 'parent', 'NH'],
      ['Fédération Régionale', 'federation@coachboot.app', 'federation', 'FR'],
      ['Admin Système', 'admin@coachboot.app', 'admin', 'AS'],
    ];
    const userIds = {};
    for (const [full_name, email, role, initials] of usersToInsert) {
      // 'admin' = superadmin plateforme, sans club (club_id NULL) — voir chk_users_club_id.
      const userClubId = role === 'admin' ? null : clubId;
      const { rows } = await client.query(
        `INSERT INTO users (full_name, email, password_hash, role, avatar_initials, club_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, role, email`,
        [full_name, email, passwordHash, role, initials, userClubId]
      );
      userIds[email] = rows[0].id;
    }

    console.log('→ Création des équipes...');
    const teams = [
      ['Équipe A (Senior)', 'Senior', 'Elite', 'M. Lefevre'],
      ['U23 Elite', 'U23', 'Elite', 'S. Martins'],
      ['U19 Développement', 'U19', 'Développement', 'R. Nguyen'],
      ['U17 Académie', 'U17', 'Académie', 'P. Costa'],
      ['Équipe Féminine A', 'Senior F', 'Elite', 'L. Bernard'],
    ];
    const teamIds = [];
    for (const [name, category, level, coach_name] of teams) {
      const { rows } = await client.query(
        `INSERT INTO teams (club_id, name, category, level, coach_name) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [clubId, name, category, level, coach_name]
      );
      teamIds.push(rows[0].id);
    }

    console.log('→ Création des joueurs...');
    const players = [
      ['Lucas', 'Ferreira', 'Attaquant', 9, '2002-04-12', 0, 'Disponible', 87, userIds['joueur@coachboot.app']],
      ['Julien', 'Moreau', 'Milieu', 8, '1999-01-22', 0, 'Blessé', 74, null],
      ['Karim', 'Benali', 'Défenseur', 4, '1997-07-03', 0, 'Disponible', 81, null],
      ['Thomas', 'Girard', 'Gardien', 1, '2000-09-18', 0, 'Disponible', 90, null],
      ['Amadou', 'Diallo', 'Attaquant', 11, '2005-02-27', 1, 'Disponible', 78, null],
      ['Nicolas', 'Petit', 'Milieu', 6, '2001-05-14', 0, 'Suspendu', 69, null],
      ['Rayan', 'Haddad', 'Défenseur', 5, '2003-11-30', 1, 'Disponible', 83, null],
      ['Baptiste', 'Rousseau', 'Milieu', 10, '1998-03-08', 0, 'Disponible', 92, null],
    ];
    const playerIds = [];
    for (const [first_name, last_name, position, jersey_number, birthdate, teamIdx, status, form_score, user_id] of players) {
      const { rows } = await client.query(
        `INSERT INTO players (club_id,first_name,last_name,position,jersey_number,birthdate,team_id,status,form_score,user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [clubId, first_name, last_name, position, jersey_number, birthdate, teamIds[teamIdx], status, form_score, user_id]
      );
      playerIds.push(rows[0].id);
    }

    console.log('→ Création des matchs...');
    const matches = [
      ['CoachBoot FC', 'FC Nord', 'Ligue 1 Amateur', '2026-08-02T15:00:00Z', null, null, 'À venir', null, null],
      ['AS Littoral', 'CoachBoot FC', 'Ligue 1 Amateur', '2026-07-26T15:00:00Z', 1, 2, 'Terminé', 46.5, 1.8],
      ['CoachBoot FC', 'Racing Club', 'Coupe Régionale', '2026-07-19T15:00:00Z', 3, 1, 'Terminé', 58.2, 2.6],
      ['Étoile Sud', 'CoachBoot FC', 'Ligue 1 Amateur', '2026-07-12T15:00:00Z', 0, 0, 'Terminé', 51.0, 1.1],
      ['CoachBoot FC', 'Union Est', 'Ligue 1 Amateur', '2026-07-05T15:00:00Z', 2, 2, 'Terminé', 55.4, 2.0],
    ];
    const matchIds = [];
    for (const [home_team, away_team, competition, match_date, home_score, away_score, status, possession_pct, xg] of matches) {
      const { rows } = await client.query(
        `INSERT INTO matches (club_id,home_team,away_team,competition,match_date,home_score,away_score,status,possession_pct,xg)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [clubId, home_team, away_team, competition, match_date, home_score, away_score, status, possession_pct, xg]
      );
      matchIds.push(rows[0].id);
    }

    console.log('→ Création des entraînements...');
    const trainingTypes = ['Récupération active', 'Tactique', 'Physique', 'Technique', 'Tactique pré-match'];
    for (let i = 0; i < 10; i++) {
      await client.query(
        `INSERT INTO trainings (club_id, team_id, session_date, type, duration_minutes, rpe, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [clubId, teamIds[0], `2026-07-${(10 + i)}T09:00:00Z`, trainingTypes[i % trainingTypes.length], 45 + (i % 4) * 10, 3 + (i % 6), null]
      );
    }

    console.log('→ Création des profils de scouting...');
    const scouting = [
      ['Enzo Marchetti', 'AS Rivière', 'Ailier', 19, 8.4, 'Fort potentiel'],
      ['Yassine Bouzid', 'FC Plateau', 'Défenseur central', 21, 7.9, 'Prêt à intégrer'],
      ['Hugo Salaün', 'Olympique Vallée', 'Gardien', 18, 8.1, 'À surveiller'],
      ['Idris Camara', 'Racing Club', 'Milieu défensif', 22, 7.6, 'Prêt à intégrer'],
    ];
    for (const [name, current_club, position, age, rating, tag] of scouting) {
      await client.query(
        `INSERT INTO scouting_profiles (club_id, name, current_club, position, age, rating, tag) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [clubId, name, current_club, position, age, rating, tag]
      );
    }

    console.log('→ Création des cours, quiz et certificats...');
    const courses = [
      ['Licence B — Tactique collective', 'Intermédiaire', '6h'],
      ['Préparation physique moderne', 'Avancé', '4h30'],
      ['Analyse vidéo avec données GPS', 'Avancé', '3h'],
      ['Psychologie du sport et leadership', 'Intermédiaire', '5h'],
      ['Nutrition sportive appliquée', 'Débutant', '2h30'],
      ['Détection et scouting jeunes talents', 'Avancé', '4h'],
    ];
    const courseIds = [];
    for (const [title, level, duration_label] of courses) {
      const { rows } = await client.query(`INSERT INTO courses (title, level, duration_label) VALUES ($1,$2,$3) RETURNING id`, [title, level, duration_label]);
      courseIds.push(rows[0].id);
    }
    const coachId = userIds['carmie.boot@coachboot.app'];
    const progressValues = [100, 65, 30, 0, 100, 10];
    for (let i = 0; i < courseIds.length; i++) {
      await client.query(`INSERT INTO course_progress (user_id, course_id, progress_pct) VALUES ($1,$2,$3)`, [coachId, courseIds[i], progressValues[i]]);
    }

    const quizzes = [
      ['Systèmes tactiques (1-4-3-3 vs 1-4-2-3-1)', 15],
      ['Réglementation et lois du jeu', 20],
      ['Bases de la préparation physique', 12],
      ['Lecture de données xG / xA', 10],
    ];
    for (const [title, question_count] of quizzes) {
      await client.query(`INSERT INTO quizzes (title, question_count) VALUES ($1,$2)`, [title, question_count]);
    }

    const certificates = [
      [coachId, 'Certificat Licence B UEFA', '2025-03-15', 'Délivré'],
      [coachId, 'Certificat Analyse de Performance', '2025-11-02', 'Délivré'],
      [coachId, 'Certificat Préparation Physique Avancée', null, 'En cours'],
    ];
    for (const [user_id, title, issued_date, status] of certificates) {
      await client.query(`INSERT INTO certificates (user_id, title, issued_date, status) VALUES ($1,$2,$3,$4)`, [user_id, title, issued_date, status]);
    }

    console.log('→ Création des rapports...');
    const reports = [
      ['Rapport de performance — Journée 22', 'Match', '2026-07-26'],
      ['Bilan physique mensuel — Juillet', 'Physique', '2026-07-31'],
      ['Rapport de scouting — Zone Nord', 'Scouting', '2026-07-22'],
      ['Bilan médical trimestriel', 'Médical', '2026-07-15'],
      ['Rapport tactique — vs FC Nord', 'Tactique', '2026-08-02'],
    ];
    for (const [title, type, report_date] of reports) {
      await client.query(`INSERT INTO reports (club_id, title, type, report_date, created_by) VALUES ($1,$2,$3,$4,$5)`, [clubId, title, type, report_date, coachId]);
    }

    console.log('→ Création des notifications...');
    const notifications = [
      [null, 'Alerte blessure', 'Risque élevé détecté — J. Moreau', 'alerte'],
      [null, 'Vidéo annotée', 'Analyse du match vs FC Nord disponible', 'info'],
      [null, 'Rapport de scouting', '3 nouveaux profils ajoutés', 'succès'],
    ];
    for (const [user_id, title, body, category] of notifications) {
      await client.query(`INSERT INTO notifications (club_id, user_id, title, body, category) VALUES ($1,$2,$3,$4,$5)`, [clubId, user_id, title, body, category]);
    }

    console.log('→ Création des blessures...');
    await client.query(
      `INSERT INTO injuries (club_id, player_id, type, start_date, expected_return, status) VALUES ($1,$2,$3,$4,$5,$6)`,
      [clubId, playerIds[1], 'Ischio-jambiers', '2026-07-12', '2026-08-16', 'En soins']
    );
    await client.query(
      `INSERT INTO injuries (club_id, player_id, type, start_date, expected_return, status) VALUES ($1,$2,$3,$4,$5,$6)`,
      [clubId, playerIds[5], 'Cheville (entorse légère)', '2026-07-28', '2026-08-09', 'Réathlétisation']
    );

    console.log('→ Création des sessions GPS...');
    for (let i = 0; i < 5; i++) {
      await client.query(
        `INSERT INTO gps_sessions (club_id, player_id, match_id, session_date, distance_km, sprints, top_speed_kmh, high_intensity_km)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [clubId, playerIds[0], matchIds[i], matches[i][3].slice(0, 10), 10 + Math.random() * 2, 18 + Math.floor(Math.random() * 8), 30 + Math.random() * 3, 1.5 + Math.random()]
      );
    }

    await client.query('COMMIT');
    console.log('\n✅ Base de données initialisée avec succès.');
    console.log(`   Club par défaut : CoachBoot FC (code d'invitation : COACHBOOT-FC-2026)`);
    console.log('   Comptes de démonstration (mot de passe pour tous : CoachBoot2026!) :');
    usersToInsert.forEach(([, email, role]) => console.log(`   - ${email}  (${role})`));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur pendant le seed :', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
