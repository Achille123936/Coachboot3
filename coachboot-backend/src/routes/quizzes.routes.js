const router = require('express').Router();
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');

router.param('id', validateUuidParam);

/** GET /api/quizzes — liste des quiz avec le meilleur score de l'utilisateur connecté */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT q.*, MAX(qa.score_pct) AS best_score
    FROM quizzes q
    LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id AND qa.user_id = $1
    GROUP BY q.id ORDER BY q.title`, [req.user.id]);
  res.json({ quizzes: rows });
}));

/** POST /api/quizzes/:id/attempts — enregistre une tentative de quiz (legacy : score
 * déclaré par le client — utilisé par le quiz de démonstration de quizzes.html, qui
 * n'a pas de questions réelles en base). Pour un quiz de chapitre Academy avec de
 * vraies questions notées, utiliser GET .../questions puis POST .../submit ci-dessous. */
router.post('/:id/attempts', requireAuth, asyncHandler(async (req, res) => {
  const { score_pct } = req.body;
  if (!Number.isFinite(score_pct) || score_pct < 0 || score_pct > 100) {
    return res.status(400).json({ error: 'score_pct doit être un nombre compris entre 0 et 100.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO quiz_attempts (user_id, quiz_id, score_pct) VALUES ($1,$2,$3) RETURNING *`,
    [req.user.id, req.params.id, score_pct]
  );
  res.status(201).json({ attempt: rows[0] });
}));

/** GET /api/quizzes/:id/questions — questions d'un quiz de chapitre Academy,
 * SANS la réponse correcte ni l'explication (révélées seulement après soumission). */
router.get('/:id/questions', requireAuth, asyncHandler(async (req, res) => {
  const { rows: quiz } = await pool.query('SELECT * FROM quizzes WHERE id = $1', [req.params.id]);
  if (!quiz.length) return res.status(404).json({ error: 'Quiz introuvable.' });
  const { rows: questions } = await pool.query(
    `SELECT id, position, question_type, question_text, choices
     FROM quiz_questions WHERE quiz_id = $1 ORDER BY position`,
    [req.params.id]
  );
  res.json({ quiz: quiz[0], questions });
}));

/** POST /api/quizzes/:id/submit — notation réelle côté serveur : compare les réponses
 * soumises à quiz_questions.correct_answer, stocke la tentative + les réponses en base
 * (jamais la notation du client), et renvoie l'explication de chaque question. */
router.post('/:id/submit', requireAuth, asyncHandler(async (req, res) => {
  const { answers } = req.body; // { [questionId]: 'a', ... }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return res.status(400).json({ error: 'answers (objet { questionId: réponse }) est requis.' });
  }
  const { rows: questions } = await pool.query(
    `SELECT id, correct_answer, explanation FROM quiz_questions WHERE quiz_id = $1`,
    [req.params.id]
  );
  if (!questions.length) return res.status(404).json({ error: 'Ce quiz ne contient aucune question notée.' });

  let correctCount = 0;
  const results = questions.map((q) => {
    const chosen = Object.prototype.hasOwnProperty.call(answers, q.id) ? answers[q.id] : null;
    const isCorrect = chosen === q.correct_answer;
    if (isCorrect) correctCount += 1;
    return { question_id: q.id, chosen, correct_answer: q.correct_answer, is_correct: isCorrect, explanation: q.explanation };
  });
  const scorePct = Math.round((correctCount / questions.length) * 100);

  const { rows: [attempt] } = await pool.query(
    `INSERT INTO quiz_attempts (user_id, quiz_id, score_pct, answers) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, req.params.id, scorePct, JSON.stringify(answers)]
  );

  res.status(201).json({ attempt, score_pct: scorePct, results });
}));

module.exports = router;
