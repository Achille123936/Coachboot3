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

/** Verifies the Bearer token and attaches { id, role, email } to req.user. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentification requise. En-tête Authorization: Bearer <token> manquant.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, role, email }
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

module.exports = { requireAuth, requireRole, JWT_SECRET };
