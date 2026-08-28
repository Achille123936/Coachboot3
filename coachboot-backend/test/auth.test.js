const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { request, loginAs, DEMO_ACCOUNTS } = require('../testHelpers');

test('auth', async (t) => {
  const email = `test-${crypto.randomUUID()}@coachboot.app`;
  let token;

  // Multi-club : l'inscription exige désormais un code d'invitation de club
  // valide (voir db/seed.js) — plus de "rôle libre sans club".
  const inviteCode = 'COACHBOOT-FC-2026';

  await t.test('POST /auth/register crée un compte réel et renvoie un jeton', async () => {
    const { status, data } = await request('/auth/register', {
      method: 'POST',
      body: { full_name: 'Test Suite', email, password: 'TestPass2026!', invite_code: inviteCode },
    });
    assert.equal(status, 201);
    assert.ok(data.token);
    assert.equal(data.user.email, email);
    token = data.token;
  });

  await t.test('POST /auth/register refuse un e-mail déjà utilisé (409)', async () => {
    const { status } = await request('/auth/register', {
      method: 'POST',
      body: { full_name: 'Doublon', email, password: 'TestPass2026!', invite_code: inviteCode },
    });
    assert.equal(status, 409);
  });

  await t.test('POST /auth/register valide les champs (mot de passe trop court -> 400)', async () => {
    const { status } = await request('/auth/register', {
      method: 'POST',
      body: { full_name: 'X', email: `short-${crypto.randomUUID()}@coachboot.app`, password: 'short', invite_code: inviteCode },
    });
    assert.equal(status, 400);
  });

  await t.test("POST /auth/register refuse un code d'invitation invalide (404)", async () => {
    const { status } = await request('/auth/register', {
      method: 'POST',
      body: { full_name: 'Test Badcode', email: `badcode-${crypto.randomUUID()}@coachboot.app`, password: 'TestPass2026!', invite_code: 'BOGUS-CODE' },
    });
    assert.equal(status, 404);
  });

  await t.test('POST /auth/register refuse si ni invite_code ni new_club_name (400)', async () => {
    const { status } = await request('/auth/register', {
      method: 'POST',
      body: { full_name: 'Test Neither', email: `neither-${crypto.randomUUID()}@coachboot.app`, password: 'TestPass2026!' },
    });
    assert.equal(status, 400);
  });

  await t.test('POST /auth/register refuse si invite_code ET new_club_name ensemble (400)', async () => {
    const { status } = await request('/auth/register', {
      method: 'POST',
      body: { full_name: 'Test Both', email: `both-${crypto.randomUUID()}@coachboot.app`, password: 'TestPass2026!', invite_code: inviteCode, new_club_name: 'Club Both Test' },
    });
    assert.equal(status, 400);
  });

  let createdClubId, founderEmail;
  await t.test('POST /auth/register avec new_club_name crée réellement un nouveau club + son premier compte (technical_director par défaut)', async () => {
    founderEmail = `founder-${crypto.randomUUID()}@coachboot.app`;
    const { status, data } = await request('/auth/register', {
      method: 'POST',
      body: { full_name: 'Fondateur Test', email: founderEmail, password: 'TestPass2026!', new_club_name: 'Club Test E2E' },
    });
    assert.equal(status, 201);
    assert.equal(data.user.role, 'technical_director');
    assert.ok(data.club.id);
    assert.ok(data.club.invite_code);
    assert.equal(data.user.club_id, data.club.id);
    createdClubId = data.club.id;

    const teammate = await request('/auth/register', {
      method: 'POST',
      body: { full_name: 'Coéquipier Test', email: `teammate-${crypto.randomUUID()}@coachboot.app`, password: 'TestPass2026!', invite_code: data.club.invite_code },
    });
    assert.equal(teammate.status, 201);
    assert.equal(teammate.data.user.club_id, createdClubId, 'le code généré doit réellement rattacher un second compte au même nouveau club');

    const pool = require('../src/config/db');
    await pool.query('DELETE FROM users WHERE club_id = $1', [createdClubId]);
    await pool.query('DELETE FROM clubs WHERE id = $1', [createdClubId]);
  });

  await t.test('POST /auth/login avec mauvais mot de passe -> 401', async () => {
    const { status } = await request('/auth/login', { method: 'POST', body: { email, password: 'MauvaisMotDePasse' } });
    assert.equal(status, 401);
  });

  await t.test('POST /auth/login avec bon mot de passe -> 200 + jeton', async () => {
    const { status, data } = await request('/auth/login', { method: 'POST', body: { email, password: 'TestPass2026!' } });
    assert.equal(status, 200);
    assert.ok(data.token);
  });

  await t.test('GET /auth/me sans jeton -> 401', async () => {
    const { status } = await request('/auth/me');
    assert.equal(status, 401);
  });

  await t.test('GET /auth/me avec jeton valide renvoie le bon utilisateur', async () => {
    const { status, data } = await request('/auth/me', { token });
    assert.equal(status, 200);
    assert.equal(data.user.email, email);
  });

  await t.test('PUT /auth/change-password refuse un mauvais mot de passe actuel', async () => {
    const { status } = await request('/auth/change-password', {
      method: 'PUT', token, body: { current_password: 'FauxMotDePasse', new_password: 'NouveauPass2026!' },
    });
    assert.equal(status, 401);
  });

  await t.test('PUT /auth/change-password change réellement le mot de passe (login avant/après)', async () => {
    const { status } = await request('/auth/change-password', {
      method: 'PUT', token, body: { current_password: 'TestPass2026!', new_password: 'NouveauPass2026!' },
    });
    assert.equal(status, 200);

    const oldLogin = await request('/auth/login', { method: 'POST', body: { email, password: 'TestPass2026!' } });
    assert.equal(oldLogin.status, 401, 'ancien mot de passe doit être rejeté après changement');

    const newLogin = await request('/auth/login', { method: 'POST', body: { email, password: 'NouveauPass2026!' } });
    assert.equal(newLogin.status, 200, 'nouveau mot de passe doit fonctionner');
  });

  await t.test('POST /auth/forgot-password : réponse générique identique pour un e-mail inexistant (anti-énumération)', async () => {
    const { status, data } = await request('/auth/forgot-password', { method: 'POST', body: { email: `inexistant-${crypto.randomUUID()}@coachboot.app` } });
    assert.equal(status, 200);
    assert.equal(data.email_status, 'EMAIL_SERVICE_NOT_CONFIGURED');
    assert.equal('dev_reset_token' in data, false, 'aucun jeton ne doit être renvoyé pour un compte inexistant');
  });

  await t.test('POST /auth/forgot-password puis /auth/reset-password réinitialise réellement le mot de passe', async () => {
    const forgot = await request('/auth/forgot-password', { method: 'POST', body: { email } });
    assert.equal(forgot.status, 200);
    assert.ok(forgot.data.dev_reset_token, 'en dev, le jeton doit être renvoyé pour permettre le test du flux');

    const badReset = await request('/auth/reset-password', { method: 'POST', body: { token: 'jeton-invalide', new_password: 'ResetPass2026!' } });
    assert.equal(badReset.status, 400);

    const reset = await request('/auth/reset-password', { method: 'POST', body: { token: forgot.data.dev_reset_token, new_password: 'ResetPass2026!' } });
    assert.equal(reset.status, 200);

    const reuse = await request('/auth/reset-password', { method: 'POST', body: { token: forgot.data.dev_reset_token, new_password: 'AutrePass2026!' } });
    assert.equal(reuse.status, 400, 'un jeton de réinitialisation doit être à usage unique');

    const loginNew = await request('/auth/login', { method: 'POST', body: { email, password: 'ResetPass2026!' } });
    assert.equal(loginNew.status, 200);
    token = loginNew.data.token; // les tests suivants réutilisent ce compte
  });

  await t.test('contrôle de rôle : un compte "player" ne peut pas créer une équipe (403)', async () => {
    const playerToken = await loginAs(DEMO_ACCOUNTS.player);
    const { status } = await request('/teams', { method: 'POST', token: playerToken, body: { name: 'Équipe non autorisée' } });
    assert.equal(status, 403);
  });

  // Nettoyage : supprime le compte jetable créé par ce test. `pool.end()` évite
  // de laisser le runner `node --test` en vie sur des connexions PostgreSQL
  // ouvertes une fois les assertions terminées.
  await t.test('nettoyage du compte de test', async () => {
    const pool = require('../src/config/db');
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    await pool.end();
  });
});
