// Authentication + authorization middleware.
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET est requis en production (voir .env.example).');
}
if (!process.env.JWT_SECRET) {
  // NODE_ENV=production n'est pas toujours défini explicitement (conteneur,
  // hébergeur générique) — avertir bruyamment plutôt que de signer des jetons
  // (y compris role: 'admin') avec un secret public connu en silence.
  console.warn('⚠️  JWT_SECRET non défini — utilisation du secret de développement par défaut. À NE JAMAIS utiliser en production.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Version du format de jeton JWT. Incrémentée quand la FORME du payload change
// de façon incompatible (ex. ajout de club_id lors de la retrofit multi-club) —
// tout jeton signé avant ce changement n'a pas de club_id et doit être rejeté
// plutôt que traité comme "aucun club" par erreur. Un jeton rejeté ici force
// simplement une reconnexion (POST /auth/login), qui émet un jeton à jour.
const TOKEN_VERSION = 2;

/** Verifies the Bearer token and attaches { id, role, email, club_id, v } to req.user. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentification requise. En-tête Authorization: Bearer <token> manquant.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.v !== TOKEN_VERSION) {
      // Jeton émis avant la retrofit multi-club (pas de club_id fiable) — jamais
      // traité comme "admin toutes clubs" par défaut, jamais toléré silencieusement.
      return res.status(401).json({ error: 'Session expirée suite à une mise à jour de sécurité. Merci de vous reconnecter.' });
    }
    req.user = payload; // { id, role, email, club_id, v }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Jeton invalide ou expiré.' });
  }
}

/** Restricts a route to one or more roles. Use after requireAuth. */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
    if (!allowedRoles.includes(req.user.role) && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Accès refusé : votre rôle ne permet pas cette action." });
    }
    next();
  };
}

/**
 * Injecte req.clubId à partir du jeton — à utiliser après requireAuth sur
 * toute route dont les données sont rattachées à un club. `admin` (superadmin
 * plateforme) a club_id=null dans le jeton => req.clubId=null, un SENTINEL
 * signifiant "pas de filtre, toutes les clubs" — voir utils/tenantScope.js.
 * Tout autre rôle DOIT avoir un club_id (garanti par chk_users_club_id en base
 * et par l'inscription par code d'invitation) ; son absence est une anomalie
 * de compte, pas un cas "toutes clubs" silencieux.
 */
function requireClubScope(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
  if (req.user.role === 'admin') {
    req.clubId = null;
    return next();
  }
  if (!req.user.club_id) {
    return res.status(403).json({ error: 'Compte non rattaché à un club.' });
  }
  req.clubId = req.user.club_id;
  next();
}

module.exports = { requireAuth, requireRole, requireClubScope, TOKEN_VERSION, JWT_SECRET };
