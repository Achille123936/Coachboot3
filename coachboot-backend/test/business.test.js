const test = require('node:test');
const assert = require('node:assert/strict');
const { request, loginAs, DEMO_ACCOUNTS } = require('../testHelpers');
const pool = require('../src/config/db');

// Un seul pool PostgreSQL pour tout le fichier (require() le met en cache) —
// fermer une seule fois à la toute fin plutôt que dans chaque bloc test(),
// sinon le second test() tenterait d'utiliser un pool déjà fermé par le premier.
test.after(() => pool.end());

test('trainings / scouting / reports — CRUD réel + export binaire réel', async (t) => {
  const token = await loginAs(DEMO_ACCOUNTS.head_coach);
  let trainingId, profileId, reportId;

  await t.test('POST /trainings crée une vraie séance', async () => {
    const { status, data } = await request('/trainings', {
      method: 'POST', token,
      body: { session_date: new Date().toISOString(), type: 'Technique', duration_minutes: 45, rpe: 5 },
    });
    assert.equal(status, 201);
    assert.equal(data.training.type, 'Technique');
    trainingId = data.training.id;
  });

  await t.test('GET /trainings inclut la séance créée', async () => {
    const { status, data } = await request('/trainings', { token });
    assert.equal(status, 200);
    assert.ok(data.trainings.some(t2 => t2.id === trainingId));
  });

  await t.test('POST /scouting crée un vrai profil', async () => {
    const { status, data } = await request('/scouting', {
      method: 'POST', token, body: { name: 'Joueur Test Suite', current_club: 'Club Test' },
    });
    assert.equal(status, 201);
    profileId = data.profile.id;
  });

  await t.test('POST /reports crée un vrai rapport', async () => {
    const { status, data } = await request('/reports', { method: 'POST', token, body: { title: 'Rapport Test Suite', type: 'Match' } });
    assert.equal(status, 201);
    reportId = data.report.id;
  });

  await t.test('GET /reports/:id/export?format=pdf renvoie un vrai PDF binaire (pas un JSON stub)', async () => {
    const res = await fetch(`${require('../testHelpers').BASE_URL}/reports/${reportId}/export?format=pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 100, 'le PDF généré doit avoir un contenu réel');
    assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-', 'doit commencer par la signature binaire PDF');
  });

  await t.test('GET /reports/:id/export?format=excel renvoie un vrai classeur Excel (signature ZIP/xlsx)', async () => {
    const res = await fetch(`${require('../testHelpers').BASE_URL}/reports/${reportId}/export?format=excel`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 100);
    // .xlsx est un fichier ZIP : signature binaire 0x50 0x4B ("PK").
    assert.equal(buf[0], 0x50);
    assert.equal(buf[1], 0x4B);
  });

  await t.test('nettoyage des données créées par ce test', async () => {
    await pool.query('DELETE FROM trainings WHERE id = $1', [trainingId]);
    await pool.query('DELETE FROM scouting_profiles WHERE id = $1', [profileId]);
    await pool.query('DELETE FROM reports WHERE id = $1', [reportId]);
  });
});

test('notifications événementielles — une blessure créée déclenche une vraie notification', async (t) => {
  const token = await loginAs(DEMO_ACCOUNTS.head_coach);
  let injuryId, playerId;

  await t.test('préparation : récupérer un joueur réel', async () => {
    const { data } = await request('/players', { token });
    assert.ok(data.players.length > 0);
    playerId = data.players[0].id;
  });

  await t.test('POST /injuries crée la blessure et déclenche une notification', async () => {
    const before = await request('/notifications', { token });
    const countBefore = before.data.notifications.length;

    const { status, data } = await request('/injuries', {
      method: 'POST', token,
      body: { player_id: playerId, type: 'Blessure test suite', start_date: new Date().toISOString().slice(0, 10) },
    });
    assert.equal(status, 201);
    injuryId = data.injury.id;

    const after = await request('/notifications', { token });
    assert.equal(after.data.notifications.length, countBefore + 1, 'une notification doit être créée par la blessure');
    assert.equal(after.data.notifications[0].title, 'Alerte blessure');
  });

  await t.test('nettoyage : supprime la blessure de test et sa notification, restaure le statut du joueur', async () => {
    const { rows } = await pool.query('SELECT player_id FROM injuries WHERE id = $1', [injuryId]);
    await pool.query('DELETE FROM injuries WHERE id = $1', [injuryId]);
    await pool.query(`UPDATE players SET status = 'Disponible' WHERE id = $1`, [rows[0].player_id]);
    await pool.query(`DELETE FROM notifications WHERE title = 'Alerte blessure' AND body LIKE '%Blessure test suite%'`);
  });
});
