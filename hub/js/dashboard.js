// ── Dashboard Module ─────────────────────────────
Hub.dashboard = {
  refresh: async function() {
    Hub.setRefreshState('dashboard', 'loading');
    var cards = document.getElementById('kpi-cards');
    cards.innerHTML = Hub.skeletonCards(4);
    document.querySelector('#agent-table tbody').innerHTML = Hub.skeletonTable(3);
    document.getElementById('recent-activity').innerHTML = Hub.skeletonMessages(3);

    var results = await Promise.all([Hub.api('/stats'), Hub.api('/git/repos'), Hub.api('/board')]);
    var stats = results[0], repos = results[1], board = results[2];
    if (!stats) { cards.innerHTML = '<div class="loading">Unable to load stats</div>'; Hub.setRefreshState('dashboard', 'done'); return; }

    var boardData = (board && board.board) || {};
    var openTasks = (boardData.open || []).length;
    var doneTasks = (boardData.done || []).length;
    var inProgress = (boardData.in_progress || []).length + (boardData.claimed || []).length;
    var totalTasks = openTasks + doneTasks + inProgress + (boardData.blocked || []).length;
    var repoCount = (repos && repos.repos) ? repos.repos.length : 0;

    cards.innerHTML =
      '<div class="card"><h3>Total Messages</h3><div class="value">' + stats.total_messages + '</div><div class="sub">' + ((stats.agents && stats.agents.length) || 0) + ' agents active</div></div>' +
      '<div class="card"><h3>Conversations</h3><div class="value">' + stats.conversations + '</div><div class="sub">' + stats.unread_messages + ' unread</div></div>' +
      '<div class="card"><h3>Tasks Complete</h3><div class="value" style="color: var(--green)">' + doneTasks + '<span style="font-size:18px;color:var(--text2)">/' + totalTasks + '</span></div><div class="sub">' + inProgress + ' in progress, ' + openTasks + ' open</div></div>' +
      '<div class="card"><h3>Git Repos</h3><div class="value">' + repoCount + '</div><div class="sub">' + ((repos && repos.repos) ? repos.repos.map(function(r){return r.name}).join(', ') : '') + '</div></div>';

    // Agent table
    var tbody = document.querySelector('#agent-table tbody');
    tbody.innerHTML = (stats.agents || []).map(function(a) {
      return '<tr><td><strong>' + a + '</strong></td><td>\u2014</td><td><span class="badge badge-blue">' + (a === 'Dylan' ? 'Human' : 'Agent') + '</span></td></tr>';
    }).join('');

    // Recent activity
    var activity = document.getElementById('recent-activity');
    var convos = await Hub.api('/conversations');
    var allMsgs = [];
    if (convos) {
      for (var i = 0; i < convos.length; i++) {
        var msgs = await Hub.api('/conversations/' + convos[i].id + '/messages');
        if (Array.isArray(msgs)) {
          allMsgs = allMsgs.concat(msgs.slice(-3).map(function(m) { return Object.assign({}, m, {convName: convos[i].name}); }));
        }
      }
    }
    allMsgs.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    activity.innerHTML = allMsgs.slice(0, 6).map(function(m) {
      return '<div class="msg ' + (m.from_agent ? 'from-' + m.from_agent.toLowerCase() : '') + '">' +
        '<div class="msg-header"><span class="msg-from">' + (m.from_agent || 'Unknown') + '</span>' +
        '<span class="msg-time">' + (m.timestamp ? new Date(m.timestamp * 1000).toLocaleString() : '') + ' \u00b7 ' + (m.convName || '') + '</span></div>' +
        '<div class="msg-body">' + Hub.escHtml(Hub.truncate(m.content || '', 200)) + '</div></div>';
    }).join('') || '<div class="loading">No recent activity</div>';

    // Karma trajectory chart
    var moltData = await Hub.api('/moltbook');
    var series = (moltData && moltData.karma_series) || [];
    var karmaCanvas = document.getElementById('karma-chart');
    if (karmaCanvas && series.length > 2) {
      var ctx = karmaCanvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      var rect = karmaCanvas.parentElement.getBoundingClientRect();
      karmaCanvas.width = rect.width * dpr;
      karmaCanvas.height = 180 * dpr;
      karmaCanvas.style.width = rect.width + 'px';
      karmaCanvas.style.height = '180px';
      ctx.scale(dpr, dpr);
      var w = rect.width, h = 180;
      var pad = { t: 20, r: 20, b: 30, l: 55 };
      var cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;

      var vals = series.map(function(s) { return s.v; });
      var minV = Math.min.apply(null, vals);
      var maxV = Math.max.apply(null, vals);
      var rangeV = maxV - minV || 1;
      minV -= rangeV * 0.05;
      maxV += rangeV * 0.05;
      rangeV = maxV - minV;

      ctx.clearRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = 'rgba(125,140,165,0.08)';
      ctx.lineWidth = 1;
      for (var g = 0; g <= 4; g++) {
        var gy = pad.t + (g / 4) * ch;
        ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
      }

      // Y-axis labels
      ctx.fillStyle = '#6b7a8d';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      for (var g = 0; g <= 4; g++) {
        var gy = pad.t + (g / 4) * ch;
        var yVal = Math.round(maxV - (g / 4) * rangeV);
        ctx.fillText(yVal.toLocaleString(), pad.l - 8, gy + 4);
      }

      // Area fill gradient
      var grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
      grad.addColorStop(0, 'rgba(108,180,255,0.25)');
      grad.addColorStop(1, 'rgba(108,180,255,0.01)');
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t + ch);
      series.forEach(function(pt, i) {
        var x = pad.l + (i / (series.length - 1)) * cw;
        var y = pad.t + ch - ((pt.v - minV) / rangeV) * ch;
        ctx.lineTo(x, y);
      });
      ctx.lineTo(pad.l + cw, pad.t + ch);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      series.forEach(function(pt, i) {
        var x = pad.l + (i / (series.length - 1)) * cw;
        var y = pad.t + ch - ((pt.v - minV) / rangeV) * ch;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#6cb4ff';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // End dot
      var lastX = pad.l + cw;
      var lastY = pad.t + ch - ((series[series.length - 1].v - minV) / rangeV) * ch;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#6cb4ff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lastX, lastY, 7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(108,180,255,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Current value label
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(series[series.length - 1].v.toLocaleString(), lastX - 12, lastY - 10);

      // X-axis labels
      ctx.fillStyle = '#6b7a8d';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      [0, Math.floor(series.length / 2), series.length - 1].forEach(function(idx) {
        var x = pad.l + (idx / (series.length - 1)) * cw;
        var label = series[idx].t.replace('T', ' ').slice(5, 16);
        ctx.fillText(label, x, h - 6);
      });
    } else if (karmaCanvas) {
      var ctx2 = karmaCanvas.getContext('2d');
      karmaCanvas.style.height = '60px';
      ctx2.fillStyle = '#6b7a8d';
      ctx2.font = '13px -apple-system, sans-serif';
      ctx2.fillText('Karma data collecting — chart will appear shortly', 20, 35);
    }

    Hub.setRefreshState('dashboard', 'done');

    // System Health — run in parallel, don't block main render
    Hub.dashboard.refreshHealth();
  },

  refreshHealth: async function() {
    var container = document.getElementById('system-health-cards');
    if (!container) return;

    var alertData = await Hub.api('/alerts');
    var moltData  = await Hub.api('/moltbook');

    // --- Bridge status ---
    var bridgeOnline = true;
    var bridgeMsg = 'Connected';
    if (alertData && alertData.active) {
      var bridgeAlert = alertData.active.find(function(a) {
        return a.id === 'bridge-unreachable' || a.id === 'bridge-http-error';
      });
      if (bridgeAlert) {
        bridgeOnline = false;
        bridgeMsg = bridgeAlert.title || 'Unreachable';
      }
    } else if (!alertData) {
      bridgeOnline = false;
      bridgeMsg = 'Unknown';
    }

    // --- SSE state ---
    var sseConnected = Hub.sseState && Hub.sseState.connected;
    var sseLastEvt   = Hub.sseState && Hub.sseState.lastEventAt;
    var sseAge = sseLastEvt ? Math.floor((Date.now() - sseLastEvt) / 1000) : null;
    var sseLabel = sseConnected ? 'Live' : 'Reconnecting\u2026';
    var sseDot = sseConnected ? 'green pulse' : 'orange pulse';

    // --- Last heartbeat (use last_check from alerts or SSE lastEventAt) ---
    var hbTime = (alertData && alertData.last_check) ? new Date(alertData.last_check) : null;
    var hbLabel = hbTime ? hbTime.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : (sseLastEvt ? Hub.timeAgo(sseLastEvt) : 'Unknown');

    // --- Moltbook queue depth ---
    var queueDepth = 0;
    if (moltData && moltData.queues) {
      queueDepth = (moltData.queues.posts || 0) + (moltData.queues.comments || 0);
    }
    var queueDot = queueDepth > 10 ? 'orange' : queueDepth > 20 ? 'red' : 'green';
    var queueLabel = queueDepth > 0 ? queueDepth + ' pending' : 'Queue empty';

    // --- Critical alert count ---
    var critCount = (alertData && alertData.stats) ? alertData.stats.critical : 0;
    var critDot = critCount > 0 ? 'red' : 'green';
    var critLabel = critCount > 0 ? critCount + ' critical' : 'All clear';

    container.innerHTML =
      '<div class="health-card">' +
        '<div class="health-dot ' + (bridgeOnline ? 'green pulse' : 'red') + '"></div>' +
        '<div class="health-card-body">' +
          '<div class="health-card-label">Bridge</div>' +
          '<div class="health-card-value">' + Hub.esc(bridgeOnline ? 'Online' : 'Offline') + '</div>' +
          '<div class="health-card-sub">' + Hub.esc(bridgeMsg) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="health-card">' +
        '<div class="health-dot ' + sseDot + '"></div>' +
        '<div class="health-card-body">' +
          '<div class="health-card-label">Live Stream</div>' +
          '<div class="health-card-value">' + Hub.esc(sseLabel) + '</div>' +
          '<div class="health-card-sub">' + (sseAge !== null ? sseAge + 's ago' : 'No events yet') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="health-card">' +
        '<div class="health-dot green"></div>' +
        '<div class="health-card-body">' +
          '<div class="health-card-label">Last Heartbeat</div>' +
          '<div class="health-card-value">' + Hub.esc(hbLabel) + '</div>' +
          '<div class="health-card-sub">' + (hbTime ? Hub.timeAgo(hbTime.toISOString()) : '\u2014') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="health-card">' +
        '<div class="health-dot ' + queueDot + '"></div>' +
        '<div class="health-card-body">' +
          '<div class="health-card-label">Moltbook Queue</div>' +
          '<div class="health-card-value">' + Hub.esc(queueLabel) + '</div>' +
          '<div class="health-card-sub">posts + comments</div>' +
        '</div>' +
      '</div>' +
      '<div class="health-card">' +
        '<div class="health-dot ' + critDot + '"></div>' +
        '<div class="health-card-body">' +
          '<div class="health-card-label">Alerts</div>' +
          '<div class="health-card-value">' + Hub.esc(critLabel) + '</div>' +
          '<div class="health-card-sub">' + ((alertData && alertData.stats) ? alertData.stats.active + ' active total' : 'Loading\u2026') + '</div>' +
        '</div>' +
      '</div>';
  }
};
