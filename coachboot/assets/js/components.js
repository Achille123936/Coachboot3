/* ==========================================================================
   COACHBOOT ENTERPRISE — SHARED COMPONENTS (header + sidebar)
   Pure JS templates injected into #app-header / #app-sidebar placeholders.
   Works fully offline (no fetch), so pages can be opened directly from disk.
   ========================================================================== */

/** Escapes a string for safe interpolation into innerHTML/outerHTML templates. */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
window.escapeHtml = escapeHtml;

const NAV_CONFIG = [
  {
    group: "Vue d'ensemble",
    items: [
      { key: "dashboard", label: "Tableau de bord", href: "dashboard.html", icon: "fa-gauge-high" },
      { key: "notifications", label: "Notifications", href: "notifications.html", icon: "fa-bell", badge: "6" },
      { key: "calendar", label: "Calendrier", href: "calendar.html", icon: "fa-calendar-days" },
    ],
  },
  {
    group: "Effectif & compétitions",
    items: [
      { key: "players", label: "Joueurs", href: "players.html", icon: "fa-person-running" },
      { key: "teams", label: "Équipes", href: "teams.html", icon: "fa-people-group" },
      { key: "matches", label: "Matchs", href: "matches.html", icon: "fa-futbol" },
      { key: "trainings", label: "Entraînements", href: "trainings.html", icon: "fa-stopwatch" },
      { key: "scouting", label: "Scouting", href: "scouting.html", icon: "fa-binoculars" },
    ],
  },
  {
    group: "Performance",
    items: [
      { key: "analytics", label: "Analyse des performances", href: "analytics.html", icon: "fa-chart-line" },
      { key: "physical-prep", label: "Préparation physique", href: "physical-prep.html", icon: "fa-dumbbell" },
      { key: "goalkeepers", label: "Entraîneur des gardiens", href: "goalkeepers.html", icon: "fa-hand-fist" },
      { key: "video-analysis", label: "Analyse vidéo", href: "video-analysis.html", icon: "fa-video" },
      { key: "gps", label: "GPS", href: "gps.html", icon: "fa-satellite-dish" },
      { key: "match-live", label: "Match Live", href: "match-live.html", icon: "fa-tower-broadcast" },
      { key: "player-live", label: "Espace Joueur (Live GPS)", href: "player-live.html", icon: "fa-mobile-screen-button" },
      { key: "nutrition", label: "Nutrition", href: "nutrition.html", icon: "fa-apple-whole" },
      { key: "injuries", label: "Blessures", href: "injuries.html", icon: "fa-kit-medical" },
      { key: "ai", label: "Intelligence artificielle", href: "ai.html", icon: "fa-brain" },
      { key: "train-ai", label: "Entraîner l'IA", href: "train-ai.html", icon: "fa-microchip" },
    ],
  },
  {
    group: "Cellules d'analyse",
    items: [
      { key: "cell-tactical", label: "Analyse tactique", href: "cell-tactical.html", icon: "fa-chess-board" },
      { key: "cell-technical", label: "Analyse technique", href: "cell-technical.html", icon: "fa-boot" },
      { key: "cell-physical", label: "Analyse physique", href: "cell-physical.html", icon: "fa-heart-pulse" },
      { key: "cell-mental", label: "Analyse mentale", href: "cell-mental.html", icon: "fa-face-smile" },
      { key: "cell-medical", label: "Analyse médicale", href: "cell-medical.html", icon: "fa-stethoscope" },
      { key: "cell-nutrition", label: "Analyse nutritionnelle", href: "cell-nutrition.html", icon: "fa-carrot" },
      { key: "cell-gps", label: "Analyse GPS", href: "cell-gps.html", icon: "fa-location-crosshairs" },
      { key: "cell-video", label: "Analyse vidéo (cellule)", href: "cell-video.html", icon: "fa-film" },
      { key: "cell-goalkeepers", label: "Analyse des gardiens", href: "cell-goalkeepers.html", icon: "fa-shield-halved" },
      { key: "cell-forwards", label: "Analyse des attaquants", href: "cell-forwards.html", icon: "fa-bolt" },
      { key: "cell-midfielders", label: "Analyse des milieux", href: "cell-midfielders.html", icon: "fa-arrows-left-right" },
      { key: "cell-defenders", label: "Analyse des défenseurs", href: "cell-defenders.html", icon: "fa-shield" },
      { key: "cell-ai", label: "Analyse IA", href: "cell-ai.html", icon: "fa-robot" },
      { key: "cell-competitions", label: "Analyse des compétitions", href: "cell-competitions.html", icon: "fa-trophy" },
      { key: "cell-trainings", label: "Analyse des entraînements", href: "cell-trainings.html", icon: "fa-list-check" },
      { key: "cell-scouting", label: "Analyse du scouting", href: "cell-scouting.html", icon: "fa-magnifying-glass" },
      { key: "cell-progression", label: "Progression des joueurs", href: "cell-progression.html", icon: "fa-arrow-trend-up" },
      { key: "cell-injury-risk", label: "Risque de blessure", href: "cell-injury-risk.html", icon: "fa-triangle-exclamation" },
      { key: "cell-comparison", label: "Comparaison de joueurs", href: "cell-comparison.html", icon: "fa-code-compare" },
      { key: "cell-prediction", label: "Prédiction de performance", href: "cell-prediction.html", icon: "fa-wand-magic-sparkles" },
    ],
  },
  {
    group: "Tableaux de bord par rôle",
    items: [
      { key: "dashboard-president", label: "Président", href: "dashboard-president.html", icon: "fa-user-tie" },
      { key: "dashboard-technical-director", label: "Directeur technique", href: "dashboard-technical-director.html", icon: "fa-clipboard-user" },
      { key: "dashboard-head-coach", label: "Entraîneur principal", href: "dashboard-head-coach.html", icon: "fa-whistle" },
      { key: "dashboard-fitness-coach", label: "Préparateur physique", href: "dashboard-fitness-coach.html", icon: "fa-dumbbell" },
      { key: "dashboard-goalkeeper-coach", label: "Entraîneur des gardiens", href: "dashboard-goalkeeper-coach.html", icon: "fa-hands-holding-circle" },
      { key: "dashboard-video-analyst", label: "Analyste vidéo", href: "dashboard-video-analyst.html", icon: "fa-clapperboard" },
      { key: "dashboard-data-analyst", label: "Data Analyst Football", href: "dashboard-data-analyst.html", icon: "fa-chart-simple" },
      { key: "dashboard-player", label: "Joueur", href: "dashboard-player.html", icon: "fa-shoe-prints" },
      { key: "dashboard-parent", label: "Parent", href: "dashboard-parent.html", icon: "fa-people-roof" },
      { key: "dashboard-federation", label: "Fédération", href: "dashboard-federation.html", icon: "fa-landmark" },
    ],
  },
  {
    group: "Formation",
    items: [
      { key: "academy", label: "CoachBoot IA Academy", href: "academy.html", icon: "fa-brain" },
      { key: "courses", label: "Cours", href: "courses.html", icon: "fa-graduation-cap" },
      { key: "quizzes", label: "Quiz", href: "quizzes.html", icon: "fa-circle-question" },
      { key: "certificates", label: "Certificats", href: "certificates.html", icon: "fa-award" },
      { key: "reports", label: "Rapports", href: "reports.html", icon: "fa-file-lines" },
    ],
  },
  {
    group: "Compte",
    items: [
      { key: "profile", label: "Profil", href: "profile.html", icon: "fa-circle-user" },
      { key: "settings", label: "Paramètres", href: "settings.html", icon: "fa-gear" },
      { key: "admin", label: "Administration", href: "admin.html", icon: "fa-user-shield" },
    ],
  },
];

function renderSidebar(activeKey) {
  const groups = NAV_CONFIG.map(g => `
    <div class="sidebar__group-label">${g.group}</div>
    ${g.items.map(it => `
      <a href="${it.href}" class="sidebar__link${it.key === activeKey ? ' active' : ''}">
        <i class="fa-solid ${it.icon}"></i>
        <span>${it.label}</span>
        ${it.badge ? `<span class="badge badge-red">${it.badge}</span>` : ''}
      </a>
    `).join('')}
  `).join('');

  return `
    <aside class="sidebar turf-texture" id="sidebar">
      <div class="sidebar__brand">
        <div class="mark">CB</div>
        <div class="name">CoachBoot<small>Enterprise</small></div>
      </div>
      <div class="sidebar__scroll">${groups}</div>
      <div class="sidebar__foot">© 2026 CoachBoot Enterprise — v1.0</div>
    </aside>
    <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
  `;
}

const ROLE_LABELS = {
  admin: 'Administrateur', president: 'Président', technical_director: 'Directeur technique',
  head_coach: 'Entraîneur principal', fitness_coach: 'Préparateur physique',
  goalkeeper_coach: 'Entraîneur des gardiens', video_analyst: 'Analyste vidéo',
  data_analyst: 'Data Analyst', player: 'Joueur', parent: 'Parent', federation: 'Fédération',
};

function renderHeader(pageTitle) {
  const liveUser = (typeof CB_API !== 'undefined') ? CB_API.user() : null;
  const rawName = (liveUser && liveUser.name) ? liveUser.name : 'Carmie Boot';
  const displayName = escapeHtml(rawName);
  const displayRole = escapeHtml((liveUser && liveUser.role) ? (ROLE_LABELS[liveUser.role] || liveUser.role) : 'Entraîneur principal');
  const initials = rawName.trim().split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'CB';
  const sessionBadge = liveUser
    ? `<span class="badge badge-green" title="Connecté à l'API en direct"><i class="fa-solid fa-plug-circle-check"></i> En direct</span>`
    : `<span class="badge badge-grey" title="Aucune session API active"><i class="fa-solid fa-flask"></i> Démo</span>`;

  return `
    <header class="topbar">
      <button class="topbar__menu-btn" id="menuBtn" aria-label="Ouvrir le menu"><i class="fa-solid fa-bars"></i></button>
      <div class="topbar__search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" placeholder="Rechercher un joueur, un match, un rapport…" aria-label="Recherche instantanée" id="globalSearch">
      </div>
      ${sessionBadge}
      <div class="topbar__spacer"></div>
      <div class="topbar__actions">
        <button class="theme-toggle" id="themeToggle" aria-label="Basculer le mode sombre/clair" title="Mode clair / sombre">
          <span class="knob"><i class="fa-solid fa-moon"></i></span>
        </button>
        <div class="dropdown">
          <button class="icon-btn" id="notifBtn" aria-label="Notifications"><i class="fa-solid fa-bell"></i><span class="dot"></span></button>
          <div class="dropdown__panel" id="notifPanel">
            <div class="head">Notifications <span class="badge badge-red">3 nouvelles</span></div>
            <div class="notif-item"><div class="ic badge-red" style="background:var(--danger-soft);color:var(--danger)"><i class="fa-solid fa-kit-medical"></i></div><div><b>Alerte blessure</b><br>Risque élevé détecté — J. Moreau</div></div>
            <div class="notif-item"><div class="ic" style="background:var(--info-soft);color:var(--info)"><i class="fa-solid fa-video"></i></div><div><b>Vidéo annotée</b><br>Analyse du match vs FC Nord disponible</div></div>
            <div class="notif-item"><div class="ic" style="background:var(--accent-soft);color:var(--accent)"><i class="fa-solid fa-trophy"></i></div><div><b>Rapport de scouting</b><br>3 nouveaux profils ajoutés</div></div>
          </div>
        </div>
        <div class="dropdown">
          <div class="topbar__user" id="userMenuBtn">
            <div class="avatar">${initials}</div>
            <div class="who"><b>${displayName}</b><span>${displayRole}</span></div>
            <i class="fa-solid fa-chevron-down" style="font-size:10px;color:var(--text-muted)"></i>
          </div>
          <div class="dropdown__panel" id="userPanel" style="width:200px;">
            <a href="profile.html" class="notif-item" style="align-items:center;"><i class="fa-solid fa-circle-user"></i> Mon profil</a>
            <a href="settings.html" class="notif-item" style="align-items:center;"><i class="fa-solid fa-gear"></i> Paramètres</a>
            <a href="index.html" class="notif-item" style="align-items:center;" id="logoutLink"><i class="fa-solid fa-right-from-bracket"></i> Déconnexion</a>
          </div>
        </div>
      </div>
    </header>
  `;
}

/** Modèle de footer unique, partagé par toutes les pages avec shell (sidebar +
 *  header). Injecté en JS plutôt que dupliqué dans chaque fichier HTML — une
 *  seule source de vérité, cohérente sur les 58 pages qui l'utilisent. Les
 *  pages sans shell (login/register/reset-password) ont un markup HTML
 *  statique équivalent avec la même classe .app-footer (voir ces fichiers). */
function renderFooter() {
  const year = new Date().getFullYear();
  return `
    <footer class="app-footer">
      <div class="app-footer__brand">
        <span class="app-footer__mark">CB</span>
        <span>© ${year} CoachBoot Enterprise <span class="app-footer__sep">·</span> v1.0</span>
      </div>
      <nav class="app-footer__links">
        <a href="academy.html"><i class="fa-solid fa-graduation-cap"></i> CoachBoot IA Academy</a>
        <a href="settings.html"><i class="fa-solid fa-gear"></i> Paramètres</a>
        <a href="mailto:support@coachboot.app"><i class="fa-solid fa-life-ring"></i> Support</a>
      </nav>
    </footer>
  `;
}

function mountAppShell(activeKey) {
  const sidebarMount = document.getElementById('app-sidebar');
  const headerMount = document.getElementById('app-header');
  if (sidebarMount) sidebarMount.outerHTML = renderSidebar(activeKey);
  if (headerMount) headerMount.outerHTML = renderHeader();
  // Footer : ajouté juste après <main class="content"> dans .app-main, jamais
  // dupliqué s'il est déjà là (ex: re-mount après changement de rôle démo).
  const mainPanel = document.querySelector('.app-main');
  if (mainPanel && !mainPanel.querySelector('.app-footer')) {
    mainPanel.insertAdjacentHTML('beforeend', renderFooter());
  }
  // theme.js registers its DOMContentLoaded listener before this one (script
  // load order) and wires up #themeToggle/#menuBtn/etc. on first run — before
  // the elements above exist. Re-run it now that they're in the DOM.
  if (window.CBWireUI) window.CBWireUI();
}

/* ---- Assistant IA : bulle flottante présente sur toutes les pages ---- */
function mountAiChat() {
  if (document.getElementById('aiChatFab')) return; // déjà monté (ex: double inclusion du script)

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <button class="ai-chat-fab" id="aiChatFab" aria-label="Ouvrir l'assistant IA" title="Assistant IA CoachBoot">
      <i class="fa-solid fa-robot"></i>
    </button>
    <div class="ai-chat-panel" id="aiChatPanel">
      <div class="ai-chat-panel__head">
        <div class="ic"><i class="fa-solid fa-robot"></i></div>
        <div><b>Assistant CoachBoot</b><br><small>Posez une question sur le club</small></div>
        <button class="ai-chat-panel__close" id="aiChatClose" aria-label="Fermer"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="ai-chat-panel__body" id="aiChatBody">
        <div class="ai-chat-msg ai-chat-msg--assistant">Bonjour ! Je peux répondre à vos questions sur l'effectif, les matchs, les blessures ou l'entraînement. Comment puis-je vous aider ?</div>
      </div>
      <div class="ai-chat-panel__foot">
        <textarea id="aiChatInput" placeholder="Écrivez votre message…" rows="1"></textarea>
        <button id="aiChatSend" aria-label="Envoyer"><i class="fa-solid fa-paper-plane"></i></button>
      </div>
    </div>
  `;
  document.body.append(...wrap.children);

  const fab = document.getElementById('aiChatFab');
  const panel = document.getElementById('aiChatPanel');
  const body = document.getElementById('aiChatBody');
  const input = document.getElementById('aiChatInput');
  const sendBtn = document.getElementById('aiChatSend');
  const history = [];

  const toggle = () => panel.classList.toggle('open');
  fab.addEventListener('click', toggle);
  document.getElementById('aiChatClose').addEventListener('click', toggle);

  function addMessage(text, cls) {
    const div = document.createElement('div');
    div.className = `ai-chat-msg ai-chat-msg--${cls}`;
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    input.value = '';
    addMessage(text, 'user');
    history.push({ role: 'user', content: text });
    sendBtn.disabled = true;
    const thinking = addMessage('…', 'assistant');

    try {
      if (typeof CB_API === 'undefined' || !CB_API.isAuthenticated()) {
        throw new Error('Connectez-vous pour utiliser l\'assistant IA.');
      }
      const reply = await CB_API.sendAssistantMessage(history);
      thinking.textContent = reply || '(réponse vide)';
      history.push({ role: 'assistant', content: reply || '' });
    } catch (err) {
      thinking.remove();
      addMessage(err.message || 'Erreur de connexion à l\'assistant.', 'error');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

/* ---- Délégation d'événements globale : data-action="..." ----------------
   Un seul écouteur au niveau document, plutôt que des attributs onclick="…"
   inline dans le HTML ou des écouteurs répétés par page. Ajouter un nouveau
   cas ici (et le data-action correspondant dans le HTML) plutôt que de créer
   un handler inline pour un besoin ponctuel. */
function handleGlobalAction(action, el) {
  switch (action) {
    case 'print':
      window.print();
      break;
    case 'start-quiz':
      (window.Swal || { fire: () => {} }).fire({
        icon: 'info',
        title: el.dataset.quizTitle || 'Quiz',
        text: 'Le quiz interactif démarrerait ici.',
        confirmButtonColor: '#2C8F5E',
      });
      break;
  }
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  handleGlobalAction(el.dataset.action, el);
});

document.addEventListener('DOMContentLoaded', () => {
  const key = document.body.getAttribute('data-page');
  if (key) mountAppShell(key);
  mountAiChat();
});
