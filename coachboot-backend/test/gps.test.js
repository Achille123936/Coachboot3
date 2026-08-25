const test = require('node:test');
const assert = require('node:assert/strict');
const { request, loginAs, DEMO_ACCOUNTS } = require('../testHelpers');
const pool = require('../src/config/db');

// Un seul pool pour tout le fichier (require() le met en cache) — fermé une
// seule fois à la toute fin. Fermer dans chaque bloc test() casserait le
// suivant qui tenterait d'utiliser un pool déjà fermé (piège déjà rencontré
// dans business.test.js — voir docs/TESTING.md).
test.after(() => pool.end());

function makeHonestJogPoints() {
  // ~150m over 30s (5 m/s ≈ 18 km/h jog), steps well above the algorithm's
  // 1.5m noise floor so real movement isn't itself filtered out.
  const points = [];
  let lat = 48.8566; const lng = 2.3522;
  const start = Date.now() - 30000;
  for (let i = 0; i < 30; i++) {
    lat += 0.000045;
    points.push({ lat, lng, t: start + i * 1000 });
  }
  return points;
}

function makeTeleportPoints() {
  const start = Date.now() - 2000;
  return [
    { lat: 48.8566, lng: 2.3522, t: start },
    { lat: 43.2965, lng: 5.3698, t: start + 1000 }, // Paris -> Marseille en 1s : impossible
  ];
}

test('GPS REST — le serveur ne fait pas confiance aux statistiques calculées côté client', async (t) => {
  const token = await loginAs(DEMO_ACCOUNTS.fitness_coach);
  const { data: playersData } = await request('/players', { token });
  const playerId = playersData.players[0].id;
  const sessionIds = [];

  await t.test('des statistiques falsifiées (999km, 400km/h) sont ignorées au profit du recalcul serveur', async () => {
    const { status, data } = await request('/gps/session', {
      method: 'POST', token,
      body: {
        player_id: playerId, session_date: new Date().toISOString().slice(0, 10),
        points: makeHonestJogPoints(),
        statistics: { distance_km: 999, max_speed_kmh: 400, sprint_count: 500 },
      },
    });
    assert.equal(status, 201);
    assert.equal(data.stats_source, 'server_recomputed');
    const distance = Number(data.statistics.distance_km);
    const maxSpeed = Number(data.statistics.max_speed_kmh);
    assert.ok(distance > 0.05 && distance < 1, `distance falsifiée non filtrée : ${distance}`);
    assert.ok(maxSpeed < 50, `vitesse falsifiée non filtrée : ${maxSpeed}`);
    sessionIds.push(data.session.id);
  });

  await t.test('un saut de position physiquement impossible est exclu du calcul de distance', async () => {
    const { status, data } = await request('/gps/session', {
      method: 'POST', token,
      body: { player_id: playerId, session_date: new Date().toISOString().slice(0, 10), points: makeTeleportPoints() },
    });
    assert.equal(status, 201);
    assert.equal(data.stats_source, 'server_recomputed');
    assert.ok(Number(data.statistics.distance_km) < 1, 'le saut de 500km en 1s doit être filtré comme implausible');
    sessionIds.push(data.session.id);
  });

  await t.test('sans points, les statistiques client sont acceptées mais explicitement marquées "client_trusted"', async () => {
    const { status, data } = await request('/gps/session', {
      method: 'POST', token,
      body: { player_id: playerId, session_date: new Date().toISOString().slice(0, 10), points: [], statistics: { distance_km: 5.2, max_speed_kmh: 28 } },
    });
    assert.equal(status, 201);
    assert.equal(data.stats_source, 'client_trusted');
    assert.equal(Number(data.statistics.distance_km), 5.2);
    sessionIds.push(data.session.id);
  });

  await t.test('nettoyage des sessions GPS de test', async () => {
    await pool.query('DELETE FROM gps_sessions WHERE id = ANY($1)', [sessionIds]);
  });
});

test('GPS REST — IDOR : un compte "player" ne peut voir que ses propres données GPS', async (t) => {
  const staffToken = await loginAs(DEMO_ACCOUNTS.fitness_coach);
  const playerToken = await loginAs(DEMO_ACCOUNTS.player);
  let ownPlayerId, otherPlayerId, otherSessionId;

  await t.test('préparation : identifier le joueur lié au compte "player" et un autre joueur', async () => {
    const { data: me } = await request('/players/me', { token: playerToken });
    ownPlayerId = me.player.id;
    const { data: all } = await request('/players', { token: staffToken });
    otherPlayerId = all.players.find(p => p.id !== ownPlayerId).id;
    assert.ok(ownPlayerId && otherPlayerId);
  });

  await t.test('préparation : créer une session GPS pour l\'autre joueur (en tant que staff)', async () => {
    const { status, data } = await request('/gps/session', {
      method: 'POST', token: staffToken,
      body: { player_id: otherPlayerId, session_date: new Date().toISOString().slice(0, 10), points: [], statistics: { distance_km: 4.1 } },
    });
    assert.equal(status, 201);
    otherSessionId = data.session.id;
  });

  await t.test('player -> ses propres stats GPS : ALLOW', async () => {
    const { status } = await request(`/gps/player/${ownPlayerId}/stats`, { token: playerToken });
    assert.equal(status, 200);
  });

  await t.test('player -> stats GPS d\'un autre joueur : DENY (403)', async () => {
    const { status } = await request(`/gps/player/${otherPlayerId}/stats`, { token: playerToken });
    assert.equal(status, 403);
  });

  await t.test('player -> détail de session GPS d\'un autre joueur : DENY (403)', async () => {
    const { status } = await request(`/gps/session/${otherSessionId}`, { token: playerToken });
    assert.equal(status, 403);
  });

  await t.test('player -> liste GPS sans player_id : 400 (pas de fuite silencieuse de toutes les sessions)', async () => {
    const { status } = await request('/gps', { token: playerToken });
    assert.equal(status, 400);
  });

  await t.test('player -> liste GPS filtrée sur un autre joueur : DENY (403)', async () => {
    const { status } = await request(`/gps?player_id=${otherPlayerId}`, { token: playerToken });
    assert.equal(status, 403);
  });

  await t.test('staff -> détail de session GPS de n\'importe quel joueur : ALLOW (inchangé)', async () => {
    const { status } = await request(`/gps/session/${otherSessionId}`, { token: staffToken });
    assert.equal(status, 200);
  });

  await t.test('nettoyage', async () => {
    await pool.query('DELETE FROM gps_sessions WHERE id = $1', [otherSessionId]);
  });
});
