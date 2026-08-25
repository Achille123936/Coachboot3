/* ==========================================================================
   COACHBOOT ENTERPRISE — HISTORIQUE DES SESSIONS GPS (localStorage)
   Persiste les sessions de tracking GPS terminées côté navigateur, pour que
   l'historique reste consultable même sans backend démarré. Complète (ne
   remplace pas) la sauvegarde serveur réelle via CB_API.saveGpsSession —
   voir assets/js/api.js et coachboot-backend/src/routes/gps.routes.js
   (POST /api/gps/session).
   ========================================================================== */
(function () {
  const STORAGE_KEY = 'coachboot-gps-sessions';
  const MAX_SESSIONS = 30; // garde-fou pour ne pas saturer le quota localStorage (~5-10 Mo)

  function readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeAll(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      // Quota localStorage dépassé (session très longue avec beaucoup de points) :
      // on retente sans les traces de points bruts, en gardant le résumé exploitable.
      try {
        const trimmed = list.map(s => ({ ...s, points: [] }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
        return true;
      } catch {
        return false;
      }
    }
  }

  const CBGpsStorage = {
    /** Sauvegarde une session (résumé de CBGpsLive.getSessionSummary() + méta joueur/match). */
    save(entry) {
      const list = readAll();
      const record = {
        id: entry.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        savedAt: Date.now(),
        playerId: entry.playerId || null,
        playerName: entry.playerName || 'Joueur',
        matchLabel: entry.matchLabel || '',
        sessionDate: entry.sessionDate || new Date().toISOString().slice(0, 10),
        durationSec: entry.durationSec || 0,
        distanceKm: entry.distanceKm || 0,
        highIntensityKm: entry.highIntensityKm || 0,
        sprintDistanceKm: entry.sprintDistanceKm || 0,
        maxSpeedKmh: entry.maxSpeedKmh || 0,
        avgSpeedKmh: entry.avgSpeedKmh || 0,
        accelerationCount: entry.accelerationCount || 0,
        decelerationCount: entry.decelerationCount || 0,
        sprintCount: entry.sprintCount || 0,
        intenseSprintCount: entry.intenseSprintCount || 0,
        points: Array.isArray(entry.points) ? entry.points : [],
        syncedToServer: !!entry.syncedToServer,
      };
      list.unshift(record);
      while (list.length > MAX_SESSIONS) list.pop();
      writeAll(list);
      return record;
    },

    list() { return readAll(); },
    get(id) { return readAll().find(s => s.id === id) || null; },

    remove(id) {
      const list = readAll().filter(s => s.id !== id);
      writeAll(list);
    },

    markSynced(id) {
      const list = readAll();
      const rec = list.find(s => s.id === id);
      if (rec) { rec.syncedToServer = true; writeAll(list); }
    },

    clear() { localStorage.removeItem(STORAGE_KEY); },
  };

  window.CBGpsStorage = CBGpsStorage;
})();
