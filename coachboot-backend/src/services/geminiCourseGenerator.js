// ============================================================================
// GEMINI COURSE GENERATOR — génère un curriculum complet (cours → chapitres →
// leçon → quiz noté → TP final) pour CoachBoot IA Academy, en sortie JSON
// stricte. Réutilise le même SDK/modèle que assistant.routes.js, mais avec
// generationConfig.responseSchema (sortie structurée) plutôt qu'un chat texte
// libre : ici on a besoin d'une forme de données exacte, pas d'une réponse
// conversationnelle.
//
// Contrat honnête : cette fonction ne renvoie JAMAIS une structure invalide
// silencieusement. Une réponse Gemini qui ne respecte pas la forme attendue
// déclenche UNE tentative de réparation (on renvoie l'erreur exacte à Gemini
// et on lui redemande une sortie corrigée) ; si la réparation échoue aussi,
// on lève une erreur claire — jamais de données partielles.
// ============================================================================
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const QUESTION_TYPES = ['qcm', 'vrai_faux'];
const LEVELS = ['Débutant', 'Intermédiaire', 'Avancé'];

const SYSTEM_PROMPT = `You are CoachBoot Football Intelligence Academy AI.

You are an expert instructional designer specialized in football performance
analysis, scouting, GPS data, match analysis, video analysis, tactical
analysis and football intelligence.

Generate educational material that is structured, practical, progressive and
suitable for football coaches, analysts and students.

Never invent real statistics or real match data. When a practical example
would need real CoachBoot data that isn't provided to you, clearly write it
as a fictional/illustrative example rather than presenting it as real.

Every lesson must contain: an objective, a clear explanation, a football
example, and key takeaways. Every quiz question must be objectively gradable
(qcm or vrai_faux only — never open-ended), with exactly one correct answer
whose key matches one of the provided choices.

Respond ONLY with JSON matching the exact schema provided — no prose, no
markdown fences, no commentary outside the JSON structure.`;

const COURSE_SCHEMA = {
  type: 'object',
  properties: {
    course: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        objective: { type: 'string' },
        duration_label: { type: 'string' },
      },
      required: ['title', 'description', 'objective'],
    },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          lesson: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              objective: { type: 'string' },
              prerequisites: { type: 'string' },
              explanation: { type: 'string' },
              football_example: { type: 'string' },
              key_takeaways: { type: 'string' },
            },
            required: ['title', 'explanation'],
          },
          quiz: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              questions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    question_type: { type: 'string', enum: QUESTION_TYPES },
                    question_text: { type: 'string' },
                    choices: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { key: { type: 'string' }, text: { type: 'string' } },
                        required: ['key', 'text'],
                      },
                    },
                    correct_answer: { type: 'string' },
                    explanation: { type: 'string' },
                  },
                  required: ['question_type', 'question_text', 'choices', 'correct_answer'],
                },
              },
            },
            required: ['title', 'questions'],
          },
        },
        required: ['title', 'lesson', 'quiz'],
      },
    },
    final_exercise: {
      type: 'object',
      properties: { title: { type: 'string' }, instructions: { type: 'string' } },
      required: ['title', 'instructions'],
    },
  },
  required: ['course', 'chapters', 'final_exercise'],
};

/** Construit le prompt utilisateur à partir des paramètres saisis par l'admin. */
function buildUserPrompt(params) {
  const { title, subject, level, chapterCount, durationLabel, language, targetAudience, objectives, questionsPerQuiz } = params;
  return [
    `Generate a complete football intelligence course.`,
    `Title: ${title}`,
    `Subject: ${subject}`,
    `Level: ${level}`,
    `Number of chapters: ${chapterCount} (each chapter = exactly one lesson + one quiz)`,
    durationLabel ? `Target duration: ${durationLabel}` : null,
    `Output language: ${language || 'fr'} (write ALL text content — titles, lessons, quizzes — in this language)`,
    targetAudience ? `Target audience: ${targetAudience}` : null,
    objectives ? `Learning objectives: ${objectives}` : null,
    `Questions per quiz: ${questionsPerQuiz || 5}`,
    `Include a final practical exercise (self-assessed by the student, not AI-graded) that ties the whole course together.`,
  ].filter(Boolean).join('\n');
}

/**
 * Vérifie la forme ET la cohérence sémantique de la structure générée
 * (au-delà de ce que responseSchema garantit déjà). Retourne un tableau
 * d'erreurs (vide = valide).
 */
function validateGenerated(data, params) {
  const errors = [];
  if (!data || typeof data !== 'object') return ['La réponse n\'est pas un objet JSON.'];

  if (!data.course || typeof data.course.title !== 'string' || !data.course.title.trim()) {
    errors.push('course.title manquant ou vide.');
  }
  if (!Array.isArray(data.chapters) || data.chapters.length === 0) {
    errors.push('chapters doit être un tableau non vide.');
  } else {
    if (params.chapterCount && data.chapters.length !== Number(params.chapterCount)) {
      errors.push(`chapters.length (${data.chapters.length}) ne correspond pas au nombre demandé (${params.chapterCount}).`);
    }
    data.chapters.forEach((ch, i) => {
      if (!ch.title || !ch.title.trim()) errors.push(`chapters[${i}].title manquant.`);
      if (!ch.lesson || !ch.lesson.explanation || !ch.lesson.explanation.trim()) {
        errors.push(`chapters[${i}].lesson.explanation manquant ou vide.`);
      }
      if (!ch.quiz || !Array.isArray(ch.quiz.questions) || ch.quiz.questions.length === 0) {
        errors.push(`chapters[${i}].quiz.questions doit être un tableau non vide.`);
        return;
      }
      ch.quiz.questions.forEach((q, qi) => {
        if (!QUESTION_TYPES.includes(q.question_type)) {
          errors.push(`chapters[${i}].quiz.questions[${qi}].question_type doit être qcm ou vrai_faux (reçu: ${q.question_type}).`);
        }
        if (!Array.isArray(q.choices) || q.choices.length < 2) {
          errors.push(`chapters[${i}].quiz.questions[${qi}].choices doit avoir au moins 2 options.`);
        } else if (!q.choices.some((c) => c.key === q.correct_answer)) {
          errors.push(`chapters[${i}].quiz.questions[${qi}].correct_answer ("${q.correct_answer}") ne correspond à aucune clé de choices.`);
        }
      });
    });
  }
  if (!data.final_exercise || !data.final_exercise.title || !data.final_exercise.instructions) {
    errors.push('final_exercise.title et final_exercise.instructions sont requis.');
  }
  return errors;
}

async function callGeminiStructured(genAI, prompt) {
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: 'application/json', responseSchema: COURSE_SCHEMA },
  });
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini a renvoyé un JSON illisible.');
  }
}

/**
 * Génère un cours complet. Lève une erreur avec un message clair si Gemini
 * ne parvient pas à produire une structure valide même après une tentative
 * de réparation — ne renvoie jamais de structure partiellement invalide.
 */
async function generateCourse(params) {
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error("Génération IA indisponible : GEMINI_API_KEY manquant côté serveur.");
    err.status = 503;
    throw err;
  }
  if (!LEVELS.includes(params.level)) {
    const err = new Error(`level doit être l'un de : ${LEVELS.join(', ')}.`);
    err.status = 400;
    throw err;
  }
  const chapterCount = Number(params.chapterCount);
  if (!Number.isInteger(chapterCount) || chapterCount < 1 || chapterCount > 10) {
    const err = new Error('chapterCount doit être un entier entre 1 et 10.');
    err.status = 400;
    throw err;
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const prompt = buildUserPrompt(params);

  let data = await callGeminiStructured(genAI, prompt);
  let errors = validateGenerated(data, params);

  if (errors.length) {
    // Une seule tentative de réparation : on renvoie les erreurs exactes à
    // Gemini et on lui redemande une sortie corrigée conforme au schéma.
    const repairPrompt = `${prompt}\n\nYour previous JSON output had these problems, fix them and return the corrected full JSON (same schema):\n- ${errors.join('\n- ')}`;
    data = await callGeminiStructured(genAI, repairPrompt);
    errors = validateGenerated(data, params);
  }

  if (errors.length) {
    const err = new Error(`Gemini n'a pas produit un cours valide après réparation : ${errors.join(' | ')}`);
    err.status = 502;
    throw err;
  }

  return data;
}

module.exports = { generateCourse, validateGenerated, buildUserPrompt, QUESTION_TYPES, LEVELS };
