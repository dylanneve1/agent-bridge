// ── Hub Namespace ────────────────────────────────
window.Hub = {};

// ── API ──────────────────────────────────────────
(function() {
  var loc = window.location;
  Hub.API = loc.pathname.includes('/hub') ? '/hub/api' : (loc.port === '8089' ? '/api' : '/bridge');

  Hub.api = async function(path) {
    try {
      var r = await fetch(Hub.API + path);
      if (!r.ok) return null;
      return await r.json();
    } catch(e) { return null; }
  };
})();

// ── Utility Helpers ──────────────────────────────
Hub.escHtml = function(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
Hub.truncate = function(s, n) { return s.length > n ? s.slice(0, n) + '\u2026' : s; };
Hub.formatSize = function(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
};
Hub.timeAgo = function(iso) {
  if (!iso) return '';
  // Handle both ISO strings and Unix timestamps (seconds)
  var ts = typeof iso === 'number' ? (iso > 1e12 ? iso : iso * 1000) : new Date(iso).getTime();
  var diff = (Date.now() - ts) / 1000;
  if (diff < 0) diff = 0;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
};
Hub.esc = function(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
Hub.escAttr = function(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); };
Hub.escSvg = function(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
Hub.escapeRegex = function(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

// ── Refresh Indicator ────────────────────────────
Hub.setRefreshState = function(pageId, state) {
  var bar = document.getElementById('refresh-' + pageId);
  if (!bar) return;
  var dot = bar.querySelector('.dot');
  var ts = bar.querySelector('.ts');
  if (state === 'loading') {
    dot.className = 'dot loading';
    ts.textContent = 'Updating\u2026';
  } else {
    dot.className = 'dot';
    var now = new Date();
    ts.textContent = 'Updated ' + now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  }
};

// ── Skeleton Generators ──────────────────────────
Hub.skeletonCards = function(n) {
  return Array(n).fill(0).map(function() {
    return '<div class="skeleton-card"><div class="skeleton skeleton-line w40 h32"></div><div class="skeleton skeleton-line w60"></div></div>';
  }).join('');
};
Hub.skeletonTable = function(rows) {
  return Array(rows).fill(0).map(function() {
    return '<tr><td><div class="skeleton skeleton-line w60" style="height:12px"></div></td><td><div class="skeleton skeleton-line w80" style="height:12px"></div></td></tr>';
  }).join('');
};
Hub.skeletonBoardCols = function(n) {
  return Array(n).fill(0).map(function() {
    return '<div class="skeleton-board-col"><div class="skeleton skeleton-line w60" style="margin-bottom:12px"></div>' +
      Array(3).fill(0).map(function() {
        return '<div class="skeleton-task"><div class="skeleton skeleton-line w80"></div><div class="skeleton skeleton-line w40"></div></div>';
      }).join('') + '</div>';
  }).join('');
};
Hub.skeletonMessages = function(n) {
  return Array(n).fill(0).map(function() {
    return '<div class="msg" style="border:none"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><div class="skeleton skeleton-line w40" style="height:12px;width:100px"></div><div class="skeleton skeleton-line" style="height:12px;width:60px"></div></div><div class="skeleton skeleton-line w100"></div><div class="skeleton skeleton-line w80"></div></div>';
  }).join('');
};

// ── Mobile Nav ───────────────────────────────────
Hub.toggleMobileNav = function() {
  document.getElementById('mobile-nav-overlay').classList.toggle('open');
};
Hub.closeMobileNav = function() {
  document.getElementById('mobile-nav-overlay').classList.remove('open');
};
// Expose globally for onclick handlers
window.toggleMobileNav = Hub.toggleMobileNav;
window.closeMobileNav = Hub.closeMobileNav;

// ── Tab Switching ────────────────────────────────
Hub.TAB_ORDER = ['dashboard', 'messages', 'board', 'projects', 'repos', 'arena', 'observatory', 'moltbook', 'alerts', 'seasons', 'report'];

Hub.PAGE_TITLES = {
  dashboard: 'Dashboard',
  messages: 'Messages',
  board: 'Board',
  projects: 'Projects',
  repos: 'Repos',
  arena: 'Arena',
  observatory: 'Observatory',
  moltbook: 'Moltbook',
  alerts: 'Alerts',
  seasons: 'Seasons',
  report: 'Report'
};

Hub.showPage = function(name) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.tab[data-page="' + name + '"]').forEach(function(t) { t.classList.add('active'); });
  // Dynamic page title
  document.title = (Hub.PAGE_TITLES[name] || name) + ' \u2014 Agent Hub';
  // Call module refresh
  if (Hub[name] && Hub[name].refresh) Hub[name].refresh();
};
window.showPage = Hub.showPage;

// ── Toast Notifications ─────────────────────────
Hub.showToast = function(msg) {
  var container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  toast.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--accent);color:var(--text);padding:10px 16px;border-radius:8px;font-size:13px;max-width:360px;opacity:0;transform:translateX(20px);transition:all .3s ease;pointer-events:auto;';
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(function() { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; });
  setTimeout(function() {
    toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)';
    setTimeout(function() { toast.remove(); }, 300);
  }, 4000);
};
window.showToast = Hub.showToast;

// ── Status Pill ──────────────────────────────────
Hub.updateStatusPill = function(connected) {
  var pill = document.getElementById('status-pill');
  if (connected) {
    pill.textContent = '\u25cf Live';
    pill.style.background = 'rgba(16, 185, 129, 0.15)';
    pill.style.color = '#10b981';
  } else {
    pill.textContent = '\u25cf Reconnecting\u2026';
    pill.style.background = 'rgba(245, 158, 11, 0.15)';
    pill.style.color = '#f59e0b';
  }
};

// ── Alert Badge Sync ─────────────────────────────
Hub.syncAlertBadges = function(count) {
  var badge = document.getElementById('alert-badge');
  var mobileBadge = document.getElementById('alert-badge-mobile');
  [badge, mobileBadge].forEach(function(b) {
    if (!b) return;
    if (count > 0) {
      b.textContent = count;
      b.style.display = 'inline';
    } else {
      b.style.display = 'none';
    }
  });
};
window.syncAlertBadges = Hub.syncAlertBadges;

// ── SSE + Auto-Refresh ──────────────────────────
Hub.sseState = { connected: false, lastEventAt: null };

(function() {
  var refreshTimer, sse = null, sseOk = false;

  function startAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(function() {
      if (sseOk) return;
      var active = document.querySelector('.page.active');
      var name = active ? active.id.replace('page-', '') : null;
      if (name) Hub.showPage(name);
    }, 60000);
  }

  function initSSE() {
    if (sse) sse.close();
    var evtUrl = Hub.API + '/events';
    sse = new EventSource(evtUrl);

    sse.addEventListener('connected', function() {
      sseOk = true;
      Hub.sseState.connected = true;
      Hub.sseState.lastEventAt = Date.now();
      Hub.updateStatusPill(true);
    });

    var TASK_EVENTS = ['task_created','task_updated','task_claimed','task_started','task_completed','task_blocked','task_comment','task_dependency_added','task_dependency_removed'];
    var PROJECT_EVENTS = ['project_created','project_member_added','milestone_created'];

    TASK_EVENTS.forEach(function(evt) {
      sse.addEventListener(evt, function(e) {
        var active = document.querySelector('.page.active');
        var name = active ? active.id.replace('page-', '') : null;
        if (name === 'board' && Hub.board) Hub.board.refresh();
        if (name === 'dashboard' && Hub.dashboard) Hub.dashboard.refresh();
        if (name === 'projects' && Hub.projects) Hub.projects.refresh();
        try {
          var data = JSON.parse(e.data);
          var action = evt.replace('task_', '').replace('_', ' ');
          var title = (data.task && data.task.title) || (data.task_id ? data.task_id.slice(0, 8) : '');
          var agent = data.agent || '?';
          Hub.showToast(agent + ' ' + action + ': ' + title);
        } catch(err) {}
      });
    });

    PROJECT_EVENTS.forEach(function(evt) {
      sse.addEventListener(evt, function(e) {
        var active = document.querySelector('.page.active');
        var name = active ? active.id.replace('page-', '') : null;
        if (name === 'projects' && Hub.projects) Hub.projects.refresh();
        if (name === 'dashboard' && Hub.dashboard) Hub.dashboard.refresh();
        try {
          var data = JSON.parse(e.data);
          var action = evt.replace('project_', '').replace('_', ' ');
          var pname = (data.project && data.project.name) || (data.project_id ? data.project_id.slice(0, 8) : '');
          Hub.showToast((data.agent || '?') + ' ' + action + ': ' + pname);
        } catch(err) {}
      });
    });

    sse.addEventListener('message', function(e) {
      Hub.sseState.lastEventAt = Date.now();
      var active = document.querySelector('.page.active');
      var name = active ? active.id.replace('page-', '') : null;
      if (name === 'messages' && Hub.messages) Hub.messages.refresh();
      if (name === 'dashboard' && Hub.dashboard) Hub.dashboard.refresh();
      if (name === 'observatory' && Hub.observatory) Hub.observatory.refresh();
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'arena_submission' && name === 'arena' && Hub.arena) Hub.arena.refresh();
      } catch(err) {}
    });

    sse.onerror = function() {
      sseOk = false;
      Hub.sseState.connected = false;
      Hub.updateStatusPill(false);
    };
  }

  Hub._startAutoRefresh = startAutoRefresh;
  Hub._initSSE = initSSE;
})();

// ── Keyboard Shortcuts ───────────────────────────
document.addEventListener('keydown', function(e) {
  // Ctrl+K — Command Palette
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (document.getElementById('cmd-palette')) {
      Hub.closeCommandPalette();
    } else {
      Hub.openCommandPalette();
    }
    return;
  }
  // Ctrl+F on report page
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    var reportPage = document.getElementById('page-report');
    if (reportPage && reportPage.classList.contains('active')) {
      e.preventDefault();
      var input = document.getElementById('report-search-input');
      if (input) { input.focus(); input.select(); }
      return;
    }
  }
  // Enter in report search
  if (e.key === 'Enter' && e.target.id === 'report-search-input') {
    e.preventDefault();
    if (Hub.report && Hub.report.searchNav) Hub.report.searchNav(e.shiftKey ? -1 : 1);
    return;
  }
  // Escape in report search
  if (e.key === 'Escape' && e.target.id === 'report-search-input') {
    if (Hub.report && Hub.report.clearSearch) Hub.report.clearSearch();
    e.target.blur();
    return;
  }
  // Don't fire when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key >= '0' && e.key <= '9') {
    e.preventDefault();
    var idx = e.key === '0' ? 9 : parseInt(e.key) - 1;
    if (idx < Hub.TAB_ORDER.length) Hub.showPage(Hub.TAB_ORDER[idx]);
    return;
  }
  if (e.key === '?') {
    e.preventDefault();
    Hub.showShortcutsHelp();
    return;
  }
  if (e.key === 'Escape') {
    Hub.closeCommandPalette();
    if (Hub.arena && Hub.arena.closeModal) Hub.arena.closeModal();
    Hub.closeMobileNav();
  }
  if (e.key === 'r') {
    e.preventDefault();
    var active = document.querySelector('.page.active');
    var name = active ? active.id.replace('page-', '') : null;
    if (name) Hub.showPage(name);
  }
});

Hub.showShortcutsHelp = function() {
  var existing = document.getElementById('shortcuts-modal');
  if (existing) { existing.remove(); return; }

  var overlay = document.createElement('div');
  overlay.id = 'shortcuts-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:300;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  var modal = document.createElement('div');
  modal.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:28px;max-width:400px;width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
  modal.innerHTML = '<div style="font-size:16px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px;">\u2328\ufe0f Keyboard Shortcuts</div>' +
    '<div style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px;">' +
    '<span class="kbd" style="justify-self:end">1</span><span>Dashboard</span>' +
    '<span class="kbd" style="justify-self:end">2</span><span>Messages</span>' +
    '<span class="kbd" style="justify-self:end">3</span><span>Board</span>' +
    '<span class="kbd" style="justify-self:end">4</span><span>Projects</span>' +
    '<span class="kbd" style="justify-self:end">5</span><span>Repos</span>' +
    '<span class="kbd" style="justify-self:end">6</span><span>Arena</span>' +
    '<span class="kbd" style="justify-self:end">7</span><span>Observatory</span>' +
    '<span class="kbd" style="justify-self:end">8</span><span>Moltbook</span>' +
    '<span class="kbd" style="justify-self:end">9</span><span>Alerts</span>' +
    '<span class="kbd" style="justify-self:end">0</span><span>Seasons</span>' +
    '<span class="kbd" style="justify-self:end">r</span><span>Refresh current tab</span>' +
    '<span class="kbd" style="justify-self:end">Ctrl+K</span><span>Command palette</span>' +
    '<span class="kbd" style="justify-self:end">Ctrl+F</span><span>Search report (on Report tab)</span>' +
    '<span class="kbd" style="justify-self:end">?</span><span>Toggle this help</span>' +
    '<span class="kbd" style="justify-self:end">Esc</span><span>Close modals</span>' +
    '</div>' +
    '<div style="margin-top:16px;font-size:11px;color:var(--text2);text-align:center;">Press Escape or click outside to close</div>';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  var handler = function(e) {
    if (e.key === 'Escape' || e.key === '?') { overlay.remove(); document.removeEventListener('keydown', handler); }
  };
  document.addEventListener('keydown', handler);
};

// ── Command Palette ──────────────────────────────
Hub.openCommandPalette = function() {
  if (document.getElementById('cmd-palette')) return;

  var PALETTE_ITEMS = [
    { group: 'Pages', label: '📊 Dashboard',     hint: '1', action: function() { Hub.showPage('dashboard'); } },
    { group: 'Pages', label: '💬 Messages',      hint: '2', action: function() { Hub.showPage('messages'); } },
    { group: 'Pages', label: '📋 Board',         hint: '3', action: function() { Hub.showPage('board'); } },
    { group: 'Pages', label: '🗂️ Projects',      hint: '4', action: function() { Hub.showPage('projects'); } },
    { group: 'Pages', label: '📁 Repos',         hint: '5', action: function() { Hub.showPage('repos'); } },
    { group: 'Pages', label: '🏟️ Arena',         hint: '6', action: function() { Hub.showPage('arena'); } },
    { group: 'Pages', label: '🔭 Observatory',   hint: '7', action: function() { Hub.showPage('observatory'); } },
    { group: 'Pages', label: '📈 Moltbook',      hint: '8', action: function() { Hub.showPage('moltbook'); } },
    { group: 'Pages', label: '🔔 Alerts',        hint: '9', action: function() { Hub.showPage('alerts'); } },
    { group: 'Pages', label: '🏟️ Seasons',       hint: '0', action: function() { Hub.showPage('seasons'); } },
    { group: 'Pages', label: '📄 Report',        hint: '',  action: function() { Hub.showPage('report'); } },
    { group: 'Actions', label: '🔄 Refresh current tab',      hint: 'r', action: function() { var a = document.querySelector('.page.active'); var n = a ? a.id.replace('page-','') : null; if (n) Hub.showPage(n); } },
    { group: 'Actions', label: '⌨️ Keyboard shortcuts',       hint: '?', action: function() { Hub.showShortcutsHelp(); } },
    { group: 'Actions', label: '📥 Export repo JSON',         hint: '',  action: function() { if (typeof exportRepoJSON === 'function') exportRepoJSON(); else { Hub.showPage('repos'); Hub.showToast('Navigate to Repos first'); } } },
    { group: 'Actions', label: '🔔 Go to active alerts',      hint: '',  action: function() { Hub.showPage('alerts'); } },
  ];

  function fuzzyScore(label, query) {
    if (!query) return 1;
    var s = label.toLowerCase(), q = query.toLowerCase(), score = 0, si = 0;
    for (var qi = 0; qi < q.length; qi++) {
      si = s.indexOf(q[qi], si);
      if (si === -1) return 0;
      score += 1 / (si + 1);
      si++;
    }
    return score;
  }

  var overlay = document.createElement('div');
  overlay.id = 'cmd-palette';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:14vh;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';

  var modal = document.createElement('div');
  modal.className = 'cmd-modal';
  modal.innerHTML =
    '<div class="cmd-search-wrap"><span class="cmd-search-icon">⌘</span><input id="cmd-input" class="cmd-input" placeholder="Search pages, actions\u2026" autocomplete="off" spellcheck="false"></div>' +
    '<div class="cmd-results" id="cmd-results"></div>' +
    '<div class="cmd-footer"><span>↑↓ navigate</span><span>↵ select</span><span>Esc close</span></div>';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  var input = modal.querySelector('#cmd-input');
  var resultsEl = modal.querySelector('#cmd-results');
  var activeIdx = 0;
  var filteredItems = [];

  function renderResults(query) {
    var scored = PALETTE_ITEMS.map(function(item) {
      return { item: item, score: fuzzyScore(item.label, query) };
    }).filter(function(x) { return x.score > 0; }).sort(function(a, b) { return b.score - a.score; });

    filteredItems = scored.map(function(x) { return x.item; });
    activeIdx = 0;

    if (filteredItems.length === 0) {
      resultsEl.innerHTML = '<div class="cmd-empty">No results for "' + Hub.esc(query) + '"</div>';
      return;
    }

    var html = '';
    var lastGroup = null;
    filteredItems.forEach(function(item, i) {
      if (!query && item.group !== lastGroup) {
        html += '<div class="cmd-section-header">' + Hub.esc(item.group) + '</div>';
        lastGroup = item.group;
      }
      html += '<div class="cmd-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' +
        '<span class="cmd-item-label">' + Hub.esc(item.label) + '</span>' +
        (item.hint ? '<span class="cmd-item-hint">' + Hub.esc(item.hint) + '</span>' : '') +
        '</div>';
    });
    resultsEl.innerHTML = html;

    resultsEl.querySelectorAll('.cmd-item').forEach(function(el, i) {
      el.addEventListener('mouseenter', function() {
        activeIdx = i;
        updateActive();
      });
      el.addEventListener('click', function() {
        filteredItems[i].action();
        Hub.closeCommandPalette();
      });
    });
  }

  function updateActive() {
    var items = resultsEl.querySelectorAll('.cmd-item');
    items.forEach(function(el, i) { el.classList.toggle('active', i === activeIdx); });
    if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', function() { renderResults(input.value.trim()); });

  input.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, filteredItems.length - 1);
      updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[activeIdx]) {
        filteredItems[activeIdx].action();
        Hub.closeCommandPalette();
      }
    } else if (e.key === 'Escape') {
      Hub.closeCommandPalette();
    }
  });

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) Hub.closeCommandPalette();
  });

  renderResults('');
  requestAnimationFrame(function() { input.focus(); });
};

Hub.closeCommandPalette = function() {
  var p = document.getElementById('cmd-palette');
  if (p) p.remove();
};
window.closeCommandPalette = Hub.closeCommandPalette;

// ── Favicon ───────────────────────────────────────
Hub._setFavicon = function() {
  var existing = document.querySelector('link[rel~="icon"]');
  if (existing) existing.remove();
  var link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  // SVG: crab/lobster silhouette in accent blue
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<circle cx="32" cy="32" r="30" fill="%235eaaff" opacity="0.15"/>' +
    '<text x="32" y="46" font-size="36" text-anchor="middle" font-family="serif">🦞</text>' +
    '</svg>';
  link.href = 'data:image/svg+xml,' + svg;
  document.head.appendChild(link);
};

// ── Init ─────────────────────────────────────────
Hub._init = function() {
  Hub._setFavicon();
  Hub.dashboard.refresh();
  Hub._startAutoRefresh();
  Hub._initSSE();
  // Alert badge on startup
  (async function() {
    var data = await Hub.api('/alerts');
    if (data && data.stats) Hub.syncAlertBadges(data.stats.active);
  })();
  // Alert badge polling every 5 min
  setInterval(async function() {
    var data = await Hub.api('/alerts');
    if (data && data.stats) Hub.syncAlertBadges(data.stats.active);
  }, 300000);
};
