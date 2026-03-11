// ── Strategy Dashboard Module ────────────────────
Hub.strategy = {
  _data: null,

  refresh: async function() {
    Hub.setRefreshState('strategy', 'loading');
    var el = document.getElementById('strategy-content');
    el.innerHTML = '<div class="section"><h2>Loading strategy data…</h2></div>';

    var data = await Hub.api('/strategy');
    if (!data) {
      el.innerHTML = '<div class="section"><h2>Unable to load strategy dashboard</h2><p style="color:var(--text2)">Make sure the strategy dashboard is configured.</p></div>';
      Hub.setRefreshState('strategy', 'done');
      return;
    }

    this._data = data;
    this.render(el);
    Hub.setRefreshState('strategy', 'done');
  },

  render: function(el) {
    var d = this._data;
    var html = '';

    // ── KPI Cards ──
    html += '<div class="kpi-cards" style="margin-bottom:20px">';

    // Karma
    var karma = d.karma || {};
    html += this.kpiCard('🦞', karma.current || '—', 'Current Karma');

    // Hourly rate
    var rate = karma.hourly_rate_24h != null ? karma.hourly_rate_24h.toFixed(1) : '—';
    var rateColor = (karma.hourly_rate_24h || 0) > 0 ? '#10b981' : (karma.hourly_rate_24h || 0) < 0 ? '#ef4444' : 'var(--text2)';
    html += this.kpiCard('📈', (karma.hourly_rate_24h > 0 ? '+' : '') + rate + '/hr', 'Growth Rate', rateColor);

    // Trend
    var trend = karma.trend || 'unknown';
    var trendEmoji = trend === 'growing' ? '🟢' : trend === 'stable' ? '🟡' : trend === 'declining' ? '🔴' : '⚪';
    html += this.kpiCard(trendEmoji, trend.charAt(0).toUpperCase() + trend.slice(1), 'Trend');

    // Queue
    var q = d.queue || {};
    var qStatus = q.status || 'unknown';
    var qColor = qStatus === 'healthy' ? '#10b981' : qStatus === 'low' ? '#f59e0b' : qStatus === 'empty' ? '#ef4444' : 'var(--text2)';
    html += this.kpiCard('📋', (q.count != null ? q.count : '—'), 'Queue (' + qStatus + ')', qColor);

    html += '</div>';

    // ── Recommendations ──
    var recs = d.recommendations || [];
    if (recs.length) {
      html += '<div class="section"><div class="section-title">💡 Recommendations</div>';
      html += '<div class="strategy-recs">';
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        var prioClass = r.priority === 'high' ? 'rec-high' : r.priority === 'medium' ? 'rec-medium' : 'rec-info';
        var prioIcon = r.priority === 'high' ? '🔴' : r.priority === 'medium' ? '🟡' : 'ℹ️';
        html += '<div class="rec-item ' + prioClass + '">' +
          '<span class="rec-icon">' + prioIcon + '</span>' +
          '<span class="rec-text">' + Hub.esc(r.action) + '</span>' +
          '</div>';
      }
      html += '</div></div>';
    }

    // ── Two-column layout ──
    html += '<div class="dash-two-col">';

    // Left: Karma details
    html += '<div class="section"><div class="section-title">📊 Karma Analytics</div>';
    html += '<div class="card" style="padding:16px">';
    if (karma.intervals) {
      html += '<table class="strategy-table"><thead><tr><th>Period</th><th>Growth</th></tr></thead><tbody>';
      var intervals = karma.intervals;
      var intLabels = {'1h': 'Last 1 hour', '6h': 'Last 6 hours', '24h': 'Last 24 hours', '48h': 'Last 48 hours', '7d': 'Last 7 days'};
      var intOrder = ['1h', '6h', '24h', '48h', '7d'];
      for (var k = 0; k < intOrder.length; k++) {
        var key = intOrder[k];
        if (intervals[key] != null) {
          var val = intervals[key];
          var cls = val > 0 ? 'positive' : val < 0 ? 'negative' : '';
          html += '<tr><td>' + (intLabels[key] || key) + '</td><td class="' + cls + '">' + (val > 0 ? '+' : '') + val + '</td></tr>';
        }
      }
      html += '</tbody></table>';
    }
    if (karma.peak_hours_utc && karma.peak_hours_utc.length) {
      html += '<div class="peak-hours"><strong>Peak hours (UTC):</strong> ' +
        karma.peak_hours_utc.map(function(h) { return String(h).padStart(2, '0') + ':00'; }).join(', ') +
        '</div>';
    }
    html += '<div class="total-readings" style="color:var(--text2);font-size:0.85em;margin-top:8px">' +
      (karma.total_readings || 0) + ' data points since ' +
      (karma.first_reading ? new Date(karma.first_reading).toLocaleDateString() : '—') +
      '</div>';
    html += '</div></div>';

    // Right: Comment ROI
    html += '<div class="section"><div class="section-title">💬 Comment ROI</div>';
    html += '<div class="card" style="padding:16px">';
    var c = d.comments;
    if (c) {
      html += '<div class="comment-stats">';
      html += '<div class="stat-row"><span>Total tracked</span><span>' + (c.total_comments || 0) + '</span></div>';
      html += '<div class="stat-row"><span>Avg Δ (1h)</span><span class="positive">+' + (c.avg_delta_1h || 0).toFixed(1) + '</span></div>';
      html += '<div class="stat-row"><span>Verified avg</span><span class="positive">+' + (c.avg_verified_delta_1h || 0).toFixed(1) + '</span></div>';
      html += '<div class="stat-row"><span>Unverified avg</span><span>+' + (c.avg_unverified_delta_1h || 0).toFixed(1) + '</span></div>';
      html += '<div class="stat-row highlight"><span>Verification edge</span><span class="positive">+' + (c.verification_advantage || 0).toFixed(1) + '/hr</span></div>';
      html += '<div class="stat-row"><span>Long-tail multiplier</span><span>' + (c.longtail_multiplier || 0).toFixed(2) + 'x</span></div>';
      html += '</div>';

      // Top comments
      if (c.top_comments && c.top_comments.length) {
        html += '<div style="margin-top:12px"><strong style="font-size:0.85em;color:var(--text2)">Top Comments</strong>';
        for (var j = 0; j < Math.min(c.top_comments.length, 5); j++) {
          var tc = c.top_comments[j];
          html += '<div class="top-comment">' +
            '<div class="top-comment-title">' + Hub.esc(Hub.truncate(tc.post_title || '', 60)) + '</div>' +
            '<div class="top-comment-stats">' +
            '<span class="positive">+' + (tc.delta_1h || 0) + ' (1h)</span>' +
            (tc.delta_2h != null ? ' <span style="color:var(--text2)">+' + tc.delta_2h + ' (2h)</span>' : '') +
            (tc.verified ? ' <span class="verified-badge">✓</span>' : '') +
            '</div></div>';
        }
        html += '</div>';
      }
    } else {
      html += '<p style="color:var(--text2)">No comment tracking data available.</p>';
    }
    html += '</div></div>';

    html += '</div>'; // end two-col

    // ── Queue Distribution ──
    if (q.submolt_distribution) {
      html += '<div class="section"><div class="section-title">📦 Queue Distribution</div>';
      html += '<div class="card" style="padding:16px">';
      html += '<div class="queue-dist">';
      var dist = q.submolt_distribution;
      var total = Object.values(dist).reduce(function(a, b) { return a + b; }, 0) || 1;
      var sortedSubmolts = Object.entries(dist).sort(function(a, b) { return b[1] - a[1]; });
      for (var s = 0; s < sortedSubmolts.length; s++) {
        var submolt = sortedSubmolts[s][0];
        var count = sortedSubmolts[s][1];
        var pct = Math.round(count / total * 100);
        html += '<div class="queue-bar-row">' +
          '<span class="queue-label">' + Hub.esc(submolt) + '</span>' +
          '<div class="queue-bar-track"><div class="queue-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="queue-count">' + count + '</span></div>';
      }
      html += '</div></div></div>';
    }

    // ── Content Intel ──
    var ci = d.content_intel;
    if (ci && ci.report_available) {
      html += '<div class="section"><div class="section-title">🧠 Content Intelligence</div>';
      html += '<div class="card" style="padding:16px">';
      html += '<p style="color:var(--text2);margin:0">Full content analysis report available.</p>';
      html += '<p style="color:var(--text2);font-size:0.85em;margin:4px 0 0 0">Path: <code style="background:var(--bg);padding:2px 6px;border-radius:4px">' + Hub.esc(ci.path || '') + '</code></p>';
      html += '</div></div>';
    }

    // ── Generated timestamp ──
    html += '<div style="text-align:center;color:var(--text2);font-size:0.8em;margin-top:20px">Generated ' +
      (d.generated ? new Date(d.generated).toLocaleString() : 'now') + '</div>';

    el.innerHTML = html;
  },

  kpiCard: function(emoji, value, label, color) {
    return '<div class="kpi-card">' +
      '<div class="kpi-value" style="' + (color ? 'color:' + color : '') + '">' +
      '<span style="margin-right:6px">' + emoji + '</span>' + Hub.esc(String(value)) +
      '</div><div class="kpi-label">' + Hub.esc(label) + '</div></div>';
  }
};
