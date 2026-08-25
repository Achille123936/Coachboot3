// Test dédié et VOLONTAIREMENT hors de test/ (node --test, sans argument,
// découvre TOUT fichier .js sous un dossier nommé "test" quel que soit son
// nom — un essai précédent nommé test/rate-limit.manual.js a quand même été
// ramassé et exécuté EN PARALLÈLE de auth.test.js, épuisant leur budget
// authLimiter partagé et faisant échouer en cascade des tests par ailleurs
// corrects. Rester en dehors de test/ est la seule exclusion fiable.
//
// Raison d'être de ce fichier : déclencher RÉELLEMENT le rate limiter
// (authLimiter, 20 req/15min/IP sur /auth/login) avec 25 tentatives — voir
// docs/TESTING.md. À lancer isolément, jamais via `npm test` :
//
//   npm start                              (terminal 1)
//   node --test rateLimitManualCheck.js    (terminal 2, à part de `npm test`)
//
// Après ce test, le rate limiter reste "chaud" — redémarrer le backend avant
// de relancer `npm test` normalement.

const test = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('./testHelpers');

test('authLimiter se déclenche réellement après 20 tentatives de connexion', async () => {
  const attempts = [];
  for (let i = 0; i < 25; i++) {
    attempts.push(await request('/auth/login', { method: 'POST', body: { email: 'inexistant@coachboot.app', password: 'x' } }));
  }
  const statuses = attempts.map(a => a.status);
  const unauthorizedCount = statuses.filter(s => s === 401).length;
  const rateLimitedCount = statuses.filter(s => s === 429).length;

  assert.ok(unauthorizedCount > 0, 'les premières tentatives doivent être de vrais 401 (compte inexistant)');
  assert.ok(rateLimitedCount > 0, 'au-delà de 20 tentatives en 15 minutes, le serveur doit répondre 429');
  assert.equal(unauthorizedCount + rateLimitedCount, 25, `réponses inattendues : ${JSON.stringify(statuses)}`);
  console.log(`Sur 25 tentatives : ${unauthorizedCount} × 401 (rejet normal), ${rateLimitedCount} × 429 (rate limité) — limiteur déclenché après la 20e.`);
});
