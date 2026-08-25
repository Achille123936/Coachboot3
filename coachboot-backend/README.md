# CoachBoot Enterprise — Backend (Express + PostgreSQL)

API REST qui alimente en données réelles une partie du frontend CoachBoot Enterprise
(`../coachboot/`). Voir `docs/API.md` pour la référence complète des routes.

## Installation

```bash
cd coachboot-backend
npm install
cp .env.example .env        # adapter les identifiants PostgreSQL si besoin
```

Prérequis : PostgreSQL 14+ installé et démarré localement (ou accessible à distance).

## Créer et peupler la base de données

```bash
# 1. Créer la base (une seule fois)
createdb coachboot
# ou : psql -U postgres -c "CREATE DATABASE coachboot;"

# 2. Appliquer le schéma
npm run db:migrate

# 3. Insérer les données de démonstration (11 comptes, joueurs, matchs, etc.)
npm run db:seed

# 4. (optionnel) Insérer le contenu de la CoachBoot IA Academy (6 modules + projet final)
# — nécessite l'étape 3 avant (utilise les comptes de démonstration), rejouable sans risque
node db/seed-academy.js
```

## Démarrer le serveur

```bash
npm start
# → API disponible sur http://localhost:4000/api
# → GPS temps réel (Socket.io) sur ws://localhost:4000, même port (pas de serveur séparé)
# → Vérification rapide : curl http://localhost:4000/api/health
```

## CoachBoot IA — entraînement de modèles (Python)

En plus de Node/PostgreSQL, le module `ml/` (page `coachboot/train-ai.html`) nécessite **Python 3.12**
(pas une version bêta — voir la note dans `docs/API.md`) :

```bash
cd coachboot-backend/ml
py -3.12 -m pip install -r requirements.txt   # Windows (lanceur py)
# ou : python3 -m pip install -r requirements.txt   # Linux/macOS, puis définir PYTHON_BIN dans .env
```

Sans cette étape, `POST /api/ml/train` et `/api/ml/predict` échouent proprement avec un message
d'erreur explicite (pas un crash du serveur) — le reste de l'application continue de fonctionner.

## Structure

```
coachboot-backend/
├── src/
│   ├── server.js            Point d'entrée (Express + http.createServer + Socket.io)
│   ├── config/db.js         Pool de connexion PostgreSQL
│   ├── middleware/
│   │   ├── auth.js          Vérification JWT + contrôle d'accès par rôle
│   │   └── errorHandler.js  Gestion centralisée des erreurs + wrapper async
│   ├── routes/               Un fichier par ressource (players, teams, matches, gps, match-live, ml...)
│   └── socket/gpsSocket.js   Serveur GPS temps réel (Socket.io) — rooms par match, auth JWT,
│                              validation + persistance + diffusion des relevés GPS multi-joueurs
├── ml/
│   ├── train.py               Pipeline d'entraînement (pandas/scikit-learn) — voir docs/API.md
│   ├── predict.py             Prédiction à partir d'un modèle déjà entraîné
│   ├── requirements.txt       Dépendances Python (pandas, numpy, scikit-learn, joblib)
│   ├── models/                Modèles entraînés (poids .joblib), créé au premier entraînement
│   └── uploads/                CSV temporairement reçus, supprimés après chaque entraînement
├── db/
│   ├── schema.sql            Schéma PostgreSQL complet
│   ├── seed.js               Données de démonstration cohérentes avec le frontend
│   └── seed-academy.js       Contenu réel de la CoachBoot IA Academy (6 modules + projet final,
│                              chapitres/leçons/quiz/TP) — voir docs/API.md
├── test/                     Suite d'intégration réelle (node --test) — voir docs/TESTING.md
├── Dockerfile, .dockerignore Image backend (Node 20 alpine) — voir docs/DEPLOYMENT.md
└── docs/
    ├── API.md                     Référence complète des routes REST + événements Socket.io + pipeline IA
    ├── SECURITY.md                Audit sécurité réel : corrigé cette session vs limites restantes
    ├── TESTING.md                 Comment lancer les tests, couverture, piège du rate limiter partagé
    ├── DEPLOYMENT.md              Docker (compose racine), checklist production, ce qui manque
    └── FINAL_PRODUCTION_AUDIT.md  Bilan complet : statut module par module, bugs trouvés/corrigés, verdict
```

## Relier le frontend statique à ce backend

Le frontend (`../coachboot/assets/js/api.js`, objet `CB_API`) appelle par défaut
`http://localhost:4000/api`. Il suffit donc de démarrer ce backend puis d'ouvrir les pages
du frontend normalement (double-clic sur `index.html`, ou tout serveur statique).

16 pages sont connectées à l'API réelle (avec repli automatique sur des données de démonstration
si le backend est éteint) : `login.html`, `register.html`, `reset-password.html`, `dashboard.html`,
`players.html`, `teams.html`, `courses.html`, `train-ai.html`, `academy.html`, `course-viewer.html`,
`certificates.html`, `settings.html` (changement de mot de passe), `trainings.html`,
`scouting.html`, `reports.html`, `cell-injury-risk.html`. **46 des 62 pages restent en données
statiques de démonstration** (10 tableaux de bord par rôle, la majorité des « cellules d'analyse »,
`matches.html`, `injuries.html`, `notifications.html`, etc.) — les brancher suit exactement le même
schéma (voir le code de `trainings.html`/`scouting.html` comme modèles les plus récents).

## Tests

```bash
npm test
```

Voir `docs/TESTING.md` — suite d'intégration réelle (`node --test`), aucune dépendance de test
ajoutée. Nécessite le serveur démarré (`npm start`) dans un autre terminal.

## Docker

```bash
cd .. && docker compose up --build
```

Voir `docs/DEPLOYMENT.md` — configuration écrite et validée syntaxiquement cette session, **pas
encore exécutée avec Docker réel** dans cet environnement de développement (honnêteté explicite,
pas une affirmation de succès non vérifiée).

## Sécurité — ce qui est fait, et ce qui resterait à faire en production

Fait : hachage bcrypt des mots de passe, jetons JWT signés (7 jours), limitation de débit
(rate limiting) globale et renforcée sur `/auth/login`+`/auth/register`, en-têtes de sécurité
via Helmet, validation stricte des entrées, contrôle d'accès par rôle sur chaque route sensible
(y compris Socket.io — un joueur ne peut reporter que sa propre position GPS), garde-fou de
démarrage sur `JWT_SECRET` et `CORS_ORIGIN` en production, changement de mot de passe. Détail
complet et limites honnêtes : `docs/SECURITY.md`.

À envisager avant une mise en production réelle : jetons de rafraîchissement (refresh tokens)
avec cookie `httpOnly` plutôt qu'un jeton unique stocké en `localStorage` (plus résistant au XSS),
rotation du secret JWT, flux « mot de passe oublié » (nécessite un service d'e-mail), journalisation
centralisée.
