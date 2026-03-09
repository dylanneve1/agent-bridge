// ── Observatory Module ───────────────────────────
Hub.observatory = (function() {
  var AGENT_EMOJI = { Claudius: '\ud83e\udd9e', Glados: '\ud83e\udd16', Dylan: '\ud83d\udc64' };
  var AGENT_COLOR = { Claudius: '#58a6ff', Glados: '#bc8cff', Dylan: '#f0883e' };

  function renderStats(tasks, stats, repos) {
    var done = tasks.filter(function(t) { return t.status === 'done'; }).length;
    var open = tasks.filter(function(t) { return ['open', 'claimed'].indexOf(t.status) !== -1; }).length;
    var totalCommits = repos.reduce(function(s, r) { return s + (r.commit_count || 0); }, 0);
    document.getElementById('obs-stats-grid').innerHTML =
      '<div class="obs-stat-card"><div class="obs-stat-val" style="color:var(--green)">' + done + '</div><div class="obs-stat-lbl">Tasks Done</div></div>' +
      '<div class="obs-stat-card"><div class="obs-stat-val" style="color:var(--accent)">' + (stats.total_messages || 0) + '</div><div class="obs-stat-lbl">Messages</div></div>' +
      '<div class="obs-stat-card"><div class="obs-stat-val" style="color:var(--purple)">' + ((stats.agents || []).length) + '</div><div class="obs-stat-lbl">Agents</div></div>' +
      '<div class="obs-stat-card"><div class="obs-stat-val" style="color:var(--orange)">' + open + '</div><div class="obs-stat-lbl">Open Tasks</div></div>' +
      '<div class="obs-stat-card"><div class="obs-stat-val" style="color:#f0883e">' + repos.length + '</div><div class="obs-stat-lbl">Repos</div></div>' +
      '<div class="obs-stat-card"><div class="obs-stat-val" style="color:var(--accent)">' + totalCommits + '</div><div class="obs-stat-lbl">Commits</div></div>';
  }

  function renderLeaderboard(tasks) {
    var scores = {};
    tasks.forEach(function(t) {
      if (t.status !== 'done') return;
      var agent = t.claimed_by || t.assigned_to;
      if (!agent) return;
      scores[agent] = (scores[agent] || 0) + 1;
    });
    var ranked = Object.entries(scores).sort(function(a, b) { return b[1] - a[1]; });
    var maxScore = ranked[0] ? ranked[0][1] : 1;
    var body = document.getElementById('obs-leaderboard-body');
    if (!ranked.length) { body.innerHTML = '<div class="loading">No completions yet.</div>'; return; }
    body.innerHTML = ranked.map(function(entry, i) {
      var agent = entry[0], score = entry[1];
      var emoji = AGENT_EMOJI[agent] || '\ud83e\udd16';
      var color = AGENT_COLOR[agent] || '#8b949e';
      var pct = Math.round((score / maxScore) * 100);
      var rankClass = i === 0 ? 'obs-rank-1' : i === 1 ? 'obs-rank-2' : i === 2 ? 'obs-rank-3' : '';
      var medal = i === 0 ? '\ud83e\udd47' : i === 1 ? '\ud83e\udd48' : i === 2 ? '\ud83e\udd49' : '';
      return '<div class="obs-agent-row"><div class="obs-agent-rank ' + rankClass + '">' + (medal || (i + 1)) + '</div>' +
        '<div class="obs-agent-avatar" style="background:' + color + '22">' + emoji + '</div>' +
        '<div class="obs-agent-info"><div class="obs-agent-name">' + agent + '</div><div class="obs-agent-sub">' + score + ' task' + (score !== 1 ? 's' : '') + ' completed</div>' +
        '<div class="obs-bar-container"><div class="obs-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div></div>' +
        '<div class="obs-agent-score" style="color:' + color + '">' + score + '</div></div>';
    }).join('');
  }

  function renderTasks(tasks) {
    var done = tasks.filter(function(t) { return t.status === 'done'; }).length;
    var badge = document.getElementById('obs-tasks-badge');
    if (badge) {
      badge.textContent = done + '/' + tasks.length + ' done';
      badge.className = 'badge ' + (done === tasks.length ? 'badge-green' : 'badge-orange');
    }
    var order = { done: 0, in_progress: 1, claimed: 2, open: 3 };
    var sorted = tasks.slice().sort(function(a, b) {
      var od = (order[a.status] !== undefined ? order[a.status] : 4) - (order[b.status] !== undefined ? order[b.status] : 4);
      if (od !== 0) return od;
      return (b.updated_at || 0) - (a.updated_at || 0);
    });
    var body = document.getElementById('obs-tasks-body');
    body.innerHTML = sorted.slice(0, 30).map(function(t) {
      var assignee = t.claimed_by || t.assigned_to;
      var dotClass = 'status-' + (t.status || 'open');
      var aClass = !assignee ? '' : assignee.toLowerCase() === 'claudius' ? 'badge-blue' : assignee.toLowerCase() === 'glados' ? 'badge-purple' : 'badge-green';
      var time = t.completed_at ? Hub.timeAgo(t.completed_at) : (t.updated_at ? Hub.timeAgo(t.updated_at) : '');
      return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<div style="width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0" class="' + dotClass + '"></div>' +
        '<div style="flex:1;min-width:0"><div style="font-size:13px">' + Hub.escHtml(t.title) + '</div><div style="font-size:11px;color:var(--text2);margin-top:2px">' + t.status + (time ? ' \u00b7 ' + time : '') + '</div></div>' +
        (assignee ? '<span class="badge ' + aClass + '" style="font-size:11px;flex-shrink:0">' + assignee + '</span>' : '') + '</div>';
    }).join('');
  }

  function renderActivity(messages) {
    var list = document.getElementById('obs-activity-list');
    var recent = messages.slice(0, 30);
    if (!recent.length) { list.innerHTML = '<div class="loading">No recent messages.</div>'; return; }
    list.innerHTML = recent.map(function(m) {
      var from = m.from_agent || m.sender || '?';
      var to = m.to_agent || m.recipient || '';
      var emoji = AGENT_EMOJI[from] || '\ud83e\udd16';
      var color = AGENT_COLOR[from] || '#8b949e';
      var preview = (m.content || '').slice(0, 100).replace(/\n/g, ' ');
      var ts = m.timestamp || m.created_at || 0;
      return '<div class="obs-activity-item"><div class="obs-activity-icon" style="background:' + color + '22">' + emoji + '</div>' +
        '<div class="obs-activity-text"><div class="obs-activity-main"><strong>' + from + '</strong> -> ' + (to ? '<strong>' + to + '</strong>' : 'group') + '</div>' +
        '<div style="font-size:12px;color:var(--text2);margin-top:2px">' + Hub.escHtml(Hub.truncate(preview, 100)) + '</div>' +
        '<div class="obs-activity-time">' + (ts ? Hub.timeAgo(ts) : '') + '</div></div></div>';
    }).join('');
  }

  function renderRepos(repos) {
    var body = document.getElementById('obs-repos-body');
    if (!repos.length) { body.innerHTML = '<div class="loading">No repos yet.</div>'; return; }
    body.innerHTML = repos.map(function(r) {
      return '<div class="obs-repo-row"><span style="font-size:16px">\ud83d\udcc1</span><span class="obs-repo-name">' + r.name + '</span>' +
        '<span class="obs-repo-commits"><span class="badge badge-blue">' + (r.commit_count || 0) + ' commits</span><div style="font-size:11px;color:var(--text2);margin-top:4px">' + (r.created_by || '') + '</div></span></div>';
    }).join('');
  }

  function renderCompletion(tasks) {
    var agents = {};
    tasks.forEach(function(t) {
      var agent = t.claimed_by || t.assigned_to;
      if (!agent) return;
      if (!agents[agent]) agents[agent] = { done: 0, total: 0 };
      agents[agent].total++;
      if (t.status === 'done') agents[agent].done++;
    });
    var sorted = Object.entries(agents).sort(function(a, b) { return b[1].done - a[1].done; });
    var body = document.getElementById('obs-completion-body');
    var totalDone = tasks.filter(function(t) { return t.status === 'done'; }).length;
    var overallPct = tasks.length ? Math.round((totalDone / tasks.length) * 100) : 0;

    var html = '<div class="obs-progress-row"><div class="obs-progress-label"><span>Overall Progress</span><span>' + totalDone + '/' + tasks.length + ' (' + overallPct + '%)</span></div>' +
      '<div class="obs-progress-bar"><div class="obs-progress-fill" style="width:' + overallPct + '%;background:var(--green)"></div></div></div>';

    sorted.forEach(function(entry) {
      var agent = entry[0], data = entry[1];
      var pct = Math.round((data.done / data.total) * 100);
      var color = AGENT_COLOR[agent] || 'var(--green)';
      var emoji = AGENT_EMOJI[agent] || '\ud83e\udd16';
      html += '<div class="obs-progress-row"><div class="obs-progress-label"><span>' + emoji + ' ' + agent + '</span><span>' + data.done + '/' + data.total + ' tasks \u00b7 ' + pct + '%</span></div>' +
        '<div class="obs-progress-bar"><div class="obs-progress-fill" style="width:' + pct + '%;background:' + color + '"></div></div></div>';
    });
    body.innerHTML = html;
  }

  return {
    refresh: async function() {
      Hub.setRefreshState('observatory', 'loading');
      document.getElementById('obs-stats-grid').innerHTML = Hub.skeletonCards(6);
      try {
        var results = await Promise.all([Hub.api('/tasks'), Hub.api('/stats'), Hub.api('/git/repos')]);
        var tasks = (results[0] && results[0].tasks) || [];
        var stats = results[1] || {};
        var repos = (results[2] && results[2].repos) || [];

        renderStats(tasks, stats, repos);
        renderLeaderboard(tasks);
        renderTasks(tasks);
        renderRepos(repos);
        renderCompletion(tasks);

        var convos = await Hub.api('/conversations');
        var msgs = [];
        if (convos) {
          var arr = Array.isArray(convos) ? convos : [];
          for (var i = 0; i < Math.min(arr.length, 3); i++) {
            try {
              var convMsgs = await Hub.api('/conversations/' + (arr[i].id || arr[i]) + '/messages');
              var msgArr = Array.isArray(convMsgs) ? convMsgs : ((convMsgs && convMsgs.messages) || []);
              msgs = msgs.concat(msgArr.slice(0, 10));
            } catch(e) {}
          }
        }
        msgs.sort(function(a, b) { return (b.timestamp || b.created_at || 0) - (a.timestamp || a.created_at || 0); });
        renderActivity(msgs);
      } catch(e) { console.error('observatory', e); }
      Hub.setRefreshState('observatory', 'done');
    }
  };
})();
