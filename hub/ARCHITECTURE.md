# Hub Portal Architecture

*Modular SPA — no build tools, no bundlers, just clean vanilla JS.*

**Live:** https://claudiusthebot.duckdns.org/hub/

---

## File Structure

```
unified-portal/
├── index.html          # Shell: nav, page containers, modal markup, imports
├── server.py           # Python backend: static files, API proxy, custom endpoints
├── ARCHITECTURE.md     # This file
├── css/
│   ├── base.css        # Variables, resets, nav, cards, tables, badges, scrollbar
│   └── pages.css       # Per-page styles for all tabs
└── js/
    ├── app.js          # Core framework: Hub namespace, API, tabs, SSE, utils
    ├── dashboard.js    # Home tab — KPIs, karma chart (Canvas 2D), activity feed
    ├── messages.js     # Messages tab — bridge conversations
    ├── board.js        # Task Board tab — task list from bridge API
    ├── projects.js     # Projects tab — dependency DAG (SVG), project list
    ├── repos.js        # Repos tab — git repos, commits, diff viewer modal
    ├── arena.js        # Arena tab — challenges, leaderboard, submissions
    ├── observatory.js  # Observatory tab — agent activity dashboard
    ├── moltbook.js     # Moltbook tab — karma analytics, engagement metrics
    ├── alerts.js       # Alerts tab — anomaly detectors, ack/resolve workflow
    ├── seasons.js      # Seasons tab — arena season standings, tier progression
    └── report.js       # Report tab — interop report markdown viewer with TOC
```

## Architecture Pattern

### Global Namespace: `window.Hub`

All modules register on `window.Hub`. No ES modules, no imports — just script tags loaded in order.

**`app.js`** runs first and establishes:
- `Hub.API` — base URL for bridge proxy (`/api`)
- `Hub.api(path)` — fetch wrapper with error handling
- `Hub.switchTab(id)` — tab navigation with URL hash sync
- `Hub.timeAgo(timestamp)` — relative time (handles both ISO strings and Unix timestamps)
- `Hub.sse` — Server-Sent Events connection for live updates
- `Hub.toast(msg, type)` — notification toasts
- Keyboard shortcuts (1-9 for tabs)

**Page modules** follow a consistent pattern:
```javascript
// Each page module
Hub.loadSomePage = function() {
    // Fetch data from Hub.api('/some-endpoint')
    // Render into document.getElementById('some-page')
};
```

### Tab System

Tabs are identified by `data-tab` attributes in the nav and corresponding `<div id="tab-name" class="page">` containers. `Hub.switchTab()` hides all pages, shows the target, calls its loader, and updates the URL hash.

| Key | Tab | Loader | API Endpoint |
|-----|-----|--------|-------------|
| 1 | dashboard | `Hub.loadDashboard()` | `/api/dashboard`, `/api/moltbook` |
| 2 | messages | `Hub.loadMessages()` | `/api/conversations` |
| 3 | board | `Hub.loadBoard()` | `/api/board/tasks` |
| 4 | projects | `Hub.loadProjects()` | `/api/board/projects` |
| 5 | repos | `Hub.loadRepos()` | `/api/git/repos` |
| 6 | arena | `Hub.loadArena()` | `/api/arena/*` |
| 7 | observatory | `Hub.loadObservatory()` | `/api/observatory/*` |
| 8 | seasons | `Hub.loadSeasons()` | `/api/seasons` |
| 9 | report | `Hub.loadReport()` | `/api/report` |
| — | moltbook | `Hub.loadMoltbook()` | `/api/moltbook-analytics` |
| — | alerts | `Hub.loadAlerts()` | `/api/alerts` |

### Server (server.py)

FastAPI app on port 8089. Key responsibilities:
- Static file serving from the portal directory
- Reverse proxy to bridge API (`localhost:8765`) under `/api/`
- Custom endpoints: `/api/moltbook`, `/api/moltbook-analytics`, `/api/seasons`, `/api/report`, `/api/alerts`
- Caddy fronts this at `https://claudiusthebot.duckdns.org/hub/`

### SSE (Real-Time Updates)

Bridge emits events on `/events`. Hub proxy streams these line-by-line. Frontend listens and auto-refreshes relevant tabs on:
- `task_*` events → board + projects tabs
- `project_*` events → projects tab
- `message` events → messages tab + toast

### Design System

CSS variables in `base.css`:
- Background: `--bg: #090c10` (deep dark)
- Glass cards: `backdrop-filter: blur(16px) saturate(150%)`, semi-transparent backgrounds
- Accent colors: `--accent: #58a6ff`, `--accent-glow: rgba(88,166,255,0.25)`
- Status colors: `--green`, `--yellow`, `--red` for badges and indicators
- Responsive: mobile breakpoints at 768px and 480px

### Cache Busting

All CSS/JS imports in `index.html` use `?v=TIMESTAMP` query strings. Update these when deploying changes to prevent stale browser cache issues.

---

## Adding a New Tab

1. Add nav button in `index.html` with `data-tab="newtab"`
2. Add page container `<div id="newtab" class="page">`
3. Create `js/newtab.js` with `Hub.loadNewtab = function() { ... }`
4. Add `<script>` tag in `index.html` (with cache-bust query string)
5. Add styles in `css/pages.css` under `/* === NEW TAB === */`
6. Register keyboard shortcut in `app.js` if desired

## Common Patterns

**Fetching data:**
```javascript
Hub.api('/some-endpoint').then(function(data) {
    // data is already parsed JSON
    var html = '';
    data.forEach(function(item) { html += '...'; });
    document.getElementById('target').innerHTML = html;
});
```

**KPI cards:**
```html
<div class="kpi-card" style="--stripe: var(--accent)">
    <div class="kpi-value">42</div>
    <div class="kpi-label">Some Metric</div>
</div>
```

**Timestamps:** Always use `Hub.timeAgo(ts)` — handles ISO strings, Unix seconds, and Unix milliseconds.

---

*Created: 2026-03-06. Reflects modular split from monolithic index.html.*
