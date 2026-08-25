// ============================================================================
// COACHBOOT ENTERPRISE — SERVEUR GPS TEMPS RÉEL (Socket.io)
// Reçoit les positions GPS envoyées par les joueurs (assets/js/gps-socket-client.js
// côté frontend, utilisé par player-live.html), les valide, les persiste dans
// gps_live_tracking, et les retransmet en direct à tous les coachs qui
// observent le même match (rooms Socket.io `match:<matchId>`).
//
// Sécurité : la connexion Socket.io exige le même JWT que l'API REST (middleware
// io.use ci-dessous) — pas de canal temps réel non authentifié. Chaque relevé
// GPS est validé (bornes lat/lng/vitesse/accélération) avant persistance et
// diffusion, et throttlé par socket pour éviter le spam involontaire (boucle
// client trop rapide) ou malveillant.
// ============================================================================
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');

const UPDATE_MIN_INTERVAL_MS = 400; // anti-spam : un relevé GPS par joueur au plus toutes les 400ms

// Mêmes rôles que POST /api/gps/session (gps.routes.js) : un joueur ne peut
// reporter sa PROPRE position (vérifié via players.user_id), le staff peut
// reporter la position de n'importe quel joueur (traceur porté par un membre
// du staff, test matériel, etc.).
const GPS_STAFF_ROLES = new Set(['fitness_coach', 'data_analyst', 'head_coach']);

function isFiniteNumber(n) { return typeof n === 'number' && Number.isFinite(n); }

/** Un utilisateur peut-il reporter des positions GPS pour ce playerId ? */
async function canReportGpsFor(socketUser, playerId) {
  if (GPS_STAFF_ROLES.has(socketUser.role) || socketUser.role === 'admin') return true;
  if (socketUser.role !== 'player') return false;
  const { rows } = await pool.query('SELECT 1 FROM players WHERE id = $1 AND user_id = $2', [playerId, socketUser.id]);
  return rows.length > 0;
}

/** Valide un point GPS envoyé par un joueur avant persistance/diffusion. */
function validateGpsPayload(p) {
  if (!p || typeof p !== 'object') return 'Payload GPS invalide.';
  if (!isFiniteNumber(p.latitude) || p.latitude < -90 || p.latitude > 90) return 'Latitude invalide.';
  if (!isFiniteNumber(p.longitude) || p.longitude < -180 || p.longitude > 180) return 'Longitude invalide.';
  if (p.speed != null && (!isFiniteNumber(p.speed) || p.speed < 0 || p.speed > 130)) return 'Vitesse invalide (0-130 km/h attendu).';
  if (p.distance != null && (!isFiniteNumber(p.distance) || p.distance < 0)) return 'Distance invalide.';
  if (p.acceleration != null && (!isFiniteNumber(p.acceleration) || Math.abs(p.acceleration) > 15)) return 'Accélération invalide (±15 m/s² attendu).';
  return null;
}

function initGpsSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: process.env.CORS_ORIGIN || '*' },
  });

  const lastUpdateAt = new Map(); // socket.id -> timestamp (throttle)

  // Authentification obligatoire à la connexion : même jeton que l'API REST.
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentification requise (token manquant).'));
    try {
      socket.user = jwt.verify(token, JWT_SECRET); // { id, role, email, full_name }
      next();
    } catch {
      next(new Error('Jeton invalide ou expiré.'));
    }
  });

  io.on('connection', (socket) => {
    let joinedMatchId = null;
    let joinedAs = null; // 'player' | 'coach'
    let joinedPlayerId = null;

    socket.on('match:joinAsPlayer', async ({ matchId, playerId } = {}) => {
      if (!matchId || !playerId) return socket.emit('gps:error', { message: 'matchId et playerId sont requis pour rejoindre un match.' });
      let authorized;
      try {
        authorized = await canReportGpsFor(socket.user, playerId);
      } catch {
        return socket.emit('gps:error', { message: "Impossible de vérifier l'autorisation — réessayez." });
      }
      if (!authorized) {
        return socket.emit('gps:error', { message: "Vous n'êtes pas autorisé à reporter la position de ce joueur." });
      }
      joinedMatchId = matchId; joinedAs = 'player'; joinedPlayerId = playerId;
      socket.join(`match:${matchId}`);
      socket.to(`match:${matchId}`).emit('player:joined', { playerId, at: Date.now() });
      socket.emit('match:joined', { matchId, as: 'player' });
    });

    socket.on('match:joinAsCoach', ({ matchId } = {}) => {
      if (!matchId) return socket.emit('gps:error', { message: 'matchId est requis pour observer un match.' });
      joinedMatchId = matchId; joinedAs = 'coach';
      socket.join(`match:${matchId}`);
      socket.emit('match:joined', { matchId, as: 'coach' });
    });

    socket.on('gps:update', async (payload) => {
      if (joinedAs !== 'player' || !joinedMatchId) {
        return socket.emit('gps:error', { message: "Rejoignez d'abord un match en tant que joueur (match:joinAsPlayer) avant d'envoyer une position." });
      }
      const now = Date.now();
      const last = lastUpdateAt.get(socket.id) || 0;
      if (now - last < UPDATE_MIN_INTERVAL_MS) return; // throttle silencieux, pas une erreur
      lastUpdateAt.set(socket.id, now);

      const validationError = validateGpsPayload(payload);
      if (validationError) return socket.emit('gps:error', { message: validationError });

      const point = {
        playerId: joinedPlayerId,
        matchId: joinedMatchId,
        latitude: payload.latitude,
        longitude: payload.longitude,
        speed: payload.speed ?? null,
        distance: payload.distance ?? null,
        acceleration: payload.acceleration ?? null,
        sprintCount: payload.sprintCount ?? null,
        durationSec: payload.durationSec ?? null,
        timestamp: payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString(),
      };

      try {
        await pool.query(
          `INSERT INTO gps_live_tracking (match_id, player_id, latitude, longitude, speed, distance, acceleration, timestamp)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [point.matchId, point.playerId, point.latitude, point.longitude, point.speed, point.distance, point.acceleration, point.timestamp]
        );
      } catch (dbErr) {
        console.error('gps:update — échec de la persistance (diffusion en direct maintenue) :', dbErr.message);
      }

      io.to(`match:${joinedMatchId}`).emit('gps:broadcast', point);
    });

    socket.on('disconnect', () => {
      lastUpdateAt.delete(socket.id);
      if (joinedMatchId && joinedAs === 'player') {
        socket.to(`match:${joinedMatchId}`).emit('player:left', { playerId: joinedPlayerId, at: Date.now() });
      }
    });
  });

  return io;
}

module.exports = { initGpsSocket, validateGpsPayload };
