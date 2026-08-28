// =============================================================================
// ISOLATION MULTI-CLUB — Socket.io (canal GPS temps réel, gpsSocket.js)
// Surface indépendante de l'API REST : vérifie ici que match:joinAsCoach et
// match:joinAsPlayer refusent bien un match/joueur d'un AUTRE club, en plus
// de l'authentification JWT déjà exigée à la connexion.
// =============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { request, loginAs, DEMO_ACCOUNTS, DEMO_ACCOUNTS_CLUB2, BASE_URL } = require('../testHelpers');
const pool = require('../src/config/db');

test.after(() => pool.end());

const SOCKET_URL = BASE_URL.replace(/\/api$/, '');

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

function waitForEvent(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

test('Isolation multi-club — Socket.io GPS temps réel', async (t) => {
  const club1Token = await loginAs(DEMO_ACCOUNTS.head_coach);
  const club2Token = await loginAs(DEMO_ACCOUNTS_CLUB2.head_coach);
  const club2PlayerToken = await loginAs(DEMO_ACCOUNTS_CLUB2.player);

  let club1MatchLiveId, club2PlayerId;
  let socket1, socket2, socket2Player;

  await t.test('préparation : une session Match Live club1 + un joueur club2 réel', async () => {
    const created = await request('/match-live', {
      method: 'POST', token: club1Token, body: { team_home: 'Test A', team_away: 'Test B' },
    });
    assert.equal(created.status, 201);
    club1MatchLiveId = created.data.match_live.id;

    const players = await request('/players', { token: club2Token });
    club2PlayerId = players.data.players[0].id;
    assert.ok(club2PlayerId);
  });

  await t.test('un compte club2 ne peut PAS observer (joinAsCoach) un match Match Live du club1', async () => {
    socket2 = await connectSocket(club2Token);
    socket2.emit('match:joinAsCoach', { matchId: club1MatchLiveId });
    const err = await waitForEvent(socket2, 'gps:error');
    assert.ok(err.message);
  });

  await t.test('un compte club1 PEUT observer son propre match (contrôle positif)', async () => {
    socket1 = await connectSocket(club1Token);
    socket1.emit('match:joinAsCoach', { matchId: club1MatchLiveId });
    const joined = await waitForEvent(socket1, 'match:joined');
    assert.equal(joined.matchId, club1MatchLiveId);
  });

  await t.test('un joueur du club2 ne peut PAS reporter sa position sur un match du club1 (joinAsPlayer)', async () => {
    socket2Player = await connectSocket(club2PlayerToken);
    socket2Player.emit('match:joinAsPlayer', { matchId: club1MatchLiveId, playerId: club2PlayerId });
    const err = await waitForEvent(socket2Player, 'gps:error');
    assert.ok(err.message);
  });

  await t.test('nettoyage', async () => {
    [socket1, socket2, socket2Player].forEach((s) => s && s.disconnect());
    await pool.query('DELETE FROM matches_live WHERE id = $1', [club1MatchLiveId]);
  });
});
