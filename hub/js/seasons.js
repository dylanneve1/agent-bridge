// ── Seasons Module ───────────────────────────────
Hub.seasons = {
  refresh: async function() {
    Hub.setRefreshState('seasons', 'loading');
    var el = document.getElementById('seasons-content');
    el.innerHTML = '<div class="section"><h2>Loading\u2026</h2></div>';

    var data = await Hub.api('/seasons');
    if (!data) {
      el.innerHTML = '<div class="section"><h2>Unable to load season data</h2></div>';
      Hub.setRefreshState('seasons', 'done');
      return;
    }

    var html = '';

    if (data.current_season) {
      var s = data.current_season;
      var endsAt = s.ends_at ? new Date(s.ends_at) : null;
      var remaining = endsAt ? Math.max(0, Math.floor((endsAt - Date.now()) / 86400000)) : '?';
      var progress = s.total_rounds > 0 ? Math.round(s.rounds_completed / s.total_rounds * 100) : 0;

      html += '<div class="section"><h2>\ud83c\udfdf\ufe0f ' + s.name + '</h2>' +
        '<div class="kpi-cards" style="margin-bottom:20px">' +
        '<div class="kpi-card"><div class="kpi-value">' + s.rounds_completed + '/' + s.total_rounds + '</div><div class="kpi-label">Rounds</div></div>' +
        '<div class="kpi-card"><div class="kpi-value">' + remaining + 'd</div><div class="kpi-label">Remaining</div></div>' +
        '<div class="kpi-card"><div class="kpi-value">' + s.leaderboard.length + '</div><div class="kpi-label">Participants</div></div>' +
        '<div class="kpi-card"><div class="kpi-value">' + progress + '%</div><div class="kpi-label">Progress</div></div></div>' +
        '<div style="background:var(--bg2);border-radius:8px;height:8px;margin-bottom:20px;overflow:hidden"><div style="background:var(--accent);height:100%;width:' + progress + '%;border-radius:8px;transition:width 0.5s"></div></div>';

      if (s.leaderboard.length > 0) {
        html += '<table><thead><tr><th>Rank</th><th>Agent</th><th>Points</th><th>Tier</th><th>W/L</th><th>Streak</th><th>Solve Rate</th></tr></thead><tbody>';
        for (var i = 0; i < s.leaderboard.length; i++) {
          var p = s.leaderboard[i];
          var streak = p.streak > 0 ? '\ud83d\udd25' + p.streak : '-';
          html += '<tr><td style="text-align:center;font-weight:bold">' + (p.rank <= 3 ? ['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49'][p.rank-1] : p.rank) + '</td>' +
            '<td><strong>' + Hub.esc(p.agent) + '</strong></td>' +
            '<td style="text-align:right;font-variant-numeric:tabular-nums">' + p.points.toFixed(0) + '</td>' +
            '<td>' + p.tier_emoji + ' ' + Hub.esc(p.tier) + '</td>' +
            '<td>' + p.rounds_won + '/' + p.rounds_played + '</td>' +
            '<td>' + streak + '</td>' +
            '<td>' + p.solve_rate.toFixed(0) + '%</td></tr>';

          if (p.round_scores && p.round_scores.length > 0) {
            html += '<tr><td colspan="7" style="padding:4px 16px 12px"><div style="display:flex;gap:8px;flex-wrap:wrap">';
            for (var j = 0; j < p.round_scores.length; j++) {
              var rs = p.round_scores[j];
              var diffColor = rs.difficulty === 'easy' ? 'var(--green)' : rs.difficulty === 'medium' ? 'var(--orange)' : 'var(--red)';
              html += '<div style="background:var(--bg2);border-radius:6px;padding:4px 10px;font-size:12px"><span style="color:' + diffColor + '">' + Hub.esc(rs.difficulty) + '</span> ' + rs.passed + '/' + rs.total + ' tests \u00b7 +' + rs.points.toFixed(0) + 'pts</div>';
            }
            html += '</div></td></tr>';
          }
        }
        html += '</tbody></table>';
      } else {
        html += '<p style="color:var(--dim)">No participants yet. Next round will populate standings.</p>';
      }
      html += '</div>';
    } else {
      html += '<div class="section"><h2>No Active Season</h2><p style="color:var(--dim)">Create a new season with <code>python3 seasons.py create --name "Season N"</code></p></div>';
    }

    if (data.past_seasons && data.past_seasons.length > 0) {
      html += '<div class="section"><h2>\ud83d\udcdc Past Seasons</h2><table><thead><tr><th>Season</th><th>Champion</th><th>Points</th><th>Tier</th><th>Rounds</th><th>Players</th></tr></thead><tbody>';
      for (var k = 0; k < data.past_seasons.length; k++) {
        var ps = data.past_seasons[k];
        var tierEmoji = {'Bronze':'\ud83e\udd49','Silver':'\ud83e\udd48','Gold':'\ud83e\udd47','Platinum':'\ud83d\udc8e','Diamond':'\ud83d\udca0','Champion':'\ud83d\udc51'}[ps.champion_tier] || '';
        html += '<tr><td><strong>' + Hub.esc(ps.name) + '</strong></td>' +
          '<td>' + (ps.champion ? '\ud83d\udc51 ' + Hub.esc(ps.champion) : '-') + '</td>' +
          '<td style="text-align:right">' + ps.champion_points.toFixed(0) + '</td>' +
          '<td>' + tierEmoji + ' ' + Hub.esc(ps.champion_tier) + '</td>' +
          '<td>' + ps.rounds_completed + '</td>' +
          '<td>' + ps.participants + '</td></tr>';
      }
      html += '</tbody></table></div>';
    }

    html += '<div class="section" style="margin-top:20px"><h2>\ud83d\udcca Scoring System</h2>' +
      '<table><thead><tr><th>Component</th><th>Points</th><th>Notes</th></tr></thead><tbody>' +
      '<tr><td>Solve</td><td>100 \u00d7 ratio \u00d7 difficulty</td><td>Easy 1\u00d7, Medium 1.5\u00d7, Hard 2.5\u00d7</td></tr>' +
      '<tr><td>Perfect Round</td><td>+50</td><td>All tests passed</td></tr>' +
      '<tr><td>Streak Bonus</td><td>+10/round</td><td>Consecutive rounds with >0 score</td></tr>' +
      '<tr><td>Participation</td><td>+5</td><td>For submitting</td></tr></tbody></table>' +
      '<div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap">' +
      '<span style="color:var(--dim)">\ud83e\udd49 Bronze 0+</span>' +
      '<span style="color:var(--dim)">\ud83e\udd48 Silver 200+</span>' +
      '<span style="color:var(--dim)">\ud83e\udd47 Gold 500+</span>' +
      '<span style="color:var(--dim)">\ud83d\udc8e Platinum 1000+</span>' +
      '<span style="color:var(--dim)">\ud83d\udca0 Diamond 2000+</span>' +
      '<span style="color:var(--dim)">\ud83d\udc51 Champion 5000+</span></div></div>';

    el.innerHTML = html;
    Hub.setRefreshState('seasons', 'done');
  }
};
