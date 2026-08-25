const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h
function hashResetToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

const ROLES = ['admin', 'president', 'technical_director', 'head_coach', 'fitness_coach',
  'goalkeeper_coach', 'video_analyst', 'data_analyst', 'player', 'parent', 'federation'];

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    JWT_SECRET, { expiresIn: '7d' });
}

function sanitizeUser(u) {
  const { password_hash, ...safe } = u;
  return safe;
}

/**
 * POST /api/auth/register
 * Crée un compte utilisateur et renvoie un jeton JWT (connexion automatique).
 */
router.post('/register', [
  body('full_name').trim().isLength({ min: 2 }).withMessage('Le nom complet est requis.'),
  body('email').isEmail().withMessage('Adresse e-mail invalide.'),
  body('password').isLength({ min: 8 }).withMessage('Le mot de passe doit contenir au moins 8 caractères.'),
  body('role').optional().isIn(ROLES).withMessage('Rôle invalide.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg, details: errors.array() });

  const { full_name, email, password, role } = req.body;
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length) return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.' });

  const password_hash = await bcrypt.hash(password, 10);
  const initials = full_name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');

  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role, avatar_initials)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, full_name, email, role, avatar_initials, created_at`,
    [full_name.trim(), email.toLowerCase(), password_hash, role || 'player', initials]
  );
  const user = rows[0];
  const token = signToken(user);
  res.status(201).json({ user, token });
}));

/**
 * POST /api/auth/login
 * Vérifie l'e-mail/mot de passe et renvoie un jeton JWT.
 */
router.post('/login', [
  body('email').isEmail().withMessage('Adresse e-mail invalide.'),
  body('password').notEmpty().withMessage('Mot de passe requis.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active = TRUE', [email.toLowerCase()]);
  if (!rows.length) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });

  const token = signToken(user);
  res.json({ user: sanitizeUser(user), token });
}));

/**
 * GET /api/auth/me
 * Renvoie le profil de l'utilisateur actuellement authentifié (à partir du jeton).
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, full_name, email, role, avatar_initials, created_at FROM users WHERE id = $1', [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({ user: rows[0] });
}));

/**
 * POST /api/auth/forgot-password
 * Génère un jeton de réinitialisation à durée de vie limitée (1h). Seul son
 * HACHAGE (SHA-256) est stocké en base — jamais le jeton en clair, comme un
 * mot de passe. Réponse volontairement identique que l'e-mail existe ou non
 * (anti-énumération de comptes).
 *
 * LIMITE HONNÊTE : aucun service d'envoi d'e-mail (SMTP/API tierce type
 * SendGrid/Resend) n'est configuré dans ce projet — le jeton est donc généré
 * et stocké réellement, mais jamais livré à l'utilisateur par e-mail. En
 * développement/test (NODE_ENV != 'production'), la réponse inclut le jeton
 * brut pour permettre de tester le flux de bout en bout ; en production, il
 * n'est JAMAIS renvoyé dans la réponse HTTP — voir `email_status` ci-dessous.
 */
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Adresse e-mail invalide.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { email } = req.body;
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1 AND is_active = TRUE', [email.toLowerCase()]);

  const genericResponse = {
    message: 'Si un compte existe avec cette adresse e-mail, un lien de réinitialisation a été généré.',
    email_status: 'EMAIL_SERVICE_NOT_CONFIGURED',
  };

  if (rows.length) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await pool.query(
      'UPDATE users SET password_reset_token_hash = $1, password_reset_expires_at = $2 WHERE id = $3',
      [hashResetToken(rawToken), expiresAt, rows[0].id]
    );
    if (process.env.NODE_ENV !== 'production') {
      genericResponse.dev_reset_token = rawToken; // jamais exposé en production
    }
  }

  res.json(genericResponse);
}));

/**
 * POST /api/auth/reset-password
 * Consomme un jeton de réinitialisation valide (non expiré) et remplace le
 * mot de passe. Le jeton est à usage unique : les colonnes sont effacées
 * après utilisation.
 */
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Jeton requis.'),
  body('new_password').isLength({ min: 8 }).withMessage('Le nouveau mot de passe doit contenir au moins 8 caractères.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { token, new_password } = req.body;
  const tokenHash = hashResetToken(token);
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE password_reset_token_hash = $1 AND password_reset_expires_at > now()`,
    [tokenHash]
  );
  if (!rows.length) return res.status(400).json({ error: 'Jeton invalide ou expiré.' });

  const password_hash = await bcrypt.hash(new_password, 10);
  await pool.query(
    `UPDATE users SET password_hash = $1, password_reset_token_hash = NULL, password_reset_expires_at = NULL WHERE id = $2`,
    [password_hash, rows[0].id]
  );
  res.json({ message: 'Mot de passe réinitialisé avec succès.' });
}));

/**
 * PUT /api/auth/change-password
 * Change le mot de passe de l'utilisateur connecté (exige l'ancien mot de passe).
 */
router.put('/change-password', requireAuth, [
  body('current_password').notEmpty().withMessage('Le mot de passe actuel est requis.'),
  body('new_password').isLength({ min: 8 }).withMessage('Le nouveau mot de passe doit contenir au moins 8 caractères.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg, details: errors.array() });

  const { current_password, new_password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const valid = await bcrypt.compare(current_password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

  const password_hash = await bcrypt.hash(new_password, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, req.user.id]);
  res.json({ message: 'Mot de passe changé avec succès.' });
}));

module.exports = router;
