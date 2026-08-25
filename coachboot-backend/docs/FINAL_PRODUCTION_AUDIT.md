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
| `ANTHROPIC_API_KEY` (ou `GEMINI_API_KEY` avec `AI_PROVIDER=gemini`) | Clé Anthropic **ou** clé Google Gemini valide | `.env` | `POST /assistant/chat` renvoie une vraie réponse au lieu de 503. Deux fournisseurs codés cette session (voir `docs/API.md`, section Assistant IA) — aucun des deux n'a de clé réelle dans cet environnement, donc **aucun appel réel n'a été fait vers un LLM externe** ; seul le routage/échec propre (503, message ciblant le bon fournisseur) a été vérifié par `curl`. |
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
ASSISTANT IA              : PARTIAL — 2 fournisseurs codés (Anthropic par défaut, Gemini alternatif via AI_PROVIDER), routage et échec propre 503 vérifiés par curl pour les deux ; **aucun appel réel à un LLM externe** (ni Claude ni Gemini) n'a pu être testé, faute de clé API dans cet environnement
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

EXTERNAL BLOCKERS         : 5 (voir section 18)

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
