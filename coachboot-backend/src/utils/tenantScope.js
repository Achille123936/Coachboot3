// Helper d'isolation multi-club — mirroir du même idiome `conditions`/`params`
// déjà utilisé dans chaque route (voir players.routes.js) pour rester cohérent
// avec le reste du code plutôt que d'introduire un nouveau patron de requête.

/**
 * Pousse une condition `<columnExpr> = $N` dans `conditions`/`params`, SAUF
 * si clubId est null (sentinel = admin/superadmin plateforme => aucun filtre,
 * toutes les clubs). Ne fait rien d'autre : elle ne valide pas clubId, elle
 * ne devine rien — l'appelant doit passer req.clubId tel que req.clubId a été
 * fixé par requireClubScope.
 */
function addClubFilter(conditions, params, clubId, columnExpr = 'club_id') {
  if (clubId === null || clubId === undefined) return; // admin : pas de filtre
  params.push(clubId);
  conditions.push(`${columnExpr} = $${params.length}`);
}

module.exports = { addClubFilter };
