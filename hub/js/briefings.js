// ── Briefings Module ─────────────────────────────
Hub.briefings = {
  _data: null,
  _selected: null,

  refresh: async function() {
    Hub.setRefreshState('briefings', 'loading');
    var el = document.getElementById('briefings-content');
    el.innerHTML = '<div class="section"><h2>Loading\u2026</h2></div>';

    var data = await Hub.api('/briefings');
    if (!data || !data.briefings) {
      el.innerHTML = '<div class="section"><h2>Unable to load briefings</h2></div>';
      Hub.setRefreshState('briefings', 'done');
      return;
    }

    this._data = data.briefings;
    this.renderList(el);
    Hub.setRefreshState('briefings', 'done');
  },

  renderList: function(el) {
    var briefings = this._data;
    if (!briefings.length) {
      el.innerHTML = '<div class="section"><h2>No briefings yet</h2><p style="color:var(--text2)">Daily briefings are generated at 08:00 UTC. Check back tomorrow morning.</p></div>';
      return;
    }

    var html = '<div class="section"><h2>\u2600\ufe0f Daily Briefings</h2>' +
      '<p style="color:var(--text2);margin-bottom:16px">' + briefings.length + ' briefing' + (briefings.length !== 1 ? 's' : '') + ' archived</p>';

    // KPI cards
    var latest = briefings[0];
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var latestDate = new Date(latest.date + 'T00:00:00Z');
    var dayName = days[latestDate.getUTCDay()];

    html += '<div class="kpi-cards" style="margin-bottom:20px">' +
      '<div class="kpi-card"><div class="kpi-value">' + briefings.length + '</div><div class="kpi-label">Total</div></div>' +
      '<div class="kpi-card"><div class="kpi-value">' + dayName + '</div><div class="kpi-label">Latest</div></div>' +
      '<div class="kpi-card"><div class="kpi-value">' + latest.date + '</div><div class="kpi-label">Most Recent</div></div>' +
      '</div>';

    // Briefing list
    html += '<div class="briefing-list">';
    for (var i = 0; i < briefings.length; i++) {
      var b = briefings[i];
      var d = new Date(b.date + 'T00:00:00Z');
      var dName = days[d.getUTCDay()];
      var sizeKb = (b.size / 1024).toFixed(1);
      html += '<div class="briefing-item" onclick="Hub.briefings.loadBriefing(\'' + b.date + '\')" style="cursor:pointer">' +
        '<div class="briefing-item-header">' +
        '<span class="briefing-date">\u2600\ufe0f ' + dName + ', ' + b.date + '</span>' +
        '<span class="briefing-size" style="color:var(--text2);font-size:0.85em">' + sizeKb + ' KB</span>' +
        '</div>' +
        (b.preview ? '<div class="briefing-preview" style="color:var(--text2);font-size:0.9em;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + Hub.esc(b.preview) + '</div>' : '') +
        '</div>';
    }
    html += '</div></div>';

    el.innerHTML = html;
  },

  loadBriefing: async function(date) {
    var el = document.getElementById('briefings-content');
    el.innerHTML = '<div class="section"><h2>Loading briefing\u2026</h2></div>';

    var data = await Hub.api('/briefings/' + date);
    if (!data || !data.content) {
      el.innerHTML = '<div class="section"><h2>Briefing not found</h2></div>';
      return;
    }

    this._selected = date;
    this.renderDetail(el, data);
  },

  renderDetail: function(el, data) {
    var html = '<div class="section">' +
      '<div style="margin-bottom:16px">' +
      '<button class="briefing-back" onclick="Hub.briefings.renderList(document.getElementById(\'briefings-content\'))" style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text1);padding:6px 14px;cursor:pointer;font-size:0.9em">\u2190 All briefings</button>' +
      '</div>' +
      '<h2>\u2600\ufe0f Briefing — ' + Hub.esc(data.date) + '</h2>' +
      '<p style="color:var(--text2);font-size:0.85em;margin-bottom:16px">Generated ' + new Date(data.generated).toLocaleString() + ' \u00b7 ' + (data.size / 1024).toFixed(1) + ' KB</p>' +
      '<div class="briefing-body">' + this.renderMarkdown(data.content) + '</div>' +
      '</div>';
    el.innerHTML = html;
  },

  renderMarkdown: function(md) {
    // Lightweight markdown → HTML for briefing content
    var lines = md.split('\n');
    var html = '';
    var inList = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Headers
      if (line.match(/^### /)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h4 style="color:var(--accent);margin-top:16px">' + Hub.esc(line.slice(4)) + '</h4>';
      } else if (line.match(/^## /)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h3 style="color:var(--text1);margin-top:20px">' + Hub.esc(line.slice(3)) + '</h3>';
      } else if (line.match(/^# /)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h2>' + Hub.esc(line.slice(2)) + '</h2>';
      }
      // List items
      else if (line.match(/^\s*[\u2022\-\*]\s/)) {
        if (!inList) { html += '<ul style="margin:4px 0;padding-left:20px">'; inList = true; }
        var text = line.replace(/^\s*[\u2022\-\*]\s/, '');
        html += '<li>' + this.inlineFormat(text) + '</li>';
      }
      // Horizontal rule
      else if (line.match(/^---+$/)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0">';
      }
      // Empty line
      else if (line.trim() === '') {
        if (inList) { html += '</ul>'; inList = false; }
      }
      // Regular paragraph
      else {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p style="margin:6px 0;line-height:1.6">' + this.inlineFormat(line) + '</p>';
      }
    }
    if (inList) html += '</ul>';
    return html;
  },

  inlineFormat: function(text) {
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text1)">$1</strong>');
    // Italic / underscore wrapping
    text = text.replace(/_(.+?)_/g, '<em style="color:var(--text2)">$1</em>');
    // Emoji shortcodes left as-is (they're already unicode)
    // Inline code
    text = text.replace(/`(.+?)`/g, '<code style="background:var(--bg2);padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>');
    return text;
  }
};

Hub.register('briefings', Hub.briefings);
