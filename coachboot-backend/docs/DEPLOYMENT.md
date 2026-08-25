# CoachBoot Enterprise — Déploiement

## ⚠️ État de vérification honnête

La configuration Docker ci-dessous a été **écrite et relue attentivement**, et le fichier
`docker-compose.yml` a été **validé syntaxiquement** (parsing YAML réel, structure des services/
volumes/dépendances confirmée). Elle n'a **pas** été validée par une exécution réelle
(`docker compose up --build`) dans cet environnement de développement — Docker n'y était pas
disponible/exploitable pendant cette session. Ne pas déclarer cette configuration « testée » avant
qu'un `docker compose up --build` réel ait été exécuté et vérifié (health checks verts, `/api/health`
répondant, frontend accessible) sur une machine disposant de Docker.

## Sans Docker (déjà validé de bout en bout cette session)

```bash
# 1. PostgreSQL 14+ installé et démarré localement
cd coachboot-backend
npm install
cp .env.example .env        # adapter les identifiants, surtout JWT_SECRET
npm run db:migrate
npm run db:seed
node db/seed-academy.js     # requis pour le module CoachBoot IA Academy (course_chapters,
                             # quiz_questions...) — test/academy.test.js échoue sans lui,
                             # ce n'est pas un contenu vraiment optionnel malgré son nom

npm start                   # API sur http://localhost:4000/api
```

```bash
# Frontend : aucune installation, aucun build
cd coachboot
npx serve .                 # ou : python -m http.server, ou ouvrir index.html directement
```

C'est le mode réellement exercé pendant tout le développement de ce projet (voir `docs/API.md`,
section « Tests effectués »).

## Base de données cloud (Neon ou équivalent) — validé de bout en bout le 2026-08-24

Aucun changement de code nécessaire au-delà de la config : `src/config/db.js` accepte `DB_SSL=true`
pour les fournisseurs qui exigent TLS (Neon, RDS, Supabase...). Étapes réellement exécutées et
vérifiées cette session (Neon spécifiquement, projet `neondb`) :

```bash
# Dans coachboot-backend/.env — remplacer les DB_* locaux par ceux fournis par Neon,
# et ajouter DB_SSL=true (Neon exige sslmode=require) :
DB_HOST=ep-xxxxxxxx-pooler.<region>.aws.neon.tech
DB_PORT=5432
DB_USER=neondb_owner
DB_PASSWORD=<mot de passe fourni par Neon>
DB_NAME=neondb
DB_SSL=true

# Le pool node-postgres (pg) applique le schéma directement — psql n'est pas requis :
node -e "require('dotenv').config(); const fs=require('fs'); const pool=require('./src/config/db'); pool.query(fs.readFileSync('db/schema.sql','utf8')).then(()=>pool.end())"
node db/seed.js
node db/seed-academy.js
npm start
```

**Vérifié réellement** (pas seulement écrit) : connexion TLS établie (`SELECT version()` confirme
PostgreSQL 18.6 côté Neon), schéma appliqué (27 tables), seeds exécutés, `/api/health` et
`/api/health/ready` renvoient `db: up`, connexion + requêtes authentifiées réelles (players,
dashboard/summary) confirmées, suite de tests complète rejouée avec succès (53/53) contre la base
Neon. **Différence honnête observée** : la suite de tests prend ~30s contre Neon contre ~5-6s en
local (latence réseau vers le pooler Neon plutôt qu'un socket local) — sans impact sur la
correction, seulement sur la vitesse. Ancienne config locale conservée en commentaire dans `.env`
pour un retour arrière rapide si besoin.

## Avec Docker (écrit cette session, syntaxiquement validé, non exécuté)

```bash
cp .env.example .env        # à la racine du projet (PAS coachboot-backend/.env)
# éditer JWT_SECRET au minimum — docker-compose refuse de démarrer sans lui
docker compose up --build
```

Services (`docker-compose.yml`, racine du projet) :

| Service | Image/Build | Port publié | Healthcheck |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | 5432 | `pg_isready` |
| `backend` | `coachboot-backend/Dockerfile` (`node:20-alpine`) | 4000 | `GET /api/health` |
| `frontend` | `coachboot/Dockerfile` (`nginx:alpine`) | 8080 | `GET /index.html` |

`db/schema.sql` est monté dans `/docker-entrypoint-initdb.d/` du conteneur PostgreSQL — Postgres
l'applique **automatiquement** au tout premier démarrage (volume de données vide), donc pas
d'étape manuelle de migration en Docker. Les seeds (`db/seed.js`, `db/seed-academy.js`) restent
volontairement une étape séparée et manuelle (ce sont des scripts Node, pas du `.sql`, et un seed
de démonstration ne doit jamais tourner automatiquement en production) :

```bash
docker compose exec backend npm run db:seed
docker compose exec backend node db/seed-academy.js
```

### Limite connue : le pipeline CoachBoot IA (ML) n'est pas dans l'image

`coachboot-backend/Dockerfile` n'installe **pas** Python — l'image reste volontairement légère.
Sans Python, `POST /api/ml/train` et `/api/ml/predict` répondent une erreur claire (pas un crash)
plutôt que d'échouer silencieusement. Pour l'activer en conteneur, étendre l'image avec
`apt-get install python3 python3-pip && pip install -r ml/requirements.txt`, puis définir
`PYTHON_BIN=python3` dans l'environnement du service `backend`.

## Checklist avant une vraie mise en production

```text
[ ] JWT_SECRET généré aléatoirement (ex. openssl rand -hex 32), jamais la valeur d'exemple
[ ] CORS_ORIGIN fixé à l'origine exacte du frontend déployé (jamais "*")
[ ] NODE_ENV=production (active les deux garde-fous JWT_SECRET/CORS_ORIGIN au démarrage)
[ ] Base PostgreSQL de production distincte de la base de développement/démo
[ ] ANTHROPIC_API_KEY renseignée si l'assistant IA doit fonctionner (sinon 503 propre, documenté)
[ ] HTTPS en amont (reverse proxy / plateforme d'hébergement) — non géré par ce code applicatif
[ ] docker compose up --build validé RÉELLEMENT (pas seulement lu) sur la cible de déploiement
[ ] npm test exécuté avec succès contre l'environnement cible avant bascule
[ ] Sauvegarde PostgreSQL planifiée (pg_dump régulier) — non automatisée dans ce projet
```

## Ce qui n'est PAS fourni par ce projet (à ajouter selon l'hébergeur choisi)

- Terminaison HTTPS / certificats (dépend de l'hébergeur — Render, Railway, Fly.io, VPS +
  Let's Encrypt...).
- Sauvegarde/restauration automatisée de PostgreSQL (`pg_dump` planifié, rétention) — la commande
  manuelle standard (`pg_dump coachboot > backup.sql`, `psql coachboot < backup.sql`) fonctionne
  mais n'est ni planifiée ni scriptée ici.
- CI/CD (pas de pipeline GitHub Actions/GitLab CI dans ce dépôt à ce jour).
- Monitoring applicatif (APM, alerting) — seuls les logs `morgan`/`console.error` existent
  actuellement (voir `docs/SECURITY.md` pour ce qui n'est jamais loggé).
