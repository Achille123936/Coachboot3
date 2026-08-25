// =============================================================================
// COACHBOOT IA — FOOTBALL INTELLIGENCE ACADEMY
// Contenu pédagogique réel (6 modules + projet final), inséré en plus des
// données de coachboot-backend/db/seed.js (lancer npm run db:seed d'abord —
// ce script a besoin des comptes de démonstration pour attribuer coachId).
//
// Additif et rejouable : ne touche qu'aux lignes `courses` marquées par un
// module_number (1-7), sans jamais toucher aux 6 cours génériques déjà
// insérés par seed.js ni aux autres données du club.
//
// Usage : node db/seed-academy.js
// =============================================================================
require('dotenv').config();
const pool = require('../src/config/db');

/** Un chapitre = un module_number + une position ; ses questions de quiz sont
 * notées côté serveur (voir src/routes/quizzes.routes.js, POST /:id/submit). */
const MODULES = [
  // ---------------------------------------------------------------------
  {
    title: `CoachBoot IA — Module 1 : Entraîner l\'IA Football`,
    level: 'Intermédiaire',
    duration_label: '3h',
    module_number: 1,
    objective: `Apprendre au coach comment une IA apprend réellement à partir des données football, en utilisant le pipeline d\'entraînement CoachBoot (train-ai.html).`,
    description: 'De la donnée brute au modèle entraîné : nettoyage, normalisation, feature engineering, entraînement RandomForest et évaluation sur des données jamais vues.',
    chapters: [
      {
        title: 'Introduction au Machine Learning',
        level: 'Débutant',
        objective: `Comprendre ce qu\'est le Machine Learning et le vocabulaire de base (dataset, features, target, train/validation/test).`,
        prerequisites: `Aucun — ce chapitre pose le vocabulaire utilisé dans tout le reste de l\'Academy.`,
        explanation: `Le Machine Learning (apprentissage automatique) est une branche de l'intelligence artificielle : au lieu d'écrire des règles fixes ("si distance > 10 km alors performant"), on montre à un algorithme de nombreux exemples passés, et il apprend lui-même la relation entre des données d'entrée (les <b>features</b>, ex. distance parcourue, passes réussies) et un résultat à prédire (la <b>target</b>, ex. un score de performance).

Un <b>dataset</b> est l'ensemble de ces exemples, organisé en lignes (un joueur, un match) et colonnes (les statistiques). Pour vérifier qu'un modèle a vraiment appris — et ne se contente pas de mémoriser — on sépare le dataset en trois parties : <b>train</b> (pour apprendre), <b>validation</b> (pour ajuster), <b>test</b> (jamais vu, pour évaluer honnêtement à la fin).

« IA » est un terme plus large : le Machine Learning en est une méthode parmi d'autres (à côté des systèmes à règles, ou des grands modèles de langage utilisés par l'Assistant IA CoachBoot — voir Module 5).`,
        football_example: `Un préparateur physique note, pendant 10 saisons, la distance parcourue, les sprints et le nombre de blessures de chaque joueur. Un modèle de Machine Learning peut apprendre, à partir de ces exemples passés, à repérer les profils de charge associés à un risque de blessure plus élevé — sans qu'on lui ait jamais dit la règle explicitement.`,
        coachboot_demo: 'Le schéma en haut de train-ai.html (Données CSV → Nettoyage → Normalisation → Feature engineering → Split → RandomForest → Évaluation → Modèle) est exactement ce pipeline, appliqué en direct.',
        key_takeaways: `Un modèle apprend depuis des exemples (dataset), pas depuis des règles écrites à la main. Feature = donnée d\'entrée. Target = ce qu\'on veut prédire. Le test set ne doit jamais avoir servi à l\'entraînement, sinon l\'évaluation est truquée.`,
        quiz: [
          { type: 'qcm', text: `Dans un dataset de joueurs, la colonne "performance_score" que l\'on cherche à prédire est appelée :`, choices: [['a', 'Une feature'], ['b', 'La target'], ['c', 'Le dataset'], ['d', 'Le split']], correct: 'b', explanation: 'La colonne à prédire est la "target" (cible) ; les colonnes utilisées pour prédire sont les "features".' },
          { type: 'vrai_faux', text: `Vrai ou faux : on peut évaluer un modèle sur les mêmes données que celles utilisées pour l\'entraîner.`, choices: [['vrai', 'Vrai'], ['faux', 'Faux']], correct: 'faux', explanation: `Évaluer sur les données d\'entraînement surestime la qualité du modèle — il faut un test set qu\'il n\'a jamais vu.` },
        ],
      },
      {
        title: 'Données Football',
        level: 'Débutant',
        objective: 'Connaître les statistiques football que CoachBoot IA peut utiliser comme features.',
        prerequisites: 'Chapitre 1.',
        explanation: `CoachBoot IA travaille avec les statistiques que les clubs collectent déjà, réellement : distance totale, vitesse moyenne, vitesse maximale, sprints, accélérations, décélérations, minutes jouées (GPS — voir Module GPS, collecté automatiquement par CoachBoot via gps.html et player-live.html), et les statistiques d'événements de match — passes, tirs, buts, assists, interceptions, duels, récupérations.

Toutes ces statistiques n'ont pas la même nature : certaines sont des <b>compteurs bruts</b> (nombre de sprints sur tout le match), d'autres sont des <b>mesures physiques continues</b> (vitesse maximale en km/h). Un joueur qui a joué 90 minutes aura mécaniquement plus de passes qu'un joueur entré à la 80e minute — d'où l'intérêt de les normaliser (voir Chapitre 3).

Un dataset d'entraînement combine typiquement plusieurs lignes (une par joueur et par match) et plusieurs colonnes (une par statistique), plus la colonne cible que l'on veut prédire.`,
        football_example: `Deux ailiers ont chacun fait 6 sprints sur un match. L\'un a joué 45 minutes, l\'autre 90. Comparés bruts, ils semblent avoir la même intensité de sprint — mais rapportés à 90 minutes, le premier en a fait deux fois plus. C\'est tout l\'enjeu du chapitre 3.`,
        coachboot_demo: `Le dataset d\'exemple téléchargeable depuis train-ai.html (coachboot-sample-dataset.csv) contient exactement ces colonnes : distance_totale, vitesse_moyenne, vitesse_max, sprints, accelerations, decelerations, minutes_jouees, passes, tirs, buts, assists, interceptions, duels, recuperations.`,
        key_takeaways: `CoachBoot IA n\'utilise que des statistiques réellement mesurables. Un compteur brut sans le temps de jeu associé peut être trompeur.`,
        quiz: [
          { type: 'cas_pratique', text: 'Un attaquant A (90 min) fait 4 tirs. Un attaquant B (45 min) fait 3 tirs. Qui a été le plus prolifique EN TIRS PAR 90 MINUTES ?', choices: [['a', 'Attaquant A (4 par 90 min)'], ['b', 'Attaquant B (6 par 90 min)'], ['c', 'Ils sont égaux'], ['d', 'Impossible à dire']], correct: 'b', explanation: 'B : 3 tirs en 45 min = 6 tirs ramenés à 90 min, contre 4 pour A. Le brut (4 vs 3) donnait la mauvaise impression.' },
          { type: 'qcm', text: 'Laquelle de ces statistiques est collectée automatiquement par CoachBoot via le GPS ?', choices: [['a', 'Le nombre de passes réussies'], ['b', 'La distance parcourue'], ['c', 'Le nombre de buts'], ['d', 'Le nombre de duels gagnés']], correct: 'b', explanation: `La distance, la vitesse et les sprints viennent du GPS (gps.html, player-live.html) ; passes/buts/duels sont des statistiques d\'événements de match, pas du GPS.` },
        ],
      },
      {
        title: 'Préparation des données',
        level: 'Intermédiaire',
        objective: `Comprendre le nettoyage, la normalisation et le feature engineering appliqués par CoachBoot avant l\'entraînement.`,
        prerequisites: 'Chapitres 1-2.',
        explanation: `Avant d'entraîner quoi que ce soit, les données brutes doivent être nettoyées : <b>valeurs manquantes</b> (un capteur GPS déconnecté une minute), <b>doublons</b> (la même ligne importée deux fois), <b>valeurs incohérentes</b> (un texte dans une colonne numérique). CoachBoot IA écarte automatiquement les lignes incomplètes ou dupliquées et l'affiche clairement après l'entraînement ("X ligne(s) écartée(s)").

La <b>normalisation</b> met toutes les features à la même échelle (ex. distance en km vs sprints en unités) avant de les comparer — sans ça, une colonne aux grandes valeurs dominerait artificiellement l'apprentissage. CoachBoot utilise un StandardScaler, calé uniquement sur les données d'entraînement (jamais sur le test set, pour ne pas "tricher").

Le <b>feature engineering</b> consiste à créer de nouvelles colonnes plus informatives. CoachBoot calcule automatiquement des statistiques « par 90 minutes » pour chaque statistique de comptage (sprints_par_90, passes_par_90...) quand la colonne minutes_jouees est présente — directement inspiré de l'exemple du Chapitre 2.`,
        football_example: `Un fichier CSV où la ligne d\'un gardien a "N/A" dans la colonne vitesse_max (capteur non porté) : cette ligne est écartée du calcul plutôt que de fausser silencieusement le modèle avec une valeur inventée.`,
        coachboot_demo: 'Dans train-ai.html, après un entraînement, la section « Détail du split » affiche explicitement le nombre de lignes écartées au nettoyage, et la liste des features inclut les versions « _par_90 » générées automatiquement.',
        key_takeaways: `Nettoyer avant d\'entraîner évite qu\'un modèle apprenne sur du bruit. Normaliser met les features sur un pied d\'égalité. Le feature engineering (ex. « par 90 minutes ») rend les comparaisons honnêtes.`,
        quiz: [
          { type: 'qcm', text: 'Pourquoi le StandardScaler de CoachBoot est-il calé UNIQUEMENT sur le train set ?', choices: [['a', 'Pour aller plus vite'], ['b', `Pour éviter que des informations du test set ne "fuient" dans l\'entraînement`], ['c', `Parce que le test set n\'a pas de features`], ['d', `Ce n\'est pas important`]], correct: 'b', explanation: `Caler le scaler sur tout le dataset ferait fuiter de l\'information du test set vers l\'entraînement, faussant l\'évaluation finale.` },
          { type: 'vrai_faux', text: `Vrai ou faux : CoachBoot invente une valeur plausible pour remplacer une donnée manquante plutôt que d\'écarter la ligne.`, choices: [['vrai', 'Vrai'], ['faux', 'Faux']], correct: 'faux', explanation: `CoachBoot écarte les lignes incomplètes (dropna) — il n\'invente jamais de valeur, par honnêteté envers les données.` },
        ],
      },
      {
        title: 'Entraînement',
        level: 'Intermédiaire',
        objective: 'Comprendre comment un RandomForest apprend, et les notions de régression, classification, et sur/sous-apprentissage.',
        prerequisites: 'Chapitre 3.',
        explanation: `CoachBoot IA utilise un <b>RandomForest</b> (forêt aléatoire) : des centaines de petits arbres de décision, chacun entraîné sur un sous-échantillon légèrement différent des données, dont on moyenne les prédictions. Ce choix privilégie la robustesse et l'interprétabilité (on peut lire l'importance de chaque feature) plutôt que la complexité maximale.

Deux types de prédiction : la <b>régression</b> prédit un nombre continu (ex. un score de performance sur 100), la <b>classification</b> prédit une catégorie (ex. « Faible / Modéré / Élevé » pour un risque de fatigue).

Le <b>train/test split</b> sépare les données pour évaluer honnêtement (voir Chapitre 1). La <b>cross-validation</b> (validation croisée) va plus loin : elle répète ce découpage plusieurs fois pour une estimation plus stable — CoachBoot utilise pour l'instant un split simple train/validation/test plutôt qu'une cross-validation complète (voir les limites en fin de module).

<b>Overfitting</b> (sur-apprentissage) : le modèle « récite » les données d'entraînement mais généralise mal (excellent score sur train, mauvais sur test). <b>Underfitting</b> (sous-apprentissage) : le modèle est trop simple pour capturer la relation, et se trompe même sur les données d'entraînement.`,
        football_example: `Un modèle qui prédit parfaitement la performance des 100 joueurs de son dataset d\'entraînement mais se trompe largement sur 10 nouveaux joueurs est en situation de surapprentissage — il a mémorisé, pas compris.`,
        coachboot_demo: 'Dans train-ai.html, le champ « Type de prédiction » choisit entre Régression et Classification ; la carte « Détail du split » montre le nombre exact de lignes en train/validation/test pour chaque entraînement.',
        key_takeaways: `RandomForest = de nombreux arbres qui votent ensemble. Régression = nombre ; classification = catégorie. Un bon score sur train et un mauvais score sur test est le signal classique d\'un surapprentissage.`,
        quiz: [
          { type: 'qcm', text: 'Prédire si un joueur est en risque de fatigue "Faible/Modéré/Élevé" est un problème de :', choices: [['a', 'Régression'], ['b', 'Classification'], ['c', 'Feature engineering'], ['d', 'Normalisation']], correct: 'b', explanation: 'Prédire une catégorie (parmi un ensemble fini) est de la classification ; prédire un nombre continu serait de la régression.' },
          { type: 'analyse', text: 'Un modèle obtient 98% de précision sur le train set et 54% sur le test set. Que se passe-t-il probablement ?', choices: [['a', 'Underfitting'], ['b', 'Overfitting'], ['c', 'Le modèle est parfait'], ['d', 'Les données sont normalisées']], correct: 'b', explanation: 'Un très grand écart entre score train et score test est le symptôme classique du surapprentissage (overfitting).' },
        ],
      },
      {
        title: 'Évaluation',
        level: 'Avancé',
        objective: `Savoir lire et interpréter RMSE, MAE, R², Accuracy, Precision, Recall, F1-score et l\'importance des features.`,
        prerequisites: 'Chapitre 4.',
        explanation: `Pour une <b>régression</b> : le <b>RMSE</b> (racine de l'erreur quadratique moyenne) et le <b>MAE</b> (erreur absolue moyenne) mesurent l'écart moyen entre prédiction et réalité, dans la même unité que la cible (ex. « en moyenne, ±6 points sur un score /100 ») — le RMSE pénalise plus fortement les grosses erreurs que le MAE. Le <b>R²</b> (entre 0 et 1) indique la part de variance expliquée par le modèle : 0,60 signifie que le modèle explique 60% des écarts de performance observés — le reste tient à des facteurs non capturés par les features choisies.

Pour une <b>classification</b> : l'<b>Accuracy</b> est le taux de bonnes réponses global — trompeur si les classes sont déséquilibrées (99% de joueurs "non fatigués" → un modèle qui répond toujours "non fatigué" aurait 99% d'accuracy sans rien apprendre). La <b>Precision</b> répond à « parmi les alertes fatigue déclenchées, combien étaient justifiées ? », le <b>Recall</b> à « parmi les vrais cas de fatigue, combien ont été détectés ? ». Le <b>F1-score</b> équilibre les deux.

La <b>Feature Importance</b> indique quelles colonnes ont le plus pesé dans les prédictions du modèle — utile pour comprendre le "pourquoi", pas seulement le "quoi".`,
        football_example: `Un modèle de risque de blessure avec un excellent Recall mais une Precision faible déclenche beaucoup de fausses alertes (staff dérangé pour rien) ; l\'inverse (Precision haute, Recall faible) laisse passer de vrais cas à risque sans alerter — le bon compromis dépend du coût de chaque erreur pour le club.`,
        coachboot_demo: 'train-ai.html affiche RMSE/MAE/R² (régression) ou Accuracy/F1 (classification) directement calculés sur le test set, plus un classement des features par importance — tout est réel, pas illustratif.',
        key_takeaways: `RMSE/MAE : erreur moyenne, dans l\'unité de la cible. R² proche de 1 = modèle qui explique bien la variance. En classification déséquilibrée, l\'Accuracy seule peut mentir — regarder Precision/Recall/F1.`,
        quiz: [
          { type: 'qcm', text: 'Un modèle a un R² de 0,60 sur le test set. Cela signifie :', choices: [['a', '60% des prédictions sont exactes au chiffre près'], ['b', 'Le modèle explique 60% de la variance de la cible'], ['c', `Le modèle s\'est trompé 60% du temps`], ['d', 'Le modèle a 60 features']], correct: 'b', explanation: `Le R² mesure la part de variance de la cible expliquée par le modèle, pas un taux d\'exactitude.` },
          { type: 'analyse', text: `Sur 100 joueurs réellement fatigués, un modèle n\'en détecte que 40. Quelle métrique est basse ?`, choices: [['a', 'Le Recall'], ['b', 'La Precision'], ['c', 'Le RMSE'], ['d', 'Le R²']], correct: 'a', explanation: 'Le Recall mesure la proportion de vrais cas positifs détectés — ici, seulement 40/100, donc un Recall faible.' },
        ],
      },
    ],
    finalExercise: {
      title: 'TP final — Entraîner un modèle CoachBoot',
      instructions: `Objectif : entraîner réellement un modèle sur train-ai.html.

1. Télécharge le dataset d'exemple (synthétique) depuis train-ai.html, ou utilise un vrai CSV si tu en as un.
2. Choisis une cible à prédire (ex. performance_score) et au moins 6 features pertinentes.
3. Lance l'entraînement et note le RMSE/MAE/R² (ou Accuracy/F1) obtenus sur le test set.
4. Identifie les 3 features les plus importantes selon le modèle — est-ce cohérent avec ton intuition de coach ?
5. Déploie le modèle et teste une prédiction sur un profil de joueur fictif que tu inventes toi-même.

Rends compte de tes résultats dans tes propres mots : le modèle est-il fiable selon toi ? Sur quoi te bases-tu pour le dire (regarde le R² / l\'Accuracy, pas seulement "ça a marché") ?`,
    },
  },

  // ---------------------------------------------------------------------
  {
    title: 'CoachBoot IA — Module 2 : Analyse intelligente des matchs',
    level: 'Intermédiaire',
    duration_label: '3h30',
    module_number: 2,
    objective: `Transformer les données brutes d\'un match (GPS, physique, événements) en informations exploitables par un coach.`,
    description: `Analyse individuelle, physique, GPS et collective d\'un match, jusqu\'à la génération d\'un rapport IA structuré.`,
    chapters: [
      {
        title: `Comprendre les données d\'un match`,
        level: 'Débutant',
        objective: 'Identifier les sources de données disponibles pendant et après un match CoachBoot.',
        prerequisites: 'Aucun.',
        explanation: `Un match génère plusieurs flux de données dans CoachBoot : le <b>GPS temps réel</b> (position, vitesse, distance — via player-live.html côté joueur, reçu en direct sur match-live.html côté coach par Socket.io), les <b>événements tagués</b> sur la timeline (sprint, tir, passe, interception, récupération), et — une fois le match terminé — l'historique consultable dans gps.html.

Toutes ces données n'ont pas la même fiabilité : le GPS est mesuré automatiquement en continu (haute fréquence, peu d'erreur humaine), tandis que les événements de match (tirs, passes...) nécessitent qu'un utilisateur les tague manuellement ou soient importés — leur qualité dépend de qui les a saisis et avec quel soin.

Avant d'analyser quoi que ce soit, un coach data-driven doit se demander : cette donnée vient-elle d'une mesure automatique fiable, ou d'une saisie manuelle potentiellement incomplète ?`,
        football_example: `La distance parcourue d\'un joueur (GPS) est fiable à quelques mètres près. Le nombre de "duels gagnés" tagué à la main pendant un match peut varier selon la rigueur de la personne qui observe — deux observateurs peuvent compter différemment.`,
        coachboot_demo: 'match-live.html centralise les deux : la carte « Joueurs connectés en direct » (GPS réel) et la carte « Timeline » (événements tagués, automatiques pour les sprints, manuels pour tir/passe/interception/récupération).',
        key_takeaways: `Distinguer données automatiques (GPS) et données saisies manuellement (événements). La qualité d\'une analyse dépend de la qualité de la donnée source.`,
        quiz: [
          { type: 'qcm', text: 'Laquelle de ces données est mesurée automatiquement, sans saisie humaine ?', choices: [['a', 'Le nombre de tirs tagué sur la timeline'], ['b', 'La distance parcourue via GPS'], ['c', 'Le nombre de duels gagnés'], ['d', 'Le poste tactique déclaré du joueur']], correct: 'b', explanation: 'Le GPS mesure position/vitesse/distance en continu et automatiquement ; les événements comme les tirs sont tagués manuellement.' },
        ],
      },
      {
        title: 'Analyse individuelle',
        level: 'Débutant',
        objective: `Lire le profil de performance d\'un joueur sur un match : distance, sprints, passes, tirs, buts...`,
        prerequisites: 'Chapitre 1.',
        explanation: `L'analyse individuelle croise les statistiques physiques (distance, vitesse, sprints, accélérations, décélérations, minutes jouées) et techniques/tactiques (passes, tirs, buts, assists, duels, interceptions, récupérations) d'<b>un seul joueur</b> sur un match donné.

Aucune de ces statistiques ne se lit isolément : 8 km parcourus par un gardien n'a pas le même sens que 8 km parcourus par un milieu de terrain (postes différents, exigences différentes). De même, un joueur avec peu de passes mais beaucoup d'interceptions peut avoir un profil défensif cohérent, pas un profil "moins bon".

L'objectif n'est pas de réduire un joueur à un chiffre, mais de construire un <b>profil multi-dimensionnel</b> qui aide le coach à poser les bonnes questions : ce joueur a-t-il physiquement tenu tout le match ? A-t-il été efficace dans son rôle précis ?`,
        football_example: `Un milieu défensif avec 9 récupérations et 6 interceptions mais seulement 1 tir n\'est pas "moins performant" qu\'un attaquant — il excelle simplement dans une autre dimension du jeu, cohérente avec son poste.`,
        coachboot_demo: 'La carte « Live GPS Performance » de match-live.html et le panneau « Live GPS Performance » de player-live.html affichent ce profil individuel en direct (distance, vitesse, sprints, zone, intensité).',
        key_takeaways: 'Toujours contextualiser une statistique par le poste du joueur. Un profil de joueur est multi-dimensionnel, pas un seul chiffre.',
        quiz: [
          { type: 'cas_pratique', text: 'Un défenseur central termine un match avec 5,8 km parcourus et 2 sprints seulement. Est-ce automatiquement un signe de faible performance ?', choices: [['a', 'Oui, il a été passif'], ['b', `Pas nécessairement — un défenseur central sprinte moins souvent qu\'un ailier par nature de poste`], ['c', 'Impossible à évaluer sans données'], ['d', 'Oui, tous les joueurs doivent sprinter autant']], correct: 'b', explanation: 'Le volume de sprints attendu dépend fortement du poste — comparer un central à un ailier sur ce critère seul serait trompeur.' },
        ],
      },
      {
        title: 'Analyse physique',
        level: 'Intermédiaire',
        objective: 'Identifier intensité, charge, baisse de performance et activité par période à partir des données GPS.',
        prerequisites: 'Chapitre 2.',
        explanation: `L'<b>intensité</b> se lit via la vitesse instantanée et le pourcentage de temps passé au-dessus des seuils de haute intensité (≥19,8 km/h) et de sprint (≥22 km/h). La <b>charge</b> combine volume (distance totale) et intensité (distance à haute vitesse) — deux joueurs à distance égale peuvent avoir une charge très différente si l'un a couru vite plus souvent.

Une <b>baisse de performance</b> se détecte en comparant la vitesse moyenne du début de match à celle de la fin — CoachBoot le calcule automatiquement dans le module « Analyse IA » de match-live.html (baisse ≥25% signalée comme fatigue possible). L'<b>activité par période</b> (mi-temps 1 vs mi-temps 2) permet de voir si un joueur a géré son effort ou s'est écroulé physiquement en seconde période.

Ces indicateurs sont des <b>signaux</b>, pas des diagnostics : une baisse de vitesse peut venir de la fatigue, mais aussi d'un choix tactique (jeu plus posé) ou d'une petite douleur non déclarée.`,
        football_example: `Un ailier qui maintient sa vitesse de pointe en 2e mi-temps mais réduit son nombre de sprints a probablement géré intelligemment son effort — nuance qu\'une lecture brute de la seule "distance totale" ne montrerait pas.`,
        coachboot_demo: 'La carte « Analyse IA — performance & tactique » de match-live.html calcule en direct la fatigue détectée (comparaison de vitesse début/fin de suivi) à partir de rosterHistory.',
        key_takeaways: 'Charge = volume × intensité, pas seulement la distance. Une fatigue détectée par les données est un signal à interpréter, pas un verdict automatique.',
        quiz: [
          { type: 'qcm', text: 'Selon quel critère CoachBoot signale-t-il une "fatigue détectée" dans match-live.html ?', choices: [['a', 'Une baisse de vitesse ≥25% entre le début et la fin du suivi'], ['b', 'Un nombre de buts inférieur à 1'], ['c', 'Une déclaration du joueur lui-même'], ['d', 'Le nombre total de minutes jouées uniquement']], correct: 'a', explanation: 'computeFatigue() dans match-live.html compare la vitesse moyenne des 10 premiers échantillons à celle des 10 derniers, et signale si la baisse dépasse 25%.' },
        ],
      },
      {
        title: 'Analyse GPS',
        level: 'Intermédiaire',
        objective: `Lire une trajectoire GPS, une carte de zones, et l\'occupation du terrain d\'un joueur.`,
        prerequisites: 'Chapitre 3.',
        explanation: `La <b>trajectoire</b> GPS d'un joueur, tracée en direct sur le terrain de match-live.html ou gps.html, révèle ses déplacements réels — souvent différents de sa position "de papier" (un latéral peut monter beaucoup plus haut que son poste théorique ne le suggère).

Les <b>zones</b> du terrain (défense/milieu/attaque × gauche/axe/droite) permettent de résumer où un joueur passe le plus de temps. La <b>heatmap</b> (carte de chaleur) visualise cette occupation par intensité de couleur — plus une zone est "chaude", plus le joueur y a passé de temps.

La <b>vitesse</b> et le <b>mouvement</b> combinés à la position donnent une lecture beaucoup plus riche qu'une simple heatmap statique : un joueur peut occuper une zone en marchant (récupération) ou en sprintant (pressing) — deux réalités tactiques opposées avec la même heatmap.`,
        football_example: `La heatmap d\'un milieu montre une forte présence dans l\'axe central — mais seule la donnée de vitesse révèle si cette présence est active (pressing, courses répétées) ou passive (positionnement statique).`,
        coachboot_demo: 'gps.html (bouton Heatmap) et match-live.html (bouton Heatmap sur le terrain) génèrent ces cartes de chaleur à partir des positions GPS réellement enregistrées, pas de données inventées.',
        key_takeaways: `La heatmap seule ne dit pas si l\'activité dans une zone était intense ou passive — toujours croiser avec la vitesse.`,
        quiz: [
          { type: 'vrai_faux', text: 'Vrai ou faux : une heatmap "chaude" dans une zone signifie toujours que le joueur y a sprinté.', choices: [['vrai', 'Vrai'], ['faux', 'Faux']], correct: 'faux', explanation: `Une heatmap mesure le TEMPS passé dans une zone, pas l\'intensité — un joueur peut y avoir simplement marché.` },
        ],
      },
      {
        title: 'Analyse collective',
        level: 'Avancé',
        objective: `Comparer joueurs, périodes et niveaux d\'intensité à l\'échelle de l\'équipe.`,
        prerequisites: 'Chapitres 1-4.',
        explanation: `L'analyse collective agrège les profils individuels : comparer la <b>1re période à la 2e</b> (l'équipe a-t-elle globalement baissé d'intensité ?), comparer l'<b>intensité entre deux équipes</b> (qui presse le plus ?), ou classer les <b>joueurs entre eux</b> sur une même statistique.

CoachBoot calcule automatiquement des recommandations tactiques à partir de ces agrégats : position moyenne d'une équipe sur le terrain (bloc haut/bas), concentration du jeu sur un couloir, écart d'intensité entre les deux équipes. Ce sont des <b>observations statistiques</b>, formulées par des règles simples (pas un modèle entraîné) — un coach reste indispensable pour les transformer en décision.

Comparer des joueurs entre eux nécessite la même prudence qu'en analyse individuelle : comparer un attaquant et un défenseur sur "le nombre de tirs" n'a pas de sens ; comparer deux joueurs du même poste est plus légitime.`,
        football_example: `Si l\'intensité moyenne de l\'équipe A (75%) est nettement supérieure à celle de l\'équipe B (58%) sur les 20 premières minutes, l\'équipe B pourrait subir un pressing intense — une observation utile à la mi-temps.`,
        coachboot_demo: 'La carte « Analyse IA — performance & tactique » de match-live.html calcule ces recommandations (computeTactical()) en direct à partir des positions et intensités de tous les joueurs suivis.',
        key_takeaways: `Comparer des joueurs n\'a de sens qu\'entre postes comparables. Les recommandations tactiques automatiques sont des observations statistiques, pas des décisions toutes faites.`,
        quiz: [
          { type: 'analyse', text: 'CoachBoot signale : "Équipe domicile repliée profondément". Sur quelle donnée cette observation se base-t-elle ?', choices: [['a', 'Le score du match'], ['b', `La position X moyenne des joueurs de l\'équipe domicile`], ['c', 'Le nombre de cartons jaunes'], ['d', 'La météo']], correct: 'b', explanation: `computeTactical() calcule la position X moyenne de l\'équipe ; si elle est très basse (<0,35), le bloc est jugé profondément replié.` },
        ],
      },
      {
        title: 'Générer un rapport IA',
        level: 'Avancé',
        objective: 'Produire et interpréter un rapport de match structuré (points forts, points faibles, recommandations).',
        prerequisites: 'Chapitres 1-5.',
        explanation: `Un bon rapport de match ne se contente pas d'un tableau de chiffres : il structure l'information en <b>points forts</b>, <b>points faibles</b>, <b>observations</b> et <b>recommandations</b> actionnables. C'est le même principe que la règle pédagogique centrale de CoachBoot IA : Donnée → Métrique → Observation → Analyse contextuelle → Décision du coach.

Un rapport généré automatiquement (comme celui de match-live.html) compile les analyses des chapitres précédents : fatigue détectée, recommandations tactiques, classement des joueurs par distance parcourue. Il reste un <b>point de départ pour la discussion du staff</b>, pas une conclusion à appliquer sans discussion.

Attention : l'export PDF/Excel avancé (mise en forme imprimée d'un rapport complet avec logo, graphiques...) reste un stub dans CoachBoot — le rapport généré aujourd'hui utilise l'impression du navigateur (Ctrl+P), fonctionnelle mais moins riche visuellement qu'un vrai PDF généré côté serveur.`,
        football_example: `Un rapport qui indique "Joueur X : baisse de vitesse de 30% en 2e mi-temps" est une observation. La décision de le remplacer à la 70e minute plutôt qu\'à la 60e reste celle du coach, informée par cette donnée mais pas dictée par elle.`,
        coachboot_demo: 'Le bouton « Générer un rapport automatique » de match-live.html (et gps.html) compile fatigue/tactique/comparaison en une page imprimable réelle (Ctrl+P → Enregistrer en PDF).',
        key_takeaways: `Un rapport IA structure l\'information, il ne remplace pas le jugement du staff. Toujours distinguer observation (ce que dit la donnée) et décision (ce que fait le coach).`,
        quiz: [
          { type: 'qcm', text: `Que fait exactement le bouton "Générer un rapport automatique" de match-live.html aujourd\'hui ?`, choices: [['a', 'Il génère un vrai fichier PDF côté serveur'], ['b', `Il compile les analyses à l\'écran et ouvre la fenêtre d\'impression du navigateur`], ['c', 'Il envoie un email au staff'], ['d', `Il n\'existe pas encore`]], correct: 'b', explanation: `C\'est une fonctionnalité réelle mais basée sur window.print() du navigateur, pas un générateur PDF serveur (celui-ci reste un stub — voir docs/API.md).` },
        ],
      },
    ],
    finalExercise: {
      title: 'TP final — Analyser un match complet',
      instructions: `1. Démarre une session sur match-live.html (suivi GPS en direct, simulation ou réel).
2. Laisse tourner le suivi au moins 30 secondes pour accumuler des données de fatigue/tactique.
3. Sélectionne 2 joueurs de postes différents et compare leurs profils (distance, vitesse, zone, intensité).
4. Lis la carte « Analyse IA » : y a-t-il une fatigue détectée ? Une recommandation tactique ?
5. Génère le rapport automatique et identifie, dans tes propres mots : 1 point fort, 1 point faible, 1 recommandation pour le prochain entraînement.`,
    },
  },

  // ---------------------------------------------------------------------
  {
    title: 'CoachBoot IA — Module 3 : Scouting intelligent',
    level: 'Intermédiaire',
    duration_label: '3h',
    module_number: 3,
    objective: `Utiliser les données pour améliorer l\'identification et la comparaison de profils de joueurs.`,
    description: 'Du profil joueur au rapport de scouting, en passant par le classement et la comparaison de plusieurs profils.',
    chapters: [
      {
        title: 'Introduction au scouting data-driven',
        level: 'Débutant',
        objective: `Comprendre ce qu\'apporte la donnée à un processus de scouting traditionnellement basé sur l\'observation.`,
        prerequisites: 'Aucun.',
        explanation: `Le scouting traditionnel repose sur l'œil de l'observateur : assister à des matchs, juger le geste technique, l'intelligence de jeu. Le scouting <b>data-driven</b> ne remplace pas cette observation — il l'<b>enrichit</b> avec des mesures objectives et comparables entre joueurs, clubs et championnats.

L'intérêt principal : la donnée permet de <b>présélectionner</b> des profils correspondant à des critères précis (ex. "milieux de 20-23 ans avec un fort volume de récupérations") avant d'investir du temps d'observation humaine sur les meilleurs candidats. Elle permet aussi de <b>documenter objectivement</b> une intuition de recruteur pour la partager au staff.

Ce que la donnée ne fait pas : elle ne voit ni la personnalité, ni l'intelligence tactique implicite, ni l'adaptabilité d'un joueur à un nouveau vestiaire — c'est pourquoi ce module insiste sur la complémentarité donnée + observation humaine, jamais l'un sans l'autre.`,
        football_example: `Un club cherche un latéral capable de couvrir beaucoup de terrain. La donnée GPS permet d\'identifier rapidement les 10 latéraux d\'un championnat avec le plus haut volume de sprints par match, avant d\'aller les observer en direct.`,
        coachboot_demo: 'scouting.html et cell-scouting.html présentent les profils de scouting déjà suivis par le club.',
        key_takeaways: `La donnée présélectionne et objective, elle ne remplace jamais l\'observation humaine du joueur.`,
        quiz: [
          { type: 'vrai_faux', text: `Vrai ou faux : le scouting data-driven doit remplacer entièrement l\'observation humaine.`, choices: [['vrai', 'Vrai'], ['faux', 'Faux']], correct: 'faux', explanation: `La donnée oriente et objective, mais ne capture pas la personnalité ou l\'intelligence tactique implicite d\'un joueur — l\'observation reste indispensable.` },
        ],
      },
      {
        title: 'Profil joueur',
        level: 'Débutant',
        objective: 'Construire un profil joueur sur les dimensions techniques, physiques et tactiques réellement mesurables.',
        prerequisites: 'Chapitre 1.',
        explanation: `Un profil joueur complet croise plusieurs dimensions <b>mesurables</b> : technique (passes réussies, tirs cadrés), physique (distance, vitesse, sprints — voir Modules 1-2), tactique (positionnement, zones d'activité — voir Module 6), et performance globale (score calculé, voir Module 1).

Règle importante de ce chapitre : <b>ne jamais inventer une caractéristique psychologique</b> (leadership, mental, "gagneur") à partir de données qui ne la mesurent pas. Un fort volume de sprints en fin de match peut suggérer une bonne condition physique — ce n'est pas une preuve de "mental de compétiteur", qui relève de l'observation humaine, d'entretiens, ou de mises en situation, pas de statistiques GPS.

Un profil honnête liste ce qui est mesuré, avec ses limites, plutôt que de combler les manques par des suppositions présentées comme des faits.`,
        football_example: `Un rapport qui affirme "ce joueur a un excellent mental" sur la seule base de sa distance parcourue commet une erreur d\'interprétation — la distance mesure l\'effort physique, pas un trait psychologique.`,
        coachboot_demo: `cell-comparison.html et players.html affichent les dimensions réellement mesurées (forme physique, poste, statut) d\'un joueur, sans inférer de traits non mesurés.`,
        key_takeaways: 'Un profil joueur ne doit contenir que des dimensions réellement mesurées. Ne jamais présenter une supposition psychologique comme une donnée.',
        quiz: [
          { type: 'cas_pratique', text: `Un joueur a le plus haut nombre de sprints de l\'équipe en fin de match. Quelle affirmation est correcte ?`, choices: [['a', '"Ce joueur a un mental de leader exceptionnel"'], ['b', `"Ce joueur a maintenu un haut niveau d\'intensité physique en fin de match"`], ['c', 'Les deux affirmations sont équivalentes'], ['d', 'On ne peut rien dire du tout'] ], correct: 'b', explanation: `Seule l\'affirmation physique est directement soutenue par la donnée ; le "mental" est une interprétation psychologique non mesurée par le GPS.` },
        ],
      },
      {
        title: 'Player Ranking',
        level: 'Intermédiaire',
        objective: 'Comprendre normalisation, pondération et calcul de score pour classer des joueurs.',
        prerequisites: 'Chapitre 2, notions de normalisation (Module 1, Chapitre 3).',
        explanation: `Classer des joueurs entre eux nécessite d'abord de <b>normaliser</b> chaque statistique (ex. ramener toutes les valeurs entre 0 et 1) pour pouvoir les combiner malgré des échelles très différentes (une distance en km n'a pas la même échelle qu'un nombre de buts).

Ensuite, une <b>pondération</b> assigne un poids à chaque critère selon son importance pour le poste recherché (ex. pour un attaquant : buts ×3, tirs ×2, distance ×1). Le <b>score</b> final est la somme pondérée des critères normalisés. Le <b>classement</b> trie simplement les joueurs par score décroissant.

Ce processus est transparent et auditable : contrairement à un score "boîte noire", chaque coach peut voir et ajuster les poids selon sa philosophie de jeu. C'est une méthode statistique simple (pas un modèle de Machine Learning entraîné) — voir Module 1 pour la différence avec un modèle prédictif entraîné sur des exemples.`,
        football_example: 'Pour recruter un pressing avant-centre, un club pondère fortement les interceptions et duels gagnés en zone haute plutôt que les passes — un joueur "moins créatif" mais très actif défensivement peut alors ressortir en tête du classement.',
        coachboot_demo: `Le module d\'entraînement de train-ai.html (Module 1) peut servir de base à un score de performance pondéré ; analytics.html présente les analyses de performance déjà disponibles.`,
        key_takeaways: 'Un classement dépend entièrement des poids choisis — changer les poids change le classement. Toujours documenter les critères utilisés.',
        quiz: [
          { type: 'qcm', text: 'Pourquoi faut-il normaliser les statistiques avant de calculer un score pondéré ?', choices: [['a', `Pour qu\'elles soient comparables malgré des échelles différentes`], ['b', 'Pour les rendre plus jolies visuellement'], ['c', `Ce n\'est pas nécessaire`], ['d', 'Pour réduire le nombre de joueurs']], correct: 'a', explanation: 'Sans normalisation, une statistique à grande échelle (distance en mètres) écraserait une statistique à petite échelle (buts) dans le score combiné.' },
        ],
      },
      {
        title: 'Comparaison',
        level: 'Intermédiaire',
        objective: 'Comparer plusieurs joueurs côte à côte sur les mêmes critères.',
        prerequisites: 'Chapitre 3.',
        explanation: `Comparer deux ou plusieurs joueurs consiste à afficher leurs statistiques côte à côte, sur les <b>mêmes critères</b> et si possible <b>normalisées par 90 minutes</b> (voir Module 1, Chapitre 2) pour rester équitable malgré des temps de jeu différents.

Une bonne comparaison distingue clairement les dimensions : ne pas mélanger sur un même graphique des statistiques physiques (vitesse) et techniques (passes) sans repère visuel, au risque de comparaisons trompeuses. Elle doit aussi préciser le <b>contexte</b> : même poste, même niveau de compétition si possible — comparer un joueur de championnat amateur à un joueur professionnel sur les mêmes chiffres bruts n'a pas de sens.

L'objectif d'une comparaison n'est pas de désigner un "meilleur" joueur dans l'absolu, mais d'éclairer un choix précis (lequel correspond le mieux à un besoin tactique donné).`,
        football_example: 'Comparer Joueur A (7 duels gagnés/match, championnat U19) et Joueur B (5 duels gagnés/match, championnat senior) nécessite de préciser le niveau de compétition — le chiffre brut de A est plus haut, mais dans un contexte moins exigeant.',
        coachboot_demo: 'cell-comparison.html est dédiée à cet usage : comparer plusieurs profils de joueurs sur les mêmes critères.',
        key_takeaways: 'Toujours comparer à niveau de compétition comparable. Une comparaison sert à éclairer un besoin précis, pas à désigner un "meilleur joueur" absolu.',
        quiz: [
          { type: 'vrai_faux', text: 'Vrai ou faux : comparer les statistiques brutes de deux joueurs de championnats de niveaux très différents donne une image fiable.', choices: [['vrai', 'Vrai'], ['faux', 'Faux']], correct: 'faux', explanation: 'Le niveau de compétition influence fortement les statistiques brutes — une comparaison sans ce contexte peut être trompeuse.' },
        ],
      },
      {
        title: 'Similarité',
        level: 'Avancé',
        objective: 'Comprendre le principe de "joueurs similaires" (KNN, distance, clustering) — et son état actuel dans CoachBoot.',
        prerequisites: 'Chapitres 3-4.',
        explanation: `L'idée de « trouver des joueurs similaires » repose sur des méthodes de Machine Learning non supervisé : le <b>KNN</b> (k plus proches voisins) mesure la <b>distance</b> mathématique entre les profils normalisés de deux joueurs (plus leurs statistiques se ressemblent, plus la distance est petite) pour retrouver les k joueurs les plus proches d'un profil de référence. Le <b>clustering</b> (ex. k-means) va plus loin en regroupant automatiquement l'ensemble d'un dataset en familles de profils similaires, sans référence de départ.

⚠️ <b>Fonctionnalité prévue / à venir</b> : CoachBoot ne propose pas encore de fonctionnalité « Find similar players » automatisée. Ce chapitre enseigne le principe conceptuel (comment ça fonctionnerait, sur quelles données) pour préparer son usage futur, mais aucune démonstration réelle n'existe aujourd'hui dans l'application — ne présente jamais cette fonctionnalité comme existante face à un club.

Le pipeline d'entraînement de train-ai.html (Module 1) pourrait techniquement servir de base à une future implémentation (mêmes données normalisées), mais le calcul de similarité lui-même reste à construire.`,
        football_example: 'Un club veut remplacer un latéral parti : avec du KNN, il rechercherait les 5 joueurs du marché dont le profil normalisé (distance, sprints, passes, duels) est mathématiquement le plus proche de celui du joueur parti.',
        coachboot_demo: 'Fonctionnalité prévue / à venir — non implémentée dans CoachBoot à ce jour.',
        key_takeaways: `KNN = distance entre profils normalisés. Clustering = regroupement automatique en familles. Cette fonctionnalité n\'existe pas encore dans CoachBoot — ne pas la présenter comme disponible.`,
        quiz: [
          { type: 'qcm', text: `La fonctionnalité "joueurs similaires" (KNN) est-elle disponible aujourd\'hui dans CoachBoot ?`, choices: [['a', 'Oui, dans cell-comparison.html'], ['b', 'Oui, dans train-ai.html'], ['c', `Non, c\'est une fonctionnalité prévue mais pas encore implémentée`], ['d', 'Oui, dans scouting.html']], correct: 'c', explanation: `Ce chapitre enseigne le principe pour préparer une future implémentation ; la fonctionnalité elle-même n\'existe pas encore dans l\'application.` },
        ],
      },
      {
        title: 'Scouting Report',
        level: 'Avancé',
        objective: 'Structurer un rapport de scouting professionnel et complet.',
        prerequisites: 'Chapitres 1-5.',
        explanation: `Un rapport de scouting professionnel suit une structure standard : <b>Player Profile</b> (identité, poste, âge, club), <b>Performance</b> (statistiques mesurées sur la période observée), <b>Strengths</b> / <b>Weaknesses</b> (points forts/faibles, appuyés sur la donnée ET l'observation), <b>Statistics</b> (le détail chiffré), <b>Comparison</b> (par rapport à des profils similaires ou au poste visé), <b>Recommendation</b> (avis argumenté, jamais une simple note chiffrée seule).

La qualité d'un rapport se juge à sa capacité à <b>justifier chaque affirmation</b> par une donnée ou une observation précise, plutôt qu'à afficher un jugement global non expliqué ("bon joueur", "à recruter"). Un bon rapport permet à quelqu'un qui n'a jamais vu le joueur de comprendre pourquoi il est recommandé — ou pas.`,
        football_example: `Un rapport qui conclut "Recommandation : recruter" sans détailler pourquoi (quel besoin tactique précis ce joueur comble, sur quelles données cette conclusion s\'appuie) est un rapport de scouting incomplet, même si le jugement final s\'avère juste.`,
        coachboot_demo: 'reports.html et cell-scouting.html présentent la structure de rapports déjà utilisée dans CoachBoot pour ce type de synthèse.',
        key_takeaways: `Chaque affirmation d\'un rapport de scouting doit être justifiée par une donnée ou une observation précise, jamais un jugement non expliqué.`,
        quiz: [
          { type: 'analyse', text: 'Laquelle de ces phrases est un bon exemple de section "Strengths" dans un rapport de scouting ?', choices: [['a', '"Bon joueur, à suivre."'], ['b', '"9,2 récupérations/90min en moyenne sur 8 matchs, supérieur à la moyenne du poste (6,1)."'], ['c', `"Semble motivé à l\'entraînement."`], ['d', '"Le club aimerait le recruter."']], correct: 'b', explanation: 'La bonne réponse cite une donnée précise et un point de comparaison — les autres sont des jugements non justifiés.' },
        ],
      },
    ],
    finalExercise: {
      title: 'TP final — Trouver et comparer des profils pour un poste',
      instructions: `1. Définis un besoin de recrutement précis (ex. "un milieu récupérateur, 18-23 ans, fort volume de duels").
2. À partir de players.html ou d\'un dataset CSV, identifie 3 joueurs correspondant à ce profil.
3. Compare-les sur au moins 5 critères pertinents pour le poste recherché (cell-comparison.html).
4. Rédige un mini rapport de scouting (structure du Chapitre 6) pour le profil que tu recommandes, en justifiant chaque affirmation par une donnée précise.`,
    },
  },

  // ---------------------------------------------------------------------
  {
    title: 'CoachBoot IA — Module 4 : Prévision performance & fatigue',
    level: 'Avancé',
    duration_label: '3h',
    module_number: 4,
    objective: `Utiliser l\'historique d\'un joueur pour anticiper des tendances de performance et de charge — sans jamais confondre cela avec un diagnostic médical.`,
    description: `De l\'historique joueur à la prédiction de performance et de risque de fatigue, avec un regard critique sur la fiabilité du modèle.`,
    chapters: [
      {
        title: 'Prediction',
        level: 'Intermédiaire',
        objective: `Comprendre ce qu\'est concrètement une prédiction en Machine Learning appliquée au football.`,
        prerequisites: 'Module 1 complet.',
        explanation: `Une prédiction en Machine Learning est une <b>estimation statistique</b>, calculée par un modèle entraîné sur des exemples passés (voir Module 1), appliquée à un nouveau cas jamais vu. Ce n'est ni une certitude, ni une boule de cristal : c'est une extrapolation basée sur des motifs observés dans les données d'entraînement.

Deux familles de prédictions utiles au coach : la <b>prédiction de performance</b> (un score continu — régression) et la <b>prédiction de risque</b> (une catégorie de risque — classification), toutes deux couvertes dans ce module à propos de la fatigue.

Une prédiction n'est fiable que dans la mesure où : (1) les données d'entraînement couvrent des situations comparables au nouveau cas, (2) le modèle a été honnêtement évalué sur un test set (Module 1, Chapitre 5), et (3) les features utilisées captent réellement les facteurs pertinents. Une prédiction hors de ce cadre est une extrapolation risquée.`,
        football_example: `Un modèle entraîné uniquement sur des attaquants sera peu fiable pour prédire la performance d\'un gardien — les données d\'entraînement ne couvrent pas ce profil.`,
        coachboot_demo: 'La section 4 « Analyser un nouveau joueur » de train-ai.html produit une vraie prédiction, calculée par le modèle déployé, pas un chiffre illustratif.',
        key_takeaways: `Une prédiction est une estimation statistique, pas une certitude. Elle n\'est fiable que si le nouveau cas ressemble aux données d\'entraînement.`,
        quiz: [
          { type: 'vrai_faux', text: 'Vrai ou faux : une prédiction de performance de CoachBoot IA est une certitude mathématique.', choices: [['vrai', 'Vrai'], ['faux', 'Faux']], correct: 'faux', explanation: `C\'est une estimation statistique avec une marge d\'erreur (voir Chapitre 5, incertitude) — jamais une certitude absolue.` },
        ],
      },
      {
        title: 'Historique joueur',
        level: 'Débutant',
        objective: 'Savoir quelles données historiques CoachBoot peut mobiliser pour une prédiction.',
        prerequisites: 'Aucun.',
        explanation: `Les prédictions de ce module s'appuient sur l'<b>historique</b> d'un joueur : ses entraînements et matchs passés (minutes jouées, distance, sprints, accélérations, décélérations — collectés automatiquement via gps.html et l'historique des sessions GPS). Plus cet historique est long et régulier, plus les tendances qui s'en dégagent sont solides.

Un historique <b>court ou irrégulier</b> (quelques sessions isolées, de longues coupures) limite fortement la fiabilité de toute prédiction — un modèle ne peut détecter une tendance de charge qui s'accumule sur plusieurs semaines s'il ne dispose que de deux points de données.

CoachBoot conserve cet historique dans gps_sessions (résumé par session) et l'historique consultable dans gps.html — c'est la matière première de ce module, à ne pas confondre avec un dataset externe CSV comme au Module 1.`,
        football_example: `Un joueur qui vient de revenir d\'une longue blessure n\'a pas d\'historique récent comparable — toute prédiction de charge/fatigue basée sur ses anciennes données d\'avant-blessure serait trompeuse.`,
        coachboot_demo: `L\'historique des sessions GPS est consultable et exportable (rapport imprimable) directement dans gps.html.`,
        key_takeaways: `Un historique court ou irrégulier limite fortement la fiabilité d\'une prédiction basée sur la tendance.`,
        quiz: [
          { type: 'qcm', text: `Où l\'historique des sessions GPS d\'un joueur est-il consultable dans CoachBoot ?`, choices: [['a', 'quizzes.html'], ['b', 'gps.html (historique des sessions)'], ['c', 'settings.html'], ['d', 'notifications.html']], correct: 'b', explanation: `gps.html conserve et affiche l\'historique des sessions GPS enregistrées, avec export de rapport.` },
        ],
      },
      {
        title: 'Performance Prediction',
        level: 'Avancé',
        objective: 'Construire et interpréter un modèle de prédiction de performance.',
        prerequisites: 'Module 1 complet, Chapitres 1-2 de ce module.',
        explanation: `Construire une prédiction de performance suit exactement le pipeline du Module 1 : rassembler un historique de matchs avec leurs statistiques (features) et un score de performance connu pour chacun (target), entraîner un modèle de régression, l'évaluer sur un test set, puis l'appliquer à un nouveau match ou profil.

La qualité de cette prédiction dépend directement de la qualité de la <b>target</b> utilisée à l'entraînement : si le "score de performance" historique a été noté de façon incohérente (différents observateurs, différents critères), le modèle apprendra ce bruit plutôt qu'un vrai signal. Définir une méthode de notation cohérente et documentée est un préalable indispensable, pas un détail.

Rappel : CoachBoot ne dispose pas encore d\'un historique de "scores de performance" collectés automatiquement pour tous les joueurs — ce chapitre s\'appuie sur le pipeline générique de train-ai.html, à utiliser avec un dataset (réel ou synthétique clairement identifié) fourni par l\'apprenant.`,
        football_example: `Un club qui a noté la performance de ses joueurs de façon subjective et incohérente sur 3 saisons obtiendra un modèle de prédiction peu fiable — même avec un excellent algorithme, la target bruitée limite la qualité de l\'apprentissage.`,
        coachboot_demo: 'train-ai.html, en choisissant "performance_score" (ou une cible équivalente de ton propre dataset) comme cible en régression.',
        key_takeaways: `La qualité d\'une prédiction de performance dépend autant de la target (comment le score a été défini) que de l\'algorithme utilisé.`,
        quiz: [
          { type: 'analyse', text: `Un club a noté la performance de ses joueurs différemment selon l\'observateur, sans grille commune. Quel est le principal risque pour un futur modèle de prédiction ?`, choices: [['a', 'Aucun risque, le modèle corrigera automatiquement'], ['b', `Le modèle apprendra le bruit de la notation incohérente plutôt qu\'un vrai signal de performance`], ['c', 'Le modèle sera plus rapide à entraîner'], ['d', `Cela n\'affecte que le RMSE, pas le R²`]], correct: 'b', explanation: `Une target bruitée/incohérente limite fondamentalement ce qu\'un modèle peut apprendre, quel que soit l\'algorithme.` },
        ],
      },
      {
        title: 'Fatigue Risk',
        level: 'Avancé',
        objective: 'Construire une classification de risque de fatigue, en comprenant précisément ses limites.',
        prerequisites: 'Chapitres 1-3.',
        explanation: `Un modèle de risque de fatigue analyse l'évolution de la <b>charge</b> (distance, intensité), sa <b>variation</b> dans le temps (pic soudain après une période calme = facteur de risque connu en préparation physique), les <b>minutes jouées</b> récentes, et l'<b>historique</b> de charge sur plusieurs semaines pour classer un joueur en catégorie de risque (ex. Faible/Modéré/Élevé).

<div style="border-left:3px solid var(--danger, #C6414B);padding-left:12px;margin:12px 0;"><b>⚠️ IMPORTANT — à retenir avant toute chose :</b><br>Le <b>Fatigue Risk n'est PAS un diagnostic médical</b>. C'est un indicateur statistique basé sur des données de charge externe (GPS), qui ne mesure ni l'état physiologique interne du joueur (fréquence cardiaque, marqueurs sanguins, sommeil), ni une douleur ou blessure existante. Un score "Élevé" doit déclencher une <b>discussion avec le staff médical</b>, jamais une décision automatique (repos forcé, retrait) sans évaluation humaine et médicale.</div>

Ce garde-fou n'est pas une formule légale décorative : historiquement, la confusion entre indicateur statistique et diagnostic médical est une source réelle d'erreurs de gestion de charge dans le sport professionnel.`,
        football_example: 'Un joueur classé "Fatigue Risk : Élevé" après un pic soudain de sprints peut simplement avoir eu un match exceptionnel tactiquement exigeant — le staff médical doit évaluer la situation réelle avant toute décision, le modèle ne fait que signaler un pattern statistique à vérifier.',
        coachboot_demo: `train-ai.html permet d\'entraîner un modèle de classification sur une cible "fatigue_risk" (voir le dataset d\'exemple) ; cell-injury-risk.html présente une analyse de risque de blessure liée.`,
        key_takeaways: 'Fatigue Risk = indicateur statistique de charge externe, PAS un diagnostic médical. Toute alerte doit passer par une évaluation humaine et médicale avant décision.',
        quiz: [
          { type: 'qcm', text: 'Que doit faire un coach face à un "Fatigue Risk : Élevé" signalé par CoachBoot IA ?', choices: [['a', 'Retirer immédiatement le joueur sans discussion'], ['b', `Ignorer l\'alerte, ce n\'est jamais fiable`], ['c', 'En discuter avec le staff médical avant toute décision'], ['d', 'Publier le score au joueur sans contexte']], correct: 'c', explanation: 'Un score de risque statistique doit toujours déclencher une évaluation humaine et médicale, jamais une décision automatique.' },
          { type: 'vrai_faux', text: 'Vrai ou faux : le Fatigue Risk calculé par CoachBoot IA est équivalent à un diagnostic médical.', choices: [['vrai', 'Vrai'], ['faux', 'Faux']], correct: 'faux', explanation: `C\'est un indicateur statistique basé sur la charge externe GPS — explicitement pas un diagnostic médical.` },
        ],
      },
      {
        title: 'Évaluation',
        level: 'Avancé',
        objective: `Évaluer de façon critique la fiabilité d\'un modèle de prédiction : erreurs, incertitude, qualité des données.`,
        prerequisites: 'Module 1 Chapitre 5, Chapitres 1-4 de ce module.',
        explanation: `Avant de faire confiance à une prédiction, un coach data-driven doit se poser trois questions. D'abord, les <b>erreurs</b> : quel est le RMSE/MAE (régression) ou l'Accuracy/F1 (classification) du modèle sur le test set (Module 1, Chapitre 5) ? Un modèle avec un R² de 0,30 est nettement moins fiable qu'un modèle à 0,80.

Ensuite, l'<b>incertitude</b> : CoachBoot IA calcule, pour chaque prédiction de régression, un écart-type dérivé de la dispersion des arbres du RandomForest (affiché comme "± X" à côté du résultat) — une prédiction avec une forte incertitude doit être traitée avec beaucoup plus de prudence qu'une prédiction stable.

Enfin, la <b>qualité des données</b> sources : un modèle entraîné sur 20 lignes de données peu fiables restera peu fiable quels que soient ses métriques apparentes — toujours vérifier le nombre de lignes utilisées et la méthode de collecte avant de faire confiance à un résultat.`,
        football_example: `Une prédiction de performance de "72 ± 3" est bien plus exploitable qu\'une prédiction de "72 ± 18" — la seconde a une incertitude si large qu\'elle n\'apporte presque aucune information utile à la décision.`,
        coachboot_demo: `Le résultat d\'une prédiction de régression dans train-ai.html affiche explicitement "± X (incertitude estimée sur les arbres de la forêt)".`,
        key_takeaways: `Toujours regarder l\'incertitude affichée à côté d\'une prédiction, pas seulement le chiffre central. La fiabilité d\'un modèle dépend de ses métriques ET de la qualité des données sources.`,
        quiz: [
          { type: 'analyse', text: 'Un modèle prédit "Performance = 80 ± 22". Que doit faire le coach ?', choices: [['a', 'Traiter cette prédiction comme précise et agir immédiatement'], ['b', `Considérer la forte incertitude et rester prudent dans l\'interprétation`], ['c', `Ignorer complètement la métrique d\'incertitude`], ['d', 'Réentraîner automatiquement sans vérifier les données']], correct: 'b', explanation: 'Une incertitude de ±22 sur une échelle de 100 est très large — la prédiction doit être interprétée avec prudence, pas comme un chiffre exact.' },
        ],
      },
    ],
    finalExercise: {
      title: 'TP final — Prédire performance ou risque de fatigue',
      instructions: `1. Choisis un historique de données (le dataset d\'exemple synthétique, ou tes propres données réelles clairement identifiées comme telles).
2. Entraîne un modèle de régression (performance_score) OU de classification (fatigue_risk) sur train-ai.html.
3. Note le R²/Accuracy obtenu — le modèle est-il assez fiable pour être utile (à toi de juger, en expliquant pourquoi) ?
4. Teste une prédiction sur un profil de joueur et note l\'incertitude affichée.
5. Rédige 3 phrases expliquant comment tu présenterais ce résultat à ton staff, en respectant explicitement la règle "Fatigue Risk ≠ diagnostic médical" si applicable.`,
    },
  },

  // ---------------------------------------------------------------------
  {
    title: 'CoachBoot IA — Module 5 : Assistant IA Coach',
    level: 'Débutant',
    duration_label: '2h',
    module_number: 5,
    objective: `Utiliser efficacement l\'assistant conversationnel de CoachBoot connecté aux données réelles du club.`,
    description: `Poser de bonnes questions, comprendre comment l\'assistant récupère les données, et repérer une hallucination.`,
    chapters: [
      {
        title: 'AI Assistant',
        level: 'Débutant',
        objective: `Découvrir l\'assistant IA CoachBoot et son fonctionnement réel.`,
        prerequisites: 'Aucun.',
        explanation: `CoachBoot intègre un assistant conversationnel réel (pas une simulation), accessible depuis la bulle flottante présente sur toutes les pages de l'application. Il s'appuie sur un modèle de langage (Claude, via l'API Anthropic) et reçoit, à chaque conversation, un <b>instantané réel</b> du club : effectif disponible, blessures actives, prochain match programmé — directement depuis la base de données PostgreSQL de CoachBoot.

Ce n'est ni un moteur de recherche, ni une base de règles fixes : c'est un modèle de langage qui génère une réponse en langage naturel, informée par ce contexte. Il peut discuter, expliquer, résumer — mais il ne "sait" que ce qui lui a été fourni dans le contexte, plus ses connaissances générales sur le football.`,
        football_example: `Demander à l\'assistant "Combien de joueurs sont disponibles ?" fonctionne bien : cette donnée précise fait partie du contexte injecté à chaque conversation. Demander "Quel temps fera-t-il samedi ?" ne fonctionnera pas — cette donnée n\'existe pas dans CoachBoot.`,
        coachboot_demo: `La bulle « Assistant CoachBoot » (icône robot) en bas à droite de n\'importe quelle page connectée — voir assets/js/components.js, mountAiChat().`,
        key_takeaways: `L\'assistant est un vrai modèle de langage connecté à un contexte réel du club, pas une simulation ni une base de règles.`,
        quiz: [
          { type: 'vrai_faux', text: `Vrai ou faux : l\'assistant IA de CoachBoot est une simulation qui affiche des réponses pré-écrites.`, choices: [['vrai', 'Vrai'], ['faux', 'Faux']], correct: 'faux', explanation: `C\'est un vrai appel à un modèle de langage (Claude/Anthropic), avec un contexte réel injecté depuis la base de données du club.` },
        ],
      },
      {
        title: 'Poser de bonnes questions',
        level: 'Débutant',
        objective: `Formuler des questions précises et exploitables par l\'assistant.`,
        prerequisites: 'Chapitre 1.',
        explanation: `La qualité d'une réponse dépend directement de la précision de la question. Des questions comme <i>« Quel joueur a parcouru le plus de distance ? »</i>, <i>« Qui a eu la meilleure performance ? »</i>, <i>« Quels joueurs ont diminué d'intensité ? »</i>, <i>« Compare Player A et Player B »</i> ou <i>« Quels joueurs ont une charge élevée ? »</i> sont utiles <b>si les données correspondantes existent dans le contexte fourni à l'assistant</b> — sinon, il doit honnêtement dire qu'il ne dispose pas de cette information plutôt que d'inventer une réponse (voir Chapitre 5).

Une bonne pratique : préciser le <b>contexte temporel</b> ("sur le dernier match", "cette semaine") et le <b>périmètre</b> ("dans l'équipe A") plutôt que des questions trop vagues, qui laissent l'assistant deviner ce qu'on attend.`,
        football_example: `Plutôt que "Comment va l\'équipe ?" (vague), préférer "Combien de joueurs sont indisponibles actuellement et pourquoi ?" — une question précise, sur une donnée que l\'assistant reçoit réellement.`,
        coachboot_demo: 'Teste ces formulations directement dans la bulle Assistant CoachBoot présente sur dashboard.html.',
        key_takeaways: `Une question précise et contextualisée obtient une réponse plus fiable qu\'une question vague.`,
        quiz: [
          { type: 'qcm', text: `Laquelle de ces questions est la mieux formulée pour l\'assistant CoachBoot ?`, choices: [['a', '"Comment ça va ?"'], ['b', '"Combien de joueurs sont disponibles pour le prochain match ?"'], ['c', `"Dis-moi quelque chose d\'intéressant"`], ['d', '"Quel temps fera-t-il ?"']], correct: 'b', explanation: `C\'est une question précise, sur une donnée réellement présente dans le contexte injecté à l\'assistant (effectif disponible, prochain match).` },
        ],
      },
      {
        title: 'Data Retrieval',
        level: 'Intermédiaire',
        objective: 'Comprendre le principe général Question → Intent → Database → Statistics → IA → Answer, et son état actuel dans CoachBoot.',
        prerequisites: 'Chapitres 1-2.',
        explanation: `Le principe général d'un assistant IA connecté à des données suit ce schéma : <b>Question</b> (ce que l'utilisateur demande) → <b>Intent</b> (quelle information est réellement recherchée) → <b>Database</b> (interroger la base pour la retrouver) → <b>Statistics</b> (calculer/agréger si besoin) → <b>IA</b> (formuler une réponse en langage naturel) → <b>Answer</b>.

État réel dans CoachBoot aujourd'hui : l'assistant reçoit un <b>contexte fixe</b>, calculé une fois par conversation (effectif disponible, blessures actives, prochain match — voir src/routes/assistant.routes.js) — il ne réinterroge pas dynamiquement la base pour chaque question spécifique posée. C'est une version simplifiée et honnête du schéma ci-dessus, pas encore un moteur de requêtes dynamiques complet capable de répondre à n'importe quelle question statistique précise (ex. "qui a le plus d'interceptions sur les 3 derniers matchs" nécessiterait une requête dynamique non encore implémentée).

Cette distinction est importante à enseigner : comprendre la théorie générale, et savoir précisément ce que l'implémentation actuelle sait faire ou non.`,
        football_example: `Demander "combien de joueurs disponibles" fonctionne (dans le contexte fixe). Demander "quel joueur a le plus d\'interceptions sur les 3 derniers matchs" dépasse le contexte actuellement fourni — l\'assistant devrait honnêtement indiquer qu\'il ne dispose pas de cette donnée précise plutôt que d\'inventer un nom.`,
        coachboot_demo: 'src/routes/assistant.routes.js (backend) montre exactement quelles 3 statistiques sont injectées dans le contexte à chaque conversation.',
        key_takeaways: `Le schéma Question→Intent→DB→Stats→IA→Answer est le principe général. CoachBoot utilise aujourd\'hui un contexte fixe et simple, pas encore un moteur de requêtes dynamiques par intention.`,
        quiz: [
          { type: 'qcm', text: `Aujourd\'hui, comment l\'assistant CoachBoot obtient-il ses données de contexte ?`, choices: [['a', 'Il génère une requête SQL différente pour chaque question posée'], ['b', 'Un contexte fixe (effectif, blessures, prochain match) est calculé une fois par conversation'], ['c', `Il n\'a accès à aucune donnée`], ['d', `Il appelle l\'API GPS en temps réel`]], correct: 'b', explanation: 'Voir assistant.routes.js : trois requêtes fixes sont exécutées et injectées dans le system prompt, pas une interprétation dynamique de chaque question.' },
        ],
      },
      {
        title: 'Interprétation',
        level: 'Intermédiaire',
        objective: `Distinguer donnée, métrique, observation, hypothèse et recommandation dans une réponse de l\'assistant.`,
        prerequisites: 'Chapitre 3.',
        explanation: `Bien utiliser une réponse d'assistant IA suppose de distinguer cinq niveaux : la <b>donnée</b> (un fait brut, ex. "6 joueurs disponibles sur 8"), la <b>métrique</b> (un calcul dérivé, ex. "75% d'effectif disponible"), l'<b>observation</b> (un constat neutre, ex. "l'effectif est réduit cette semaine"), l'<b>hypothèse</b> (une explication possible mais non prouvée, ex. "peut-être lié à un calendrier chargé"), et la <b>recommandation</b> (une suggestion d'action, ex. "envisager une rotation").

Plus on avance dans cette liste, plus la part d'interprétation augmente et plus la responsabilité du coach doit s'exercer. Une bonne pratique de lecture : accepter directement la donnée et la métrique (si la source est fiable), mais toujours challenger l'hypothèse et la recommandation avec son propre jugement de terrain.`,
        football_example: '"6/8 disponibles" = donnée. "75% de disponibilité" = métrique. "Effectif réduit" = observation. "Peut-être une fatigue de fin de saison" = hypothèse, à vérifier. "Envisager de faire souffler un titulaire" = recommandation, à décider par le coach.',
        coachboot_demo: `Observe ce mélange dans les réponses de l\'assistant sur dashboard.html — repère laquelle des 5 catégories correspond à chaque phrase de sa réponse.`,
        key_takeaways: `Plus une affirmation s\'éloigne de la donnée brute, plus elle doit être challengée par le jugement humain avant d\'être suivie.`,
        quiz: [
          { type: 'analyse', text: `L\'assistant répond : "Envisagez de faire tourner votre effectif ce week-end." À quel niveau appartient cette phrase ?`, choices: [['a', 'Une donnée'], ['b', 'Une métrique'], ['c', 'Une recommandation'], ['d', 'Un fait vérifié']], correct: 'c', explanation: `C\'est une suggestion d\'action — une recommandation, la catégorie qui doit être le plus challengée par le jugement du coach.` },
        ],
      },
      {
        title: 'Anti-hallucination',
        level: 'Avancé',
        objective: `Repérer et éviter les hallucinations d\'un assistant IA — l\'IA ne doit jamais inventer une donnée absente.`,
        prerequisites: 'Chapitres 1-4.',
        explanation: `Une <b>hallucination</b> est une affirmation formulée avec assurance par un modèle de langage, mais fausse ou inventée — un risque connu de tous les grands modèles de langage, pas spécifique à CoachBoot. La règle d'or : <b>l'IA ne doit jamais inventer une donnée absente</b>. Le system prompt de l'assistant CoachBoot l'instruit explicitement en ce sens : "Si une information précise n'est pas dans le contexte fourni, dis-le clairement plutôt que d'inventer un chiffre."

Un coach doit rester vigilant : si l'assistant donne un chiffre très précis sur une donnée qu'il ne devrait pas avoir (ex. "Joueur X a couru exactement 11,3 km mardi dernier" alors que cette donnée n'a jamais été mentionnée dans la conversation ni dans le contexte connu), c'est un signal d'alerte à vérifier auprès de la source réelle (gps.html) plutôt qu'à prendre pour argent comptant.

Ce chapitre applique au football la même règle d'honnêteté que celle suivie dans toute la documentation de CoachBoot : ne jamais présenter une donnée inventée comme réelle.`,
        football_example: `Si l\'assistant affirme "Joueur X a un risque de blessure de 82%" sans qu\'aucun modèle de prédiction n\'ait été exécuté pour ce joueur, c\'est une hallucination — ce chiffre n\'existe nulle part dans CoachBoot et doit être ignoré, pas suivi.`,
        coachboot_demo: `Le system prompt réel de l\'assistant (src/routes/assistant.routes.js) contient explicitement cette consigne anti-hallucination.`,
        key_takeaways: `Toujours vérifier un chiffre précis et inattendu donné par l\'assistant auprès de sa source réelle (les pages CoachBoot concernées) avant de le considérer comme fiable.`,
        quiz: [
          { type: 'cas_pratique', text: `L\'assistant te donne un chiffre GPS très précis pour un match que tu n\'as jamais mentionné et qui n\'existe pas dans CoachBoot. Que fais-tu ?`, choices: [['a', `Je le note et l\'utilise directement dans mon rapport`], ['b', `Je considère que c\'est probablement une hallucination et je vérifie la source réelle (gps.html)`], ['c', 'Je le transmets au staff sans vérification'], ['d', `J\'ignore toute réponse de l\'assistant à partir de maintenant`]], correct: 'b', explanation: `Un chiffre précis sur une donnée qui ne peut pas exister dans le contexte de l\'assistant doit être traité comme une hallucination probable et vérifié à la source.` },
        ],
      },
    ],
    finalExercise: {
      title: `TP final — Analyser un match avec l\'assistant`,
      instructions: `1. Ouvre l\'assistant CoachBoot depuis n\'importe quelle page connectée.
2. Pose au moins 5 questions différentes sur l\'effectif, les blessures, ou le prochain match.
3. Pour chaque réponse, identifie si elle contient : une donnée, une métrique, une observation, une hypothèse, une recommandation.
4. Pose volontairement une question sur une donnée que tu sais absente du contexte (ex. une statistique GPS précise d\'un match) — l\'assistant admet-il honnêtement ne pas savoir, ou semble-t-il "halluciner" une réponse ? Documente ce que tu observes.`,
    },
  },

  // ---------------------------------------------------------------------
  {
    title: 'CoachBoot IA — Module 6 : Analyse tactique IA',
    level: 'Avancé',
    duration_label: '3h',
    module_number: 6,
    objective: `Introduire l\'analyse spatiale et tactique basée sur les données de position, avec prudence sur ce que les données permettent réellement d\'affirmer.`,
    description: `Positionnement, occupation de l\'espace, transitions et formations — jusqu\'au rapport tactique complet.`,
    chapters: [
      {
        title: `Introduction à l\'analyse tactique`,
        level: 'Débutant',
        objective: `Comprendre ce que l\'analyse de données peut et ne peut pas dire sur la tactique.`,
        prerequisites: 'Module 2 recommandé.',
        explanation: `L'analyse tactique basée sur les données part des <b>positions</b> (x, y) des joueurs sur le terrain, mesurées dans le temps. À partir de ces positions seules, on peut calculer des faits objectifs : où un joueur ou une équipe passe le plus de temps, comment le groupe occupe l'espace, quelle est la distance moyenne entre lignes.

Ce qu'on ne peut PAS déduire uniquement des positions : les intentions tactiques du coach, les consignes données à la mi-temps, ou une lecture fine de la qualité technique d'une action — ces éléments nécessitent le regard d'un analyste humain en complément de la donnée.

Ce module suit une règle stricte, reprise à plusieurs reprises : ne jamais affirmer automatiquement une conclusion tactique (comme une formation précise) si les données ne permettent pas réellement de la déterminer avec confiance.`,
        football_example: `Les positions GPS peuvent montrer qu\'une équipe défend très bas (bloc reculé) — un fait mesurable. Elles ne peuvent pas dire si c\'est un choix tactique délibéré du coach ou une conséquence subie du pressing adverse — cela nécessite un visionnage vidéo ou l\'avis du staff.`,
        coachboot_demo: 'cell-tactical.html présente les analyses tactiques déjà disponibles dans CoachBoot.',
        key_takeaways: 'Les données de position racontent le "où" et le "quand", jamais directement le "pourquoi" tactique — qui reste une interprétation humaine.',
        quiz: [
          { type: 'vrai_faux', text: 'Vrai ou faux : les données de position GPS suffisent à elles seules pour connaître les intentions tactiques exactes du coach adverse.', choices: [['vrai', 'Vrai'], ['faux', 'Faux']], correct: 'faux', explanation: 'Les positions montrent des faits mesurables (où, quand) mais pas les intentions — qui nécessitent un visionnage/une analyse humaine.' },
        ],
      },
      {
        title: 'Positionnement',
        level: 'Intermédiaire',
        objective: 'Lire les positions, distances et déplacements des joueurs sur le terrain.',
        prerequisites: 'Chapitre 1.',
        explanation: `Chaque position enregistrée est une coordonnée (x, y) normalisée sur le terrain, horodatée. En les reliant dans le temps, on obtient un <b>déplacement</b> — la trajectoire déjà vue au Module 2. En comparant les positions de plusieurs joueurs au même instant, on peut calculer des <b>distances</b> entre eux (compacité de l'équipe, écartement entre lignes).

CoachBoot affiche ces positions en direct sur un terrain SVG normalisé (105m × 68m, dimensions standard d'un terrain de football) — chaque joueur y est représenté par un point coloré par équipe, avec son numéro. Les joueurs réellement suivis (via player-live.html) apparaissent avec un marqueur distinct de la simulation tactique de démonstration.`,
        football_example: `Si la distance moyenne entre la ligne défensive et la ligne offensive d\'une équipe est très grande, l\'équipe joue "étirée" — plus vulnérable aux transitions rapides dans l\'espace laissé entre les lignes.`,
        coachboot_demo: `Le terrain SVG de match-live.html (carte « Terrain GPS en direct ») affiche ces positions en temps réel, à l\'échelle réelle d\'un terrain de football.`,
        key_takeaways: `Une position seule dit peu ; c\'est la comparaison entre plusieurs positions (distances, alignements) qui révèle une information tactique.`,
        quiz: [
          { type: 'qcm', text: 'Sur quelles dimensions de terrain le module tactique de match-live.html est-il calibré ?', choices: [['a', '100m × 60m'], ['b', '105m × 68m (dimensions standard FIFA)'], ['c', '90m × 45m'], ['d', 'Aucune dimension fixe']], correct: 'b', explanation: `Le terrain SVG utilise PITCH_L=105 et PITCH_W=68, les dimensions standard d\'un terrain de football.` },
        ],
      },
      {
        title: `Occupation de l\'espace`,
        level: 'Intermédiaire',
        objective: `Analyser largeur, profondeur, densité et zones d\'activité d\'une équipe.`,
        prerequisites: 'Chapitre 2.',
        explanation: `La <b>largeur</b> occupée par une équipe se mesure par l'écart entre le joueur le plus à gauche et le plus à droite à un instant donné ; la <b>profondeur</b>, par l'écart entre le joueur le plus reculé et le plus avancé. Une équipe "large" étire la défense adverse ; une équipe "compacte" (faible largeur et profondeur) est plus difficile à percer entre les lignes mais plus prévisible.

La <b>densité</b> et les <b>zones d'activité</b> se lisent via la heatmap déjà vue au Module 2 — mais appliquée ici à l'échelle collective plutôt qu'individuelle : quelles zones du terrain l'équipe occupe-t-elle le plus, dans son ensemble ?

Ces indicateurs se calculent objectivement à partir des positions, sans jugement de valeur intrinsèque : "compact" n'est ni bon ni mauvais en soi, cela dépend du plan de jeu du coach.`,
        football_example: `Une équipe très compacte (faible largeur et profondeur) en phase défensive, qui s\'étire fortement en transition offensive, montre une organisation tactique cohérente entre phases — une lecture que la seule heatmap globale du match ne révélerait pas.`,
        coachboot_demo: `Le mode Heatmap du terrain dans match-live.html accumule l\'occupation collective de zone en temps réel, à partir des positions réellement suivies.`,
        key_takeaways: 'Largeur/profondeur/densité sont des mesures neutres — leur interprétation ("bon" ou "mauvais") dépend toujours du plan de jeu voulu par le coach.',
        quiz: [
          { type: 'vrai_faux', text: `Vrai ou faux : une équipe "compacte" (faible largeur/profondeur) est toujours moins performante qu\'une équipe "large".`, choices: [['vrai', 'Vrai'], ['faux', 'Faux']], correct: 'faux', explanation: 'Compacité et largeur ne sont ni bonnes ni mauvaises en soi — leur pertinence dépend entièrement du plan de jeu voulu.' },
        ],
      },
      {
        title: 'Transitions',
        level: 'Avancé',
        objective: 'Identifier quand les données permettent réellement de détecter une transition offensive/défensive.',
        prerequisites: 'Chapitres 1-3.',
        explanation: `Une <b>transition</b> (offensive : passage de la récupération du ballon à l'attaque rapide ; défensive : passage de la perte du ballon au repli) se caractérise, dans les données, par un changement brusque de direction collective et une hausse soudaine de vitesse/sprints chez plusieurs joueurs simultanément.

Détecter une transition avec confiance nécessite de croiser <b>plusieurs signaux en même temps</b> (vitesse, direction, position du ballon si disponible, événement de récupération/perte tagué) — un seul signal isolé (ex. juste un sprint) ne suffit pas à distinguer une transition d'un pressing individuel ou d'une simple course de récupération de position.

CoachBoot ne propose pas encore de détection automatique de transitions ; ce chapitre enseigne les critères à surveiller manuellement (croisement vitesse + événement + position) en attendant une éventuelle implémentation future — marquée <b>Fonctionnalité prévue / à venir</b>.`,
        football_example: `Trois joueurs qui sprintent simultanément vers l\'avant juste après un événement "récupération" tagué sur la timeline sont un signal cohérent de transition offensive — un sprint isolé, sans cet événement associé, ne l\'est pas.`,
        coachboot_demo: `Fonctionnalité prévue / à venir pour la détection automatique — les événements « sprint » et « récupération » tagués sur la timeline de match-live.html en sont les briques de base disponibles aujourd\'hui.`,
        key_takeaways: `Une transition se lit par le croisement de plusieurs signaux simultanés, jamais un seul isolé. La détection automatique n\'existe pas encore dans CoachBoot.`,
        quiz: [
          { type: 'analyse', text: `Un seul joueur sprinte sur le terrain, sans événement associé. Peut-on affirmer avec confiance qu\'il s\'agit d\'une transition d\'équipe ?`, choices: [['a', 'Oui, un sprint suffit toujours'], ['b', `Non, il faut croiser plusieurs signaux simultanés pour l\'affirmer`], ['c', 'Oui, si le joueur est un attaquant'], ['d', 'Cela dépend du score du match']], correct: 'b', explanation: `Un seul sprint isolé peut avoir de nombreuses causes ; une transition d\'équipe nécessite un croisement de signaux collectifs et temporels.` },
        ],
      },
      {
        title: 'Formations',
        level: 'Avancé',
        objective: 'Comprendre pourquoi une formation ne doit jamais être affirmée automatiquement sans données suffisantes.',
        prerequisites: 'Chapitres 1-4.',
        explanation: `Reconnaître une formation (4-3-3, 4-4-2, 3-5-2, 4-2-3-1...) à partir des positions moyennes des joueurs est théoriquement possible (regrouper les joueurs par lignes selon leur position moyenne en phase défensive), mais c'est un exercice <b>fragile</b> : les formations modernes sont fluides, changent selon la phase de jeu (différente en attaque et en défense), et deux formations différentes peuvent produire des positions moyennes très proches sur un échantillon court.

Règle stricte de ce chapitre, à respecter systématiquement : <b>ne jamais affirmer automatiquement une formation si les données ne permettent pas de la déterminer avec une confiance suffisante</b>. Une estimation incertaine doit être présentée comme telle ("possible 4-3-3, à confirmer visuellement"), jamais comme un fait établi.

CoachBoot ne propose pas de détection automatique de formation à ce jour ; ce chapitre prépare à l'usage critique d'une telle fonctionnalité si elle est développée à l'avenir.`,
        football_example: `Sur les 5 premières minutes d\'un match, les positions moyennes peuvent suggérer un 4-4-2 alors que l\'équipe joue en réalité un 4-2-3-1 avec un repli défensif marqué de ses ailiers — l\'échantillon est trop court et la phase trop spécifique pour conclure.`,
        coachboot_demo: `Fonctionnalité prévue / à venir — non implémentée. cell-tactical.html présente aujourd\'hui les informations tactiques disponibles sans détection automatique de formation.`,
        key_takeaways: 'Une formation détectée automatiquement doit toujours être présentée avec un niveau de confiance, jamais comme un fait certain sans vérification humaine.',
        quiz: [
          { type: 'qcm', text: `Que doit faire un outil d\'analyse s\'il n\'est pas certain de la formation d\'une équipe à partir des données ?`, choices: [['a', 'Afficher quand même une formation précise pour paraître utile'], ['b', `Ne pas l\'affirmer automatiquement, ou indiquer clairement l\'incertitude`], ['c', 'Choisir la formation la plus courante par défaut'], ['d', 'Demander au public de voter']], correct: 'b', explanation: 'La règle du chapitre est explicite : ne jamais affirmer automatiquement une formation si les données ne le permettent pas avec confiance.' },
        ],
      },
      {
        title: 'Tactical Report',
        level: 'Avancé',
        objective: 'Structurer un rapport tactique complet à partir des chapitres précédents.',
        prerequisites: 'Chapitres 1-5.',
        explanation: `Un rapport tactique complet suit une structure standard : <b>Team Structure</b> (organisation générale observée), <b>Spatial Analysis</b> (largeur/profondeur/densité, Chapitre 3), <b>Player Positioning</b> (positions individuelles clés, Chapitre 2), <b>Transitions</b> (si détectables avec confiance, Chapitre 4), <b>Strengths</b> / <b>Weaknesses</b>, et <b>Recommendations</b> pour le prochain match ou entraînement.

Comme pour le rapport de match (Module 2) et le rapport de scouting (Module 3), chaque section doit distinguer clairement ce qui est <b>mesuré</b> (position moyenne, distance entre lignes) de ce qui est <b>interprété</b> (ex. "l'équipe cherche à étirer le bloc adverse") — et signaler explicitement toute incertitude, en particulier sur la formation (Chapitre 5).`,
        football_example: 'Un rapport tactique qui écrit "Formation observée : probablement 4-3-3 en phase défensive (confiance modérée, à confirmer en vidéo)" respecte la rigueur enseignée dans ce module — contrairement à un rapport qui affirmerait la formation sans nuance.',
        coachboot_demo: `reports.html et cell-tactical.html présentent la structure de rapport déjà utilisée par CoachBoot pour ce type d\'analyse.`,
        key_takeaways: `Un bon rapport tactique distingue toujours le mesuré de l\'interprété, et signale explicitement ses incertitudes plutôt que de les masquer.`,
        quiz: [
          { type: 'analyse', text: 'Laquelle de ces phrases respecte le mieux la rigueur enseignée dans ce module ?', choices: [['a', `"L\'équipe joue en 4-3-3."`], ['b', '"Les positions moyennes suggèrent un bloc compact, cohérent avec un 4-4-2 ou 4-2-3-1 (à confirmer en vidéo)."'], ['c', `"L\'équipe est mal organisée."`], ['d', '"Formation inconnue, aucune information."']], correct: 'b', explanation: `Cette phrase distingue le mesuré (positions moyennes, compacité) de l\'interprété (hypothèses de formation) et signale explicitement l\'incertitude.` },
        ],
      },
    ],
    finalExercise: {
      title: 'TP final — Produire un rapport tactique',
      instructions: `1. Démarre une session sur match-live.html et laisse le suivi GPS tourner au moins 1 minute.
2. Observe le mode Heatmap du terrain : décris la largeur, la profondeur et les zones d\'activité de chaque équipe.
3. Sans affirmer de formation certaine, propose une hypothèse de formation pour chaque équipe avec ton niveau de confiance.
4. Rédige un mini rapport tactique suivant la structure du Chapitre 6 (Team Structure, Spatial Analysis, Positioning, Strengths, Weaknesses, Recommendations).`,
    },
  },
];

/** Projet final — combine les 6 modules, ajouté comme un 7e "module" virtuel. */
const FINAL_PROJECT = {
  title: 'CoachBoot IA — Projet Final : Football Intelligence Academy',
  level: 'Avancé',
  duration_label: '4h',
  module_number: 7,
  objective: `Mobiliser les 6 modules sur un cas complet : d\'un jeu de données jusqu\'à un rapport final structuré.`,
  description: `Le projet de fin de parcours de la CoachBoot IA Football Intelligence Academy — data, analyse joueur, analyse de match, scouting, prédiction, assistant IA et analyse tactique, jusqu\'au rapport final.`,
  chapters: [
    {
      title: 'Projet final CoachBoot IA',
      level: 'Avancé',
      objective: 'Réaliser un projet complet couvrant les 7 étapes : Data → Player Analysis → Match Analysis → Scouting → Performance Prediction → AI Coach → Tactical Analysis → Final Report.',
      prerequisites: 'Modules 1 à 6 complétés.',
      explanation: `Ce projet final réunit toutes les compétences de l'Academy sur un seul cas d'usage, en suivant la chaîne complète : <b>Data</b> (rassembler un jeu de données, réel ou synthétique clairement identifié) → <b>Player Analysis</b> (Module 2) → <b>Match Analysis</b> (Module 2) → <b>Scouting</b> (Module 3) → <b>Performance Prediction</b> (Module 4) → <b>AI Coach</b> (Module 5) → <b>Tactical Analysis</b> (Module 6) → <b>Final Report</b>, qui synthétise l'ensemble.

Ce projet est évalué selon une grille explicite (voir le TP final ci-dessous) portant sur la qualité de l'analyse, la compréhension des données, l'interprétation, l'usage de l'IA, la qualité des recommandations, et — point essentiel rappelé à travers toute l'Academy — le <b>respect des limites des données</b> (ne jamais affirmer plus que ce que les données permettent réellement de dire).

La règle pédagogique centrale de CoachBoot IA s'applique ici pleinement : Donnée → Métrique → Observation → Analyse contextuelle → Décision du coach. L'IA reste un outil d'aide à la décision, jamais un remplacement du jugement du staff technique.`,
      football_example: `Un projet final réussi ne se contente pas d\'un score de performance calculé : il explique comment ce score a été obtenu, avec quelle fiabilité (R²/incertitude), et ce que le staff devrait concrètement en faire — la boucle complète Donnée → Décision.`,
      coachboot_demo: `Toutes les pages de CoachBoot utilisées à travers les 6 modules : train-ai.html, match-live.html, gps.html, scouting.html, cell-comparison.html, l\'Assistant IA, cell-tactical.html, reports.html.`,
      key_takeaways: 'Le projet final applique la chaîne complète Collecter → Comprendre → Analyser → Entraîner → Prédire → Interpréter → Décider, avec un respect explicite des limites de chaque donnée utilisée.',
      quiz: [
        { type: 'qcm', text: 'Quelle est la dernière étape de la chaîne du projet final CoachBoot IA ?', choices: [['a', 'Data'], ['b', 'Scouting'], ['c', 'Final Report'], ['d', 'AI Coach']], correct: 'c', explanation: 'La chaîne se termine par le Final Report, qui synthétise toutes les étapes précédentes.' },
      ],
    },
  ],
  finalExercise: {
    title: 'PROJET FINAL — Football Intelligence Academy',
    isFinalProject: true,
    instructions: `On te fournit (ou tu choisis) un dataset/match. Réalise, dans l'ordre :

1. **DATA** — présente le jeu de données utilisé (réel ou synthétique, clairement identifié) et sa qualité (lignes, colonnes, lacunes éventuelles).
2. **PLAYER ANALYSIS** — analyse individuelle d'au moins 2 joueurs (Module 2, Ch. 2-3).
3. **MATCH ANALYSIS** — analyse collective du match (Module 2, Ch. 5-6).
4. **SCOUTING** — identifie et compare 2-3 profils pour un poste donné (Module 3).
5. **PERFORMANCE PREDICTION** — entraîne un modèle et prédis une performance ou un risque de fatigue, avec son incertitude (Module 4).
6. **AI COACH** — utilise l'assistant pour au moins 3 questions pertinentes, en repérant toute hallucination potentielle (Module 5).
7. **TACTICAL ANALYSIS** — analyse spatiale, avec prudence sur les formations (Module 6).
8. **FINAL REPORT** — synthétise tout ce qui précède en un rapport structuré, avec points forts, points faibles et recommandations.

### Grille d'évaluation
- Qualité de l'analyse (données correctement lues et contextualisées)
- Compréhension des données (features vs target, fiabilité, limites)
- Interprétation (distinction donnée/métrique/observation/hypothèse/recommandation)
- Utilisation de l'IA (pipeline d'entraînement, assistant, utilisés à bon escient)
- Qualité des recommandations (actionnables, justifiées par la donnée)
- Respect des limites des données (aucune affirmation non soutenue par les données — formations, diagnostics médicaux, traits psychologiques non mesurés)`,
  },
};

async function seedAcademy() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [coach] } = await client.query(`SELECT id FROM users WHERE email = 'carmie.boot@coachboot.app'`);
    if (!coach) {
      throw new Error(`Comptes de démonstration introuvables — lancez d\'abord "npm run db:seed" dans coachboot-backend/.`);
    }
    const coachId = coach.id;

    console.log('→ Nettoyage du contenu CoachBoot IA Academy existant (rejouable sans toucher au reste du club)...');
    await client.query(`DELETE FROM courses WHERE module_number IS NOT NULL`);

    const allModules = [...MODULES, FINAL_PROJECT];

    for (const mod of allModules) {
      console.log(`→ Module ${mod.module_number} : ${mod.title}`);
      const { rows: [courseRow] } = await client.query(
        `INSERT INTO courses (title, level, duration_label, description, objective, module_number)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [mod.title, mod.level, mod.duration_label, mod.description, mod.objective, mod.module_number]
      );
      const courseId = courseRow.id;
      const lessonIdsByPosition = [];

      let chapterPosition = 0;
      for (const chapter of mod.chapters) {
        chapterPosition += 1;
        const { rows: [chapterRow] } = await client.query(
          `INSERT INTO course_chapters (course_id, position, title, objective) VALUES ($1,$2,$3,$4) RETURNING id`,
          [courseId, chapterPosition, chapter.title, chapter.objective]
        );
        const chapterId = chapterRow.id;

        const { rows: [lessonRow] } = await client.query(
          `INSERT INTO course_lessons
             (chapter_id, position, title, level, objective, prerequisites, explanation, football_example, coachboot_demo, key_takeaways)
           VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            chapterId, chapter.title, chapter.level, chapter.objective, chapter.prerequisites,
            chapter.explanation, chapter.football_example, chapter.coachboot_demo, chapter.key_takeaways,
          ]
        );
        lessonIdsByPosition.push(lessonRow.id);

        if (chapter.quiz && chapter.quiz.length) {
          const { rows: [quizRow] } = await client.query(
            `INSERT INTO quizzes (title, question_count, chapter_id) VALUES ($1,$2,$3) RETURNING id`,
            [`Quiz — ${chapter.title}`, chapter.quiz.length, chapterId]
          );
          let qPos = 0;
          for (const q of chapter.quiz) {
            qPos += 1;
            await client.query(
              `INSERT INTO quiz_questions (quiz_id, position, question_type, question_text, choices, correct_answer, explanation)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [
                quizRow.id, qPos, q.type, q.text,
                JSON.stringify(q.choices.map(([key, text]) => ({ key, text }))),
                q.correct, q.explanation,
              ]
            );
          }
        }
      }

      if (mod.finalExercise) {
        await client.query(
          `INSERT INTO course_exercises (course_id, chapter_id, title, instructions, is_final_project)
           VALUES ($1,NULL,$2,$3,$4)`,
          [courseId, mod.finalExercise.title, mod.finalExercise.instructions, !!mod.finalExercise.isFinalProject]
        );
      }

      // Progression de démonstration : le module 1 a ses 2 premières leçons
      // RÉELLEMENT marquées comme lues (pas un pourcentage cosmétique déconnecté
      // de toute donnée — sinon la première vraie complétion d'un utilisateur
      // ferait mécaniquement BAISSER un pourcentage qui n'aurait jamais
      // correspondu à un accomplissement réel). Le reste des modules démarre à 0%.
      const totalItems = mod.chapters.length + (mod.finalExercise ? 1 : 0);
      let demoProgress = 0;
      if (mod.module_number === 1) {
        const demoCompletedLessons = lessonIdsByPosition.slice(0, 2);
        for (const lessonId of demoCompletedLessons) {
          await client.query(
            `INSERT INTO lesson_completions (user_id, lesson_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [coachId, lessonId]
          );
        }
        demoProgress = Math.round((demoCompletedLessons.length / totalItems) * 100);
      }
      await client.query(
        `INSERT INTO course_progress (user_id, course_id, progress_pct) VALUES ($1,$2,$3)`,
        [coachId, courseId, demoProgress]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ CoachBoot IA Academy : ${allModules.length} modules, contenu inséré avec succès.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

seedAcademy()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => { console.error('❌ Échec du seed Academy :', err); pool.end().finally(() => process.exit(1)); });
