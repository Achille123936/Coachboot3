const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express param handler for routes shaped `/:id`. Rejects non-UUID values
 * with a clean 400 instead of letting Postgres throw `invalid input syntax
 * for type uuid`, which asyncHandler forwarded to the generic error handler
 * as an opaque 500 — for entirely plausible client input (stale link, typo).
 * Use via `router.param('id', validateUuidParam)`.
 */
function validateUuidParam(req, res, next, value) {
  if (!UUID_RE.test(value)) {
    return res.status(400).json({ error: `Identifiant invalide : "${value}" n'est pas un UUID valide.` });
  }
  next();
}

module.exports = { validateUuidParam };
