document.addEventListener('DOMContentLoaded', () => {
  // ============================================
  // DOM ELEMENTS
  // ============================================
  const toggleBtn          = document.getElementById('toggleBtn');
  const statusIndicator    = document.getElementById('statusIndicator');
  const countEl            = document.getElementById('count');
  const cdpBtn             = document.getElementById('cdpBtn');
  const deepCaptureBtn     = document.getElementById('deepCaptureBtn');
  const fullPageBtn        = document.getElementById('fullPageBtn');
  const refreshBtn         = document.getElementById('refreshBtn');
  const exportBtn          = document.getElementById('exportBtn');
  const clearBtn           = document.getElementById('clearBtn');
  const cdpBanner          = document.getElementById('cdpBanner');
  const normalBanner       = document.getElementById('normalBanner');
  const dismissCdpBanner   = document.getElementById('dismissCdpBanner');
  const dismissNormalBanner= document.getElementById('dismissNormalBanner');
  const requestList        = document.getElementById('requestList');
  const snippetList        = document.getElementById('snippetList');
  const actionsList        = document.getElementById('actionsList');
  const requestsEmpty      = document.getElementById('requestsEmpty');
  const snippetsEmpty      = document.getElementById('snippetsEmpty');
  const actionsEmpty       = document.getElementById('actionsEmpty');
  const detailView         = document.getElementById('detailView');
  const detailTitle        = document.getElementById('detailTitle');
  const detailContent      = document.getElementById('detailContent');
  const closeDetail        = document.getElementById('closeDetail');
  const saveBtn            = document.getElementById('saveBtn');
  const replayBtn          = document.getElementById('replayBtn');
  const copyBtn            = document.getElementById('copyBtn');
  const tabs               = document.querySelectorAll('.tab');
  const filterBtns         = document.querySelectorAll('.filter-btn');
  const searchBox          = document.getElementById('searchBox');

  const panels = {
    requests: document.getElementById('requestsPanel'),
    snippets : document.getElementById('snippetsPanel'),
    actions  : document.getElementById('actionsPanel')
  };

  // ============================================
  // STATE
  // ============================================
  let isSniffing       = true;
  let deepCapture      = true;
  let currentRequests  = [];
  let filteredRequests = [];
  let currentSnippets  = [];
  let userActions      = [];
  let selectedRequest  = null;
  let selectedSnippet  = null;
  let activeFilter     = 'all';
  let searchQuery      = '';
  let activeReplayTab  = 'curl'; // for replay bundle tab state

  // ============================================
  // INIT
  // ============================================
  init();

  async function init() {
    const stored = await chrome.storage.local.get(['isSniffing', 'deepCapture']);
    isSniffing  = stored.isSniffing ?? true;
    deepCapture = stored.deepCapture ?? true;
    updateSniffingUI();
    updateDeepCaptureUI();

    await loadRequests();
    await loadSnippets();
    await loadUserActions();
    checkCDPStatus();

    // Live request updates from background
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'newRequest') { addRequest(msg.data); sendResponse({ received: true }); }
      return true;
    });

    // Filter buttons
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        applyFilters();
      });
    });

    // Search
    searchBox.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      applyFilters();
    });

    // CDP
    cdpBtn.addEventListener('click', toggleCDP);

    // Deep capture
    deepCaptureBtn.addEventListener('click', async () => {
      deepCapture = !deepCapture;
      await sendMessage({ action: 'setDeepCapture', enabled: deepCapture });
      updateDeepCaptureUI();
      showNotification(deepCapture ? '🌊 Deep capture ON' : '⚡ Deep capture OFF (faster)');
    });

    // Banners
    if (dismissCdpBanner)    dismissCdpBanner.addEventListener('click',    () => { cdpBanner.style.display = 'none'; });
    if (dismissNormalBanner) dismissNormalBanner.addEventListener('click', () => { normalBanner.style.display = 'none'; });

    // Full page
    fullPageBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('fullpage.html') });
    });
  }

  // ============================================
  // SNIFFING TOGGLE
  // ============================================
  toggleBtn.addEventListener('click', async () => {
    isSniffing = !isSniffing;
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (!tab.url?.startsWith('chrome://')) {
        chrome.tabs.sendMessage(tab.id, { action: 'setSniffingState', enabled: isSniffing }).catch(() => {});
      }
    }
    await chrome.storage.local.set({ isSniffing });
    updateSniffingUI();
    showNotification(isSniffing ? '✅ Capture enabled' : '⏸ Capture paused');
  });

  function updateSniffingUI() {
    if (isSniffing) {
      toggleBtn.textContent = '⏸ Normal';
      toggleBtn.className   = 'sniffing';
      statusIndicator.className = 'status-indicator active';
      if (normalBanner) normalBanner.style.display = 'none';
    } else {
      toggleBtn.textContent = '▶ Normal';
      toggleBtn.className   = 'paused';
      statusIndicator.className = 'status-indicator paused';
      if (normalBanner) normalBanner.style.display = 'block';
    }
  }

  function updateDeepCaptureUI() {
    deepCaptureBtn.textContent = deepCapture ? '🌊 Deep' : '⚡ Quick';
    deepCaptureBtn.title       = deepCapture ? 'Deep capture ON (response bodies via CDP)' : 'Deep capture OFF (faster, headers only)';
    deepCaptureBtn.classList.toggle('off', !deepCapture);
  }

  // ============================================
  // CDP TOGGLE
  // ============================================
  async function checkCDPStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const status = await sendMessage({ action: 'getCDPStatus', tabId: tab.id });
    if (status?.attached) {
      cdpBtn.textContent = '🔬 CDP: ON';
      cdpBtn.style.background = '#51cf66';
      if (cdpBanner) cdpBanner.style.display = 'block';
    } else {
      cdpBtn.textContent = '🔬 CDP';
      cdpBtn.style.background = '';
      if (cdpBanner) cdpBanner.style.display = 'none';
    }
  }

  async function toggleCDP() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
      alert('Cannot use CDP on browser internal pages.');
      return;
    }
    const status = await sendMessage({ action: 'getCDPStatus', tabId: tab.id });
    if (status?.attached) {
      await sendMessage({ action: 'detachCDP', tabId: tab.id });
      cdpBtn.textContent = '🔬 CDP';
      cdpBtn.style.background = '';
      if (cdpBanner) cdpBanner.style.display = 'none';
      showNotification('🔌 CDP detached');
    } else {
      const result = await sendMessage({ action: 'attachCDP', tabId: tab.id });
      if (result?.success) {
        cdpBtn.textContent = '🔬 CDP: ON';
        cdpBtn.style.background = '#51cf66';
        if (cdpBanner) cdpBanner.style.display = 'block';
        showNotification('🔬 CDP attached — deep capture enabled');
      } else {
        showNotification('❌ Failed to attach CDP: ' + (result?.error || 'Unknown error'));
      }
    }
  }

  // ============================================
  // TAB SWITCHING
  // ============================================
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.dataset.tab;
      Object.keys(panels).forEach(key => panels[key].classList.remove('active'));
      panels[tabName].classList.add('active');
      if (tabName === 'actions') loadUserActions();
    });
  });

  // ============================================
  // PHASE 6: FILTERING (extended)
  // ============================================
  function applyFilters() {
    filteredRequests = currentRequests.filter(req => {
      // Method/type filters
      if (activeFilter !== 'all') {
        if (activeFilter === 'websocket') {
          if (req.type !== 'websocket' && req.type !== 'websocket_message') return false;
        } else if (activeFilter === 'graphql') {
          if (!req.graphql?.isGraphQL) return false;
        } else if (activeFilter === 'mutation') {
          if (!req.tags?.includes('mutation')) return false;
        } else if (activeFilter === 'failed') {
          if (!req.tags?.includes('failed') && !(req.status >= 400)) return false;
        } else {
          if (req.method !== activeFilter) return false;
        }
      }
      // Search
      if (searchQuery && !matchesSearch(req, searchQuery)) return false;
      return true;
    });
    renderRequests();
  }

  function matchesSearch(req, query) {
    const q = query.toLowerCase();
    if (req.url?.toLowerCase().includes(q)) return true;
    if (req.method?.toLowerCase().includes(q)) return true;
    // GraphQL name / doc_id
    if (req.graphql?.friendlyName?.toLowerCase().includes(q)) return true;
    if (req.graphql?.doc_id?.toString().includes(q)) return true;
    if (req.requestHeaders && JSON.stringify(req.requestHeaders).toLowerCase().includes(q)) return true;
    if (req.requestBody  !== undefined && JSON.stringify(req.requestBody).toLowerCase().includes(q)) return true;
    if (req.responseBody !== undefined && JSON.stringify(req.responseBody).toLowerCase().includes(q)) return true;
    if (req.responseHeaders && JSON.stringify(req.responseHeaders).toLowerCase().includes(q)) return true;
    if (req.authTokens && JSON.stringify(req.authTokens).toLowerCase().includes(q)) return true;
    return false;
  }

  // ============================================
  // LOAD DATA
  // ============================================
  refreshBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && !tab.url?.startsWith('chrome://')) chrome.tabs.reload(tab.id);
  });

  exportBtn.addEventListener('click', async () => {
    const activeTabName = document.querySelector('.tab.active').dataset.tab;
    let data = [], filename = '';
    if (activeTabName === 'requests') {
      const r = await sendMessage({ action: 'getCapturedRequests' });
      data = r?.requests || [];
      filename = `api-sniffer-requests-${new Date().toISOString().slice(0,10)}.json`;
    } else if (activeTabName === 'snippets') {
      data = currentSnippets;
      filename = `api-sniffer-snippets-${new Date().toISOString().slice(0,10)}.json`;
    } else {
      showNotification('Nothing to export here'); return;
    }
    if (!data.length) { showNotification('❌ No data to export'); return; }
    downloadJSON({ exportedAt: new Date().toISOString(), total: data.length, data }, filename);
    showNotification(`📤 Exported ${data.length} items`);
  });

  clearBtn.addEventListener('click', async () => {
    const activeTabName = document.querySelector('.tab.active').dataset.tab;
    if (activeTabName === 'requests') {
      if (!confirm('Clear all captured requests?')) return;
      await sendMessage({ action: 'clearCapturedRequests' });
      currentRequests = []; filteredRequests = [];
      renderRequests(); showNotification('🗑 Cleared all requests');
    } else if (activeTabName === 'snippets') {
      if (!confirm('Clear all snippets?')) return;
      for (const s of currentSnippets) await sendMessage({ action: 'deleteSnippet', id: s.id });
      currentSnippets = []; renderSnippets(); showNotification('🗑 Cleared snippets');
    } else if (activeTabName === 'actions') {
      if (!confirm('Clear tracked actions?')) return;
      await sendMessage({ action: 'clearUserActions' });
      userActions = []; renderActions(); showNotification('🗑 Cleared actions');
    }
  });

  closeDetail.addEventListener('click', () => {
    detailView.classList.remove('visible');
    selectedRequest = null; selectedSnippet = null;
  });

  saveBtn.addEventListener('click', async () => {
    if (selectedRequest) {
      await sendMessage({ action: 'saveSnippet', data: { ...selectedRequest, name: selectedRequest.url } });
      await loadSnippets();
      detailView.classList.remove('visible');
      showNotification('💾 Snippet saved!');
    }
  });

  replayBtn.addEventListener('click', async () => {
    const data = selectedRequest || selectedSnippet;
    if (!data) return;
    showNotification('🔄 Replaying…');
    const result = await sendMessage({
      action: 'replaySnippet',
      data  : { url: data.url, method: data.method, body: data.requestBody || data.body, headers: data.requestHeaders }
    });
    if (result?.xssiWarning) {
      showNotification('⚠️ Replay sent — CSRF/session warning. Check detail view.');
    } else {
      showNotification(result?.success ? `✅ Replay: ${result.status}` : '❌ Replay failed: ' + (result?.error || '?'));
    }
  });

  copyBtn.addEventListener('click', async () => {
    const data = selectedRequest || selectedSnippet;
    if (!data) return;
    const curlCmd = data.replay?.curl || generateCurlCommand(data);
    try {
      await navigator.clipboard.writeText(curlCmd);
      showNotification('📋 cURL copied!');
    } catch (e) {
      fallbackCopy(curlCmd);
      showNotification('📋 cURL copied!');
    }
  });

  // ============================================
  // REQUESTS
  // ============================================
  async function loadRequests() {
    const result = await sendMessage({ action: 'getCapturedRequests' });
    currentRequests  = result?.requests || [];
    filteredRequests = [...currentRequests];
    renderRequests();
  }

  function addRequest(data) {
    currentRequests.unshift(data);
    if (currentRequests.length > 500) currentRequests.pop();
    applyFilters();
  }

  function renderRequests() {
    requestList.innerHTML = '';
    if (filteredRequests.length === 0) {
      requestsEmpty.style.display = 'block';
      countEl.textContent = searchQuery ? '0 matches' : '0';
      return;
    }
    requestsEmpty.style.display = 'none';
    countEl.textContent = searchQuery
      ? `${filteredRequests.length}/${currentRequests.length}`
      : currentRequests.length.toString();

    filteredRequests.forEach((req) => {
      const li = document.createElement('li');
      li.className = 'request-item';
      if (req.tags?.includes('mutation')) li.classList.add('is-mutation');
      else if (req.graphql?.isGraphQL)    li.classList.add('is-graphql');
      if (req.tags?.includes('failed') || req.status >= 400) li.classList.add('is-failed');

      const methodLabel = req.method || (req.type === 'websocket' ? 'WS' : 'GET');
      const hasAuth     = req.authTokens && Object.keys(req.authTokens).length > 0;
      const hasAction   = req.trigger?.lastAction;
      const duration    = req.duration || 0;
      const speedClass  = duration < 300 ? 'fast' : duration < 1000 ? 'medium' : 'slow';

      const gqlBadge    = req.graphql?.isGraphQL
        ? `<span class="tag-badge tag-${req.graphql.type === 'mutation' ? 'mutation' : 'graphql'}">${req.graphql.type === 'mutation' ? '🔥' : '🔷'}</span>`
        : '';

      li.innerHTML = `
        <span class="method ${methodLabel}">${methodLabel}</span>
        ${gqlBadge}
        <span class="url">${escapeHtml(truncateUrl(req.url, 50))}</span>
        <div class="meta">
          ${req.status ? `<span class="meta-item" style="color:${req.status >= 400 ? '#dc3545' : '#28a745'}">${req.status}</span>` : ''}
          ${req.graphql?.friendlyName ? `<span class="meta-item" style="background:#f3e5fb;color:#5a0080">${escapeHtml(req.graphql.friendlyName)}</span>` : ''}
          ${hasAuth ? '<span class="meta-item has-auth">🔑 Auth</span>' : ''}
          ${hasAction ? `<span class="meta-item has-action">👆 ${req.trigger.lastAction.type}</span>` : ''}
          ${duration ? `<span class="meta-item">⏱ ${duration}ms<span class="timing-badge ${speedClass}">${speedClass}</span></span>` : ''}
          <span class="meta-item">${formatTime(req.timestamp)}</span>
        </div>
      `;

      li.addEventListener('click', () => {
        document.querySelectorAll('.request-item').forEach(el => el.classList.remove('selected'));
        li.classList.add('selected');
        showRequestDetail(req);
      });

      requestList.appendChild(li);
    });
  }

  // ============================================
  // SNIPPETS
  // ============================================
  async function loadSnippets() {
    const result = await sendMessage({ action: 'getSnippets' });
    currentSnippets = result?.snippets || [];
    renderSnippets();
  }

  function renderSnippets() {
    snippetList.innerHTML = '';
    const filtered = searchQuery
      ? currentSnippets.filter(s => matchesSearch(s, searchQuery))
      : currentSnippets;

    if (!filtered.length) { snippetsEmpty.style.display = 'block'; return; }
    snippetsEmpty.style.display = 'none';

    filtered.forEach(snippet => {
      const li = document.createElement('li');
      li.className = 'snippet-item';
      li.innerHTML = `
        <span class="method ${snippet.method}">${snippet.method}</span>
        <span class="url">${escapeHtml(truncateUrl(snippet.url, 42))}</span>
        <div class="meta"><span class="meta-item">📅 ${formatDate(snippet.savedAt)}</span></div>
      `;
      li.addEventListener('click', () => showSnippetDetail(snippet));
      snippetList.appendChild(li);
    });
  }

  // ============================================
  // USER ACTIONS
  // ============================================
  async function loadUserActions() {
    const result = await sendMessage({ action: 'getUserActions' });
    userActions = result?.actions || [];
    renderActions();
  }

  function renderActions() {
    actionsList.innerHTML = '';
    if (!userActions.length) { actionsEmpty.style.display = 'block'; return; }
    actionsEmpty.style.display = 'none';
    [...userActions].reverse().forEach(action => {
      const li = document.createElement('li');
      li.className = 'action-item';
      li.innerHTML = `
        <span class="meta-item">👆 ${action.type.toUpperCase()}</span>
        <span class="url">${escapeHtml(action.selector || action.target)}</span>
        <div class="meta">
          <span class="meta-item">${formatTime(action.timestamp)}</span>
          ${action.text ? `<span class="meta-item">"${escapeHtml(action.text.substring(0, 30))}"</span>` : ''}
        </div>
      `;
      actionsList.appendChild(li);
    });
  }

  // ============================================
  // SHOW REQUEST DETAIL (Phases 1, 2, 3)
  // ============================================
  function showRequestDetail(req) {
    selectedRequest = req;
    selectedSnippet = null;

    const methodClass = req.method || 'GET';
    const isCDP  = req.type === 'cdp';
    const isGQL  = req.graphql?.isGraphQL;
    const isMut  = req.tags?.includes('mutation');

    detailTitle.innerHTML = `
      <span class="method ${methodClass}">${req.method || req.type}</span>
      ${isGQL ? `<span class="tag-badge tag-${isMut ? 'mutation' : 'graphql'}">${isMut ? '🔥 MUT' : '🔷 GQL'}</span>` : ''}
      ${isCDP ? '<span style="background:#6f42c1;color:white;padding:2px 6px;border-radius:3px;font-size:9px;margin-left:5px;">CDP</span>' : ''}
      ${escapeHtml(truncateUrl(req.url, 32))}
    `;

    let html = '';

    // ── Phase 1: GraphQL Info ──
    if (isGQL) {
      const gqlClass = isMut ? 'gql-highlight gql-mutation' : 'gql-highlight';
      html += `
        <div class="${gqlClass}">
          <strong>🔷 GraphQL ${isMut ? '🔥 MUTATION' : 'Query'}${req.graphql.friendlyName ? ` — ${escapeHtml(req.graphql.friendlyName)}` : ''}</strong>
          ${req.graphql.doc_id ? `<div style="margin-top:4px">doc_id: <code>${req.graphql.doc_id}</code></div>` : ''}
          ${req.graphql.variables ? `
            <div style="margin-top:6px"><strong>Variables:</strong>
              <pre class="detail-box" style="margin-top:4px;max-height:100px">${escapeHtml(JSON.stringify(req.graphql.variables, null, 2))}</pre>
            </div>` : ''}
        </div>
      `;
    }

    // ── Auth tokens ──
    if (req.authTokens && Object.keys(req.authTokens).length > 0) {
      html += `
        <div class="auth-highlight">
          <strong>🔑 Auth Headers</strong>
          <pre class="detail-box" style="margin-top:4px">${escapeHtml(JSON.stringify(req.authTokens, null, 2))}</pre>
        </div>
      `;
    }

    // ── Phase 3: Action Chain ──
    if (req.trigger?.actionChain?.length) {
      const chain = req.trigger.actionChain;
      html += `
        <div class="action-correlation">
          <strong>⛓ Triggered By (last ${chain.length} actions):</strong>
          ${chain.map(a => `<div style="margin-top:3px">👆 <strong>${a.type}</strong> on <code>${escapeHtml(a.selector || a.target)}</code>${a.text ? ` — "${escapeHtml(a.text.substring(0,30))}"` : ''}</div>`).join('')}
        </div>
      `;
    }

    // ── Request basic info ──
    html += `
      <div class="detail-section">
        <div class="detail-section-header"><h5>📤 Request</h5><button class="copy-section-btn" data-copy="request">📋 Copy</button></div>
        <div class="detail-section-content">
          <div class="detail-box"><span class="key">Method:</span> ${req.method}</div>
          <div class="detail-box" style="margin-top:5px"><span class="key">URL:</span> ${escapeHtml(req.url)}</div>
          ${req.duration ? `<div class="detail-box" style="margin-top:5px"><span class="key">Duration:</span> ${req.duration}ms</div>` : ''}
        </div>
      </div>
    `;

    // ── Request headers ──
    if (req.requestHeaders && Object.keys(req.requestHeaders).length > 0) {
      html += `
        <div class="detail-section">
          <div class="detail-section-header"><h5>📋 Request Headers</h5><button class="copy-section-btn" data-copy="requestHeaders">📋 Copy</button></div>
          <div class="detail-section-content"><div class="detail-box">${syntaxHighlight(req.requestHeaders)}</div></div>
        </div>
      `;
    }

    // ── Request body ──
    if (req.requestBody !== undefined && req.requestBody !== null) {
      html += `
        <div class="detail-section">
          <div class="detail-section-header"><h5>📦 Request Body</h5><button class="copy-section-btn" data-copy="requestBody">📋 Copy</button></div>
          <div class="detail-section-content"><div class="detail-box">${syntaxHighlight(req.requestBody)}</div></div>
        </div>
      `;
    }

    // ── Response ──
    if (req.status !== undefined) {
      const sc = req.status >= 200 && req.status < 300 ? '#28a745' : req.status >= 400 ? '#dc3545' : '#ffc107';
      html += `
        <div class="detail-section">
          <div class="detail-section-header"><h5>📥 Response</h5><button class="copy-section-btn" data-copy="response">📋 Copy</button></div>
          <div class="detail-section-content">
            <div class="detail-box"><span class="key">Status:</span> <span style="color:${sc}">${req.status} ${req.statusText || ''}</span></div>
          </div>
        </div>
      `;
    }

    if (req.responseHeaders && Object.keys(req.responseHeaders).length > 0) {
      html += `
        <div class="detail-section">
          <div class="detail-section-header"><h5>📋 Response Headers</h5><button class="copy-section-btn" data-copy="responseHeaders">📋 Copy</button></div>
          <div class="detail-section-content"><div class="detail-box">${syntaxHighlight(req.responseHeaders)}</div></div>
        </div>
      `;
    }

    if (req.responseBody !== undefined && req.responseBody !== null) {
      html += `
        <div class="detail-section">
          <div class="detail-section-header"><h5>📦 Response Body (${req.responseBodyType || '?'})</h5><button class="copy-section-btn" data-copy="responseBody">📋 Copy</button></div>
          <div class="detail-section-content"><div class="detail-box">${syntaxHighlight(req.responseBody)}</div></div>
        </div>
      `;
    }

    if (req.error) {
      html += `
        <div class="detail-section">
          <div class="detail-section-header"><h5>❌ Error</h5></div>
          <div class="detail-section-content"><div class="detail-box" style="color:#ff6b6b">${escapeHtml(req.error)}</div></div>
        </div>
      `;
    }

    // ── Phase 2: Replay Bundle ──
    if (req.replay) {
      const rp = req.replay;
      const hasTokens = Object.keys(rp.tokens || {}).length > 0;
      const replayTabs = [
        { key: 'curl',           label: 'cURL' },
        { key: 'curlCookies',    label: '🍪 +Cookie' },
        { key: 'python',         label: '🐍 Python' },
        { key: 'typescript',     label: '📘 TS/Next.js' },
        { key: 'n8n',            label: '🔗 n8n' },
        { key: 'worker',         label: '⚡ Worker' },
        { key: 'fetch',          label: 'Fetch' },
        { key: 'axios',          label: 'Axios' },
        ...(hasTokens ? [{ key: 'tokens', label: '🔑 Tokens' }] : []),
        { key: 'cookieGuide',    label: '🍪 Cookies' },
        { key: 'platformGuides', label: '📖 Guides' },
      ];
      const tabBtns = replayTabs.map((t, i) =>
        `<button class="replay-tab-btn${i===0?' active':''}" data-rtab="${t.key}">${t.label}</button>`
      ).join('');
      html += `
        <div class="detail-section">
          <div class="detail-section-header"><h5>🔁 Replay Bundle — Export for any platform</h5></div>
          <div class="detail-section-content">
            <div class="replay-tabs" style="flex-wrap:wrap;gap:3px;margin-bottom:6px">${tabBtns}</div>
            <pre class="replay-code-block" id="replayCodeBlock">${escapeHtml(rp.curl || '')}</pre>
            <button class="copy-section-btn" id="copyReplayBtn" style="margin-top:4px">📋 Copy snippet</button>
          </div>
        </div>
      `;
    }

    // ── Phase 2: Modify & Replay ──
    html += `
      <div class="detail-section">
        <div class="detail-section-header"><h5>✏️ Modify &amp; Replay</h5></div>
        <div class="detail-section-content">
          <div class="mod-area">
            <label>Headers (JSON)</label>
            <textarea id="modHeaders">${req.requestHeaders ? JSON.stringify(req.requestHeaders, null, 2) : '{}'}</textarea>
            <label style="margin-top:8px">Body (JSON / raw)</label>
            <textarea id="modBody">${req.requestBody ? (typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody, null, 2)) : ''}</textarea>
            <button class="mod-send-btn" id="modSendBtn">▶ Send Modified</button>
            <button class="mod-send-btn" id="modRefreshBtn" style="background:#e67e22;margin-left:6px" title="Fetches fresh fb_dtsg/lsd from the page and replays automatically">🔄 Refresh Tokens &amp; Replay</button>
          </div>
          <div class="mod-response" id="modResponseArea" style="display:none">
            <strong style="font-size:11px">Response:</strong>
            <div class="detail-box" id="modResponseBox" style="margin-top:5px;max-height:120px;overflow-y:auto"></div>
          </div>
        </div>
      </div>
    `;

    detailContent.innerHTML = html;

    // Replay bundle tab switching
    if (req.replay) {
      const codeBlock = detailContent.querySelector('#replayCodeBlock');
      const copyReplayBtn = detailContent.querySelector('#copyReplayBtn');
      const replayData = req.replay;

      detailContent.querySelectorAll('.replay-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          detailContent.querySelectorAll('.replay-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const key = btn.dataset.rtab;
          codeBlock.textContent = key === 'tokens'
            ? JSON.stringify(replayData.tokens || {}, null, 2)
            : (replayData[key] || '(not available)');
        });
      });

      copyReplayBtn.addEventListener('click', async () => {
        const text = codeBlock.textContent;
        try { await navigator.clipboard.writeText(text); } catch (_) { fallbackCopy(text); }
        showNotification('📋 Snippet copied!');
      });
    }

    // Modify & send
    const modSendBtn = detailContent.querySelector('#modSendBtn');
    if (modSendBtn) {
      modSendBtn.addEventListener('click', async () => {
        const modHeadersEl = detailContent.querySelector('#modHeaders');
        const modBodyEl    = detailContent.querySelector('#modBody');
        let headers = {}, body = modBodyEl.value;
        try { headers = JSON.parse(modHeadersEl.value); } catch (_) {}

        modSendBtn.textContent = '⏳ Sending…';
        modSendBtn.disabled    = true;

        const result = await sendMessage({
          action: 'replayWithMods',
          data  : { url: req.url, method: req.method, headers, body }
        });

        modSendBtn.textContent = '▶ Send Modified';
        modSendBtn.disabled    = false;

        const modResponseArea = detailContent.querySelector('#modResponseArea');
        const modResponseBox  = detailContent.querySelector('#modResponseBox');
        modResponseArea.style.display = 'block';

        // Show xssiWarning if present (CSRF / session rejection)
        let warnEl = detailContent.querySelector('#modXssiWarn');
        if (!warnEl) {
          warnEl = document.createElement('div');
          warnEl.id = 'modXssiWarn';
          warnEl.style.cssText = 'margin-bottom:6px;padding:6px 8px;background:#fff3cd;border-left:3px solid #ffc107;font-size:10px;border-radius:3px;display:none;';
          modResponseArea.insertBefore(warnEl, modResponseArea.firstChild);
        }
        if (result?.xssiWarning) {
          warnEl.textContent = result.xssiWarning;
          warnEl.style.display = 'block';
        } else {
          warnEl.style.display = 'none';
        }

        if (result?.success) {
          modResponseBox.innerHTML = syntaxHighlight(result.body);
          modResponseBox.style.color = '';
          showNotification(`✅ Modified replay: ${result.status}${result.xssiWarning ? ' ⚠️ Auth warning' : ''}`);
        } else {
          modResponseBox.textContent = 'Error: ' + (result?.error || 'Unknown');
          modResponseBox.style.color = '#ff6b6b';
          showNotification('❌ Replay failed');
        }
      });
    }

    // 🔄 Refresh Tokens & Replay
    const modRefreshBtn = detailContent.querySelector('#modRefreshBtn');
    if (modRefreshBtn) {
      modRefreshBtn.addEventListener('click', async () => {
        const modHeadersEl = detailContent.querySelector('#modHeaders');
        let headers = {};
        try { headers = JSON.parse(modHeadersEl.value); } catch (_) {}

        modRefreshBtn.textContent = '⏳ Fetching tokens…';
        modRefreshBtn.disabled    = true;

        const result = await sendMessage({
          action: 'refreshAndReplay',
          data  : { url: req.url, method: req.method, headers, body: req.requestBody }
        });

        modRefreshBtn.textContent = '🔄 Refresh Tokens & Replay';
        modRefreshBtn.disabled    = false;

        const modResponseArea = detailContent.querySelector('#modResponseArea');
        const modResponseBox  = detailContent.querySelector('#modResponseBox');
        modResponseArea.style.display = 'block';

        let infoEl = detailContent.querySelector('#modRefreshInfo');
        if (!infoEl) {
          infoEl = document.createElement('div');
          infoEl.id = 'modRefreshInfo';
          infoEl.style.cssText = 'margin-bottom:6px;padding:6px 8px;border-left:3px solid #28a745;font-size:10px;border-radius:3px;display:none;';
          modResponseArea.insertBefore(infoEl, modResponseArea.firstChild);
        }

        if (result?.freshTokens) {
          const names = Object.entries(result.freshTokens).filter(([,v]) => v).map(([k]) => k).join(', ');
          if (result.xssiWarning) {
            infoEl.style.background = '#fff3cd';
            infoEl.style.borderLeftColor = '#ffc107';
            infoEl.textContent = `⚠️ Refreshed [${names}] but still auth rejected: ${result.xssiWarning}`;
          } else {
            infoEl.style.background = '#d4edda';
            infoEl.style.borderLeftColor = '#28a745';
            infoEl.textContent = `✅ Tokens refreshed: ${names}`;
          }
          infoEl.style.display = 'block';
        } else {
          infoEl.style.display = 'none';
        }

        if (result?.success) {
          modResponseBox.innerHTML = syntaxHighlight(result.body);
          modResponseBox.style.color = '';
          showNotification(`✅ Refresh replay: ${result.status}`);
        } else {
          modResponseBox.textContent = 'Error: ' + (result?.error || 'Unknown');
          modResponseBox.style.color = '#ff6b6b';
          showNotification('❌ Refresh replay failed: ' + (result?.error || '?'));
        }
      });
    }

    // Copy section buttons
    detailContent.querySelectorAll('.copy-section-btn[data-copy]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ct = btn.dataset.copy;
        let text = '';
        switch(ct) {
          case 'request':        text = `${req.method} ${req.url}`; break;
          case 'requestHeaders': text = JSON.stringify(req.requestHeaders, null, 2); break;
          case 'requestBody':    text = typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody, null, 2); break;
          case 'response':       text = `Status: ${req.status}\n${JSON.stringify(req.responseBody, null, 2)}`; break;
          case 'responseHeaders':text = JSON.stringify(req.responseHeaders, null, 2); break;
          case 'responseBody':   text = typeof req.responseBody === 'string' ? req.responseBody : JSON.stringify(req.responseBody, null, 2); break;
        }
        try { await navigator.clipboard.writeText(text); } catch (_) { fallbackCopy(text); }
        showNotification('📋 Copied!');
      });
    });

    detailView.classList.add('visible');
  }

  // ============================================
  // SHOW SNIPPET DETAIL
  // ============================================
  function showSnippetDetail(snippet) {
    selectedSnippet = snippet; selectedRequest = null;
    detailTitle.innerHTML = `<span class="method ${snippet.method}">${snippet.method}</span> ${escapeHtml(truncateUrl(snippet.url, 35))}`;
    let html = `
      <div class="detail-section">
        <div class="detail-section-header"><h5>📤 Request</h5></div>
        <div class="detail-section-content">
          <div class="detail-box"><span class="key">Method:</span> ${snippet.method}</div>
          <div class="detail-box" style="margin-top:5px"><span class="key">URL:</span> ${escapeHtml(snippet.url)}</div>
        </div>
      </div>
    `;
    if (snippet.requestBody || snippet.body) {
      html += `
        <div class="detail-section">
          <div class="detail-section-header"><h5>📦 Request Body</h5><button class="copy-section-btn" data-copy="requestBody">📋 Copy</button></div>
          <div class="detail-section-content"><div class="detail-box">${syntaxHighlight(snippet.requestBody || snippet.body)}</div></div>
        </div>
      `;
    }
    if (snippet.responseBody) {
      html += `
        <div class="detail-section">
          <div class="detail-section-header"><h5>📦 Response Body</h5><button class="copy-section-btn" data-copy="responseBody">📋 Copy</button></div>
          <div class="detail-section-content"><div class="detail-box">${syntaxHighlight(snippet.responseBody)}</div></div>
        </div>
      `;
    }
    if (snippet.replay) {
      html += `
        <div class="detail-section">
          <div class="detail-section-header"><h5>🔁 Replay Bundle</h5></div>
          <div class="detail-section-content">
            <pre class="replay-code-block">${escapeHtml(snippet.replay.curl || '')}</pre>
          </div>
        </div>
      `;
    }
    detailContent.innerHTML = html;
    detailView.classList.add('visible');
  }

  // ============================================
  // UTILITY
  // ============================================
  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => { resolve(response); });
    });
  }

  function escapeHtml(text) {
    if (typeof text !== 'string') text = JSON.stringify(text);
    const div = document.createElement('div'); div.textContent = text; return div.innerHTML;
  }

  function truncateUrl(url, maxLen) {
    if (!url) return ''; return url.length <= maxLen ? url : url.substring(0, maxLen - 3) + '...';
  }

  function syntaxHighlight(obj) {
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { return escapeHtml(obj); } }
    const json = JSON.stringify(obj, null, 2);
    return json.replace(/(\"(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*\"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = 'number';
      if (/^"/.test(match)) cls = /:$/.test(match) ? 'key' : 'string';
      else if (/true|false/.test(match)) cls = 'boolean';
      else if (/null/.test(match)) cls = 'null';
      return `<span class="${cls}">${escapeHtml(match)}</span>`;
    });
  }

  function formatTime(ts) {
    if (!ts) return ''; return new Date(ts).toLocaleTimeString();
  }

  function formatDate(ts) {
    if (!ts) return ''; const d = new Date(ts); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
  }

  function showNotification(message) {
    const existing = document.querySelector('.sniff-toast');
    if (existing) existing.remove();
    const n = document.createElement('div');
    n.className = 'sniff-toast';
    n.style.cssText = 'position:fixed;bottom:55px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:4px;font-size:12px;z-index:999;animation:fadeIn 0.2s;white-space:nowrap;';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 2000);
  }

  function generateCurlCommand(req) {
    let cmd = `curl -X ${req.method || 'GET'} "${req.url}"`;
    if (req.requestHeaders) {
      Object.entries(req.requestHeaders).forEach(([k, v]) => { cmd += ` -H "${k}: ${v.replace(/"/g, '\\"')}"`; });
    }
    if (req.requestBody) {
      const b = typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody);
      cmd += ` -d '${b.replace(/'/g, "'\\''")}'`;
    }
    return cmd;
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  }
});
