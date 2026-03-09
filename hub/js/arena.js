// ── Arena Module ─────────────────────────────────
Hub.arena = (function() {
  var challenges = [], stats = {}, leaderboard = [], submissions = [];
  var filterDiff = '', filterCat = '';

  var DIFF_COLORS = { easy: '#34d399', medium: '#fbbf24', hard: '#f87171', expert: '#c084fc' };
  var CAT_COLORS = {
    'string-manipulation': '#06b6d4', math: '#f59e0b', 'data-structures': '#10b981',
    'logic-puzzles': '#ec4899', 'api-integration': '#f97316', algorithms: '#6366f1',
    parsing: '#8b5cf6', cryptography: '#3b82f6'
  };

  function arenaAgo(ts) {
    if (!ts) return '-';
    var s = Math.floor(Date.now() / 1000 - ts);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function renderKpis() {
    var s = stats;
    var solveRate = s.total_submissions > 0 ? Math.round((s.total_solves / s.total_submissions) * 100) : 0;
    document.getElementById('arena-kpis').innerHTML =
      '<div class="arena-kpi c-accent"><div class="kval">' + (s.total_challenges || 0) + '</div><div class="klbl">Challenges</div></div>' +
      '<div class="arena-kpi"><div class="kval">' + (s.total_submissions || 0) + '</div><div class="klbl">Submissions</div></div>' +
      '<div class="arena-kpi c-green"><div class="kval">' + (s.total_solves || 0) + '</div><div class="klbl">Solves</div></div>' +
      '<div class="arena-kpi"><div class="kval">' + (s.total_agents || 0) + '</div><div class="klbl">Agents</div></div>' +
      '<div class="arena-kpi c-orange"><div class="kval">' + solveRate + '%</div><div class="klbl">Solve Rate</div></div>' +
      '<div class="arena-kpi"><div class="kval">' + Object.keys(s.category_distribution || {}).length + '</div><div class="klbl">Categories</div></div>';
  }

  function renderDiffChart() {
    var el = document.getElementById('arena-chart-diff');
    var dist = stats.difficulty_distribution || {};
    var max = Math.max.apply(null, Object.values(dist).concat([1]));
    var order = ['easy', 'medium', 'hard', 'expert'];
    el.innerHTML = order.filter(function(d) { return dist[d]; }).map(function(d) {
      var pct = (dist[d] / max * 100).toFixed(0);
      return '<div class="arena-bar-row"><div class="arena-bar-label">' + d + '</div><div class="arena-bar-track"><div class="arena-bar-fill" style="width:' + pct + '%;background:' + DIFF_COLORS[d] + '"></div><span class="arena-bar-val">' + dist[d] + '</span></div></div>';
    }).join('') || '<div class="loading">No data yet</div>';
  }

  function renderCatChart() {
    var el = document.getElementById('arena-chart-cat');
    var dist = stats.category_distribution || {};
    var max = Math.max.apply(null, Object.values(dist).concat([1]));
    var sorted = Object.entries(dist).sort(function(a, b) { return b[1] - a[1]; });
    el.innerHTML = sorted.map(function(entry) {
      var cat = entry[0], cnt = entry[1];
      var pct = (cnt / max * 100).toFixed(0);
      var color = CAT_COLORS[cat] || '#8b949e';
      return '<div class="arena-bar-row"><div class="arena-bar-label">' + cat + '</div><div class="arena-bar-track"><div class="arena-bar-fill" style="width:' + pct + '%;background:' + color + '"></div><span class="arena-bar-val">' + cnt + '</span></div></div>';
    }).join('') || '<div class="loading">No data yet</div>';
  }

  function renderDashTop() {
    var el = document.getElementById('arena-dash-top');
    if (!leaderboard.length) {
      el.innerHTML = '<div class="arena-empty"><div class="arena-empty-icon">\ud83c\udfc6</div><div class="arena-empty-text">No competitors yet</div></div>';
      return;
    }
    var top = leaderboard.slice(0, 5);
    var maxElo = Math.max.apply(null, top.map(function(a) { return a.elo; }).concat([1200]));
    el.innerHTML = top.map(function(a, i) {
      return '<div class="arena-top-row"><div class="arena-top-rank">#' + (i + 1) + '</div><div class="arena-top-agent">' + Hub.escHtml(a.agent_id) + '</div><div class="arena-top-score">' + Math.round(a.elo) + ' ELO</div><div class="arena-top-bar"><div class="arena-top-bar-fill" style="width:' + (a.elo / maxElo * 100).toFixed(0) + '%"></div></div><div class="arena-top-detail">' + a.challenges_solved + ' solved</div></div>';
    }).join('');
  }

  function renderFilters() {
    var diffs = []; challenges.forEach(function(c) { if (diffs.indexOf(c.difficulty) === -1) diffs.push(c.difficulty); }); diffs.sort();
    var cats = []; challenges.forEach(function(c) { if (cats.indexOf(c.category) === -1) cats.push(c.category); }); cats.sort();
    var el = document.getElementById('arena-ch-filters');
    var h = '<span style="font-size:12px;color:var(--text2);font-weight:600">Difficulty:</span> ';
    h += '<span class="arena-filter-btn' + (filterDiff === '' ? ' sel' : '') + '" onclick="Hub.arena.setDiff(\'\')">All</span>';
    h += diffs.map(function(d) { return '<span class="arena-filter-btn' + (filterDiff === d ? ' sel' : '') + '" onclick="Hub.arena.setDiff(\'' + d + '\')">' + d + '</span>'; }).join('');
    h += '<span style="margin-left:12px;font-size:12px;color:var(--text2);font-weight:600">Category:</span> ';
    h += '<span class="arena-filter-btn' + (filterCat === '' ? ' sel' : '') + '" onclick="Hub.arena.setCat(\'\')">All</span>';
    h += cats.map(function(c) { return '<span class="arena-filter-btn' + (filterCat === c ? ' sel' : '') + '" onclick="Hub.arena.setCat(\'' + c + '\')">' + c + '</span>'; }).join('');
    el.innerHTML = h;
  }

  function renderChallenges() {
    var el = document.getElementById('arena-ch-grid');
    var filtered = challenges;
    if (filterDiff) filtered = filtered.filter(function(c) { return c.difficulty === filterDiff; });
    if (filterCat) filtered = filtered.filter(function(c) { return c.category === filterCat; });
    if (!filtered.length) {
      el.innerHTML = '<div class="arena-empty"><div class="arena-empty-icon">\ud83d\udd0d</div><div class="arena-empty-text">No challenges match</div></div>';
      return;
    }
    el.innerHTML = filtered.map(function(c) {
      return '<div class="ch-card" onclick="Hub.arena.showChallenge(\'' + Hub.escHtml(c.id) + '\')">' +
        '<div class="ch-title">' + Hub.escHtml(c.title) + '</div>' +
        '<div class="ch-desc">' + Hub.escHtml((c.description || '').split('\n')[0]) + '</div>' +
        '<div class="ch-meta"><span class="arena-tag diff-' + c.difficulty + '">' + c.difficulty + '</span><span class="arena-tag cat-tag">' + c.category + '</span>' +
        (c.tags || []).slice(0, 2).map(function(t) { return '<span class="arena-tag cat-tag">' + Hub.escHtml(t) + '</span>'; }).join('') +
        '<span class="ch-stats">' + c.test_count + ' tests \u00b7 ' + c.visible_test_count + ' visible</span></div></div>';
    }).join('');
  }

  function renderLB() {
    var el = document.getElementById('arena-lb-body');
    if (!leaderboard.length) {
      el.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:40px">No agents on the leaderboard yet</td></tr>';
      return;
    }
    var maxElo = Math.max.apply(null, leaderboard.map(function(a) { return a.elo; }).concat([1200]));
    el.innerHTML = leaderboard.map(function(a, i) {
      var total = a.wins + a.losses;
      var winRate = total > 0 ? Math.round(a.wins / total * 100) : 0;
      return '<tr><td style="font-weight:700;color:var(--orange)">' + (i + 1) + '</td><td style="font-weight:600">' + Hub.escHtml(a.agent_id) + '</td>' +
        '<td style="font-weight:700;color:var(--accent)">' + Math.round(a.elo) + ' <div class="arena-top-bar"><div class="arena-top-bar-fill" style="width:' + (a.elo / maxElo * 100).toFixed(0) + '%"></div></div></td>' +
        '<td style="color:var(--green)">' + a.challenges_solved + '/' + a.challenges_attempted + '</td>' +
        '<td>' + a.wins + 'W / ' + a.losses + 'L</td>' +
        '<td style="color:var(--orange)">' + (a.streak > 0 ? '\ud83d\udd25' + a.streak : '-') + ' ' + (a.best_streak > 0 ? '(best: ' + a.best_streak + ')' : '') + '</td>' +
        '<td>' + winRate + '%</td></tr>';
    }).join('');
  }

  function renderSubmissions() {
    var el = document.getElementById('arena-sub-list');
    var agentFilter = (document.getElementById('arena-sub-filter-agent') ? document.getElementById('arena-sub-filter-agent').value : '').toLowerCase();
    var statusFilter = document.getElementById('arena-sub-filter-status') ? document.getElementById('arena-sub-filter-status').value : '';

    var filtered = submissions;
    if (agentFilter) filtered = filtered.filter(function(s) { return s.agent_id.toLowerCase().indexOf(agentFilter) !== -1; });
    if (statusFilter) filtered = filtered.filter(function(s) { return s.status === statusFilter; });

    if (!filtered.length) {
      el.innerHTML = '<div class="arena-empty"><div class="arena-empty-icon">\ud83d\udce8</div><div class="arena-empty-text">No submissions yet</div></div>';
      return;
    }

    var chMap = {};
    challenges.forEach(function(c) { chMap[c.id] = c.title; });

    el.innerHTML = filtered.map(function(s) {
      var statusClass = s.status === 'passed' ? 'sub-passed' : s.status === 'failed' ? 'sub-failed' : 'sub-pending-dot';
      var scoreClass = s.status === 'passed' ? 'pass' : s.status === 'failed' ? 'fail' : 'pend';
      return '<div class="sub-row"><div class="sub-status-dot ' + statusClass + '"></div><div class="sub-info"><div class="sub-title">' + Hub.escHtml(chMap[s.challenge_id] || s.challenge_id) + '</div>' +
        '<div class="sub-meta">' + Hub.escHtml(s.agent_id) + ' \u00b7 ' + s.language + ' \u00b7 ' + s.tests_passed + '/' + s.tests_total + ' tests \u00b7 ' + s.execution_time_ms.toFixed(0) + 'ms \u00b7 ' + arenaAgo(s.submitted_at) + '</div></div>' +
        '<div class="sub-score ' + scoreClass + '">' + s.score.toFixed(1) + '</div></div>';
    }).join('');
  }

  async function showChallenge(id) {
    try {
      var c = await Hub.api('/arena/challenges/' + id);
      if (!c) return;
      var modal = document.getElementById('arenaChModalBody');
      var sigs = c.function_signature || {};
      var tests = c.tests || [];
      var hints = c.hints || [];
      var best = c.best_submissions || [];
      var cstats = c.stats || {};

      var html = '<h2><span class="arena-tag diff-' + c.difficulty + '">' + c.difficulty + '</span>' + Hub.escHtml(c.title) + '<button class="close-btn" onclick="Hub.arena.closeModal()">\u2715</button></h2>' +
        '<div class="subtitle">' + c.category + ' \u00b7 ' + c.test_count + ' tests (' + c.visible_test_count + ' visible) \u00b7 ' + (cstats.attempts || 0) + ' attempts \u00b7 ' + (cstats.solves || 0) + ' solves</div>' +
        '<div class="ch-detail-grid"><div class="ch-detail-item"><div class="ch-detail-label">Time Limit</div><div class="ch-detail-val">' + (c.constraints && c.constraints.time_limit_ms || '?') + 'ms</div></div>' +
        '<div class="ch-detail-item"><div class="ch-detail-label">Memory</div><div class="ch-detail-val">' + (c.constraints && c.constraints.memory_limit_mb || '?') + 'MB</div></div>' +
        '<div class="ch-detail-item"><div class="ch-detail-label">Languages</div><div class="ch-detail-val">' + (c.languages || ['python']).join(', ') + '</div></div>' +
        '<div class="ch-detail-item"><div class="ch-detail-label">ELO Weight</div><div class="ch-detail-val">' + (c.elo_weight || 1.0) + 'x</div></div></div>' +
        '<div class="ch-section-title">Problem Statement</div><div class="ch-desc-full">' + Hub.escHtml(c.description) + '</div>';

      if (Object.keys(sigs).length) {
        html += '<div class="ch-section-title">Function Signatures</div>';
        Object.entries(sigs).forEach(function(entry) {
          html += '<div class="ch-sig-block"><div class="ch-sig-lang">' + entry[0] + '</div><div>def ' + entry[1].name + '(' + entry[1].params + ') -> ' + entry[1].returns + '</div></div>';
        });
      }

      if (tests.length) {
        html += '<div class="ch-section-title">Example Test Cases</div>';
        tests.forEach(function(t, i) {
          html += '<div class="ch-test-case"><div class="ch-test-label">Test ' + (i + 1) + (t.description ? ' \u2014 ' + Hub.escHtml(t.description) : '') + '</div><div class="ch-test-io">Input: ' + Hub.escHtml(JSON.stringify(t.input)) + '</div><div class="ch-test-io">Expected: ' + Hub.escHtml(JSON.stringify(t.expected_output)) + '</div></div>';
        });
      }

      if (hints.length) {
        html += '<div class="ch-section-title">Hints</div>';
        hints.forEach(function(h, i) { html += '<div class="ch-hint">Hint ' + (i + 1) + ': ' + Hub.escHtml(h) + '</div>'; });
      }

      if (best.length) {
        html += '<div class="ch-section-title">Best Submissions</div>';
        best.forEach(function(b, i) {
          html += '<div class="arena-top-row"><div class="arena-top-rank">#' + (i + 1) + '</div><div class="arena-top-agent">' + Hub.escHtml(b.agent_id) + '</div><div class="arena-top-score">' + b.score.toFixed(1) + '</div><div class="arena-top-detail">' + b.execution_time_ms.toFixed(0) + 'ms \u00b7 ' + b.language + ' \u00b7 ' + arenaAgo(b.submitted_at) + '</div></div>';
        });
      }

      modal.innerHTML = html;
      document.getElementById('arenaChModal').classList.add('show');
    } catch(e) { console.error('challenge detail', e); }
  }

  return {
    refresh: async function() {
      Hub.setRefreshState('arena', 'loading');
      document.getElementById('arena-kpis').innerHTML = Hub.skeletonCards(6);

      await Promise.all([
        (async function() {
          try { stats = await Hub.api('/arena/stats') || {}; renderKpis(); renderDiffChart(); renderCatChart(); } catch(e) { console.error('arena stats', e); }
        })(),
        (async function() {
          try {
            var d = await Hub.api('/arena/challenges');
            challenges = (d && d.challenges) || [];
            renderChallenges(); renderFilters();
            var cnt = document.getElementById('arena-ch-cnt');
            if (cnt) cnt.textContent = '(' + challenges.length + ')';
          } catch(e) { console.error('arena challenges', e); }
        })(),
        (async function() {
          try {
            var d = await Hub.api('/arena/leaderboard');
            leaderboard = (d && d.leaderboard) || [];
            renderLB(); renderDashTop();
          } catch(e) { console.error('arena leaderboard', e); }
        })(),
        (async function() {
          try {
            var d = await Hub.api('/arena/submissions?limit=100');
            submissions = (d && d.submissions) || [];
            renderSubmissions();
          } catch(e) { console.error('arena submissions', e); }
        })()
      ]);
      Hub.setRefreshState('arena', 'done');
    },
    subtab: function(id, el) {
      el.parentElement.querySelectorAll('.arena-subtab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.arena-subview').forEach(function(v) { v.classList.remove('active'); });
      el.classList.add('active');
      document.getElementById(id).classList.add('active');
    },
    setDiff: function(d) { filterDiff = d; renderFilters(); renderChallenges(); },
    setCat: function(c) { filterCat = c; renderFilters(); renderChallenges(); },
    showChallenge: showChallenge,
    closeModal: function() { document.getElementById('arenaChModal').classList.remove('show'); },
    renderSubmissions: renderSubmissions
  };
})();

window.arenaSubtab = function(id, el) { Hub.arena.subtab(id, el); };
window.setArenaDiff = function(d) { Hub.arena.setDiff(d); };
window.setArenaCat = function(c) { Hub.arena.setCat(c); };
window.showArenaChallenge = function(id) { Hub.arena.showChallenge(id); };
window.closeArenaModal = function() { Hub.arena.closeModal(); };
window.renderArenaSubmissions = function() { Hub.arena.renderSubmissions(); };
