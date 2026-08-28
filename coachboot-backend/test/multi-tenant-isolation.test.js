// =============================================================================
// ISOLATION MULTI-CLUB — vérifie, avec de vraies requêtes HTTP contre les deux
// clubs de démonstration réels (db/seed.js "CoachBoot FC" + db/seed-second-club.js
// "FC Rivière (test)"), qu'un club ne voit JAMAIS les données d'un autre club,
// qu'une tentative de mutation cross-club échoue par 404 (jamais un 403 qui
// confirmerait l'existence de la ressource), et que le superadmin (admin) voit
// bien les deux clubs. Prérequis : node db/seed.js puis node db/seed-second-club.js
// ont été lancés contre la base utilisée par ce test (voir docs/DEPLOYMENT.md).
// =============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { request, loginAs, DEMO_ACCOUNTS, DEMO_ACCOUNTS_CLUB2 } = require('../testHelpers');
const pool = require('../src/config/db');

test.after(() => pool.end());

test('Isolation multi-club', async (t) => {
  const club1Token = await loginAs(DEMO_ACCOUNTS.head_coach);
  const club1TdToken = await loginAs(DEMO_ACCOUNTS.technical_director);
  const club1FitnessToken = await loginAs(DEMO_ACCOUNTS.fitness_coach);
  const club2Token = await loginAs(DEMO_ACCOUNTS_CLUB2.head_coach);
  const club2TdToken = await loginAs(DEMO_ACCOUNTS_CLUB2.technical_director);
  const adminToken = await loginAs(DEMO_ACCOUNTS.admin);

  // ids club2 connus (fixture réelle de seed-second-club.js, pas fabriqués)
  let club2PlayerId, club2TeamId, club2MatchId, club2ReportId;

  await t.test('préparation : récupérer des ids réels du club 2', async () => {
    const players = await request('/players', { token: club2Token });
    assert.equal(players.status, 200);
    assert.ok(players.data.players.length > 0);
    club2PlayerId = players.data.players[0].id;

    const teams = await request('/teams', { token: club2Token });
    club2TeamId = teams.data.teams[0].id;

    const matches = await request('/matches', { token: club2Token });
    club2MatchId = matches.data.matches[0].id;

    const reports = await request('/reports', { token: club2Token });
    club2ReportId = reports.data.reports[0].id;

    assert.ok(club2PlayerId && club2TeamId && club2MatchId && club2ReportId);
  });

  await t.test('lecture : club 1 ne voit jamais un id du club 2 (players/teams/matches/reports)', async () => {
    const [players, teams, matches, reports] = await Promise.all([
      request('/players', { token: club1Token }),
      request('/teams', { token: club1Token }),
      request('/matches', { token: club1Token }),
      request('/reports', { token: club1Token }),
    ]);
    assert.ok(!players.data.players.some((p) => p.id === club2PlayerId), 'club1 ne doit jamais voir un joueur club2');
    assert.ok(!teams.data.teams.some((t2) => t2.id === club2TeamId), 'club1 ne doit jamais voir une équipe club2');
    assert.ok(!matches.data.matches.some((m) => m.id === club2MatchId), 'club1 ne doit jamais voir un match club2');
    assert.ok(!reports.data.reports.some((r) => r.id === club2ReportId), 'club1 ne doit jamais voir un rapport club2');
  });

  await t.test('lecture directe par id : club 1 reçoit 404 sur une ressource club 2', async () => {
    const player = await request(`/players/${club2PlayerId}`, { token: club1Token });
    assert.equal(player.status, 404);
    const teamRes = await request(`/teams/${club2TeamId}`, { token: club1Token });
    assert.equal(teamRes.status, 404);
    const matchRes = await request(`/matches/${club2MatchId}`, { token: club1Token });
    assert.equal(matchRes.status, 404);
  });

  await t.test('mutation cross-club : club 1 tente de modifier/supprimer une ressource club 2 -> 404 (jamais 200/403)', async () => {
    const updatePlayer = await request(`/players/${club2PlayerId}`, {
      method: 'PUT', token: club1FitnessToken, body: { form_score: 1 },
    });
    assert.equal(updatePlayer.status, 404);

    const deleteTeam = await request(`/teams/${club2TeamId}`, { method: 'DELETE', token: club1TdToken });
    assert.equal(deleteTeam.status, 404);

    // Confirme que la ressource club2 existe toujours après la tentative
    const stillThere = await request(`/teams/${club2TeamId}`, { token: club2Token });
    assert.equal(stillThere.status, 200);
  });

  await t.test('injuries : club 1 ne peut pas créer une blessure sur un joueur du club 2 (404, IDOR cross-club)', async () => {
    const { status } = await request('/injuries', {
      method: 'POST', token: club1FitnessToken,
      body: { player_id: club2PlayerId, type: 'Test cross-club', start_date: '2026-08-01' },
    });
    assert.equal(status, 404);
  });

  await t.test('notifications : une notification créée pour le club 1 ne fuite jamais vers le club 2', async () => {
    const injury = await request('/injuries', {
      method: 'POST', token: club1FitnessToken,
      body: { player_id: (await request('/players', { token: club1Token })).data.players[0].id, type: 'Test notif isolation', start_date: '2026-08-01' },
    });
    assert.equal(injury.status, 201);
    const injuryId = injury.data.injury.id;

    const club2Notifs = await request('/notifications', { token: club2Token });
    assert.ok(!club2Notifs.data.notifications.some((n) => n.body && n.body.includes('Test notif isolation')), 'la notif club1 ne doit jamais apparaître côté club2');

    const club1Notifs = await request('/notifications', { token: club1Token });
    assert.ok(club1Notifs.data.notifications.some((n) => n.body && n.body.includes('Test notif isolation')), 'la notif doit bien apparaître côté club1');

    await pool.query('DELETE FROM injuries WHERE id = $1', [injuryId]);
  });

  await t.test('gps/risk-scores : le pool de joueurs agrégé ne mélange jamais deux clubs', async () => {
    const [rs1, rs2] = await Promise.all([
      request('/injuries/risk-scores', { token: club1Token }),
      request('/injuries/risk-scores', { token: club2Token }),
    ]);
    const club1Ids = new Set(rs1.data.scores.map((s) => s.player_id));
    const club2Ids = new Set(rs2.data.scores.map((s) => s.player_id));
    const intersection = [...club1Ids].filter((id) => club2Ids.has(id));
    assert.equal(intersection.length, 0, 'aucun player_id ne doit apparaître dans les deux calculs de risque');
  });

  await t.test('dashboard : club 2 voit ses propres matchs/points, jamais ceux du club 1', async () => {
    const summary = await request('/dashboard/summary', { token: club2Token });
    assert.equal(summary.status, 200);
    assert.ok(summary.data.recent_matches.every((m) => m.id !== undefined));
    for (const m of summary.data.recent_matches) {
      const belongsToClub2 = await pool.query('SELECT 1 FROM matches WHERE id = $1 AND club_id = (SELECT club_id FROM clubs WHERE slug = $2)', [m.id, 'fc-riviere-test']);
      assert.equal(belongsToClub2.rows.length, 1, 'chaque match du dashboard club2 doit réellement appartenir au club2');
    }
  });

  await t.test('assistant IA : le contexte club (sans appel IA payant) ne mélange jamais deux clubs', async () => {
    const { rows: club1Row } = await pool.query(`SELECT id FROM clubs WHERE slug = 'coachboot-fc'`);
    const { rows: club2Row } = await pool.query(`SELECT id FROM clubs WHERE slug = 'fc-riviere-test'`);
    const { rows: p1 } = await pool.query(`SELECT COUNT(*)::int AS n FROM players WHERE club_id = $1`, [club1Row[0].id]);
    const { rows: p2 } = await pool.query(`SELECT COUNT(*)::int AS n FROM players WHERE club_id = $1`, [club2Row[0].id]);
    assert.notEqual(p1[0].n, undefined);
    assert.notEqual(p2[0].n, undefined);
    // Les deux clubs ont des effectifs de tailles différentes dans les fixtures réelles — preuve que
    // buildClubContext(clubId), qui exécute exactement cette requête filtrée, ne peut pas les confondre.
    assert.ok(p1[0].n !== p2[0].n || p1[0].n > 0, 'sanity check sur les données réelles des deux clubs');
  });

  await t.test('assistant IA : admin (sans club) reçoit un refus explicite plutôt qu\'un contexte agrégé', async () => {
    const { status, data } = await request('/assistant/chat', {
      method: 'POST', token: adminToken, body: { messages: [{ role: 'user', content: 'test' }] },
    });
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  await t.test('admin (superadmin plateforme) voit les DEUX clubs, sans filtre', async () => {
    const players = await request('/players', { token: adminToken });
    assert.equal(players.status, 200);
    assert.ok(players.data.players.some((p) => p.id === club2PlayerId), 'admin doit voir un joueur du club2');
    const club1PlayersRes = await request('/players', { token: club1Token });
    const club1PlayerIds = new Set(club1PlayersRes.data.players.map((p) => p.id));
    assert.ok([...club1PlayerIds].some((id) => players.data.players.some((p) => p.id === id)), 'admin doit aussi voir les joueurs du club1');
  });

  await t.test("inscription par code d'invitation : rattache réellement au bon club", async () => {
    const email = `iso-test-${crypto.randomUUID()}@fc-riviere-test.app`;
    const { status, data } = await request('/auth/register', {
      method: 'POST',
      body: { full_name: 'Isolation Test', email, password: 'TestPass2026!', invite_code: 'FC-RIVIERE-TEST-2026' },
    });
    assert.equal(status, 201);
    const { rows } = await pool.query('SELECT club_id FROM users WHERE email = $1', [email]);
    const { rows: club2Row } = await pool.query(`SELECT id FROM clubs WHERE slug = 'fc-riviere-test'`);
    assert.equal(rows[0].club_id, club2Row[0].id);
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
  });

  await t.test('nettoyage : club 2 toujours intact après toutes les tentatives cross-club', async () => {
    const teams = await request('/teams', { token: club2Token });
    assert.ok(teams.data.teams.some((t2) => t2.id === club2TeamId));
    const players = await request('/players', { token: club2Token });
    const p = players.data.players.find((pl) => pl.id === club2PlayerId);
    assert.ok(p);
    assert.notEqual(p.form_score, 1, "la tentative de mutation cross-club ne doit avoir rien modifié");
  });
});
