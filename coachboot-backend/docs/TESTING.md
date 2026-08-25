# CoachBoot Enterprise — Tests

## Ce qui existe

Avant cette session, **zéro test automatisé** n'existait dans le projet (ni backend ni frontend) —
constaté en cherchant `*.test.js`, `*.spec.js`, une config Jest/Mocha, un script `"test"` dans
`package.json` : aucun résultat. Toute la vérification précédente était manuelle (`curl`, Playwright
lancé ponctuellement, jamais rejouable automatiquement).

Ajouté : une suite d'**intégration réelle** (`coachboot-backend/test/*.test.js`, Node `node:test`
natif — pas de framework externe ajouté, pour rester léger) qui appelle l'API HTTP réellement
démarrée et lit/écrit dans la vraie base PostgreSQL, exactement comme le ferait le frontend. Il n'y
a pas de base de données de test séparée ni de mocks — c'est un choix : ces tests vérifient le
comportement réel du système, pas une simulation.

## Lancer les tests

```bash
cd coachboot-backend
npm run db:migrate && npm run db:seed && node db/seed-academy.js   # une fois
npm start          # dans un terminal, laisser tourner
npm test           # dans un autre terminal
```

`npm test` exécute `node --test`, qui découvre automatiquement tous les fichiers sous `test/`.

## Couverture actuelle (53 assertions, 5 fichiers)

- **`health.test.js`** : `/api/health`, `/api/health/live`, `/api/health/ready` répondent
  correctement ; route inconnue → 404 propre.
- **`auth.test.js`** : inscription réelle, doublon d'e-mail → 409, validation → 400, mauvais mot de
  passe → 401, `/auth/me` sans/avec jeton, changement de mot de passe réel (ancien rejeté après,
  nouveau fonctionne), mot de passe oublié → réinitialisation (jeton invalide → 400, jeton réutilisé
  → 400 car à usage unique), contrôle de rôle (`player` ne peut pas créer d'équipe → 403).
- **`academy.test.js`** : parcours complet CoachBoot IA Academy — structure des chapitres,
  aucune réponse de quiz exposée avant soumission, notation serveur réelle (une bonne + une fausse
  réponse → score < 100%), progression recalculée après complétion d'une leçon, certificat refusé
  avant 100%. Restaure la donnée de démonstration du Module 1 à l'identique après le test.
- **`business.test.js`** : création réelle d'une séance/d'un profil de scouting/d'un rapport,
  export PDF/Excel vérifié par **signature binaire** (`%PDF-`, `PK`) et pas seulement par le code
  HTTP ; une blessure créée déclenche une vraie notification (comptée avant/après).
- **`gps.test.js`** : le serveur ignore des statistiques falsifiées (999km/400km-h) et les remplace
  par un recalcul réel à partir des points bruts ; un saut de position physiquement impossible est
  filtré ; sans points, la valeur client est acceptée mais tracée `client_trusted`. **Audit IDOR** :
  un compte `player` peut voir ses propres données GPS mais reçoit 403 sur celles d'un autre joueur
  (stats, détail de session, liste filtrée), 400 s'il omet `player_id` (pas de fuite silencieuse de
  toutes les sessions) ; le staff GPS-autorisé n'est pas affecté par ces restrictions.

Chaque test nettoie ses propres données à la fin (jamais les comptes de démonstration
`@coachboot.app` ni les joueurs seedés). `npm test` force l'exécution séquentielle des fichiers
(`--test-concurrency=1`) pour un résultat déterministe et plus simple à déboguer.

**Piège rencontré deux fois, à connaître avant d'ajouter un fichier de test** : un fichier contenant
plusieurs blocs `test()` de haut niveau qui font chacun `require('../src/config/db')` puis
`pool.end()` dans leur propre nettoyage cassera le second bloc (« Cannot use a pool after calling
end on the pool »), le module étant mis en cache par `require()` — le premier `pool.end()` ferme le
pool partagé par tout le fichier. Solution : un seul `const pool = require(...)` en haut du fichier
et un unique `test.after(() => pool.end())`, jamais `pool.end()` dans un `t.test()` individuel
(voir `business.test.js` et `gps.test.js` comme modèles).

## Piège découvert et à connaître : rate limiting partagé

`/api/auth/login` et `/api/auth/register` sont limités à 20 requêtes/15min **par IP**, dans un
compteur en mémoire du process serveur (`express-rate-limit`, voir `docs/SECURITY.md`). Comme tous
les tests locaux viennent de `127.0.0.1`, ce compteur est **partagé** entre : les tests
automatisés, tout `curl`/script manuel lancé dans les 15 minutes précédentes, et les exécutions
répétées de `npm test`. Rencontré concrètement pendant le développement de cette suite : des tests
par ailleurs corrects échouaient avec `429 Trop de tentatives` simplement parce que la fenêtre de
15 minutes n'était pas encore expirée après du test manuel.

**Symptôme** : des tests `auth.test.js`/`business.test.js` échouent avec `429` alors que le code
testé est correct.
**Solution** : redémarrer le serveur backend (`npm start`) juste avant `npm test` — cela réinitialise
le compteur en mémoire. Ce n'est pas un bug de la suite, c'est le rate limiter qui fait exactement
son travail ; `testHelpers.js` met en cache un jeton par compte/mot de passe au sein d'un même
fichier de test pour limiter sa propre consommation de ce budget.

**Piège rencontré une seconde fois en écrivant le test qui déclenche délibérément ce rate limiter**
(`rateLimitManualCheck.js`) : `node --test` sans argument ramasse **tout fichier `.js`** placé
sous un dossier littéralement nommé `test/`, quel que soit son nom (`*.manual.js` compris) — pas
seulement les `*.test.js`. Un premier essai nommé `test/rate-limit.manual.js` a donc été exécuté
EN PARALLÈLE de `auth.test.js` par `npm test`, épuisant leur budget `authLimiter` partagé et faisant
échouer en cascade des tests par ailleurs corrects. La seule exclusion fiable est de sortir
complètement le fichier de `test/` — d'où son emplacement à la racine du backend,
`rateLimitManualCheck.js`, et son exécution strictement séparée :

```bash
npm start                              # terminal 1
node --test rateLimitManualCheck.js    # terminal 2 — JAMAIS via npm test
```

Vérifié réellement : 25 tentatives de connexion envoyées, les premières rejetées en 401 (compte
inexistant), les suivantes en 429 une fois le seuil de 20 dépassé — le rate limiter fonctionne
bel et bien, pas seulement en lecture de code.

## Couverture ajoutée depuis (mot de passe oublié, health checks)

- `auth.test.js` couvre aussi `POST /auth/forgot-password` (réponse anti-énumération identique
  pour un compte inexistant, jeton renvoyé uniquement hors production) et
  `POST /auth/reset-password` (jeton invalide → 400, jeton valide → mot de passe changé, jeton
  réutilisé → 400 car à usage unique).
- `health.test.js` couvre `GET /api/health/live` et `GET /api/health/ready`.

## Ce qui n'existe pas encore

- **Tests frontend** : aucun test automatisé sur les 61 pages HTML (seules des vérifications
  manuelles Playwright ponctuelles ont été faites pendant le développement, non rejouables).
- **Base de données de test isolée / CI** : la suite tourne contre la base de développement réelle,
  pas une base éphémère dédiée — adapté à un usage local, pas à une pipeline CI multi-exécutions
  concurrentes sans adaptation (voir `docs/DEPLOYMENT.md`).
