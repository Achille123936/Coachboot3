// Central PostgreSQL connection pool, shared by every route/controller.
const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DB_PASSWORD && process.env.NODE_ENV === 'production') {
  throw new Error('DB_PASSWORD est requis en production (voir .env.example).');
}

// DB_SSL=true pour les fournisseurs cloud qui l'exigent (ex. Neon) — la plupart
// terminent TLS avec un certificat signé par une CA publique, donc pas besoin
// de désactiver la vérification (rejectUnauthorized reste à true).
const useSsl = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'coachboot',
  max: 10,
  idleTimeoutMillis: 30000,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
});

pool.on('error', (err) => {
  console.error('Erreur inattendue du pool PostgreSQL :', err);
});

module.exports = pool;
