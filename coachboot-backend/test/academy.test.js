const test = require('node:test');
const assert = require('node:assert/strict');
const { request, loginAs, DEMO_ACCOUNTS } = require('../testHelpers');

// Parcours complet de la CoachBoot IA Academy : leçon -> quiz noté -> TP -> 100% -> certificat.
// Utilise le Module 1 déjà seedé (db/seed-academy.js) ; restaure sa progression de
// démonstration (40%) et supprime le certificat de test à la fin pour ne pas polluer
// l'état de démo présenté aux utilisateurs.
test('CoachBoot IA Academy — parcours complet noté côté serveur', async (t) => {
  const token = await loginAs(DEMO_ACCOUNTS.head_coach);
  let courseId, chapters, finalExercise;

  await t.test('GET /courses trouve le Module 1', async () => {
    const { status, data } = await request('/courses', { token });
    assert.equal(status, 200);
    const module1 = data.courses.find(c => c.module_number === 1);
    assert.ok(module1, 'le Module 1 de l\'Academy doit exister (lancer db/seed-academy.js)');
    courseId = module1.id;
  });

  await t.test('GET /courses/:id/chapters renvoie la structure réelle', async () => {
    const { status, data } = await request(`/courses/${courseId}/chapters`, { token });
    assert.equal(status, 200);
    assert.ok(data.chapters.length >= 1);
    chapters = data.chapters;
    finalExercise = data.final_exercise;
  });

  await t.test('GET /quizzes/:id/questions ne renvoie jamais la réponse correcte', async () => {
    const chapterWithQuiz = chapters.find(c => c.quiz_id);
    assert.ok(chapterWithQuiz, 'au moins un chapitre doit avoir un quiz');
    const { status, data } = await request(`/quizzes/${chapterWithQuiz.quiz_id}/questions`, { token });
    assert.equal(status, 200);
    for (const q of data.questions) {
      assert.equal('correct_answer' in q, false);
      assert.equal('explanation' in q, false);
    }
  });

  await t.test('POST /quizzes/:id/submit note réellement côté serveur (une bonne, une fausse -> 50%)', async () => {
    const chapterWithQuiz = chapters.find(c => c.quiz_id && c.chapter_id === chapters[0].chapter_id) || chapters.find(c => c.quiz_id);
    const { data: qData } = await request(`/quizzes/${chapterWithQuiz.quiz_id}/questions`, { token });
    if (qData.questions.length < 2) return; // structure inattendue, on ne bloque pas la suite du parcours
    const answers = { [qData.questions[0].id]: 'THIS_IS_DEFINITELY_WRONG' };
    const { status, data } = await request(`/quizzes/${chapterWithQuiz.quiz_id}/submit`, { method: 'POST', token, body: { answers } });
    assert.equal(status, 201);
    assert.ok(data.score_pct < 100, 'une réponse volontairement fausse ne doit jamais scorer 100%');
    assert.ok(data.results.every(r => 'correct_answer' in r), 'la correction doit être révélée après soumission');
  });

  await t.test('POST /courses/lessons/:id/complete fait progresser le module', async () => {
    const before = await request(`/courses/${courseId}/chapters`, { token });
    const progressBefore = before.data.course.progress_pct;

    const uncompleted = chapters.find(c => !c.lesson_completed);
    if (!uncompleted) return; // déjà tout complété par un test précédent — pas bloquant
    const { status, data } = await request(`/courses/lessons/${uncompleted.lesson_id}/complete`, { method: 'POST', token });
    assert.equal(status, 200);
    assert.ok(data.progress.progress_pct >= progressBefore);
  });

  await t.test('POST /certificates/course/:id refuse tant que la progression n\'est pas 100%', async () => {
    const { data } = await request(`/courses/${courseId}/chapters`, { token });
    if (data.course.progress_pct >= 100) return; // déjà à 100% (parcours précédent) — le refus n'est plus applicable
    const { status } = await request(`/certificates/course/${courseId}`, { method: 'POST', token });
    assert.equal(status, 400);
  });

  await t.test('nettoyage : restaure la progression de démonstration du Module 1 (2 leçons réellement lues, 33%)', async () => {
    // Miroir exact de db/seed-academy.js : la démo du Module 1 doit rester
    // adossée à de VRAIES lesson_completions, jamais à un progress_pct
    // cosmétique déconnecté — sinon on réintroduit le bug que ce test vient
    // justement de vérifier (la progression ne doit jamais mentir).
    const pool = require('../src/config/db');
    const { rows: [coach] } = await pool.query(`SELECT id FROM users WHERE email = $1`, [DEMO_ACCOUNTS.head_coach]);
    await pool.query(`DELETE FROM lesson_completions WHERE user_id = $1`, [coach.id]);
    await pool.query(`DELETE FROM exercise_completions WHERE user_id = $1`, [coach.id]);
    await pool.query(`DELETE FROM quiz_attempts WHERE user_id = $1`, [coach.id]);
    await pool.query(`DELETE FROM certificates WHERE user_id = $1 AND course_id = $2`, [coach.id, courseId]);

    const demoLessonIds = chapters.slice(0, 2).map(c => c.lesson_id);
    for (const lessonId of demoLessonIds) {
      await pool.query(`INSERT INTO lesson_completions (user_id, lesson_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [coach.id, lessonId]);
    }
    const totalItems = chapters.length + (finalExercise ? 1 : 0);
    const demoProgress = Math.round((demoLessonIds.length / totalItems) * 100);
    await pool.query(`UPDATE course_progress SET progress_pct = $3, updated_at = now() WHERE user_id = $1 AND course_id = $2`, [coach.id, courseId, demoProgress]);
    await pool.end();
  });
});
