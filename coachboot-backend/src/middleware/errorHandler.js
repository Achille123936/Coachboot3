// Centralized error handler — keeps route handlers free of repetitive try/catch boilerplate
// when combined with the asyncHandler wrapper below.
function notFound(req, res) {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  const message = status === 500 ? 'Erreur interne du serveur.' : err.message;
  res.status(status).json({ error: message });
}

/** Wraps an async route handler so rejected promises reach errorHandler automatically. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { notFound, errorHandler, asyncHandler };
