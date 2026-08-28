# CoachBoot Enterprise — Référence API

Base URL par défaut : `http://localhost:4000/api`
Toutes les routes (sauf `/auth/login`, `/auth/register`, `/health`) nécessitent un en-tête :
`Authorization: Bearer <token>`

Toutes les routes sont **réellement implémentées et testées** (voir la section « Tests effectués »
en fin de document) — ceci n'est pas une spécification théorique.

## Authentification

| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Crée un compte, renvoie `{ user, token }` |
| POST | `/auth/login` | Public | Vérifie e-mail/mot de passe, renvoie `{ user, token }` |
| GET | `/auth/me` | Authentifié | Profil de l'utilisateur courant |
| PUT | `/auth/change-password` | Authentifié | `{ current_password, new_password }` — vérifie l'ancien mot de passe avant de le remplacer |
| POST | `/auth/forgot-password` | Public | `{ email }` → génère un jeton de réinitialisation (1h, à usage unique). Réponse **identique** que le compte existe ou non (anti-énumération) |
| POST | `/auth/reset-password` | Public | `{ token, new_password }` → remplace le mot de passe si le jeton est valide et non expiré |

**Flux « mot de passe oublié » réel côté logique, mais sans livraison par e-mail** : le jeton est
généré, haché (SHA-256) et stocké en base avec expiration — exactement comme le ferait un vrai
système. Ce qui manque : un service d'envoi d'e-mail (SMTP/API tierce type SendGrid/Resend), non
configuré dans ce projet. En développement (`NODE_ENV != 'production'`), la réponse inclut donc le
jeton brut (`dev_reset_token`) pour permettre de tester le flux de bout en bout via
`coachboot/reset-password.html` ; en production, `email_status: 'EMAIL_SERVICE_NOT_CONFIGURED'` est
renvoyé mais **jamais** le jeton — brancher un vrai service d'e-mail avant la mise en production
est un prérequis, pas une option.

Rôles disponibles (enum PostgreSQL `user_role`) : `admin`, `president`, `technical_director`,
`head_coach`, `fitness_coach`, `goalkeeper_coach`, `video_analyst`, `data_analyst`, `player`,
`parent`, `federation`.

## Multi-tenant (clubs) — isolation complète entre clubs

CoachBoot est multi-club (SaaS) : chaque club a des données **entièrement isolées** de celles des
autres clubs. Une nouvelle table `clubs` (`id`, `name`, `slug`, `invite_code`, `is_active`) sert de
tenant ; 18 des 29 tables portent une colonne `club_id` directe (dénormalisée volontairement, pas
seulement dérivable par jointure — voir justification dans le plan de la retrofit). Le contenu
Academy (`courses`/`chapters`/`lessons`/`quizzes`/`exercises`) reste **partagé, plateforme-entière**
(décision produit explicite) : seules les données de progression/tentatives/certificats restent
scopées par utilisateur, comme avant.

- **Inscription (`POST /auth/register`)** : exactement UN des deux champs suivants est requis —
  - `invite_code` : rejoint un club **existant** (`clubs.invite_code`), 404 si invalide/inactif.
  - `new_club_name` : **crée un nouveau club** — chaque équipe crée son propre club au lieu de
    rejoindre un club préexistant (décision produit explicite). Le club (slug + `invite_code`
    générés automatiquement) et son premier compte sont créés en une seule transaction ; la réponse
    renvoie `{ user, token, club: { id, name, slug, invite_code } }` — le premier utilisateur doit
    noter/partager cet `invite_code` pour que ses coéquipiers puissent le rejoindre ensuite via
    `invite_code`. Rôle par défaut du créateur : `technical_director` (personnalisable, jamais
    `admin`). Fournir les deux champs, ou aucun des deux, renvoie 400.

  `role: 'admin'` ne peut plus être auto-sélectionné à l'inscription, dans les deux cas (corrige au
  passage une élévation de privilège pré-existante).
- **JWT** : le jeton porte désormais `club_id` (`null` uniquement pour `role: 'admin'`, le
  superadmin plateforme) et une version de schéma `v: 2`. Tout jeton signé avant cette retrofit
  (sans `v: 2`) est rejeté par `requireAuth` avec 401 — **il faut se reconnecter** après la mise à
  jour (comptes de démonstration : mot de passe inchangé, `CoachBoot2026!`).
- **`admin`** est le seul rôle sans club : il voit/gère toutes les clubs sans filtre (bypass déjà
  existant dans `requireRole`, désormais formalisé comme superadmin plateforme).
- **Portée des requêtes** : `requireClubScope` (après `requireAuth`) injecte `req.clubId` sur les 14
  routeurs propres à un club ; chaque liste applique `club_id = req.clubId`, chaque mutation par
  `:id` échoue par **404** (jamais 403) sur une ressource d'un autre club — un id deviné/copié
  n'apprend jamais "cette ressource existe mais n'est pas à vous".
- **Socket.io** (GPS temps réel, `src/socket/gpsSocket.js`) applique la même isolation en plus du
  JWT : `match:joinAsCoach`/`match:joinAsPlayer` refusent un match/joueur d'un autre club.
- **Comptes de démonstration** : deux clubs réels existent en base pour vérifier l'isolation —
  "CoachBoot FC" (`db/seed.js`, code d'invitation `COACHBOOT-FC-2026`) et "FC Rivière (test)"
  (`db/seed-second-club.js`, code `FC-RIVIERE-TEST-2026`) — voir `test/multi-tenant-isolation.test.js`
  et `test/gps-socket-isolation.test.js` pour la vérification automatisée complète.

### ⚠️ Limites honnêtes — Multi-tenant

- Pas de UI d'administration des clubs (création/désactivation) : géré par SQL/scripts de seed.
- Pas de sélecteur de club à la connexion : un compte appartient à un seul club (email globalement
  unique, inchangé) ; un admin superadmin voit tout sans possibilité de "filtrer sur un club" côté UI.
- Pas de Row-Level-Security PostgreSQL : l'isolation est appliquée au niveau applicatif (chaque
  requête SQL filtre explicitement par `club_id`), pas par une politique RLS en base — une défense
  en profondeur possible mais non construite dans cette passe.

## Joueurs

| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| GET | `/players?q=&team_id=&status=` | Authentifié | Liste + recherche/filtre |
| GET | `/players/me` | Authentifié | Fiche du joueur lié au compte connecté (`players.user_id`), 404 si aucune liaison — utilisé par `player-live.html` |
| GET | `/players/:id` | Authentifié | Fiche détaillée |
| POST | `/players` | head_coach, technical_director, fitness_coach | Créer |
| PUT | `/players/:id` | head_coach, technical_director, fitness_coach | Mettre à jour |
| DELETE | `/players/:id` | head_coach, technical_director | Supprimer |

## Équipes — `/teams` (GET public-auth, POST/PUT technical_director|head_coach, DELETE technical_director)
## Matchs — `/matches` (GET tous, POST/PUT head_coach|technical_director|data_analyst, DELETE technical_director)
## Entraînements — `/trainings` (GET tous, POST/DELETE head_coach|fitness_coach)
## Scouting — `/scouting` (GET tous, POST/PUT technical_director|head_coach, DELETE technical_director)
## Cours — `/courses`, `/courses/:id/progress` (progression personnelle par utilisateur), `/courses/:id/chapters`, `/courses/lessons/:id/complete`, `/courses/exercises/:id/complete` (voir section CoachBoot IA Academy ci-dessous)
## Quiz — `/quizzes`, `/quizzes/:id/attempts` (legacy, score déclaré par le client), `/quizzes/:id/questions`, `/quizzes/:id/submit` (notation réelle côté serveur — voir CoachBoot IA Academy)
## Certificats — `/certificates` (lecture seule, propres à l'utilisateur connecté), `/certificates/course/:courseId` (délivrance conditionnée à 100% de progression)
## Rapports — `/reports?type=`, `/reports/:id/export?format=pdf|excel` (export binaire réel : PDF via pdfkit, Excel via exceljs — plus un stub, voir la section « CoachBoot IA Academy » remplacée par la section export ci-dessous)
## Notifications — `/notifications`, `/notifications/:id/read` (créées automatiquement par de vrais événements métier : blessure enregistrée/résolue, match programmé, profil de scouting ajouté — voir `src/utils/notify.js`)
## Blessures — `/injuries` (GET tous, POST/PUT fitness_coach|head_coach — met aussi à jour le statut du joueur, déclenche une notification)
## GPS — suivi en direct des joueurs

| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| GET | `/gps?player_id=&limit=&offset=` | Authentifié* | Liste des sessions GPS (résumé agrégé) |
| POST | `/gps` | fitness_coach, data_analyst | Créer une session GPS à partir de métriques déjà agrégées |
| POST | `/gps/session` | fitness_coach, data_analyst, head_coach, player | Sauvegarde une session de tracking en direct **complète** : métadonnées + statistiques calculées + trace brute (jusqu'à 20 000 points), en une seule transaction |
| GET | `/gps/session/:id` | Authentifié* | Détail complet d'une session : `{ session, statistics, points }` |
| GET | `/gps/player/:id/stats` | Authentifié* | Agrégats toutes sessions confondues pour un joueur + 10 sessions les plus récentes |

\* Un compte `player` ne peut consulter que les données du joueur auquel il est lié
(`players.user_id`) — 403 sinon, 400 si `GET /gps` est appelé sans `player_id` (pas de fuite
silencieuse de toutes les sessions). Le staff GPS-autorisé n'est pas concerné. Voir
`docs/SECURITY.md`, point 8.

Body de `POST /gps/session` :
```json
{
  "player_id": "uuid",
  "match_id": "uuid ou null",
  "session_date": "2026-08-03",
  "duration_minutes": 87,
  "statistics": {
    "distance_km": 8.7, "high_intensity_km": 1.9, "sprint_distance_km": 0.6,
    "max_speed_kmh": 31.4, "avg_speed_kmh": 7.8,
    "acceleration_count": 38, "deceleration_count": 22,
    "sprint_count": 24, "intense_sprint_count": 9
  },
  "points": [
    { "lat": 48.8566, "lng": 2.3522, "altitude": 35.2, "accuracy": 8, "speed": 18.4, "t": 1735900000000 }
  ]
}
```
Les points sont insérés par lots de 500 côté serveur (`src/routes/gps.routes.js`) pour rester sous
la limite PostgreSQL de paramètres par requête — transparent pour l'appelant.

**Le `statistics` envoyé n'est qu'indicatif** : dès que ≥2 `points` exploitables sont fournis, le
serveur recalcule réellement distance/vitesse/sprints/accélérations à partir de la trace brute
(`src/utils/gpsMetrics.js`, même algorithme que le tracker client) et **ce sont ces valeurs
recalculées qui sont persistées et renvoyées**, jamais celles soumises par le client. La réponse
inclut `stats_source: 'server_recomputed' | 'client_trusted'` (ce dernier uniquement si trop peu de
points sont fournis pour recalculer) — voir `docs/SECURITY.md` pour le détail et les tests.

### Tables associées (`db/schema.sql`)
`gps_sessions` (métadonnées + résumé), `gps_points` (trace brute, un point par relevé GPS),
`gps_statistics` (métriques physiques calculées, une ligne par session).

### ⚠️ Limites GPS honnêtes
- La précision dépend entièrement du GPS du téléphone/tablette de l'utilisateur — erreur moyenne
  observée : **3 à 10 mètres** en extérieur, nettement plus en intérieur ou en zone urbaine dense.
- Nécessite que l'utilisateur autorise explicitement la localisation dans son navigateur/OS.
- Fonctionne nettement mieux en extérieur (ciel dégagé) qu'en intérieur ou à proximité de grands
  bâtiments (réflexions multi-trajets).
- `navigator.geolocation` exige un contexte sécurisé (`https://` ou `http://localhost`) — voir la
  note correspondante dans `../coachboot/docs/README.md`.

## Match Live — caméra + suivi GPS temps réel (`/match-live`)

Module « Match Live Camera + GPS Tracking » — voir `coachboot/match-live.html`. La caméra
(MediaDevices/WebRTC) reste **entièrement côté client** ; ce routeur ne gère que les métadonnées
de session, les relevés GPS multi-joueurs et les événements tagués sur la timeline.

| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| GET | `/match-live?status=` | Authentifié | Liste des sessions Match Live |
| POST | `/match-live` | staff* | Démarre une session (`team_home`, `team_away`, `date?`, `stream_url?`) |
| GET | `/match-live/:id` | Authentifié | Détail d'une session |
| PUT | `/match-live/:id` | staff* | Met à jour `status` (scheduled/live/halftime/finished/cancelled, whitelist validée — 400 sinon) et/ou `stream_url` |
| POST | `/match-live/:id/gps` | staff* | Enregistre un lot de relevés GPS multi-joueurs (jusqu'à 5000 points) |
| GET | `/match-live/:id/gps?player_id=&limit=` | Authentifié | Relevés GPS d'une session (option : un seul joueur) |
| POST | `/match-live/:id/events` | staff* | Tague un événement (`event_type`, `time` en secondes écoulées, `player_id?`) |
| GET | `/match-live/:id/events` | Authentifié | Timeline complète des événements, triée par `time` |

\* staff = `head_coach`, `technical_director`, `fitness_coach`, `video_analyst`, `data_analyst` (ou `admin`).

### Tables associées (`db/schema.sql`)
`matches_live` (métadonnées de session), `gps_live_tracking` (relevés GPS multi-joueurs horodatés),
`live_events` (événements tagués : sprint, tir, passe, interception, récupération...).

### ⚠️ Limites honnêtes — Match Live
- La visualisation 22 joueurs sur le terrain (`assets/js/match-gps-live.js`) reste **simulée**
  pour tout joueur qui n'a pas rejoint la session depuis l'application mobile — un club n'a pas
  forcément 22 téléphones ouverts sur `player-live.html` en même temps. Le mouvement simulé est
  généré par un moteur de marche aléatoire contrainte à la zone de poste, et distance/vitesse/
  sprints sont **réellement calculés** (Haversine sur des coordonnées simulées) plutôt que codés
  en dur — seule la source du mouvement est fictive, pas les formules.
- Les joueurs qui rejoignent réellement via `player-live.html` (voir section Socket.io ci-dessous)
  apparaissent sur le même terrain avec leurs **vraies** coordonnées GPS, en plus de/à la place de
  la simulation — c'est la voie de suivi multi-joueurs réelle du produit.
- **Corrigé** : cette distinction simulation/réel était auparavant faible visuellement (une seule
  classe CSS sur le point du joueur concerné + un suffixe de nom). `match-live.html` affiche
  maintenant un **bandeau permanent, impossible à manquer**, en haut de page :
  🟢 « EN DIRECT » (au moins un joueur réellement tracké), 🟡 « MODE SIMULATION » (tous les
  joueurs affichés sont une démonstration), ⚫ « Hors ligne » (aucun suivi en cours). Recalculé en
  temps réel à chaque changement d'état (démarrage/pause/reprise/arrêt du suivi, activation/échec
  du GPS réel) — testé dans un vrai navigateur, les 3 états confirmés. `matches_live.status`
  (`scheduled/live/halftime/finished/cancelled`, whitelist serveur) reste un concept **distinct** :
  la phase du match, pas la fiabilité des données affichées.
- La caméra utilise `navigator.mediaDevices.getUserMedia()` : fonctionne pour une webcam ou une
  caméra de smartphone. Un flux réseau (caméra IP/WebRTC distant) nécessite un serveur de
  signalisation/media (ex. Janus, mediamtx) **non inclus** dans ce projet ; le champ « URL de
  flux » accepte une URL vidéo directement lisible par `<video>` (MP4/WebM/HLS supporté par le
  navigateur) à titre de repli, pas un véritable pont WebRTC pair-à-pair.
- La détection de joueurs par caméra / tracking automatique / reconnaissance de ballon (OpenCV,
  YOLO, DeepSORT) est **prévue, non implémentée** — voir la section correspondante dans
  `match-live.html` (carte « Roadmap IA »), qui documente l'architecture prête à recevoir ces
  modèles plutôt que d'en simuler les résultats.
- Le module « Analyse IA — performance & tactique » (fatigue, recommandations, comparaison) est
  un ensemble de **règles statistiques simples** (tendance de vitesse, occupation de zone), pas
  un modèle entraîné — voir `computeFatigue`/`computeTactical`/`computeComparison` dans
  `match-live.html` pour la logique exacte.

## Télestration vidéo — `/video/clips`, `/video/annotations`

Module d'annotation manuelle sur vidéo (flèches, cercles, lignes, zones, dessin libre, texte,
markers joueur) pour l'analyse tactique — voir `coachboot/video-analysis.html`. **La vidéo
elle-même n'est jamais reçue ni stockée côté serveur** : un clip référence soit une URL
directement lisible par `<video>` (même contrainte que le repli réseau de Match Live —
MP4/WebM/HLS supporté nativement par le navigateur), soit un fichier choisi localement par
l'utilisateur (`source_type='local'`, `video_url` NULL, jamais envoyé au serveur — juste affecté
à `video.src` via `URL.createObjectURL`). Ce qui est réellement persisté et partagé entre
utilisateurs, c'est **l'annotation** (forme, couleur, position, fenêtre temporelle).

| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| GET | `/video/clips?match_id=` | Authentifié | Liste des clips |
| POST | `/video/clips` | staff vidéo* | Crée un clip (`title`, `video_url?`, `source_type?`, `match_id?`, `player_id?`, `recorded_at_start?`) |
| PUT | `/video/clips/:id` | staff vidéo* | Modifie un clip (ex. poser l'ancrage horaire réel après coup) |
| DELETE | `/video/clips/:id` | staff vidéo* | Supprime un clip (cascade sur ses annotations) |
| GET | `/video/clips/:clipId/annotations` | Authentifié | Annotations d'un clip, triées par timestamp |
| POST | `/video/clips/:clipId/annotations` | staff vidéo* | Crée une annotation (`type`, `data`, `timestamp_start_sec`, `timestamp_end_sec?`, `player_id?`) |
| PUT | `/video/annotations/:id` | staff vidéo* | Modifie une annotation (position, style, fenêtre temporelle, joueur associé) |
| DELETE | `/video/annotations/:id` | staff vidéo* | Supprime une annotation |
| GET | `/video/annotations/:id/gps`† | Authentifié | Corrèle l'annotation à une vraie position GPS (voir section dédiée ci-dessous) |

\* staff vidéo = `video_analyst`, `head_coach`, `technical_director`, `data_analyst`, `fitness_coach`
(ou `admin`) — `fitness_coach` ajouté pour la corrélation GPS (propriétaire naturel de ces données).
Lecture (`GET`) ouverte à tout utilisateur authentifié — c'est le mécanisme de partage : toute
annotation sauvegardée est visible par quiconque ouvre le même clip. † IDOR-gardé : un compte
`player` ne peut interroger que la corrélation GPS d'une annotation liée à son propre joueur.

**Types d'annotation** (`type`) : `arrow`, `circle`, `line`, `rectangle`, `freehand`, `text`,
`player_marker`. `data` (JSONB) est flexible par type — coordonnées **normalisées** `[0,1]`
(fraction de la largeur/hauteur vidéo, pas des pixels), pour rester correctes quel que soit le
redimensionnement du canvas côté client.

**Animation réelle (pas de tracking automatique)** : une annotation `arrow` peut porter
`data.animateTo = { from, to }` en plus de `data.from`/`data.to`, avec `timestamp_end_sec` défini.
Le client interpole linéairement la position entre `timestamp_start_sec` et `timestamp_end_sec` à
chaque frame — un vrai calcul, rejoué à chaque lecture, pas une vidéo pré-rendue. L'utilisateur
pose les deux positions à la main (départ + arrivée) ; ce n'est **pas** du tracking automatique de
joueur/ballon (qui resterait `BLOCKED_EXTERNAL`, voir plus bas).

### Corrélation GPS — `GET /video/annotations/:id/gps`

Relie une annotation à une **vraie** position GPS, en réutilisant les tables GPS déjà existantes
(`gps_points`/`gps_sessions` pour les séances post-match, `gps_live_tracking` pour Match Live) —
**aucune nouvelle table GPS n'a été créée**, pour ne pas dupliquer ce qui existe déjà.

Le problème à résoudre : `video_annotations.timestamp_start_sec` est une position dans la lecture
vidéo (secondes depuis 0:00), alors que les données GPS sont horodatées en temps réel absolu.
Le pont entre les deux est `video_clips.recorded_at_start` (`TIMESTAMPTZ`, optionnel) — l'heure
réelle à laquelle l'enregistrement a commencé, posée **manuellement par l'analyste**, jamais
déduite. Horaire cible = `recorded_at_start + timestamp_start_sec`.

Quand l'annotation a un `player_id` et son clip un `recorded_at_start`, l'endpoint interroge les
deux sources GPS pour ce joueur, retient le point réel le plus proche en temps (tolérance 120s),
et répond honnêtement :
- `{ found: true, latitude, longitude, speed_kmh, source: 'gps_points'|'gps_live_tracking', delta_seconds }`
- `{ found: false, reason: 'no_time_anchor' }` — annotation sans joueur, ou clip sans ancrage
- `{ found: false, reason: 'no_nearby_gps_data' }` — rien dans la fenêtre de tolérance

**Jamais de position fabriquée** : si rien n'est trouvé, la réponse le dit explicitement plutôt que
d'inventer un point plausible.

### ⚠️ Limites honnêtes — Télestration vidéo
- **Pas de tracking automatique joueur/ballon** (vision par ordinateur). C'est un sujet
  entièrement différent, déjà documenté `BLOCKED_EXTERNAL` (voir `docs/FINAL_PRODUCTION_AUDIT.md`,
  section Video Analysis) — ce module de télestration manuelle (y compris la corrélation GPS
  ci-dessus) ne le débloque pas et ne prétend pas le faire : la corrélation trouve un point GPS
  réel déjà enregistré par ailleurs, elle ne détecte jamais un joueur dans l'image.
- **Pas de co-édition temps réel** (curseurs live façon document collaboratif). Le partage est
  réel mais asynchrone : sauvegarder puis recharger, pas de synchronisation Socket.io entre
  utilisateurs simultanément sur le même clip dans cette version.
- **Pas d'export vidéo avec incrustation des dessins** (nécessiterait un traitement vidéo serveur,
  type ffmpeg — hors périmètre). Seul un export JSON des annotations est fourni (bouton dédié,
  téléchargement direct côté client).
- **Fichier vidéo local jamais persisté** : un clip `source_type='local'` doit être re-sélectionné
  manuellement à chaque visite (le fichier lui-même n'est ni uploadé ni stocké) — seules ses
  annotations survivent, à charge pour l'utilisateur de recharger le bon fichier local pour les
  revoir en contexte.
- **Animation limitée aux flèches** dans cette version (`type='arrow'` avec `data.animateTo`) — les
  autres types (cercle, rectangle, texte, marker joueur, dessin libre) sont statiques ou
  disparaissent après `timestamp_end_sec` s'il est défini, mais ne s'interpolent pas entre deux
  positions.
- **Corrélation GPS = un point, pas une piste.** Pas de mini-carte/heatmap/trail dans
  `video-analysis.html` (le résultat est affiché en texte + lien Google Maps) — `match-live.html`
  a déjà une vraie pitch SVG + heatmap ; les dupliquer ici serait un chantier à part entière, laissé
  pour une passe future.
- **Sans ancrage horaire, aucune corrélation n'est possible** — c'est un choix délibéré (ne jamais
  deviner l'heure de tournage) plutôt qu'une limite technique contournable.

## GPS temps réel — Socket.io (joueurs ↔ coachs)

Canal temps réel séparé de l'API REST, pour la diffusion GPS multi-joueurs en direct pendant une
session Match Live. Implémenté dans `src/socket/gpsSocket.js`, monté sur le même serveur HTTP
qu'Express (`http.createServer(app)` — pas de port séparé). Utilisé par `player-live.html` (le
joueur pousse sa position) et `match-live.html` (le coach observe en direct) via
`assets/js/gps-socket-client.js`.

**Authentification** : identique à l'API REST — le même jeton JWT est passé dans la poignée de
main (`io(url, { auth: { token } })`). Une connexion sans jeton valide est immédiatement rejetée
(`connect_error`), avant même de pouvoir rejoindre une room.

**Rooms** : une room Socket.io par session (`match:<matchId>`). Un joueur qui rejoint pousse ses
positions ; un coach qui rejoint ne fait qu'écouter les diffusions de tous les joueurs de la room.

**Autorisation sur `match:joinAsPlayer`** (`canReportGpsFor`) : un compte `player` ne peut rejoindre
que comme LUI-MÊME (vérifié via `players.user_id = socket.user.id`, pas seulement `role === 'player'`
— sans quoi n'importe quel joueur authentifié aurait pu reporter des positions au nom d'un
coéquipier). Le staff (`fitness_coach`, `data_analyst`, `head_coach`, `admin`) peut reporter pour
n'importe quel joueur (traceur porté par un membre du staff, test matériel) — mêmes rôles que
`POST /gps/session`. Testé avec un vrai client `socket.io-client` : un joueur qui tente de rejoindre
sous l'identité d'un autre joueur reçoit `gps:error`, jamais `match:joined`.

| Événement (client → serveur) | Payload | Description |
|---|---|---|
| `match:joinAsPlayer` | `{ matchId, playerId }` | Rejoint la room en tant que joueur, habilite `gps:update` |
| `match:joinAsCoach` | `{ matchId }` | Rejoint la room en observateur (aucune émission possible) |
| `gps:update` | `{ latitude, longitude, speed?, distance?, acceleration?, sprintCount?, durationSec?, timestamp? }` | Un relevé GPS ; validé, persisté dans `gps_live_tracking`, puis diffusé |

| Événement (serveur → client) | Payload | Description |
|---|---|---|
| `match:joined` | `{ matchId, as }` | Confirmation d'entrée dans la room |
| `gps:broadcast` | point GPS complet (+ `playerId`, `matchId`) | Diffusé à toute la room à chaque `gps:update` valide |
| `player:joined` / `player:left` | `{ playerId, at }` | Signalé aux autres membres de la room |
| `gps:error` | `{ message, code? }` | Payload rejeté (bornes invalides) ou action non autorisée |

**Validation serveur** (avant persistance et diffusion, voir `validateGpsPayload`) : latitude
∈ [-90, 90], longitude ∈ [-180, 180], vitesse ∈ [0, 130] km/h, accélération ∈ [-15, 15] m/s²,
distance ≥ 0. Un payload invalide déclenche `gps:error` côté joueur et n'est ni enregistré ni
diffusé — le coach ne voit jamais de données aberrantes.

**Anti-abus** : un relevé par joueur au plus toutes les 400ms (`UPDATE_MIN_INTERVAL_MS`) —
au-delà, les relevés excédentaires sont silencieusement ignorés (pas une erreur), pour absorber
une boucle client trop rapide sans pénaliser l'appelant.

**Dégradation gracieuse** : si l'écriture en base échoue (DB indisponible), le point est quand
même diffusé en direct aux coachs — le suivi visuel ne doit pas s'interrompre pour un souci de
persistance ; seul l'historique sera incomplet pour cette fenêtre.

## CoachBoot IA — entraînement de modèles (`/ml`)

Pipeline **réel** (pas simulé) : Python + pandas + numpy + scikit-learn, orchestré depuis Node.js.
Interface : `coachboot/train-ai.html`. Code : `coachboot-backend/ml/` (`train.py`, `predict.py`,
`requirements.txt`) + `src/routes/ml.routes.js`.

### Architecture : pourquoi des scripts Python à la demande, pas un microservice

Node.js n'a pas d'écosystème Machine Learning comparable à scikit-learn. Deux options existaient :
un microservice Python permanent (FastAPI) appelé en HTTP, ou des scripts Python lancés à la
demande via `child_process`. **Choix retenu : scripts à la demande** — l'entraînement/la prédiction
sont des opérations ponctuelles (« un clic → un résultat »), pas un flux continu ; un process de
plus à démarrer/surveiller/redémarrer n'aurait rien apporté pour ce cas d'usage. Le modèle entraîné
est sauvegardé sur disque (`ml/models/<id>/model.joblib` — poids + scaler + métadonnées) et
rechargé à chaque prédiction.

`PYTHON_BIN` (voir `.env.example`) contrôle le binaire utilisé : vide par défaut → lanceur Windows
`py -3.12` (épinglé sur une version stable, voir la note sur Python 3.15 ci-dessous) ; sur
Linux/macOS, définir explicitement `PYTHON_BIN=python3`.

### Pipeline réel exécuté par `ml/train.py`
```
CSV → nettoyage (coercition numérique, lignes incomplètes/dupliquées écartées)
    → feature engineering (stats de comptage normalisées « par 90 minutes »
      quand la colonne minutes_jouees est présente — pratique standard en
      analyse de performance football)
    → split train/validation/test (70/15/15, stratifié en classification)
    → normalisation (StandardScaler calé UNIQUEMENT sur le train set)
    → RandomForest (scikit-learn, 300 arbres)
    → évaluation sur le TEST set (jamais vu pendant l'entraînement)
    → modèle sauvegardé (joblib)
```

### Routes

| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| POST | `/ml/train` | technical_director, data_analyst, head_coach | multipart : `csv` (fichier), `name`, `task` (regression\|classification), `target`, `features` (JSON d'un tableau de colonnes), `dataset_type` (**requis** : `real`\|`synthetic`\|`unknown`) |
| GET | `/ml/models` | Authentifié | Historique des modèles entraînés (métriques, statut, `dataset_type`) |
| POST | `/ml/models/:id/deploy` | technical_director, data_analyst, head_coach | Déploie ce modèle (archive l'ancien modèle déployé pour la même cible) |
| DELETE | `/ml/models/:id` | technical_director, data_analyst, head_coach | Supprime le modèle (ligne DB + fichier sur disque) |
| POST | `/ml/predict` | Authentifié | `{ model_id, input: { feature: valeur, ... } }` → prédiction **+ provenance** (voir ci-dessous) |

### Table associée (`db/schema.sql`)
`ml_models` (nom, tâche, cible, features, métriques, importances, statut `trained`/`deployed`/`archived`,
`dataset_type`). Un seul modèle `deployed` à la fois par couple (tâche, cible) — géré par transaction
dans `POST /ml/models/:id/deploy`.

### Métriques calculées (réellement, sur le test set)
- **Régression** : RMSE, MAE, R².
- **Classification** : Accuracy, F1 pondéré, matrice de confusion.
- **Prédiction** : en régression, une incertitude est dérivée de la dispersion des prédictions
  individuelles des arbres de la forêt (écart-type) — pas une valeur inventée.

### Provenance systématique de chaque prédiction (jamais un chiffre nu)
`POST /ml/predict` renvoie, en plus de `prediction` : `model_version` (l'identifiant exact du
modèle utilisé — chaque entraînement produit un artefact distinct, pas un numéro incrémenté),
`data_source` (`real`/`synthetic`/`unknown`, **déclaré obligatoirement par l'utilisateur à
l'entraînement**, jamais déduit automatiquement), `model_trained_at` et `predicted_at` (horodatages
réels). `train-ai.html` affiche ces 4 informations sous chaque résultat de prédiction, et une
colonne « Données » dans l'historique des modèles. Testé réellement de bout en bout : entraînement
sans `dataset_type` → 400 ; avec `dataset_type=synthetic` → modèle créé, puis une prédiction sur ce
modèle renvoie bien `data_source: "synthetic"` et les 4 champs de provenance.

### ⚠️ Limites honnêtes — CoachBoot IA
- **Aucune donnée réelle de match n'est utilisée par défaut.** L'utilisateur doit fournir son
  propre CSV (voir `coachboot/assets/sample-data/coachboot-sample-dataset.csv`, un jeu de données
  **synthétique** généré pour tester le pipeline — clairement étiqueté comme tel dans l'UI, à ne
  jamais confondre avec de vraies statistiques de joueurs). CoachBoot n'enregistre pas encore les
  événements de match (passes, tirs, duels...) dans sa propre base — seul le GPS (`gps_sessions`,
  `gps_live_tracking`) est actuellement collecté automatiquement par l'application.
  Voir la recommandation de l'auteur du besoin : commencer à enregistrer de vraies données
  joueur/match, définir des labels/cibles pertinents, avant de considérer un modèle comme fiable
  pour de vraies décisions d'encadrement.
- **RandomForest uniquement pour l'instant** — pas de réseau de neurones (PyTorch), pas de GPU,
  pas de tuning d'hyperparamètres automatisé. Le split de validation existe et est mesuré, mais
  n'est pas encore utilisé pour de la sélection de modèle automatique (prévu si une phase PyTorch
  est engagée plus tard, comme évoqué dans la demande initiale).
- **Cohérence train/predict** : `ml/predict.py` réimporte directement `COUNT_LIKE_STATS` depuis
  `ml/train.py` (`from train import COUNT_LIKE_STATS`) pour reconstruire les features dérivées
  (« _par_90 ») exactement comme à l'entraînement — évite qu'une divergence entre les deux scripts
  ne fausse silencieusement les prédictions.
- **Python 3.15 (bêta) posait problème** : au moment du développement, `numpy` n'avait pas de
  wheel compatible avec cette version et la compilation depuis les sources échouait (pas de
  compilateur C sur la machine). Le pipeline cible donc explicitement **Python 3.12** (stable).
- **Latence perceptible** : chaque entraînement/prédiction relance un interpréteur Python à froid
  (import pandas/numpy/scikit-learn) — quelques secondes, pas instantané. L'UI affiche un état de
  chargement pendant ce temps plutôt que de paraître figée.
- **Fichier CSV limité à 10 Mo**, et à `.csv` uniquement (voir `multer` dans `ml.routes.js`).

## CoachBoot IA Academy — `/courses/:id/chapters`, `/quizzes/:id/submit`, `/certificates/course/:id`

Plateforme e-learning **🎓 CoachBoot IA — Football Intelligence Academy** : 6 modules + un projet
final, contenu pédagogique réel stocké en base (pas un texte statique dans le HTML). Interface :
`coachboot/academy.html` (catalogue) + `coachboot/course-viewer.html` (chapitre/leçon/quiz/TP/certificat).
Contenu : `coachboot-backend/db/seed-academy.js`.

### Architecture : extension des tables existantes, pas un second système de cours

Consigne explicite suivie : **réutiliser `courses`/`quizzes`/`certificates`, ne pas créer un
système de formation parallèle**. Chaque module de l'Academy **EST** une ligne `courses` (avec
`module_number` 1 à 7, 7 = projet final) ; chaque quiz de chapitre **EST** une ligne `quizzes`
(avec `chapter_id` renseigné, contrairement aux quiz autonomes de `quizzes.html` où il est `NULL`).
Trois tables sont ajoutées pour la hiérarchie propre à l'Academy : `course_chapters` →
`course_lessons` (relation 1:1 dans le contenu actuel, un chapitre = une leçon) → `quiz_questions`
(questions réellement stockées et notées, alors qu'avant l'Academy `quizzes` n'avait qu'un
`question_count` déclaratif). `lesson_completions` et `exercise_completions` suivent la progression
individuelle ; `course_progress.progress_pct` (table déjà existante) est recalculé automatiquement
à chaque complétion via `src/utils/academyProgress.js`.

### Pipeline de progression et de notation
```
Leçon lue (POST /courses/lessons/:id/complete)
  + TP final réalisé (POST /courses/exercises/:id/complete)
    → recomputeCourseProgress() recalcule course_progress.progress_pct
      = (leçons + TP complétés) / (nb chapitres + nb TP du module) × 100
        → à 100%, POST /certificates/course/:id délivre le certificat (refusé sinon, 400)

Quiz : GET /quizzes/:id/questions (sans correct_answer/explanation)
  → réponses saisies par l'apprenant
    → POST /quizzes/:id/submit compare aux quiz_questions.correct_answer EN BASE
      → score_pct calculé serveur (jamais déclaré par le client), tentative + réponses
        stockées dans quiz_attempts.answers (JSONB), explication renvoyée après coup
```

### Routes ajoutées

| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| GET | `/courses/:id/chapters` | Authentifié | Chapitres + leçons (contenu complet) + quiz (sans réponses) + TP final d'un module, avec statut de complétion de l'utilisateur |
| POST | `/courses/lessons/:lessonId/complete` | Authentifié | Marque une leçon comme lue, recalcule la progression du module |
| POST | `/courses/exercises/:exerciseId/complete` | Authentifié | Marque un TP comme réalisé (`{ notes }` libres, auto-évaluation), recalcule la progression |
| GET | `/quizzes/:id/questions` | Authentifié | Questions d'un quiz de chapitre, sans `correct_answer` ni `explanation` |
| POST | `/quizzes/:id/submit` | Authentifié | `{ answers: { questionId: réponse } }` → notation serveur réelle, réponses stockées |
| POST | `/certificates/course/:courseId` | Authentifié | Délivre le certificat si `course_progress.progress_pct = 100` (400 sinon) ; idempotent (renvoie le certificat existant si déjà délivré) |

### Tables associées (`db/schema.sql`)
`course_chapters`, `course_lessons`, `quiz_questions`, `course_exercises`, `lesson_completions`,
`exercise_completions` (nouvelles) ; `courses.description`/`objective`/`module_number`,
`quizzes.chapter_id`, `quiz_attempts.answers`, `certificates.course_id` (colonnes ajoutées aux
tables existantes via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, migration idempotente rejouable).

### AI Course Generator — `/academy/generate`, `/academy/courses` (Gemini)

Un `technical_director` (ou `admin`) peut demander à Gemini de générer un cours complet
(chapitres → leçon → quiz noté → TP final) plutôt que de l'écrire à la main. **Aucun second
système de formation** : un cours généré par IA s'insère dans exactement les mêmes tables que
ci-dessus (`courses`/`course_chapters`/`course_lessons`/`quizzes`/`quiz_questions`/
`course_exercises`) et suit ensuite le même pipeline de progression/notation/certification —
sans aucune modification de ce pipeline.

| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| POST | `/academy/generate` | `technical_director`/`admin` | `{ title, subject, level, chapterCount, durationLabel?, language?, targetAudience?, objectives?, questionsPerQuiz? }` → appelle Gemini, renvoie un **aperçu** (`{ preview, level, language }`). **N'écrit rien en base.** |
| POST | `/academy/courses` | `technical_director`/`admin` | `{ generated: <aperçu ci-dessus>, level, language }` → revalide la structure côté serveur (ne fait jamais confiance à un JSON client sans revérification) puis l'enregistre en une seule transaction (`BEGIN`/`COMMIT`/`ROLLBACK`). `module_number` = suivant disponible. |

**Génération structurée + validation + réparation** (`src/services/geminiCourseGenerator.js`) :
Gemini est appelé avec `generationConfig.responseSchema` (sortie JSON stricte, pas un chat texte
libre) puis la structure est revalidée manuellement (types de question limités à `qcm`/`vrai_faux`,
`correct_answer` doit correspondre à une clé de `choices`, tableaux non vides). Si invalide, **une
seule** tentative de réparation (les erreurs exactes sont renvoyées à Gemini avec une demande de
correction) ; si toujours invalide, erreur claire — **jamais d'insertion partielle**.

### ⚠️ Limites honnêtes — CoachBoot IA Academy
- **TP notés par auto-évaluation, pas par une IA.** `POST /courses/exercises/:id/complete`
  enregistre les notes libres de l'apprenant sans les corriger automatiquement — corriger une
  analyse de données ouverte nécessiterait un vrai jugement humain ; simuler une correction IA
  aurait été présenté comme plus capable que ce que le système fait réellement. **Ceci s'applique
  aussi aux TP générés par IA** : l'AI Course Generator ne grade jamais le projet final, par
  cohérence avec cette décision déjà prise avant son ajout.
- **Certaines leçons décrivent des fonctionnalités pas encore implémentées** (ex. Module 3 —
  « joueurs similaires » par KNN/clustering ; Module 6 — détection automatique de transitions et de
  formations). Ces leçons sont explicitement marquées « Fonctionnalité prévue / à venir » dans leur
  contenu (`coachboot_demo`) plutôt que de simuler une démonstration qui n'existe pas.
- **`GET /courses` reste public à tous les rôles authentifiés** — comme avant l'Academy, aucun
  contrôle de rôle supplémentaire n'a été ajouté pour restreindre l'accès aux modules (cohérent
  avec le reste de la formation continue de CoachBoot, ouverte à tout le staff).
- **La progression est structurelle, pas pédagogique** : `progress_pct` mesure les éléments
  marqués comme lus/réalisés, pas la compréhension réelle du contenu — le quiz noté est le seul
  signal de compréhension effective, et il ne bloque pas la progression (volontairement, pour ne
  pas pénaliser un apprenant qui revoit un chapitre).
- **AI Course Generator — périmètre volontairement limité** (voir le cahier des charges complet
  fourni par l'utilisateur pour la liste exhaustive de ce qui a été écarté, et pourquoi) :
  - Pas de nouvelles tables `Course`/`Module`/`Lesson`/`Quiz`/`Enrollment`/`Certificate` — réutilise
    entièrement le schéma Academy existant (une ligne `courses` reste un « Module »).
  - Pas de rôle « Academy Manager » — réutilise `technical_director`/`admin`.
  - Pas d'AI Tutor par leçon, pas d'AI grading du TP final (voir point ci-dessus), pas de QR code
    de vérification sur les certificats, pas de dashboard admin multi-écrans (Courses/Modules/
    Lessons/Quizzes/Students/Progress/Certificates/AI History) — le parcours livré est
    **Générer → Prévisualiser → Enregistrer**, qui couvre le chemin de bout en bout critique.
  - Pas de statut brouillon/publié séparé : enregistrer = immédiatement visible dans `GET /courses`.
  - Types de question générés limités à `qcm`/`vrai_faux` (objectivement notables) — pas de
    questions ouvertes générées par IA.
  - « Régénérer » relance simplement `/academy/generate` avec les mêmes paramètres avant
    d'enregistrer ; l'édition fine de chaque question/leçon générée n'est pas construite (seuls les
    paramètres de génération sont modifiables avant de régénérer).
  - Les leçons/TP générés ne créent pas de vérification automatique qu'un exercice pratique
    (« analyse ce match avec Match Live ») a réellement été effectué — reste une auto-évaluation.
  - Un vrai appel Gemini prend généralement 20 à 90 secondes pour un cours complet (sortie JSON
    structurée volumineuse) — le formulaire de génération affiche un indicateur de chargement
    plutôt que de faire croire à une réponse instantanée.

## Assistant IA — `POST /assistant/chat` (chat contextualisé, deux fournisseurs possibles)

- Body : `{ messages: [{ role: 'user'|'assistant', content: string }, ...] }` (20 derniers messages
  conservés, tout le reste filtré côté serveur).
- Le system prompt injecte un instantané réel du club (effectif disponible, blessures actives,
  prochain match) tiré de PostgreSQL — **identique quel que soit le fournisseur**, pour que Claude
  et Gemini répondent à partir des mêmes données, jamais d'un contexte divergent.
- **Fournisseur actif** : variable d'environnement `AI_PROVIDER` (`anthropic` par défaut, ou
  `gemini`). Choix explicite uniquement — **aucun repli automatique** d'un fournisseur vers l'autre
  si la clé du fournisseur choisi est absente : la route échoue proprement en `503` plutôt que de
  simuler une réponse ou de basculer silencieusement.
  - `AI_PROVIDER=anthropic` → nécessite `ANTHROPIC_API_KEY`, modèle `claude-opus-5`
    (`@anthropic-ai/sdk`).
  - `AI_PROVIDER=gemini` → nécessite `GEMINI_API_KEY`, modèle configurable via `GEMINI_MODEL`
    (défaut `gemini-2.5-flash`, `@google/generative-ai`). Clé obtenue sur
    [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
- Réponse : `{ reply: string, provider: 'anthropic'|'gemini' }`.

### ⚠️ Limites honnêtes — Assistant IA
- **Un seul fournisseur actif à la fois**, pas de bascule automatique en cas de panne de l'un —
  changer `AI_PROVIDER` nécessite un redémarrage du serveur (variable lue au démarrage du process).
- **Mise à jour du 2026-08-26 : le chemin Gemini est maintenant vérifié avec un vrai appel API**,
  une clé Gemini réelle ayant été fournie (`GEMINI_API_KEY`, obtenue sur
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Testé réellement en local ET
  sur le déploiement Render de production : `POST /assistant/chat` renvoie une vraie réponse
  générée par Gemini, ancrée dans les données réelles du club (ex. effectif disponible, prochain
  match), avec `provider:"gemini"` dans la réponse. `AI_PROVIDER=gemini` est la configuration
  active par défaut de ce projet depuis cette mise à jour.
- **Note modèle** : `gemini-2.5-flash` et `gemini-2.0-flash` sont dépréciés côté Google (confirmé
  par l'API elle-même via une erreur 404 explicite au moment de la vérification) ; le modèle par
  défaut de ce projet est désormais `gemini-3.6-flash` (configurable via `GEMINI_MODEL`). Les noms
  de modèles Google évoluent vite — si l'assistant renvoie une 404 côté Gemini à l'avenir, vérifier
  le nom de modèle courant plutôt que de supposer un bug applicatif.
- **Format de clé** : les clés Gemini générées via aistudio.google.com peuvent avoir un préfixe
  `AQ.` plutôt que l'ancien format `AIzaSy...` — les deux formats ont été vus fonctionner ; ne pas
  rejeter une clé sur la seule base de son préfixe, vérifier par un appel réel.
- Le chemin **Anthropic** reste inchangé et n'a toujours pas été testé avec un vrai appel (aucune
  `ANTHROPIC_API_KEY` réelle fournie dans ce projet à ce jour) — son comportement vérifié se limite
  à l'échec propre en `503` sans clé.

## Tableau de bord — `/dashboard/summary` (agrégats calculés en temps réel depuis PostgreSQL)

### Détail de `GET /dashboard/summary`
```json
{
  "matches_played": 4,
  "players_available": 6,
  "players_total": 8,
  "xg_total": 7.5,
  "points": 8,
  "next_match": { "...": "prochain match à venir, ou null" },
  "recent_matches": [ "5 derniers matchs" ]
}
```
`points` est calculé **réellement** à partir des scores enregistrés pour "CoachBoot FC"
(3 pts victoire, 1 nul, 0 défaite) — ce n'est pas une valeur inventée.

## Export PDF/Excel — `GET /reports/:id/export?format=pdf|excel`

Génère un vrai fichier binaire à partir des champs réels du rapport en base (titre, type, date,
auteur) : `pdfkit` pour le PDF, `exceljs` pour le classeur Excel — plus un stub JSON. Vérifié en
testant la signature binaire de la réponse (`%PDF-` pour le PDF, `PK` pour le `.xlsx`, qui est un
ZIP), pas seulement le code HTTP — voir `test/business.test.js`.

Le contenu de l'export se limite volontairement à ce que la table `reports` sait réellement
(titre/type/date/auteur) — pas de statistiques de match/joueur injectées artificiellement, la
table `reports` n'ayant aucune liaison (FK) vers `matches`/`players` aujourd'hui.

## Comptes de démonstration (après `npm run db:seed`)

Mot de passe pour tous : `CoachBoot2026!`

| E-mail | Rôle |
|---|---|
| carmie.boot@coachboot.app | head_coach |
| president@coachboot.app | president |
| directeur.technique@coachboot.app | technical_director |
| prepa.physique@coachboot.app | fitness_coach |
| gardiens@coachboot.app | goalkeeper_coach |
| video@coachboot.app | video_analyst |
| data@coachboot.app | data_analyst |
| joueur@coachboot.app | player |
| parent@coachboot.app | parent |
| federation@coachboot.app | federation |
| admin@coachboot.app | admin |

## Tests effectués (pas seulement écrits — réellement exécutés)

PostgreSQL 16 a été installé et démarré dans l'environnement de développement pour valider,
via `curl` et des scripts Playwright automatisés, que :
- le schéma s'applique sans erreur (`db/schema.sql`) et le seed s'exécute proprement (`db/seed.js`) ;
- login avec bon/mauvais mot de passe renvoie respectivement 200/401 ;
- les routes protégées renvoient 401 sans jeton ;
- le contrôle de rôle renvoie 403 pour une action non autorisée (ex. un joueur ne peut pas créer une équipe) ;
- la validation des entrées renvoie 400 avec des messages clairs (e-mail invalide, mot de passe trop court…) ;
- un e-mail déjà utilisé renvoie 409 ;
- la création de joueur, l'inscription, et `/dashboard/summary` renvoient des données cohérentes ;
- **le frontend statique (fichiers `.html` ouverts directement, sans serveur) consomme réellement
  cette API** : connexion via le vrai formulaire, tableau de bord affichant des KPI en direct
  (avec un badge "Données en direct"), page Joueurs chargée depuis PostgreSQL, et **repli automatique
  et silencieux vers les données de démonstration si le backend est éteint** (testé explicitement,
  0 erreur JavaScript dans les deux cas, sur les 56 pages).

### CoachBoot IA Academy — tests réellement exécutés (curl + Playwright, base PostgreSQL réelle)

- `node db/seed-academy.js` exécuté contre la base réelle : 7 modules, 34 chapitres, 34 leçons,
  34 quiz, 40 questions, 7 TP créés — vérifié par requêtes `SELECT count(*)` directes, pas seulement
  par le message de succès du script.
- Parcours complet via `curl` authentifié (JWT réel) : `GET /courses/:id/chapters` renvoie la bonne
  structure ; `GET /quizzes/:id/questions` ne renvoie **jamais** `correct_answer`/`explanation` ;
  `POST /quizzes/:id/submit` avec une réponse juste + une fausse renvoie `score_pct: 50` et les
  réponses sont vérifiées stockées dans `quiz_attempts.answers` (`SELECT` direct) ; progression
  recalculée à chaque complétion (17% → 33% → … → 100%, vérifié après chaque appel) ;
  `POST /certificates/course/:id` renvoie **400** avant 100% et **201** (puis 200, idempotent) après.
- Parcours complet rejoué **dans un vrai navigateur** (Playwright/Chromium, pas seulement `curl`) :
  connexion via le formulaire réel de `login.html`, catalogue `academy.html` affichant les 7 modules
  en direct, ouverture d'un module, leçon marquée lue, quiz répondu et noté à l'écran (surlignage
  correct/incorrect + explication affichée), TP final rempli et validé, certificat obtenu et
  visible immédiatement sur `certificates.html` — **0 erreur JavaScript** sur l'ensemble du parcours.
- Sweep de régression sur les 61 pages du frontend (dont les 2 nouvelles) après modification de
  fichiers partagés (`components.js`, `api.js`) : aucune erreur JavaScript non gérée (`pageerror`)
  introduite ; les seuls messages console relevés sont des `401` attendus et déjà gérés par un
  repli sur les données de démonstration (comportement identique à 6 pages préexistantes).
- Un bug de routage a été détecté et corrigé pendant ces tests : le serveur statique de
  développement (`serve`, URLs "propres") redirige `page.html?query=...` vers `/page` en perdant
  la query string — `course-viewer.html` utilise donc un fragment d'URL (`#course=...`), jamais
  transmis au serveur et donc insensible à ce type de redirection côté serveur.
- Toutes les données créées pendant ces tests (complétions, tentatives de quiz, certificat de test)
  ont été supprimées après vérification, et `course_progress` du module 1 restauré à sa valeur de
  démonstration seedée (40%).
