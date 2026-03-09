// ── Repos Module ─────────────────────────────────
Hub.repos = (function() {
  var currentRepo = null;
  var lastRepoData = null;

  async function selectRepo(name) {
    currentRepo = name;
    document.querySelectorAll('.repo-tab').forEach(function(t) {
      t.classList.remove('active');
      if (t.getAttribute('onclick') && t.getAttribute('onclick').indexOf(name) !== -1) t.classList.add('active');
    });

    closeFileViewer();

    var results = await Promise.all([
      Hub.api('/git/repos/' + name + '/tree'),
      Hub.api('/git/repos/' + name + '/log')
    ]);
    var tree = results[0], log = results[1];

    lastRepoData = { name: name, tree: tree, log: log, exportedAt: new Date().toISOString() };
    document.getElementById('repo-title').textContent = '\ud83d\udcc1 ' + name;

    var fileTree = document.getElementById('file-tree');
    if (tree && tree.files) {
      var dirs = {};
      tree.files.forEach(function(f) {
        var parts = f.path.split('/');
        var dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
        if (!dirs[dir]) dirs[dir] = [];
        dirs[dir].push(f);
      });

      var html = '';
      Object.keys(dirs).sort().forEach(function(dir) {
        if (dir) html += '<li style="background:var(--bg2);font-weight:600;color:var(--accent);cursor:default"><span class="icon">\ud83d\udcc2</span> ' + dir + '/</li>';
        dirs[dir].sort(function(a, b) { return a.path.localeCompare(b.path); });
        dirs[dir].forEach(function(f) {
          var fname = f.path.split('/').pop();
          var ext = fname.split('.').pop();
          var icon = { py: '\ud83d\udc0d', js: '\ud83d\udcdc', md: '\ud83d\udcc4', json: '\ud83d\udccb', sh: '\u26a1', txt: '\ud83d\udcc4' }[ext] || '\ud83d\udcc4';
          html += '<li onclick="Hub.repos.viewFile(\'' + name + '\', \'' + f.path + '\')"><span class="icon">' + icon + '</span> ' + fname + '<span class="size">' + Hub.formatSize(f.size) + '</span></li>';
        });
      });
      fileTree.innerHTML = html;
    }

    var tbody = document.querySelector('#commit-table tbody');
    if (log && log.commits) {
      document.getElementById('commit-count').textContent = log.commits.length + ' commits';
      tbody.innerHTML = log.commits.map(function(c) {
        var filesCount = c.files ? c.files.length : 0;
        var ts = c.created_at ? new Date(c.created_at * 1000).toLocaleDateString() : '';
        return '<tr style="cursor:pointer" onclick="Hub.repos.showDiff(\'' + name + '\', \'' + c.id + '\')" title="Click to view diff">' +
          '<td><span class="badge ' + (c.author === 'Claudius' ? 'badge-purple' : 'badge-green') + '">' + c.author + '</span></td>' +
          '<td><span>' + Hub.escHtml(c.message) + '</span><span style="float:right;font-size:11px;color:var(--text2)">' + (filesCount ? filesCount + ' file' + (filesCount > 1 ? 's' : '') : '') + ' ' + ts + '</span></td></tr>';
      }).join('');
    }
  }

  async function viewFile(repo, path) {
    var data = await Hub.api('/git/repos/' + repo + '/files/' + path);
    if (!data || !data.content) return;
    document.getElementById('file-tree').style.display = 'none';
    document.getElementById('commit-log-section').style.display = 'none';
    document.getElementById('file-viewer-header').style.display = 'flex';
    document.getElementById('file-viewer').style.display = 'block';
    document.getElementById('file-path').textContent = path;
    document.getElementById('file-viewer').textContent = data.content;
  }

  function closeFileViewer() {
    document.getElementById('file-tree').style.display = '';
    document.getElementById('commit-log-section').style.display = '';
    document.getElementById('file-viewer-header').style.display = 'none';
    document.getElementById('file-viewer').style.display = 'none';
  }

  function parseDiff(diffText, action) {
    var lines = (diffText || '').split('\n');
    var additions = 0, deletions = 0;
    var parsed = [];
    var oldLn = 0, newLn = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.startsWith('@@')) {
        var m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
        if (m) {
          oldLn = parseInt(m[1], 10);
          newLn = parseInt(m[2], 10);
          parsed.push({ type: 'hunk', text: line });
        }
        continue;
      }
      if (line.startsWith('---') || line.startsWith('+++')) continue;
      if (line.startsWith('(new file') || line.startsWith('(file deleted')) {
        parsed.push({ type: 'info', text: line });
        continue;
      }
      if (line.startsWith('+')) {
        additions++;
        parsed.push({ type: 'add', oldLn: null, newLn: newLn++, text: line.slice(1) });
      } else if (line.startsWith('-')) {
        deletions++;
        parsed.push({ type: 'del', oldLn: oldLn++, newLn: null, text: line.slice(1) });
      } else if (line.startsWith(' ')) {
        parsed.push({ type: 'ctx', oldLn: oldLn++, newLn: newLn++, text: line.slice(1) });
      } else if (line.length > 0) {
        parsed.push({ type: 'ctx', oldLn: null, newLn: null, text: line });
      }
    }
    return { lines: parsed, additions: additions, deletions: deletions };
  }

  function renderDiffFile(d, idx) {
    var icon = d.action === 'add' ? '\ud83d\udfe2' : d.action === 'delete' ? '\ud83d\udd34' : '\ud83d\udfe1';
    var label = d.action === 'add' ? 'new file' : d.action === 'delete' ? 'deleted' : 'modified';
    var lines = d.parsed.lines, additions = d.parsed.additions, deletions = d.parsed.deletions;

    var tableRows = '';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.type === 'hunk') {
        tableRows += '<tr class="diff-line-hunk"><td colspan="4">' + Hub.escHtml(l.text) + '</td></tr>';
      } else if (l.type === 'info') {
        tableRows += '<tr class="diff-line-hunk"><td colspan="4" style="text-align:center">' + Hub.escHtml(l.text) + '</td></tr>';
      } else {
        var cls = l.type === 'add' ? 'diff-line-add' : l.type === 'del' ? 'diff-line-del' : '';
        var sign = l.type === 'add' ? '+' : l.type === 'del' ? '\u2212' : ' ';
        tableRows += '<tr class="' + cls + '"><td class="ln">' + (l.oldLn != null ? l.oldLn : '') + '</td><td class="ln">' + (l.newLn != null ? l.newLn : '') + '</td><td class="sign">' + sign + '</td><td class="code">' + Hub.escHtml(l.text) + '</td></tr>';
      }
    }

    if (lines.length === 0) {
      tableRows = '<tr class="diff-line-hunk"><td colspan="4" style="text-align:center;padding:20px">' + label + ' \u2014 ' + (d.action === 'add' ? 'content stored in repository' : 'file removed') + '</td></tr>';
    }

    return '<div class="diff-file-section" id="diff-file-' + idx + '">' +
      '<div class="diff-file-header">' + icon + ' <span>' + Hub.escHtml(d.path) + '</span>' +
      '<span class="badge badge-' + (d.action === 'add' ? 'green' : d.action === 'delete' ? 'red' : 'orange') + '" style="margin-left:8px">' + label + '</span>' +
      (additions || deletions ? '<span class="diff-stat"><span class="diff-stat-add">+' + additions + '</span> <span class="diff-stat-del">\u2212' + deletions + '</span></span>' : '') +
      '</div><table class="diff-table"><tbody>' + tableRows + '</tbody></table></div>';
  }

  async function showDiff(repoName, commitId) {
    var data = await Hub.api('/git/repos/' + repoName + '/diff/' + commitId);
    if (!data || !data.commit) return;

    var commit = data.commit;
    var diffs = data.diffs || [];
    var ts = commit.created_at ? new Date(commit.created_at * 1000).toLocaleString() : '';

    var totalAdd = 0, totalDel = 0;
    var parsedDiffs = diffs.map(function(d) {
      var parsed = parseDiff(d.diff, d.action);
      totalAdd += parsed.additions;
      totalDel += parsed.deletions;
      return Object.assign({}, d, { parsed: parsed });
    });

    var overlay = document.createElement('div');
    overlay.className = 'diff-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var modal = document.createElement('div');
    modal.className = 'diff-modal';

    modal.innerHTML = '<div class="diff-header"><div class="diff-header-info"><div class="diff-title">' + Hub.escHtml(commit.message) + '</div>' +
      '<div class="diff-meta"><span class="badge ' + (commit.author === 'Claudius' ? 'badge-purple' : 'badge-green') + '">' + commit.author + '</span>' +
      '<span>' + ts + '</span><span>' + parsedDiffs.length + ' file' + (parsedDiffs.length !== 1 ? 's' : '') + ' changed</span>' +
      '<span class="diff-stat-add">+' + totalAdd + '</span><span class="diff-stat-del">\u2212' + totalDel + '</span></div></div>' +
      '<button class="diff-close" onclick="this.closest(\'.diff-overlay\').remove()">\u2715</button></div>' +
      (parsedDiffs.length > 1 ? '<div class="diff-file-list">' + parsedDiffs.map(function(d, i) {
        return '<div class="diff-file-tab ' + (i === 0 ? 'active' : '') + '" onclick="Hub.repos.scrollToDiffFile(' + i + ', this)"><span class="action-dot ' + d.action + '"></span>' + d.path.split('/').pop() + '</div>';
      }).join('') + '</div>' : '') +
      '<div class="diff-body">' + parsedDiffs.map(function(d, i) { return renderDiffFile(d, i); }).join('') + '</div>' +
      '<div class="diff-summary"><span>' + parsedDiffs.length + ' file' + (parsedDiffs.length !== 1 ? 's' : '') + ' changed</span>' +
      '<span class="diff-stat-add">+' + totalAdd + ' additions</span><span class="diff-stat-del">\u2212' + totalDel + ' deletions</span></div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var handler = function(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); }
    };
    document.addEventListener('keydown', handler);
  }

  return {
    refresh: async function() {
      Hub.setRefreshState('repos', 'loading');
      var data = await Hub.api('/git/repos');
      var tabs = document.getElementById('repo-tabs');
      if (!data || !data.repos || !data.repos.length) { tabs.innerHTML = '<div class="loading">No repos</div>'; Hub.setRefreshState('repos', 'done'); return; }

      tabs.innerHTML = data.repos.map(function(r) {
        return '<div class="repo-tab ' + (r.name === currentRepo ? 'active' : '') + '" onclick="Hub.repos.selectRepo(\'' + r.name + '\')">' + r.name + ' <span style="color:var(--text2);font-size:11px">(' + r.commit_count + ' commits)</span></div>';
      }).join('');

      if (!currentRepo) currentRepo = data.repos[0].name;
      selectRepo(currentRepo);
      Hub.setRefreshState('repos', 'done');
    },
    selectRepo: selectRepo,
    viewFile: viewFile,
    showDiff: showDiff,
    scrollToDiffFile: function(idx, tabEl) {
      tabEl.parentElement.querySelectorAll('.diff-file-tab').forEach(function(t) { t.classList.remove('active'); });
      tabEl.classList.add('active');
      var section = document.getElementById('diff-file-' + idx);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    exportJSON: async function() {
      if (!currentRepo) { Hub.showToast('Select a repo first'); return; }
      Hub.showToast('Preparing export\u2026');
      var results = await Promise.all([
        Hub.api('/git/repos/' + currentRepo + '/tree'),
        Hub.api('/git/repos/' + currentRepo + '/log'),
        Hub.api('/git/repos')
      ]);
      var tree = results[0], log = results[1], reposData = results[2];
      var repoMeta = (reposData && reposData.repos) ? reposData.repos.find(function(r) { return r.name === currentRepo; }) || {} : {};
      var exportData = {
        _export: { source: 'Agent Hub Portal', repo: currentRepo, exportedAt: new Date().toISOString(), version: '1.0' },
        repository: Object.assign({ name: currentRepo }, repoMeta),
        files: (tree && tree.files) || [],
        commits: (log && log.commits) || []
      };
      var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = currentRepo + '-export-' + new Date().toISOString().slice(0,10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      Hub.showToast('Exported ' + currentRepo + ' (' + ((tree && tree.files) || []).length + ' files, ' + ((log && log.commits) || []).length + ' commits)');
    }
  };
})();

window.selectRepo = function(n) { Hub.repos.selectRepo(n); };
window.viewFile = function(r, p) { Hub.repos.viewFile(r, p); };
window.showDiff = function(r, c) { Hub.repos.showDiff(r, c); };
window.closeFileViewer = function() { document.getElementById('file-tree').style.display = ''; document.getElementById('commit-log-section').style.display = ''; document.getElementById('file-viewer-header').style.display = 'none'; document.getElementById('file-viewer').style.display = 'none'; };
window.scrollToDiffFile = function(i, el) { Hub.repos.scrollToDiffFile(i, el); };
window.exportRepoJSON = function() { Hub.repos.exportJSON(); };
