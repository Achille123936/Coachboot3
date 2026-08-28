const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireClubScope } = require('../middleware/auth');

const SYSTEM_PROMPT_BASE = `Tu es l'assistant IA de CoachBoot Enterprise, une plateforme de gestion de club de football (joueurs, équipes, matchs, entraînements, blessures, GPS, scouting, formation).
Réponds en français, de façon concise et utile, en t'appuyant sur le contexte du club fourni ci-dessous quand la question s'y prête.
Si une information précise n'est pas dans le contexte fourni, dis-le clairement plutôt que d'inventer un chiffre.`;

// Fournisseur IA actif : 'anthropic' (Claude, par défaut) ou 'gemini' (Google).
// Choix explicite par variable d'environnement — jamais de repli silencieux d'un
// fournisseur vers l'autre, pour ne jamais masquer une mauvaise config en prod.
const AI_PROVIDER = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
// gemini-2.5-flash/gemini-2.0-flash sont dépréciés côté Google (confirmé par
// l'API elle-même : 404 "no longer available... use models/gemini-3.6-flash")
// au moment de l'écriture de ce code — GEMINI_MODEL permet de suivre les
// prochains changements de Google sans toucher au code.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

/** Construit l'instantané du contexte club (identique pour les deux fournisseurs,
 *  pour que Claude et Gemini répondent à partir des mêmes données réelles).
 *  Club-scopé : jamais d'agrégat multi-club dans un même prompt (voir POST /chat). */
async function buildClubContext(clubId) {
  const [{ rows: [playerStats] }, { rows: [nextMatch] }, { rows: [injuryStats] }] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'Disponible')::int AS available FROM players WHERE club_id = $1`, [clubId]),
    pool.query(`SELECT home_team, away_team, match_date, competition FROM matches WHERE club_id = $1 AND status = 'À venir' ORDER BY match_date ASC LIMIT 1`, [clubId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM injuries WHERE club_id = $1 AND status != 'Rétabli'`, [clubId]),
  ]);

  return [
    `Effectif : ${playerStats.available}/${playerStats.total} joueurs disponibles.`,
    injuryStats.n > 0 ? `${injuryStats.n} joueur(s) actuellement blessé(s) ou en soins.` : `Aucune blessure active.`,
    nextMatch
      ? `Prochain match : ${nextMatch.home_team} vs ${nextMatch.away_team} (${nextMatch.competition}) le ${new Date(nextMatch.match_date).toLocaleDateString('fr-FR')}.`
      : `Aucun match à venir programmé.`,
  ].join(' ');
}

/** Appelle Claude (Anthropic) — chemin historique, inchangé. */
async function callAnthropic(systemPrompt, messages) {
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    output_config: { effort: 'low' },
    system: systemPrompt,
    messages,
  });
  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

/** Appelle Gemini (Google) — chemin alternatif.
 *  Convertit le format { role: 'user'|'assistant', content } utilisé côté
 *  CoachBoot vers le format Gemini { role: 'user'|'model', parts: [{ text }] } :
 *  tout l'historique sauf le dernier message devient `history`, le dernier
 *  message est envoyé via sendMessage(). */
async function callGemini(systemPrompt, messages) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction: systemPrompt });

  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const lastMessage = messages[messages.length - 1];

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);
  return result.response.text() || '';
}

/**
 * POST /api/assistant/chat
 * body: { messages: [{ role: 'user'|'assistant', content: string }, ...] }
 * Répond via Claude (Anthropic) ou Gemini (Google), selon AI_PROVIDER côté
 * serveur, avec un instantané des données du club injecté dans le system
 * prompt pour ancrer les réponses dans la réalité.
 */
router.post('/chat', requireAuth, requireClubScope, asyncHandler(async (req, res) => {
  if (req.clubId === null) {
    // Admin (superadmin plateforme) : pas de club unique à contextualiser —
    // refuser explicitement plutôt que d'agréger silencieusement tous les
    // clubs dans un même prompt (fuite de données entre clubs via l'IA).
    return res.status(400).json({ error: "L'assistant IA est propre à un club — connectez-vous avec un compte de club." });
  }
  if (AI_PROVIDER === 'gemini') {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: "Assistant IA non configuré : GEMINI_API_KEY manquant côté serveur (AI_PROVIDER=gemini)." });
    }
  } else if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "Assistant IA non configuré : ANTHROPIC_API_KEY manquant côté serveur." });
  }

  const { messages } = req.body;
  const safeMessages = Array.isArray(messages)
    ? messages
        .filter(m => m && typeof m.content === 'string' && m.content.trim() && ['user', 'assistant'].includes(m.role))
        .slice(-20)
    : [];
  if (!safeMessages.length) {
    return res.status(400).json({ error: 'messages (tableau non vide, { role, content }) est requis.' });
  }

  const context = await buildClubContext(req.clubId);
  const systemPrompt = `${SYSTEM_PROMPT_BASE}\n\nContexte actuel du club : ${context}`;

  const reply = AI_PROVIDER === 'gemini'
    ? await callGemini(systemPrompt, safeMessages)
    : await callAnthropic(systemPrompt, safeMessages);

  res.json({ reply, provider: AI_PROVIDER });
}));

module.exports = router;
