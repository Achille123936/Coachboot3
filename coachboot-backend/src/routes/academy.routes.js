// ============================================================================
// ACADEMY — AI COURSE GENERATOR (Gemini)
// Génère un cours complet (chapitres → leçon → quiz noté → TP final) et
// l'enregistre dans le MÊME schéma que l'Academy existante — courses/
// course_chapters/course_lessons/quizzes/quiz_questions/course_exercises.
// Un cours généré par IA est un `courses` comme un autre : tout le parcours
// étudiant existant (GET /courses, /courses/:id/chapters, quiz submit,
// exercise complete, certificats) fonctionne sans modification. Voir
// docs/API.md, section « Génération de cours par IA (Gemini) », pour le
// détail du périmètre et des limites honnêtes.
// ============================================================================
const router = require('express').Router();
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generateCourse, validateGenerated, LEVELS } = require('../services/geminiCourseGenerator');

const ACADEMY_AUTHOR_ROLES = ['technical_director']; // + admin via le bypass déjà présent dans requireRole

/**
 * POST /api/academy/generate — appelle Gemini pour générer un cours complet.
 * N'écrit RIEN en base : renvoie un aperçu que l'admin doit explicitement
 * enregistrer via POST /api/academy/courses.
 */
router.post('/generate', requireAuth, requireRole(...ACADEMY_AUTHOR_ROLES), asyncHandler(async (req, res) => {
  const { title, subject, level, chapterCount, durationLabel, language, targetAudience, objectives, questionsPerQuiz } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title est requis.' });
  if (!subject || !subject.trim()) return res.status(400).json({ error: 'subject est requis.' });

  const generated = await generateCourse({
    title, subject, level, chapterCount, durationLabel,
    language: language || 'fr', targetAudience, objectives, questionsPerQuiz,
  });
  res.json({ preview: generated, level, language: language || 'fr' });
}));

/**
 * POST /api/academy/courses — enregistre un cours généré (ou retouché par
 * l'admin) dans les tables Academy réelles, en une seule transaction.
 * Revalide la structure côté serveur : ne fait jamais confiance à un JSON
 * client sans revérification, même s'il vient de /generate.
 */
router.post('/courses', requireAuth, requireRole(...ACADEMY_AUTHOR_ROLES), asyncHandler(async (req, res) => {
  const { generated, level, language } = req.body;
  if (!LEVELS.includes(level)) return res.status(400).json({ error: `level doit être l'un de : ${LEVELS.join(', ')}.` });

  const errors = validateGenerated(generated, {});
  if (errors.length) return res.status(400).json({ error: 'Structure de cours invalide : ' + errors.join(' | ') });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [{ next: nextModuleNumber }] } = await client.query(
      'SELECT COALESCE(MAX(module_number), 0) + 1 AS next FROM courses'
    );
    const { rows: [course] } = await client.query(
      `INSERT INTO courses (title, level, duration_label, description, objective, module_number, ai_generated, ai_provider, created_by, language)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,'gemini',$7,$8) RETURNING *`,
      [
        generated.course.title, level, generated.course.duration_label || null,
        generated.course.description, generated.course.objective,
        nextModuleNumber, req.user.id, language || 'fr',
      ]
    );

    for (let i = 0; i < generated.chapters.length; i++) {
      const ch = generated.chapters[i];
      const { rows: [chapter] } = await client.query(
        `INSERT INTO course_chapters (course_id, position, title, objective) VALUES ($1,$2,$3,$4) RETURNING *`,
        [course.id, i + 1, ch.title, ch.objective || null]
      );
      await client.query(
        `INSERT INTO course_lessons (chapter_id, position, title, level, objective, prerequisites, explanation, football_example, key_takeaways)
         VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          chapter.id, ch.lesson.title, level, ch.lesson.objective || null,
          ch.lesson.prerequisites || null, ch.lesson.explanation,
          ch.lesson.football_example || null, ch.lesson.key_takeaways || null,
        ]
      );
      const { rows: [quiz] } = await client.query(
        `INSERT INTO quizzes (title, question_count, chapter_id) VALUES ($1,$2,$3) RETURNING *`,
        [ch.quiz.title || `Quiz — ${ch.title}`, ch.quiz.questions.length, chapter.id]
      );
      for (let qi = 0; qi < ch.quiz.questions.length; qi++) {
        const q = ch.quiz.questions[qi];
        await client.query(
          `INSERT INTO quiz_questions (quiz_id, position, question_type, question_text, choices, correct_answer, explanation)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [quiz.id, qi + 1, q.question_type, q.question_text, JSON.stringify(q.choices), q.correct_answer, q.explanation || null]
        );
      }
    }

    await client.query(
      `INSERT INTO course_exercises (course_id, chapter_id, title, instructions, is_final_project) VALUES ($1,NULL,$2,$3,TRUE)`,
      [course.id, generated.final_exercise.title, generated.final_exercise.instructions]
    );

    await client.query('COMMIT');
    res.status(201).json({ course });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
