// inject.js — runs in page context (bypasses CSP via chrome.scripting.executeScript)
(function() {
  if (window.__apiSnifferInjected) return;
  window.__apiSnifferInjected = true;

  console.log('[WiretapSuite v2] Injected into page context');

  let isSniffing   = true;
  let captureCount = 0;

  const sendToBackground = (data) => {
    try { chrome.runtime.sendMessage({ action: 'requestCaptured', ...data }); } catch (e) {}
  };

  // ============================================
  // GraphQL Detection (must be self-contained here)
  // ============================================
  function parseBodyAsObject(body) {
    if (!body) return null;
    if (typeof body === 'object') return body;
    const str = String(body);
    try { return JSON.parse(str); } catch (_) {}
    try {
      const params = {};
      new URLSearchParams(str).forEach((v, k) => { params[k] = v; });
      if (Object.keys(params).length > 0) return params;
    } catch (_) {}
    return null;
  }

  function detectGraphQL(url, bodyObj) {
    const urlStr   = typeof url === 'string' ? url : '';
    const isGQLUrl = urlStr.includes('/graphql') || urlStr.includes('graphql?');
    if (!bodyObj) return null;

    const hasDocId    = 'doc_id' in bodyObj;
    const hasFriendly = 'fb_api_req_friendly_name' in bodyObj;
    const hasQuery    = 'query' in bodyObj && typeof bodyObj.query === 'string';

    if (!isGQLUrl && !hasDocId && !hasFriendly && !hasQuery) return null;

    const friendlyName = bodyObj.fb_api_req_friendly_name || bodyObj.operationName || null;
    const docId        = bodyObj.doc_id || bodyObj.documentId || null;
    let variables      = null;
    if (bodyObj.variables) {
      variables = typeof bodyObj.variables === 'string'
        ? parseBodyAsObject(bodyObj.variables)
        : bodyObj.variables;
    }

    const nameLower  = (friendlyName || '').toLowerCase();
    const queryStr   = (bodyObj.query || '').toLowerCase();
    const isMutation =
      nameLower.includes('create') || nameLower.includes('mutation') ||
      nameLower.includes('update') || nameLower.includes('delete') ||
      queryStr.startsWith('mutation') || queryStr.includes('\nmutation') ||
      (variables && variables.input !== undefined);

    return {
      isGraphQL: true, type: isMutation ? 'mutation' : 'query',
      doc_id: docId, friendlyName, variables,
      query: hasQuery ? bodyObj.query.substring(0, 500) : null,
      raw  : JSON.stringify(bodyObj).substring(0, 2000)
    };
  }

  // ============================================
  // Capture fetch
  // ============================================
  if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const startTime    = Date.now();
      const [input, init = {}] = args;
      let method = 'GET', url = '';

      if (typeof input === 'string') { url = input; method = init.method || 'GET'; }
      else if (input instanceof Request) { url = input.url; method = input.method; }

      // Body
      let bodyStr = null;
      if (init.body) {
        bodyStr = typeof init.body === 'string' ? init.body
          : (init.body instanceof URLSearchParams ? init.body.toString() : null);
        if (bodyStr && bodyStr.length > 500000) bodyStr = '[TRUNCATED]';
      }

      const bodyObj = parseBodyAsObject(bodyStr);
      const graphql = detectGraphQL(url, bodyObj);
      const tags    = [];
      if (graphql?.isGraphQL)           tags.push('graphql');
      if (graphql?.type === 'mutation') tags.push('mutation', 'important');

      const captureData = {
        id         : `inject_fetch_${Date.now()}`,
        type       : 'fetch',
        method     : method.toUpperCase(),
        url        : url,
        requestBody: bodyStr,
        timestamp  : startTime,
        capturedAt : new Date().toISOString(),
        graphql, tags
      };

      const promise = originalFetch.apply(this, args);

      promise.then(async (response) => {
        const clone = response.clone();
        captureData.status = response.status;
        if (response.status >= 400) captureData.tags = [...tags, 'failed'];
        try {
          captureData.responseBody     = await clone.json();
          captureData.responseBodyType = 'json';
        } catch (e) {
          captureData.responseBody     = await clone.text().catch(() => '');
          captureData.responseBodyType = 'text';
        }
        captureData.duration = Date.now() - startTime;
        if (isSniffing) sendToBackground(captureData);
      }).catch((error) => {
        captureData.error = error.message;
        captureData.tags  = [...tags, 'failed'];
        if (isSniffing) sendToBackground(captureData);
      });

      return promise;
    };
    console.log('[WiretapSuite v2] Fetch intercepted (inject)');
  }

  // ============================================
  // Capture XHR
  // ============================================
  if (window.XMLHttpRequest) {
    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
      const xhr          = new OriginalXHR();
      const originalOpen = xhr.open;
      const originalSend = xhr.send;
      let method = '', url = '';

      xhr.open = function(_method, _url, ...rest) {
        method = _method.toUpperCase(); url = _url;
        return originalOpen.apply(xhr, [_method, _url, ...rest]);
      };

      xhr.send = function(body) {
        const startTime = Date.now();
        let bodyStr     = typeof body === 'string' ? body : null;
        if (bodyStr && bodyStr.length > 500000) bodyStr = '[TRUNCATED]';

        const bodyObj = parseBodyAsObject(bodyStr);
        const graphql = detectGraphQL(url, bodyObj);
        const tags    = [];
        if (graphql?.isGraphQL)           tags.push('graphql');
        if (graphql?.type === 'mutation') tags.push('mutation', 'important');

        const captureData = {
          id: `inject_xhr_${Date.now()}`, type: 'xhr', method, url,
          requestBody: bodyStr, timestamp: startTime,
          capturedAt: new Date().toISOString(), graphql, tags
        };

        xhr.addEventListener('load', function() {
          captureData.status   = xhr.status;
          captureData.duration = Date.now() - startTime;
          if (xhr.status >= 400) captureData.tags = [...tags, 'failed'];
          try {
            captureData.responseBody     = JSON.parse(xhr.responseText);
            captureData.responseBodyType = 'json';
          } catch (e) {
            captureData.responseBody     = xhr.responseText;
            captureData.responseBodyType = 'text';
          }
          if (isSniffing) sendToBackground(captureData);
        });

        return originalSend.apply(xhr, arguments);
      };
      return xhr;
    };
    console.log('[WiretapSuite v2] XHR intercepted (inject)');
  }

  // Listen for state changes from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'setSniffingState') {
      isSniffing = message.enabled;
      sendResponse({ success: true });
    }
    if (message.action === 'getSniffingState') {
      sendResponse({ isSniffing, captureCount });
    }
    return true;
  });

  console.log('[WiretapSuite v2] Page context injection complete');
})();
