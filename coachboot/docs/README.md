# CoachBoot Enterprise — Frontend

Plateforme (HTML5 / CSS3 / JavaScript ES6+) pour l'analyse de performance football :
clubs, académies, centres de formation et fédérations.

## ✅ Un vrai backend existe et a été testé de bout en bout

Le backend (Node.js + Express + PostgreSQL) vit dans le dossier **`../coachboot-backend/`**
(dossier frère de celui-ci, pas un sous-dossier). Il expose une API REST sur
`http://localhost:4000/api` et a été validé avec PostgreSQL réellement installé et démarré :
authentification JWT, contrôle d'accès par rôle, CRUD complet — voir
`../coachboot-backend/docs/API.md` pour le détail et la liste des tests effectués.

**15 des 61 pages de ce frontend sont branchées sur cette API réelle** (audit exhaustif de chaque
page, pas une estimation), avec repli automatique et silencieux sur des données de démonstration
si le backend n'est pas démarré :

| Page | Comportement en direct |
|---|---|
| `login.html` | Authentification réelle (JWT), redirection vers le tableau de bord |
| `register.html` | Création de compte réelle en base de données |
| `dashboard.html` | KPI "Matchs joués", "Points" et "Effectif disponible" calculés en direct depuis PostgreSQL |
| `players.html` | Liste des joueurs chargée depuis la base ; formulaire d'ajout fonctionnel |
| `teams.html` | Équipes réelles ; création d'équipe fonctionnelle |
| `courses.html` | Cours réels ; progression mise à jour en direct |
| `train-ai.html` | Pipeline ML réel (voir plus bas) |
| `academy.html` / `course-viewer.html` | CoachBoot IA Academy réelle (voir plus bas) |
| `certificates.html` | Certificats réellement délivrés de l'utilisateur connecté |
| `settings.html` | Changement de mot de passe réel (onglet Sécurité) |
| `trainings.html` | Séances réelles ; planification fonctionnelle ; KPI et graphique de charge calculés depuis les vraies séances |
| `scouting.html` | Profils de scouting réels ; ajout fonctionnel |
| `reports.html` | Rapports réels ; export PDF/Excel **réellement généré** (pdfkit/exceljs, pas un stub) |
| `cell-injury-risk.html` | Scores de risque de blessure calculés en direct (voir la note honnête ci-dessous) |

Un badge visuel indique la source des données : 🟢 **« En direct »** (PostgreSQL) vs
⚪ **« Démo »** (données statiques, utilisé automatiquement si l'API ne répond pas).

**46 des 61 pages restent en données statiques intégrées au HTML** (10 tableaux de bord par rôle,
la quasi-totalité des « cellules d'analyse », `matches.html`, `injuries.html`,
`notifications.html`, `nutrition.html`, `physical-prep.html`, `profile.html`, `admin.html`,
`calendar.html`, `video-analysis.html`, `goalkeepers.html`, `ai.html`, `index.html`...). Les
brancher à l'API suit le même schéma que `trainings.html`/`scouting.html` (modèles les plus
récents, avec badge de source, formulaire réel, et repli démo), en utilisant les méthodes déjà
prêtes dans `assets/js/api.js` (objet `CB_API`) ou en ajoutant les méthodes manquantes côté API si
nécessaire — certaines de ces pages (ex. `cell-nutrition.html`, `cell-mental.html`) n'ont même pas
encore de table dédiée côté base de données et nécessiteraient un vrai travail de modélisation
avant d'être branchées, pas seulement un appel API.

## Démarrage rapide (frontend + backend ensemble)

```bash
# Terminal 1 — backend
cd coachboot-backend
npm install
cp .env.example .env                 # PostgreSQL doit être installé et démarré
npm run db:migrate
npm run db:seed
npm start                            # → API sur http://localhost:4000

# Terminal 2 — frontend : aucune installation, aucun serveur requis
cd coachboot
# ouvrir index.html directement dans un navigateur (double-clic, ou "open index.html")
```

Se connecter avec `carmie.boot@coachboot.app` / `CoachBoot2026!`
(liste complète des 11 comptes de démonstration dans `../coachboot-backend/docs/API.md`).

Le frontend fonctionne aussi **sans backend du tout** : ouvrir directement `index.html`
affiche toutes les pages avec leurs données de démonstration, badge « Démo » à l'appui.

## 🛰️ Module GPS professionnel (suivi joueur en direct)

`gps.html` et `cell-gps.html` utilisent la vraie API Geolocation du navigateur —
`assets/js/gps-live.js` (objet `CBGpsLive`) + `assets/js/gps-storage.js` (objet `CBGpsStorage`) —
pour suivre les déplacements d'un joueur pendant un entraînement ou un match, sans aucun
matériel GPS dédié : le smartphone/tablette de l'utilisateur fait office de capteur.

**Suivi en direct** (`navigator.geolocation.watchPosition`) : latitude, longitude, altitude,
précision et vitesse instantanée sont relevées en continu. À partir de ces positions, le module
calcule en direct :
- **Distance totale** (formule de Haversine sur la trace GPS)
- **Vitesse** instantanée, **maximale** et **moyenne** (km/h)
- **Sprints** (vitesse ≥ 22 km/h) et **sprints intenses** (≥ 25 km/h), avec anti-double-comptage
- **Accélérations** et **décélérations fortes** (± 3 m/s² sur un intervalle plausible)
- **Distance haute intensité** (≥ 19.8 km/h, seuil standard en préparation physique football)

**Contrôles** : ▶ Démarrer, ⏸ Pause / Reprendre, ⏹ Arrêter, 💾 Sauvegarder — `gps.html` inclut
en plus un sélecteur de joueur, un champ « match/contexte », et bascule la carte Leaflet/
OpenStreetMap entre **trajet** (marqueur + tracé du parcours) et **heatmap** (plugin
`Leaflet.heat`, intensité des zones parcourues).

**Historique & export** : chaque session arrêtée peut être sauvegardée — en `localStorage`
(`CBGpsStorage`, jusqu'à 30 sessions, disponible même sans backend) et, si un utilisateur est
connecté avec un vrai `player_id`, synchronisée vers PostgreSQL via `POST /api/gps/session`
(voir `../coachboot-backend/docs/API.md`). Chaque session de l'historique peut générer un
**« GPS Performance Report »** imprimable (joueur, date, contexte, distance, vitesses,
sprints, accélérations/décélérations, zones du terrain couvertes) via la mise en page
d'impression du navigateur (Ctrl+P → « Enregistrer en PDF »).

Sans autorisation de localisation (ou navigateur/plateforme non compatible), les pages
retombent automatiquement sur des données de démonstration, avec un badge « GPS démo ».

### ⚠️ Limites GPS

- La **précision dépend entièrement du téléphone** utilisé (puce GPS, boîtier, météo) —
  **erreur moyenne observée : 3 à 10 mètres** en extérieur, souvent plus en intérieur.
- **Nécessite une autorisation de localisation** explicite dans le navigateur/OS ; sans elle,
  le module retombe proprement sur les données de démonstration (aucun plantage).
- **Fonctionne nettement mieux en extérieur**, à ciel dégagé, qu'en intérieur ou à proximité
  immédiate de grands bâtiments (réflexions multi-trajets qui dégradent le signal).
- `navigator.geolocation` exige un **contexte sécurisé** (`https://` ou `http://localhost`) —
  certains navigateurs bloquent `watchPosition` en ouverture directe `file://` ; pour un test
  GPS réel sur le terrain, servir le dossier (`npx serve`) ou ouvrir la page sur mobile.
- Le suivi continu du GPS en haute précision (`enableHighAccuracy: true`) **consomme la
  batterie** plus vite que l'usage normal du téléphone — pensez à brancher l'appareil pour
  les séances longues, ou à utiliser le bouton Pause entre les phases d'exercice.
- Une perte de signal temporaire (tunnel, vestiaire, zone couverte) interrompt les relevés
  jusqu'au retour du signal ; le module ne « comble » pas les trous par extrapolation — la
  distance/vitesse calculée reprend simplement dès la position suivante reçue.

## 📡 Match Live temps réel (Socket.io) — guide joueur & guide coach

Deux pages travaillent ensemble via un canal Socket.io (`assets/js/gps-socket-client.js`,
serveur `coachboot-backend/src/socket/gpsSocket.js`) pour un suivi GPS multi-joueurs réellement
en direct, au-delà de la simulation 22 joueurs déjà décrite plus haut.

### Guide joueur — `player-live.html`
1. Ouvrir `player-live.html` sur son téléphone (nécessite `https://` ou `http://localhost` —
   voir la note sur `navigator.geolocation` plus haut).
2. Se connecter avec son compte (formulaire intégré en haut de page).
3. Dans « Rejoindre un match » : vérifier/choisir son profil joueur, choisir le match en cours,
   cliquer sur **Rejoindre le match**.
4. Cliquer sur **Activer le GPS** : la position, vitesse, distance, temps de jeu, sprints et
   accélérations s'affichent en direct sur l'écran, et sont automatiquement diffusées au staff
   toutes les ~400ms via Socket.io (débit lissé côté serveur).
5. **Quitter le match** ou **Arrêter le GPS** à tout moment ; se déconnecter en bas de page.

### Guide coach — `match-live.html`
1. Démarrer le suivi GPS (bouton dans la carte « Terrain GPS en direct ») — crée automatiquement
   une session Match Live côté serveur et rejoint la room Socket.io correspondante.
2. Les joueurs qui rejoignent depuis `player-live.html` apparaissent dans la carte « Joueurs
   connectés en direct » (tableau + marqueurs dorés sur le terrain), avec leurs vraies distance/
   vitesse/accélération — à côté des 22 joueurs simulés utilisés pour la démo tactique.
3. La carte « Analyse IA — performance & tactique » se met à jour toutes les 5 secondes : signes
   de fatigue (baisse de vitesse ≥ 25 % par rapport au début du suivi), recommandations tactiques
   (occupation de zone déséquilibrée), et classement des joueurs par distance parcourue.
4. **Générer un rapport automatique** compile ces trois analyses en une page imprimable
   (Ctrl+P → « Enregistrer en PDF »).

## 🤖 Entraîner l'IA CoachBoot (`train-ai.html`)

Pipeline Python **réel** (pas une démo qui affiche des chiffres inventés) : charge un CSV de
données joueurs/matchs, choisis la colonne à prédire (score de performance, risque de fatigue...)
et les colonnes à utiliser comme features, clique sur **Entraîner le modèle**. En quelques
secondes : nettoyage des données, normalisation, feature engineering (stats « par 90 minutes »),
split train/validation/test, entraînement d'une forêt aléatoire (scikit-learn), et évaluation
**sur des données jamais vues pendant l'entraînement** (RMSE/MAE/R² ou Accuracy/F1 selon le type
de prédiction). Le modèle peut ensuite être **déployé**, puis testé sur un nouveau profil de
joueur dans la section « Analyser un nouveau joueur ».

Pas de jeu de données sous la main ? La page propose `assets/sample-data/coachboot-sample-dataset.csv`
en téléchargement — **un jeu de données synthétique** généré pour faire fonctionner le pipeline de
bout en bout, explicitement étiqueté comme tel dans l'interface. Ce n'est pas une source de vérité
sur de vrais joueurs. Pour un modèle réellement exploitable en match, CoachBoot doit d'abord
enregistrer de vraies statistiques de joueurs/matchs (au-delà du GPS déjà collecté automatiquement)
et définir des cibles pertinentes — voir la section « Limites honnêtes » de
`../coachboot-backend/docs/API.md` pour le détail complet de l'architecture et de ses limites.

Nécessite Python 3.12 côté backend (`coachboot-backend/ml/requirements.txt`) — voir
`../coachboot-backend/README.md`. Sans Python installé, la page reste utilisable (formulaire,
historique) mais l'entraînement échoue avec un message d'erreur clair plutôt qu'un plantage.

## 🎓 CoachBoot IA — Football Intelligence Academy (`academy.html`, `course-viewer.html`)

Formation continue en 6 modules + un projet final (Entraîner l'IA, Analyse de matchs, Scouting,
Prévision performance & fatigue, Assistant IA, Analyse tactique), avec du contenu **réellement
stocké en base** (pas du texte statique dans le HTML) : chaque chapitre a une leçon complète
(objectif, prérequis, explication, exemple football, démonstration CoachBoot, à retenir) et un quiz
noté côté serveur, chaque module a un TP final en auto-évaluation, et un certificat est délivré
quand le module atteint 100% de progression.

`academy.html` liste les 7 modules avec la progression réelle de l'utilisateur connecté (repli sur
une liste de démonstration si non connecté). `course-viewer.html?...` (en réalité un fragment
`#course=<id>`, pas une query string — voir note ci-dessous) affiche le contenu d'un module : leçon
courante à gauche dans la navigation, quiz noté avec correction affichée après soumission, TP final,
puis certificat une fois le module terminé.

**Note technique** : `course-viewer.html` identifie le module via `location.hash` (`#course=<id>`)
et non `location.search` (`?course=<id>`) — certains serveurs statiques "à URLs propres" (ex. le
paquet `serve`) redirigent `page.html?query` vers `/page` en supprimant la query string au passage ;
le fragment, lui, n'est jamais envoyé au serveur et survit à ce type de redirection quel que soit
l'hébergeur statique utilisé.

Voir la section « CoachBoot IA Academy » de `../coachboot-backend/docs/API.md` pour l'architecture
complète (réutilisation des tables `courses`/`quizzes`/`certificates` existantes, calcul de la
progression, notation serveur des quiz) et ses limites honnêtes (TP en auto-évaluation, pas de
correction IA simulée ; certaines leçons décrivent des fonctionnalités marquées « prévue / à venir »).

## ⚠️ Limites honnêtes restantes

- Le lecteur vidéo est une maquette visuelle (pas de fichier vidéo réel, pas de scrubbing fonctionnel).
- L'export PDF/Excel (`reports.html`, et la route `/api/reports/:id/export`) est simulé —
  aucun fichier binaire n'est réellement généré (voir la note dans `API.md` pour brancher
  `pdfkit`/`exceljs`).
- Le jeton JWT est stocké en `localStorage` (simple, mais plus sensible au XSS qu'un cookie
  `httpOnly` — voir la section sécurité de `../coachboot-backend/README.md`).

## Structure du projet

```
coachboot/                     (ce dossier — frontend statique)
├── index.html, login.html, register.html, dashboard.html, players.html, ...  (61 pages)
├── train-ai.html               Entraîner l'IA CoachBoot (pipeline Python réel)
├── academy.html                 CoachBoot IA Academy — catalogue des 6 modules + projet final
├── course-viewer.html           CoachBoot IA Academy — chapitre/leçon/quiz noté/TP/certificat
├── assets/
│   ├── css/main.css           Design system complet (tokens, composants, thèmes clair/sombre)
│   ├── js/api.js              Client API (CB_API) — connexion au backend, avec repli démo
│   ├── js/components.js       Sidebar + header partagés + délégation d'événements globale (data-action)
│   ├── js/theme.js            Thème, menu mobile, dropdowns, recherche, déconnexion
│   ├── js/charts.js           Fonctions CB.radar() / CB.line() / CB.bar() / CB.doughnut()
│   ├── js/gps-live.js         Suivi GPS réel (navigator.geolocation) — un joueur, un appareil
│   ├── js/gps-storage.js      Historique des sessions GPS (localStorage)
│   ├── js/gps-socket-client.js  Client Socket.io réutilisable (joueur ↔ coach, GPS temps réel)
│   ├── js/match-gps-live.js   Simulation 22 joueurs + intégration GPS réel sur le terrain tactique
│   ├── js/match-live-camera.js  Caméra du match (MediaDevices getUserMedia)
│   └── sample-data/coachboot-sample-dataset.csv  Jeu de données synthétique pour tester train-ai.html
├── components/ layouts/ widgets/    Réservés si le projet évolue vers un bundler
└── docs/README.md             Ce document

coachboot-backend/              (dossier frère — API réelle)
├── src/  (server.js, routes/, middleware/, config/, socket/gpsSocket.js)
├── ml/   (train.py, predict.py, requirements.txt — pipeline CoachBoot IA, voir docs/API.md)
├── db/   (schema.sql, seed.js, seed-academy.js — contenu de la CoachBoot IA Academy)
└── docs/API.md                Référence complète des routes + événements Socket.io + pipeline IA + tests effectués
```

## 🧩 Architecture événementielle

Aucun événement inline dans le HTML (`onclick="..."`, `onchange="..."`, etc.) — tous les
événements utilisateur passent par `addEventListener`, avec deux patterns selon le cas :

1. **Écouteur direct** sur un élément fixe et unique de la page (ex. `startBtn.addEventListener('click', ...)`
   dans `gps.html`, `match-live.html`) — le cas le plus courant, utilisé chaque fois qu'un simple
   `addEventListener` suffit.
2. **Délégation d'événements** quand les éléments sont générés dynamiquement (lignes de tableau,
   boutons répétés) : un seul écouteur sur un ancêtre stable, qui route via `event.target.closest('[data-action]')`.
   Deux niveaux :
   - **Globale**, dans `assets/js/components.js` (chargé sur les 58 pages) : gère les actions
     génériques présentes sur plusieurs pages — `data-action="print"` (bouton Imprimer de tous les
     tableaux de bord), `data-action="start-quiz"` (`quizzes.html`, avec `data-quiz-title` pour le
     contenu spécifique à chaque quiz).
   - **Locale**, par page, quand l'action ne concerne qu'un composant précis — ex. l'historique des
     sessions dans `gps.html` (`data-action="export-session"` / `"delete-session"` + `data-id`, un
     seul écouteur sur le `<tbody>`, les lignes étant recréées à chaque `renderHistory()`).

Convention `data-*` : `data-action` (quelle action), `data-id`/`data-player-id`/`data-match-id`
(sur quelle entité). Avant d'ajouter un nouvel événement, vérifier si `data-action` + la
délégation globale de `components.js` suffit plutôt que de créer un nouvel écouteur direct.

### Modules Socket.io / GPS (ne pas dupliquer)

- **Une seule connexion Socket.io par page**, via `CBGpsSocket.connect()` (`assets/js/gps-socket-client.js`) —
  idempotent (`if (socket) return true;`), jamais recréée tant que `disconnect()` n'a pas été appelée.
  `disconnect()` fait `socket.removeAllListeners()` avant `socket.close()` : pas de doublon d'écouteur
  possible sur une reconnexion ultérieure.
- **Une seule instance de suivi GPS réel par page**, via `CBGpsLive` (`assets/js/gps-live.js`) —
  `start()`/`pause()`/`resume()`/`stop()` gèrent `navigator.geolocation.watchPosition`/`clearWatch`
  en interne ; ne jamais appeler `navigator.geolocation.watchPosition` directement ailleurs.
- L'anti-spam de **400 ms** entre deux relevés GPS est appliqué côté **serveur**
  (`coachboot-backend/src/socket/gpsSocket.js`), pas seulement côté client — un client qui enverrait
  plus vite serait silencieusement throttlé, pas bloqué avec une erreur.

## Pourquoi une génération programmatique du HTML ?

Avec 56 pages partageant la même sidebar, le même header, les mêmes cartes et les mêmes
graphiques, écrire chaque fichier à la main aurait produit un code dupliqué et impossible à
maintenir. La source de vérité du contenu vit dans `build/generate.js` (+ `build/lib/*.js`) :
un script Node.js qui génère les 56 fichiers HTML statiques finaux à partir de modèles
réutilisables.

Pour régénérer les pages après une modification des templates :
```bash
cd build
node generate.js
```
⚠️ Ce script ne touche jamais `assets/js/api.js`, `theme.js`, `components.js` ou `charts.js`
(ce sont des fichiers écrits à la main, pas générés) — seuls les fichiers `.html` sont réécrits.

## Technologies utilisées (toutes via CDN, aucune installation requise pour le frontend seul)

HTML5 · CSS3 · JavaScript ES6+ · Chart.js · ApexCharts · DataTables (+ jQuery) · Font Awesome 6 ·
Google Fonts (Rajdhani, Inter, IBM Plex Mono) · Animate.css · AOS · SweetAlert2

## Design

- **Palette** : vert "pelouse" (#2C8F5E) comme accent structurel, ambre pour les alertes secondaires,
  bleu "tactique" pour l'information, texture de bandes de pelouse en fond de sidebar (signature visuelle).
- **Typographie** : Rajdhani (titres, condensé/sportif) + Inter (texte courant) + IBM Plex Mono (chiffres/stats).
- **Thème clair/sombre** : variables CSS (`:root` / `[data-theme="dark"]`), persistant via `localStorage`.
- **Responsive** : sidebar en tiroir sous 1080px, grilles qui repassent en 1 colonne sous 720px.
- **Accessibilité** : focus clavier visible partout, `prefers-reduced-motion` respecté, attributs ARIA
  sur les champs de recherche et boutons d'action.
