// ============================================================================
// COACHBOOT ENTERPRISE — SERVEUR API (Express + PostgreSQL)
// ============================================================================
require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const pool = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { initGpsSocket } = require('./socket/gpsSocket');

const app = express();

// Nécessaire derrière un reverse proxy (Render, etc.) pour que express-rate-limit
// et req.ip lisent la vraie IP cliente via X-Forwarded-For plutôt que celle du proxy.
app.set('trust proxy', 1);

/* ---- Sécurité & middlewares globaux -------------------------------------- */
// Même garde-fou que JWT_SECRET (middleware/auth.js) : un wildcard CORS en
// production laisserait n'importe quel site tiers appeler l'API avec les
// jetons volés d'un utilisateur — refuser de démarrer plutôt que de le
// permettre silencieusement si NODE_ENV=production oublie de le fixer.
if ((!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*') && process.env.NODE_ENV === 'production') {
  throw new Error("CORS_ORIGIN doit être défini sur l'origine exacte du frontend en production (jamais '*') — voir .env.example.");
}
if (!process.env.CORS_ORIGIN) {
  console.warn("⚠️  CORS_ORIGIN non défini — origine '*' acceptée (développement uniquement). À NE JAMAIS utiliser en production.");
}
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Limite le nombre de requêtes pour se prémunir contre les abus (bruteforce login, etc.)
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Trop de tentatives, réessayez plus tard.' } });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

/* ---- Routes ---------------------------------------------------------------- */
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'coachboot-backend', db: 'up', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', service: 'coachboot-backend', db: 'down', time: new Date().toISOString() });
  }
});

// Liveness : le process répond, sans dépendance externe (une base momentanément
// indisponible ne doit pas déclencher un redémarrage du conteneur applicatif).
app.get('/api/health/live', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Readiness : peut réellement servir du trafic (dépend de PostgreSQL) — c'est
// cette route, pas /health/live, qu'un orchestrateur doit interroger avant
// de router du trafic vers cette instance.
app.get('/api/health/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready', db: 'up', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', db: 'down', time: new Date().toISOString() });
  }
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/players', require('./routes/players.routes'));
app.use('/api/teams', require('./routes/teams.routes'));
app.use('/api/matches', require('./routes/matches.routes'));
app.use('/api/trainings', require('./routes/trainings.routes'));
app.use('/api/scouting', require('./routes/scouting.routes'));
app.use('/api/courses', require('./routes/courses.routes'));
app.use('/api/academy', require('./routes/academy.routes'));
app.use('/api/quizzes', require('./routes/quizzes.routes'));
app.use('/api/certificates', require('./routes/certificates.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/notifications', require('./routes/notifications.routes'));
app.use('/api/injuries', require('./routes/injuries.routes'));
app.use('/api/gps', require('./routes/gps.routes'));
app.use('/api/match-live', require('./routes/match-live.routes'));
app.use('/api/video', require('./routes/video-annotations.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/assistant', require('./routes/assistant.routes'));
app.use('/api/ml', require('./routes/ml.routes'));

/* ---- 404 + gestion des erreurs --------------------------------------------- */
app.use('/api', notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;

// http.createServer(app) — nécessaire pour que Socket.io (GPS temps réel) partage
// le même socket serveur qu'Express, plutôt que d'écouter sur un port séparé.
const httpServer = http.createServer(app);
const io = initGpsSocket(httpServer);

const server = httpServer.listen(PORT, () => {
  console.log(`✅ CoachBoot API démarrée sur http://localhost:${PORT}`);
  console.log(`   Vérification santé : GET http://localhost:${PORT}/api/health`);
  console.log(`   GPS temps réel (Socket.io) : ws://localhost:${PORT}`);
});

/* ---- Arrêt propre ----------------------------------------------------------- */
function shutdown(signal) {
  console.log(`\n${signal} reçu, arrêt en cours...`);
  io.close();
  server.close(() => {
    pool.end().then(() => {
      console.log('Serveur, Socket.io et pool PostgreSQL fermés proprement.');
      process.exit(0);
    });
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
