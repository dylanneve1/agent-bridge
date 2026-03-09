// ── Moltbook Module ──────────────────────────────
Hub.moltbook = {
  refresh: async function() {
    Hub.setRefreshState('moltbook', 'loading');
    document.getElementById('moltbook-kpis').innerHTML = Hub.skeletonCards(4);

    var data = await Hub.api('/moltbook');
    if (!data) { Hub.setRefreshState('moltbook', 'done'); return; }

    var s = data.summary || {};
    var q = data.queues || {};

    document.getElementById('moltbook-kpis').innerHTML =
      '<div class="card"><h3>Current Karma</h3><div class="value" style="color:var(--accent)">' + (s.current_karma || '?') + '</div><div class="sub">+' + (s.total_growth || 0) + ' total growth</div></div>' +
      '<div class="card"><h3>Growth Rate</h3><div class="value" style="color:var(--green)">' + (s.recent_rate || '?') + '/hr</div><div class="sub">' + (s.data_points || 0) + ' data points</div></div>' +
      '<div class="card"><h3>Post Queue</h3><div class="value">' + (q.posts || 0) + '</div><div class="sub">Target: 5+ minimum</div></div>' +
      '<div class="card"><h3>Comment Queue</h3><div class="value">' + (q.comments || 0) + '</div><div class="sub">Drains every 20min</div></div>';

    // Karma chart
    var series = data.karma_series || [];
    if (series.length > 2) {
      var canvas = document.getElementById('moltbook-karma-chart');
      var ctx = canvas.getContext('2d');
      var W = canvas.width = canvas.parentElement.clientWidth - 32;
      var H = canvas.height = 250;
      var pad = {t: 20, r: 20, b: 40, l: 60};
      var cw = W - pad.l - pad.r;
      var ch = H - pad.t - pad.b;

      var vals = series.map(function(s) { return s.v; });
      var minV = Math.min.apply(null, vals) - 20;
      var maxV = Math.max.apply(null, vals) + 20;
      var rangeV = maxV - minV || 1;

      ctx.clearRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = 'rgba(48,54,61,0.8)';
      ctx.lineWidth = 1;
      var gridLines = 5;
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillStyle = '#8b949e';
      ctx.textAlign = 'right';
      for (var i = 0; i <= gridLines; i++) {
        var y = pad.t + (ch / gridLines) * i;
        var val = Math.round(maxV - (rangeV / gridLines) * i);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
        ctx.fillText(val, pad.l - 8, y + 4);
      }

      // Data line
      ctx.strokeStyle = '#58a6ff';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      series.forEach(function(pt, i) {
        var x = pad.l + (i / (series.length - 1)) * cw;
        var vy = pad.t + ch - ((pt.v - minV) / rangeV) * ch;
        if (i === 0) ctx.moveTo(x, vy); else ctx.lineTo(x, vy);
      });
      ctx.stroke();

      // Fill
      var lastX = pad.l + cw;
      var lastY = pad.t + ch - ((series[series.length-1].v - minV) / rangeV) * ch;
      ctx.lineTo(lastX, pad.t + ch);
      ctx.lineTo(pad.l, pad.t + ch);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
      grad.addColorStop(0, 'rgba(88,166,255,0.3)');
      grad.addColorStop(1, 'rgba(88,166,255,0.02)');
      ctx.fillStyle = grad;
      ctx.fill();

      // X-axis labels
      ctx.fillStyle = '#8b949e';
      ctx.textAlign = 'center';
      ctx.font = '10px -apple-system, sans-serif';
      [0, Math.floor(series.length/2), series.length-1].forEach(function(idx) {
        var x = pad.l + (idx / (series.length - 1)) * cw;
        var label = series[idx].t.replace('T', ' ').slice(5, 16);
        ctx.fillText(label, x, H - 8);
      });

      // Current value dot
      ctx.fillStyle = '#58a6ff';
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Heatmap
    var heatmap = document.getElementById('moltbook-heatmap');
    if (series.length > 10) {
      var hourly = {};
      for (var j = 1; j < series.length; j++) {
        var hour = series[j].t.slice(11, 13);
        if (!hour) continue;
        var delta = series[j].v - series[j-1].v;
        if (!hourly[hour]) hourly[hour] = {total: 0, count: 0};
        hourly[hour].total += delta;
        hourly[hour].count++;
      }
      var hmHtml = '<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:4px;">';
      for (var h = 0; h < 24; h++) {
        var hStr = String(h).padStart(2, '0');
        var d = hourly[hStr];
        var avg = d ? Math.round(d.total / d.count) : 0;
        var intensity = Math.min(Math.max(avg / 15, 0), 1);
        var color = avg > 0
          ? 'rgba(63,185,80,' + (0.15 + intensity * 0.7) + ')'
          : avg < 0
            ? 'rgba(248,81,73,' + (0.15 + Math.abs(avg/15) * 0.7) + ')'
            : 'rgba(48,54,61,0.5)';
        hmHtml += '<div style="background:' + color + ';border-radius:4px;padding:6px 2px;text-align:center;font-size:11px;" title="' + hStr + ':00 \u2014 avg +' + avg + '/interval"><div style="font-weight:600">' + hStr + '</div><div style="font-size:10px;color:var(--text2)">+' + avg + '</div></div>';
      }
      hmHtml += '</div>';
      heatmap.innerHTML = hmHtml;
    } else {
      heatmap.innerHTML = '<div style="color:var(--text2);font-size:13px">Not enough data for heatmap yet</div>';
    }

    // System status
    var status = document.getElementById('moltbook-status');
    var solverFails = (data.solver && data.solver.total_failures) || 0;
    status.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;"><span>Solver Failures</span><span style="color:' + (solverFails > 10 ? 'var(--orange)' : 'var(--green)') + '; font-weight:600">' + solverFails + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;"><span>Post Queue</span><span style="color:' + ((q.posts||0) < 3 ? 'var(--orange)' : 'var(--green)') + '; font-weight:600">' + (q.posts || 0) + ' queued</span></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;"><span>Comment Queue</span><span style="color:' + ((q.comments||0) < 1 ? 'var(--orange)' : 'var(--green)') + '; font-weight:600">' + (q.comments || 0) + ' queued</span></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;"><span>Data Points</span><span style="font-weight:600">' + (s.data_points || 0) + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;"><span>Tracking Since</span><span style="font-size:12px;color:var(--text2)">' + (s.first_ts || '').slice(0,10) + '</span></div></div>';

    // Analysis
    var analysisEl = document.getElementById('moltbook-analysis');
    var analysisSection = document.getElementById('moltbook-analysis-section');
    if (data.engagement && data.engagement.analysis) {
      analysisEl.textContent = data.engagement.analysis;
      analysisSection.style.display = 'block';
    }
    Hub.setRefreshState('moltbook', 'done');
  }
};
