/* ==========================================================================
   COACHBOOT ENTERPRISE — MATCH LIVE : GPS 22 JOUEURS (moteur temps réel)
   Fait vivre 22 joueurs (11 vs 11) sur un terrain normalisé (x,y ∈ [0,1]) à
   raison d'une mise à jour par seconde. Distance/vitesse/sprints/intensité
   sont RÉELLEMENT calculés (Haversine-équivalent en mètres sur le terrain,
   mêmes seuils sports-science que assets/js/gps-live.js) — seule la SOURCE du
   mouvement est simulée par un modèle de marche aléatoire contrainte à la
   zone de poste, faute de 22 boîtiers GPS synchronisés disponibles pour une
   démo (voir coachboot-backend/docs/API.md, section Match Live).

   Un joueur désigné « réel » (setRealPlayerId) peut être piloté par le vrai
   CBGpsLive (assets/js/gps-live.js, navigator.geolocation) quand ce dernier
   est en train de suivre une position — sa trace GPS réelle est alors
   projetée sur le terrain. Sans autorisation de localisation, il retombe
   automatiquement sur la même simulation que les 21 autres joueurs.

   Events (sur `window`) : 'matchgps:start', 'matchgps:pause',
   'matchgps:resume', 'matchgps:stop', 'matchgps:tick' (detail = état complet),
   'matchgps:sprint' (detail = { playerId, name, speedKmh }).
   ========================================================================== */
(function () {
  const PITCH_LENGTH_M = 105;
  const PITCH_WIDTH_M = 68;
  const SPRINT_KMH = 22;
  const TICK_MS = 1000;
  const INTENSITY_REF_KMH = 28; // vitesse de référence pour normaliser l'intensité à 100%
  const INTENSITY_WINDOW = 8;   // nb d'échantillons (secondes) pour lisser l'intensité affichée

  const HOME_NAMES = ['Kervens Joseph', 'Lucas Nkomo', 'Amara Diallo', 'Julien Petit', 'Karim Haddad',
    'Noah Fontaine', 'Théo Bernard', 'Enzo Martins', 'Yanis Costa', 'Rayan Lefevre', 'Maël Girard'];
  const AWAY_NAMES = ['Bilal Ahmed', 'Sami Touré', 'Gabriel Silva', 'Mateo Rossi', 'Diego Fernandez',
    'Ivan Petrov', 'Marco Bianchi', 'Owen Walsh', 'Liam Murphy', 'Noel Byrne', 'Cian Doyle'];

  // Formation 4-3-3 : positions de référence normalisées (l'équipe "home" attaque vers x=1).
  const FORMATION = [
    { role: 'GB', x: 0.06, y: 0.50 },
    { role: 'DD', x: 0.20, y: 0.15 }, { role: 'DC', x: 0.18, y: 0.38 }, { role: 'DC', x: 0.18, y: 0.62 }, { role: 'DG', x: 0.20, y: 0.85 },
    { role: 'MC', x: 0.45, y: 0.25 }, { role: 'MC', x: 0.42, y: 0.50 }, { role: 'MC', x: 0.45, y: 0.75 },
    { role: 'AD', x: 0.75, y: 0.20 }, { role: 'BU', x: 0.80, y: 0.50 }, { role: 'AG', x: 0.75, y: 0.80 },
  ];

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function round(n, d) { const f = 10 ** d; return Math.round((n || 0) * f) / f; }

  function buildRoster() {
    const players = [];
    FORMATION.forEach((slot, i) => {
      players.push({
        id: `home-${i + 1}`, number: i + 1, name: HOME_NAMES[i], team: 'home', role: slot.role,
        homeX: slot.x, homeY: slot.y, xN: slot.x, yN: slot.y,
        speedKmh: 0, maxSpeedKmh: 0, distanceKm: 0, sprintCount: 0, wasSprinting: false,
        burstTicks: 0, burstDx: 0, burstDy: 0, intensitySamples: [], intensityPct: 0, zone: '', isReal: false,
      });
    });
    FORMATION.forEach((slot, i) => {
      const mx = 1 - slot.x, my = slot.y; // symétrie : l'équipe "away" attaque vers x=0
      players.push({
        id: `away-${i + 1}`, number: i + 1, name: AWAY_NAMES[i], team: 'away', role: slot.role,
        homeX: mx, homeY: my, xN: mx, yN: my,
        speedKmh: 0, maxSpeedKmh: 0, distanceKm: 0, sprintCount: 0, wasSprinting: false,
        burstTicks: 0, burstDx: 0, burstDy: 0, intensitySamples: [], intensityPct: 0, zone: '', isReal: false,
      });
    });
    return players;
  }

  let players = buildRoster();
  let ball = { xN: 0.5, yN: 0.5 };
  let status = 'idle'; // idle | running | paused
  let intervalId = null;
  let startedAt = null;
  let pausedAccumMs = 0;
  let pausedAt = null;
  let realPlayerId = null;
  let selectedId = players[0].id;

  function computeZone(p) {
    const attacksRight = p.team === 'home';
    const progress = attacksRight ? p.xN : (1 - p.xN);
    const third = progress < 0.33 ? 'Défense' : progress < 0.66 ? 'Milieu' : 'Attaque';
    const side = p.yN < 0.33 ? 'gauche' : p.yN < 0.66 ? 'axe' : 'droite';
    return `${third} ${side}`;
  }

  function pushIntensitySample(p, speedKmh) {
    p.intensitySamples.push(speedKmh);
    if (p.intensitySamples.length > INTENSITY_WINDOW) p.intensitySamples.shift();
    const avg = p.intensitySamples.reduce((a, b) => a + b, 0) / p.intensitySamples.length;
    p.intensityPct = Math.round(clamp((avg / INTENSITY_REF_KMH) * 100, 0, 100));
  }

  /** Un pas de simulation (1s) : marche/jog habituel + sprints ponctuels vers une direction aléatoire. */
  function stepSimulatedPlayer(p) {
    if (p.burstTicks <= 0 && Math.random() < 0.025) {
      p.burstTicks = 2 + Math.floor(Math.random() * 2);
      const angle = Math.random() * Math.PI * 2;
      p.burstDx = Math.cos(angle); p.burstDy = Math.sin(angle);
    }

    let dirX, dirY, speedMs;
    if (p.burstTicks > 0) {
      dirX = p.burstDx; dirY = p.burstDy;
      speedMs = 6.2 + Math.random() * 2.3; // ~22-30 km/h en sprint
      p.burstTicks -= 1;
    } else {
      const pullX = p.homeX - p.xN, pullY = p.homeY - p.yN;
      const jitterAngle = Math.random() * Math.PI * 2;
      dirX = pullX * 0.7 + Math.cos(jitterAngle) * 0.3;
      dirY = pullY * 0.7 + Math.sin(jitterAngle) * 0.3;
      const norm = Math.hypot(dirX, dirY) || 1;
      dirX /= norm; dirY /= norm;
      speedMs = 0.8 + Math.random() * 2.4; // ~3-12 km/h marche/jog
    }

    const dxM = dirX * speedMs, dyM = dirY * speedMs; // dt = 1s ⇒ m/s = m parcourus
    const nx = clamp(p.xN + dxM / PITCH_LENGTH_M, 0.02, 0.98);
    const ny = clamp(p.yN + dyM / PITCH_WIDTH_M, 0.03, 0.97);
    const movedM = Math.hypot((nx - p.xN) * PITCH_LENGTH_M, (ny - p.yN) * PITCH_WIDTH_M);
    const speedKmh = movedM * 3.6;

    p.xN = nx; p.yN = ny;
    p.distanceKm += movedM / 1000;
    p.speedKmh = speedKmh;
    if (speedKmh > p.maxSpeedKmh) p.maxSpeedKmh = speedKmh;

    if (speedKmh >= SPRINT_KMH) {
      if (!p.wasSprinting) {
        p.sprintCount += 1;
        p.wasSprinting = true;
        window.dispatchEvent(new CustomEvent('matchgps:sprint', { detail: { playerId: p.id, name: p.name, speedKmh: round(speedKmh, 1) } }));
      }
    } else {
      p.wasSprinting = false;
    }
    pushIntensitySample(p, speedKmh);
    p.zone = computeZone(p);
  }

  /** Projette la trace GPS réelle (assets/js/gps-live.js) sur le terrain normalisé. */
  function projectRealPosition(gpsState) {
    if (!gpsState.points || !gpsState.points.length) return null;
    const first = gpsState.points[0];
    const last = gpsState.points[gpsState.points.length - 1];
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(first.lat * Math.PI / 180);
    const dxM = (last.lng - first.lng) * mPerDegLng;
    const dyM = (last.lat - first.lat) * mPerDegLat;
    return {
      x: clamp(0.5 + dxM / PITCH_LENGTH_M, 0.02, 0.98),
      y: clamp(0.5 - dyM / PITCH_WIDTH_M, 0.03, 0.97),
    };
  }

  function stepBall() {
    ball.xN = clamp(ball.xN + (0.5 - ball.xN) * 0.02 + (Math.random() - 0.5) * 0.035, 0.05, 0.95);
    ball.yN = clamp(ball.yN + (0.5 - ball.yN) * 0.02 + (Math.random() - 0.5) * 0.035, 0.05, 0.95);
  }

  function activeDurationMs() {
    if (!startedAt) return 0;
    const end = (status === 'paused' && pausedAt) ? pausedAt : Date.now();
    return Math.max(0, end - startedAt - pausedAccumMs);
  }

  function publicState() {
    return {
      status,
      elapsedSec: Math.floor(activeDurationMs() / 1000),
      ball: { x: ball.xN, y: ball.yN },
      selectedId,
      realPlayerId,
      players: players.map(p => ({
        id: p.id, number: p.number, name: p.name, team: p.team, role: p.role,
        x: p.xN, y: p.yN, speedKmh: round(p.speedKmh, 1), maxSpeedKmh: round(p.maxSpeedKmh, 1),
        distanceKm: round(p.distanceKm, 2), sprintCount: p.sprintCount, intensityPct: p.intensityPct,
        zone: p.zone, isReal: p.isReal,
      })),
    };
  }

  function tick() {
    players.forEach(p => {
      if (p.id === realPlayerId && window.CBGpsLive && CBGpsLive.isTracking()) {
        const gstate = CBGpsLive.getState();
        const proj = projectRealPosition(gstate);
        if (proj) { p.xN = proj.x; p.yN = proj.y; }
        p.speedKmh = gstate.currentSpeedKmh;
        p.maxSpeedKmh = gstate.maxSpeedKmh;
        p.distanceKm = gstate.distanceKm;
        p.sprintCount = gstate.sprintCount;
        p.intensityPct = Math.round(clamp((gstate.currentSpeedKmh / INTENSITY_REF_KMH) * 100, 0, 100));
        p.zone = computeZone(p);
        p.isReal = true;
      } else {
        p.isReal = false;
        stepSimulatedPlayer(p);
      }
    });
    stepBall();
    window.dispatchEvent(new CustomEvent('matchgps:tick', { detail: publicState() }));
  }

  const CBMatchGpsLive = {
    TEAM_SIZE: 11,
    THRESHOLDS: { SPRINT_KMH },

    /** Roster initial (avant le premier tick), utile pour construire l'UI (sélecteur de joueur...). */
    getRoster() { return players.map(p => ({ id: p.id, number: p.number, name: p.name, team: p.team, role: p.role })); },
    getState() { return publicState(); },
    isRunning() { return status === 'running'; },
    isPaused() { return status === 'paused'; },

    setRealPlayerId(id) { realPlayerId = id; },
    getRealPlayerId() { return realPlayerId; },
    selectPlayer(id) { selectedId = id; },
    getSelectedId() { return selectedId; },

    start() {
      if (status === 'running') return true;
      if (status === 'paused') return this.resume();
      players = buildRoster();
      ball = { xN: 0.5, yN: 0.5 };
      status = 'running';
      startedAt = Date.now();
      pausedAccumMs = 0;
      clearInterval(intervalId);
      intervalId = setInterval(tick, TICK_MS);
      window.dispatchEvent(new CustomEvent('matchgps:start', { detail: publicState() }));
      tick();
      return true;
    },

    pause() {
      if (status !== 'running') return false;
      status = 'paused';
      pausedAt = Date.now();
      clearInterval(intervalId);
      intervalId = null;
      window.dispatchEvent(new CustomEvent('matchgps:pause', { detail: publicState() }));
      return true;
    },

    resume() {
      if (status !== 'paused') return false;
      pausedAccumMs += Date.now() - pausedAt;
      pausedAt = null;
      status = 'running';
      clearInterval(intervalId);
      intervalId = setInterval(tick, TICK_MS);
      window.dispatchEvent(new CustomEvent('matchgps:resume', { detail: publicState() }));
      return true;
    },

    stop() {
      clearInterval(intervalId);
      intervalId = null;
      const wasIdle = status === 'idle';
      status = 'idle';
      const summary = publicState();
      if (!wasIdle) window.dispatchEvent(new CustomEvent('matchgps:stop', { detail: summary }));
      return summary;
    },
  };

  window.CBMatchGpsLive = CBMatchGpsLive;
})();
