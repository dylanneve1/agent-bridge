// ── Board Module ─────────────────────────────────
Hub.board = (function() {
  var boardDataCache = null;
  var boardFilter = 'all';

  function renderBoard() {
    if (!boardDataCache) return;
    var data = boardDataCache;
    var cols = document.getElementById('board-columns');
    var searchTerm = (document.getElementById('board-search') ? document.getElementById('board-search').value : '').toLowerCase().trim();

    var order = ['open', 'claimed', 'in_progress', 'done', 'blocked'];
    var colors = { open: 'blue', claimed: 'orange', in_progress: 'purple', done: 'green', blocked: 'red' };
    var labels = { open: 'Open', claimed: 'Claimed', in_progress: 'In Progress', done: 'Done', blocked: 'Blocked' };

    var totalVisible = 0;
    var totalAll = 0;

    var html = order.filter(function(s) {
      if (boardFilter !== 'all' && boardFilter !== s) return false;
      return (data[s] && data[s].length > 0) || s !== 'blocked';
    }).map(function(status) {
      var tasks = data[status] || [];
      totalAll += tasks.length;
      if (searchTerm) {
        tasks = tasks.filter(function(t) {
          var hay = [t.title, t.assigned_to, t.priority].concat(t.tags || []).filter(Boolean).join(' ').toLowerCase();
          return hay.indexOf(searchTerm) !== -1;
        });
      }
      totalVisible += tasks.length;
      return '<div class="board-col"><div class="board-col-header"><span>' + labels[status] + '</span><span class="count">' + tasks.length + '</span></div>' +
        (tasks.length === 0 ? '<div style="color:var(--text2);font-size:13px;text-align:center;padding:12px;">No matching tasks</div>' : '') +
        tasks.map(function(t) {
          return '<div class="task-card" data-status="' + status + '"><div class="title">' + Hub.escHtml(t.title) + '</div><div class="meta">' +
            (t.assigned_to ? '<span class="badge badge-' + colors[status] + '">' + t.assigned_to + '</span>' : '') +
            (t.priority ? '<span class="badge badge-' + (t.priority === 'urgent' ? 'red' : 'blue') + '">' + t.priority + '</span>' : '') +
            (t.tags || []).map(function(tag) { return '<span class="badge badge-purple">' + tag + '</span>'; }).join('') +
            '</div></div>';
        }).join('') + '</div>';
    }).join('');

    cols.innerHTML = html;

    var countEl = document.getElementById('board-result-count');
    if (searchTerm || boardFilter !== 'all') {
      countEl.textContent = 'Showing ' + totalVisible + ' of ' + totalAll + ' tasks';
    } else {
      countEl.textContent = '';
    }
  }

  return {
    refresh: async function() {
      Hub.setRefreshState('board', 'loading');
      var cols = document.getElementById('board-columns');
      cols.innerHTML = Hub.skeletonBoardCols(4);

      var data = await Hub.api('/board');
      if (!data || !data.board) { cols.innerHTML = '<div class="loading">Unable to load board</div>'; Hub.setRefreshState('board', 'done'); return; }

      boardDataCache = data.board;
      renderBoard();
      Hub.setRefreshState('board', 'done');
    },
    filter: function() { renderBoard(); },
    setFilter: function(filter, el) {
      boardFilter = filter;
      document.querySelectorAll('#board-filters .filter-chip').forEach(function(c) { c.classList.remove('active'); });
      el.classList.add('active');
      renderBoard();
    }
  };
})();

window.filterBoard = function() { Hub.board.filter(); };
window.setBoardFilter = function(f, el) { Hub.board.setFilter(f, el); };
