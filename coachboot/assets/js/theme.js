/* ==========================================================================
   COACHBOOT ENTERPRISE — THEME + UI INTERACTIONS
   ========================================================================== */
(function () {
  const STORAGE_KEY = 'coachboot-theme';

  // Graceful fallback if the SweetAlert2 CDN is blocked/slow: keeps every
  // Swal.fire(...) call across the app from throwing.
  if (!window.Swal) {
    window.Swal = { fire: (opts = {}) => { window.alert([opts.title, opts.text].filter(Boolean).join('\n')); return Promise.resolve({ isConfirmed: true }); } };
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    document.querySelectorAll('#themeToggle .knob i').forEach(i => {
      i.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    });
  }

  // Apply saved theme immediately (before paint where possible)
  const saved = localStorage.getItem(STORAGE_KEY) ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);

  function wireUi() {
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        applyTheme(current === 'dark' ? 'light' : 'dark');
      });
    }

    // Mobile sidebar
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    function closeSidebar() { sidebar && sidebar.classList.remove('open'); backdrop && backdrop.classList.remove('open'); }
    if (menuBtn) menuBtn.addEventListener('click', () => { sidebar && sidebar.classList.toggle('open'); backdrop && backdrop.classList.toggle('open'); });
    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    // Logout
    // `CB_API` est déclaré via `const` dans api.js (liaison de portée globale, pas une
    // propriété de `window`) — `window.CB_API` est toujours undefined, ce qui empêchait
    // ce lien de jamais appeler logout() (il ne faisait que naviguer vers index.html).
    const logoutLink = document.getElementById('logoutLink');
    if (logoutLink) logoutLink.addEventListener('click', () => { if (typeof CB_API !== 'undefined') CB_API.logout(); });

    // Dropdowns (notifications / user menu)
    const dropdownPairs = [
      ['notifBtn', 'notifPanel'],
      ['userMenuBtn', 'userPanel'],
    ];
    dropdownPairs.forEach(([btnId, panelId]) => {
      const btn = document.getElementById(btnId);
      const panel = document.getElementById(panelId);
      if (!btn || !panel) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.dropdown__panel').forEach(p => { if (p !== panel) p.classList.remove('open'); });
        panel.classList.toggle('open');
      });
    });
    document.addEventListener('click', () => {
      document.querySelectorAll('.dropdown__panel').forEach(p => p.classList.remove('open'));
    });

    // Global search (instant filter demo on [data-search-target] rows)
    const search = document.getElementById('globalSearch');
    if (search) {
      search.addEventListener('input', () => {
        const term = search.value.trim().toLowerCase();
        document.querySelectorAll('[data-searchable]').forEach(row => {
          const text = row.textContent.toLowerCase();
          row.style.display = term === '' || text.includes(term) ? '' : 'none';
        });
      });
    }

    // Tabs
    document.querySelectorAll('.tabs').forEach(tabGroup => {
      const buttons = tabGroup.querySelectorAll('button[data-tab]');
      buttons.forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-tab');
          buttons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const panelGroup = btn.closest('[data-tabs-wrap]') || document;
          panelGroup.querySelectorAll('[data-tab-panel]').forEach(p => {
            p.style.display = p.getAttribute('data-tab-panel') === target ? '' : 'none';
          });
        });
      });
    });
  }

  // Exposed so components.js can re-run it once it has injected the header/sidebar
  // markup — DOMContentLoaded listeners fire in registration order, and this
  // script registers before components.js, so wireUi() would otherwise run
  // before #themeToggle, #menuBtn, #sidebar, etc. exist in the DOM.
  window.CBWireUI = wireUi;

  document.addEventListener('DOMContentLoaded', () => {
    wireUi();
    if (window.AOS) AOS.init({ duration: 600, once: true, offset: 40 });
  });
})();
