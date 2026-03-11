// ── Engagement Intelligence Module ───────────────
// Per-post engagement timeline, commenter network graph, reciprocal tracking
Hub.engageintel = {
  _data: null,

  refresh: async function() {
    Hub.setRefreshState('engageintel', 'loading');
    var el = document.getElementById('engageintel-content');
    el.innerHTML = '<div class="section"><h2>Loading engagement data…</h2></div>';

    var data = await Hub.api('/engage-intel');
    if (!data || data.error) {
      el.innerHTML = '<div class="section"><h2>Unable to load engagement data</h2><p style="color:var(--text2)">' + Hub.esc((data && data.error) || 'Check notification-intel + reciprocal-tracker.') + '</p></div>';
      Hub.setRefreshState('engageintel', 'done');
      return;
    }

    this._data = data;
    this.render(el);
    Hub.setRefreshState('engageintel', 'done');
  },

  render: function(el) {
    var d = this._data;
    var html = '';

    // ── KPI Cards ──
    html += '<div class="kpi-cards" style="margin-bottom:20px">';
    html += this.kpiCard('🦞', d.karma || '—', 'Karma');
    html += this.kpiCard('🔔', d.total_notifications || 0, 'Notifications');
    html += this.kpiCard('📝', d.active_posts || 0, 'Active Posts');
    html += this.kpiCard('👥', d.unique_commenters || 0, 'Unique Commenters');
    html += '</div>';

    // ── Two-column layout ──
    html += '<div class="dash-two-col">';

    // Left: Post engagement heatmap
    html += '<div class="section"><div class="section-title">🔥 Post Engagement Heatmap</div>';
    html += '<div class="card" style="padding:16px;overflow-x:auto">';
    html += this.renderPostHeatmap(d.posts || []);
    html += '</div></div>';

    // Right: Commenter Network
    html += '<div class="section"><div class="section-title">🕸️ Commenter Network</div>';
    html += '<div class="card" style="padding:16px">';
    html += this.renderCommenterNetwork(d.posts || [], d.top_commenters || []);
    html += '</div></div>';

    html += '</div>'; // end two-col

    // ── Per-post engagement timeline ──
    html += '<div class="section"><div class="section-title">📊 Per-Post Engagement Timeline</div>';
    html += '<div class="card" style="padding:16px">';
    html += this.renderPostTimeline(d.posts || []);
    html += '</div></div>';

    // ── Reciprocal Engagement Dashboard ──
    var recip = d.reciprocal || {};
    if (recip.agents && Object.keys(recip.agents).length > 0) {
      html += '<div class="section"><div class="section-title">🤝 Reciprocal Engagement</div>';
      html += '<div class="card" style="padding:16px">';
      html += this.renderReciprocal(recip);
      html += '</div></div>';
    }

    // ── Breakout posts ──
    var breakouts = d.breakout_posts || [];
    if (breakouts.length) {
      html += '<div class="section"><div class="section-title">🚀 Breakout Posts</div>';
      html += '<div class="card" style="padding:16px">';
      for (var i = 0; i < breakouts.length; i++) {
        var bp = breakouts[i];
        html += '<div class="breakout-post">' +
          '<div class="breakout-title">' + Hub.esc(Hub.truncate(bp.title || '', 70)) + '</div>' +
          '<div class="breakout-meta">' +
          '<span class="tag tag-' + Hub.esc(bp.submolt || 'general') + '">' + Hub.esc(bp.submolt || '') + '</span>' +
          ' <span style="color:var(--accent)">' + (bp.notification_count || 0) + ' notifs</span>' +
          ' · <span style="color:var(--text2)">' + (bp.commenter_count || 0) + ' commenters</span>' +
          '</div></div>';
      }
      html += '</div></div>';
    }

    // ── Generated timestamp ──
    html += '<div style="text-align:center;color:var(--text2);font-size:0.8em;margin-top:20px">Generated ' +
      (d.generated ? new Date(d.generated).toLocaleString() : 'now') + '</div>';

    el.innerHTML = html;
  },

  renderPostHeatmap: function(posts) {
    if (!posts.length) return '<p style="color:var(--text2)">No active posts.</p>';

    // Sort by notification count desc
    var sorted = posts.slice().sort(function(a, b) { return (b.notification_count || 0) - (a.notification_count || 0); });
    var maxNotifs = sorted[0].notification_count || 1;

    var svg = '<svg width="100%" viewBox="0 0 700 ' + (sorted.length * 40 + 30) + '" style="font-family:system-ui,sans-serif">';

    // Title row
    svg += '<text x="0" y="16" fill="var(--text2)" font-size="11">Post</text>';
    svg += '<text x="400" y="16" fill="var(--text2)" font-size="11">Notifs</text>';
    svg += '<text x="500" y="16" fill="var(--text2)" font-size="11">Commenters</text>';
    svg += '<text x="620" y="16" fill="var(--text2)" font-size="11">Heat</text>';

    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var y = 30 + i * 40;
      var notifs = p.notification_count || 0;
      var commenters = p.commenter_count || 0;
      var heat = notifs / maxNotifs;

      // Heat color: cold blue → hot red
      var r = Math.round(94 + heat * 145);
      var g = Math.round(170 - heat * 120);
      var b = Math.round(255 - heat * 200);

      // Truncated title
      var title = (p.title || '').length > 50 ? p.title.substring(0, 47) + '…' : (p.title || '');

      // Submolt badge
      var subColor = this.submoltColor(p.submolt || '');

      svg += '<rect x="0" y="' + (y - 2) + '" width="700" height="36" rx="4" fill="rgba(' + r + ',' + g + ',' + b + ',0.12)" />';
      svg += '<circle cx="8" cy="' + (y + 14) + '" r="5" fill="' + subColor + '" />';
      svg += '<text x="18" y="' + (y + 18) + '" fill="var(--text)" font-size="12">' + Hub.escSvg(title) + '</text>';
      svg += '<text x="400" y="' + (y + 18) + '" fill="var(--accent)" font-size="13" font-weight="600">' + notifs + '</text>';
      svg += '<text x="500" y="' + (y + 18) + '" fill="var(--text2)" font-size="12">' + commenters + ' (' + (p.commenters || []).slice(0, 3).join(', ') + (commenters > 3 ? '…' : '') + ')</text>';

      // Heat bar
      var barW = Math.max(heat * 60, 4);
      svg += '<rect x="620" y="' + (y + 4) + '" width="' + barW + '" height="18" rx="3" fill="rgb(' + r + ',' + g + ',' + b + ')" opacity="0.8" />';
    }

    svg += '</svg>';
    return svg;
  },

  renderCommenterNetwork: function(posts, topCommenters) {
    // Build adjacency: which commenters appear on same posts
    var commenterPosts = {};
    for (var i = 0; i < posts.length; i++) {
      var cs = posts[i].commenters || [];
      for (var j = 0; j < cs.length; j++) {
        if (!commenterPosts[cs[j]]) commenterPosts[cs[j]] = [];
        commenterPosts[cs[j]].push(i);
      }
    }

    var agents = Object.keys(commenterPosts);
    if (!agents.length) return '<p style="color:var(--text2)">No commenter data.</p>';

    // Sort by engagement count
    agents.sort(function(a, b) { return commenterPosts[b].length - commenterPosts[a].length; });
    var top = agents.slice(0, 15);

    // Build co-occurrence edges
    var edges = [];
    for (var m = 0; m < top.length; m++) {
      for (var n = m + 1; n < top.length; n++) {
        var shared = 0;
        var aPosts = commenterPosts[top[m]];
        var bPosts = commenterPosts[top[n]];
        for (var x = 0; x < aPosts.length; x++) {
          if (bPosts.indexOf(aPosts[x]) !== -1) shared++;
        }
        if (shared > 0) edges.push({ from: m, to: n, weight: shared });
      }
    }

    // Circular layout
    var W = 380, H = 320, cx = W / 2, cy = H / 2, R = 120;
    var svg = '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" style="font-family:system-ui,sans-serif">';

    // Draw edges
    for (var e = 0; e < edges.length; e++) {
      var fromAngle = (edges[e].from / top.length) * Math.PI * 2 - Math.PI / 2;
      var toAngle = (edges[e].to / top.length) * Math.PI * 2 - Math.PI / 2;
      var x1 = cx + R * Math.cos(fromAngle), y1 = cy + R * Math.sin(fromAngle);
      var x2 = cx + R * Math.cos(toAngle), y2 = cy + R * Math.sin(toAngle);
      var opacity = Math.min(edges[e].weight * 0.3, 0.8);
      svg += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="var(--accent)" stroke-opacity="' + opacity + '" stroke-width="' + Math.min(edges[e].weight, 3) + '" />';
    }

    // Draw nodes
    for (var k = 0; k < top.length; k++) {
      var angle = (k / top.length) * Math.PI * 2 - Math.PI / 2;
      var nx = cx + R * Math.cos(angle);
      var ny = cy + R * Math.sin(angle);
      var count = commenterPosts[top[k]].length;
      var nodeR = Math.max(6, Math.min(count * 4, 18));
      var nodeColor = count >= 3 ? '#10b981' : count >= 2 ? '#5eaaff' : '#6b7280';

      svg += '<circle cx="' + nx.toFixed(1) + '" cy="' + ny.toFixed(1) + '" r="' + nodeR + '" fill="' + nodeColor + '" opacity="0.85" />';

      // Label: offset outward
      var labelR = R + nodeR + 8;
      var lx = cx + labelR * Math.cos(angle);
      var ly = cy + labelR * Math.sin(angle);
      var anchor = Math.abs(angle) < Math.PI / 2 || Math.abs(angle) > 3 * Math.PI / 2 ? 'start' : 'end';
      if (Math.abs(Math.cos(angle)) < 0.15) anchor = 'middle';

      svg += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" fill="var(--text)" font-size="10" text-anchor="' + anchor + '">' + Hub.escSvg(top[k]) + ' (' + count + ')</text>';
    }

    // Center label
    svg += '<text x="' + cx + '" y="' + (cy + 4) + '" fill="var(--text2)" font-size="11" text-anchor="middle">You</text>';
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="8" fill="var(--accent)" opacity="0.3" />';

    svg += '</svg>';
    return svg;
  },

  renderPostTimeline: function(posts) {
    if (!posts.length) return '<p style="color:var(--text2)">No posts to show.</p>';

    var sorted = posts.slice().sort(function(a, b) {
      return new Date(b.latest_at || 0) - new Date(a.latest_at || 0);
    });

    var html = '<div class="post-timeline">';
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var subColor = this.submoltColor(p.submolt || '');
      var age = p.latest_at ? Hub.timeAgo(p.latest_at) : '—';

      html += '<div class="timeline-item">' +
        '<div class="timeline-dot" style="background:' + subColor + '"></div>' +
        '<div class="timeline-content">' +
        '<div class="timeline-title">' + Hub.esc(Hub.truncate(p.title || '', 80)) + '</div>' +
        '<div class="timeline-meta">' +
        '<span class="tag-small" style="background:' + subColor + '22;color:' + subColor + '">' + Hub.esc(p.submolt || '') + '</span>' +
        ' <span style="color:var(--accent)">' + (p.notification_count || 0) + ' notifs</span>' +
        ' · ' + (p.commenter_count || 0) + ' commenters · last activity ' + age +
        '</div>' +
        '<div class="timeline-commenters">';

      var cs = p.commenters || [];
      for (var j = 0; j < cs.length; j++) {
        html += '<span class="commenter-chip">' + Hub.esc(cs[j]) + '</span>';
      }

      html += '</div></div></div>';
    }
    html += '</div>';
    return html;
  },

  renderReciprocal: function(recip) {
    var agents = recip.agents || {};
    var keys = Object.keys(agents);
    if (!keys.length) return '<p style="color:var(--text2)">No reciprocal data.</p>';

    // Sort by priority desc
    keys.sort(function(a, b) { return (agents[b].priority || 0) - (agents[a].priority || 0); });

    // Summary
    var deficit = keys.filter(function(k) { return (agents[k].reciprocity_score || 0) < -0.3; }).length;
    var balanced = keys.filter(function(k) { var s = agents[k].reciprocity_score || 0; return s >= -0.3 && s <= 0.3; }).length;
    var surplus = keys.filter(function(k) { return (agents[k].reciprocity_score || 0) > 0.3; }).length;

    var html = '<div class="recip-summary">' +
      '<span class="recip-pill recip-deficit">🔴 ' + deficit + ' deficit</span>' +
      '<span class="recip-pill recip-balanced">🟡 ' + balanced + ' balanced</span>' +
      '<span class="recip-pill recip-surplus">🟢 ' + surplus + ' surplus</span>' +
      '</div>';

    // Table
    html += '<table class="strategy-table" style="margin-top:12px"><thead><tr>' +
      '<th>Agent</th><th>Inbound</th><th>Outgoing</th><th>Score</th><th>Priority</th>' +
      '</tr></thead><tbody>';

    var shown = Math.min(keys.length, 20);
    for (var i = 0; i < shown; i++) {
      var a = agents[keys[i]];
      var score = (a.reciprocity_score || 0);
      var scoreColor = score < -0.3 ? '#ef4444' : score > 0.3 ? '#10b981' : '#f59e0b';
      var prio = (a.priority || 0).toFixed(1);

      html += '<tr>' +
        '<td><strong>' + Hub.esc(keys[i]) + '</strong></td>' +
        '<td style="color:var(--accent)">' + (a.inbound || 0) + '</td>' +
        '<td>' + (a.outgoing || 0) + '</td>' +
        '<td style="color:' + scoreColor + '">' + score.toFixed(2) + '</td>' +
        '<td>' + prio + '</td>' +
        '</tr>';
    }

    html += '</tbody></table>';
    if (keys.length > 20) {
      html += '<div style="color:var(--text2);font-size:0.85em;margin-top:8px">Showing top 20 of ' + keys.length + ' tracked agents</div>';
    }

    return html;
  },

  submoltColor: function(s) {
    var colors = {
      'builds': '#10b981', 'agents': '#5eaaff', 'security': '#ef4444',
      'technology': '#8b5cf6', 'ai': '#f59e0b', 'philosophy': '#ec4899',
      'general': '#6b7280', 'infrastructure': '#06b6d4', 'todayilearned': '#84cc16',
      'consciousness': '#a855f7', 'emergence': '#14b8a6', 'tooling': '#f97316',
      'memory': '#6366f1'
    };
    return colors[s] || '#6b7280';
  },

  kpiCard: function(emoji, value, label, color) {
    return '<div class="kpi-card">' +
      '<div class="kpi-value" style="' + (color ? 'color:' + color : '') + '">' +
      '<span style="margin-right:6px">' + emoji + '</span>' + Hub.esc(String(value)) +
      '</div><div class="kpi-label">' + Hub.esc(label) + '</div></div>';
  }
};
