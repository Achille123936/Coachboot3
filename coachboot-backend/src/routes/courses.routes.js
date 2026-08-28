const router = require('express').Router();
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');
const { recomputeCourseProgress } = require('../utils/academyProgress');

router.param('id', validateUuidParam);
router.param('lessonId', validateUuidParam);
router.param('exerciseId', validateUuidParam);

/** GET /api/courses — liste des cours, avec la progression de l'utilisateur connecté */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT c.*, COALESCE(cp.progress_pct, 0) AS progress_pct
    FROM courses c
    LEFT JOIN course_progress cp ON cp.course_id = c.id AND cp.user_id = $1
    ORDER BY c.title`, [req.user.id]);
  res.json({ courses: rows });
}));

/** PUT /api/courses/:id/progress — met à jour la progression de l'utilisateur connecté sur un cours */
router.put('/:id/progress', requireAuth, asyncHandler(async (req, res) => {
  const { progress_pct } = req.body;
  if (!Number.isFinite(progress_pct) || progress_pct < 0 || progress_pct > 100) {
    return res.status(400).json({ error: 'progress_pct doit être un nombre compris entre 0 et 100.' });
  }
  const { rows } = await pool.query(`
    INSERT INTO course_progress (user_id, course_id, progress_pct) VALUES ($1,$2,$3)
    ON CONFLICT (user_id, course_id) DO UPDATE SET progress_pct = $3, updated_at = now()
    RETURNING *`, [req.user.id, req.params.id, progress_pct]);
  res.json({ progress: rows[0] });
}));

/** GET /api/courses/:id/chapters — structure Academy complète d'un module :
 * chapitres, leçons (contenu pédagogique), quiz (sans les réponses), TP final,
 * avec le statut de complétion de l'utilisateur connecté sur chaque élément. */
router.get('/:id/chapters', requireAuth, asyncHandler(async (req, res) => {
  const { rows: courseRows } = await pool.query(`
    SELECT c.*, COALESCE(cp.progress_pct, 0) AS progress_pct
    FROM courses c
    LEFT JOIN course_progress cp ON cp.course_id = c.id AND cp.user_id = $2
    WHERE c.id = $1`, [req.params.id, req.user.id]);
  if (!courseRows.length) return res.status(404).json({ error: 'Cours introuvable.' });

  const { rows: chapters } = await pool.query(`
    SELECT
      ch.id AS chapter_id, ch.position, ch.title AS chapter_title, ch.objective AS chapter_objective,
      l.id AS lesson_id, l.title AS lesson_title, l.level, l.objective AS lesson_objective,
      l.prerequisites, l.explanation, l.football_example, l.coachboot_demo, l.key_takeaways,
      (lc.id IS NOT NULL) AS lesson_completed,
      q.id AS quiz_id, q.title AS quiz_title, q.question_count,
      (SELECT MAX(score_pct) FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.user_id = $2) AS best_score
    FROM course_chapters ch
    LEFT JOIN course_lessons l ON l.chapter_id = ch.id
    LEFT JOIN lesson_completions lc ON lc.lesson_id = l.id AND lc.user_id = $2
    LEFT JOIN quizzes q ON q.chapter_id = ch.id
    WHERE ch.course_id = $1
    ORDER BY ch.position`, [req.params.id, req.user.id]);

  const { rows: finalExerciseRows } = await pool.query(`
    SELECT e.*, (ec.id IS NOT NULL) AS completed, ec.notes
    FROM course_exercises e
    LEFT JOIN exercise_completions ec ON ec.exercise_id = e.id AND ec.user_id = $2
    WHERE e.course_id = $1 AND e.chapter_id IS NULL`, [req.params.id, req.user.id]);

  res.json({
    course: courseRows[0],
    chapters,
    final_exercise: finalExerciseRows[0] || null,
  });
}));

/** POST /api/courses/lessons/:lessonId/complete — marque une leçon comme lue */
router.post('/lessons/:lessonId/complete', requireAuth, asyncHandler(async (req, res) => {
  const { rows: [lesson] } = await pool.query(
    `SELECT l.id, ch.course_id FROM course_lessons l
     JOIN course_chapters ch ON ch.id = l.chapter_id WHERE l.id = $1`,
    [req.params.lessonId]
  );
  if (!lesson) return res.status(404).json({ error: 'Leçon introuvable.' });

  await pool.query(
    `INSERT INTO lesson_completions (user_id, lesson_id) VALUES ($1,$2) ON CONFLICT (user_id, lesson_id) DO NOTHING`,
    [req.user.id, req.params.lessonId]
  );
  const progress = await recomputeCourseProgress(req.user.id, lesson.course_id);
  res.json({ completed: true, progress });
}));

/** POST /api/courses/exercises/:exerciseId/complete — marque un TP comme réalisé (auto-évaluation, avec notes libres) */
router.post('/exercises/:exerciseId/complete', requireAuth, asyncHandler(async (req, res) => {
  const { notes } = req.body;
  const { rows: [exercise] } = await pool.query(
    `SELECT id, course_id FROM course_exercises WHERE id = $1`, [req.params.exerciseId]
  );
  if (!exercise) return res.status(404).json({ error: 'Exercice introuvable.' });

  await pool.query(
    `INSERT INTO exercise_completions (user_id, exercise_id, notes) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, exercise_id) DO UPDATE SET notes = $3, completed_at = now()`,
    [req.user.id, req.params.exerciseId, notes || null]
  );
  const progress = await recomputeCourseProgress(req.user.id, exercise.course_id);
  res.json({ completed: true, progress });
}));

// Contenu Academy PARTAGÉ, plateforme-entière (retrofit multi-club) — un
// technical_director de N'IMPORTE quel club peut créer un cours "à la main"
// hors du générateur IA, comme avant la retrofit, en plus du bypass 'admin'.
router.post('/', requireAuth, requireRole('technical_director'), asyncHandler(async (req, res) => {
  const { title, level, duration_label } = req.body;
  if (!title) return res.status(400).json({ error: 'Le titre du cours est requis.' });
  const { rows } = await pool.query(
    `INSERT INTO courses (title, level, duration_label) VALUES ($1,COALESCE($2,'Intermédiaire'),$3) RETURNING *`,
    [title, level, duration_label]
  );
  res.status(201).json({ course: rows[0] });
}));

module.exports = router;
