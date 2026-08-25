/* ==========================================================================
   COACHBOOT ENTERPRISE — CLIENT SOCKET.IO (GPS temps réel)
   Fine couche au-dessus du client Socket.io (chargé via CDN dans la page) pour
   parler au serveur temps réel (coachboot-backend/src/socket/gpsSocket.js) :
   un joueur (player-live.html) rejoint un match et y pousse ses positions GPS ;
   un coach (match-live.html) rejoint le même match en observateur et reçoit
   chaque relevé en direct. Authentification par le même JWT que l'API REST
   (CB_API.token()) — pas de canal temps réel non authentifié.

   Events (sur `window`) : 'cbsocket:connect', 'cbsocket:disconnect',
   'cbsocket:joined' (detail = { matchId, as }), 'cbsocket:gps' (detail = point
   GPS diffusé), 'cbsocket:playerjoined', 'cbsocket:playerleft',
   'cbsocket:error' (detail = { message }).
   ========================================================================== */
(function () {
  let socket = null;
  let role = null; // 'player' | 'coach'
  let currentMatchId = null;

  function emit(type, extra) {
    window.dispatchEvent(new CustomEvent(type, { detail: extra || {} }));
  }

  const CBGpsSocket = {
    isSupported() { return typeof io !== 'undefined'; },
    isConnected() { return !!(socket && socket.connected); },
    getRole() { return role; },
    getMatchId() { return currentMatchId; },

    /** Ouvre la connexion Socket.io (une seule fois) ; `base` optionnel (déduit de CB_API par défaut). */
    connect(base) {
      if (!this.isSupported()) {
        emit('cbsocket:error', { message: "Bibliothèque Socket.io non chargée (CDN bloqué ou hors ligne)." });
        return false;
      }
      if (socket) return true;
      // `CB_API` est déclaré via `const` dans api.js : c'est une liaison de portée globale,
      // pas une propriété de `window` — `window.CB_API` serait toujours undefined ici.
      const token = (typeof CB_API !== 'undefined') ? CB_API.token() : null;
      if (!token) {
        emit('cbsocket:error', { message: 'Connectez-vous pour activer le temps réel.' });
        return false;
      }
      const url = base || (CB_API.base || 'http://localhost:4000/api').replace(/\/api\/?$/, '');
      socket = io(url, { auth: { token }, reconnection: true, reconnectionAttempts: 5, timeout: 8000 });

      socket.on('connect', () => emit('cbsocket:connect', {}));
      socket.on('connect_error', (err) => emit('cbsocket:error', { message: err.message || 'Connexion temps réel impossible.' }));
      socket.on('disconnect', (reason) => emit('cbsocket:disconnect', { reason }));
      socket.on('match:joined', (d) => emit('cbsocket:joined', d));
      socket.on('gps:broadcast', (point) => emit('cbsocket:gps', point));
      socket.on('gps:error', (e) => emit('cbsocket:error', e));
      socket.on('player:joined', (d) => emit('cbsocket:playerjoined', d));
      socket.on('player:left', (d) => emit('cbsocket:playerleft', d));
      return true;
    },

    /** Rejoint un match en tant que joueur — habilite sendGpsUpdate(). */
    joinAsPlayer(matchId, playerId) {
      if (!socket) return false;
      role = 'player'; currentMatchId = matchId;
      socket.emit('match:joinAsPlayer', { matchId, playerId });
      return true;
    },

    /** Rejoint un match en tant que coach — reçoit les diffusions 'cbsocket:gps'. */
    joinAsCoach(matchId) {
      if (!socket) return false;
      role = 'coach'; currentMatchId = matchId;
      socket.emit('match:joinAsCoach', { matchId });
      return true;
    },

    /** Envoie un relevé GPS (uniquement après joinAsPlayer). */
    sendGpsUpdate(payload) {
      if (!socket || role !== 'player') return false;
      socket.emit('gps:update', payload);
      return true;
    },

    disconnect() {
      if (socket) { socket.removeAllListeners(); socket.close(); socket = null; }
      role = null; currentMatchId = null;
    },
  };

  window.CBGpsSocket = CBGpsSocket;
})();
