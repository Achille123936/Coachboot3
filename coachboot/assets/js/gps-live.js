/* ==========================================================================
   COACHBOOT ENTERPRISE — LIVE GPS TRACKER
   Wraps the browser Geolocation API (navigator.geolocation.watchPosition) to
   turn raw device positions into football-style physical performance metrics
   in real time: distance, instantaneous/max/average speed, high-intensity &
   sprint distance, sprint/intense-sprint counts, strong acceleration and
   deceleration counts. Framework-free and page-agnostic: it only touches
   `navigator` and dispatches CustomEvents on `window`, so any page can
   subscribe (KPIs, Leaflet map, heatmap, charts) without coupling to a
   specific renderer.

   Events: 'cbgps:start', 'cbgps:tick' (detail = live state snapshot),
   'cbgps:pause', 'cbgps:resume', 'cbgps:stop' (detail includes `summary`,
   the full session ready to persist), 'cbgps:error' (detail = { message, code }).
   ========================================================================== */
(function () {
  // Seuils sports-science communément utilisés en préparation physique football.
  const SPRINT_KMH = 22;
  const INTENSE_SPRINT_KMH = 25;
  const HIGH_INTENSITY_KMH = 19.8;
  const ACCEL_THRESHOLD_MS2 = 3;    // accélération forte
  const DECEL_THRESHOLD_MS2 = -3;   // freinage fort
  const EVENT_COOLDOWN_MS = 2000;   // évite de recompter un même sprint/accel/décél en continu
  const MAX_PLAUSIBLE_KMH = 45;     // écarte les pics dus au bruit GPS
  const MIN_SEGMENT_KM = 0.0015;    // ignore les sauts quasi nuls dus au bruit GPS à l'arrêt
  const MAX_POINTS_LOGGED = 20000;  // garde-fou mémoire pour les très longues sessions

  let state = freshState();

  function freshState() {
    return {
      status: 'idle', // idle | tracking | paused
      watchId: null,
      points: [],
      distanceKm: 0,
      highIntensityKm: 0,
      sprintDistanceKm: 0,
      currentSpeedKmh: 0,
      maxSpeedKmh: 0,
      accuracyM: null,
      altitudeM: null,
      sprintCount: 0,
      intenseSprintCount: 0,
      accelerationCount: 0,
      decelerationCount: 0,
      lastSprintAt: 0,
      lastAccelAt: 0,
      lastDecelAt: 0,
      startedAt: null,
      pausedAccumMs: 0,
      pausedAt: null,
    };
  }

  function toRad(deg) { return deg * Math.PI / 180; }

  function haversineKm(a, b) {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  function round(n, d) { const f = 10 ** d; return Math.round((n || 0) * f) / f; }

  function activeDurationMs() {
    if (!state.startedAt) return 0;
    const end = (state.status === 'paused' && state.pausedAt) ? state.pausedAt : Date.now();
    return Math.max(0, end - state.startedAt - state.pausedAccumMs);
  }

  /** Snapshot exposé aux pages : jamais l'état interne brut (lastSprintAt, watchId, etc.). */
  function publicState() {
    const durationMs = activeDurationMs();
    const avgSpeedKmh = durationMs > 0 ? state.distanceKm / (durationMs / 3600000) : 0;
    return {
      status: state.status,
      points: state.points,
      distanceKm: state.distanceKm,
      highIntensityKm: state.highIntensityKm,
      sprintDistanceKm: state.sprintDistanceKm,
      currentSpeedKmh: state.currentSpeedKmh,
      maxSpeedKmh: state.maxSpeedKmh,
      avgSpeedKmh,
      accuracyM: state.accuracyM,
      altitudeM: state.altitudeM,
      sprintCount: state.sprintCount,
      intenseSprintCount: state.intenseSprintCount,
      accelerationCount: state.accelerationCount,
      decelerationCount: state.decelerationCount,
      durationSec: Math.floor(durationMs / 1000),
    };
  }

  function emit(type, extra) {
    window.dispatchEvent(new CustomEvent(type, { detail: Object.assign(publicState(), extra) }));
  }

  function handlePosition(pos) {
    if (state.status !== 'tracking') return; // ignore un callback tardif reçu après pause/arrêt
    const { latitude: lat, longitude: lng, altitude, accuracy, speed } = pos.coords;
    const t = pos.timestamp;
    const point = { lat, lng, altitude: (typeof altitude === 'number') ? altitude : null, accuracy, speed, t };

    state.accuracyM = accuracy;
    state.altitudeM = point.altitude;

    const prev = state.points[state.points.length - 1];
    let speedKmh = state.currentSpeedKmh;

    // Un saut de position implausible (réacquisition de signal, multi-trajet en zone urbaine)
    // ne doit pas être compté comme un déplacement réel : on le détecte une fois ici et on
    // l'utilise pour ignorer aussi bien la distance du segment que l'accélération dérivée,
    // plutôt que de ne filtrer que l'affichage de la vitesse instantanée pendant que la
    // distance cumulée (elle) gobait silencieusement le saut.
    let plausibleSegment = true;
    if (prev) {
      const dtSec = (t - prev.t) / 1000;
      const segmentKm = haversineKm(prev, point);
      const impliedKmh = dtSec > 0 ? segmentKm / (dtSec / 3600) : 0;
      plausibleSegment = impliedKmh <= MAX_PLAUSIBLE_KMH;
    }

    if (typeof speed === 'number' && !Number.isNaN(speed) && speed >= 0) {
      speedKmh = speed * 3.6; // vitesse native de la puce GPS (m/s) — la plus fiable quand disponible
    } else if (prev && plausibleSegment) {
      const dtH = (t - prev.t) / 1000 / 3600;
      if (dtH > 0) speedKmh = haversineKm(prev, point) / dtH;
    }
    if (speedKmh > MAX_PLAUSIBLE_KMH) speedKmh = state.currentSpeedKmh;

    if (prev && plausibleSegment) {
      const segmentKm = haversineKm(prev, point);
      if (segmentKm > MIN_SEGMENT_KM) {
        state.distanceKm += segmentKm;
        if (speedKmh >= HIGH_INTENSITY_KMH) state.highIntensityKm += segmentKm;
        if (speedKmh >= SPRINT_KMH) state.sprintDistanceKm += segmentKm;
      }

      const dtSec = (t - prev.t) / 1000;
      // n'évalue l'accélération que sur un intervalle plausible (évite les divisions
      // faussées par un dt quasi nul ou une coupure de signal prolongée)
      if (dtSec >= 0.3 && dtSec <= 5) {
        const aMs2 = ((speedKmh - state.currentSpeedKmh) * (1000 / 3600)) / dtSec;
        if (aMs2 >= ACCEL_THRESHOLD_MS2 && (t - state.lastAccelAt) > EVENT_COOLDOWN_MS) {
          state.accelerationCount += 1;
          state.lastAccelAt = t;
        } else if (aMs2 <= DECEL_THRESHOLD_MS2 && (t - state.lastDecelAt) > EVENT_COOLDOWN_MS) {
          state.decelerationCount += 1;
          state.lastDecelAt = t;
        }
      }
    }

    state.currentSpeedKmh = speedKmh;
    if (speedKmh > state.maxSpeedKmh) state.maxSpeedKmh = speedKmh;

    if (speedKmh >= SPRINT_KMH && (t - state.lastSprintAt) > EVENT_COOLDOWN_MS) {
      state.sprintCount += 1;
      if (speedKmh >= INTENSE_SPRINT_KMH) state.intenseSprintCount += 1;
      state.lastSprintAt = t;
    }

    if (state.points.length < MAX_POINTS_LOGGED) state.points.push(point);
    emit('cbgps:tick', { point });
  }

  function friendlyGeoError(err) {
    return {
      1: "Autorisation de localisation refusée. Activez-la dans les réglages du navigateur pour suivre le GPS en direct.",
      2: "Position indisponible (signal GPS introuvable — essayez en extérieur, à ciel dégagé).",
      3: "Délai dépassé en attendant une position GPS.",
    }[err.code] || err.message;
  }

  function watchOptions() {
    return { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 };
  }

  function getSessionSummary() {
    const s = publicState();
    return {
      startedAt: state.startedAt,
      durationSec: s.durationSec,
      distanceKm: round(s.distanceKm, 3),
      highIntensityKm: round(s.highIntensityKm, 3),
      sprintDistanceKm: round(s.sprintDistanceKm, 3),
      maxSpeedKmh: round(s.maxSpeedKmh, 2),
      avgSpeedKmh: round(s.avgSpeedKmh, 2),
      accelerationCount: state.accelerationCount,
      decelerationCount: state.decelerationCount,
      sprintCount: state.sprintCount,
      intenseSprintCount: state.intenseSprintCount,
      points: state.points.slice(),
    };
  }

  const CBGpsLive = {
    THRESHOLDS: { SPRINT_KMH, INTENSE_SPRINT_KMH, HIGH_INTENSITY_KMH, ACCEL_THRESHOLD_MS2, DECEL_THRESHOLD_MS2 },

    isSupported() { return 'geolocation' in navigator; },
    isTracking() { return state.status === 'tracking'; },
    isPaused() { return state.status === 'paused'; },
    isIdle() { return state.status === 'idle'; },
    getState() { return publicState(); },
    getSessionSummary,

    start() {
      if (!this.isSupported()) {
        emit('cbgps:error', { message: "Géolocalisation non disponible sur cet appareil/navigateur." });
        return false;
      }
      if (state.status === 'tracking') return true;
      if (state.status === 'paused') return this.resume();

      state = freshState();
      state.status = 'tracking';
      state.startedAt = Date.now();
      state.watchId = navigator.geolocation.watchPosition(
        handlePosition,
        (err) => {
          emit('cbgps:error', { message: friendlyGeoError(err), code: err.code });
          if (err.code === 1) this.stop(); // permission refusée : pas de reprise possible
        },
        watchOptions()
      );
      emit('cbgps:start', {});
      return true;
    },

    pause() {
      if (state.status !== 'tracking') return false;
      if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
      state.status = 'paused';
      state.pausedAt = Date.now();
      emit('cbgps:pause', {});
      return true;
    },

    resume() {
      if (state.status !== 'paused') return false;
      state.pausedAccumMs += Date.now() - state.pausedAt;
      state.pausedAt = null;
      state.status = 'tracking';
      state.watchId = navigator.geolocation.watchPosition(
        handlePosition,
        (err) => {
          emit('cbgps:error', { message: friendlyGeoError(err), code: err.code });
          if (err.code === 1) this.stop();
        },
        watchOptions()
      );
      emit('cbgps:resume', {});
      return true;
    },

    stop() {
      if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
      const wasIdle = state.status === 'idle';
      state.status = 'idle';
      const summary = getSessionSummary();
      if (!wasIdle) emit('cbgps:stop', { summary });
      return summary;
    },
  };

  window.CBGpsLive = CBGpsLive;
})();
