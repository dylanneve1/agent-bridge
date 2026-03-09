// ── Report Module ────────────────────────────────
Hub.report = (function() {
  var searchTimeout = null;
  var searchMatches = [];
  var searchIdx = -1;

  function mdToHtml(md) {
    var html = md;
    var codeBlocks = [];
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code class="lang-' + lang + '">' + code.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code></pre>');
      return '%%CODEBLOCK_' + idx + '%%';
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^#### (.+)$/gm, '<h4 id="$1">$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3 id="$1">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 id="$1">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 id="$1">$1</h1>');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^---+$/gm, '<hr>');
    html = html.replace(/^(\s*)[-*] (.+)$/gm, '$1<li>$2</li>');
    html = html.replace(/^(\s*)\d+\. (.+)$/gm, '$1<li>$2</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, function(m) { return '<ul>' + m + '</ul>'; });
    html = html.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, function(_, hdr, body) {
      var headers = hdr.split('|').map(function(h) { return '<th>' + h.trim() + '</th>'; }).join('');
      var rows = body.trim().split('\n').map(function(row) {
        var cells = row.replace(/^\||\|$/g, '').split('|').map(function(c) { return '<td>' + c.trim() + '</td>'; }).join('');
        return '<tr>' + cells + '</tr>';
      }).join('');
      return '<table><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>';
    });
    html = html.split('\n').map(function(line) {
      var trimmed = line.trim();
      if (!trimmed) return '';
      if (/^<(h[1-4]|ul|ol|li|blockquote|pre|hr|table|thead|tbody|tr|th|td|div)/.test(trimmed)) return line;
      if (/^%%CODEBLOCK_\d+%%$/.test(trimmed)) return line;
      return '<p>' + line + '</p>';
    }).join('\n');
    codeBlocks.forEach(function(block, i) {
      html = html.replace('%%CODEBLOCK_' + i + '%%', block);
    });
    html = html.replace(/<p>\s*<\/p>/g, '');
    return html;
  }

  function highlightTextNodes(el, regex) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(function(node) {
      if (node.parentElement && node.parentElement.tagName === 'MARK') return;
      var text = node.textContent;
      if (!regex.test(text)) return;
      regex.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var lastIdx = 0;
      var match;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
        var mark = document.createElement('mark');
        mark.className = 'report-highlight';
        mark.textContent = match[0];
        frag.appendChild(mark);
        lastIdx = regex.lastIndex;
      }
      if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function clearHighlights(body) {
    body.querySelectorAll('mark.report-highlight').forEach(function(mark) {
      var parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }

  function doSearch() {
    var query = (document.getElementById('report-search-input') ? document.getElementById('report-search-input').value : '').trim();
    var body = document.querySelector('.report-body');
    if (!body) return;

    clearHighlights(body);
    searchMatches = [];
    searchIdx = -1;

    var info = document.getElementById('report-match-info');
    if (!query || query.length < 2) {
      if (info) info.textContent = '';
      return;
    }

    var regex = new RegExp(Hub.escapeRegex(query), 'gi');
    highlightTextNodes(body, regex);

    searchMatches = Array.from(body.querySelectorAll('mark.report-highlight'));
    if (info) {
      info.textContent = searchMatches.length > 0
        ? searchMatches.length + ' match' + (searchMatches.length === 1 ? '' : 'es')
        : 'No matches';
    }

    if (searchMatches.length > 0) {
      searchIdx = 0;
      activateMatch();
    }
  }

  function activateMatch() {
    var m = searchMatches[searchIdx];
    if (!m) return;
    m.classList.add('active');
    m.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var info = document.getElementById('report-match-info');
    if (info) info.textContent = (searchIdx + 1) + '/' + searchMatches.length;
  }

  return {
    refresh: async function() {
      Hub.setRefreshState('report', 'loading');
      var el = document.getElementById('report-content');
      el.innerHTML = '<div class="section"><div class="skeleton skeleton-line w80 h32" style="margin-bottom:16px"></div><div class="skeleton skeleton-line w100" style="height:200px"></div></div>';

      var data = await Hub.api('/report');
      if (!data || data.error) {
        el.innerHTML = '<div class="section"><h2>Report not available</h2><p style="color:var(--text2)">The interop report has not been generated yet.</p></div>';
        Hub.setRefreshState('report', 'done');
        return;
      }

      var modified = new Date(data.last_modified);
      var modStr = modified.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) +
                   ' ' + modified.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      var toc = data.sections.map(function(s) {
        var id = s.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        return '<a href="#" onclick="event.preventDefault();document.getElementById(\'' + id + '\')?.scrollIntoView({behavior:\'smooth\',block:\'start\'})">' + s + '</a>';
      }).join('');

      el.innerHTML = '<div class="report-meta">' +
        '<div class="stat"><div class="label">Words</div><div class="val">' + data.word_count.toLocaleString() + '</div></div>' +
        '<div class="stat"><div class="label">Sections</div><div class="val">' + data.sections.length + '</div></div>' +
        '<div class="stat"><div class="label">Lines</div><div class="val">' + data.line_count.toLocaleString() + '</div></div>' +
        '<div class="stat"><div class="label">Last Updated</div><div class="val" style="font-size:14px">' + modStr + '</div></div></div>' +
        '<div class="report-toc"><h3>Table of Contents</h3>' + toc + '</div>' +
        '<div class="report-body">' + mdToHtml(data.content) + '</div>';

      el.querySelectorAll('.report-body h2').forEach(function(h) {
        h.id = h.textContent.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      });

      var searchBar = document.getElementById('report-search-bar');
      if (searchBar) searchBar.style.display = 'flex';

      Hub.setRefreshState('report', 'done');
    },
    searchDebounced: function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(doSearch, 250);
    },
    searchNav: function(dir) {
      if (searchMatches.length === 0) return;
      if (searchMatches[searchIdx]) searchMatches[searchIdx].classList.remove('active');
      searchIdx = (searchIdx + dir + searchMatches.length) % searchMatches.length;
      activateMatch();
    },
    clearSearch: function() {
      var input = document.getElementById('report-search-input');
      if (input) input.value = '';
      var body = document.querySelector('.report-body');
      if (body) clearHighlights(body);
      searchMatches = [];
      searchIdx = -1;
      var info = document.getElementById('report-match-info');
      if (info) info.textContent = '';
    }
  };
})();

window.reportSearchDebounced = function() { Hub.report.searchDebounced(); };
window.reportSearchNav = function(d) { Hub.report.searchNav(d); };
window.clearReportSearch = function() { Hub.report.clearSearch(); };
