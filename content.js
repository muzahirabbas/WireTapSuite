(function() {
  // Prevent double injection
  if (window.__apiSnifferActive) return;
  window.__apiSnifferActive = true;

  let isSniffing = true;
  let captureCount = 0;
  let userActionSequence = [];

  window.__capturedRequests = [];

  const hasChromeRuntime = typeof chrome !== 'undefined' && chrome.runtime;

  if (hasChromeRuntime) {
    chrome.runtime.sendMessage({ action: 'getSniffingState' }, (response) => {
      if (response && response.isSniffing !== undefined) {
        isSniffing = response.isSniffing;
      }
    });
  }

  // ============================================
  // PHASE 1: GraphQL Detection Helpers
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
    const isGQLUrl = urlStr.includes('/graphql') || urlStr.includes('graphql?') || urlStr.includes('/api/graphql');

    if (!bodyObj) return null;

    const hasDocId     = 'doc_id' in bodyObj;
    const hasFriendly  = 'fb_api_req_friendly_name' in bodyObj;
    const hasVariables = 'variables' in bodyObj;
    const hasQuery     = 'query' in bodyObj && typeof bodyObj.query === 'string';

    if (!isGQLUrl && !hasDocId && !hasFriendly && !hasQuery) return null;

    const friendlyName = bodyObj.fb_api_req_friendly_name || bodyObj.operationName || null;
    const docId        = bodyObj.doc_id || bodyObj.documentId || null;

    let variables = null;
    if (bodyObj.variables) {
      variables = typeof bodyObj.variables === 'string'
        ? parseBodyAsObject(bodyObj.variables)
        : bodyObj.variables;
    }

    const nameLower  = (friendlyName || '').toLowerCase();
    const queryStr   = (bodyObj.query || '').toLowerCase();
    const isMutation =
      nameLower.includes('create') ||
      nameLower.includes('mutation') ||
      nameLower.includes('update') ||
      nameLower.includes('delete') ||
      nameLower.includes('insert') ||
      queryStr.startsWith('mutation') ||
      queryStr.includes('\nmutation') ||
      (variables && variables.input !== undefined);

    return {
      isGraphQL   : true,
      type        : isMutation ? 'mutation' : 'query',
      doc_id      : docId,
      friendlyName: friendlyName,
      variables   : variables,
      query       : hasQuery ? bodyObj.query.substring(0, 500) : null,
      raw         : JSON.stringify(bodyObj).substring(0, 2000)
    };
  }

  // ============================================
  // Send to background
  // ============================================
  const sendToBackground = (data) => {
    if (!hasChromeRuntime) return;
    try {
      chrome.runtime.sendMessage({ action: 'requestCaptured', ...data });
    } catch (e) {}
  };

  // ============================================
  // CAPTURE FETCH (Phase 1 + 3)
  // ============================================
  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function(input, init = {}) {
      const startTime = Date.now();
      let method = 'GET';
      let url    = '';
      let requestBodyRaw = null;

      if (typeof input === 'string') {
        url            = input;
        method         = (init && init.method) || 'GET';
        requestBodyRaw = init.body ?? null;
      } else if (input instanceof Request) {
        url            = input.url;
        method         = input.method;
        requestBodyRaw = null; // Request body is consumed; read from init if available
      }

      // Phase 3: snapshot user action chain at request fire time
      const actionChain = userActionSequence.slice(-5);

      // Phase 10: body size guard
      let requestBodyStr = null;
      if (requestBodyRaw !== null && requestBodyRaw !== undefined) {
        requestBodyStr = typeof requestBodyRaw === 'string'
          ? requestBodyRaw
          : (requestBodyRaw instanceof URLSearchParams ? requestBodyRaw.toString() : null);
        if (requestBodyStr && requestBodyStr.length > 500000) {
          requestBodyStr = '[TRUNCATED - body too large]';
        }
      }

      const bodyObj = parseBodyAsObject(requestBodyStr);
      const graphql = detectGraphQL(url, bodyObj);
      const tags    = [];
      if (graphql?.isGraphQL)           tags.push('graphql');
      if (graphql?.type === 'mutation') tags.push('mutation', 'important');

      const captureData = {
        id           : `fetch_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
        type         : 'fetch',
        method       : method.toUpperCase(),
        url          : url,
        requestBody  : requestBodyStr,
        timestamp    : startTime,
        capturedAt   : new Date().toISOString(),
        graphql      : graphql,
        tags         : tags,
        trigger      : {
          lastAction : actionChain[actionChain.length - 1] || null,
          actionChain: actionChain
        }
      };

      const promise = originalFetch.apply(this, arguments);

      promise.then(async (response) => {
        const clone = response.clone();
        captureData.status = response.status;
        if (response.status >= 400) captureData.tags = [...(captureData.tags || []), 'failed'];

        try {
          captureData.responseBody     = await clone.json();
          captureData.responseBodyType = 'json';
        } catch (e) {
          try {
            captureData.responseBody     = await clone.text();
            captureData.responseBodyType = 'text';
          } catch (e2) {}
        }

        captureData.duration = Date.now() - startTime;
        captureCount++;
        if (isSniffing) {
          sendToBackground(captureData);
          window.__capturedRequests.push(captureData);
        }
      }).catch((error) => {
        captureData.error = error.message;
        captureData.tags  = [...(captureData.tags || []), 'failed'];
        captureCount++;
        if (isSniffing) {
          sendToBackground(captureData);
          window.__capturedRequests.push(captureData);
        }
      });

      return promise;
    };
  }

  // ============================================
  // CAPTURE XHR (Phase 1 + 3)
  // ============================================
  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    window.XMLHttpRequest = function() {
      const xhr         = new OriginalXHR();
      const originalOpen= xhr.open;
      const originalSend= xhr.send;
      let method = '';
      let url    = '';

      xhr.open = function(_method, _url, ...rest) {
        method = _method.toUpperCase();
        url    = _url;
        return originalOpen.apply(xhr, [_method, _url, ...rest]);
      };

      xhr.send = function(body) {
        const startTime   = Date.now();
        const actionChain = userActionSequence.slice(-5);

        // Phase 10: body size guard
        let bodyStr = null;
        if (body !== null && body !== undefined) {
          bodyStr = typeof body === 'string' ? body : null;
          if (bodyStr && bodyStr.length > 500000) bodyStr = '[TRUNCATED - body too large]';
        }

        const bodyObj = parseBodyAsObject(bodyStr);
        const graphql = detectGraphQL(url, bodyObj);
        const tags    = [];
        if (graphql?.isGraphQL)           tags.push('graphql');
        if (graphql?.type === 'mutation') tags.push('mutation', 'important');

        const captureData = {
          id          : `xhr_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
          type        : 'xhr',
          method      : method,
          url         : url,
          requestBody : bodyStr,
          timestamp   : startTime,
          capturedAt  : new Date().toISOString(),
          graphql     : graphql,
          tags        : tags,
          trigger     : {
            lastAction : actionChain[actionChain.length - 1] || null,
            actionChain: actionChain
          }
        };

        xhr.addEventListener('load', function() {
          captureData.status   = xhr.status;
          captureData.duration = Date.now() - startTime;
          if (xhr.status >= 400) captureData.tags = [...(captureData.tags || []), 'failed'];

          try {
            if (xhr.responseType === '' || xhr.responseType === 'text') {
              captureData.responseBody     = JSON.parse(xhr.responseText);
              captureData.responseBodyType = 'json';
            } else {
              captureData.responseBody     = xhr.response;
              captureData.responseBodyType = 'binary';
            }
          } catch (e) {
            captureData.responseBody     = xhr.responseText;
            captureData.responseBodyType = 'text';
          }

          captureCount++;
          if (isSniffing) {
            sendToBackground(captureData);
            window.__capturedRequests.push(captureData);
          }
        });

        xhr.addEventListener('error', function() {
          captureData.error = 'Network error';
          captureData.tags  = [...(captureData.tags || []), 'failed'];
          captureCount++;
          if (isSniffing) {
            sendToBackground(captureData);
            window.__capturedRequests.push(captureData);
          }
        });

        return originalSend.apply(xhr, arguments);
      };

      return xhr;
    };
  }

  // ============================================
  // PHASE 3: User Action Tracking
  // ============================================
  const trackUserAction = (type, target, extra = {}) => {
    let className = '';
    if (target.className) {
      className = typeof target.className === 'string'
        ? target.className
        : (typeof target.className.baseVal === 'string' ? target.className.baseVal : '');
    }

    const record = {
      type     : type,
      target   : target.tagName || 'unknown',
      selector : target.id
        ? `#${target.id}`
        : (className ? `.${className.split(' ')[0]}` : target.tagName),
      text     : target.textContent?.trim().substring(0, 60) || '',
      timestamp: Date.now(),
      ...extra
    };

    userActionSequence.push(record);
    if (userActionSequence.length > 100) userActionSequence.shift();
  };

  document.addEventListener('click',  (e) => trackUserAction('click',  e.target), true);
  document.addEventListener('submit', (e) => trackUserAction('submit', e.target), true);
  document.addEventListener('keyup',  (e) => {
    if (e.key === 'Enter') trackUserAction('keyenter', e.target);
  }, true);

  // ============================================
  // MESSAGE LISTENER
  // ============================================
  if (hasChromeRuntime) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'triggerCapture') {
        sendResponse({
          success       : true,
          status        : isSniffing ? 'sniffing' : 'paused',
          capturedCount : captureCount,
          storedCount   : window.__capturedRequests.length,
          trackedActions: userActionSequence.length
        });
      }

      if (message.action === 'setSniffingState') {
        isSniffing = message.enabled;
        sendResponse({ success: true, isSniffing });
      }

      if (message.action === 'getSniffingState') {
        sendResponse({ isSniffing, capturedCount: captureCount, storedCount: window.__capturedRequests.length });
      }

      if (message.action === 'getCapturedRequests') {
        sendResponse({ requests: window.__capturedRequests });
      }

      if (message.action === 'getUserActions') {
        sendResponse({ actions: userActionSequence });
      }

      if (message.action === 'clearCapturedRequests') {
        window.__capturedRequests = [];
        captureCount = 0;
        sendResponse({ success: true });
      }

      if (message.action === 'clearUserActions') {
        userActionSequence = [];
        sendResponse({ success: true });
      }

      return true;
    });
  }

  document.documentElement.setAttribute('data-api-sniffer', 'active');
  console.log('[WiretapSuite v2] Content script loaded on:', window.location.href);
})();
