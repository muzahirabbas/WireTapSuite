// ============================================
// WIRETAPSUITE v2 - FULL PAGE SUITE
// Phases: Timeline, Schema, Extract, Deep Detail
// ============================================

let allRequests    = [];
let filteredReqs   = [];
let selectedRequest= null;
let scrapedData    = [];
let extractedData  = [];
let activeFilter   = 'all';
let searchQuery    = '';

// Init
document.addEventListener('DOMContentLoaded', async () => {
  await loadRequests();
  await loadScrapedData();
  setupEventListeners();
  switchDetailTab('detail');
  await updateStats();
});

// ============================================
// DATA LOADING
// ============================================
async function loadRequests() {
  try {
    const result = await sendMessage({ action: 'getCapturedRequests' });
    allRequests = result?.requests || [];
    applyFilters();
    await updateStats();
  } catch (e) { console.error('Failed to load requests:', e); }
}

async function loadScrapedData() {
  const r = await chrome.storage.local.get(['scrapedData']);
  scrapedData = r.scrapedData || [];
  renderScrapedData();
}

// ============================================
// FILTERING (Phase 6)
// ============================================
function applyFilters() {
  filteredReqs = allRequests.filter(req => {
    if (activeFilter !== 'all') {
      if (activeFilter === 'websocket') return req.type === 'websocket' || req.type === 'websocket_message';
      if (activeFilter === 'graphql')   return !!req.graphql?.isGraphQL;
      if (activeFilter === 'mutation')  return req.tags?.includes('mutation');
      if (activeFilter === 'failed')    return req.tags?.includes('failed') || req.status >= 400;
      return req.method === activeFilter;
    }
    if (searchQuery) {
      const q = searchQuery;
      if ((req.url || '').toLowerCase().includes(q)) return true;
      if ((req.graphql?.friendlyName || '').toLowerCase().includes(q)) return true;
      if ((req.graphql?.doc_id || '').toString().includes(q)) return true;
      if (JSON.stringify(req.requestBody  || '').toLowerCase().includes(q)) return true;
      if (JSON.stringify(req.responseBody || '').toLowerCase().includes(q)) return true;
      return false;
    }
    return true;
  });
  renderRequestList();
}

// ============================================
// REQUEST LIST
// ============================================
function renderRequestList() {
  const list = document.getElementById('requestList');

  if (filteredReqs.length === 0) {
    list.innerHTML = `<div class="empty-state">${allRequests.length === 0
      ? '📡 No requests captured yet. Navigate to a site.'
      : 'No matches for current filters.'}</div>`;
    return;
  }

  list.innerHTML = filteredReqs.map((req) => {
    const method    = req.method || 'GET';
    const isMut     = req.tags?.includes('mutation');
    const isGQL     = req.graphql?.isGraphQL;
    const isFailed  = req.tags?.includes('failed') || req.status >= 400;
    let cls = 'request-item';
    if (isMut) cls += ' is-mutation';
    else if (isGQL) cls += ' is-graphql';
    if (isFailed) cls += ' is-failed';
    if (selectedRequest?.id === req.id) cls += ' selected';

    const dotHtml = isMut ? '<span class="tag-dot mut"></span>'
      : isGQL ? '<span class="tag-dot gql"></span>' : '';

    return `
      <div class="${cls}" data-id="${req.id}">
        <div>
          <span class="method-badge ${method}">${method}</span>
          ${dotHtml}
          ${req.status ? `<span style="font-size:10px;color:${req.status>=400?'#ff6b6b':req.status>=300?'#ffd43b':'#51cf66'}">${req.status}</span>` : ''}
        </div>
        <span class="req-url">${escapeHtml(truncateString(req.url, 50))}</span>
        <div class="req-meta">
          ${req.graphql?.friendlyName ? `<span style="color:#b197fc">${escapeHtml(req.graphql.friendlyName)}</span>` : ''}
          ${req.duration ? `<span>${req.duration}ms</span>` : ''}
          <span>${formatTime(req.timestamp)}</span>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.request-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      selectedRequest = allRequests.find(r => r.id === id);
      renderRequestList();
      showRequestDetail(selectedRequest);
      populateReplayForm(selectedRequest);
    });
  });
}

// ============================================
// DETAIL VIEW (Phases 1, 2, 3)
// ============================================
// Store reference so copy buttons can safely close over it
let _currentReplayData = null;

function showRequestDetail(req) {
  const emptyView      = document.getElementById('detailEmpty');
  const detailView     = document.getElementById('detailView');
  const requestContent = document.getElementById('requestContent');
  const responseContent= document.getElementById('responseContent');

  if (!req) { emptyView.style.display = 'flex'; detailView.style.display = 'none'; return; }
  emptyView.style.display  = 'none';
  detailView.style.display = 'block';
  requestContent.innerHTML  = '';
  responseContent.innerHTML = '';
  _currentReplayData = null;

  const isGQL = req.graphql?.isGraphQL;
  const isMut = req.tags?.includes('mutation');

  // ── Phase 1: GraphQL Info ──
  if (isGQL) {
    const div = document.createElement('div');
    div.className = `gql-box${isMut ? ' mutation' : ''}`;
    div.innerHTML = `
      <strong>🔷 GraphQL ${isMut ? '🔥 MUTATION' : 'Query'}${req.graphql.friendlyName ? ` — ${escapeHtml(req.graphql.friendlyName)}` : ''}</strong>
      ${req.graphql.doc_id ? `<div style="margin-top:4px;font-size:11px;color:#aaa">doc_id: <code>${req.graphql.doc_id}</code></div>` : ''}
      ${req.graphql.variables ? `<div style="margin-top:6px"><strong style="font-size:11px">Variables:</strong>
        <pre style="margin-top:4px;background:#0e0e1a;padding:8px;border-radius:4px;font-size:10px;overflow:auto;max-height:100px">${escapeHtml(JSON.stringify(req.graphql.variables, null, 2))}</pre>
      </div>` : ''}
    `;
    requestContent.appendChild(div);
  }

  // ── Phase 3: Action Chain ──
  if (req.trigger?.actionChain?.length) {
    const div = document.createElement('div');
    div.className = 'action-box';
    const chain = req.trigger.actionChain;
    div.innerHTML = `<strong>⛓ Action Chain (last ${chain.length})</strong>
      ${chain.map(a => `<div style="margin-top:4px;font-size:11px">👆 <strong>${a.type}</strong> on <code>${escapeHtml(a.selector || a.target)}</code>${a.text ? ` — "${escapeHtml(a.text.substring(0,30))}"` : ''}</div>`).join('')}`;
    requestContent.appendChild(div);
  }

  // Basic info
  requestContent.appendChild(createSection('Basic Info', `
    <div class="code-block"><span class="key">Method:</span> ${req.method}</div>
    <div class="code-block" style="margin-top:6px"><span class="key">URL:</span> ${escapeHtml(req.url)}</div>
    ${req.duration ? `<div class="code-block" style="margin-top:6px"><span class="key">Duration:</span> ${req.duration}ms</div>` : ''}
    ${req.type === 'cdp' ? '<div class="code-block" style="margin-top:6px;color:#b197fc">CDP capture</div>' : ''}
  `));

  if (req.requestHeaders && Object.keys(req.requestHeaders).length > 0)
    requestContent.appendChild(createSection('Request Headers', `<div class="code-block">${syntaxHighlight(req.requestHeaders)}</div>`, req.requestHeaders));

  if (req.requestBody !== undefined && req.requestBody !== null)
    requestContent.appendChild(createSection('Request Body', `<div class="code-block">${syntaxHighlight(req.requestBody)}</div>`, req.requestBody));

  if (req.authTokens && Object.keys(req.authTokens).length > 0)
    requestContent.appendChild(createSection('🔑 Auth Tokens', `<div class="code-block">${syntaxHighlight(req.authTokens)}</div>`));

  // ── Phase 2: Replay Bundle ──
  if (req.replay) {
    const r = req.replay;
    _currentReplayData = r;
    const hasTokens = Object.keys(r.tokens || {}).length > 0;

    // Map tab key → display label
    const tabs = [
      { key: 'curl',           label: 'cURL' },
      { key: 'curlCookies',    label: '🍪 cURL+Cookie' },
      { key: 'python',         label: '🐍 Python' },
      { key: 'typescript',     label: '📘 TypeScript' },
      { key: 'n8n',            label: '🔗 n8n' },
      { key: 'worker',         label: '⚡ Worker' },
      { key: 'fetch',          label: 'Fetch' },
      { key: 'axios',          label: 'Axios' },
      ...(hasTokens ? [{ key: 'tokens', label: '🔑 Tokens' }] : []),
      { key: 'cookieGuide',    label: '🍪 Cookie Guide' },
      { key: 'platformGuides', label: '📖 Guides' },
    ];

    const tabBtns = tabs.map((t, i) =>
      `<button class="replay-tab-btn${i === 0 ? ' active' : ''}" data-rtab="${t.key}">${t.label}</button>`
    ).join('');

    const html = `
      <div class="replay-tabs" style="flex-wrap:wrap;gap:4px">${tabBtns}</div>
      <pre class="replay-code" id="fpReplayBlock" style="max-height:300px">${escapeHtml(r.curl || '')}</pre>
      <button class="fp-copy-replay-btn" style="margin-top:6px;padding:3px 10px;background:#667eea;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px">📋 Copy</button>
    `;
    const sec = createSection('🔁 Replay Bundle — Export for any platform', html);
    requestContent.appendChild(sec);

    sec.querySelectorAll('.replay-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sec.querySelectorAll('.replay-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const key   = btn.dataset.rtab;
        const block = sec.querySelector('#fpReplayBlock');
        block.textContent = key === 'tokens' ? JSON.stringify(r.tokens || {}, null, 2) : (r[key] || '(not available)');
      });
    });

    sec.querySelector('.fp-copy-replay-btn').addEventListener('click', async () => {
      const block = sec.querySelector('#fpReplayBlock');
      const text  = block ? block.textContent : '';
      try { await navigator.clipboard.writeText(text); } catch (_) { fallbackCopy(text); }
      showNotification('📋 Snippet copied!');
    });
  }

  // ── Response ──
  if (req.status !== undefined) {
    const sc = req.status>=200&&req.status<300 ? '#51cf66' : req.status>=400 ? '#ff6b6b' : '#ffd43b';
    responseContent.appendChild(createSection('Status', `
      <div class="code-block"><span class="key">Status:</span> <span style="color:${sc}">${req.status} ${req.statusText||''}</span></div>
    `));
  }

  if (req.responseHeaders && Object.keys(req.responseHeaders).length > 0)
    responseContent.appendChild(createSection('Response Headers', `<div class="code-block">${syntaxHighlight(req.responseHeaders)}</div>`));

  if (req.responseBody !== undefined && req.responseBody !== null)
    responseContent.appendChild(createSection('Response Body', `<div class="code-block">${syntaxHighlight(req.responseBody)}</div>`, req.responseBody));

  if (req.error)
    responseContent.appendChild(createSection('❌ Error', `<div class="code-block" style="color:#ff6b6b">${escapeHtml(req.error)}</div>`));
}

function createSection(title, contentHtml, copyData) {
  const sec = document.createElement('div');
  sec.className = 'section';
  const copyBtnHtml = copyData !== undefined
    ? `<button class="sec-copy-btn">📋 Copy</button>`
    : '';
  sec.innerHTML = `<div class="section-title">${title}${copyBtnHtml}</div><div class="section-content">${contentHtml}</div>`;

  if (copyData !== undefined) {
    sec.querySelector('.sec-copy-btn').addEventListener('click', async () => {
      const text = typeof copyData === 'string' ? copyData : JSON.stringify(copyData, null, 2);
      try { await navigator.clipboard.writeText(text); } catch (_) { fallbackCopy(text); }
      showNotification('📋 Copied!');
    });
  }

  return sec;
}

function populateReplayForm(req) {
  if (!req) return;
  document.getElementById('replayMethod').value  = req.method || 'GET';
  document.getElementById('replayUrl').value      = req.url    || '';
  document.getElementById('replayHeaders').value  = req.requestHeaders ? JSON.stringify(req.requestHeaders, null, 2) : '{}';
  document.getElementById('replayBody').value     = req.requestBody
    ? (typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody, null, 2))
    : '';
}

// ============================================
// PHASE 9: TIMELINE
// ============================================
async function renderTimeline() {
  const container = document.getElementById('timelineContainer');
  container.innerHTML = '<div class="empty-state">Loading…</div>';

  // Get user actions from active tab
  const actResult  = await sendMessage({ action: 'getUserActions' });
  const userActions = (actResult?.actions || []).map(a => ({ ...a, _kind: 'action' }));

  const combined = [
    ...userActions,
    ...allRequests.map(r => ({ ...r, _kind: 'request' }))
  ].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  if (combined.length === 0) {
    container.innerHTML = '<div class="empty-state">No events captured yet. Browse a website while the sniffer is active.</div>';
    return;
  }

  container.innerHTML = '';
  const tl = document.createElement('div');
  tl.className = 'timeline';

  let lastTs = 0;

  combined.forEach(event => {
    const item = document.createElement('div');
    const ts   = event.timestamp || 0;
    const gap  = lastTs ? `+${ts - lastTs}ms` : '';
    lastTs     = ts;

    if (event._kind === 'action') {
      item.className = 'tl-item tl-action';
      item.innerHTML = `
        <span class="tl-dot action"></span>
        <div class="tl-time">${formatTime(ts)} ${gap ? `<span style="color:#444">(${gap})</span>` : ''}</div>
        <div class="tl-label">👆 ${event.type.toUpperCase()}</div>
        <div class="tl-detail">${escapeHtml(event.selector || event.target || '')}${event.text ? ` — "${escapeHtml(event.text.substring(0,40))}"` : ''}</div>
      `;
    } else {
      const isMut  = event.tags?.includes('mutation');
      const isGQL  = event.graphql?.isGraphQL;
      const isFail = event.tags?.includes('failed') || event.status >= 400;
      let cls = 'tl-item';
      cls += isMut ? ' tl-mutation' : isGQL ? ' tl-graphql' : ' tl-request';
      const dotCls = isMut ? 'mutation' : isGQL ? 'graphql' : isFail ? 'failed' : 'request';
      const icon   = isMut ? '🔥' : isGQL ? '🔷' : isFail ? '❌' : '🌐';
      item.className = cls;
      item.innerHTML = `
        <span class="tl-dot ${dotCls}"></span>
        <div class="tl-time">${formatTime(ts)} ${gap ? `<span style="color:#444">(${gap})</span>` : ''}</div>
        <div class="tl-label">${icon} ${event.method || event.type} ${isMut ? 'MUTATION' : isGQL ? 'GraphQL' : ''}${event.graphql?.friendlyName ? ` — ${escapeHtml(event.graphql.friendlyName)}` : ''}</div>
        <div class="tl-detail">${escapeHtml(truncateString(event.url, 60))} ${event.status ? `→ ${event.status}` : ''}</div>
      `;
    }

    tl.appendChild(item);
  });

  container.appendChild(tl);
}

// ============================================
// PHASE 7: SCHEMA
// ============================================
async function renderSchema() {
  const result = await sendMessage({ action: 'getApiSchema' });
  const schema = result?.schema || {};
  const container = document.getElementById('schemaContainer');

  if (Object.keys(schema).length === 0) {
    container.innerHTML = '<div class="empty-state">No GraphQL operations captured yet.<br>Use the sniffer on a site that uses GraphQL (Facebook, GitHub, etc.)</div>';
    return;
  }

  const rows = Object.entries(schema).map(([name, info]) => {
    const varKeys = Object.keys(info.variablesShape || {});
    const keysHtml = varKeys.map(k => `<span class="shape-key">${escapeHtml(k)}</span>`).join('');
    const samples  = (info.samplePayloads || []).length;
    return `
      <tr>
        <td><span class="schema-badge ${info.type}">${info.type.toUpperCase()}</span></td>
        <td style="font-family:Consolas,monospace;color:#d4d4d4">${escapeHtml(name)}</td>
        <td>${keysHtml || '<span style="color:#555">none</span>'}</td>
        <td style="color:#888">${samples} sample${samples !== 1 ? 's' : ''}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="schema-table">
      <thead>
        <tr><th>Type</th><th>Name</th><th>Variable Keys</th><th>Samples</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ============================================
// PHASE 8: DEEP EXTRACT
// ============================================
function deepExtract(obj, path = '') {
  const results = [];
  if (typeof obj !== 'object' || obj === null) return results;

  for (const [key, value] of Object.entries(obj)) {
    const curPath = path ? `${path}.${key}` : key;
    if (typeof value === 'string' && value.length > 0) {
      results.push({ path: curPath, type: 'string', value });
    } else if (typeof value === 'number') {
      results.push({ path: curPath, type: 'number', value });
    } else if (typeof value === 'boolean') {
      results.push({ path: curPath, type: 'boolean', value });
    } else if (Array.isArray(value)) {
      results.push({ path: curPath, type: 'array', value: `[${value.length} items]`, raw: value });
      if (value.length > 0 && typeof value[0] === 'object') {
        results.push(...deepExtract(value[0], `${curPath}[0]`));
      }
    } else if (typeof value === 'object' && value !== null) {
      results.push(...deepExtract(value, curPath));
    }
  }
  return results;
}

function renderExtractedData() {
  const container = document.getElementById('extractContainer');
  if (!extractedData || extractedData.length === 0) {
    container.innerHTML = '<div class="empty-state">No extracted data. Select a request and click ⚡ Extract.</div>';
    return;
  }

  // Group by type
  const strings  = extractedData.filter(d => d.type === 'string').slice(0, 50);
  const numbers  = extractedData.filter(d => d.type === 'number' || d.type === 'boolean');
  const arrays   = extractedData.filter(d => d.type === 'array');

  let html = '<div class="extract-grid">';

  if (strings.length) {
    html += `<div class="extract-card"><h4>Text Fields (${strings.length})</h4><pre>${strings.map(d => `${escapeHtml(d.path)}: ${escapeHtml(String(d.value).substring(0,60))}`).join('\n')}</pre></div>`;
  }
  if (numbers.length) {
    html += `<div class="extract-card"><h4>Numbers / Booleans (${numbers.length})</h4><pre>${numbers.map(d => `${escapeHtml(d.path)}: ${d.value}`).join('\n')}</pre></div>`;
  }
  if (arrays.length) {
    html += `<div class="extract-card"><h4>Arrays (${arrays.length})</h4><pre>${arrays.map(d => `${escapeHtml(d.path)}: ${d.value}`).join('\n')}</pre></div>`;
  }

  // IDs heuristic
  const ids = extractedData.filter(d => d.type === 'string' && /id$/i.test(d.path));
  if (ids.length) {
    html += `<div class="extract-card"><h4>🔑 IDs (${ids.length})</h4><pre>${ids.map(d => `${escapeHtml(d.path)}: ${escapeHtml(String(d.value).substring(0,40))}`).join('\n')}</pre></div>`;
  }

  html += '</div>';
  container.innerHTML = html;
}

// ============================================
// SCRAPING
// ============================================
async function scrapeFromResponse() {
  if (!selectedRequest) { showNotification('❌ No request selected'); return; }
  const body = selectedRequest.responseBody;
  if (!body) { showNotification('❌ Response has no body'); return; }

  if (typeof body === 'string') {
    const imgMatches = body.match(/(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|svg))/gi);
    if (imgMatches) imgMatches.forEach(url => scrapedData.push({ type: 'image', data: url, timestamp: Date.now() }));
  }
  if (typeof body === 'object') {
    await extractImagesFromJSON(body);
  }

  await chrome.storage.local.set({ scrapedData });
  renderScrapedData();
  showNotification(`🖼 Scraped ${scrapedData.length} items total`);
}

async function extractImagesFromJSON(obj) {
  for (const [key, value] of Object.entries(obj || {})) {
    if (typeof value === 'string' && (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(value) || value.startsWith('data:image/'))) {
      scrapedData.push({ type: 'image', data: value, timestamp: Date.now() });
    } else if (typeof value === 'object' && value !== null) {
      await extractImagesFromJSON(Array.isArray(value) ? Object.assign({}, value) : value);
    }
  }
}

function renderScrapedData() {
  const grid = document.getElementById('scrapedGrid');
  if (!scrapedData || scrapedData.length === 0) {
    grid.innerHTML = '<div class="empty-state">No scraped data yet.</div>';
    return;
  }
  grid.innerHTML = scrapedData.map((item, i) => {
    const content = item.type === 'image'
      ? `<img src="${escapeHtml(item.data)}" alt="Scraped" style="width:100%;height:130px;object-fit:cover">`
      : `<pre style="font-size:10px;color:#ccc;overflow:auto;height:130px">${escapeHtml(JSON.stringify(item.data, null, 2).substring(0, 300))}</pre>`;
    return `<div class="scraped-item" data-scrape-index="${i}">
      ${content}
      <div class="scraped-item-info">
        <strong>${escapeHtml((item.type || 'DATA').toUpperCase())}</strong><br>
        <span style="color:#888">${formatTime(item.timestamp)}</span><br>
        <button class="dl-btn">📥 Download</button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.scraped-item').forEach(card => {
    const idx = parseInt(card.dataset.scrapeIndex, 10);
    card.querySelector('.dl-btn').addEventListener('click', () => downloadScrapedItem(idx));
  });
}

async function downloadScrapedItem(index) {
  const item = scrapedData[index]; if (!item) return;
  const a    = document.createElement('a');
  if (item.type === 'image') {
    a.href = item.data; a.download = `scraped-${Date.now()}.jpg`; a.target = '_blank';
  } else {
    const blob = new Blob([JSON.stringify(item.data, null, 2)], { type: 'application/json' });
    a.href = URL.createObjectURL(blob); a.download = `scraped-${Date.now()}.json`;
  }
  a.click(); showNotification('📥 Download started');
}

// ============================================
// REPLAY (Phase 2)
// ============================================
async function replayRequest() {
  const method = document.getElementById('replayMethod').value;
  const url    = document.getElementById('replayUrl').value;
  if (!url) { showNotification('❌ Please enter a URL'); return; }

  let headers = {};
  try { headers = JSON.parse(document.getElementById('replayHeaders').value || '{}'); }
  catch (e) { showNotification('❌ Invalid JSON in headers'); return; }

  const bodyText = document.getElementById('replayBody').value;
  // Send body as raw string — do NOT re-parse JSON. URL-encoded bodies
  // (containing fb_dtsg, lsd, jazoest CSRF tokens) must pass through unchanged.
  const body = (bodyText && method !== 'GET') ? bodyText : null;

  showNotification('🔄 Sending…');
  const result = await sendMessage({ action: 'replaySnippet', data: { url, method, body, headers } });
  const panel  = document.getElementById('replayResponse');
  panel.style.display = 'block';

  // Show/hide xssiWarning banner
  let warnEl = document.getElementById('replayXssiWarn');
  if (!warnEl) {
    warnEl = document.createElement('div');
    warnEl.id = 'replayXssiWarn';
    warnEl.style.cssText = 'margin-bottom:10px;padding:8px 12px;background:#1a1500;border-left:3px solid #ffc107;border-radius:4px;font-size:11px;color:#ffd43b;display:none;';
    panel.insertBefore(warnEl, panel.firstChild);
  }
  if (result?.xssiWarning) {
    warnEl.textContent = result.xssiWarning;
    warnEl.style.display = 'block';
  } else {
    warnEl.style.display = 'none';
  }

  if (result?.success) {
    document.getElementById('responseStatus').innerHTML = `<span style="color:#51cf66">${result.status} ${result.statusText||''}</span>${result.xssiWarning ? ' <span style="color:#ffd43b">⚠️ Auth warning</span>' : ''}`;
    document.getElementById('responseBody').innerHTML   = syntaxHighlight(result.body);
    showNotification('✅ Request successful' + (result.xssiWarning ? ' ⚠️ Auth warning' : ''));
  } else {
    document.getElementById('responseStatus').innerHTML = `<span style="color:#ff6b6b">Error</span>`;
    document.getElementById('responseBody').textContent = result?.error || 'Unknown error';
    showNotification('❌ Request failed');
  }
}

// Auto-refresh CSRF tokens and replay (for CSRF 1357004 errors)
async function refreshAndReplay() {
  const method = document.getElementById('replayMethod').value;
  const url    = document.getElementById('replayUrl').value;
  if (!url) { showNotification('❌ Please enter a URL'); return; }

  let headers = {};
  try { headers = JSON.parse(document.getElementById('replayHeaders').value || '{}'); } catch (e) {}
  const body = document.getElementById('replayBody').value || null;

  // Show progress in button
  const btn = document.getElementById('refreshReplayBtn');
  if (btn) { btn.textContent = '⏳ Fetching fresh tokens…'; btn.disabled = true; }

  showNotification('🔄 Fetching fresh CSRF tokens…');
  const result = await sendMessage({ action: 'refreshAndReplay', data: { url, method, body, headers } });

  if (btn) { btn.textContent = '🔄 Refresh Tokens & Replay'; btn.disabled = false; }

  const panel = document.getElementById('replayResponse');
  panel.style.display = 'block';

  // Token refresh info banner
  let infoEl = document.getElementById('refreshInfoBanner');
  if (!infoEl) {
    infoEl = document.createElement('div');
    infoEl.id = 'refreshInfoBanner';
    infoEl.style.cssText = 'margin-bottom:10px;padding:8px 12px;border-radius:4px;font-size:11px;display:none;';
    panel.insertBefore(infoEl, panel.firstChild);
  }

  if (result?.freshTokens) {
    const names = Object.entries(result.freshTokens).filter(([,v]) => v).map(([k]) => k).join(', ');
    if (result.xssiWarning) {
      infoEl.style.cssText += 'background:#1a1500;border-left:3px solid #ffc107;color:#ffd43b;';
      infoEl.textContent = `⚠️ Refreshed [${names}] but server still rejected. ${result.xssiWarning}`;
    } else {
      infoEl.style.cssText += 'background:#0a1f0a;border-left:3px solid #28a745;color:#51cf66;';
      infoEl.textContent = `✅ Tokens refreshed: ${names} — replay sent with fresh tokens`;
    }
    infoEl.style.display = 'block';
  } else {
    infoEl.style.display = 'none';
  }

  if (result?.success) {
    document.getElementById('responseStatus').innerHTML = `<span style="color:#51cf66">${result.status} ${result.statusText||''}</span>`;
    document.getElementById('responseBody').innerHTML   = syntaxHighlight(result.body);
    showNotification('✅ Refresh replay successful!');
  } else {
    document.getElementById('responseStatus').innerHTML = `<span style="color:#ff6b6b">Error</span>`;
    document.getElementById('responseBody').textContent = result?.error || 'Could not get fresh tokens. Make sure you are logged in.';
    showNotification('❌ Refresh replay failed');
  }
}

// ============================================
// STATS
// ============================================
async function updateStats() {
  try {
    const result = await sendMessage({ action: 'getStats' });
    if (result) {
      document.getElementById('totalRequests').textContent = result.totalRequests || 0;
      document.getElementById('totalGraphQL').textContent  = result.totalGraphQL   || 0;
      document.getElementById('totalMutations').textContent= result.totalMutations || 0;
      document.getElementById('totalSnippets').textContent = result.totalSnippets  || 0;
      document.getElementById('schemaEntries').textContent = result.schemaEntries  || 0;
    }
  } catch (_) {}
}

// ============================================
// EVENT LISTENERS
// ============================================
function setupEventListeners() {
  document.getElementById('refreshData').addEventListener('click', async () => {
    await loadRequests(); await updateStats(); showNotification('🔄 Refreshed');
  });

  document.getElementById('clearData').addEventListener('click', async () => {
    if (!confirm('Clear all captured requests?')) return;
    await sendMessage({ action: 'clearCapturedRequests' });
    allRequests = []; filteredReqs = []; selectedRequest = null;
    renderRequestList();
    document.getElementById('detailEmpty').style.display = 'flex';
    document.getElementById('detailView').style.display  = 'none';
    await updateStats(); showNotification('🗑 Cleared');
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase(); applyFilters();
  });

  // Filter buttons
  document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      applyFilters();
    });
  });

  // Panel tabs
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchDetailTab(tab.dataset.tab);
    });
  });

  document.getElementById('replayBtn2').addEventListener('click', replayRequest);
  document.getElementById('refreshReplayBtn').addEventListener('click', refreshAndReplay);

  document.getElementById('exportAllBtn').addEventListener('click', () => {
    if (!allRequests.length) { showNotification('No requests to export'); return; }
    downloadJSON({ exportedAt: new Date().toISOString(), total: allRequests.length, data: allRequests },
      `api-sniffer-all-${Date.now()}.json`);
    showNotification(`📤 Exported ${allRequests.length} requests`);
  });

  document.getElementById('exportFilteredBtn').addEventListener('click', () => {
    if (!filteredReqs.length) { showNotification('No filtered requests'); return; }
    downloadJSON({ exportedAt: new Date().toISOString(), total: filteredReqs.length, filter: activeFilter, data: filteredReqs },
      `api-sniffer-filtered-${Date.now()}.json`);
    showNotification(`📤 Exported ${filteredReqs.length} filtered`);
  });

  document.getElementById('scrapeBtn').addEventListener('click', scrapeFromResponse);
  document.getElementById('clearScrapedBtn').addEventListener('click', async () => {
    if (!confirm('Clear scraped data?')) return;
    scrapedData = []; await chrome.storage.local.set({ scrapedData: [] });
    renderScrapedData(); showNotification('🗑 Cleared scraped data');
  });

  document.getElementById('extractBtn').addEventListener('click', () => {
    if (!selectedRequest) { showNotification('❌ No request selected'); return; }
    const body = selectedRequest.responseBody;
    if (!body) { showNotification('❌ No response body'); return; }
    extractedData = deepExtract(typeof body === 'object' ? body : {});
    renderExtractedData();
    showNotification(`🔎 Extracted ${extractedData.length} fields`);
  });

  document.getElementById('exportExtractJsonBtn').addEventListener('click', () => {
    if (!extractedData.length) { showNotification('Nothing extracted yet'); return; }
    downloadJSON(extractedData, `extracted-${Date.now()}.json`);
    showNotification('📤 JSON exported');
  });

  document.getElementById('exportExtractCsvBtn').addEventListener('click', () => {
    if (!extractedData.length) { showNotification('Nothing extracted yet'); return; }
    const rows = [['path','type','value'], ...extractedData.map(d => [d.path, d.type, String(d.value)])];
    const csv  = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `extracted-${Date.now()}.csv`; a.click();
    showNotification('📤 CSV exported');
  });

  document.getElementById('refreshTimeline').addEventListener('click', renderTimeline);
  document.getElementById('refreshSchema').addEventListener('click', renderSchema);
  document.getElementById('clearSchema').addEventListener('click', async () => {
    if (!confirm('Clear extracted schema?')) return;
    await sendMessage({ action: 'clearApiSchema' });
    await renderSchema(); await updateStats(); showNotification('🗑 Schema cleared');
  });
  document.getElementById('exportSchema').addEventListener('click', async () => {
    const r = await sendMessage({ action: 'getApiSchema' });
    downloadJSON(r.schema, `api-schema-${Date.now()}.json`);
    showNotification('📤 Schema exported');
  });
}

function switchDetailTab(tabName) {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const tab     = document.querySelector(`.panel-tab[data-tab="${tabName}"]`);
  const content = document.getElementById(`${tabName}Tab`);
  if (tab)     tab.classList.add('active');
  if (content) content.classList.add('active');

  if (tabName === 'timeline') renderTimeline();
  if (tabName === 'schema')   renderSchema();
}

// ============================================
// UTILITIES
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

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function truncateString(str, maxLen) {
  if (!str) return ''; return str.length <= maxLen ? str : str.substring(0, maxLen-3) + '...';
}

function formatTime(ts) {
  if (!ts) return ''; return new Date(ts).toLocaleTimeString();
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

function showNotification(message) {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();
  const n = document.createElement('div');
  n.className = 'notification';
  n.textContent = message;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 2500);
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  document.execCommand('copy'); document.body.removeChild(ta);
}
