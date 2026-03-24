// ============================================
// WIRETAPSUITE v2.0 - BACKGROUND SERVICE WORKER
// Phases: GraphQL, Replay Engine, Schema, CDP, Safety
// ============================================

// Track global sniffing state
let globalSniffingState = true;
let deepCaptureEnabled = true;   // Phase 10: toggleable deep CDP body fetch

// Load saved state on startup
chrome.storage.local.get(['isSniffing', 'deepCapture'], (result) => {
  globalSniffingState = result.isSniffing ?? true;
  deepCaptureEnabled  = result.deepCapture ?? true;
  console.log('[WiretapSuite] Loaded state, sniffing:', globalSniffingState, 'deep:', deepCaptureEnabled);
});

// Suppress connection-closed errors
const _origConsoleError = console.error;
console.error = function(...args) {
  if (args[0] && args[0].includes && args[0].includes('Could not establish connection')) return;
  _origConsoleError.apply(console, args);
};

// CDP debugger sessions
const cdpSessions = new Map();

// ============================================
// STORAGE WRITE DEBOUNCE (Phase 10)
// ============================================
let _writeBuffer = null;
let _writeTimer  = null;
const WRITE_DEBOUNCE_MS = 300;

function debouncedWriteRequests(requests) {
  _writeBuffer = requests;
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    if (_writeBuffer !== null) {
      chrome.storage.local.set({ capturedRequests: _writeBuffer });
      _writeBuffer = null;
    }
    _writeTimer = null;
  }, WRITE_DEBOUNCE_MS);
}

// ============================================
// PHASE 1 & 5: GraphQL Detection
// ============================================
function parseBodyAsObject(body) {
  if (!body) return null;
  if (typeof body === 'object') return body;
  const str = typeof body === 'string' ? body : String(body);
  // Try JSON
  try { return JSON.parse(str); } catch (_) {}
  // Try URLSearchParams
  try {
    const params = {};
    new URLSearchParams(str).forEach((v, k) => { params[k] = v; });
    if (Object.keys(params).length > 0) return params;
  } catch (_) {}
  return null;
}

function detectGraphQL(url, bodyObj) {
  const urlStr = typeof url === 'string' ? url : '';
  const isGQLUrl = urlStr.includes('/graphql') || urlStr.includes('graphql?') || urlStr.includes('/api/graphql');

  if (!bodyObj) return null;

  const hasDocId    = 'doc_id' in bodyObj;
  const hasFriendly = 'fb_api_req_friendly_name' in bodyObj;
  const hasVariables= 'variables' in bodyObj;
  const hasQuery    = 'query' in bodyObj && typeof bodyObj.query === 'string';

  if (!isGQLUrl && !hasDocId && !hasFriendly && !hasQuery) return null;

  const friendlyName = bodyObj.fb_api_req_friendly_name || bodyObj.operationName || null;
  const docId        = bodyObj.doc_id || bodyObj.documentId || null;

  let variables = null;
  if (bodyObj.variables) {
    variables = typeof bodyObj.variables === 'string'
      ? parseBodyAsObject(bodyObj.variables)
      : bodyObj.variables;
  }

  // Mutation detection
  const nameLower = (friendlyName || '').toLowerCase();
  const queryStr  = (bodyObj.query || '').toLowerCase();
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
// PHASE 2: Replay Bundle Generator
// ============================================
const UNSTABLE_HEADERS = [
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version',
  'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-full-version-list',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
  'content-length', 'rtt', 'downlink', 'ect', 'priority',
  'if-none-match', 'if-modified-since', 'cache-control'
];

const DYNAMIC_TOKEN_KEYS = [
  'fb_dtsg', 'lsd', 'csrf', 'csrf_token', '_token', 'x-csrftoken',
  'x-csrf-token', '__requestverificationtoken', 'authenticity_token',
  'access_token', 'refresh_token', 'bearer', 'api_key', 'apikey',
  'client_secret', '__dyn', '__spin_b', '__spin_r', '__spin_t',
  '__bbox', 'jazoest'
];

function isDynamicKey(key) {
  const lower = key.toLowerCase().replace(/-/g, '_');
  return DYNAMIC_TOKEN_KEYS.some(t => lower.includes(t));
}

function sanitizeHeaders(headers) {
  if (!headers) return {};
  const clean = {};
  const tokens = {};
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [k, v] of entries) {
    const kLower = k.toLowerCase();
    if (UNSTABLE_HEADERS.some(u => kLower === u || kLower.startsWith('sec-ch'))) continue;
    if (isDynamicKey(k)) {
      tokens[k] = 'dynamic';
      clean[k] = '[DYNAMIC]';
    } else {
      clean[k] = v;
    }
  }
  return { headers: clean, tokens };
}

function sanitizeBody(bodyObj) {
  if (!bodyObj) return { body: null, tokens: {} };
  const tokens = {};
  const sanitize = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    const out = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
      if (isDynamicKey(k)) {
        tokens[k] = 'dynamic';
        out[k] = '[DYNAMIC]';
      } else if (typeof v === 'object' && v !== null) {
        out[k] = sanitize(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  };
  return { body: sanitize(bodyObj), tokens };
}

function buildReplayBundle(req) {
  try {
    const url     = req.url || '';
    const method  = req.method || 'GET';
    const { headers: cleanHeaders, tokens: headerTokens } = sanitizeHeaders(req.requestHeaders);
    const bodyObj = parseBodyAsObject(req.requestBody);
    const { body: cleanBody, tokens: bodyTokens } = sanitizeBody(bodyObj);
    const allTokens = { ...headerTokens, ...bodyTokens };

    // cURL
    let curlParts = [`curl -X ${method} "${url}"`];
    for (const [k, v] of Object.entries(cleanHeaders)) {
      curlParts.push(`  -H "${k}: ${v.replace(/"/g, '\\"')}"`);
    }
    if (cleanBody && method !== 'GET') {
      curlParts.push(`  -d '${JSON.stringify(cleanBody).replace(/'/g, "'\\''")}'`);
    }
    const curlStr = curlParts.join(' \\\n');

    // Fetch
    const fetchHeadersStr = JSON.stringify(cleanHeaders, null, 2);
    const fetchBodyStr    = cleanBody ? JSON.stringify(cleanBody) : null;
    const fetchStr = `fetch("${url}", {
  method: "${method}",
  headers: ${fetchHeadersStr}${fetchBodyStr ? `,
  body: JSON.stringify(${fetchBodyStr})` : ''}
}).then(r => r.json()).then(console.log);`;

    // Axios
    const axiosStr = `axios({
  method: "${method.toLowerCase()}",
  url: "${url}",
  headers: ${JSON.stringify(cleanHeaders, null, 2)}${cleanBody ? `,
  data: ${JSON.stringify(cleanBody, null, 2)}` : ''}
}).then(r => console.log(r.data));`;

    // ── cURL (already exists, add --cookie placeholder) ──────────────────
    // Note: HttpOnly session cookies (c_user, xs, datr) must be added manually.
    // Use the Cookie Guide tab to learn how to extract them.
    let curlCookieParts = [...curlParts];
    curlCookieParts.splice(1, 0, `  --cookie "PASTE_YOUR_COOKIES_HERE"`);
    const curlWithCookies = curlCookieParts.join(' \\\n');

    // ── Python requests (FULL — with auto token refresh) ──────────────────
    const pyHeaderLines = Object.entries(cleanHeaders)
      .map(([k, v]) => `    "${k}": "${v.replace(/"/g, '\\"')}"`)
      .join(',\n');
    const rawBodyStr = typeof req.requestBody === 'string' ? req.requestBody : (cleanBody ? JSON.stringify(cleanBody) : '');
    const originUrl  = (() => { try { return new URL(url).origin; } catch { return url; } })();

    const pyBody = rawBodyStr.substring(0, 1000) + (rawBodyStr.length > 1000 ? '\n# ... truncated - paste full body from Request Body section' : '');
    let pySetupAuth = "";
    let pyFreshTokens = "";
    let pyHeadersMod = "";

    if (originUrl.includes("instagram.com")) {
      pySetupAuth = `SESSION_COOKIES = {\\n    "sessionid": "YOUR_SESSIONID",\\n    "csrftoken": "YOUR_CSRFTOKEN",\\n}`;
      pyFreshTokens = `csrftoken = session.cookies.get("csrftoken")\\nprint(f"Fresh token: {csrftoken}")`;
      pyHeadersMod = `if csrftoken:\\n    headers["X-CSRFToken"] = csrftoken`;
    } else if (originUrl.includes("linkedin.com")) {
      pySetupAuth = `SESSION_COOKIES = {\\n    "li_at": "YOUR_LI_AT",\\n    "JSESSIONID": "\\"ajax:YOUR_JSESSIONID\\"",\\n}`;
      pyFreshTokens = `jsessionid = session.cookies.get("JSESSIONID", "").strip('"')\\nprint(f"Fresh token: {jsessionid}")`;
      pyHeadersMod = `if jsessionid:\\n    headers["Csrf-Token"] = jsessionid`;
    } else if (originUrl.includes("youtube.com")) {
      pySetupAuth = `SESSION_COOKIES = {\\n    "SAPISID": "YOUR_SAPISID",\\n    "LOGIN_INFO": "YOUR_LOGIN_INFO",\\n}`;
      pyFreshTokens = `import time, hashlib\\n    sapisid = session.cookies.get("SAPISID", "")\\n    if sapisid:\\n        timestamp = int(time.time())\\n        msg = f"{timestamp} {sapisid} {originUrl}"\\n        hash_hex = hashlib.sha1(msg.encode("utf-8")).hexdigest()\\n        sapisidhash = f"SAPISIDHASH {timestamp}_{hash_hex}"\\n    else:\\n        sapisidhash = None\\n    print(f"Fresh token: {sapisidhash}")`;
      pyHeadersMod = `if sapisidhash:\\n    headers["Authorization"] = sapisidhash`;
    } else {
      pySetupAuth = `SESSION_COOKIES = {\\n    "c_user": "YOUR_C_USER",\\n    "xs": "YOUR_XS",\\n    "datr": "YOUR_DATR",\\n}`;
      pyFreshTokens = `page = session.get("${originUrl}")\\n    html = page.text\\n    dtsg_m  = re.search(r'"DTSGInitData"[^[]*\\\\[[^\\\\]]*\\\\],\\\\{"token":"([^"]+)"', html)\\n    lsd_m   = re.search(r'"LSD"[^[]*\\\\[[^\\\\]]*\\\\],\\\\{"token":"([^"]+)"', html)\\n    fb_dtsg = dtsg_m.group(1) if dtsg_m else None\\n    lsd     = lsd_m.group(1)  if lsd_m  else None\\n    print(f"Fresh tokens: fb_dtsg={fb_dtsg}, lsd={lsd}")\\n    if fb_dtsg: params["fb_dtsg"] = fb_dtsg\\n    if lsd:     params["lsd"]     = lsd\\n`;
      pyHeadersMod = ``;
    }

    const pythonStr = [
      '#!/usr/bin/env python3',
      '# Auto-generated by WiretapSuite — Full Token-Refresh Flow',
      '# pip install requests',
      'import requests, re, json',
      '',
      '# ── Step 1: Set session cookies from DevTools ─────────────────',
      '# DevTools → Application → Cookies → ' + originUrl,
      pySetupAuth,
      '',
      '# ── Step 2: Create a session (carries cookies automatically) ───',
      'session = requests.Session()',
      'session.cookies.update(SESSION_COOKIES)',
      'session.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})',
      '',
      '# ── Step 3: Fetch fresh CSRF tokens ─────────────────────────────',
      '# Paste your captured body from the Request Body tab:',
      'CAPTURED_BODY = """' + pyBody + '"""',
      '',
      'params = {}',
      'for pair in CAPTURED_BODY.split("&"):',
      '    if "=" in pair:',
      '        k, v = pair.split("=", 1)',
      '        params[k] = v',
      '',
      '    ' + pyFreshTokens.replace(/\\n/g, '\\n    '),
      '',
      '# ── Step 4: Send the request ─────────────────────────────────────',
      'headers = {',
      pyHeaderLines,
      '}',
      pyHeadersMod.replace(/\\n/g, '\\n'),
      '',
      `response = session.${method.toLowerCase()}(`,
      `    "${url}",`,
      '    data=params,',
      '    headers={k: v for k, v in headers.items() if k.lower() != "content-length"},',
      ')',
      '',
      '# ── Step 5: Parse (strip XSSI prefix) ───────────────────────────',
      'text  = response.text',
      'clean = re.sub(r"^for \\(;;\\);|while\\(1\\);|throw 1;", "", text).strip()',
      'try:',
      '    data = json.loads(clean)',
      '    if isinstance(data, dict) and data.get("error") in [1357004, 1357001]:',
      '        print(f"CSRF error {data[\'error\']}: {data.get(\'errorSummary\')} — run again for fresh tokens")',
      '    else:',
      '        print(f"Status: {response.status_code}")',
      '        print(json.dumps(data, indent=2))',
      'except json.JSONDecodeError:',
      '    print(text[:500])',
    ].join('\\n') + '\\n';

    // ── n8n HTTP Request node (JSON) ──────────────────────────────────────
    const n8nHeaders = Object.entries(cleanHeaders).map(([name, value]) => ({ name, value }));
    const n8nNode = {
      name: `Replay: ${method} ${url.replace(/\?.*/, '').split('/').pop() || url}`,
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      parameters: {
        method: method.toUpperCase(),
        url: url,
        sendHeaders: true,
        headerParameters: { parameters: n8nHeaders },
        sendBody: !!(cleanBody && method !== 'GET'),
        contentType: 'raw',
        rawContentType: req.requestHeaders?.['content-type'] || 'application/x-www-form-urlencoded',
        body: typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(cleanBody),
        options: {}
      },
      _note: "⚠️ Add an HTTP Request node BEFORE this one that sets Authorization or Cookie headers via Set Variables, OR use 'Send Cookie Header' option in the node. See Cookie Guide tab."
    };
    const n8nStr = `// Paste this into an n8n Code node or use the JSON below in HTTP Request node:
// ─────────────────────────────────────────────────
// 1. In n8n, add an "HTTP Request" node
// 2. Set Method: ${method.toUpperCase()}
// 3. Set URL: ${url}
// 4. Under "Headers" add all the headers below
// 5. Under "Body" → Raw → paste the body below
// 6. IMPORTANT: Also add a "Cookie" header with your session cookies
//    (see Cookie Guide tab for how to extract them)
//
// ── HTTP Request node config (JSON) ──────────────
${JSON.stringify(n8nNode, null, 2)}`;

    // ── Cloudflare Worker / Node.js fetch (with cookies) ─────────────────
    const workerStr = `// Cloudflare Worker / Node.js / Deno / Bun
// ✅ Works with any runtime that supports fetch()

const COOKIES = "PASTE_YOUR_COOKIE_STRING_HERE";
// Example: "c_user=123456; xs=Abc123; datr=XYZ"
// See Cookie Guide tab to learn how to extract cookies

const response = await fetch("${url}", {
  method: "${method}",
  headers: {
${Object.entries(cleanHeaders).map(([k,v]) => `    "${k}": "${v.replace(/"/g,'\\"')}"`).join(',\n')},
    "Cookie": COOKIES
  },${cleanBody ? `\n  body: \`${typeof req.requestBody === 'string' ? req.requestBody.substring(0, 800) : JSON.stringify(cleanBody)}\`${req.requestBody?.length > 800 ? '\n  // ⚠️ Body truncated — see full body in Request Body section' : ''},` : ''}
});

const text = await response.text();
// Strip XSSI prefix if present (Facebook/Meta add "for (;;);" prefix)
const json = JSON.parse(text.replace(/^for \\(;;\\);|while\\(1\\);|throw 1;/, '').trim());
console.log(json);`;

    // ── Cookie Extraction Guide ───────────────────────────────────────────
    const cookieGuide = `HOW TO EXTRACT SESSION COOKIES FOR EXTERNAL REPLAY
═══════════════════════════════════════════════════════

Session cookies like c_user, xs, datr (Facebook) or sessionid, csrftoken
(Instagram/Django) are HttpOnly — JavaScript can't read them.
You must extract them from DevTools manually.

━━━ METHOD 1: DevTools → Application → Cookies (Easiest) ━━━
1. Open the target site (e.g. facebook.com)
2. Press F12 → Application tab → Storage → Cookies → [site URL]
3. Find and copy these cookie values:
   • Facebook: c_user, xs, datr, fr, sb
   • Instagram: sessionid, csrftoken, ds_user_id
   • Generic: session, .ASPXAUTH, JSESSIONID, etc.
4. Build your cookie string: "c_user=VALUE; xs=VALUE; datr=VALUE"

━━━ METHOD 2: DevTools → Network → Copy as cURL ━━━
1. Open DevTools → Network tab
2. Find the original request and right-click → "Copy" → "Copy as cURL"
3. The cURL command includes all cookies via the "-H 'Cookie: ...'" header
4. Extract the cookie string from that cURL command
5. Paste it into the Python cookies dict or fetch Cookie header

━━━ METHOD 3: document.cookie (partial — non-HttpOnly only) ━━━
In DevTools Console on the target site, run:
  document.cookie
This gives you non-HttpOnly cookies. Most CSRF tokens are here:
  fb_dtsg, lsd, jazoest → already captured in your request body ✅`;

    const tsHeaderEntries = Object.entries(cleanHeaders)
      .map(([k, v]) => `  "${k}": "${v.replace(/"/g, '\\"')}"`)
      .join(',\n');
    const rawBody     = typeof req.requestBody === 'string' ? req.requestBody : (cleanBody ? JSON.stringify(cleanBody) : null);
    const fnName      = (req.graphql?.friendlyName || 'Request').replace(/[^a-zA-Z0-9_]/g, '') || 'Request';
    const routeName   = (req.graphql?.friendlyName || 'replay').toLowerCase().replace(/[^a-z0-9]/g, '-');
    const bodySnippet = rawBody ? rawBody.substring(0, 700) + (rawBody.length > 700 ? '\n// Paste full body from the Request Body tab' : '') : '';

      let tsCookiesDoc = `// SESSION_COOKIES="c_user=...; xs=...; datr=...";`;
      let tsFreshTokensFn = ``;
      let tsSubLogic = ``;

      if (originUrl.includes("instagram.com")) {
        tsCookiesDoc = `// SESSION_COOKIES="sessionid=...; csrftoken=...";`;
        tsFreshTokensFn = `  const csrftoken = COOKIES.match(/csrftoken=([^;]+)/)?.[1];\\n  return { csrftoken };`;
        tsSubLogic = `  if (tokens.csrftoken) modifiedHeaders["X-CSRFToken"] = tokens.csrftoken;`;
      } else if (originUrl.includes("linkedin.com")) {
        tsCookiesDoc = `// SESSION_COOKIES="li_at=...; JSESSIONID=\\"ajax:...\\"";`;
        tsFreshTokensFn = `  let jsessionId = COOKIES.match(/JSESSIONID=([^;]+)/)?.[1];\\n  if (jsessionId?.startsWith('"')) jsessionId = jsessionId.slice(1, -1);\\n  return { csrfToken: jsessionId };`;
        tsSubLogic = `  if (tokens.csrfToken) modifiedHeaders["Csrf-Token"] = tokens.csrfToken;`;
      } else if (originUrl.includes("youtube.com")) {
        tsCookiesDoc = `// SESSION_COOKIES="SAPISID=...; LOGIN_INFO=...";`;
        tsFreshTokensFn = `  const sapisid = COOKIES.match(/SAPISID=([^;]+)/)?.[1];\\n  if (!sapisid) return {};\\n  const ts = Math.floor(Date.now() / 1000);\\n  const msg = \`\${ts} \${sapisid} \${ORIGIN}\`;\\n  const buffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(msg));\\n  const hash = Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");\\n  return { sapisidhash: \`SAPISIDHASH \${ts}_\${hash}\` };`;
        tsSubLogic = `  if (tokens.sapisidhash) modifiedHeaders["Authorization"] = tokens.sapisidhash;`;
      } else {
        tsCookiesDoc = `// SESSION_COOKIES="c_user=...; xs=...; datr=...";`;
        tsFreshTokensFn = `  const res  = await fetch(ORIGIN, { headers: { Cookie: COOKIES, "User-Agent": "Mozilla/5.0" } });\\n  const html = await res.text();\\n  return {\\n    fb_dtsg : html.match(/"DTSGInitData"[^[]*\\\\[[^\\\\]]*\\\\],\\\\{"token":"([^"]+)"/)?.[1],\\n    lsd     : html.match(/"LSD"[^[]*\\\\[[^\\\\]]*\\\\],\\\\{"token":"([^"]+)"/)?.[1],\\n  };`;
        tsSubLogic = `  const p = new URLSearchParams(modifiedBody);\\n  if (tokens.fb_dtsg && p.has("fb_dtsg")) p.set("fb_dtsg", tokens.fb_dtsg);\\n  if (tokens.lsd && p.has("lsd")) p.set("lsd", tokens.lsd);\\n  modifiedBody = p.toString();`;
      }

    const tsLines = [
      '// ════════════════════════════════════════════════════',
      '// TypeScript — Full Token-Refresh Flow',
      '// Node.js 18+  |  Next.js  |  Bun  |  Deno',
      '// Node.js < 18: npm install node-fetch',
      '// ════════════════════════════════════════════════════',
      '',
      '// .env / .env.local:',
      tsCookiesDoc,
      '// Get from: DevTools → Application → Cookies → ' + originUrl,
      '',
      'const ORIGIN = "' + originUrl + '";',
      'const URL    = "' + url + '";',
      'const COOKIES = process.env.SESSION_COOKIES ?? "PASTE_COOKIE_STRING";',
      '',
      '// Captured body from Request Body tab:',
      'const CAPTURED_BODY = `' + bodySnippet + '`;',
      '',
      'function stripXSSI(text: string): string {',
      '  return text.replace(/^(for\\s*\\(;;\\);|while\\(1\\);|throw\\s+1;)/m, "").trim();',
      '}',
      '',
      'async function getFreshTokens() {',
      tsFreshTokensFn,
      '}',
      '',
      'export async function replay' + fnName + '() {',
      '  const tokens   = await getFreshTokens();',
      '  console.log("Fresh tokens:", tokens);',
      '  let modifiedBody = CAPTURED_BODY;',
      '  let modifiedHeaders: Record<string, string> = {',
      tsHeaderEntries + ',',
      '    Cookie: COOKIES,',
      '  };',
      tsSubLogic,
      '  const res = await fetch(URL, {',
      '    method : "' + method + '",',
      '    headers: modifiedHeaders,',
      '    body: modifiedBody || undefined,',
      '  });',
      '  const raw  = await res.text();',
      '  try {',
      '    const data = JSON.parse(stripXSSI(raw));',
      '    if (data?.error === 1357004) throw new Error(`CSRF still rejected: ${data.errorSummary}`);',
      '    return { status: res.status, data };',
      '  } catch (e) {',
      '    return { status: res.status, raw };',
      '  }',
      '}',
      '',
      '// ─── Next.js App Router Route Handler ────────────────',
      '// File: app/api/' + routeName + '/route.ts',
      'import { NextResponse } from "next/server";',
      'export async function POST() {',
      '  const result = await replay' + fnName + '();',
      '  return NextResponse.json(result);',
      '}',
      '',
      '// Usage: replay' + fnName + '().then(console.log).catch(console.error);',
    ];
    const typescriptStr = tsLines.join('\\n') + '\\n';

    // ── Platform Guides ──────────────────────────────────────────────────────
    const sseWarning = (originUrl.includes('chatgpt.com') || originUrl.includes('openai.com') || originUrl.includes('gemini.google.com') || url.includes('streamGenerateContent') || url.includes('/conversation')) 
      ? [
          '🚨 >>> WARNING: SSE STREAMING ENDPOINT DETECTED <<< 🚨',
          'This API uses Server-Sent Events (SSE) to stream text chunks.',
          'Standard fetch() or requests.post() will HANG or fail to parse JSON.',
          'You MUST use an SSE client (like `eventsource` in Node or `httpx` stream in Python)',
          'to properly read the chunked responses from this endpoint.',
          'The snippets provided here will only capture the request headers/body.',
          '══════════════════════════════════════════════════════════════',
          ''
        ]
      : [];

    const guideLines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║  COMPLETE GUIDE — Replay in External Automation Tools        ║',
      '║  ' + method + ' ' + (url.replace(/\\?.*/, '').split('/').slice(-1)[0] || url).substring(0, 50).padEnd(50) + ' ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
      ...sseWarning,
      'The key pattern for ALL platforms:',
      '  1. Send GET to origin with session cookies → parse HTML for fresh fb_dtsg/lsd',
      '  2. Substitute fresh tokens into captured body',
      '  3. POST mutation with fresh body + session cookies',
      '',
      '━━━ STEP 0: GET YOUR SESSION COOKIES (one-time) ━━━━━━━━━━━━━━',
      'DevTools → Application → Cookies → ' + originUrl,
      'Copy: c_user, xs, datr  (for Facebook/Meta)',
      'OR:   right-click any Network request → Copy as cURL → get the Cookie header value',
      'Store as: SESSION_COOKIES env variable in all platforms below.',
      '',
      '━━━ PYTHON ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'pip install requests',
      'See the 🐍 Python tab for the complete runnable script.',
      'Key steps:',
      '  session = requests.Session()',
      '  session.cookies.update({"c_user":"...", "xs":"...", "datr":"..."})',
      '  page    = session.get("' + originUrl + '")',
      '  fb_dtsg = re.search(r\'"DTSGInitData".*?"token":"([^"]+)"\', page.text, re.S).group(1)',
      '  params["fb_dtsg"] = fb_dtsg',
      '  response = session.post("' + url + '", data=params)',
      '',
      '━━━ TYPESCRIPT / NODE.JS (18+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'See the 📘 TypeScript tab for the complete file.',
      'Quick run: npx tsx yourfile.ts',
      'Add to .env.local: SESSION_COOKIES="c_user=...; xs=...; datr=..."',
      'For Node < 18: npm install node-fetch',
      '',
      '━━━ NEXT.JS API ROUTE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '1. Copy 📘 TypeScript tab → save as app/api/' + routeName + '/route.ts',
      '2. Add to .env.local: SESSION_COOKIES="c_user=...; xs=..."',
      '3. Access via: POST /api/' + routeName,
      '',
      '━━━ N8N WORKFLOW (4 nodes) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      'NODE 1 — HTTP Request (GET fresh tokens)',
      '  Method:  GET',
      '  URL:     ' + originUrl,
      '  Headers: Cookie → {{ $env.SESSION_COOKIES }}',
      '  Options: Full Response = ON',
      '',
      'NODE 2 — Code (extract & substitute tokens)',
      '  const html    = $input.first().json.body;',
      '  const fb_dtsg = html.match(/"DTSGInitData"[^[]*\\[[^\\]]*\\],\\{"token":"([^"]+)"/)?.[1];',
      '  const lsd     = html.match(/"LSD"[^[]*\\[[^\\]]*\\],\\{"token":"([^"]+)"/)?.[1];',
      '  const captured = $env.CAPTURED_BODY;   // paste your full body here as n8n var',
      '  const params  = new URLSearchParams(captured);',
      '  if (fb_dtsg) params.set("fb_dtsg", fb_dtsg);',
      '  if (lsd)     params.set("lsd", lsd);',
      '  return [{ json: { freshBody: params.toString() } }];',
      '',
      'NODE 3 — HTTP Request (send mutation)',
      '  Method:  ' + method,
      '  URL:     ' + url,
      '  Headers: Cookie       → {{ $env.SESSION_COOKIES }}',
      '           Content-Type → application/x-www-form-urlencoded',
      '  Body:    Raw → {{ $json.freshBody }}',
      '',
      'NODE 4 — Code (parse XSSI-prefixed response)',
      '  const raw  = $input.first().json.body ?? JSON.stringify($input.first().json);',
      '  const data = JSON.parse(raw.replace(/^for \\(;;\\);|while\\(1\\);/, "").trim());',
      '  return [{ json: data }];',
      '',
      'n8n notes:',
      '  • Set SESSION_COOKIES in n8n → Settings → Variables',
      '  • Set CAPTURED_BODY (full body from Request Body tab) as an n8n Variable',
      '  • n8n does NOT auto-carry cookies between nodes — always send Cookie header',
      '',
      '━━━ CLOUDFLARE WORKER / BUN / DENO ━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'See the ⚡ Worker tab. Add SESSION_COOKIES as an environment secret.',
      'The token-refresh logic is identical to TypeScript — just remove the types.',
      '',
      '━━━ CURL (manual one-off) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '1. DevTools Network → find page load request → Copy as cURL',
      '2. Extract the -H "Cookie: ..." value',
      '3. Use 🍪 cURL+Cookie tab and replace PASTE_YOUR_COOKIES_HERE',
      '4. Tokens expire fast — run immediately after copying',
      '',
      '━━━ KEY FACTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '• session cookies (xs, c_user): ~90 days lifetime',
      '• CSRF tokens (fb_dtsg, lsd):   refresh every request — scripts do this auto',
      '• Add 1-3s delays between calls to avoid rate limits',
      '• Store cookies in env vars — never hardcode in source',
    ];
    const platformGuides = guideLines.join('\n');

    return {
      curl          : curlStr,
      curlCookies   : curlWithCookies,
      fetch         : fetchStr,
      axios         : axiosStr,
      python        : pythonStr,
      typescript    : typescriptStr,
      n8n           : n8nStr,
      worker        : workerStr,
      cookieGuide   : cookieGuide,
      platformGuides: platformGuides,
      sanitized     : { url, method, headers: cleanHeaders, body: cleanBody },
      tokens        : allTokens
    };

  } catch (e) {
    return null;
  }
}

// ============================================
// PHASE 7: API Schema Extraction
// ============================================
function updateApiSchema(captureData) {
  const gql = captureData.graphql;
  if (!gql || !gql.isGraphQL || !gql.friendlyName) return;

  chrome.storage.local.get(['apiSchema'], (result) => {
    const schema = result.apiSchema || {};
    const name   = gql.friendlyName;

    if (!schema[name]) {
      schema[name] = { type: gql.type, variablesShape: {}, samplePayloads: [] };
    }

    // Merge variable keys
    if (gql.variables && typeof gql.variables === 'object') {
      const extractShape = (obj, depth = 0) => {
        if (depth > 3 || typeof obj !== 'object' || !obj) return typeof obj;
        const shape = {};
        for (const [k, v] of Object.entries(obj)) {
          shape[k] = typeof v === 'object' && v !== null ? extractShape(v, depth + 1) : typeof v;
        }
        return shape;
      };
      Object.assign(schema[name].variablesShape, extractShape(gql.variables));
    }

    // Keep up to 3 sample payloads
    if (schema[name].samplePayloads.length < 3) {
      schema[name].samplePayloads.push({
        capturedAt : captureData.capturedAt,
        variables  : gql.variables
      });
    }

    chrome.storage.local.set({ apiSchema: schema });
  });
}

// ============================================
// CDP - CHROME DEVTOOLS PROTOCOL
// ============================================
async function attachDebugger(tabId) {
  if (cdpSessions.has(tabId)) return cdpSessions.get(tabId);
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    cdpSessions.set(tabId, { attached: true, timestamp: Date.now() });
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
      maxTotalBufferSize  : 10000000,
      maxResourceBufferSize: 5000000
    });
    await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Response' }]
    });
    console.log(`[CDP] Attached to tab ${tabId}`);
    return true;
  } catch (e) {
    console.error('[CDP] Attach failed:', e.message);
    return false;
  }
}

async function detachDebugger(tabId) {
  if (!cdpSessions.has(tabId)) return;
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Fetch.disable');
    await chrome.debugger.sendCommand({ tabId }, 'Network.disable');
    await chrome.debugger.detach({ tabId });
    cdpSessions.delete(tabId);
    console.log(`[CDP] Detached from tab ${tabId}`);
  } catch (e) {
    console.error('[CDP] Detach failed:', e.message);
  }
}

// Phase 5: Enhanced response body retrieval with mime-type awareness
async function getResponseBody(tabId, requestId, mimeType) {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId }, 'Network.getResponseBody', { requestId }
    );

    let body = result.body;

    // Decode base64
    if (result.base64Encoded) {
      try {
        const binary = atob(body);
        // Check if it's readable UTF-8 text
        body = binary;
      } catch (_) {
        return { data: '[Binary data - base64]', type: 'binary' };
      }
    }

    // Detect content type
    const mime = (mimeType || '').toLowerCase();
    if (mime.includes('json') || (body.trimStart().startsWith('{') || body.trimStart().startsWith('['))) {
      try {
        return { data: JSON.parse(body), type: 'json' };
      } catch (_) {}
    }
    if (mime.includes('html')) return { data: body, type: 'html' };
    return { data: body, type: 'text' };
  } catch (e) {
    return null;
  }
}

// Parse cookies from Set-Cookie response header
function parseCookiesFromHeaders(headers) {
  const cookies = {};
  if (!headers) return cookies;
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [k, v] of entries) {
    if (k.toLowerCase() === 'set-cookie') {
      // Can be a string "name=value; Path=/; ..." or array
      const parts = (typeof v === 'string' ? v : String(v)).split(';');
      if (parts[0].includes('=')) {
        const [name, val] = parts[0].split('=');
        cookies[name.trim()] = val?.trim() || '';
      }
    }
  }
  return cookies;
}

// ============================================
// CDP EVENT LISTENER
// ============================================
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (!globalSniffingState) return;
  const tabId = source.tabId;

  // --- Request initiated ---
  if (method === 'Network.requestWillBeSent') {
    const { requestId, request, timestamp, type, initiator } = params;
    if (type === 'Document') return;

    // Phase 10: body size guard
    let reqBody = request.postData || null;
    if (reqBody && reqBody.length > 500000) {
      reqBody = '[TRUNCATED - body too large]';
    }

    const bodyObj  = parseBodyAsObject(reqBody);
    const graphql  = detectGraphQL(request.url, bodyObj);
    const tags     = [];
    if (graphql?.isGraphQL)           tags.push('graphql');
    if (graphql?.type === 'mutation') tags.push('mutation', 'important');

    const captureData = {
      id            : `cdp_${requestId}`,
      type          : 'cdp',
      cdpType       : type,
      method        : request.method,
      url           : request.url,
      requestHeaders: request.headers,
      requestBody   : reqBody,
      timestamp     : timestamp * 1000,
      capturedAt    : new Date().toISOString(),
      tabId         : tabId,
      initiator     : initiator,
      graphql       : graphql,
      tags          : tags
    };

    // Replay bundle
    captureData.replay = buildReplayBundle(captureData);

    chrome.storage.local.get(['pendingCDPRequests'], (result) => {
      const pending = result.pendingCDPRequests || {};
      pending[requestId] = captureData;
      chrome.storage.local.set({ pendingCDPRequests: pending });
    });
  }

  // --- Response received ---
  if (method === 'Network.responseReceived') {
    const { requestId, response, type, timestamp } = params;

    chrome.storage.local.get(['pendingCDPRequests'], async (result) => {
      const pending = result.pendingCDPRequests || {};
      const captureData = pending[requestId];
      if (!captureData) return;

      captureData.status         = response.status;
      captureData.statusText     = response.statusText;
      captureData.responseHeaders= response.headers;
      captureData.mimeType       = response.mimeType;
      captureData.encodedDataLength = response.encodedDataLength;
      captureData.duration       = (timestamp - (captureData.timestamp / 1000)) * 1000;

      // Phase 5: parse response cookies
      captureData.responseCookies = parseCookiesFromHeaders(response.headers);

      // Phase 5: deep response body (only when deep capture enabled)
      if (deepCaptureEnabled) {
        const bodyResult = await getResponseBody(tabId, requestId, response.mimeType);
        if (bodyResult) {
          captureData.responseBody     = bodyResult.data;
          captureData.responseBodyType = bodyResult.type;

          // Phase 7: schema update after we have response context
          if (captureData.graphql?.isGraphQL) {
            updateApiSchema(captureData);
          }
        }
      }

      // Auth tokens
      captureData.authTokens         = extractAuthFromHeaders(captureData.requestHeaders);
      captureData.responseAuthTokens = extractAuthFromHeaders(captureData.responseHeaders);

      // Forward to popup
      chrome.runtime.sendMessage({ type: 'newRequest', data: captureData }).catch(() => {});

      // Store
      chrome.storage.local.get(['capturedRequests'], (r) => {
        const requests = r.capturedRequests || [];
        requests.unshift(captureData);
        if (requests.length > 1000) requests.length = 1000;
        debouncedWriteRequests(requests);
      });

      delete pending[requestId];
      chrome.storage.local.set({ pendingCDPRequests: pending });
    });
  }

  // --- Loading finished (update encoded size) ---
  if (method === 'Network.loadingFinished') {
    const { requestId, encodedDataLength } = params;
    chrome.storage.local.get(['pendingCDPRequests'], (result) => {
      const pending = result.pendingCDPRequests || {};
      if (pending[requestId]) pending[requestId].encodedDataLength = encodedDataLength;
    });
  }

  // --- Request failed ---
  if (method === 'Network.loadingFailed') {
    const { requestId, errorText, canceled } = params;
    chrome.storage.local.get(['pendingCDPRequests'], (result) => {
      const pending     = result.pendingCDPRequests || {};
      const captureData = pending[requestId];
      if (!captureData) return;

      captureData.error    = errorText;
      captureData.canceled = canceled;
      captureData.tags     = [...(captureData.tags || []), 'failed'];

      chrome.runtime.sendMessage({ type: 'newRequest', data: captureData }).catch(() => {});

      chrome.storage.local.get(['capturedRequests'], (r) => {
        const requests = r.capturedRequests || [];
        requests.unshift(captureData);
        if (requests.length > 1000) requests.length = 1000;
        debouncedWriteRequests(requests);
      });

      delete pending[requestId];
      chrome.storage.local.set({ pendingCDPRequests: pending });
    });
  }

  // Fetch.requestPaused – just continue
  if (method === 'Fetch.requestPaused') {
    chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', {
      requestId: params.requestId
    }).catch(() => {});
  }
});

// Tab closed → detach
chrome.tabs.onRemoved.addListener(async (tabId) => { await detachDebugger(tabId); });

// ============================================
// HELPER: Extract auth tokens from headers
// ============================================
function extractAuthFromHeaders(headers) {
  if (!headers) return {};
  const authPatterns = [
    'authorization', 'auth', 'token', 'apikey', 'api-key', 'x-api-key',
    'x-auth-token', 'x-access-token', 'x-csrf-token', 'csrf-token',
    'x-xsrf-token', 'xsrf-token', 'cookie', 'set-cookie',
    'x-requested-with', 'origin', 'referer'
  ];
  const auth    = {};
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [key, value] of entries) {
    if (authPatterns.some(p => key.toLowerCase().includes(p))) {
      auth[key] = value;
    }
  }
  return auth;
}

// ============================================
// CSRF TOKEN AUTO-REFRESH (Phase 2 enhancement)
// ============================================
/**
 * Fetches the origin page (e.g. facebook.com) with credentials:include,
 * parses the HTML for fresh fb_dtsg, lsd, jazoest values.
 * Facebook embeds these tokens in every page response.
 */
async function getCSRFTokens(originUrl) {
  try {
    const origin = new URL(originUrl).origin; // e.g. "https://www.facebook.com"

    // --- INSTAGRAM ---
    if (origin.includes('instagram.com')) {
      const cookie = await chrome.cookies.get({ url: origin, name: 'csrftoken' });
      return cookie ? { csrftoken: cookie.value } : null;
    }

    // --- LINKEDIN ---
    if (origin.includes('linkedin.com')) {
      const cookie = await chrome.cookies.get({ url: origin, name: 'JSESSIONID' });
      let val = cookie ? cookie.value : null;
      if (val && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      return val ? { csrfToken: val } : null;
    }

    // --- YOUTUBE ---
    if (origin.includes('youtube.com')) {
      const cookie = await chrome.cookies.get({ url: origin, name: 'SAPISID' });
      if (!cookie || !cookie.value) return null;
      
      const sapisid = cookie.value;
      const timestamp = Math.floor(Date.now() / 1000);
      const msg = `${timestamp} ${sapisid} ${origin}`;
      
      const encoder = new TextEncoder();
      const data = encoder.encode(msg);
      const hashBuffer = await crypto.subtle.digest('SHA-1', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      return { sapisidhash: `SAPISIDHASH ${timestamp}_${hashHex}` };
    }

    // --- FACEBOOK (default fallback) ---
    const res = await fetch(origin, {
      credentials: 'include',
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'User-Agent': navigator.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    // ── fb_dtsg ──────────────────────────────────────────────────────────
    // Pattern 1: "DTSGInitData",[],{"token":"AQxxx"}
    let fb_dtsg = null;
    const dtsgPat = [
      /"DTSGInitData"[^[]*\[[^\]]*\],\{"token":"([^"]+)"/,
      /"DTSGInitData",\[\],\{"token":"([^"]+)"/,
      /name="fb_dtsg" value="([^"]+)"/,
      /"fb_dtsg":\{"token":"([^"]+)"/,
      /"token":"(AQ[^"]{10,})"/,       // fb_dtsg always starts with AQ
    ];
    for (const pat of dtsgPat) {
      const m = html.match(pat);
      if (m) { fb_dtsg = m[1]; break; }
    }

    // ── lsd ──────────────────────────────────────────────────────────────
    // Pattern: "LSD",[],{"token":"AVp..."}
    let lsd = null;
    const lsdPat = [
      /"LSD"[^[]*\[[^\]]*\],\{"token":"([^"]+)"/,
      /"LSD",\[\],\{"token":"([^"]+)"/,
      /name="lsd" value="([^"]+)"/,
      /"lsd":"([^"]+)"/,
    ];
    for (const pat of lsdPat) {
      const m = html.match(pat);
      if (m) { lsd = m[1]; break; }
    }

    // ── jazoest ──────────────────────────────────────────────────────────
    let jazoest = null;
    const jPat = [
      /name="jazoest" value="([^"]+)"/,
      /"jazoest":"([^"]+)"/,
      /jazoest=(\d{5,})/,
    ];
    for (const pat of jPat) {
      const m = html.match(pat);
      if (m) { jazoest = m[1]; break; }
    }

    if (!fb_dtsg && !lsd) return null;   // couldn't extract anything useful

    return { fb_dtsg, lsd, jazoest };
  } catch (e) {
    console.warn('[APISnifferPro] getCSRFTokens failed:', e.message);
    return null;
  }
}

/**
 * Substitutes fresh CSRF token values into a request body string.
 * Handles both URL-encoded ("fb_dtsg=OLD&lsd=OLD") and
 * JSON bodies ({"fb_dtsg":"OLD","lsd":"OLD"}).
 */
function substituteCSRFTokens(body, freshTokens) {
  if (!body || typeof body !== 'string' || !freshTokens) return body;
  let result = body;

  const subs = {};
  if (freshTokens.fb_dtsg) subs['fb_dtsg'] = freshTokens.fb_dtsg;
  if (freshTokens.lsd)     subs['lsd']     = freshTokens.lsd;
  if (freshTokens.jazoest) subs['jazoest'] = freshTokens.jazoest;

  // Strict Regex Substitution to prevent JSON payload corruption caused by URLSearchParams


  // Fallback: simple regex replace on raw string
  for (const [k, freshVal] of Object.entries(subs)) {
    if (!freshVal) continue;
    // URL-encoded value (percent-encoded or plain)
    result = result.replace(
      new RegExp(`((?:^|&)${k}=)[^&"]+`, 'g'),
      (_, prefix) => prefix + encodeURIComponent(freshVal)
    );
    // JSON string value
    result = result.replace(
      new RegExp(`("${k}"\\s*:\\s*")[^"]+"`, 'g'),
      (_, prefix) => `${prefix}${freshVal}"`
    );
  }

  // ---------------------------------------------------------
  // IDEMPOTENCY KEY RANDOMIZATION (Graph API Deduplication Bypass)
  // ---------------------------------------------------------
  // Safe Idempotency Keys that prevent Create/POST duplicates across major platforms
  // (We AVOID randomizing message_id/post_id as that breaks Edit/Delete actions)

  // URL-Encoded variables JSON: %22client_msg_id%22%3A%22<uuid>%22 (Slack / Chat Apps)
  result = result.replace(
    /(%22client_msg_id%22%3A%22)(.*?)(%22)/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );
  // Raw JSON variables: "client_msg_id":"<uuid>"
  result = result.replace(
    /("client_msg_id"\s*:\s*")(.*?)(")/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );

  // URL-Encoded variables JSON: %22client_context%22%3A%22<uuid>%22 (Instagram / Threads)
  result = result.replace(
    /(%22client_context%22%3A%22)(.*?)(%22)/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );
  // Raw JSON variables: "client_context":"<uuid>"
  result = result.replace(
    /("client_context"\s*:\s*")(.*?)(")/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );
  // URL-Encoded variables JSON: %22idempotency_key%22%3A%22<uuid>%22 (Stripe / General)
  result = result.replace(
    /(%22idempotency_key%22%3A%22)(.*?)(%22)/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );
  // Raw JSON variables: "idempotency_key":"<uuid>"
  result = result.replace(
    /("idempotency_key"\s*:\s*")(.*?)(")/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );
  // URL-Encoded variables JSON: %22idempotence_token%22%3A%22<uuid>%22
  result = result.replace(
    /(%22idempotence_token%22%3A%22)(.*?)(%22)/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );
  // Raw JSON variables: "idempotence_token":"<uuid>"
  result = result.replace(
    /("idempotence_token"\s*:\s*")(.*?)(")/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );
  // URL-Encoded variables JSON: %22client_mutation_id%22%3A%22<uuid>%22
  result = result.replace(
    /(%22client_mutation_id%22%3A%22)(.*?)(%22)/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );
  // Raw JSON variables: "client_mutation_id":"<uuid>"
  result = result.replace(
    /("client_mutation_id"\s*:\s*")(.*?)(")/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );
  // URL-Encoded variables JSON: %22mutation_id%22%3A%22<uuid>%22
  result = result.replace(
    /(%22mutation_id%22%3A%22)(.*?)(%22)/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );
  // Raw JSON variables: "mutation_id":"<uuid>"
  result = result.replace(
    /("mutation_id"\s*:\s*")(.*?)(")/g,
    (_, prefix, val, suffix) => `${prefix}${crypto.randomUUID()}${suffix}`
  );

  return result;
}

// ============================================
// PHASE 2: XSSI / CSRF Response Parser
// ============================================
/**
 * Many APIs (Facebook, etc.) prefix responses with "(for;;);" to prevent XSSI.
 * The replay now runs with credentials:include, so session cookies ARE sent.
 * If a CSRF error still occurs, the CSRF token (fb_dtsg/lsd) in the captured
 * request body has likely expired since the request was first captured.
 */
function parseReplayResponse(raw, url) {
  let xssiWarning = null;
  let stripped    = raw;

  // Strip common XSSI guards
  const xssiPrefixes = ['for (;;);', 'while(1);', 'throw 1;', ')]}\'', '])\'\n'];
  for (const prefix of xssiPrefixes) {
    if (stripped.startsWith(prefix)) {
      stripped = stripped.slice(prefix.length).trimStart();
      break;  // prefix stripped silently — cookies are sent via credentials:include
    }
  }

  // Try to parse JSON
  let body = stripped;
  try {
    body = JSON.parse(stripped);

    // Detect common CSRF/session error codes
    if (body && typeof body === 'object') {
      const knownAuthErrors = [1357004, 1357001, 1357002, 1357003, 1357006, 1357010];
      const errorCode = body.error || body.errorCode || body.code;
      if (knownAuthErrors.includes(errorCode)) {
        xssiWarning = `🔒 CSRF token expired (error ${errorCode}): "${body.errorSummary || body.message || 'Auth required'}". Session cookies were forwarded, but the CSRF token (fb_dtsg / lsd) in your captured request body has expired. Re-capture a fresh request on the target page and replay it immediately.`;
      }
    }
  } catch (_) {
    // Not JSON — return raw text
  }

  return { body, xssiWarning };
}

// ============================================
// REPLAY FETCH DELEGATOR (Bypass WAF / Origin checks)
// ============================================
async function executeReplayFetch(url, method, headers, body) {
  try {
    const origin = new URL(url).origin;
    // Bouncing strictly limited to common strict WAF domains to avoid cross-origin CORS breaks
    const wafDomains = ['facebook.com', 'instagram.com', 'linkedin.com'];
    const needsBounce = wafDomains.some(d => origin.includes(d));

    if (needsBounce) {
      const tabs = await chrome.tabs.query({ url: `${origin}/*` });
      if (tabs.length > 0) {
        // Inject native fetch into the active tab to gain authentic Origin/Sec-Fetch headers
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: async (fUrl, fMethod, fHeaders, fBody) => {
            try {
              const res = await fetch(fUrl, {
                method: fMethod,
                headers: fHeaders,
                body: fBody,
                credentials: 'include'
              });
              return {
                status: res.status,
                statusText: res.statusText,
                headers: Object.fromEntries(res.headers.entries()),
                text: await res.text()
              };
            } catch (err) {
              return { error: err.message };
            }
          },
          args: [url, method, headers, body]
        });

        if (results && results[0] && results[0].result && !results[0].result.error) {
          return results[0].result;
        }
      }
    }
  } catch (e) {
    console.warn('[WiretapSuite] Tab delegation failed, falling back to background fetch:', e);
  }

  // Native background fallback (strips Origin, may hit WAF but works for APIs)
  const res = await fetch(url, { method, headers, body, credentials: 'include' });
  return {
    status: res.status,
    statusText: res.statusText,
    headers: Object.fromEntries(res.headers.entries()),
    text: await res.text()
  };
}

// ============================================
// MESSAGE HANDLING
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Request captured from content/inject script
  if (message.action === 'requestCaptured') {
    const req = {
      id       : message.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      tabId    : sender.tab?.id,
      sourceUrl: sender.url,
      ...message
    };

    // Attach replay bundle if not already present
    if (!req.replay) req.replay = buildReplayBundle(req);

    chrome.runtime.sendMessage({ type: 'newRequest', data: req }).catch(() => {});

    chrome.storage.local.get(['capturedRequests'], (result) => {
      const requests = result.capturedRequests || [];
      requests.unshift(req);
      if (requests.length > 1000) requests.length = 1000;
      debouncedWriteRequests(requests);

      // Phase 7: schema extraction
      if (req.graphql?.isGraphQL) updateApiSchema(req);
    });

    sendResponse({ received: true });
  }

  if (message.action === 'getSniffingState') {
    sendResponse({ isSniffing: globalSniffingState });
  }

  if (message.action === 'setSniffingState') {
    globalSniffingState = message.enabled;
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action : 'setSniffingState',
          enabled: message.enabled
        }).catch(() => {});
      });
    });
    chrome.storage.local.set({ isSniffing: message.enabled });
    sendResponse({ success: true, isSniffing: message.enabled });
  }

  if (message.action === 'getCapturedRequests') {
    chrome.storage.local.get(['capturedRequests'], (result) => {
      sendResponse({ requests: result.capturedRequests || [] });
    });
    return true;
  }

  if (message.action === 'clearCapturedRequests') {
    chrome.storage.local.set({ capturedRequests: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'getUserActions') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getUserActions' }, (response) => {
          sendResponse(response || { actions: [] });
        });
      } else {
        sendResponse({ actions: [] });
      }
    });
    return true;
  }

  if (message.action === 'clearUserActions') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'clearUserActions' });
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'saveSnippet') {
    chrome.storage.local.get(['snippets'], (result) => {
      const snippets = result.snippets || [];
      snippets.unshift({ id: Date.now().toString(), savedAt: new Date().toISOString(), ...message.data });
      chrome.storage.local.set({ snippets });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'getSnippets') {
    chrome.storage.local.get(['snippets'], (result) => {
      sendResponse({ snippets: result.snippets || [] });
    });
    return true;
  }

  if (message.action === 'deleteSnippet') {
    chrome.storage.local.get(['snippets'], (result) => {
      const snippets = (result.snippets || []).filter(s => s.id !== message.id);
      chrome.storage.local.set({ snippets });
      sendResponse({ success: true });
    });
    return true;
  }


  // Phase 2: credentialed replay (reuses browser session cookies)
  if (message.action === 'replaySnippet') {
    const { url, method, body, headers } = message.data;

    // Build headers — preserve original Content-Type so url-encoded bodies route correctly
    const reqHeaders = {};
    if (headers && typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) {
        // Forward all non-forbidden headers (browser blocks 'cookie', 'host' etc. silently)
        reqHeaders[k] = v;
      }
    }

    // Body: always send as-is string. Preserves fb_dtsg, lsd, jazoest CSRF tokens.
    const reqBody = body
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : undefined;

    fetch(url, {
      method     : (method || 'GET').toUpperCase(),
      headers    : reqHeaders,
      body       : reqBody,
      credentials: 'include'   // ← sends real browser session cookies
    })
    .then(async (response) => {
      const raw = await response.text();
      const { body: responseBody, xssiWarning } = parseReplayResponse(raw, url);
      sendResponse({
        success    : true,
        status     : response.status,
        statusText : response.statusText,
        headers    : Object.fromEntries(response.headers.entries()),
        body       : responseBody,
        xssiWarning: xssiWarning
      });
    })
    .catch((error) => { sendResponse({ success: false, error: error.message }); });
    return true;
  }

  // Phase 2: replay with user modifications (also credentialed)
  if (message.action === 'replayWithMods') {
    const { url, method, body, headers } = message.data;

    const reqHeaders = headers && typeof headers === 'object' ? { ...headers } : {};

    // Header-based Idempotency Randomization (Stripe / General REST APIs)
    const headerKeys = Object.keys(reqHeaders);
    const idfKey = headerKeys.find(k => k.toLowerCase() === 'idempotency-key');
    const xIdfKey = headerKeys.find(k => k.toLowerCase() === 'x-idempotency-key');
    if (idfKey) reqHeaders[idfKey] = crypto.randomUUID();
    if (xIdfKey) reqHeaders[xIdfKey] = crypto.randomUUID();

    // Body: keep as string if string (preserves url-encoded CSRF tokens),
    // otherwise JSON-serialize objects
    const reqBody = body !== undefined && body !== null && body !== ''
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : undefined;

    // Default Content-Type if not set and we have a body
    if (reqBody && !Object.keys(reqHeaders).some(k => k.toLowerCase() === 'content-type')) {
      reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    executeReplayFetch(url, (method || 'POST').toUpperCase(), reqHeaders, reqBody)
    .then((response) => {
      const { body: responseBody, xssiWarning } = parseReplayResponse(response.text, url);
      sendResponse({
        success    : true,
        status     : response.status,
        statusText : response.statusText,
        headers    : response.headers,
        body       : responseBody,
        xssiWarning: xssiWarning
      });
    })
    .catch((error) => { sendResponse({ success: false, error: error.message }); });
    return true;
  }

  // Phase 2: Auto-refresh CSRF tokens then replay
  if (message.action === 'refreshAndReplay') {
    const { url, method, body, headers } = message.data;
    (async () => {
      try {
        // Step 1: Get fresh tokens
        const fresh = await getCSRFTokens(url) || {};
        let customWarning = null;
        if (Object.keys(fresh).length === 0) {
          customWarning = '⚠️ Could not extract fresh CSRF tokens for this domain. Replaying using the original captured tokens...';
        }

        // Step 2: Substitute fresh tokens into body
        const bodyStr   = typeof body === 'string' ? body : (body ? JSON.stringify(body) : null);
        const freshBody = substituteCSRFTokens(bodyStr, fresh);

        // Step 3: Build headers (preserve original Content-Type)
        const reqHeaders = headers && typeof headers === 'object' ? { ...headers } : {};

        // Header-based Idempotency Randomization
        const headerKeys = Object.keys(reqHeaders);
        const idfKey = headerKeys.find(k => k.toLowerCase() === 'idempotency-key');
        const xIdfKey = headerKeys.find(k => k.toLowerCase() === 'x-idempotency-key');
        if (idfKey) reqHeaders[idfKey] = crypto.randomUUID();
        if (xIdfKey) reqHeaders[xIdfKey] = crypto.randomUUID();

        if (freshBody && !Object.keys(reqHeaders).some(k => k.toLowerCase() === 'content-type')) {
          reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }

        // Add proper headers for Instagram, LinkedIn, and YouTube
        if (fresh.csrftoken) reqHeaders['X-CSRFToken'] = fresh.csrftoken;
        if (fresh.csrfToken) reqHeaders['Csrf-Token'] = fresh.csrfToken;
        if (fresh.sapisidhash) reqHeaders['Authorization'] = fresh.sapisidhash;
        if (fresh.lsd) reqHeaders['X-FB-LSD'] = fresh.lsd;

        // Step 4: Replay with fresh tokens + session cookies inside target tab DOM
        const response = await executeReplayFetch(url, (method || 'POST').toUpperCase(), reqHeaders, freshBody || undefined);
        const { body: responseBody, xssiWarning } = parseReplayResponse(response.text, url);

        sendResponse({
          success     : true,
          status      : response.status,
          statusText  : response.statusText,
          headers     : response.headers,
          body        : responseBody,
          xssiWarning : xssiWarning || customWarning,
          freshTokens : fresh           // so UI can show what was substituted
        });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  // CDP controls
  if (message.action === 'attachCDP') {
    const tabId = message.tabId;
    if (!tabId) { sendResponse({ success: false, error: 'No tab ID provided' }); return true; }
    attachDebugger(tabId).then((success) => {
      if (success) {
        chrome.storage.local.set({ useCDP: true });
        sendResponse({ success: true, message: 'CDP attached successfully' });
      } else {
        sendResponse({ success: false, error: 'Failed to attach CDP' });
      }
    });
    return true;
  }

  if (message.action === 'detachCDP') {
    if (message.tabId) detachDebugger(message.tabId);
    chrome.storage.local.set({ useCDP: false });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'getCDPStatus') {
    sendResponse({ attached: cdpSessions.has(message.tabId), sessionCount: cdpSessions.size });
    return true;
  }

  // Phase 10: deep capture toggle
  if (message.action === 'setDeepCapture') {
    deepCaptureEnabled = message.enabled;
    chrome.storage.local.set({ deepCapture: message.enabled });
    sendResponse({ success: true, deepCapture: deepCaptureEnabled });
    return true;
  }

  if (message.action === 'getDeepCapture') {
    sendResponse({ deepCapture: deepCaptureEnabled });
    return true;
  }

  // Phase 7: API schema
  if (message.action === 'getApiSchema') {
    chrome.storage.local.get(['apiSchema'], (result) => {
      sendResponse({ schema: result.apiSchema || {} });
    });
    return true;
  }

  if (message.action === 'clearApiSchema') {
    chrome.storage.local.set({ apiSchema: {} }, () => { sendResponse({ success: true }); });
    return true;
  }

  // Stats
  if (message.action === 'getStats') {
    chrome.storage.local.get(['capturedRequests', 'snippets', 'apiSchema'], (result) => {
      const schema = result.apiSchema || {};
      sendResponse({
        totalRequests : (result.capturedRequests || []).length,
        totalSnippets : (result.snippets || []).length,
        totalMutations: (result.capturedRequests || []).filter(r => r.tags?.includes('mutation')).length,
        totalGraphQL  : (result.capturedRequests || []).filter(r => r.graphql?.isGraphQL).length,
        schemaEntries : Object.keys(schema).length,
        isSniffing    : globalSniffingState,
        deepCapture   : deepCaptureEnabled,
        cdpSessions   : cdpSessions.size
      });
    });
    return true;
  }

  return true;
});

// ============================================
// TAB MANAGEMENT
// ============================================
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        action : 'setSniffingState',
        enabled: globalSniffingState
      }).catch(() => {});
    }, 500);
  }
});

// ============================================
// INIT
// ============================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['isSniffing'], (result) => {
    chrome.storage.local.set({
      snippets           : [],
      isSniffing         : result.isSniffing ?? true,
      capturedRequests   : [],
      useCDP             : false,
      deepCapture        : true,
      apiSchema          : {}
    });
  });
  console.log('[WiretapSuite] v2.0 installed');
});

// ============================================
// CLEANUP: Remove old requests every 5 min
// ============================================
setInterval(() => {
  chrome.storage.local.get(['capturedRequests'], (result) => {
    const requests    = result.capturedRequests || [];
    const oneHourAgo  = Date.now() - 3600000;
    const filtered    = requests.filter(r => (r.timestamp || 0) > oneHourAgo);
    if (filtered.length !== requests.length) {
      debouncedWriteRequests(filtered);
    }
  });
}, 300000);

console.log('[WiretapSuite] v2.0 Background service worker ready');
