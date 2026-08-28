-- ============================================================================
-- ENFORCE CLUB NOT NULL — verrou final de la retrofit multi-tenant.
-- À lancer UNE SEULE FOIS, consciemment, APRÈS avoir vérifié que
-- `node db/backfill-clubs.js` s'est terminé avec "0 ligne orpheline" partout.
--
-- Volontairement séparé de db/schema.sql : contrairement au reste du schéma
-- (100% idempotent, rejouable sans risque même sur une base vide), ce fichier
-- est un verrou à sens unique — le rejouer sur une base qui aurait de
-- nouvelles lignes non-backfillées la casserait. `db/seed.js` insère déjà
-- `club_id` sur une base neuve, donc une base neuve peut appliquer ce fichier
-- immédiatement après schema.sql sans jamais avoir besoin de backfill-clubs.js.
--
-- Exécution :
--   node -e "require('dotenv').config(); const fs=require('fs'); const pool=require('./src/config/db'); pool.query(fs.readFileSync('db/enforce-club-not-null.sql','utf8')).then(()=>pool.end())"
-- ============================================================================

ALTER TABLE teams              ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE players            ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE matches            ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE trainings          ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE scouting_profiles  ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE reports            ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE notifications      ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE injuries           ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE gps_sessions       ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE gps_points         ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE gps_statistics     ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE matches_live       ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE gps_live_tracking  ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE live_events        ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE ml_models          ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE video_clips        ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE video_annotations  ALTER COLUMN club_id SET NOT NULL;

-- users : club_id NULL ssi role='admin' (superadmin plateforme, toutes clubs).
ALTER TABLE users ADD CONSTRAINT chk_users_club_id
  CHECK ((role = 'admin' AND club_id IS NULL) OR (role <> 'admin' AND club_id IS NOT NULL));
