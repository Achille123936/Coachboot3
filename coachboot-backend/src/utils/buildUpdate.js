// Shared helper for partial UPDATE queries built from a whitelist of allowed columns.
// Used by every route that supports PATCH-style partial updates (players, teams, matches,
// scouting, injuries) to avoid re-implementing the same "SET col = $n" loop in each file.

/**
 * Builds `SET col1 = $1, col2 = $2, ...` clauses + params from req.body, restricted to `fields`.
 * @param {string[]} fields - whitelist of column names allowed to be updated
 * @param {object} body - request body
 * @returns {{ updates: string[], params: any[] }}
 */
function buildUpdateSet(fields, body) {
  const updates = [];
  const params = [];
  fields.forEach((f) => {
    if (body[f] !== undefined) {
      params.push(body[f]);
      updates.push(`${f} = $${params.length}`);
    }
  });
  return { updates, params };
}

module.exports = { buildUpdateSet };
