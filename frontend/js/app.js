// App shell: view routing + top-bar action wiring.
const App = (() => {
  const TITLES = { setup: 'Initialize Game / Scoring', games: 'Games', statistics: 'Statistics', utilities: 'Utilities', visualization: 'Visualization', preferences: 'Preferences' };
  let current = 'games';

  function refreshActions() {
    const host = document.getElementById('topbar-actions');
    host.innerHTML = current === 'utilities' ? Utilities.actions() : '';
    host.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => Utilities.onAction(b.dataset.act));
  }

  function placeholder(view, blurb, phase) {
    return UI.empty('🚧', blurb,
      `<div class="coming-soon"><span class="tag">Arriving in ${phase}</span></div>`);
  }

  async function show(view) {
    current = view;
    document.getElementById('view-title').textContent = TITLES[view];
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
    const root = document.getElementById('view-root');
    try {
      refreshActions();
      if (view === 'utilities') { await Utilities.render(root); refreshActions(); return; }
      if (view === 'setup') { await Setup.render(root); return; }
      if (view === 'games') { await Games.render(root); return; }
      if (view === 'statistics') { await Statistics.render(root); return; }
      if (view === 'visualization') { await Visualization.render(root); return; }
      if (view === 'preferences') { await Prefs.render(root); return; }
    } catch (e) {
      // Keep the app shell alive: show a recoverable inline error in the view
      // instead of letting the exception blank the screen.
      if (root) {
        root.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'empty';
        box.innerHTML = '<div class="big">\u26A0\uFE0F</div>'
          + '<div>This view ran into a problem and couldn\u2019t load.</div>';
        const btn = document.createElement('button');
        btn.className = 'btn primary';
        btn.style.marginTop = '14px';
        btn.textContent = 'Retry';
        btn.onclick = () => show(view);
        box.appendChild(btn);
        root.appendChild(box);
      }
      if (typeof console !== 'undefined') console.error('[view ' + view + ']', e);
    }
  }

  // Full-screen recovery overlay shown when an uncaught error would otherwise
  // leave a blank (dark-blue) screen. Because broken state can live in
  // localStorage, a plain reload may keep failing -- so we offer a one-click
  // "reset local data" that clears this app's own keys WITHOUT the user having
  // to manually clear the browser cache / site data.
  let _recoveryShown = false;
  function showRecovery(detail) {
    if (_recoveryShown) return;
    _recoveryShown = true;
    try {
      // A stuck-open modal can also look like an "all blue" screen -- hide it.
      const mh = document.getElementById('modal-host');
      if (mh) mh.classList.add('hidden');
    } catch (_e) { /* ignore */ }
    const ov = document.createElement('div');
    ov.id = 'app-recovery';
    ov.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:9999',
      'display:grid', 'place-items:center',
      'background:rgba(3,7,15,.92)', 'backdrop-filter:blur(3px)',
      'font-family:Segoe UI,system-ui,-apple-system,Roboto,Arial,sans-serif',
      'color:#eaf1fb', 'padding:24px',
    ].join(';'));
    const card = document.createElement('div');
    card.setAttribute('style', [
      'max-width:460px', 'width:100%', 'background:#0f1b2e',
      'border:1px solid #294066', 'border-radius:14px',
      'padding:26px 24px', 'box-shadow:0 10px 30px rgba(0,0,0,.45)',
      'text-align:center',
    ].join(';'));
    const h = document.createElement('h2');
    h.textContent = 'Something went wrong';
    h.setAttribute('style', 'margin:0 0 10px;font-size:19px');
    const p = document.createElement('p');
    p.textContent = 'The view failed to load. You can reload the page, or reset '
      + 'this app\u2019s saved data (unsaved lineup drafts and view settings) '
      + 'and reload \u2014 no need to clear your browser cache.';
    p.setAttribute('style', 'margin:0 0 18px;color:#a8bbd6;font-size:14px;line-height:1.5');
    const row = document.createElement('div');
    row.setAttribute('style', 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap');
    const mkBtn = (label, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('style', [
        'padding:9px 16px', 'border-radius:9px', 'font-size:13.5px', 'cursor:pointer',
        'border:1px solid ' + (primary ? '#2f7bff' : '#294066'),
        'background:' + (primary ? '#2f7bff' : '#111c30'),
        'color:#eaf1fb',
      ].join(';'));
      return b;
    };
    const reload = mkBtn('Reload', false);
    reload.onclick = () => location.reload();
    const reset = mkBtn('Reset app data & reload', true);
    reset.onclick = () => { resetLocalData(); location.reload(); };
    row.appendChild(reload); row.appendChild(reset);
    card.appendChild(h); card.appendChild(p); card.appendChild(row);
    if (detail) {
      const d = document.createElement('pre');
      d.textContent = String(detail).slice(0, 300);
      d.setAttribute('style', 'margin:16px 0 0;padding:10px;background:#070d18;'
        + 'border:1px solid #1e3050;border-radius:9px;color:#6f86a8;font-size:11px;'
        + 'text-align:left;overflow:auto;max-height:120px;white-space:pre-wrap');
      card.appendChild(d);
    }
    ov.appendChild(card);
    (document.body || document.documentElement).appendChild(ov);
  }

  // Remove only THIS app's localStorage keys (sidebar state, lineup drafts,
  // preferences). Leaves unrelated site data alone.
  function resetLocalData() {
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k === 'ds_sidebar_hidden' || k.indexOf('ds_lineup_draft_') === 0
            || k.indexOf('diamond.') === 0) kill.push(k);
      }
      kill.forEach((k) => localStorage.removeItem(k));
    } catch (_e) { /* ignore */ }
  }

  function installErrorBoundary() {
    window.addEventListener('error', (ev) => {
      showRecovery(ev && ev.message ? ev.message : (ev && ev.error));
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const r = ev && ev.reason;
      showRecovery(r && r.message ? r.message : r);
    });
  }

  function init() {
    installErrorBoundary();
    document.querySelectorAll('.nav-item').forEach((n) => n.onclick = () => show(n.dataset.view));
    // Feature 11: hide / show the sidebar.
    const app = document.getElementById('app');
    const tog = document.getElementById('sidebar-toggle');
    // Fresh UI on every page refresh: never RESTORE a persisted hidden-sidebar
    // state. Carrying that state across a reload is what could leave the user
    // staring at a collapsed / blank-looking screen. Start every page load
    // with the sidebar visible and the stored flag cleared, so a simple browser
    // refresh always gives a clean, fully-rendered UI.
    try { localStorage.removeItem('ds_sidebar_hidden'); } catch (_e) {}
    if (app) app.classList.remove('sidebar-hidden');
    if (tog && app) tog.onclick = () => { app.classList.toggle('sidebar-hidden'); };
    // "Hide Sidebar" button at the bottom of the sidebar. Hiding reveals the
    // top-bar ☰ toggle, which brings the sidebar back. Not persisted — a
    // refresh restores the sidebar.
    const hideBtn = document.getElementById('sidebar-hide');
    if (hideBtn && app) hideBtn.onclick = () => { app.classList.add('sidebar-hidden'); };
    show('utilities'); // start on the first working module
  }

  document.addEventListener('DOMContentLoaded', init);
  return { show, refreshActions, showRecovery, resetLocalData };
})();
