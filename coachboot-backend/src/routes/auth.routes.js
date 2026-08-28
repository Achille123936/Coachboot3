const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, JWT_SECRET, TOKEN_VERSION } = require('../middleware/auth');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h
function hashResetToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

const ROLES = ['admin', 'president', 'technical_director', 'head_coach', 'fitness_coach',
  'goalkeeper_coach', 'video_analyst', 'data_analyst', 'player', 'parent', 'federation'];

// Auto-inscription : jamais 'admin' (superadmin plateforme, toutes clubs) — un
// compte admin ne peut être créé qu'en base directement (seed / opération
// manuelle), pas via un formulaire public. Corrige au passage une élévation de
// privilège pré-existante (POST /register acceptait n'importe quel rôle).
const SELF_REGISTER_ROLES = ROLES.filter((r) => r !== 'admin');

function signToken(user) {
  // club_id : null UNIQUEMENT pour role='admin' (superadmin plateforme) — voir
  // requireClubScope. v: TOKEN_VERSION permet de rejeter, à la vérification,
  // tout jeton signé avant cette forme (sans club_id fiable) — voir middleware/auth.js.
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, full_name: user.full_name, club_id: user.club_id ?? null, v: TOKEN_VERSION },
    JWT_SECRET, { expiresIn: '7d' }
  );
}

function sanitizeUser(u) {
  const { password_hash, ...safe } = u;
  return safe;
}

/** Dérive un slug URL-safe à partir d'un nom de club (minuscules, ascii, tirets). */
function slugify(name) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'club';
}

/** Génère un code d'invitation lisible et probabilistiquement unique (slug + suffixe aléatoire). */
function generateInviteCode(slug) {
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 caractères hex
  return `${slug.toUpperCase()}-${suffix}`;
}

/**
 * POST /api/auth/register
 * Crée un compte utilisateur et renvoie un jeton JWT (connexion automatique).
 *
 * MULTI-CLUB : exactement UN des deux doit être fourni —
 *  - `invite_code` : rejoint un club EXISTANT (`clubs.invite_code`), pas de
 *    liste publique de clubs à choisir dans un menu ouvert à tous.
 *  - `new_club_name` : CRÉE un nouveau club (premier compte de ce club) — le
 *    slug et un code d'invitation sont générés automatiquement et renvoyés
 *    dans la réponse (`club.invite_code`) pour que ce premier utilisateur
 *    puisse le partager avec le reste de son équipe. Chaque équipe crée ainsi
 *    son propre club au lieu de rejoindre un club préexistant — décision
 *    produit explicite (voir le plan de la retrofit multi-tenant).
 */
router.post('/register', [
  body('full_name').trim().isLength({ min: 2 }).withMessage('Le nom complet est requis.'),
  body('email').isEmail().withMessage('Adresse e-mail invalide.'),
  body('password').isLength({ min: 8 }).withMessage('Le mot de passe doit contenir au moins 8 caractères.'),
  body('role').optional().isIn(SELF_REGISTER_ROLES).withMessage('Rôle invalide.'),
  body('invite_code').optional().trim().notEmpty(),
  body('new_club_name').optional().trim().isLength({ min: 2 }).withMessage('Le nom du club doit contenir au moins 2 caractères.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg, details: errors.array() });

  const { full_name, email, password, role, invite_code, new_club_name } = req.body;
  if (!invite_code && !new_club_name) {
    return res.status(400).json({ error: "Fournissez soit un code d'invitation (invite_code), soit le nom d'un nouveau club à créer (new_club_name)." });
  }
  if (invite_code && new_club_name) {
    return res.status(400).json({ error: "Fournissez invite_code OU new_club_name, pas les deux." });
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length) return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.' });

  const password_hash = await bcrypt.hash(password, 10);
  const initials = full_name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');

  let clubId, createdClub = null;

  if (invite_code) {
    const { rows: clubRows } = await pool.query(
      'SELECT id FROM clubs WHERE invite_code = $1 AND is_active = TRUE', [invite_code.trim()]
    );
    if (!clubRows.length) return res.status(404).json({ error: "Code d'invitation de club introuvable ou inactif." });
    clubId = clubRows[0].id;

    const { rows } = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, avatar_initials, club_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, full_name, email, role, avatar_initials, club_id, created_at`,
      [full_name.trim(), email.toLowerCase(), password_hash, role || 'player', initials, clubId]
    );
    const user = rows[0];
    return res.status(201).json({ user, token: signToken(user) });
  }

  // new_club_name : crée le club ET son premier utilisateur dans une seule transaction —
  // jamais un club orphelin sans utilisateur si l'insertion du compte échoue.
  const baseSlug = slugify(new_club_name);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Un slug dérivé du nom peut déjà exister (deux clubs au nom proche) — on
    // ajoute un court suffixe aléatoire dans ce cas plutôt que d'échouer.
    let slug = baseSlug;
    const { rows: slugTaken } = await client.query('SELECT 1 FROM clubs WHERE slug = $1', [slug]);
    if (slugTaken.length) slug = `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`;
    const inviteCode = generateInviteCode(baseSlug);

    const { rows: clubRows } = await client.query(
      `INSERT INTO clubs (name, slug, invite_code) VALUES ($1,$2,$3) RETURNING id, name, slug, invite_code`,
      [new_club_name.trim(), slug, inviteCode]
    );
    createdClub = clubRows[0];
    clubId = createdClub.id;

    // Rôle par défaut du créateur d'un club : technical_director (rôle de
    // gestion existant), pas 'player' — mais l'appelant peut choisir un autre
    // rôle de club explicitement (jamais 'admin', voir SELF_REGISTER_ROLES).
    const { rows: userRows } = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, avatar_initials, club_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, full_name, email, role, avatar_initials, club_id, created_at`,
      [full_name.trim(), email.toLowerCase(), password_hash, role || 'technical_director', initials, clubId]
    );

    await client.query('COMMIT');
    const user = userRows[0];
    res.status(201).json({ user, token: signToken(user), club: createdClub });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
    'SELECT id, full_name, email, role, avatar_initials, club_id, created_at FROM users WHERE id = $1', [req.user.id]
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
