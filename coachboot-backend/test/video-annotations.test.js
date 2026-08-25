const test = require('node:test');
const assert = require('node:assert/strict');
const { request, loginAs, DEMO_ACCOUNTS } = require('../testHelpers');
const pool = require('../src/config/db');

// Un seul pool pour tout le fichier, fermé une seule fois à la fin — piège
// documenté dans docs/TESTING.md (pool fermé deux fois dans le même fichier).
test.after(() => pool.end());

test('Télestration vidéo — clips + annotations, CRUD réel et rôles', async (t) => {
  const staffToken = await loginAs('video@coachboot.app'); // video_analyst
  const playerToken = await loginAs(DEMO_ACCOUNTS.player);
  let clipId;
  let annotationId;

  await t.test('POST /video/clips crée un clip réel', async () => {
    const { status, data } = await request('/video/clips', {
      method: 'POST', token: staffToken,
      body: { title: 'Test — analyse pressing', video_url: 'https://example.com/match.mp4', source_type: 'url' },
    });
    assert.equal(status, 201);
    assert.ok(data.clip.id);
    assert.equal(data.clip.title, 'Test — analyse pressing');
    clipId = data.clip.id;
  });

  await t.test('un compte "player" ne peut pas créer de clip (403)', async () => {
    const { status } = await request('/video/clips', {
      method: 'POST', token: playerToken,
      body: { title: 'Ne devrait jamais exister' },
    });
    assert.equal(status, 403);
  });

  await t.test('un compte "player" peut quand même lister les clips (lecture ouverte)', async () => {
    const { status, data } = await request('/video/clips', { token: playerToken });
    assert.equal(status, 200);
    assert.ok(data.clips.some((c) => c.id === clipId));
  });

  await t.test('POST /video/clips/:id/annotations crée une flèche réelle avec fenêtre temporelle', async () => {
    const { status, data } = await request(`/video/clips/${clipId}/annotations`, {
      method: 'POST', token: staffToken,
      body: {
        type: 'arrow',
        data: { from: { x: 100, y: 200 }, to: { x: 300, y: 150 }, color: '#2C8F5E', thickness: 3 },
        timestamp_start_sec: 12.5,
        timestamp_end_sec: 15,
      },
    });
    assert.equal(status, 201);
    assert.equal(data.annotation.type, 'arrow');
    assert.equal(Number(data.annotation.timestamp_start_sec), 12.5);
    annotationId = data.annotation.id;
  });

  await t.test('type d\'annotation invalide est rejeté (400)', async () => {
    const { status } = await request(`/video/clips/${clipId}/annotations`, {
      method: 'POST', token: staffToken,
      body: { type: 'laser_beam', data: {}, timestamp_start_sec: 0 },
    });
    assert.equal(status, 400);
  });

  await t.test('GET /video/clips/:id/annotations liste triée par timestamp', async () => {
    await request(`/video/clips/${clipId}/annotations`, {
      method: 'POST', token: staffToken,
      body: { type: 'circle', data: { cx: 50, cy: 50, r: 20, color: '#E0972E' }, timestamp_start_sec: 2 },
    });
    const { status, data } = await request(`/video/clips/${clipId}/annotations`, { token: staffToken });
    assert.equal(status, 200);
    assert.equal(data.annotations.length, 2);
    assert.ok(Number(data.annotations[0].timestamp_start_sec) <= Number(data.annotations[1].timestamp_start_sec));
  });

  await t.test('PUT /video/annotations/:id modifie réellement la position et la couleur', async () => {
    const { status, data } = await request(`/video/annotations/${annotationId}`, {
      method: 'PUT', token: staffToken,
      body: { data: { from: { x: 110, y: 210 }, to: { x: 310, y: 160 }, color: '#E0972E', thickness: 4 } },
    });
    assert.equal(status, 200);
    assert.equal(data.annotation.data.color, '#E0972E');
  });

  await t.test('DELETE /video/clips/:id supprime le clip ET ses annotations en cascade', async () => {
    const { status } = await request(`/video/clips/${clipId}`, { method: 'DELETE', token: staffToken });
    assert.equal(status, 204);
    const { rows } = await pool.query('SELECT id FROM video_annotations WHERE clip_id = $1', [clipId]);
    assert.equal(rows.length, 0, 'les annotations doivent disparaître avec le clip (ON DELETE CASCADE)');
  });
});

test('Télestration vidéo — corrélation GPS (GET /video/annotations/:id/gps)', async (t) => {
  const staffToken = await loginAs(DEMO_ACCOUNTS.fitness_coach);
  const playerToken = await loginAs(DEMO_ACCOUNTS.player);
  let ownPlayerId, otherPlayerId, clipId, anchorClipId, annoNoAnchor, annoOwn, annoOther;
  let gpsSessionId, matchLiveId;
  const anchor = new Date(Date.now() - 3600 * 1000); // il y a 1h, pour ne heurter aucune donnée réelle

  await t.test('préparation : identifier le joueur lié au compte "player" et un autre joueur', async () => {
    const { data: me } = await request('/players/me', { token: playerToken });
    ownPlayerId = me.player.id;
    const { data: all } = await request('/players', { token: staffToken });
    otherPlayerId = all.players.find((p) => p.id !== ownPlayerId).id;
    assert.ok(ownPlayerId && otherPlayerId);
  });

  await t.test('préparation : clip avec ancrage horaire + joueur, et clip sans ancrage', async () => {
    const { status, data } = await request('/video/clips', {
      method: 'POST', token: staffToken,
      body: { title: 'Test GPS link', video_url: 'https://example.com/gps.mp4', player_id: ownPlayerId, recorded_at_start: anchor.toISOString() },
    });
    assert.equal(status, 201);
    assert.equal(data.clip.player_id, ownPlayerId);
    clipId = data.clip.id;

    const noAnchor = await request('/video/clips', { method: 'POST', token: staffToken, body: { title: 'Test sans ancrage' } });
    anchorClipId = noAnchor.data.clip.id;
  });

  await t.test('préparation : annotations (avec joueur sur clip ancré, sans joueur ailleurs, pour un autre joueur)', async () => {
    const a1 = await request(`/video/clips/${clipId}/annotations`, {
      method: 'POST', token: staffToken,
      body: { type: 'player_marker', data: { x: 0.5, y: 0.5, label: '#test' }, timestamp_start_sec: 60, player_id: ownPlayerId },
    });
    assert.equal(a1.status, 201);
    annoOwn = a1.data.annotation.id;

    const a2 = await request(`/video/clips/${anchorClipId}/annotations`, {
      method: 'POST', token: staffToken,
      body: { type: 'text', data: { x: 0.2, y: 0.2, text: 'sans ancrage' }, timestamp_start_sec: 5, player_id: ownPlayerId },
    });
    assert.equal(a2.status, 201);
    annoNoAnchor = a2.data.annotation.id;

    const a3 = await request(`/video/clips/${clipId}/annotations`, {
      method: 'POST', token: staffToken,
      body: { type: 'circle', data: { cx: 0.3, cy: 0.3, r: 0.05 }, timestamp_start_sec: 10, player_id: otherPlayerId },
    });
    assert.equal(a3.status, 201);
    annoOther = a3.data.annotation.id;
  });

  await t.test('clip sans ancrage horaire -> found:false, reason:no_time_anchor', async () => {
    const { status, data } = await request(`/video/annotations/${annoNoAnchor}/gps`, { token: staffToken });
    assert.equal(status, 200);
    assert.equal(data.found, false);
    assert.equal(data.reason, 'no_time_anchor');
  });

  await t.test('clip ancré mais aucune donnée GPS réelle à proximité -> found:false, reason:no_nearby_gps_data', async () => {
    const { status, data } = await request(`/video/annotations/${annoOwn}/gps`, { token: staffToken });
    assert.equal(status, 200);
    assert.equal(data.found, false);
    assert.equal(data.reason, 'no_nearby_gps_data');
  });

  await t.test('un vrai point GPS (gps_points) à 30s de la cible est trouvé', async () => {
    gpsSessionId = require('node:crypto').randomUUID();
    await pool.query('INSERT INTO gps_sessions (id, player_id, session_date, distance_km) VALUES ($1,$2,CURRENT_DATE,5.2)', [gpsSessionId, ownPlayerId]);
    const recordedAt = new Date(anchor.getTime() + 60_000 + 30_000); // cible (ancre+60s) + 30s
    await pool.query(
      'INSERT INTO gps_points (session_id, seq, latitude, longitude, speed_kmh, recorded_at) VALUES ($1,1,18.5944,-72.3074,14.2,$2)',
      [gpsSessionId, recordedAt]
    );
    const { status, data } = await request(`/video/annotations/${annoOwn}/gps`, { token: staffToken });
    assert.equal(status, 200);
    assert.equal(data.found, true);
    assert.equal(data.source, 'gps_points');
    assert.equal(data.delta_seconds, 30);
    assert.equal(data.latitude, 18.5944);
  });

  await t.test('un point gps_live_tracking plus proche (5s) est préféré au point gps_points (30s)', async () => {
    matchLiveId = require('node:crypto').randomUUID();
    await pool.query("INSERT INTO matches_live (id, team_home, team_away) VALUES ($1,'A','B')", [matchLiveId]);
    const ts = new Date(anchor.getTime() + 60_000 + 5_000); // cible + 5s
    await pool.query(
      'INSERT INTO gps_live_tracking (match_id, player_id, latitude, longitude, speed, timestamp) VALUES ($1,$2,18.6000,-72.3100,16.7,$3)',
      [matchLiveId, ownPlayerId, ts]
    );
    const { status, data } = await request(`/video/annotations/${annoOwn}/gps`, { token: staffToken });
    assert.equal(status, 200);
    assert.equal(data.found, true);
    assert.equal(data.source, 'gps_live_tracking');
    assert.equal(data.delta_seconds, 5);
  });

  await t.test('IDOR : "player" peut consulter la corrélation GPS de SA PROPRE annotation', async () => {
    const { status } = await request(`/video/annotations/${annoOwn}/gps`, { token: playerToken });
    assert.equal(status, 200);
  });

  await t.test('IDOR : "player" ne peut PAS consulter la corrélation GPS d\'un autre joueur', async () => {
    const { status } = await request(`/video/annotations/${annoOther}/gps`, { token: playerToken });
    assert.equal(status, 403);
  });

  await t.test('nettoyage', async () => {
    await request(`/video/clips/${clipId}`, { method: 'DELETE', token: staffToken });
    await request(`/video/clips/${anchorClipId}`, { method: 'DELETE', token: staffToken });
    await pool.query('DELETE FROM gps_sessions WHERE id = $1', [gpsSessionId]);
    await pool.query('DELETE FROM matches_live WHERE id = $1', [matchLiveId]);
    const [c, gs, mlv] = await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM video_clips WHERE title ILIKE $1', ['Test GPS link%']),
      pool.query('SELECT count(*)::int AS n FROM gps_sessions WHERE id = $1', [gpsSessionId]),
      pool.query('SELECT count(*)::int AS n FROM matches_live WHERE id = $1', [matchLiveId]),
    ]);
    assert.equal(c.rows[0].n, 0);
    assert.equal(gs.rows[0].n, 0);
    assert.equal(mlv.rows[0].n, 0);
  });
});
