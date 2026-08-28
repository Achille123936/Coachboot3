/* ==========================================================================
   COACHBOOT ENTERPRISE — CLIENT API (CB_API)
   Couche fine au-dessus de fetch() qui parle au backend réel
   (dossier /coachboot-backend, Express + PostgreSQL, port 4000 par défaut).

   Cette couche joue aussi le rôle d'adaptateur : le backend expose des
   noms de champs "propres" côté base de données (first_name, team_id,
   form_score...), tandis que les pages statiques ont été écrites autour
   de noms plus simples (name, team, form...). Traduire ici évite de
   dupliquer cette logique dans chaque page.

   Si le backend n'est pas démarré (ou si la page est ouverte via file://),
   chaque appel rejette proprement et les pages retombent sur leurs
   données de démonstration déjà présentes dans le HTML — voir le
   script de chaque page (players.html, dashboard.html, etc.).
   ========================================================================== */

// En local (localhost/127.0.0.1/fichier ouvert directement), l'API tourne sur
// localhost:4000. Servi depuis coachboot-frontend.onrender.com (Render), on
// pointe vers le backend Render déployé séparément — jamais deviné, jamais de
// mélange : ces deux environnements ne se chevauchent pas.
const CB_DEFAULT_API_BASE = ['localhost', '127.0.0.1', ''].includes(location.hostname)
  ? 'http://localhost:4000/api'
  : 'https://coachboot-backend.onrender.com/api';

const CB_API = {
  base: window.COACHBOOT_API_BASE || CB_DEFAULT_API_BASE,

  token() { return localStorage.getItem('coachboot-token'); },
  user() { try { return JSON.parse(localStorage.getItem('coachboot-user') || 'null'); } catch { return null; } },
  isAuthenticated() { return !!this.token(); },
  logout() { localStorage.removeItem('coachboot-token'); localStorage.removeItem('coachboot-user'); },
  saveSession(token, user) {
    localStorage.setItem('coachboot-token', token);
    localStorage.setItem('coachboot-user', JSON.stringify(user));
  },

  async request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && this.token()) headers.Authorization = `Bearer ${this.token()}`;
    let res;
    try {
      res = await fetch(this.base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (networkErr) {
      // Backend injoignable (non démarré, CORS, ou page ouverte en file://)
      throw new Error('API injoignable sur ' + this.base);
    }
    let data = null;
    try { data = await res.json(); } catch { /* pas de corps, ex. 204 */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Erreur HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  // ---- Rôles (libellé FR affiché dans le formulaire → enum backend) ----
  ROLE_MAP: {
    'Entraîneur principal': 'head_coach', 'Préparateur physique': 'fitness_coach',
    'Analyste vidéo': 'video_analyst', 'Data Analyst': 'data_analyst',
    'Président': 'president', 'Joueur': 'player', 'Parent': 'parent',
  },

  // ---- Auth ----
  async login(email, password) {
    const result = await this.request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
    return { token: result.token, user: { ...result.user, name: result.user.full_name } };
  },
  async register({ name, email, password, role, invite_code, new_club_name }) {
    const payload = { full_name: name, email, password, role: this.ROLE_MAP[role] || undefined, invite_code, new_club_name };
    const result = await this.request('/auth/register', { method: 'POST', body: payload, auth: false });
    return { token: result.token, user: { ...result.user, name: result.user.full_name }, club: result.club || null };
  },
  async me() {
    const result = await this.request('/auth/me');
    return { ...result.user, name: result.user.full_name };
  },
  async changePassword(currentPassword, newPassword) {
    return this.request('/auth/change-password', {
      method: 'PUT',
      body: { current_password: currentPassword, new_password: newPassword },
    });
  },
  async forgotPassword(email) {
    return this.request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false });
  },
  async resetPassword(token, newPassword) {
    return this.request('/auth/reset-password', { method: 'POST', body: { token, new_password: newPassword }, auth: false });
  },

  // ---- Joueurs ----
  async getPlayers() {
    const result = await this.request('/players');
    return {
      total: result.count,
      data: result.players.map(p => ({
        id: p.id,
        name: `${p.first_name} ${p.last_name}`,
        pos: p.position, num: p.jersey_number, age: ageFromBirthdate(p.birthdate),
        team: p.team_name || '—', form: p.form_score, status: p.status,
      })),
    };
  },
  /** Fiche du joueur lié au compte connecté (utilisé par player-live.html) ; null si aucune liaison. */
  async getMyPlayerProfile() {
    try {
      const result = await this.request('/players/me');
      const p = result.player;
      return { id: p.id, name: `${p.first_name} ${p.last_name}`, num: p.jersey_number, team: p.team_name || '—' };
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  },
  async createPlayer(formValues) {
    const parts = (formValues.name || '').trim().split(/\s+/);
    const first_name = parts.shift() || 'Nouveau';
    const last_name = parts.join(' ') || 'Joueur';

    // Le formulaire ne collecte qu'un nom d'équipe en texte libre : on tente
    // de le faire correspondre à une équipe existante côté backend.
    let team_id = null;
    if (formValues.team) {
      try {
        const { teams } = await this.request('/teams');
        const match = teams.find(t => t.name.toLowerCase().includes(formValues.team.toLowerCase()));
        if (match) team_id = match.id;
      } catch { /* pas grave si la recherche d'équipe échoue : on crée sans équipe */ }
    }

    return this.request('/players', {
      method: 'POST',
      body: {
        first_name, last_name,
        position: formValues.pos || 'Attaquant',
        jersey_number: formValues.num ? Number(formValues.num) : null,
        team_id,
      },
    });
  },
  deletePlayer(id) { return this.request(`/players/${id}`, { method: 'DELETE' }); },

  // ---- Matchs / équipes ----
  async getMatches() {
    const result = await this.request('/matches');
    return result.matches;
  },
  async getTeams() {
    const result = await this.request('/teams');
    return result.teams;
  },
  async createTeam({ name, category, level, coach }) {
    const result = await this.request('/teams', {
      method: 'POST',
      body: { name, category, level: level || undefined, coach_name: coach || undefined },
    });
    return result.team;
  },

  // ---- Formation ----
  async getCourses() {
    const result = await this.request('/courses');
    return result.courses;
  },
  async createCourse({ title, level, duration }) {
    const result = await this.request('/courses', {
      method: 'POST',
      body: { title, level: level || undefined, duration_label: duration || undefined },
    });
    return result.course;
  },
  async updateCourseProgress(id, progressPct) {
    const result = await this.request(`/courses/${id}/progress`, {
      method: 'PUT',
      body: { progress_pct: progressPct },
    });
    return result.progress;
  },

  // ---- CoachBoot IA Academy (chapitres/leçons/quiz notés/certificats) ----
  async getCourseChapters(courseId) {
    return this.request(`/courses/${courseId}/chapters`);
  },
  async completeLesson(lessonId) {
    return this.request(`/courses/lessons/${lessonId}/complete`, { method: 'POST' });
  },
  async completeExercise(exerciseId, notes) {
    return this.request(`/courses/exercises/${exerciseId}/complete`, { method: 'POST', body: { notes: notes || undefined } });
  },
  async getQuizQuestions(quizId) {
    return this.request(`/quizzes/${quizId}/questions`);
  },
  async submitQuiz(quizId, answers) {
    return this.request(`/quizzes/${quizId}/submit`, { method: 'POST', body: { answers } });
  },
  async issueCertificate(courseId) {
    const result = await this.request(`/certificates/course/${courseId}`, { method: 'POST' });
    return result.certificate;
  },
  async getCertificates() {
    const result = await this.request('/certificates');
    return result.certificates;
  },

  // ---- Academy : AI Course Generator (Gemini) ----
  // generate() n'écrit rien en base — juste un aperçu. save() persiste
  // réellement (transaction serveur) l'aperçu (éventuellement retouché).
  async generateCourseWithAI(params) {
    return this.request('/academy/generate', {
      method: 'POST',
      body: {
        title: params.title, subject: params.subject, level: params.level,
        chapterCount: params.chapterCount, durationLabel: params.durationLabel || null,
        language: params.language || 'fr', targetAudience: params.targetAudience || null,
        objectives: params.objectives || null, questionsPerQuiz: params.questionsPerQuiz || 5,
      },
    });
  },
  async saveGeneratedCourse({ generated, level, language }) {
    const result = await this.request('/academy/courses', { method: 'POST', body: { generated, level, language } });
    return result.course;
  },

  // ---- Entraînements ----
  async getTrainings(teamId) {
    const result = await this.request('/trainings' + (teamId ? `?team_id=${encodeURIComponent(teamId)}` : ''));
    return result.trainings;
  },
  async createTraining({ teamId, sessionDate, type, durationMinutes, rpe, notes }) {
    const result = await this.request('/trainings', {
      method: 'POST',
      body: { team_id: teamId || undefined, session_date: sessionDate, type, duration_minutes: durationMinutes || undefined, rpe: rpe || undefined, notes: notes || undefined },
    });
    return result.training;
  },
  deleteTraining(id) { return this.request(`/trainings/${id}`, { method: 'DELETE' }); },

  // ---- Scouting ----
  async getScoutingProfiles({ q, favoritesOnly } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (favoritesOnly) params.set('favorite', 'true');
    const qs = params.toString();
    const result = await this.request('/scouting' + (qs ? `?${qs}` : ''));
    return result.profiles;
  },
  async createScoutingProfile({ name, currentClub, position, age, rating, tag, notes }) {
    const result = await this.request('/scouting', {
      method: 'POST',
      body: { name, current_club: currentClub || undefined, position: position || undefined, age: age || undefined, rating: rating || undefined, tag: tag || undefined, notes: notes || undefined },
    });
    return result.profile;
  },
  async updateScoutingProfile(id, fields) {
    const result = await this.request(`/scouting/${id}`, { method: 'PUT', body: fields });
    return result.profile;
  },
  deleteScoutingProfile(id) { return this.request(`/scouting/${id}`, { method: 'DELETE' }); },

  // ---- Rapports ----
  async getReports(type) {
    const result = await this.request('/reports' + (type ? `?type=${encodeURIComponent(type)}` : ''));
    return result.reports;
  },
  async createReport({ title, type, reportDate }) {
    const result = await this.request('/reports', { method: 'POST', body: { title, type, report_date: reportDate || undefined } });
    return result.report;
  },
  /** Télécharge un export réel (PDF/Excel) — déclenche le téléchargement du navigateur. */
  async downloadReportExport(id, format, filenameHint) {
    const res = await fetch(`${this.base}/reports/${id}/export?format=${encodeURIComponent(format)}`, {
      headers: this.token() ? { Authorization: `Bearer ${this.token()}` } : {},
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Erreur HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filenameHint || `rapport.${format === 'excel' ? 'xlsx' : 'pdf'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // ---- Tableau de bord ----
  async getDashboardStats() {
    const d = await this.request('/dashboard/summary');
    return {
      data: {
        matchesPlayed: d.matches_played,
        points: d.points,
        playersAvailable: d.players_available,
        playersTotal: d.players_total,
        xgTotal: d.xg_total,
        nextMatch: d.next_match,
        recentMatches: d.recent_matches,
      },
    };
  },

  // ---- Notifications ----
  async getNotifications() {
    return this.request('/notifications');
  },

  // ---- Blessures / risque ----
  async getInjuryRiskScores() {
    return this.request('/injuries/risk-scores');
  },

  // ---- Assistant IA ----
  async sendAssistantMessage(messages) {
    const result = await this.request('/assistant/chat', { method: 'POST', body: { messages } });
    return result.reply;
  },

  // ---- GPS (suivi en direct) ----
  /** Sauvegarde une session de tracking complète (métadonnées + statistiques + trace de points). */
  async saveGpsSession({ playerId, matchId, sessionDate, durationSec, points, ...stats }) {
    const result = await this.request('/gps/session', {
      method: 'POST',
      body: {
        player_id: playerId,
        match_id: matchId || null,
        session_date: sessionDate,
        duration_minutes: durationSec ? +(durationSec / 60).toFixed(2) : null,
        statistics: {
          distance_km: stats.distanceKm,
          high_intensity_km: stats.highIntensityKm,
          sprint_distance_km: stats.sprintDistanceKm,
          max_speed_kmh: stats.maxSpeedKmh,
          avg_speed_kmh: stats.avgSpeedKmh,
          acceleration_count: stats.accelerationCount,
          deceleration_count: stats.decelerationCount,
          sprint_count: stats.sprintCount,
          intense_sprint_count: stats.intenseSprintCount,
        },
        points: (points || []).map(p => ({
          lat: p.lat, lng: p.lng, altitude: p.altitude ?? null,
          accuracy: p.accuracy ?? null, speed: p.speed ?? null, t: p.t,
        })),
      },
    });
    return result;
  },
  async getGpsSession(id) { return this.request(`/gps/session/${id}`); },
  async getPlayerGpsStats(playerId) { return this.request(`/gps/player/${playerId}/stats`); },

  // ---- Match Live (caméra + GPS temps réel) ----
  async getMatchesLive(status) {
    const result = await this.request('/match-live' + (status ? `?status=${encodeURIComponent(status)}` : ''));
    return result.matches_live;
  },
  async createMatchLive({ teamHome, teamAway, streamUrl }) {
    const result = await this.request('/match-live', {
      method: 'POST',
      body: { team_home: teamHome, team_away: teamAway, stream_url: streamUrl || null },
    });
    return result.match_live;
  },
  async updateMatchLiveStatus(id, status, streamUrl) {
    const result = await this.request(`/match-live/${id}`, { method: 'PUT', body: { status, stream_url: streamUrl || null } });
    return result.match_live;
  },
  async logMatchLiveEvent(id, { playerId, eventType, time }) {
    const result = await this.request(`/match-live/${id}/events`, {
      method: 'POST', body: { player_id: playerId || null, event_type: eventType, time },
    });
    return result.event;
  },

  // ---- Télestration vidéo (clips + annotations) ----
  // La vidéo elle-même n'est jamais envoyée au serveur (URL directement
  // lisible, ou fichier local via URL.createObjectURL côté page) — seules
  // les annotations (tracés + fenêtre temporelle) sont persistées.
  async getVideoClips(matchId) {
    const result = await this.request('/video/clips' + (matchId ? `?match_id=${encodeURIComponent(matchId)}` : ''));
    return result.clips;
  },
  async createVideoClip({ title, videoUrl, sourceType, matchId, playerId, recordedAtStart }) {
    const result = await this.request('/video/clips', {
      method: 'POST',
      body: {
        title, video_url: videoUrl || null, source_type: sourceType || 'url', match_id: matchId || null,
        player_id: playerId || null, recorded_at_start: recordedAtStart || null,
      },
    });
    return result.clip;
  },
  async updateVideoClip(id, fields) {
    const result = await this.request(`/video/clips/${id}`, { method: 'PUT', body: fields });
    return result.clip;
  },
  async deleteVideoClip(id) { return this.request(`/video/clips/${id}`, { method: 'DELETE' }); },
  async getClipAnnotations(clipId) {
    const result = await this.request(`/video/clips/${clipId}/annotations`);
    return result.annotations;
  },
  async createVideoAnnotation(clipId, { type, data, timestampStartSec, timestampEndSec, playerId }) {
    const result = await this.request(`/video/clips/${clipId}/annotations`, {
      method: 'POST',
      body: { type, data, timestamp_start_sec: timestampStartSec, timestamp_end_sec: timestampEndSec ?? null, player_id: playerId || null },
    });
    return result.annotation;
  },
  async updateVideoAnnotation(id, fields) {
    const result = await this.request(`/video/annotations/${id}`, { method: 'PUT', body: fields });
    return result.annotation;
  },
  async deleteVideoAnnotation(id) { return this.request(`/video/annotations/${id}`, { method: 'DELETE' }); },
  /** Corrèle une annotation à une vraie position GPS (voir docs/API.md, section Télestration).
   *  Réponse honnête : { found:true, latitude, longitude, speed_kmh, source, delta_seconds }
   *  ou { found:false, reason: 'no_time_anchor'|'no_nearby_gps_data' } — jamais fabriquée. */
  async getAnnotationGps(id) { return this.request(`/video/annotations/${id}/gps`); },
};

function ageFromBirthdate(birthdate) {
  if (!birthdate) return '—';
  const diff = Date.now() - new Date(birthdate).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}
