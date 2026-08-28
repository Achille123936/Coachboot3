// ============================================================================
// COACHBOOT IA — entraînement & prédiction (pipeline Python réel)
// Node ne fait pas de Machine Learning lui-même : cette route orchestre des
// scripts Python (ml/train.py, ml/predict.py — pandas/numpy/scikit-learn) via
// child_process, un process par run. Voir docs/API.md pour l'architecture
// complète et les limites honnêtes (pas de service Python permanent, pas de
// GPU, RandomForest uniquement pour l'instant).
// ============================================================================
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const multer = require('multer');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole, requireClubScope } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');
const { addClubFilter } = require('../utils/tenantScope');

router.param('id', validateUuidParam);
router.use(requireAuth, requireClubScope);

const ML_DIR = path.join(__dirname, '..', '..', 'ml');
const MODELS_DIR = path.join(ML_DIR, 'models');
const UPLOADS_DIR = path.join(ML_DIR, 'uploads');
fs.mkdirSync(MODELS_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ML_ROLES = ['technical_director', 'data_analyst', 'head_coach'];

// Sur Windows, le lanceur "py" épinglé sur 3.12 (stable — wheels ML disponibles,
// voir docs/API.md). PYTHON_BIN permet de pointer un binaire explicite ailleurs.
const PYTHON_CMD = process.env.PYTHON_BIN || 'py';
const PYTHON_PREFIX_ARGS = process.env.PYTHON_BIN ? [] : ['-3.12'];

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.csv`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo
  fileFilter: (req, file, cb) => {
    if (!/\.csv$/i.test(file.originalname)) return cb(new Error('Seuls les fichiers .csv sont acceptés.'));
    cb(null, true);
  },
});

/** Lance un script du pipeline ML et résout avec le JSON de sa dernière ligne stdout. */
function runPython(scriptName, args) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(ML_DIR, scriptName);
    const child = spawn(PYTHON_CMD, [...PYTHON_PREFIX_ARGS, scriptPath, ...args]);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    child.on('error', (err) => reject(new Error(`Impossible de lancer Python (${PYTHON_CMD}) : ${err.message}`)));

    child.on('close', () => {
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
      if (!lastLine) {
        return reject(new Error(stderr.trim() || 'Le script Python n\'a produit aucune sortie.'));
      }
      let parsed;
      try {
        parsed = JSON.parse(lastLine);
      } catch {
        return reject(new Error(`Sortie du script Python illisible : ${lastLine.slice(0, 300)}`));
      }
      if (parsed.error) return reject(new Error(parsed.error));
      resolve(parsed);
    });
  });
}

/**
 * POST /api/ml/train
 * multipart/form-data : csv (fichier), name, task (regression|classification),
 * target, features (JSON string d'un tableau de noms de colonnes).
 */
router.post('/train', requireRole(...ML_ROLES), upload.single('csv'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier CSV requis (champ "csv").' });
  const clubId = req.clubId ?? req.body.club_id;
  if (!clubId) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'club_id est requis.' }); }

  const { name, task, target } = req.body;
  let features;
  try { features = JSON.parse(req.body.features); } catch { features = null; }

  if (!name || !task || !target || !Array.isArray(features) || !features.length) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'name, task, target et features (tableau non vide) sont requis.' });
  }
  if (!['regression', 'classification'].includes(task)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'task doit être "regression" ou "classification".' });
  }
  // Déclaration OBLIGATOIRE et explicite de l'utilisateur — jamais déduite du nom
  // de fichier ou d'une heuristique — pour ne jamais laisser un modèle entraîné
  // sur des données synthétiques être confondu avec un modèle appris sur de
  // vraies statistiques de match (voir docs/API.md, section CoachBoot IA).
  const datasetType = ['synthetic', 'real', 'unknown'].includes(req.body.dataset_type) ? req.body.dataset_type : null;
  if (!datasetType) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'dataset_type est requis ("synthetic", "real" ou "unknown").' });
  }

  const modelId = crypto.randomUUID();

  try {
    const result = await runPython('train.py', [
      '--csv', req.file.path,
      '--features', features.join(','),
      '--target', target,
      '--task', task,
      '--model-id', modelId,
      '--models-dir', MODELS_DIR,
      '--dataset-type', datasetType,
    ]);

    const { rows } = await pool.query(
      `INSERT INTO ml_models (id, club_id, name, task, target, features, metrics, feature_importances, row_count_raw, row_count_clean, status, dataset_type, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'trained',$11,$12) RETURNING *`,
      [
        modelId, clubId, name, task, target,
        JSON.stringify(result.features), JSON.stringify(result.metrics), JSON.stringify(result.feature_importances),
        result.row_count_raw, result.row_count_clean, datasetType, req.user.id,
      ]
    );

    res.status(201).json({ model: rows[0], split: result.split, rows_dropped: result.rows_dropped, label_classes: result.label_classes });
  } catch (err) {
    // Le dossier du modèle n'a pu être créé qu'après un entraînement réussi :
    // rien à nettoyer côté ml/models/ en cas d'échec, seulement l'upload temporaire.
    err.status = 400;
    throw err;
  } finally {
    fs.unlink(req.file.path, () => {}); // le CSV brut n'est plus nécessaire une fois le modèle entraîné
  }
}));

/** GET /api/ml/models — historique des modèles entraînés */
router.get('/models', asyncHandler(async (req, res) => {
  const conditions = []; const params = [];
  addClubFilter(conditions, params, req.clubId, 'm.club_id');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT m.*, u.full_name AS created_by_name FROM ml_models m
     LEFT JOIN users u ON u.id = m.created_by
     ${where} ORDER BY m.created_at DESC`, params
  );
  res.json({ models: rows });
}));

/** POST /api/ml/models/:id/deploy — déploie ce modèle (archive l'ancien déployé pour la même cible, dans le même club) */
router.post('/models/:id/deploy', requireRole(...ML_ROLES), asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const modelConditions = ['id = $1']; const modelParams = [req.params.id];
    addClubFilter(modelConditions, modelParams, req.clubId);
    const { rows: modelRows } = await client.query(`SELECT * FROM ml_models WHERE ${modelConditions.join(' AND ')}`, modelParams);
    if (!modelRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Modèle introuvable.' }); }
    const model = modelRows[0];

    await client.query(
      `UPDATE ml_models SET status = 'archived' WHERE club_id = $1 AND task = $2 AND target = $3 AND status = 'deployed'`,
      [model.club_id, model.task, model.target]
    );
    const { rows } = await client.query(`UPDATE ml_models SET status = 'deployed' WHERE id = $1 RETURNING *`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ model: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

/** DELETE /api/ml/models/:id — supprime le modèle (base + fichier sur disque) */
router.delete('/models/:id', requireRole(...ML_ROLES), asyncHandler(async (req, res) => {
  const conditions = ['id = $1']; const params = [req.params.id];
  addClubFilter(conditions, params, req.clubId);
  const { rowCount } = await pool.query(`DELETE FROM ml_models WHERE ${conditions.join(' AND ')}`, params);
  if (!rowCount) return res.status(404).json({ error: 'Modèle introuvable.' });
  fs.rm(path.join(MODELS_DIR, req.params.id), { recursive: true, force: true }, () => {});
  res.status(204).send();
}));

/** POST /api/ml/predict — { model_id, input: { feature: valeur, ... } } */
router.post('/predict', asyncHandler(async (req, res) => {
  const { model_id, input } = req.body;
  if (!model_id || !input || typeof input !== 'object') {
    return res.status(400).json({ error: 'model_id et input (objet de valeurs de features) sont requis.' });
  }
  const conditions = ['id = $1']; const params = [model_id];
  addClubFilter(conditions, params, req.clubId);
  const { rows } = await pool.query(`SELECT id FROM ml_models WHERE ${conditions.join(' AND ')}`, params);
  if (!rows.length) return res.status(404).json({ error: 'Modèle introuvable.' });

  try {
    const result = await runPython('predict.py', [
      '--model-id', model_id,
      '--models-dir', MODELS_DIR,
      '--input', JSON.stringify(input),
    ]);
    res.json(result);
  } catch (err) {
    err.status = 400;
    throw err;
  }
}));

module.exports = router;
