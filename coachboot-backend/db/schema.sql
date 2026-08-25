-- ============================================================================
-- COACHBOOT ENTERPRISE — SCHÉMA DE BASE DE DONNÉES (PostgreSQL)
-- ============================================================================
-- Convention : tables au pluriel, clés primaires UUID, timestamps automatiques.
-- Exécution : psql -U postgres -d coachboot -f db/schema.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- pour gen_random_uuid()

-- ---------------------------------------------------------------------------
-- ENUM : rôles applicatifs (utilisés pour le contrôle d'accès par rôle)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'admin', 'president', 'technical_director', 'head_coach', 'fitness_coach',
    'goalkeeper_coach', 'video_analyst', 'data_analyst', 'player', 'parent', 'federation'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- USERS — comptes de connexion (staff, joueurs, parents...)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      VARCHAR(120) NOT NULL,
  email          VARCHAR(160) UNIQUE NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           user_role NOT NULL DEFAULT 'player',
  avatar_initials VARCHAR(4) DEFAULT '',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  -- Réinitialisation de mot de passe : seul le HACHAGE du jeton est stocké
  -- (jamais le jeton en clair), avec expiration — voir POST /auth/forgot-password.
  password_reset_token_hash VARCHAR(64),
  password_reset_expires_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- TEAMS — équipes du club (catégories d'âge, niveau)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(120) NOT NULL,
  category    VARCHAR(40)  NOT NULL,        -- ex: Senior, U23, U19, U17
  level       VARCHAR(40)  NOT NULL DEFAULT 'Développement', -- Elite, Développement, Académie
  coach_name  VARCHAR(120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- PLAYERS — fiche joueur (liée en option à un compte utilisateur)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  team_id        UUID REFERENCES teams(id) ON DELETE SET NULL,
  first_name     VARCHAR(80) NOT NULL,
  last_name      VARCHAR(80) NOT NULL,
  position       VARCHAR(40) NOT NULL,      -- Gardien, Défenseur, Milieu, Attaquant
  jersey_number  INTEGER,
  birthdate      DATE,
  status         VARCHAR(30) NOT NULL DEFAULT 'Disponible', -- Disponible, Blessé, Suspendu
  form_score     INTEGER NOT NULL DEFAULT 70 CHECK (form_score BETWEEN 0 AND 100),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);

-- ---------------------------------------------------------------------------
-- MATCHES — calendrier et résultats
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_team      VARCHAR(120) NOT NULL,
  away_team      VARCHAR(120) NOT NULL,
  competition    VARCHAR(120) NOT NULL,
  match_date     TIMESTAMPTZ NOT NULL,
  home_score     INTEGER,
  away_score     INTEGER,
  status         VARCHAR(20) NOT NULL DEFAULT 'À venir', -- À venir, Terminé
  possession_pct NUMERIC(5,2),
  xg             NUMERIC(5,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);

-- ---------------------------------------------------------------------------
-- TRAININGS — séances d'entraînement
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trainings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          UUID REFERENCES teams(id) ON DELETE CASCADE,
  session_date     TIMESTAMPTZ NOT NULL,
  type             VARCHAR(60) NOT NULL,   -- Tactique, Physique, Technique, Récupération...
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  rpe              INTEGER CHECK (rpe BETWEEN 0 AND 10),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- SCOUTING PROFILES — joueurs suivis par la cellule de recrutement
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scouting_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  current_club  VARCHAR(120),
  position      VARCHAR(40),
  age           INTEGER,
  rating        NUMERIC(3,1),
  tag           VARCHAR(40),   -- Fort potentiel, Prêt à intégrer, À surveiller
  notes         TEXT,
  is_favorite   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE scouting_profiles ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- COURSES / QUIZZES / CERTIFICATES — formation continue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          VARCHAR(160) NOT NULL,
  level          VARCHAR(30) NOT NULL DEFAULT 'Intermédiaire',
  duration_label VARCHAR(20),
  description    TEXT,             -- ajouté pour CoachBoot IA Academy — nullable, ne casse pas les cours existants
  objective      TEXT,             -- objectif pédagogique global du module
  module_number  INTEGER,          -- ordre d'affichage dans l'Academy (1-6, 7 = projet final)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE courses ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS objective TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS module_number INTEGER;

CREATE TABLE IF NOT EXISTS course_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, course_id)
);

-- ---------------------------------------------------------------------------
-- COACHBOOT IA ACADEMY — hiérarchie Course → Chapter → Lesson, étend les
-- tables "courses"/"quizzes"/"certificates" ci-dessus plutôt que de créer un
-- second système de formation parallèle (chaque "MODULE" de l'Academy EST une
-- ligne `courses`, chaque quiz de chapitre EST une ligne `quizzes`).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_chapters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  title       VARCHAR(200) NOT NULL,
  objective   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(course_id, position)
);

CREATE TABLE IF NOT EXISTS course_lessons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id        UUID NOT NULL REFERENCES course_chapters(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  title             VARCHAR(200) NOT NULL,
  level             VARCHAR(20) NOT NULL DEFAULT 'Débutant', -- Débutant | Intermédiaire | Avancé
  objective         TEXT,
  prerequisites     TEXT,
  explanation       TEXT NOT NULL,
  football_example  TEXT,
  coachboot_demo    TEXT,   -- pointe vers une page/fonctionnalité RÉELLE de CoachBoot, ou
                             -- « Fonctionnalité prévue / à venir » si elle n'existe pas encore
  key_takeaways     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chapter_id, position)
);

CREATE TABLE IF NOT EXISTS lesson_completions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id    UUID NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS quizzes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          VARCHAR(160) NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 10,
  chapter_id     UUID REFERENCES course_chapters(id) ON DELETE CASCADE, -- NULL = quiz autonome (quizzes.html)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS chapter_id UUID REFERENCES course_chapters(id) ON DELETE CASCADE;

-- Questions réellement stockées et notées côté serveur (avant l'Academy, `quizzes`
-- n'avait qu'un `question_count` : le score était déclaré par le client, jamais
-- vérifié — voir la note honnête dans docs/API.md).
CREATE TABLE IF NOT EXISTS quiz_questions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  question_type  VARCHAR(20) NOT NULL, -- qcm | vrai_faux | analyse | cas_pratique
  question_text  TEXT NOT NULL,
  choices        JSONB,        -- [{ "key": "a", "text": "..." }, ...]
  correct_answer VARCHAR(10) NOT NULL,
  explanation    TEXT,         -- feedback pédagogique affiché après la réponse
  UNIQUE(quiz_id, position)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id      UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  score_pct    INTEGER NOT NULL CHECK (score_pct BETWEEN 0 AND 100),
  answers      JSONB,          -- réponses soumises par l'apprenant, pour revue
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS answers JSONB;

CREATE TABLE IF NOT EXISTS course_exercises (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id        UUID REFERENCES course_chapters(id) ON DELETE CASCADE, -- NULL = TP final du module
  title             VARCHAR(200) NOT NULL,
  instructions      TEXT NOT NULL,
  is_final_project  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-évaluation : un TP d'analyse de données ouvert ne peut pas être noté
-- automatiquement sans se faire passer pour une correction IA fictive — voir
-- la note honnête dans docs/API.md. L'apprenant marque son propre TP comme fait.
CREATE TABLE IF NOT EXISTS exercise_completions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id  UUID NOT NULL REFERENCES course_exercises(id) ON DELETE CASCADE,
  notes        TEXT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, exercise_id)
);

CREATE TABLE IF NOT EXISTS certificates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        VARCHAR(160) NOT NULL,
  course_id    UUID REFERENCES courses(id) ON DELETE SET NULL,
  issued_date  DATE,
  status       VARCHAR(20) NOT NULL DEFAULT 'En cours', -- Délivré, En cours
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- REPORTS — rapports générés (match, physique, scouting, médical...)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(160) NOT NULL,
  type        VARCHAR(40) NOT NULL,   -- Match, Physique, Scouting, Médical, Tactique
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  file_url    VARCHAR(255),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = diffusion à tous
  title      VARCHAR(160) NOT NULL,
  body       TEXT,
  category   VARCHAR(30) NOT NULL DEFAULT 'info', -- info, alerte, succès, avertissement
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- ---------------------------------------------------------------------------
-- INJURIES — suivi médical
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS injuries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type            VARCHAR(120) NOT NULL,
  start_date      DATE NOT NULL,
  expected_return DATE,
  status          VARCHAR(30) NOT NULL DEFAULT 'En soins', -- En soins, Réathlétisation, Sous surveillance, Rétabli
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- GPS SESSIONS — données de suivi GPS par joueur / par match
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gps_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id            UUID REFERENCES matches(id) ON DELETE SET NULL,
  session_date        DATE NOT NULL,
  duration_minutes    NUMERIC(6,2),
  distance_km         NUMERIC(5,2),
  sprints             INTEGER,
  top_speed_kmh       NUMERIC(5,2),
  high_intensity_km   NUMERIC(5,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- GPS POINTS — trace brute (un point par relevé navigator.geolocation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gps_points (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES gps_sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  latitude      NUMERIC(9,6) NOT NULL,
  longitude     NUMERIC(9,6) NOT NULL,
  altitude_m    NUMERIC(7,2),
  accuracy_m    NUMERIC(6,2),
  speed_kmh     NUMERIC(5,2),
  recorded_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gps_points_session ON gps_points (session_id, seq);

-- ---------------------------------------------------------------------------
-- GPS STATISTICS — métriques physiques calculées pour une session (1↔1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gps_statistics (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id             UUID NOT NULL UNIQUE REFERENCES gps_sessions(id) ON DELETE CASCADE,
  distance_km            NUMERIC(6,3),
  high_intensity_km      NUMERIC(6,3),
  sprint_distance_km     NUMERIC(6,3),
  max_speed_kmh          NUMERIC(5,2),
  avg_speed_kmh          NUMERIC(5,2),
  acceleration_count     INTEGER,
  deceleration_count     INTEGER,
  sprint_count           INTEGER,
  intense_sprint_count   INTEGER,
  -- Traçabilité anti-triche : 'server_recomputed' = agrégats recalculés côté
  -- serveur à partir des points bruts (fiable) ; 'client_trusted' = agrégats
  -- acceptés tels quels faute de points suffisants pour les recalculer (moins
  -- fiable, voir docs/SECURITY.md).
  stats_source           VARCHAR(20) NOT NULL DEFAULT 'client_trusted',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE gps_statistics ADD COLUMN IF NOT EXISTS stats_source VARCHAR(20) NOT NULL DEFAULT 'client_trusted';

-- ---------------------------------------------------------------------------
-- MATCH LIVE — module « Match Live Camera + GPS Tracking » (diffusion + suivi
-- GPS temps réel pendant un entraînement/match). Indépendant de `matches`
-- (un match programmé peut ne jamais être « mis en direct », et une session
-- live ad hoc — entraînement, amical — n'a pas forcément de ligne `matches`).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches_live (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID REFERENCES matches(id) ON DELETE SET NULL,
  team_home     VARCHAR(120) NOT NULL,
  team_away     VARCHAR(120) NOT NULL,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  status        VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- scheduled, live, halftime, finished, cancelled
                                                            -- (validé par whitelist dans match-live.routes.js ;
                                                            --  distinct du mode réel/simulation des données GPS,
                                                            --  calculé côté client, jamais stocké ici)
  stream_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- GPS LIVE TRACKING — relevés GPS temps réel par joueur pendant une session
-- Match Live (distinct de gps_points : ici multi-joueurs, un match en cours).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gps_live_tracking (
  id            BIGSERIAL PRIMARY KEY,
  match_id      UUID NOT NULL REFERENCES matches_live(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  latitude      NUMERIC(9,6),
  longitude     NUMERIC(9,6),
  speed         NUMERIC(5,2), -- km/h
  distance      NUMERIC(6,3), -- km cumulés au moment du relevé
  acceleration  NUMERIC(5,2), -- m/s², signé (positif = accélération, négatif = freinage)
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- `ADD COLUMN IF NOT EXISTS` : rejouable sur une base déjà créée avant l'ajout du temps réel Socket.io.
ALTER TABLE gps_live_tracking ADD COLUMN IF NOT EXISTS acceleration NUMERIC(5,2);
CREATE INDEX IF NOT EXISTS idx_gps_live_tracking_match ON gps_live_tracking (match_id, player_id, timestamp);

-- ---------------------------------------------------------------------------
-- LIVE EVENTS — événements tagués pendant un Match Live (sprint, tir, passe,
-- interception, récupération...), pour synchroniser la timeline vidéo + GPS.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS live_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    UUID NOT NULL REFERENCES matches_live(id) ON DELETE CASCADE,
  player_id   UUID REFERENCES players(id) ON DELETE SET NULL,
  event_type  VARCHAR(30) NOT NULL, -- sprint, tir, passe, interception, recuperation, accélération...
  time        INTEGER NOT NULL,     -- secondes écoulées depuis le début de la session live
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_events_match ON live_events (match_id, time);

-- ---------------------------------------------------------------------------
-- ML MODELS — modèles CoachBoot IA entraînés (coachboot-backend/ml/train.py).
-- Le fichier du modèle (poids + scaler + métadonnées) vit sur disque, sous
-- ml/models/<id>/model.joblib ; cette table indexe les métriques et le
-- statut (un seul modèle "deployed" à la fois par (task, target)).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ml_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(160) NOT NULL,
  task            VARCHAR(20) NOT NULL,   -- regression | classification
  target          VARCHAR(80) NOT NULL,
  features        JSONB NOT NULL,
  metrics         JSONB NOT NULL,
  feature_importances JSONB,
  row_count_raw   INTEGER,
  row_count_clean INTEGER,
  status          VARCHAR(20) NOT NULL DEFAULT 'trained', -- trained | deployed | archived
  -- Déclaré par l'utilisateur à l'upload (jamais déduit) — empêche qu'un jeu de
  -- données synthétique/démo soit présenté comme de vraies statistiques de match.
  dataset_type    VARCHAR(20) NOT NULL DEFAULT 'unknown', -- synthetic | real | unknown
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS dataset_type VARCHAR(20) NOT NULL DEFAULT 'unknown';
CREATE INDEX IF NOT EXISTS idx_ml_models_task_target_status ON ml_models (task, target, status);

-- ---------------------------------------------------------------------------
-- TÉLESTRATION VIDÉO — annotations tactiques manuelles (flèches, cercles,
-- lignes, zones, texte, markers joueur) posées sur une vidéo par le staff
-- (coachboot/video-analysis.html). La vidéo elle-même n'est JAMAIS stockée
-- ici : un clip référence une URL directement lisible par <video> (même
-- contrainte que le repli réseau de Match Live) ou vient d'un fichier local
-- côté navigateur (source_type='local', video_url NULL) — seule l'annotation
-- (les tracés) est persistée et partagée. Pas de tracking automatique de
-- joueur/ballon ici (ça resterait BLOCKED_EXTERNAL, voir docs/API.md).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS video_clips (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          UUID REFERENCES matches(id) ON DELETE SET NULL,
  title             VARCHAR(160) NOT NULL,
  video_url         TEXT,
  source_type       VARCHAR(10) NOT NULL DEFAULT 'url', -- url | local
  player_id         UUID REFERENCES players(id) ON DELETE SET NULL, -- joueur par défaut du clip (optionnel)
  -- Ancrage horaire réel optionnel : "cette vidéo a commencé à être enregistrée
  -- à cet instant réel". Posé manuellement par l'analyste, jamais déduit —
  -- c'est le pont entre l'horloge vidéo (timestamp_start_sec) et l'horloge
  -- réelle des données GPS (gps_points.recorded_at / gps_live_tracking.timestamp).
  -- Sans lui, aucune corrélation GPS n'est possible pour ce clip (honnête,
  -- voir GET /api/video/annotations/:id/gps).
  recorded_at_start TIMESTAMPTZ,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE video_clips ADD COLUMN IF NOT EXISTS player_id UUID REFERENCES players(id) ON DELETE SET NULL;
ALTER TABLE video_clips ADD COLUMN IF NOT EXISTS recorded_at_start TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS video_annotations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id              UUID NOT NULL REFERENCES video_clips(id) ON DELETE CASCADE,
  type                 VARCHAR(20) NOT NULL, -- arrow | circle | line | rectangle | freehand | text | player_marker
  data                 JSONB NOT NULL,       -- points/coords/color/thickness/text/player_ref, flexible par type
  timestamp_start_sec  NUMERIC(8,2) NOT NULL DEFAULT 0,
  timestamp_end_sec    NUMERIC(8,2),         -- NULL = affichage statique (pas d'animation entre 2 points)
  player_id            UUID REFERENCES players(id) ON DELETE SET NULL, -- joueur précis concerné (indépendant de video_clips.player_id)
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE video_annotations ADD COLUMN IF NOT EXISTS player_id UUID REFERENCES players(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_video_annotations_clip ON video_annotations (clip_id, timestamp_start_sec);
CREATE INDEX IF NOT EXISTS idx_video_clips_match ON video_clips (match_id);
CREATE INDEX IF NOT EXISTS idx_video_clips_player ON video_clips (player_id);
CREATE INDEX IF NOT EXISTS idx_video_annotations_player ON video_annotations (player_id);

-- ---------------------------------------------------------------------------
-- trigger générique : mise à jour automatique de updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_players_updated ON players;
CREATE TRIGGER trg_players_updated BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- INDEXES DE PERFORMANCE — colonnes de clé étrangère non couvertes par un
-- index existant (PostgreSQL n'indexe jamais automatiquement une FK). Sans
-- ça, chaque jointure et chaque suppression en cascade sur ces colonnes fait
-- un scan séquentiel de la table référencée. Ajouté après audit — idempotent,
-- rejouable sans risque sur une base déjà peuplée.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_players_user ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_trainings_team ON trainings(team_id);
CREATE INDEX IF NOT EXISTS idx_course_progress_user ON course_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_course_progress_course ON course_progress(course_id);
CREATE INDEX IF NOT EXISTS idx_course_chapters_course ON course_chapters(course_id);
CREATE INDEX IF NOT EXISTS idx_course_lessons_chapter ON course_lessons(chapter_id);
CREATE INDEX IF NOT EXISTS idx_lesson_completions_user ON lesson_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_completions_lesson ON lesson_completions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_chapter ON quizzes(chapter_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz ON quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_course_exercises_course ON course_exercises(course_id);
CREATE INDEX IF NOT EXISTS idx_course_exercises_chapter ON course_exercises(chapter_id);
CREATE INDEX IF NOT EXISTS idx_exercise_completions_user ON exercise_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_completions_exercise ON exercise_completions(exercise_id);
CREATE INDEX IF NOT EXISTS idx_certificates_user ON certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_certificates_course ON certificates(course_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_by ON reports(created_by);
CREATE INDEX IF NOT EXISTS idx_injuries_player ON injuries(player_id);
CREATE INDEX IF NOT EXISTS idx_gps_sessions_player ON gps_sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_gps_sessions_match ON gps_sessions(match_id);
CREATE INDEX IF NOT EXISTS idx_matches_live_match ON matches_live(match_id);
CREATE INDEX IF NOT EXISTS idx_gps_live_tracking_player ON gps_live_tracking(player_id);
CREATE INDEX IF NOT EXISTS idx_live_events_player ON live_events(player_id);
CREATE INDEX IF NOT EXISTS idx_ml_models_created_by ON ml_models(created_by);
