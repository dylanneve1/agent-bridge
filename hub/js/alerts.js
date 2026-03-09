// ── Alerts Module ────────────────────────────────
Hub.alerts = (function() {

  function alertPanel(title, severity, alerts, isAcked) {
    var html = '<div class="alert-panel"><div class="alert-panel-header ' + severity + '">' + title + ' (' + alerts.length + ')</div>';
    var iconMap = {critical: '\ud83d\udea8', warning: '\u26a0\ufe0f', info: '\u2139\ufe0f'};
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      var icon = iconMap[a.severity] || '\u2139\ufe0f';
      html += '<div class="alert-item"><div class="alert-icon">' + icon + '</div><div class="alert-body">' +
        '<div class="alert-title">' + Hub.esc(a.title) + '</div>' +
        '<div class="alert-message">' + Hub.esc(a.message) + '</div>' +
        '<div class="alert-meta"><span>\ud83c\udff7\ufe0f ' + Hub.esc(a.detector || '') + '</span><span>' + Hub.timeAgo(a.timestamp) + '</span></div></div>' +
        '<div class="alert-actions">' +
        (!isAcked ? '<button class="alert-btn" onclick="Hub.alerts.action(\'acknowledge\',\'' + Hub.esc(a.id) + '\')">\ud83d\udc41\ufe0f Ack</button>' : '') +
        '<button class="alert-btn resolve" onclick="Hub.alerts.action(\'resolve\',\'' + Hub.esc(a.id) + '\')">\u2705 Resolve</button></div></div>';
    }
    html += '</div>';
    return html;
  }

  return {
    refresh: async function() {
      Hub.setRefreshState('alerts', 'loading');
      var data = await Hub.api('/alerts');
      if (!data) {
        document.getElementById('alert-panels').innerHTML = '<div class="alert-empty">\u23f3 Unable to fetch alerts</div>';
        Hub.setRefreshState('alerts', 'done');
        return;
      }

      var s = data.stats || {};
      document.getElementById('alert-stats').innerHTML =
        '<div class="alert-stat-card"><div class="stat-value" style="color:' + (s.critical > 0 ? 'var(--red)' : 'var(--green)') + '">' + s.active + '</div><div class="stat-label">Active Alerts</div></div>' +
        '<div class="alert-stat-card"><div class="stat-value" style="color:var(--red)">' + s.critical + '</div><div class="stat-label">Critical</div></div>' +
        '<div class="alert-stat-card"><div class="stat-value" style="color:var(--orange)">' + s.warning + '</div><div class="stat-label">Warnings</div></div>' +
        '<div class="alert-stat-card"><div class="stat-value" style="color:var(--green)">' + (s.resolved_today || 0) + '</div><div class="stat-label">Resolved Today</div></div>';

      Hub.syncAlertBadges(s.active);

      if (data.last_check) {
        document.getElementById('alert-last-check').textContent = 'Last check: ' + Hub.timeAgo(data.last_check);
      }

      var panels = document.getElementById('alert-panels');
      var html = '';

      var critical = (data.panels && data.panels.critical) || [];
      if (critical.length > 0) html += alertPanel('\ud83d\udea8 Critical', 'critical', critical);

      var warnings = (data.panels && data.panels.warning) || [];
      if (warnings.length > 0) html += alertPanel('\u26a0\ufe0f Warnings', 'warning', warnings);

      var info = (data.panels && data.panels.info) || [];
      if (info.length > 0) html += alertPanel('\u2139\ufe0f Info', 'info', info);

      var acked = data.acknowledged || [];
      if (acked.length > 0) html += alertPanel('\ud83d\udc41\ufe0f Acknowledged', 'info', acked, true);

      if (!critical.length && !warnings.length && !info.length && !acked.length) {
        html += '<div class="alert-empty">\u2705 All clear \u2014 no active alerts</div>';
      }

      var history = (data.history || []).reverse().slice(0, 15);
      if (history.length > 0) {
        html += '<div class="alert-panel"><div class="alert-panel-header resolved">\u2705 Recently Resolved (' + history.length + ')</div>';
        for (var i = 0; i < history.length; i++) {
          var a = history[i];
          html += '<div class="alert-item" style="opacity:0.6"><div class="alert-body">' +
            '<div class="alert-title">' + Hub.esc(a.title) + '</div>' +
            '<div class="alert-message">' + Hub.esc(a.message) + '</div>' +
            '<div class="alert-meta"><span>\ud83c\udff7\ufe0f ' + Hub.esc(a.detector || '') + '</span>' +
            (a.resolved_at ? '<span>Resolved ' + Hub.timeAgo(a.resolved_at) + '</span>' : '') + '</div></div></div>';
        }
        html += '</div>';
      }

      panels.innerHTML = html;
      Hub.setRefreshState('alerts', 'done');
    },
    action: async function(action, id) {
      try {
        await fetch(Hub.API + '/alerts/' + action, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({id: id})
        });
        Hub.alerts.refresh();
      } catch(e) {}
    }
  };
})();

window.alertAction = function(a, id) { Hub.alerts.action(a, id); };
