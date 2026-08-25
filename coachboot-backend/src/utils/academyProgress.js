const pool = require('../config/db');

/**
 * Recalcule et persiste course_progress.progress_pct pour un module de la
 * CoachBoot IA Academy : (leçons complétées + TP final complété) / (nb de
 * chapitres + nb d'exercices du cours) * 100. Renvoie null pour un cours
 * générique (sans chapitres Academy) — son progress_pct reste géré
 * manuellement via PUT /api/courses/:id/progress comme avant.
 */
async function recomputeCourseProgress(userId, courseId) {
  const { rows: [totals] } = await pool.query(
    `SELECT
       (SELECT count(*) FROM course_chapters WHERE course_id = $1) AS chapter_count,
       (SELECT count(*) FROM course_exercises WHERE course_id = $1) AS exercise_count`,
    [courseId]
  );
  const totalItems = Number(totals.chapter_count) + Number(totals.exercise_count);
  if (totalItems === 0) return null;

  const { rows: [done] } = await pool.query(
    `SELECT
       (SELECT count(*) FROM lesson_completions lc
          JOIN course_lessons l ON l.id = lc.lesson_id
          JOIN course_chapters ch ON ch.id = l.chapter_id
          WHERE ch.course_id = $1 AND lc.user_id = $2) AS lessons_done,
       (SELECT count(*) FROM exercise_completions ec
          JOIN course_exercises e ON e.id = ec.exercise_id
          WHERE e.course_id = $1 AND ec.user_id = $2) AS exercises_done`,
    [courseId, userId]
  );
  const completedItems = Number(done.lessons_done) + Number(done.exercises_done);
  const progressPct = Math.round((completedItems / totalItems) * 100);

  const { rows: [progress] } = await pool.query(
    `INSERT INTO course_progress (user_id, course_id, progress_pct) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, course_id) DO UPDATE SET progress_pct = $3, updated_at = now()
     RETURNING *`,
    [userId, courseId, progressPct]
  );
  return progress;
}

module.exports = { recomputeCourseProgress };
