const router = require('express').Router();
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');

router.param('courseId', validateUuidParam);

/** GET /api/certificates — certificats de l'utilisateur connecté */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM certificates WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]
  );
  res.json({ certificates: rows });
}));

/** POST /api/certificates/course/:courseId — délivre le certificat d'un module Academy,
 * uniquement si course_progress.progress_pct = 100 pour l'utilisateur connecté (jamais
 * délivré automatiquement sur simple déclaration côté client). */
router.post('/course/:courseId', requireAuth, asyncHandler(async (req, res) => {
  const { rows: [course] } = await pool.query('SELECT id, title FROM courses WHERE id = $1', [req.params.courseId]);
  if (!course) return res.status(404).json({ error: 'Cours introuvable.' });

  const { rows: [existing] } = await pool.query(
    'SELECT * FROM certificates WHERE user_id = $1 AND course_id = $2', [req.user.id, req.params.courseId]
  );
  if (existing) return res.json({ certificate: existing });

  const { rows: [progress] } = await pool.query(
    'SELECT progress_pct FROM course_progress WHERE user_id = $1 AND course_id = $2',
    [req.user.id, req.params.courseId]
  );
  if (!progress || progress.progress_pct < 100) {
    return res.status(400).json({ error: 'Le module doit être complété à 100% avant de délivrer un certificat.' });
  }

  const { rows: [certificate] } = await pool.query(
    `INSERT INTO certificates (user_id, title, course_id, issued_date, status)
     VALUES ($1,$2,$3,CURRENT_DATE,'Délivré') RETURNING *`,
    [req.user.id, `Certificat — ${course.title}`, req.params.courseId]
  );
  res.status(201).json({ certificate });
}));

module.exports = router;
