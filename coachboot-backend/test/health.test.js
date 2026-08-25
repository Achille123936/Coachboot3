const test = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('../testHelpers');

test('GET /api/health renvoie ok et db:up quand PostgreSQL répond', async () => {
  const { status, data } = await request('/health');
  assert.equal(status, 200);
  assert.equal(data.status, 'ok');
  assert.equal(data.db, 'up');
});

test('route inconnue renvoie 404 propre (pas de crash)', async () => {
  const { status } = await request('/route-qui-nexiste-pas');
  assert.equal(status, 404);
});

test('GET /api/health/live répond sans dépendre de la base', async () => {
  const { status, data } = await request('/health/live');
  assert.equal(status, 200);
  assert.equal(data.status, 'ok');
});

test('GET /api/health/ready renvoie ready quand PostgreSQL répond', async () => {
  const { status, data } = await request('/health/ready');
  assert.equal(status, 200);
  assert.equal(data.status, 'ready');
  assert.equal(data.db, 'up');
});
