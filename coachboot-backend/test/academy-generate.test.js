const test = require('node:test');
const assert = require('node:assert/strict');
const { request, loginAs, DEMO_ACCOUNTS } = require('../testHelpers');
const pool = require('../src/config/db');

// Un seul pool pour tout le fichier, fermé une seule fois à la fin — piège
// documenté dans docs/TESTING.md (pool fermé deux fois dans le même fichier).
test.after(() => pool.end());

// Ce test fait un VRAI appel Gemini (pas de mock — cohérent avec la règle de
// cette session de ne jamais fabriquer un résultat). chapterCount=1 pour
// limiter le coût/la latence tout en couvrant réellement le chemin complet.
test('Academy — AI Course Generator (Gemini), génération réelle + intégration au pipeline existant', async (t) => {
  const staffToken = await loginAs(DEMO_ACCOUNTS.technical_director);
  const playerToken = await loginAs(DEMO_ACCOUNTS.player);
  let courseId, chapterId, quizId, lessonId, exerciseId, questionIds;

  await t.test('rôle non autorisé -> 403 sur /academy/generate', async () => {
    const { status } = await request('/academy/generate', {
      method: 'POST', token: playerToken,
      body: { title: 'Test', subject: 'Test', level: 'Débutant', chapterCount: 1 },
    });
    assert.equal(status, 403);
  });

  await t.test('chapterCount hors bornes -> 400 (aucun appel Gemini déclenché)', async () => {
    const { status } = await request('/academy/generate', {
      method: 'POST', token: staffToken,
      body: { title: 'Test', subject: 'Test', level: 'Débutant', chapterCount: 99 },
    });
    assert.equal(status, 400);
  });

  await t.test('level invalide -> 400', async () => {
    const { status } = await request('/academy/generate', {
      method: 'POST', token: staffToken,
      body: { title: 'Test', subject: 'Test', level: 'Expert', chapterCount: 1 },
    });
    assert.equal(status, 400);
  });

  let preview, level, language;
  await t.test('génération réelle via Gemini renvoie un aperçu valide (aucune écriture en base)', async () => {
    const { status, data } = await request('/academy/generate', {
      method: 'POST', token: staffToken,
      body: {
        title: 'Test E2E — Bases du scouting', subject: 'Introduction aux critères de recrutement au football',
        level: 'Débutant', chapterCount: 1, language: 'fr', questionsPerQuiz: 2,
      },
    });
    assert.equal(status, 200);
    assert.ok(data.preview.course.title);
    assert.equal(data.preview.chapters.length, 1);
    assert.ok(data.preview.chapters[0].lesson.explanation);
    assert.equal(data.preview.chapters[0].quiz.questions.length, 2);
    assert.ok(data.preview.final_exercise.instructions);
    preview = data.preview; level = data.level; language = data.language;

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM courses WHERE title = $1", [preview.course.title]);
    assert.equal(rows[0].n, 0, "generate ne doit rien écrire en base");
  });

  await t.test('sauvegarde -> lignes réellement créées dans toutes les tables Academy', async () => {
    const { status, data } = await request('/academy/courses', {
      method: 'POST', token: staffToken,
      body: { generated: preview, level, language },
    });
    assert.equal(status, 201);
    assert.equal(data.course.ai_generated, true);
    assert.equal(data.course.ai_provider, 'gemini');
    courseId = data.course.id;

    const { rows: chapters } = await pool.query('SELECT id FROM course_chapters WHERE course_id = $1', [courseId]);
    assert.equal(chapters.length, 1);
    chapterId = chapters[0].id;

    const { rows: lessons } = await pool.query('SELECT id FROM course_lessons WHERE chapter_id = $1', [chapterId]);
    assert.equal(lessons.length, 1);
    lessonId = lessons[0].id;

    const { rows: quizzes } = await pool.query('SELECT id, question_count FROM quizzes WHERE chapter_id = $1', [chapterId]);
    assert.equal(quizzes.length, 1);
    assert.equal(quizzes[0].question_count, 2);
    quizId = quizzes[0].id;

    const { rows: questions } = await pool.query('SELECT id FROM quiz_questions WHERE quiz_id = $1', [quizId]);
    assert.equal(questions.length, 2);
    questionIds = questions.map((q) => q.id);

    const { rows: exercises } = await pool.query('SELECT id FROM course_exercises WHERE course_id = $1 AND is_final_project = TRUE', [courseId]);
    assert.equal(exercises.length, 1);
    exerciseId = exercises[0].id;
  });

  await t.test('structure invalide (client altéré) -> 400, revalidée côté serveur', async () => {
    const broken = JSON.parse(JSON.stringify(preview));
    broken.chapters[0].quiz.questions = [];
    const { status } = await request('/academy/courses', {
      method: 'POST', token: staffToken,
      body: { generated: broken, level, language },
    });
    assert.equal(status, 400);
  });

  await t.test('le cours généré apparaît dans GET /courses (endpoint existant, non modifié)', async () => {
    const { data } = await request('/courses', { token: staffToken });
    assert.ok(data.courses.some((c) => c.id === courseId));
  });

  await t.test('le quiz généré est réellement noté par POST /quizzes/:id/submit (pipeline existant, non modifié)', async () => {
    const { rows: qRows } = await pool.query('SELECT id, correct_answer FROM quiz_questions WHERE quiz_id = $1 ORDER BY position', [quizId]);
    const answers = {};
    answers[qRows[0].id] = qRows[0].correct_answer; // correct
    answers[qRows[1].id] = qRows[1].correct_answer === 'A' ? 'B' : 'A'; // délibérément faux

    const { status, data } = await request(`/quizzes/${quizId}/submit`, {
      method: 'POST', token: staffToken, body: { answers },
    });
    assert.equal(status, 201);
    assert.equal(data.score_pct, 50, '1/2 bonnes réponses doit donner 50%, calculé par le serveur');
  });

  await t.test('parcours complet -> leçon + TP -> 100% -> certificat (pipeline existant, non modifié)', async () => {
    const l = await request(`/courses/lessons/${lessonId}/complete`, { method: 'POST', token: staffToken });
    assert.equal(l.status, 200);
    const e = await request(`/courses/exercises/${exerciseId}/complete`, {
      method: 'POST', token: staffToken, body: { notes: 'Test E2E' },
    });
    assert.equal(e.status, 200);
    assert.equal(e.data.progress.progress_pct, 100);

    const cert = await request(`/certificates/course/${courseId}`, { method: 'POST', token: staffToken });
    assert.equal(cert.status, 201);
    assert.equal(cert.data.certificate.status, 'Délivré');
  });

  await t.test('nettoyage', async () => {
    await pool.query('DELETE FROM certificates WHERE course_id = $1', [courseId]);
    const { rowCount } = await pool.query('DELETE FROM courses WHERE id = $1', [courseId]);
    assert.equal(rowCount, 1);
    const { rows: remaining } = await pool.query('SELECT count(*)::int AS n FROM course_chapters WHERE course_id = $1', [courseId]);
    assert.equal(remaining[0].n, 0, 'la cascade FK doit avoir supprimé chapitres/leçons/quiz/questions/exercices');
  });
});
