// ── Projects Module ──────────────────────────────
Hub.projects = (function() {
  var projectView = 'list';

  // Known dependency relationships
  var KNOWN_DEPS = [
    ['real-time message updates', 'unified portal'],
    ['comment karma attribution', 'solver accuracy'],
    ['engagement feedback loop', 'comment karma attribution'],
    ['arena web ui', 'sandboxed code execution'],
    ['weekly auto-generated challenge', 'arena web ui'],
    ['alert system integration', 'observatory web dashboard'],
    ['moltbook analytics panel', 'observatory web dashboard'],
    ['merge conflict detection', 'directory & path resolution'],
    ['merge conflict detection', 'permission model'],
    ['bridge health monitor', 'create systemd service'],
  ];

  var STATUS_COLORS = {
    done: '#3fb950',
    claimed: '#d29922',
    in_progress: '#bc8cff',
    open: '#58a6ff',
    blocked: '#f85149'
  };

  function taskRow(t, done) {
    var icon = done ? '\u2705' : (t.status === 'claimed' ? '\ud83d\udd27' : '\u25cb');
    var priorityBadge = t.priority === 'urgent' ? '<span class="badge badge-red">urgent</span>' :
                        t.priority === 'high' ? '<span class="badge badge-orange">high</span>' : '';
    var assignee = t.claimed_by || t.assigned_to;
    return '<div style="padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px; display: flex; align-items: center; gap: 8px;">' +
      '<span>' + icon + '</span>' +
      '<span style="flex:1;' + (done ? 'color:var(--text2);text-decoration:line-through;' : '') + '">' + Hub.escHtml(t.title) + '</span>' +
      priorityBadge +
      (assignee ? '<span class="badge ' + (assignee === 'Claudius' ? 'badge-purple' : 'badge-green') + '">' + assignee + '</span>' : '') +
      (t.effort_estimate ? '<span style="font-size:11px;color:var(--text2)">\u23f1' + t.effort_estimate + '</span>' : '') +
      '</div>';
  }

  function findDeps(tasks) {
    var edges = [];
    for (var i = 0; i < KNOWN_DEPS.length; i++) {
      var depTitle = KNOWN_DEPS[i][0], reqTitle = KNOWN_DEPS[i][1];
      var dep = tasks.find(function(t) { return t.title.toLowerCase().indexOf(depTitle) !== -1; });
      var req = tasks.find(function(t) { return t.title.toLowerCase().indexOf(reqTitle) !== -1; });
      if (dep && req && dep.id !== req.id) edges.push({ from: req.id, to: dep.id });
    }
    for (var j = 0; j < tasks.length; j++) {
      if (tasks[j].parent_id) {
        var parent = tasks.find(function(p) { return p.id === tasks[j].parent_id; });
        if (parent) edges.push({ from: parent.id, to: tasks[j].id });
      }
    }
    var seen = {};
    return edges.filter(function(e) {
      var k = e.from + '->' + e.to;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function assignRanks(tasks, edges) {
    var inDeg = {}, adj = {};
    tasks.forEach(function(t) { inDeg[t.id] = 0; adj[t.id] = []; });
    edges.forEach(function(e) {
      if (inDeg[e.to] !== undefined) inDeg[e.to]++;
      if (adj[e.from]) adj[e.from].push(e.to);
    });
    var rank = {};
    var queue = tasks.filter(function(t) { return inDeg[t.id] === 0; }).map(function(t) { return t.id; });
    queue.forEach(function(id) { rank[id] = 0; });
    var i = 0;
    while (i < queue.length) {
      var cur = queue[i++];
      (adj[cur] || []).forEach(function(next) {
        rank[next] = Math.max(rank[next] || 0, rank[cur] + 1);
        inDeg[next]--;
        if (inDeg[next] === 0) queue.push(next);
      });
    }
    tasks.forEach(function(t) { if (rank[t.id] === undefined) rank[t.id] = 0; });
    return rank;
  }

  function renderDAG(container, tasks, edges, projectName) {
    if (!tasks.length) return;
    var ranks = assignRanks(tasks, edges);
    var maxRank = Math.max.apply(null, Object.values(ranks).concat([0]));
    var rankGroups = {};
    for (var r = 0; r <= maxRank; r++) rankGroups[r] = [];
    tasks.forEach(function(t) { rankGroups[ranks[t.id]].push(t); });

    var nodeW = 220, nodeH = 52, padX = 60, padY = 24;
    var maxPerRank = Math.max.apply(null, Object.values(rankGroups).map(function(g) { return g.length; }).concat([1]));
    var svgW = (maxRank + 1) * (nodeW + padX) + padX;
    var svgH = maxPerRank * (nodeH + padY) + padY + 40;

    var pos = {};
    for (var r2 = 0; r2 <= maxRank; r2++) {
      var group = rankGroups[r2];
      var totalH = group.length * nodeH + (group.length - 1) * padY;
      var startY = (svgH - totalH) / 2;
      group.forEach(function(t, i) {
        pos[t.id] = { x: padX + r2 * (nodeW + padX), y: startY + i * (nodeH + padY) };
      });
    }

    var svg = '<svg class="graph-svg" width="' + svgW + '" height="' + svgH + '" xmlns="http://www.w3.org/2000/svg">';
    svg += '<defs><marker id="arrowhead-' + projectName + '" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#30363d"/></marker>';
    svg += '<marker id="arrowhead-done-' + projectName + '" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#3fb950" opacity="0.4"/></marker></defs>';

    edges.forEach(function(e) {
      var fromTask = tasks.find(function(t) { return t.id === e.from; });
      var toTask = tasks.find(function(t) { return t.id === e.to; });
      if (!pos[e.from] || !pos[e.to]) return;
      var x1 = pos[e.from].x + nodeW, y1 = pos[e.from].y + nodeH / 2;
      var x2 = pos[e.to].x, y2 = pos[e.to].y + nodeH / 2;
      var isDone = fromTask && toTask && fromTask.status === 'done' && toTask.status === 'done';
      var midX = (x1 + x2) / 2;
      svg += '<path class="graph-edge' + (isDone ? ' done' : '') + '" d="M' + x1 + ',' + y1 + ' C' + midX + ',' + y1 + ' ' + midX + ',' + y2 + ' ' + x2 + ',' + y2 + '" marker-end="url(#arrowhead' + (isDone ? '-done' : '') + '-' + projectName + ')"/>';
    });

    tasks.forEach(function(t) {
      var p = pos[t.id];
      if (!p) return;
      var col = STATUS_COLORS[t.status] || STATUS_COLORS.open;
      var titleShort = t.title.length > 28 ? t.title.slice(0, 26) + '\u2026' : t.title;
      var assignee = t.claimed_by || t.assigned_to || '';
      svg += '<g class="graph-node" data-task-id="' + t.id + '" onmouseenter="Hub.projects.showTooltip(event, \'' + Hub.escAttr(t.title) + '\', \'' + t.status + '\', \'' + assignee + '\', \'' + (t.priority || '') + '\')" onmouseleave="Hub.projects.hideTooltip()">';
      svg += '<rect x="' + p.x + '" y="' + p.y + '" width="' + nodeW + '" height="' + nodeH + '" fill="#161b22" stroke="' + col + '"/>';
      svg += '<rect x="' + p.x + '" y="' + p.y + '" width="4" height="' + nodeH + '" fill="' + col + '" rx="0" ry="0"/>';
      svg += '<text x="' + (p.x + 14) + '" y="' + (p.y + 22) + '" font-size="12" font-weight="500" fill="#c9d1d9">' + Hub.escSvg(titleShort) + '</text>';
      if (assignee) {
        svg += '<text x="' + (p.x + 14) + '" y="' + (p.y + 40) + '" font-size="10" fill="#8b949e">' + Hub.escSvg(assignee) + '</text>';
      }
      if (t.status === 'done') {
        svg += '<text x="' + (p.x + nodeW - 24) + '" y="' + (p.y + 22) + '" font-size="14">\u2705</text>';
      }
      svg += '</g>';
    });

    svg += '</svg>';
    container.innerHTML += svg;
  }

  async function loadProjectGraph() {
    var results = await Promise.all([Hub.api('/projects'), Hub.api('/tasks?limit=200')]);
    var projects = results[0], allTasks = results[1];
    var graphRoot = document.getElementById('projects-graph');
    var tooltip = document.getElementById('graph-tooltip');
    graphRoot.innerHTML = '';
    graphRoot.appendChild(tooltip);

    if (!projects || !projects.projects || !allTasks || !allTasks.tasks) {
      graphRoot.innerHTML += '<div class="loading">Loading...</div>';
      return;
    }

    var tasks = allTasks.tasks;
    var allEdges = findDeps(tasks);

    projects.projects.forEach(function(proj) {
      var projTasks = tasks.filter(function(t) { return t.project_id === proj.id; });
      if (!projTasks.length) return;
      var projEdges = allEdges.filter(function(e) {
        return projTasks.some(function(t) { return t.id === e.from; }) && projTasks.some(function(t) { return t.id === e.to; });
      });
      var done = projTasks.filter(function(t) { return t.status === 'done'; }).length;
      var pct = projTasks.length ? Math.round((done / projTasks.length) * 100) : 0;

      var section = document.createElement('div');
      section.className = 'project-graph-section';
      section.innerHTML = '<div class="project-graph-header"><span>' + Hub.escHtml(proj.name) + '</span><span class="pct">' + done + '/' + projTasks.length + ' tasks \u00b7 ' + pct + '%</span></div>' +
        '<div style="background: var(--bg3); border-radius: 4px; height: 4px; overflow: hidden; margin-bottom: 12px; max-width: 300px;"><div style="background: var(--green); height: 100%; width: ' + pct + '%;"></div></div>' +
        '<div class="graph-container"></div>';
      graphRoot.appendChild(section);
      renderDAG(section.querySelector('.graph-container'), projTasks, projEdges, proj.id.slice(0, 8));
    });

    var orphans = tasks.filter(function(t) { return !t.project_id; });
    if (orphans.length) {
      var orphanEdges = allEdges.filter(function(e) {
        return orphans.some(function(t) { return t.id === e.from; }) && orphans.some(function(t) { return t.id === e.to; });
      });
      var section2 = document.createElement('div');
      section2.className = 'project-graph-section';
      section2.innerHTML = '<div class="project-graph-header"><span style="color: var(--orange);">\u26a0\ufe0f Unassigned Tasks</span><span class="pct">' + orphans.length + ' tasks</span></div><div class="graph-container"></div>';
      graphRoot.appendChild(section2);
      renderDAG(section2.querySelector('.graph-container'), orphans, orphanEdges, 'orphan');
    }

    var legend = document.createElement('div');
    legend.className = 'graph-legend';
    legend.innerHTML =
      '<div class="graph-legend-item"><div class="graph-legend-dot" style="background:' + STATUS_COLORS.done + '"></div> Done</div>' +
      '<div class="graph-legend-item"><div class="graph-legend-dot" style="background:' + STATUS_COLORS.in_progress + '"></div> In Progress</div>' +
      '<div class="graph-legend-item"><div class="graph-legend-dot" style="background:' + STATUS_COLORS.claimed + '"></div> Claimed</div>' +
      '<div class="graph-legend-item"><div class="graph-legend-dot" style="background:' + STATUS_COLORS.open + '"></div> Open</div>' +
      '<div class="graph-legend-item"><div class="graph-legend-dot" style="background:' + STATUS_COLORS.blocked + '"></div> Blocked</div>' +
      '<div class="graph-legend-item" style="margin-left: 16px;">\u2192 Dependency (A \u2192 B means B requires A)</div>';
    graphRoot.appendChild(legend);
  }

  return {
    refresh: async function() {
      Hub.setRefreshState('projects', 'loading');
      var container = document.getElementById('projects-list');
      container.innerHTML = Hub.skeletonCards(3);

      var results = await Promise.all([Hub.api('/projects'), Hub.api('/tasks?limit=200')]);
      var projects = results[0], allTasks = results[1];
      if (!projects || !projects.projects) { container.innerHTML = '<div class="loading">Unable to load projects</div>'; Hub.setRefreshState('projects', 'done'); return; }

      var tasks = (allTasks && allTasks.tasks) || [];
      var html = '';

      projects.projects.forEach(function(proj) {
        var projTasks = tasks.filter(function(t) { return t.project_id === proj.id; });
        var done = projTasks.filter(function(t) { return t.status === 'done'; }).length;
        var total = projTasks.length;
        var pct = total ? Math.round((done / total) * 100) : 0;
        var open = projTasks.filter(function(t) { return t.status === 'open'; });
        var inProgress = projTasks.filter(function(t) { return t.status === 'claimed' || t.status === 'in_progress'; });
        var completed = projTasks.filter(function(t) { return t.status === 'done'; });

        html += '<div class="card" style="margin-bottom: 16px;"><div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;"><div>' +
          '<h3 style="text-transform: none; font-size: 16px; color: var(--text); letter-spacing: 0;">' + Hub.escHtml(proj.name) + '</h3>' +
          '<div style="font-size: 13px; color: var(--text2); margin-top: 4px;">' + Hub.escHtml(proj.description || '') + '</div></div>' +
          '<div style="text-align: right;"><div class="value" style="font-size: 24px;">' + done + '<span style="font-size: 14px; color: var(--text2)">/' + total + '</span></div>' +
          '<div style="font-size: 12px; color: var(--text2);">' + pct + '% complete</div></div></div>' +
          '<div style="background: var(--bg3); border-radius: 4px; height: 6px; overflow: hidden; margin-bottom: 16px;"><div style="background: var(--green); height: 100%; width: ' + pct + '%; transition: width 0.3s;"></div></div>';

        if (inProgress.length) {
          html += '<div style="margin-bottom: 12px;"><div style="font-size: 12px; color: var(--orange); font-weight: 600; margin-bottom: 6px;">IN PROGRESS</div>' +
            inProgress.map(function(t) { return taskRow(t); }).join('') + '</div>';
        }
        if (open.length) {
          html += '<div style="margin-bottom: 12px;"><div style="font-size: 12px; color: var(--accent); font-weight: 600; margin-bottom: 6px;">OPEN</div>' +
            open.map(function(t) { return taskRow(t); }).join('') + '</div>';
        }
        if (completed.length) {
          html += '<details style="margin-top: 8px;"><summary style="font-size: 12px; color: var(--green); cursor: pointer; font-weight: 600;">COMPLETED (' + completed.length + ')</summary>' +
            '<div style="margin-top: 8px;">' + completed.map(function(t) { return taskRow(t, true); }).join('') + '</div></details>';
        }
        html += '</div>';
      });

      var orphans = tasks.filter(function(t) { return !t.project_id; });
      if (orphans.length) {
        html += '<div class="card" style="margin-bottom: 16px; border-color: var(--orange);"><h3 style="text-transform: none; font-size: 16px; color: var(--orange); letter-spacing: 0;">\u26a0\ufe0f Unassigned Tasks (' + orphans.length + ')</h3>' +
          '<div style="margin-top: 12px;">' + orphans.map(function(t) { return taskRow(t); }).join('') + '</div></div>';
      }

      container.innerHTML = html;
      Hub.setRefreshState('projects', 'done');
    },
    setView: function(view) {
      projectView = view;
      document.getElementById('btn-list-view').classList.toggle('active', view === 'list');
      document.getElementById('btn-graph-view').classList.toggle('active', view === 'graph');
      document.getElementById('projects-list').style.display = view === 'list' ? 'block' : 'none';
      document.getElementById('projects-graph').style.display = view === 'graph' ? 'block' : 'none';
      if (view === 'graph') loadProjectGraph();
    },
    showTooltip: function(event, title, status, assignee, priority) {
      var tt = document.getElementById('graph-tooltip');
      var statusLabel = { done: '\u2705 Done', claimed: '\ud83d\udd27 Claimed', in_progress: '\ud83d\udd27 In Progress', open: '\u25cb Open', blocked: '\ud83d\udeab Blocked' };
      tt.innerHTML = '<div class="tt-title">' + Hub.escHtml(title) + '</div><div class="tt-meta"><span>Status: ' + (statusLabel[status] || status) + '</span>' +
        (assignee ? '<span>Assigned: ' + assignee + '</span>' : '') +
        (priority ? '<span>Priority: ' + priority + '</span>' : '') + '</div>';
      var rect = event.target.closest('.graph-container');
      var r = rect ? rect.getBoundingClientRect() : { left: 0, top: 0 };
      tt.style.left = (event.clientX - r.left + 12) + 'px';
      tt.style.top = (event.clientY - r.top - 10) + 'px';
      tt.classList.add('visible');
    },
    hideTooltip: function() {
      document.getElementById('graph-tooltip').classList.remove('visible');
    }
  };
})();

window.setProjectView = function(v) { Hub.projects.setView(v); };
window.showTooltip = function(e, t, s, a, p) { Hub.projects.showTooltip(e, t, s, a, p); };
window.hideTooltip = function() { Hub.projects.hideTooltip(); };
