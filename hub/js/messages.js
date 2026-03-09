// ── Messages Module ──────────────────────────────
Hub.messages = (function() {
  var currentConv = null;

  async function selectConv(id) {
    currentConv = id;
    document.querySelectorAll('.conv-tab').forEach(function(t) {
      t.classList.remove('active');
      if (t.getAttribute('onclick') && t.getAttribute('onclick').indexOf(id) !== -1) t.classList.add('active');
    });

    var msgs = await Hub.api('/conversations/' + id + '/messages');
    var container = document.getElementById('msg-container');
    if (!Array.isArray(msgs) || !msgs.length) {
      container.innerHTML = '<div class="loading">No messages in this conversation</div>';
      return;
    }

    container.innerHTML = msgs.map(function(m) {
      return '<div class="msg ' + (m.from_agent ? 'from-' + m.from_agent.toLowerCase() : '') + '">' +
        '<div class="msg-header"><span class="msg-from">' + (m.from_agent || 'System') + '</span>' +
        '<span class="msg-time">' + (m.timestamp ? new Date(m.timestamp * 1000).toLocaleString() : '') + '</span></div>' +
        '<div class="msg-body">' + Hub.escHtml(m.content || '') + '</div></div>';
    }).join('');

    container.scrollTop = container.scrollHeight;
  }

  return {
    refresh: async function() {
      Hub.setRefreshState('messages', 'loading');
      document.getElementById('msg-container').innerHTML = Hub.skeletonMessages(5);

      var convos = await Hub.api('/conversations');
      var tabs = document.getElementById('conv-tabs');
      if (!convos || !convos.length) { tabs.innerHTML = '<div class="loading">No conversations</div>'; Hub.setRefreshState('messages', 'done'); return; }

      tabs.innerHTML = convos.map(function(c) {
        return '<div class="conv-tab ' + (c.id === currentConv ? 'active' : '') + '" onclick="Hub.messages.selectConv(\'' + c.id + '\')">' + c.name + '</div>';
      }).join('');

      if (!currentConv) currentConv = convos[0].id;
      selectConv(currentConv);
      Hub.setRefreshState('messages', 'done');
    },
    selectConv: selectConv
  };
})();

window.selectConv = function(id) { Hub.messages.selectConv(id); };
