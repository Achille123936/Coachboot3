// Aide partagée pour les tests d'intégration (test/*.test.js).
//
// Ces tests sont des tests d'INTÉGRATION RÉELS : ils appellent l'API HTTP
// réellement démarrée (npm start / npm run dev) et lisent/écrivent dans la
// vraie base PostgreSQL configurée par .env — exactement comme un client
// front-end le ferait. Il n'y a pas de base de test séparée ni de mocks.
//
// Prérequis avant `npm test` :
//   1. PostgreSQL démarré et migré (npm run db:migrate) + seedé (npm run db:seed)
//   2. Le serveur backend démarré (npm start, dans un autre terminal)
//
// Chaque test crée ses propres données jetables (comptes, séances, profils...)
// et les supprime à la fin (voir registerCleanup ci-dessous) — jamais les
// données de démonstration du seed (comptes @coachboot.app, joueurs...).

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:4000/api';

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* pas de corps (ex. 204) */ }
  return { status: res.status, data, headers: res.headers };
}

// Les identifiants /auth/login partagent le même rate-limiter anti-bruteforce
// (20 req/15min/IP, voir server.js) que le reste de la suite — un cache par
// process évite qu'un même fichier de test ne reconsomme ce budget à chaque
// t.test() alors qu'un seul jeton par compte suffit pour toute sa durée de vie.
const tokenCache = new Map();

async function loginAs(email, password = 'CoachBoot2026!') {
  const cacheKey = `${email}:${password}`;
  if (tokenCache.has(cacheKey)) return tokenCache.get(cacheKey);
  const { status, data } = await request('/auth/login', { method: 'POST', body: { email, password } });
  if (status !== 200) throw new Error(`Échec de connexion ${email} : ${status} ${JSON.stringify(data)}`);
  tokenCache.set(cacheKey, data.token);
  return data.token;
}

const DEMO_ACCOUNTS = {
  head_coach: 'carmie.boot@coachboot.app',
  fitness_coach: 'prepa.physique@coachboot.app',
  technical_director: 'directeur.technique@coachboot.app',
  player: 'joueur@coachboot.app',
  admin: 'admin@coachboot.app', // superadmin plateforme (multi-club) — club_id null, voir middleware/auth.js
};

// Deuxième club de démonstration (db/seed-second-club.js) — utilisé par les
// tests d'isolation multi-tenant (test/multi-tenant-isolation.test.js).
const DEMO_ACCOUNTS_CLUB2 = {
  head_coach: 'entraineur@fc-riviere-test.app',
  technical_director: 'directeur.technique@fc-riviere-test.app',
  player: 'joueur@fc-riviere-test.app',
};

module.exports = { BASE_URL, request, loginAs, DEMO_ACCOUNTS, DEMO_ACCOUNTS_CLUB2 };
