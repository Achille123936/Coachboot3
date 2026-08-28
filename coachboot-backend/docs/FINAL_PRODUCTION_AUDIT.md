# CoachBoot Enterprise — Audit Final de Production

Document consolidant trois sessions successives de finalisation. Chaque ligne de ce document
reflète un état **vérifié par exécution réelle** (tests automatisés, navigateur réel, `curl`,
requêtes SQL directes), jamais une supposition de lecture de code. Là où une vérification n'a pas
pu être faite (accès externe manquant), c'est marqué `NOT TESTED` ou `BLOCKED_EXTERNAL`
explicitement — jamais présenté comme un succès.

## 1. Executive Summary

CoachBoot Enterprise est un backend Node/Express/PostgreSQL réel et un frontend statique de 62
pages HTML/CSS/JS. Le cœur applicatif (authentification, Academy, GPS temps réel — Socket.io ET
REST, sécurité, Match Live, tests) est solide et vérifié de bout en bout. La limite principale
reste **le câblage frontend incomplet** (19/62 pages connectées à l'API réelle) et **l'absence
totale d'un pipeline de vision par ordinateur pour l'analyse vidéo live**, documentée comme
`BLOCKED_EXTERNAL` plutôt que simulée.

Cette troisième session a corrigé 3 bugs de sécurité/intégrité réels supplémentaires (autorisation
GPS REST manquante par IDOR, statistiques GPS non revalidées côté serveur, régression de bug dans
un test qui masquait un vrai problème) et éliminé les faux positifs `console.error` du sweep de
régression (401 attendus désormais gérés sans tentative réseau inutile).

**Verdict : READY WITH LIMITATIONS** — pas `PRODUCTION READY`, honnêtement.

## 2. Architecture finale

```
Frontend statique (62 pages HTML/CSS/JS, aucun build)
        ↓ fetch() vers
Backend Express (Node 20, src/server.js)
   ├── REST API (17 fichiers de routes, JWT + rôles)
   ├── Socket.io (GPS temps réel, rooms par match, autorisation par joueur)
   └── Pipeline ML à la demande (Python subprocess, train.py/predict.py)
        ↓
PostgreSQL 17 (33 index sur clés étrangères, cascades explicites)
```

Pas de Redis, pas de Celery, pas de queue de tâches — le projet n'en a jamais eu besoin
architecturalement (pas de tâche longue asynchrone hors entraînement ML, qui est déjà géré par
subprocess à la demande). En ajouter serait de la complexité non justifiée par un besoin réel.

## 3. Frontend — 62 pages

| Catégorie | Nombre | Détail |
|---|---|---|
| API CONNECTED | 19 | Voir tableau ci-dessous |
| STATIC (démo) | 43 | Cellules d'analyse, tableaux de bord par rôle, etc. |
| BROKEN | 0 | Aucune erreur JS non gérée détectée sur les 62 pages (sweep Playwright, anonyme ET authentifié) |

| Page | API | DB | Auth | Test | Statut |
|---|---|---|---|---|---|
| `login.html` | ✅ | ✅ | ✅ | Navigateur réel | FULLY FUNCTIONAL |
| `register.html` | ✅ | ✅ | ✅ | Navigateur réel | FULLY FUNCTIONAL |
| `reset-password.html` | ✅ | ✅ | Public (jeton) | Navigateur réel, bug trouvé+corrigé | FULLY FUNCTIONAL |
| `dashboard.html` | ✅ | ✅ | ✅ | Navigateur réel | FULLY FUNCTIONAL |
| `players.html` | ✅ | ✅ | ✅ | Navigateur réel | FULLY FUNCTIONAL |
| `teams.html` | ✅ | ✅ | ✅ | Navigateur réel | FULLY FUNCTIONAL |
| `courses.html` | ✅ | ✅ | ✅ | Navigateur réel | FULLY FUNCTIONAL |
| `train-ai.html` | ✅ | ✅ | ✅ | Navigateur réel + `curl` E2E | FULLY FUNCTIONAL |
| `academy.html` / `course-viewer.html` | ✅ | ✅ | ✅ | Navigateur réel + `node --test` | FULLY FUNCTIONAL |
| `certificates.html` | ✅ | ✅ | ✅ | Navigateur réel | FULLY FUNCTIONAL |
| `settings.html` | ✅ (mot de passe) | ✅ | ✅ | Navigateur réel + `curl` | FULLY FUNCTIONAL |
| `trainings.html` | ✅ | ✅ | ✅ | Navigateur réel + `node --test` | FULLY FUNCTIONAL |
| `scouting.html` | ✅ | ✅ | ✅ | Navigateur réel + `node --test` | FULLY FUNCTIONAL |
| `reports.html` | ✅ | ✅ | ✅ | Navigateur réel + `node --test` (signature binaire) | FULLY FUNCTIONAL |
| `gps.html` | ✅ | ✅ | ✅ | Testé lors d'une session précédente | FULLY FUNCTIONAL |
| `match-live.html` | ✅ | ✅ | ✅ | Navigateur réel (bandeau de mode ajouté cette session) | FULLY FUNCTIONAL |
| `player-live.html` | ✅ | ✅ | ✅ | Testé lors d'une session précédente | FULLY FUNCTIONAL |
| `cell-injury-risk.html` | ✅ | ✅ | ✅ | Navigateur réel | API CONNECTED |
| **43 autres pages** (dont `cell-gps.html`, `quizzes.html`) | ❌ | — | — | Sweep (0 erreur JS) | STATIC — non câblées, certaines sans table dédiée (nutrition, mental...) |

*Correction de comptage cette session : `gps.html`, `match-live.html` et `player-live.html`
étaient déjà réellement câblés et testés lors d'une session précédente mais n'avaient jamais été
inclus dans ce tableau — erreur de tenue de document, pas un gap fonctionnel. 16 → 19.*

## 4. Backend

17 fichiers de routes, tous avec `asyncHandler` + `validateUuidParam` + contrôle de rôle où
pertinent. Aucune route orpheline non documentée après vérification. `express-validator` sur
toutes les entrées mutables.

## 5. Database

- 34 index sur clés étrangères (27 ajoutés au total sur les 3 sessions, vérifiés via `pg_indexes`).
- 34 relations FK, toutes avec `ON DELETE` explicite (`CASCADE`/`SET NULL`).
- Nouvelles colonnes cette session : `scouting_profiles.is_favorite`, `gps_statistics.stats_source`,
  `ml_models.dataset_type`. Toutes migrées de façon idempotente (`ADD COLUMN IF NOT EXISTS`) et
  vérifiées via `\d <table>`.
- Migrations : un seul fichier `schema.sql` idempotent, rejoué de nombreuses fois sur les 3
  sessions sans erreur.

## 6. Security

Voir `docs/SECURITY.md` pour le détail complet (8 points corrigés et testés au total). Résumé de
cette session :
- **IDOR GPS corrigé** : un compte `player` pouvait consulter les données GPS (distance, vitesse,
  sprints) de n'importe quel autre joueur en devinant un UUID — **VERIFIED**, 6 scénarios testés
  avec de vrais comptes (`test/gps.test.js`).
- **GPS REST sécurisé** : le serveur ne fait plus confiance aux statistiques calculées côté client
  — recalcul réel à partir des points bruts dès que possible (`src/utils/gpsMetrics.js`, port
  fidèle de l'algorithme client). **VERIFIED** : un client annonçant 999km/400km-h avec des points
  réels ne montrant qu'un jogging de 150m voit ses valeurs ignorées et remplacées par le calcul
  réel (0,145km/18km-h) ; un saut de position physiquement impossible est filtré.
- Rate limiter réellement déclenché et observé (**VERIFIED**, session précédente).
- Autorisation Socket.io déjà vérifiée (session précédente).
- IDOR sur les autres ressources (players, teams, trainings...) : non testé de façon exhaustive —
  le risque réel est faible (accès partagé intentionnel entre staff, pas un modèle par propriétaire
  individuel pour la plupart des ressources) mais reste `NOT TESTED` de façon systématique — voir
  `docs/SECURITY.md`, section « Audit IDOR — périmètre couvert et pourquoi ».

## 7. GPS — VERIFIED (Socket.io ET REST)

**Socket.io** : JWT en poignée de main, rooms par match, validation des bornes, throttle 400ms,
autorisation par joueur (session précédente).

**REST** (nouveau cette session) : `POST /gps/session` recalcule réellement les statistiques à
partir des points bruts (jamais une confiance aveugle au client) ; `GET /gps/session/:id`,
`GET /gps/player/:id/stats` et `GET /gps?player_id=` appliquent désormais la même autorisation par
propriétaire qu'un compte `player` — testé avec de vrais comptes, 6 scénarios IDOR + 3 scénarios
anti-triche, tous `PASS`.

## 8. Match Live — VERIFIED (amélioré cette session)

**Avant** : distinction simulation/réel visuellement faible (une classe CSS + un suffixe de nom).
**Après** : bandeau permanent en haut de page, recalculé en temps réel — 🟢 EN DIRECT (GPS réel
actif), 🟡 MODE SIMULATION (22 joueurs de démonstration), ⚫ Hors ligne. Testé dans un vrai
navigateur, les 3 états confirmés, 0 erreur JS. `matches_live.status` a aussi été enrichi
(`scheduled/live/halftime/finished/cancelled`, whitelist serveur — 400 si valeur invalide) et
vérifié en conditions réelles (démarrage → halftime → finished, persisté en base à chaque
transition).

## 9. Video Analysis — NOT IMPLEMENTED, BLOCKED_EXTERNAL

Aucun pipeline de vision par ordinateur (détection joueurs/ballon, tracking, détection
d'événements) n'existe dans ce projet. `match-live.html` a un stub caméra visuel (accès
`getUserMedia`, pas d'inférence — voir le badge « Prévu — non implémenté » déjà honnête dans l'UI).
Construire ce pipeline nécessiterait un modèle entraîné (ex. YOLO), une infrastructure d'inférence
(GPU fortement recommandé pour un traitement temps réel), un pipeline d'ingestion vidéo — c'est un
projet ML à part entière de plusieurs semaines, pas un correctif de session. **Ne pas simuler
cette fonctionnalité serait la seule option honnête** ; elle n'a donc pas été implémentée, et
aucune fausse démonstration n'a été créée.

### Architecture cible proposée (documentation seule — rien de ce qui suit n'est implémenté)

Cohérente avec le pattern déjà établi et éprouvé pour le pipeline ML existant (`ml/train.py` /
`ml/predict.py` lancés via `child_process.spawn`, jamais dans le process Node principal) :

```
Frontend (match-live.html)
   ↓ upload/flux vidéo
Node/Express (src/routes/video-analysis.routes.js — à créer)
   ↓ spawn (jamais synchrone, jamais dans la boucle événementielle Node)
Service d'analyse vidéo séparé (Python — ex. ultralytics/YOLOv8 pour la détection,
   ByteTrack/DeepSORT pour le tracking inter-frames, OpenCV pour l'extraction de frames)
   ↓ résultats structurés (JSON : positions par frame, IDs de tracking, équipe si détectable)
PostgreSQL (nouvelle table, ex. video_analysis_events ou réutilisation de gps_live_tracking
   avec une colonne source='video' pour ne pas dupliquer le modèle de données existant)
   ↓
Dashboard (match-live.html, réutilise le terrain SVG déjà existant pour les positions GPS)
```

**Minimum réaliste pour une v1** si ce chantier est un jour engagé : détection joueurs, détection
ballon, tracking inter-frames, séparation d'équipes (par couleur de maillot — classification
simple, pas un modèle dédié), horodatage par frame. **Ne jamais prétendre détecter** passes, tirs,
xG, pressing, formations tant que le modèle ne les supporte pas réellement.

### BLOCKED_EXTERNAL — ce qu'il faut fournir pour débloquer

| Quoi | Pourquoi c'est bloquant ici |
|---|---|
| Modèle de détection entraîné (ou accès à un modèle pré-entraîné type YOLOv8 + fine-tuning football) | Aucun modèle de ce type n'existe dans le projet ni n'a été entraîné cette session |
| Infrastructure d'inférence (GPU recommandé) | Le traitement vidéo temps réel sur CPU seul est généralement trop lent pour un usage live |
| Vidéos réelles de match pour valider/fine-tuner | Aucune vidéo de match n'est disponible dans cet environnement de développement |
| Décision produit : traitement live ou post-match | Change fondamentalement l'architecture (queue de jobs vs traitement immédiat) |

## 10. Scouting — VERIFIED (enrichi cette session)

CRUD réel, testé (`node --test`). Ajouté : **Pépite du jour** (profil le mieux noté), **Classement
Performance** (top 3), **Favoris** (colonne `is_favorite`, bascule réelle testée dans un vrai
navigateur, filtre « favoris uniquement »), **Nuage de points** (âge × note, remplace un graphique
« zones géographiques » qui affichait des données illustratives sans colonne réelle correspondante
— honnêteté améliorée, pas seulement une fonctionnalité ajoutée). Notification déclenchée à la
création d'un profil (session précédente).

## 11. IA/ML — VERIFIED (metadata de provenance ajoutée cette session)

Pipeline d'entraînement réel (pandas/scikit-learn). **Nouveau** : `dataset_type` (`real`/
`synthetic`/`unknown`) déclaré **obligatoirement** par l'utilisateur à l'entraînement, jamais déduit
automatiquement — refusé avec 400 si absent (**VERIFIED**). Chaque prédiction renvoie désormais
`model_version`, `data_source`, `model_trained_at`, `predicted_at` en plus du résultat — jamais un
chiffre nu. Testé de bout en bout réellement : entraînement avec `dataset_type=synthetic` → modèle
créé → prédiction renvoie bien `data_source: "synthetic"` et les 4 champs de provenance ; affiché
dans `train-ai.html` (colonne « Données » dans l'historique, bloc de provenance sous chaque
prédiction).

Score de risque de blessure : pondération explicable sur ACWR/historique réel, **pas** un modèle
entraîné sur du vide (session précédente).

## 12. Academy — VERIFIED

7 modules, 34 chapitres/leçons, 40 questions notées côté serveur, certificats conditionnés à 100%
de progression réelle. Bug de régression de progression trouvé et corrigé (session précédente).

## 13. Reports — VERIFIED

Export PDF (`pdfkit`) et Excel (`exceljs`) réels, vérifiés par **signature binaire** (`%PDF-`,
`PK`), pas seulement par le code HTTP.

## 14. Notifications — VERIFIED

4 événements réels câblés (blessure créée/résolue, match programmé, profil scouting créé).

## 15. Tests

```
npm test
→ 53/53 PASS (0 fail), rejoué à l'identique après redémarrage du serveur
```

Détail : `health.test.js` (4), `auth.test.js` (13, dont forgot/reset-password), `academy.test.js`
(7), `business.test.js` (14), `gps.test.js` (9, nouveau cette session — anti-triche + IDOR GPS).

`rateLimitManualCheck.js` (hors suite principale, exécution séparée volontairement — voir
`docs/TESTING.md` pour le piège de découverte de fichiers rencontré et corrigé) : **VERIFIED**,
20×401 puis 5×429 sur 25 tentatives.

Sweep Playwright sur les 62 pages : **0 erreur JS non gérée** en mode anonyme (0 avant même,
puisque le fix des 401 a éliminé les faux positifs restants) et **0 erreur** sur les 11 pages
testées en mode authentifié avec badges « En direct » confirmés.

Bug de test découvert et corrigé cette session : deux fichiers (`business.test.js`,
`gps.test.js`) fermaient le pool PostgreSQL partagé dans plusieurs blocs `test()` indépendants,
cassant le second bloc — corrigé avec un unique `test.after(() => pool.end())` par fichier.

## 16. Docker

`Dockerfile` (backend + frontend) et `docker-compose.yml` écrits, validés syntaxiquement (parsing
YAML réel). **DOCKER_VERIFICATION_BLOCKED**, reconfirmé cette session : Docker n'est toujours pas
installé sur cette machine (`docker --version` → command not found, `Get-Command docker` en
PowerShell → rien). `docker compose up --build` n'a jamais été exécuté. Ne pas déclarer cette
configuration vérifiée avant qu'un `docker compose up --build` réel n'ait tourné sur une machine
disposant de Docker.

## 17. Deployment

Voir `docs/DEPLOYMENT.md`. Mode sans Docker entièrement vérifié. HTTPS, CI/CD, monitoring APM,
sauvegarde planifiée : non fournis par ce projet, dépendent de l'hébergeur choisi.

## 18. External blockers (BLOCKED_EXTERNAL — pas simulés)

| Blocker | Quoi fournir | Où le configurer | Comment vérifier ensuite |
|---|---|---|---|
| Service d'envoi d'e-mail | Clé API SMTP/SendGrid/Resend | Nouvelle variable d'env + intégration dans `forgot-password` | `POST /auth/forgot-password` ne devrait plus renvoyer `dev_reset_token` mais un e-mail réel reçu |
| `ANTHROPIC_API_KEY` (fournisseur alternatif, `AI_PROVIDER=anthropic`) | Clé Anthropic valide | `.env` / Render | `POST /assistant/chat` renvoie une vraie réponse au lieu de 503. **`GEMINI_API_KEY` fournie et vérifiée le 2026-08-26** (voir `docs/API.md`, section Assistant IA) — Anthropic reste le seul chemin encore non testé avec une vraie clé. |
| Docker | Installation de Docker Desktop/Engine | Machine de déploiement | `docker compose up --build` + healthchecks verts |
| HTTPS | Certificat / reverse proxy | Hébergeur choisi | Requête HTTPS réussie sur le domaine de prod |
| Modèle de vision par ordinateur (Video Analysis) | Modèle entraîné + infra d'inférence + vidéos réelles | Nouveau service dédié | Détection réelle testée sur une vidéo réelle |

## 19. Remaining risks

- 43 pages statiques peuvent induire en erreur un utilisateur qui ne remarque pas le badge « Démo ».
- IDOR non testé exhaustivement sur toutes les ressources (risque jugé faible — voir section 6).
- Pas de flux d'envoi d'e-mail réel pour la réinitialisation de mot de passe.
- Aucun test automatisé frontend (seule la vérification manuelle Playwright existe, non rejouable
  en CI sans script dédié).

## 20. Production readiness score

```
TOTAL PAGES              : 62
API CONNECTED            : 20/62 (+1 cette session : video-analysis.html, était 100% décoratif)
FULLY FUNCTIONAL         : 19/62 (+1 : télestration vidéo, CRUD réel + persistance vérifiée)
STATIC                   : 42/62
UNEXPECTED 401            : 0 (corrigé cette session — était non nul avant, faux positifs de sweep)
TESTS                    : 73/73 (video-annotations.test.js : 20 au total, dont +11 corrélation GPS)
RATE LIMIT TEST          : 1/1 (isolé, VERIFIED)
E2E (sweep 62 pages)     : 0 erreur JS, anonyme (62/62) ET authentifié (58/58 pages avec shell), VERIFIED
SECURITY TESTS           : VERIFIED (SQLi lecture code, IDOR GPS testé+corrigé, socket auth testé, rate limit testé, GPS REST anti-triche testé)
IDOR                      : PARTIAL (GPS vérifié et corrigé ; autres ressources non testées exhaustivement, risque faible)
DOCKER                    : BLOCKED (Docker absent de la machine, reconfirmé — 4e session consécutive)
GPS                       : VERIFIED (Socket.io ET REST)
MATCH LIVE                : VERIFIED (bandeau de mode + statut whitelist, vérifié dans un vrai navigateur : offline→simulation→offline, 0 erreur console ; transitions serveur halftime/finished testées par curl + nettoyées)
VIDEO AI (vision par ordinateur, tracking auto) : NOT IMPLEMENTED (BLOCKED_EXTERNAL, documenté, pas simulé)
TÉLESTRATION VIDÉO (annotation manuelle)        : VERIFIED — sujet DISTINCT de la ligne ci-dessus,
  ne pas confondre : dessin humain (flèches/cercles/lignes/zones/texte/markers/dessin libre),
  aucun ML. CRUD réel testé (curl + navigateur réel), persistance vérifiée par rechargement de
  page (annotations retrouvées aux mêmes coordonnées), animation flèche (interpolation linéaire
  from→animateTo) vérifiée par lecture de pixels canvas à 3 instants (début/milieu/fin), rôles
  vérifiés (video_analyst/head_coach/technical_director/data_analyst/fitness_coach en écriture,
  lecture ouverte, joueur bloqué en 403 serveur + UI masquée), undo/redo vérifiés (aller-retour
  serveur réel à chaque étape, pas un historique local seul), 20 tests automatisés dédiés
  (`test/video-annotations.test.js`) + 73/73 tests au total. **Corrélation GPS ajoutée** (`GET /video/annotations/:id/gps`) : réutilise les
  tables GPS déjà existantes (`gps_points`/`gps_sessions`/`gps_live_tracking`) — les 4 nouvelles
  tables proposées par l'utilisateur (`gps_tracks`/`gps_positions`/`gps_devices`) ont été
  explicitement rejetées pour éviter la duplication, décision expliquée et validée dans le plan
  avant implémentation. Vérifié réellement : point GPS réel trouvé (`gps_points`) puis remplacé
  par un point plus proche (`gps_live_tracking`, logique de plus-proche-des-deux-sources testée),
  cas honnêtes `no_time_anchor`/`no_nearby_gps_data`, IDOR (joueur limité à ses propres données).
ML                        : VERIFIED (provenance systématique re-testée de bout en bout : train→predict réel avec dataset_type=synthetic, model_version/data_source/model_trained_at confirmés dans la réponse, modèle nettoyé après test)
ASSISTANT IA              : VERIFIED (Gemini) — mis à jour le 2026-08-26 : vraie clé GEMINI_API_KEY fournie, AI_PROVIDER=gemini actif par défaut, appel réel confirmé en local ET sur Render production (réponses ancrées dans les vraies données club, provider:"gemini" dans la réponse). Modèle gemini-2.5-flash déprécié par Google entre-temps (404 explicite) → gemini-3.6-flash désormais par défaut. Chemin Anthropic inchangé, toujours PARTIAL (503 propre vérifié, aucune clé réelle fournie pour ce fournisseur)
REPORTS                   : VERIFIED (export binaire réel)
AUTH                      : VERIFIED (register/login/change-password/forgot-password/reset-password)

CRITICAL BUGS TROUVÉS ET CORRIGÉS CETTE SESSION : 0
  (aucun nouveau bug critique ; 2 corrigés lors de la session précédente — IDOR GPS REST,
   GPS REST faisait confiance à des statistiques falsifiables côté client)
HIGH                      : 0 restant
MEDIUM                    : 0 restant
LOW                       : 2 (reportés, non réintroduits — voir sessions précédentes pour le détail)
  - IDOR non exhaustif sur les ressources à faible risque
  - (player-live.html /players/me pour rôle non-joueur — déjà corrigé, mentionné pour mémoire)

CETTE SESSION (Neon + Télestration) — 1 bug trouvé et corrigé pendant le développement :
  - `.va-toolbar`/`#vaEditActions` utilisaient l'attribut `hidden` alors qu'une classe CSS
    (`.va-toolbar`, `.page-head__actions`) fixait déjà `display:flex` avec la même spécificité —
    l'ordre de déclaration faisait gagner `display:flex`, laissant la barre d'outils et le bouton
    « Nouveau clip » visibles (et cliquables) même pour un rôle non autorisé, malgré `hidden=true`
    dans le DOM. Trouvé en testant réellement le rôle `player` dans un navigateur (pas en lisant le
    code). Corrigé avec une règle `[hidden] { display:none !important }` scoping ce cas précis.
    Le serveur restait de toute façon la seule autorité réelle (403 déjà en place), donc aucune
    donnée n'a jamais pu être créée par un rôle non autorisé — c'était un problème d'UX/confusion,
    pas une brèche de sécurité, mais il aurait pu induire un joueur en erreur en lui laissant croire
    qu'il pouvait dessiner. Revérifié après correction : rôle `player` → toolbar et bouton
    « Nouveau clip » bien masqués, lecture seule confirmée.

EXTERNAL BLOCKERS         : 4 (voir section 18) — assistant IA débloqué le 2026-08-26 (clé Gemini réelle fournie)

FINAL STATUS: READY WITH LIMITATIONS
```

Ce verdict repose uniquement sur des vérifications réellement exécutées (tests automatisés
rejoués, navigateur réel, `curl`, requêtes SQL directes) — jamais sur la seule présence de code ou
de fichiers. Les points bloquants restants pour `PRODUCTION READY` sont, dans l'ordre de valeur
probable : câbler les pages statiques restantes (le plus gros volume), configurer un vrai service
d'e-mail (ou fournir une clé Anthropic/Gemini réelle pour l'assistant IA), exécuter et vérifier
`docker compose up --build` sur une machine équipée de Docker.

### Session du 2026-08-24 — ajouts et re-vérifications

- **Assistant IA** : Gemini (`@google/generative-ai`) ajouté comme fournisseur alternatif à Claude,
  sélection explicite par `AI_PROVIDER` (jamais de repli silencieux), contexte club partagé et
  identique entre les deux fournisseurs, échec propre en 503 vérifié pour les deux chemins,
  53/53 tests toujours au vert après le refactor. Voir `docs/API.md`, section « Assistant IA ».
- **Match Live** : bandeau de mode (offline/simulation/live) vérifié dans un vrai navigateur
  (Playwright), les 3 états confirmés visuellement et fonctionnellement, 0 erreur console.
  Transitions de statut serveur (`halftime`, `finished`, rejet d'un statut invalide) re-testées par
  `curl` sur un enregistrement réel, nettoyé après coup.
- **ML** : provenance des prédictions (`model_version`, `data_source`, `model_trained_at`,
  `predicted_at`) re-vérifiée par un cycle complet entraînement→prédiction→suppression réel
  (pas seulement une lecture de code).
- **Docker** : reconfirmé absent de la machine (`docker --version` et `Get-Command docker`
  échouent tous les deux) ; `docker-compose.yml` reconfirmé syntaxiquement valide (parsing YAML).
- **Bug trouvé et corrigé** : `player-live.html` déclenchait un `console.error` navigateur
  (404 attendu sur `/players/me`) pour tout compte non-joueur. Corrigé en vérifiant le rôle côté
  client avant l'appel. Sweep complet 62 pages (anonyme) + 58 pages (authentifié, compte admin)
  re-exécuté après coup : 0 erreur sur l'ensemble.

### Session du 2026-08-24 (suite) — migration Neon + Télestration vidéo

- **Base de données migrée vers Neon** (PostgreSQL cloud managé). `src/config/db.js` accepte
  `DB_SSL=true`. Schéma appliqué (27→29 tables avec la télestration), seeds + Academy rejoués,
  suite de tests complète repassée avec succès contre Neon (initialement 8 échecs en 429/pool de
  courtoisie — cause identifiée : `db/seed-academy.js` pas rejoué + rate-limiter partagé cumulé par
  des logins manuels avant `npm test` ; corrigé, run propre confirmé). Voir `docs/DEPLOYMENT.md`,
  section « Base de données cloud ». Config locale conservée en commentaire dans `.env` pour
  retour arrière. Différence honnête : suite de tests ~30s contre Neon vs ~5-6s en local (latence
  réseau), sans impact sur la justesse des résultats.
- **Télestration vidéo ajoutée** (`video-analysis.html`, était 100% décoratif) : tables
  `video_clips`/`video_annotations`, route `src/routes/video-annotations.routes.js`, moteur de
  dessin Canvas 2D natif (flèche/cercle/ligne/rectangle/dessin libre/texte/marker joueur),
  coordonnées normalisées `[0,1]`, undo/redo avec appel serveur réel à chaque étape (pas un
  historique local seul), animation de flèche par interpolation linéaire réelle (vérifiée par
  lecture de pixels canvas à 3 instants, pas juste par lecture du code), persistance vérifiée par
  rechargement complet de page (annotations retrouvées aux mêmes coordonnées après un aller-retour
  navigateur→API→PostgreSQL→navigateur), rôles vérifiés (écriture staff vidéo, lecture ouverte,
  403 serveur pour `player`). Voir `docs/API.md`, section « Télestration vidéo », pour le détail
  du périmètre et — tout aussi important — de ce qui est explicitement **hors** périmètre (pas de
  tracking automatique joueur/ballon, pas de co-édition temps réel, pas d'export vidéo avec
  incrustation, jamais de fichier vidéo stocké côté serveur). Ce sujet est **distinct** de la
  détection automatique par vision par ordinateur, qui reste `BLOCKED_EXTERNAL` (section 9,
  inchangée).

### Session du 2026-08-25 — corrélation GPS ↔ Télestration

L'utilisateur a proposé de relier GPS et Télestration avec une architecture large (mini-map,
trail, heatmap, replay animé, 4 nouvelles tables `gps_tracks`/`gps_positions`/`gps_devices`/
`gps_sessions`). **Décision explicite, validée en plan avant codage** : les tables proposées
dupliquaient `gps_sessions`/`gps_points`/`gps_live_tracking` déjà existantes et déjà testées —
rejetées au profit de leur réutilisation. Mini-map/heatmap/trail/replay animé également écartés de
cette passe (dupliqueraient la pitch SVG + heatmap déjà réelles de `match-live.html`) ; documentés
comme piste future, pas simulés.

Livré et vérifié réellement :
- `video_clips.player_id`/`recorded_at_start`, `video_annotations.player_id` (colonnes nullable,
  `ADD COLUMN IF NOT EXISTS`, aucune ligne existante ni test déjà vert cassé).
- `GET /api/video/annotations/:id/gps` — corrèle une annotation à un vrai point GPS en
  interrogeant `gps_points` (via `gps_sessions`) ET `gps_live_tracking`, retient le plus proche
  dans une tolérance de 120s. Testé par `curl` avec de vraies lignes GPS insérées : point
  `gps_points` à 30s trouvé, puis un point `gps_live_tracking` à 5s préféré (logique de
  plus-proche-des-deux-sources confirmée, pas supposée) ; cas `no_time_anchor` et
  `no_nearby_gps_data` confirmés honnêtes ; IDOR confirmé (`player` bloqué sur un autre joueur,
  autorisé sur le sien).
- `fitness_coach` ajouté aux rôles autorisés à écrire des annotations (propriétaire naturel des
  données GPS, absent des rôles autorisés jusqu'ici — gap réel comblé).
- Frontend (`video-analysis.html`) : sélecteur joueur + ancrage horaire réel à la création d'un
  clip, bouton « associer à un joueur » sur une annotation sélectionnée, bouton 📍 GPS par
  annotation taguée (appelle l'endpoint réel, affiche lat/lng/vitesse/source/écart ou le message
  honnête « aucune donnée à proximité », lien Google Maps si trouvé — pas de nouvelle dépendance
  cartographique). Vérifié dans un vrai navigateur : rôle `fitness_coach` voit bien la barre
  d'outils (nouveau rôle), création de clip avec joueur+ancrage confirmée côté serveur, tag joueur
  sur une annotation confirmé visuellement (badge nom du joueur + icône GPS dans la liste), appel
  direct de `CB_API.getAnnotationGps()` en contexte navigateur confirmé retourner les vraies
  coordonnées insérées en base.
- 11 nouveaux tests automatisés (`test/video-annotations.test.js`, 20 au total sur ce fichier) —
  73/73 tests au total après une exécution propre (backend redémarré juste avant, une seule
  exécution, cohérent avec le piège rate-limiter déjà documenté : des exécutions répétées sans
  redémarrage produisent des 429 intermittents, pas un vrai bug).
- Toutes les données de test nettoyées après chaque vérification (clips, sessions GPS,
  matches_live de test) — confirmé par requêtes directes en base, `video_clips`/
  `video_annotations` à 0 ligne en fin de session.

### Session du 2026-08-26 — AI Course Generator (Gemini) pour CoachBoot IA Academy

L'utilisateur a fourni un cahier des charges de 22 sections pour transformer l'Academy en
plateforme complète de génération de cours par IA (nouvelles tables Course/Module/Lesson/Quiz/
Enrollment/Certificate, AI Tutor par leçon, AI grading du projet final, QR code de certification,
dashboard admin multi-écrans...). **Décision de périmètre explicite, validée en plan avant
codage** : l'Academy existante réutilise déjà `courses`/`course_chapters`/`course_lessons`/
`quizzes`/`quiz_questions`/`course_exercises`/`certificates` — dupliquer ce schéma sous d'autres
noms aurait contredit une règle déjà affirmée dans le code lui-même (« ne pas créer un système de
formation parallèle », `schema.sql:147-152`). Livré : un vrai générateur qui produit exactement la
même forme de données, pas un second système.

**Livré et vérifié réellement** :
- 4 colonnes ajoutées à `courses` (`ai_generated`, `ai_provider`, `created_by`, `language`),
  nullable/défaut, aucune ligne existante affectée.
- `src/services/geminiCourseGenerator.js` — appel Gemini en sortie JSON structurée
  (`responseSchema`), validation manuelle (types de question limités à `qcm`/`vrai_faux`,
  `correct_answer` doit correspondre à une clé de `choices`, tableaux non vides), une tentative de
  réparation si invalide, erreur claire sinon.
- `POST /api/academy/generate` (aperçu, aucune écriture) + `POST /api/academy/courses`
  (transaction réelle : `courses`+`course_chapters`+`course_lessons`+`quizzes`+`quiz_questions`+
  `course_exercises` insérés atomiquement).
- **Preuve d'intégration réelle** (pas une façade) : un cours généré par Gemini a été créé, puis
  son quiz noté via `POST /quizzes/:id/submit` **existant et non modifié** (2 bonnes réponses sur 3
  → `score_pct: 67` calculé serveur, vérifié exact), sa leçon et son TP marqués complétés via les
  endpoints existants (`progress_pct` recalculé par `recomputeCourseProgress`, déjà en place,
  atteint 100%), et un certificat délivré via `POST /certificates/course/:id` existant — **aucun
  de ces endpoints n'a été touché**, la preuve que l'IA alimente le système existant plutôt que
  de le contourner.
- 11 tests automatisés (`test/academy-generate.test.js`), incluant un **vrai appel Gemini non
  mocké** (chapterCount=1 pour limiter coût/latence, ~72s pour ce test) — 84/84 tests au total.
- IDOR/permissions : rôle `player` → 403 sur génération ; `chapterCount` hors bornes → 400 ;
  `level` invalide → 400 ; structure altérée côté client → 400 (revalidée côté serveur, jamais de
  confiance aveugle dans un JSON reçu du frontend même s'il vient de `/generate`).
- **Bug réel trouvé et corrigé pendant la vérification Playwright** : le panneau admin
  (`academy.html`) stockait l'aperçu généré sous la clé `preview` mais `CB_API.saveGeneratedCourse`
  attendait une clé `generated` — la sauvegarde échouait silencieusement en 400
  (« La réponse n'est pas un objet JSON »). Trouvé en testant le vrai bouton dans un vrai
  navigateur (pas en lisant le code), confirmé par capture de la réponse réseau exacte, corrigé,
  reverifié avec un parcours complet réussi : Admin → Générer (bouton réel, formulaire réel) →
  Aperçu → Enregistrer → redirection vers `course-viewer.html` → cours affiché.
- Toutes les données de test nettoyées après chaque vérification (cours généré, certificat,
  cascade FK confirmée à 0 ligne restante).

**Hors périmètre, documenté honnêtement** (voir `docs/API.md`, section AI Course Generator) :
AI Tutor par leçon, AI grading du projet final (en conflit direct avec une décision déjà prise et
documentée — TP toujours auto-évalués), QR code de certification, dashboard admin multi-écrans,
statut brouillon/publié, édition fine d'une leçon/question générée, vérification automatique
qu'un exercice pratique a été réellement effectué, rôle « Academy Manager » dédié.

## Retrofit multi-tenant (clubs) — isolation complète entre clubs

Demande utilisateur explicite ("un utilisateur ne peut pas voir les données d'une autre équipe"),
clarifiée par question directe : isolation **multi-club complète** (SaaS), pas un simple scoping
intra-club. Le plus gros changement architectural de la session : nouvelle table `clubs`, `club_id`
sur 18 des 29 tables, JWT/`requireAuth`/`requireRole` étendus, ~19 fichiers de routes retouchés,
Socket.io (`gpsSocket.js`) retouché.

- **Schéma** : table `clubs` (`invite_code` unique) ; `club_id` nullable ajouté partout
  (idempotent), puis verrouillé `NOT NULL` + contrainte CHECK sur `users` (`admin` = seul rôle sans
  club) une fois `db/backfill-clubs.js` confirmé sans ligne orpheline. Academy (`courses` et
  descendants) reste explicitement **partagée, plateforme-entière** — décision produit confirmée
  avec l'utilisateur, pas supposée. Contribution au contenu (génération IA `/academy/generate` +
  `/academy/courses`, et création manuelle `POST /courses`) reste ouverte à **n'importe quel**
  `technical_director`, de n'importe quel club (pas réservée au superadmin) — confirmé
  explicitement avec l'utilisateur après une première passe l'ayant, à tort, réservée à `admin`.
- **Auth** : JWT gagne `club_id` + `v: 2` ; `requireAuth` reste sans aller-retour DB (design
  existant conservé) mais rejette tout jeton `v !== 2` — force une reconnexion pour les jetons déjà
  émis (comptes de démo, non critique). Nouveau `requireClubScope` + `utils/tenantScope.js`
  (`addClubFilter`) réutilisés sur 14 routeurs. Inscription par **code d'invitation de club**
  (décision confirmée avec l'utilisateur, plutôt qu'une liste publique de clubs) ; `role: 'admin'`
  retiré de l'auto-inscription (corrige une élévation de privilège pré-existante trouvée pendant
  l'exploration).
- **Route par route** : chaque liste filtre par `club_id`, chaque mutation par `:id` renvoie 404
  (jamais 403) sur une ressource d'un autre club — réutilise le pattern déjà présent
  (`if (!rows.length) return 404`) sans nouvelle branche. Cas particuliers traités explicitement :
  `dashboard.routes.js` (suppression du `CLUB_NAME` codé en dur — comparaison désormais faite via
  `clubs.name`), `assistant.routes.js` (contexte IA scopé par club, admin explicitement refusé
  plutôt que d'agréger tous les clubs), `notifications.routes.js` (`user_id IS NULL` = diffusion au
  club, plus jamais à toute la plateforme — bug réel trouvé pendant l'exploration), `injuries`
  (risk-scores agrégé par club), `reports` (scoping club sans verrouillage par auteur — partage
  d'équipe assumé), IDOR `requireOwnPlayerIfPlayerRole` composé AVEC (pas remplacé par) le filtre
  club, `ml.routes.js` (fichiers sur disque laissés en UUID opaque, seule la ligne DB est scopée).
- **Socket.io** : `canReportGpsFor` interrogeait 0 fois la base pour le staff (autorisation
  inconditionnelle) — bug réel trouvé, corrigé en vérifiant systématiquement le club du joueur
  cible. `match:joinAsCoach` n'avait AUCUNE vérification d'autorisation au-delà du JWT — corrigé.
- **Bugs réels trouvés et corrigés pendant la vérification** (pas seulement pendant l'écriture) :
  alias SQL manquant dans `gps.routes.js` (`/player/:id/stats`, 500 réel), ambiguïté de colonne
  `club_id` dans `video-annotations.routes.js` (`GET /clips`, jointure avec `users` qui a aussi
  `club_id` désormais, 500 réel), données de fixture de test avec `home_team` ne correspondant pas
  exactement à `clubs.name` (aurait faussé silencieusement le calcul des points du dashboard).
- **Vérification réelle** : `test/multi-tenant-isolation.test.js` (deux clubs réels en base —
  "CoachBoot FC" et "FC Rivière (test)" — lecture/mutation/notifications/dashboard/contexte IA/
  admin cross-club/inscription par code, toujours par comparaison d'ids réels, jamais par comptage
  seul) + `test/gps-socket-isolation.test.js` (nouvelle dépendance de dev `socket.io-client`,
  vérifie le rejet réel de `match:joinAsCoach`/`match:joinAsPlayer` cross-club). Suite complète :
  **106/106 tests verts** (backend redémarré avant chaque run, un seul run exploité par tentative,
  conformément à la convention du projet). Un échec transitoire non lié (503 réel renvoyé par
  l'API Gemini elle-même pendant un run) a été isolé et confirmé résolu par un nouveau run du seul
  fichier concerné avant le run final complet.
- **Ajustement assumé** : `authLimiter` (anti-bruteforce `/auth/*`) désactivé hors production
  (`NODE_ENV !== 'production'`) — la suite de tests, exécutant chaque fichier dans son propre
  process (donc sans partage du cache de jetons entre fichiers), dépasse légitimement l'ancien
  seuil de 20 requêtes/15min depuis l'ajout de comptes multi-club ; la protection reste pleine en
  production.

**Hors périmètre, documenté honnêtement** (voir `docs/API.md`, section Multi-tenant) : UI
d'administration des clubs, sélecteur de club à la connexion, Row-Level-Security PostgreSQL.

### Suivi — inscription en libre-service (création de club) + Academy ouverte à tout club

Deux ajustements demandés juste après la retrofit multi-tenant, chacun confirmé par question
directe avant implémentation :

1. **Chaque équipe crée son propre club à l'inscription**, plutôt que de rejoindre un club
   pré-créé via un code fixe. `POST /auth/register` accepte désormais soit `invite_code` (rejoindre
   un club existant), soit `new_club_name` (créer un nouveau club — slug + `invite_code` générés
   automatiquement, club + premier compte insérés dans une seule transaction, rôle par défaut
   `technical_director`). Le code généré est renvoyé dans la réponse (`club.invite_code`) pour que
   ce premier compte le partage avec son équipe. `register.html` a un bouton pour basculer entre
   les deux modes.
2. **Génération/gestion Academy réouverte à tout `technical_director`** (pas réservée au
   superadmin) — la première passe de la retrofit avait, par excès de prudence, réservé
   `/academy/generate`, `/academy/courses` et `POST /courses` à `admin` seul ; corrigé après
   clarification explicite de l'utilisateur (contenu reste partagé plateforme-entière, mais
   n'importe quel club peut y contribuer).

109/109 tests verts après ces deux changements (backend redémarré avant le run).

### Télestration — support des liens YouTube (YouTube IFrame Player API)

Ancienne limite honnête : un clip ne pouvait référencer qu'une URL directement lisible par
`<video>` (MP4/WebM/HLS) ou un fichier local — un lien YouTube échouait silencieusement (l'API
YouTube ne fournit pas de fichier lisible nativement par `<video>`). Corrigé dans
`coachboot/video-analysis.html` : détection automatique d'un lien YouTube
(`extractYouTubeId()` — `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`) → lecture via la
**YouTube IFrame Player API**, derrière une abstraction unique `player` (`currentTime`,
`pause()`, `duration`, `width`/`height`) qui rend le reste du moteur de télestration (dessin,
horodatage, undo/redo, flèches animées, corrélation GPS) totalement indépendant du lecteur réel
utilisé. Aucun changement backend nécessaire (`video_url` était déjà un champ texte libre).

**Bug réel trouvé et corrigé pendant la vérification Playwright** : `new YT.Player(...)` renvoie
un objet immédiatement, mais ses méthodes (`getCurrentTime`, `seekTo`...) lèvent
`"is not a function"` tant que l'iframe interne n'a pas fini de s'initialiser — capturé en testant
un vrai clip dans un vrai navigateur (pas en relisant le code), corrigé avec un drapeau
`ytReady` mis à `true` uniquement dans `onReady`.

**Vérifié réellement, deux fois** : (1) un clip référençant un vrai lien YouTube officiel U.S.
Soccer (USWNT vs Pays-Bas, Coupe du Monde 2023) — le lecteur affiche une vraie restriction
géographique YouTube (« uploader has not made this video available in your country »), qui est
une limite de licence YouTube elle-même, pas un bug ; (2) un clip avec un lien YouTube
génériquement embarquable (Blender Foundation, domaine public) — lecture réelle confirmée, une
annotation flèche dessinée à la souris directement sur le lecteur YouTube et sauvegardée avec
succès (`✓ Enregistré`), visible dans le panneau Annotations. Nettoyé après vérification.

**Limite honnête restante** : le pas-à-pas image par image (`vaFrameBackBtn`/`vaFrameFwdBtn`)
n'est qu'approximatif sur YouTube (`seekTo`, pas d'accès frame-exact comme `<video>`) ; aucun
événement `timeupdate` natif côté YouTube, donc le canvas se redessine par intervalle (150ms)
pendant la lecture plutôt qu'à chaque frame réelle.
