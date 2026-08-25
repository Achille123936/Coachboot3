# CoachBoot Enterprise — Package complet (Frontend + Backend)

Ce zip contient les deux moitiés du projet, testées ensemble de bout en bout :

```
coachboot/            Frontend statique (56 pages HTML/CSS/JS) — voir coachboot/docs/README.md
coachboot-backend/    API réelle Node.js + Express + PostgreSQL — voir coachboot-backend/README.md
```

## Démarrage en 5 commandes

```bash
cd coachboot-backend
npm install
cp .env.example .env          # PostgreSQL doit être installé et démarré localement
npm run db:migrate && npm run db:seed
npm start                     # → API sur http://localhost:4000
```

Puis, dans un autre terminal (ou simplement dans votre explorateur de fichiers) :
ouvrir `coachboot/index.html` → se connecter avec `carmie.boot@coachboot.app` / `CoachBoot2026!`.

Le frontend fonctionne aussi seul (sans backend), avec des données de démonstration —
voir `coachboot/docs/README.md` pour le détail complet des limites et de ce qui est réellement branché.
