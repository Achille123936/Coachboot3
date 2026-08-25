// Recalcule les statistiques GPS (distance, vitesse, sprints, accélérations)
// côté serveur à partir de la trace de points bruts — port fidèle de l'algorithme
// client (coachboot/assets/js/gps-live.js, mêmes seuils sports-science) pour ne
// plus faire confiance aveuglément aux agrégats calculés côté client (voir
// docs/SECURITY.md). Les points bruts, eux, ont toujours été stockés tels quels
// dans gps_points ; ce module ne fait que dériver les agrégats à partir d'eux,
// exactement comme le fait le tracker en direct.

const SPRINT_KMH = 22;
const INTENSE_SPRINT_KMH = 25;
const HIGH_INTENSITY_KMH = 19.8;
const ACCEL_THRESHOLD_MS2 = 3;
const DECEL_THRESHOLD_MS2 = -3;
const EVENT_COOLDOWN_MS = 2000;
const MAX_PLAUSIBLE_KMH = 45;
const MIN_SEGMENT_KM = 0.0015;

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

/**
 * @param {Array<{lat:number, lng:number, speed?:number, t:number|string}>} rawPoints
 * @returns {object|null} mêmes champs que le tracker client, ou null si <2 points exploitables
 */
function computeGpsMetricsFromPoints(rawPoints) {
  const points = (rawPoints || [])
    .map(p => ({ lat: Number(p.lat), lng: Number(p.lng), speed: typeof p.speed === 'number' ? p.speed : null, t: new Date(p.t).getTime() }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  if (points.length < 2) return null;

  let distanceKm = 0, highIntensityKm = 0, sprintDistanceKm = 0;
  let currentSpeedKmh = 0, maxSpeedKmh = 0;
  let sprintCount = 0, intenseSprintCount = 0, accelerationCount = 0, decelerationCount = 0;
  let lastSprintAt = 0, lastAccelAt = 0, lastDecelAt = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const point = points[i];
    const t = point.t;

    const dtSec0 = (t - prev.t) / 1000;
    const segmentKm0 = haversineKm(prev, point);
    const impliedKmh = dtSec0 > 0 ? segmentKm0 / (dtSec0 / 3600) : 0;
    const plausibleSegment = impliedKmh <= MAX_PLAUSIBLE_KMH;

    let speedKmh = currentSpeedKmh;
    if (typeof point.speed === 'number' && !Number.isNaN(point.speed) && point.speed >= 0) {
      speedKmh = point.speed * 3.6;
    } else if (plausibleSegment) {
      const dtH = dtSec0 / 3600;
      if (dtH > 0) speedKmh = segmentKm0 / dtH;
    }
    if (speedKmh > MAX_PLAUSIBLE_KMH) speedKmh = currentSpeedKmh;

    if (plausibleSegment) {
      const segmentKm = segmentKm0;
      if (segmentKm > MIN_SEGMENT_KM) {
        distanceKm += segmentKm;
        if (speedKmh >= HIGH_INTENSITY_KMH) highIntensityKm += segmentKm;
        if (speedKmh >= SPRINT_KMH) sprintDistanceKm += segmentKm;
      }

      const dtSec = dtSec0;
      if (dtSec >= 0.3 && dtSec <= 5) {
        const aMs2 = ((speedKmh - currentSpeedKmh) * (1000 / 3600)) / dtSec;
        if (aMs2 >= ACCEL_THRESHOLD_MS2 && (t - lastAccelAt) > EVENT_COOLDOWN_MS) {
          accelerationCount += 1;
          lastAccelAt = t;
        } else if (aMs2 <= DECEL_THRESHOLD_MS2 && (t - lastDecelAt) > EVENT_COOLDOWN_MS) {
          decelerationCount += 1;
          lastDecelAt = t;
        }
      }
    }

    currentSpeedKmh = speedKmh;
    if (speedKmh > maxSpeedKmh) maxSpeedKmh = speedKmh;

    if (speedKmh >= SPRINT_KMH && (t - lastSprintAt) > EVENT_COOLDOWN_MS) {
      sprintCount += 1;
      if (speedKmh >= INTENSE_SPRINT_KMH) intenseSprintCount += 1;
      lastSprintAt = t;
    }
  }

  const durationSec = Math.max(0, Math.round((points[points.length - 1].t - points[0].t) / 1000));
  const avgSpeedKmh = durationSec > 0 ? distanceKm / (durationSec / 3600) : 0;

  return {
    distance_km: round(distanceKm, 3),
    high_intensity_km: round(highIntensityKm, 3),
    sprint_distance_km: round(sprintDistanceKm, 3),
    max_speed_kmh: round(maxSpeedKmh, 2),
    avg_speed_kmh: round(avgSpeedKmh, 2),
    acceleration_count: accelerationCount,
    deceleration_count: decelerationCount,
    sprint_count: sprintCount,
    intense_sprint_count: intenseSprintCount,
  };
}

module.exports = { computeGpsMetricsFromPoints, THRESHOLDS: { SPRINT_KMH, INTENSE_SPRINT_KMH, HIGH_INTENSITY_KMH, ACCEL_THRESHOLD_MS2, DECEL_THRESHOLD_MS2, MAX_PLAUSIBLE_KMH } };
