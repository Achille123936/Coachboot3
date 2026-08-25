# CoachBoot Enterprise — Sécurité

Audit réel effectué en lisant le code (pas une checklist théorique) sur `coachboot-backend/`,
suivi de corrections testées. État à jour de cette session — voir aussi `docs/API.md` pour le
détail de chaque route.

## Ce qui était déjà en place (vérifié, pas supposé)

- **Injection SQL** : aucune. Toutes les requêtes utilisent des paramètres `$1/$2/...` ; les seuls
  fragments de SQL construits dynamiquement (`buildUpdateSet`, filtres `WHERE`) proviennent de
  listes de colonnes codées en dur côté serveur, jamais de clés `req.body` arbitraires.
- **`helmet()`** appliqué globalement (`src/server.js`).
- **Rate limiting** (`express-rate-limit`) : 300 req/15min sur `/api/*`, 20 req/15min sur
  `/api/auth/login` et `/api/auth/register` spécifiquement (anti-bruteforce).
- **JWT_SECRET** : refuse de démarrer si absent ET `NODE_ENV=production` ; sinon avertit bruyamment
  (`console.warn`) et utilise un secret de dev connu — jamais silencieux.
- **Uploads** (`ml.routes.js`) : whitelist d'extension, limite 10 Mo, nom de fichier randomisé
  (`crypto.randomUUID()`), nettoyage systématique après usage (y compris en cas d'erreur).
- **Logs** : aucun mot de passe/jeton/secret n'est jamais loggé, y compris dans le handler d'erreur
  générique.
- **Foreign keys** : les 34 relations de `db/schema.sql` déclarent toutes un `ON DELETE` explicite
  (`CASCADE` ou `SET NULL`) — aucune suppression ne peut échouer avec une erreur 500 opaque due à
  une contrainte implicite.

## Corrigé pendant cette session (avant → après, testé)

### 1. `CORS_ORIGIN` pouvait rester `*` en production sans avertissement bloquant
**Avant** : seul `JWT_SECRET` avait un garde-fou de démarrage ; `CORS_ORIGIN=*` en production
passait silencieusement (n'importe quel site tiers aurait pu appeler l'API avec un jeton volé).
**Après** (`src/server.js`) : même garde-fou que `JWT_SECRET` — `NODE_ENV=production` sans
`CORS_ORIGIN` explicite (ou avec `*`) fait échouer le démarrage avec un message clair.
**Testé** : redémarrage réel du serveur avec `NODE_ENV=development` (passe, avertit) ; le code du
garde-fou miroir exactement le pattern `JWT_SECRET` déjà validé.

### 2. Socket.io GPS : aucune vérification d'autorisation sur `match:joinAsPlayer`
**Avant** : n'importe quel compte authentifié pouvait rejoindre un match en tant que N'IMPORTE QUEL
`playerId` et reporter des positions GPS en son nom.
**Après** (`src/socket/gpsSocket.js`, `canReportGpsFor`) : un compte `player` ne peut rejoindre que
comme lui-même (`players.user_id = socket.user.id`) ; le staff GPS-autorisé (`fitness_coach`,
`data_analyst`, `head_coach`, `admin`) peut rejoindre pour n'importe quel joueur.
**Testé réellement** avec un client `socket.io-client` : (a) un joueur reportant pour lui-même →
`match:joined` ; (b) un joueur reportant pour un coéquipier → `gps:error` (rejeté) ; (c) un coach
reportant pour n'importe quel joueur → `match:joined`. Les trois cas confirmés en conditions réelles,
pas en lecture de code.

### 3. Aucun changement de mot de passe possible
**Avant** : un utilisateur connecté n'avait aucun moyen de changer son mot de passe.
**Après** : `PUT /auth/change-password` (voir `docs/API.md`), vérifie le mot de passe actuel avant
de le remplacer. **Testé** : mauvais mot de passe actuel → 401 ; nouveau trop court → 400 ; succès →
200, ancien mot de passe rejeté ensuite, nouveau fonctionne.

### 4. Foreign keys sans index
La majorité des colonnes FK (`players.user_id`, `course_progress.*`, `quiz_attempts.*`,
`injuries.player_id`, `gps_sessions.*`, etc. — 26 colonnes au total) n'avaient aucun index, ce qui
force un scan séquentiel sur chaque jointure et chaque cascade de suppression. Ajoutés dans
`db/schema.sql` (`CREATE INDEX IF NOT EXISTS`, idempotent) et appliqués réellement à la base de
développement — vérifié via `pg_indexes` (33 index `idx_*` présents après migration, contre 7 avant).

## Corrigé lors de la session de finalisation suivante

### 5. Pas de flux « mot de passe oublié »
**Après** : `POST /auth/forgot-password` + `POST /auth/reset-password` (jeton haché SHA-256, à
usage unique, expire après 1h, réponse anti-énumération identique que le compte existe ou non).
**Limite honnête assumée** : aucun service d'envoi d'e-mail configuré — le jeton n'est donc jamais
livré à l'utilisateur en production (`email_status: 'EMAIL_SERVICE_NOT_CONFIGURED'`, jamais le
jeton lui-même). Voir `docs/API.md`.
**Testé** : réponse identique pour un e-mail inexistant (`test/auth.test.js`) ; jeton invalide →
400 ; jeton valide → mot de passe changé ; jeton réutilisé → 400 (usage unique) ; **et** parcours
complet rejoué dans un vrai navigateur (`login.html` → lien de réinitialisation → `reset-password.html`
→ nouveau mot de passe fonctionnel, ancien rejeté). Un bug réel a été détecté et corrigé pendant ce
test : `reset-password.html` utilisait d'abord une query string (`?token=`), perdue par le serveur
statique de développement lors de sa redirection « URL propre » — corrigé en fragment (`#token=`),
même correctif déjà appliqué à `course-viewer.html` plus tôt dans le projet.

### 6. Rate limiting jamais testé en le déclenchant réellement
**Après** : `rateLimitManualCheck.js` (racine du backend, volontairement hors de `test/` — voir
`docs/TESTING.md` pour la raison précise) envoie 25 tentatives de connexion réelles et vérifie que
les 20 premières sont rejetées normalement (401) puis les suivantes bloquées (429).
**Testé, résultat réel observé** : 20 × 401, 5 × 429 — le rate limiter fonctionne bien tel que
configuré, pas seulement en lecture de code.

### 7. `POST /gps/session` faisait confiance aux agrégats calculés côté client
**Avant** : contrairement au flux temps réel Socket.io (qui valide chaque point), l'endpoint REST
acceptait les statistiques (distance, vitesse max, sprints...) telles que soumises par le client,
sans les recalculer à partir des points bruts.
**Après** (`src/utils/gpsMetrics.js`) : port fidèle côté serveur de l'algorithme du tracker client
(`gps-live.js` — mêmes seuils : sprint ≥22km/h, filtrage des sauts >45km/h, bruit GPS <1,5m...).
Dès que ≥2 points exploitables sont fournis, les agrégats sont **recalculés côté serveur et ce sont
ces valeurs qui sont persistées**, jamais celles du client. `gps_statistics.stats_source` trace
honnêtement si la ligne vient d'un recalcul serveur (`server_recomputed`) ou, faute de points
suffisants, d'une valeur client acceptée telle quelle (`client_trusted`).
**Testé réellement** (`test/gps.test.js`) : (a) un client annonçant 999km/400km/h avec des points
réels ne montrant qu'un jogging de 150m voit ses valeurs falsifiées ignorées et remplacées par
0,145km/18km/h recalculés ; (b) un saut de position Paris→Marseille en 1 seconde (physiquement
impossible) est exclu du calcul de distance ; (c) sans points, la valeur client est acceptée mais
explicitement tracée `client_trusted`.

### 8. IDOR : un compte "player" pouvait consulter les données GPS de n'importe quel autre joueur
**Avant** : `GET /gps/session/:id`, `GET /gps/player/:id/stats` et `GET /gps?player_id=` n'avaient
aucune vérification de propriété au-delà de `requireAuth` — un compte `player` authentifié pouvait
consulter les données physiques (distance, vitesse, sprints — potentiellement révélatrices de
fatigue) de n'importe quel coéquipier en devinant/énumérant un UUID.
**Après** (`requireOwnPlayerIfPlayerRole`, `src/routes/gps.routes.js`) : un compte `player` ne peut
accéder qu'aux données du joueur auquel il est lié (`players.user_id`) ; `GET /gps` sans
`player_id` renvoie 400 plutôt que de renvoyer silencieusement toutes les sessions. Le staff
GPS-autorisé (`fitness_coach`, `data_analyst`, `head_coach`, `admin`) n'est pas concerné par cette
restriction — même principe que l'autorisation déjà en place côté Socket.io (point 2 ci-dessus),
dupliqué côté REST volontairement (deux surfaces indépendantes).
**Testé réellement** (`test/gps.test.js`) : 6 scénarios vérifiés (joueur→ses propres stats=ALLOW,
joueur→stats d'un autre=DENY 403, joueur→détail de session d'un autre=DENY 403, joueur→liste sans
`player_id`=400, joueur→liste filtrée sur un autre joueur=DENY 403, staff→n'importe quel
joueur=ALLOW inchangé).

## Audit IDOR — périmètre couvert et pourquoi

CoachBoot est un outil de gestion d'équipe : la plupart des données (joueurs, matchs,
entraînements, blessures, scouting) sont **intentionnellement partagées entre tout le staff
authentifié** — un `head_coach` doit pouvoir voir la fiche de n'importe quel joueur, ce n'est pas
une faille IDOR, c'est le modèle métier. Le contrôle d'accès pertinent pour ces ressources est donc
**par rôle** (`requireRole(...)`, déjà en place et vérifié par route dans `docs/API.md`), pas par
propriétaire individuel.

Les ressources où un vrai cloisonnement PAR UTILISATEUR a du sens ont été vérifiées :
- **GPS** (physique, sensible) : gap réel trouvé et corrigé — point 8 ci-dessus.
- **Certificats** (`GET /certificates`) : déjà scopé `WHERE user_id = req.user.id`, pas de route
  `GET /certificates/:id` exposant un certificat d'un autre utilisateur.
- **Notifications** (`PUT /notifications/:id/read`) : déjà scopé `user_id = $2 OR user_id IS NULL`,
  impossible de marquer comme lue une notification personnelle d'un autre utilisateur.
- **Progression de cours / complétions de leçon / tentatives de quiz** (Academy) : toujours écrites
  avec `req.user.id` côté serveur, jamais un ID transmis par le client — pas de surface IDOR.

Non vérifié de façon exhaustive et automatisée cette session, faute de temps : un audit
systématique de CHAQUE endpoint à ID (players, teams, trainings, reports, scouting, injuries,
courses, matches...) contre les 6 scénarios du point 8 ci-dessus. Le risque réel y est faible (ces
ressources sont déjà correctement gérées par rôle), mais ce n'est pas la même chose que « vérifié ».

## Non résolu — nécessite une décision produit, pas seulement du code

- **Rôles du système vs rôles génériques** : le système utilise 11 rôles réels et cohérents avec
  les 10 tableaux de bord existants (`admin`, `president`, `technical_director`, `head_coach`,
  `fitness_coach`, `goalkeeper_coach`, `video_analyst`, `data_analyst`, `player`, `parent`,
  `federation`). Ce sont les rôles réellement utilisés par `requireRole(...)` dans le code — les
  conserver plutôt que d'en substituer un ensemble générique non lié à l'architecture existante.
- **Service d'e-mail toujours absent** : le flux de réinitialisation est fonctionnel de bout en
  bout côté serveur, mais aucun e-mail n'est réellement envoyé — voir point 5 ci-dessus.
