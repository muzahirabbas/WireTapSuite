# 🔬 WiretapSuite: Reverse Engineer & Automate Web App APIs

**Version:** 2.0  
**Manifest Version:** 3 (Chrome Extension)  
**License:** MIT

<div align="center">

**Deep API intelligence for developers, security researchers, and automation engineers**

[Features](#-features) • [Installation](#-installation) • [Quick Start](#-quick-start) • [User Guide](#-user-guide) • [Roadmap](#-roadmap) • [Contributing](#-contributing)

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Screenshots](#-screenshots)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [User Guide](#-user-guide)
  - [Popup Interface](#popup-interface)
  - [Full Page Suite](#full-page-suite)
  - [GraphQL Detection](#graphql-detection)
  - [Replay Engine](#replay-engine)
  - [Action Correlation](#action-correlation)
  - [Timeline View](#timeline-view)
  - [Schema Extraction](#schema-extraction)
  - [Deep Extract](#deep-extract)
- [Architecture](#-architecture)
- [Permissions Explained](#-permissions-explained)
- [Use Cases](#-use-cases)
- [Comparison Table](#-comparison-table)
- [Troubleshooting](#-troubleshooting)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [Security Considerations](#-security-considerations)
- [FAQ](#-faq)

---

## 🎯 Overview

**WiretapSuite** is an advanced browser extension for capturing, analyzing, and reverse engineering web application APIs. It goes beyond traditional network inspectors by providing:

- **Intelligent GraphQL detection** with automatic mutation/query classification
- **One-click replay bundles** for Python, TypeScript, cURL, n8n, and more
- **User action correlation** to understand what triggers each API call
- **Schema extraction** from captured GraphQL operations
- **Timeline visualization** showing the sequence of actions and requests
- **Deep data extraction** from complex JSON responses

Whether you're building automation scripts, conducting security audits, or integrating with undocumented APIs, WiretapSuite gives you the tools to understand and replicate any web application's network behavior.

---

## ✨ Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **🔷 GraphQL Detection** | Automatically identifies GraphQL endpoints, extracts operation names, doc_ids, variables, and classifies queries vs mutations |
| **🔥 Mutation Highlighting** | Mutations are visually highlighted with special badges for quick identification |
| **🔁 Replay Engine** | Generate ready-to-use code snippets in multiple formats (cURL, Python, TypeScript, Axios, Fetch, n8n, Cloudflare Workers) |
| **🔑 Token Sanitization** | Automatically detects and marks dynamic auth tokens (CSRF, session IDs, bearer tokens) in replay bundles |
| **⛓ Action Correlation** | Tracks user clicks, form submissions, and keyboard events that trigger each API request |
| **📅 Timeline View** | Visual timeline showing the chronological sequence of user actions and network requests |
| **🗂 Schema Extraction** | Builds an API schema from captured GraphQL operations with variable shapes and sample payloads |
| **🔎 Deep Extract** | Recursively extracts all strings, numbers, booleans, and arrays from complex JSON responses |
| **🖼 Image Scraping** | Automatically detects and extracts image URLs from API responses |
| **🌊 Deep Capture (CDP)** | Chrome DevTools Protocol integration for capturing response bodies that content scripts can't access |
| **📤 Export** | Export captured requests, snippets, and extracted data as JSON or CSV |

### Replay Bundle Formats

WiretapSuite generates complete, production-ready code for:

- **cURL** - Command-line HTTP client (with cookie guide)
- **🐍 Python** - Full requests script with automatic CSRF token refresh
- **📘 TypeScript/Node.js** - ES modules with token refresh logic
- **🔗 n8n** - HTTP Request node configuration JSON
- **⚡ Cloudflare Workers** - Edge-ready fetch() implementation
- **Fetch API** - Native browser fetch
- **Axios** - Popular HTTP client library
- **Next.js Route Handler** - App Router API route template

### Platform-Specific Token Handling

The replay engine includes built-in support for refreshing CSRF tokens on:

| Platform | Tokens | Auto-Refresh |
|----------|--------|--------------|
| Facebook/Meta | `fb_dtsg`, `lsd`, `jazoest` | ✅ |
| Instagram | `sessionid`, `csrftoken` | ✅ |
| LinkedIn | `JSESSIONID`, `Csrf-Token` | ✅ |
| YouTube/Google | `SAPISIDHASH` | ✅ |
| Generic (Django, ASP.NET) | `csrf_token`, `XSRF-TOKEN`, `__RequestVerificationToken` | ✅ |

---

## 📸 Screenshots

### Popup Interface
- Live request capture with filtering
- Method-based color coding (GET, POST, PUT, DELETE, etc.)
- GraphQL and mutation badges
- Auth token detection
- Action correlation indicators

### Full Page Suite
- Detailed request/response inspection
- Multi-tab replay bundle viewer
- Timeline visualization
- Schema table
- Extracted data grid
- Scraped media gallery

---

## 📦 Installation

### Option 1: Load Unpacked (Development)

1. **Clone or download** this repository
   ```bash
   git clone https://github.com/muzahirabbas/WireTap.git
   cd WireTap
   ```

2. **Open Chrome Extensions**
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top-right)

3. **Load the extension**
   - Click **Load unpacked**
   - Select the `WireTap` folder

4. **Verify installation**
   - You should see the WiretapSuite icon in your toolbar
   - Pin it for easy access

### Option 2: Chrome Web Store (Coming Soon)

> ⚠️ **Note:** The extension is not yet published on the Chrome Web Store. Use the "Load Unpacked" method above.

### Enterprise Deployment

For enterprise environments, use `manifest-enterprise.json`:

1. Rename `manifest-enterprise.json` to `manifest.json`
2. Follow the installation steps above
3. Deploy via Chrome Enterprise policies if needed

---

## 🚀 Quick Start

### 1. Activate the Extension

- Click the WiretapSuite icon in your toolbar
- Ensure the toggle shows **⏸ Normal** (green) — this means capture is active
- If it shows **▶ Normal** (red), click to enable capture

### 2. Navigate to a Target Site

Open any web application you want to analyze:
- Social media platforms (Facebook, Instagram, LinkedIn)
- SaaS applications
- Single-page applications (React, Vue, Angular)

### 3. Interact with the Site

- Click buttons
- Submit forms
- Scroll to trigger lazy-loading
- Use search features

### 4. View Captured Requests

- Return to the WiretapSuite popup
- See all API requests in real-time
- Filter by method, GraphQL, mutations, or failed requests

### 5. Inspect a Request

- Click any request to open the detail view
- View headers, body, response, and timing
- See which user action triggered the request

### 6. Generate Replay Code

- Click the **Replay** tab
- Choose your preferred format (Python, TypeScript, cURL, etc.)
- Copy and paste into your automation project

---

## 📘 User Guide

### Popup Interface

The popup provides a lightweight, real-time view of captured requests.

#### Header Controls

| Element | Function |
|---------|----------|
| **Status Indicator** | Green pulsing dot = active, Red = paused |
| **Count Badge** | Number of captured requests |
| **Toggle Button** | Enable/disable capture without reloading |

#### Filter Bar

Quick filters for request types:
- **All** - Show everything
- **GET/POST/PUT/DELETE/PATCH** - Filter by HTTP method
- **🔷 GQL** - GraphQL queries only
- **🔥 Mutate** - GraphQL mutations only
- **❌ Failed** - Requests with 4xx/5xx status
- **WS** - WebSocket connections

#### Search Box

Search across:
- URLs
- HTTP methods
- GraphQL operation names
- Request/response bodies
- Headers
- Auth tokens

#### Tabs

| Tab | Content |
|-----|---------|
| **Live Requests** | Real-time captured requests |
| **Saved** | Manually saved request snippets |
| **User Actions** | Tracked clicks, submits, key events |

#### Bottom Action Bar

| Button | Function |
|--------|----------|
| **🔬 CDP** | Toggle Chrome DevTools Protocol mode |
| **🌊 Deep** | Toggle deep body capture (CDP) |
| **🖥️ Suite** | Open full-page interface |
| **🔄** | Reload current tab |
| **📤** | Export captured data as JSON |
| **🗑** | Clear current view |

---

### Full Page Suite

Access via the **🖥️ Suite** button for advanced features.

#### Header Stats

Real-time counters for:
- Total requests
- GraphQL operations
- Mutations
- Saved snippets
- Schema entries

#### Left Panel: Request List

- Color-coded method badges
- GraphQL/mutation dot indicators
- Status codes with color coding
- Duration and timestamp
- GraphQL operation names

#### Right Panel: Tabs

##### 1. Detail Tab

Complete request/response inspection:

- **GraphQL Info Box** - Operation type, name, doc_id, variables
- **Auth Tokens** - Detected dynamic tokens
- **Action Chain** - User actions that triggered the request
- **Request Section** - Method, URL, duration, headers, body
- **Response Section** - Status, headers, body

##### 2. Replay Tab

Interactive request replay with:

- Editable method, URL, headers, body
- **▶ Send Request** - Execute immediately
- **🔄 Refresh Tokens & Replay** - Auto-fetch fresh CSRF tokens before replay

##### 3. ⏱ Timeline Tab

Visual timeline showing:

- User actions (green dots)
- API requests (blue dots)
- Mutations (orange dots)
- GraphQL queries (purple dots)
- Failed requests (red dots)
- Time deltas between events

##### 4. 🗂 Schema Tab

Extracted GraphQL schema table:

| Column | Description |
|--------|-------------|
| **Type** | Query or Mutation |
| **Name** | Operation name |
| **Variable Keys** | Input variable structure |
| **Samples** | Number of captured examples |

##### 5. 🔎 Extract Tab

Deep extraction from selected response:

- **⚡ Extract** - Parse and flatten JSON structure
- **Text Fields** - All string values
- **Numbers / Booleans** - Numeric and boolean values
- **Arrays** - List structures with item counts
- **🔑 IDs** - Heuristically identified ID fields

Export options:
- **📤 JSON** - Download as JSON
- **📤 CSV** - Download as CSV

##### 6. 🖼 Scraped Tab

Automatically extracted media:

- Images detected in responses
- Download buttons for each asset
- Timestamps and type labels

---

### GraphQL Detection

WiretapSuite automatically identifies GraphQL operations using multiple signals:

#### Detection Criteria

1. **URL Patterns**
   - `/graphql`
   - `graphql?`
   - `/api/graphql`

2. **Body Parameters**
   - `doc_id` / `documentId`
   - `fb_api_req_friendly_name` (Facebook)
   - `operationName`
   - `query` (GraphQL query string)
   - `variables`

#### Classification

Operations are classified as:

- **🔷 Query** - Read operations
- **🔥 Mutation** - Write operations (create, update, delete, insert)

Mutation detection uses:
- Operation name keywords (`create`, `update`, `delete`, `insert`, `mutation`)
- Query string prefix (`mutation {`)
- Presence of `input` in variables

#### Display

GraphQL requests show:
- Purple left border (queries)
- Orange left border + gradient background (mutations)
- Badge with operation type
- Operation name in metadata
- doc_id if present
- Variables preview

---

### Replay Engine

The replay engine generates production-ready code with automatic token handling.

#### How It Works

1. **Capture** - Request is intercepted with full headers and body
2. **Sanitize** - Dynamic tokens are identified and marked
3. **Generate** - Code snippets are created for multiple platforms
4. **Refresh** - Some platforms auto-fetch fresh CSRF tokens before replay

#### Token Sanitization

Dynamic tokens are automatically detected by key name:

```javascript
const DYNAMIC_TOKEN_KEYS = [
  'fb_dtsg', 'lsd', 'csrf', 'csrf_token', '_token', 'x-csrftoken',
  'x-csrf-token', '__requestverificationtoken', 'authenticity_token',
  'access_token', 'refresh_token', 'bearer', 'api_key', 'apikey',
  'client_secret', '__dyn', '__spin_b', '__spin_r', '__spin_t',
  '__bbox', 'jazoest'
];
```

In generated snippets, these appear as:
- `[DYNAMIC]` placeholder in headers/body
- `🔑 Tokens` tab showing which keys need fresh values

#### Cookie Guide

HttpOnly session cookies (like `c_user`, `xs`, `datr` for Facebook) cannot be read by JavaScript. The **🍪 Cookie Guide** tab explains three extraction methods:

1. **DevTools → Application → Cookies** (manual copy)
2. **DevTools → Network → Copy as cURL** (extract Cookie header)
3. **document.cookie** (non-HttpOnly only)

#### Platform-Specific Features

**Python Script:**
- Session management with `requests.Session()`
- Automatic CSRF token extraction via regex
- XSSI prefix stripping (`for (;;);`, `while(1);`)
- Error handling for CSRF failures

**TypeScript:**
- ES modules compatible
- Next.js route handler template included
- SAPISIDHASH generation for YouTube
- Async token refresh functions

**n8n:**
- HTTP Request node JSON configuration
- Pre-configured headers and body
- Note about cookie handling

**Cloudflare Workers:**
- Edge-compatible fetch() syntax
- Cookie header placeholder
- XSSI prefix handling

---

### Action Correlation

Understanding **what triggers** an API request is crucial for automation.

#### Tracked Actions

| Action Type | Trigger |
|-------------|---------|
| **click** | Mouse clicks on any element |
| **submit** | Form submissions |
| **keyenter** | Enter key press in input fields |

#### Action Record Structure

```javascript
{
  type: "click",
  target: "BUTTON",
  selector: "#submitBtn",
  text: "Submit Form",
  timestamp: 1711234567890
}
```

#### Display

In request details, the **Action Chain** shows:
- Last 5 user actions before the request
- Action type, target element, and text content
- Visual indicator (👆) in request list

#### Use Cases

1. **Automation Scripting** - Replicate exact user flow
2. **Debugging** - Understand why a request fired
3. **Testing** - Create realistic test scenarios
4. **Documentation** - Map UI interactions to API calls

---

### Timeline View

The timeline provides a chronological visualization of all captured events.

#### Event Types

| Icon | Color | Event Type |
|------|-------|------------|
| 👆 | Green | User Action |
| 🌐 | Blue | HTTP Request |
| 🔥 | Orange | GraphQL Mutation |
| 🔷 | Purple | GraphQL Query |
| ❌ | Red | Failed Request |

#### Features

- **Time Deltas** - Shows milliseconds between events (e.g., `+150ms`)
- **Chronological Sorting** - Events sorted by timestamp
- **Combined View** - User actions and requests in single timeline
- **Refresh Button** - Rebuild timeline from current data

#### Use Cases

1. **Performance Analysis** - Identify slow request chains
2. **Causality Mapping** - See which action triggered which request
3. **Debugging Race Conditions** - Understand timing issues
4. **Documentation** - Visual flow of user interactions

---

### Schema Extraction

Automatically build a GraphQL schema from captured operations.

#### Extraction Process

1. **Capture** - GraphQL requests are identified and parsed
2. **Classification** - Operations are typed as query/mutation
3. **Variable Analysis** - Input variable keys are extracted
4. **Sample Collection** - Multiple examples are stored

#### Schema Structure

```javascript
{
  "createUser": {
    "type": "mutation",
    "variablesShape": {
      "username": "string",
      "email": "string",
      "password": "string"
    },
    "samplePayloads": [
      { /* captured request body */ }
    ]
  }
}
```

#### Display

Schema table columns:
- **Type** - Query or Mutation badge
- **Name** - Operation name (e.g., `createUser`)
- **Variable Keys** - Input parameter structure
- **Samples** - Number of captured examples

#### Export

- **🔄 Refresh** - Rebuild schema from current requests
- **🗑 Clear** - Reset schema
- **📤 Export** - Download as JSON

#### Use Cases

1. **API Documentation** - Generate docs for undocumented APIs
2. **Code Generation** - Build TypeScript types or GraphQL schemas
3. **Testing** - Create test fixtures from sample payloads
4. **Security Auditing** - Map all available mutations

---

### Deep Extract

Flatten complex JSON responses into structured, searchable data.

#### Extraction Algorithm

Recursively traverses objects and arrays:

```javascript
deepExtract({
  user: {
    id: "12345",
    name: "John",
    posts: [{ title: "Hello", likes: 10 }]
  }
})
// Results:
// - user.id: "12345" (string)
// - user.name: "John" (string)
// - user.posts: "[1 items]" (array)
// - user.posts[0].title: "Hello" (string)
// - user.posts[0].likes: 10 (number)
```

#### Output Categories

| Category | Description |
|----------|-------------|
| **Text Fields** | All string values (truncated to 60 chars) |
| **Numbers / Booleans** | Numeric and boolean values |
| **Arrays** | List structures with item counts |
| **🔑 IDs** | Fields ending with `id` (heuristically identified) |

#### Export Formats

**JSON:**
```json
[
  { "path": "user.id", "type": "string", "value": "12345" },
  { "path": "user.posts[0].likes", "type": "number", "value": 10 }
]
```

**CSV:**
```csv
path,type,value
user.id,string,12345
user.posts[0].likes,number,10
```

#### Use Cases

1. **Data Mining** - Extract specific values from large responses
2. **Schema Discovery** - Understand response structure
3. **Automation** - Find IDs and tokens for subsequent requests
4. **Debugging** - Quickly locate values in nested JSON

---

## 🏗 Architecture

### File Structure

```
WireTap/
├── manifest.json              # Extension manifest (MV3)
├── manifest-enterprise.json   # Enterprise variant
├── background.js              # Service worker (capture, storage, CDP)
├── content.js                 # Content script (fetch/XHR interception)
├── inject.js                  # Page context script (CSP bypass)
├── popup.html                 # Popup UI
├── popup.js                   # Popup logic
├── fullpage.html              # Full suite UI
├── fullpage.js                # Full suite logic
├── styles.css                 # Shared styles
└── icons/                     # Extension icons
```

### Component Responsibilities

#### `background.js` (Service Worker)

**Phases:**
1. **Phase 1 & 5: GraphQL Detection** - Parse request bodies, detect GraphQL patterns
2. **Phase 2: Replay Bundle Generation** - Sanitize headers/body, generate code snippets
3. **Phase 10: Storage Write Debounce** - Batch storage writes for performance
4. **CDP Management** - Attach/detach Chrome DevTools Protocol sessions
5. **Deep Capture** - Fetch response bodies via CDP Network.getResponseBody

**Key Functions:**
- `detectGraphQL(url, bodyObj)` - GraphQL detection logic
- `buildReplayBundle(req)` - Generate multi-format replay code
- `sanitizeHeaders(headers)` - Remove unstable headers, mark dynamic tokens
- `sanitizeBody(bodyObj)` - Mark dynamic token values in body
- `debouncedWriteRequests(requests)` - Debounced storage writes

#### `content.js` (Content Script)

**Runs in:** Isolated world (`world: "MAIN"`)  
**Injection:** `document_start` on all frames

**Responsibilities:**
- Intercept `fetch()` calls
- Intercept `XMLHttpRequest` calls
- Track user actions (clicks, submits, key events)
- Detect GraphQL in request bodies
- Send captured data to background worker
- Maintain local request cache (`window.__capturedRequests`)

**Key Features:**
- Body size guard (truncates bodies > 500KB)
- Action chain tracking (last 100 actions)
- Tag assignment (graphql, mutation, important, failed)

#### `inject.js` (Page Context)

**Runs in:** Page context (bypasses CSP)  
**Injection:** Via `chrome.scripting.executeScript`

**Responsibilities:**
- Secondary fetch/XHR interception (bypasses site CSP)
- Redundant capture for sites that block content scripts
- Same GraphQL detection logic as content.js

#### `popup.js` / `popup.html`

**Features:**
- Real-time request list with filtering
- Search across all request fields
- Detail view with syntax-highlighted JSON
- Replay bundle tabs
- CDP toggle
- Deep capture toggle
- Export/clear functionality

#### `fullpage.js` / `fullpage.html`

**Features:**
- All popup features plus:
- Timeline visualization
- Schema extraction table
- Deep extract grid
- Scraped media gallery
- Interactive replay form
- Multi-tab interface

---

## 🔐 Permissions Explained

| Permission | Why It's Needed |
|------------|-----------------|
| **storage** | Save captured requests, snippets, schema, user preferences |
| **tabs** | Query active tab, inject scripts, reload tabs |
| **webRequest** | Intercept network requests (fallback for content script) |
| **webNavigation** | Track frame navigation for script injection |
| **scripting** | Inject `inject.js` into page context (CSP bypass) |
| **debugger** | Chrome DevTools Protocol for deep body capture |
| **cookies** | Read cookies for replay bundles (future feature) |
| **host_permissions: <all_urls>** | Capture requests on any website |

### Security Notes

- **No data leaves your browser** - All capture and storage is local
- **No remote servers** - Extension doesn't phone home
- **User-controlled** - Capture can be paused/resumed anytime
- **Transparent** - All permissions are explained above

---

## 🎯 Use Cases

### 1. API Reverse Engineering

**Scenario:** You need to integrate with a service that has no public API.

**Workflow:**
1. Navigate to the web app
2. Perform desired actions (search, create, update)
3. Filter by GraphQL mutations
4. Copy Python replay snippet
5. Adapt token refresh logic for your account
6. Automate!

### 2. Security Auditing

**Scenario:** You're testing for CSRF, IDOR, or auth bypass vulnerabilities.

**Workflow:**
1. Capture all requests during a workflow
2. Inspect auth tokens in headers/body
3. Use replay to test token reuse
4. Modify IDs in body to test IDOR
5. Export requests for documentation

### 3. Test Automation

**Scenario:** You're writing E2E tests and need realistic API mocks.

**Workflow:**
1. Capture real user flows
2. Export requests as JSON
3. Use in mock server (MSW, nock, etc.)
4. Correlate with user actions for realistic timing

### 4. Performance Analysis

**Scenario:** Your app feels slow; you need to find bottlenecks.

**Workflow:**
1. Open timeline view
2. Perform typical user flow
3. Identify slow requests (red timing badges)
4. Check time deltas between actions
5. Optimize or lazy-load heavy endpoints

### 5. Documentation Generation

**Scenario:** You inherited a codebase with no API docs.

**Workflow:**
1. Use the app extensively
2. Export schema as JSON
3. Generate GraphQL SDL or TypeScript types
4. Document variable requirements
5. Share with team

---

## 📊 Comparison Table

| Feature | WiretapSuite | Chrome DevTools | Postman | Burp Suite |
|---------|--------------|-----------------|---------|------------|
| **GraphQL Detection** | ✅ Auto | ❌ Manual | ❌ Manual | ❌ Manual |
| **Mutation Highlighting** | ✅ | ❌ | ❌ | ❌ |
| **Action Correlation** | ✅ | ❌ | ❌ | ❌ |
| **Timeline View** | ✅ | ❌ | ❌ | ❌ |
| **Schema Extraction** | ✅ | ❌ | ❌ | ❌ |
| **Multi-Format Replay** | ✅ 8 formats | ❌ | ✅ Limited | ✅ Limited |
| **Token Sanitization** | ✅ Auto | ❌ | ❌ | ⚠️ Manual |
| **CSRF Auto-Refresh** | ✅ | ❌ | ❌ | ❌ |
| **Deep Extract** | ✅ | ❌ | ❌ | ❌ |
| **Image Scraping** | ✅ | ❌ | ❌ | ❌ |
| **CDP Deep Capture** | ✅ | ✅ | ❌ | ❌ |
| **Free** | ✅ | ✅ | ⚠️ Freemium | ❌ Paid |
| **Privacy (Local Only)** | ✅ | ✅ | ❌ Cloud | ⚠️ Proxy |

---

## 🛠 Troubleshooting

### No Requests Captured

**Symptoms:** Request list stays empty after interacting with a site.

**Solutions:**
1. **Check toggle state** - Ensure it shows "⏸ Normal" (green)
2. **Reload the tab** - Click 🔄 in popup or refresh manually
3. **Enable CDP mode** - Click 🔬 CDP for deeper capture
4. **Check for CSP** - Some sites block content scripts; CDP mode bypasses this
5. **Avoid chrome:// URLs** - Extension can't run on browser internal pages

### Replay Fails with CSRF Error

**Symptoms:** Error 1357004 or "CSRF token missing/invalid"

**Solutions:**
1. **Use 🔄 Refresh Tokens & Replay** - Auto-fetches fresh tokens
2. **Extract cookies manually** - Follow Cookie Guide tab
3. **Check token sanitization** - Look for `[DYNAMIC]` placeholders
4. **Update session cookies** - They may have expired

### CDP Mode Won't Enable

**Symptoms:** Clicking 🔬 CDP shows error or does nothing

**Solutions:**
1. **Check tab URL** - CDP doesn't work on `chrome://` or `chrome-extension://`
2. **Reload extension** - Go to `chrome://extensions/` and reload WiretapSuite
3. **Close other CDP tools** - Only one debugger can attach per tab
4. **Restart Chrome** - CDP sessions can get stuck

### Large Response Bodies Truncated

**Symptoms:** Response body shows `[TRUNCATED]` or is incomplete

**Solutions:**
1. **Enable Deep Capture** - Click 🌊 Deep to use CDP for full bodies
2. **Export and view externally** - Use 📤 Export and open in editor
3. **Use Deep Extract** - Extract specific fields instead of full body

### GraphQL Not Detected

**Symptoms:** GraphQL requests show as regular POST requests

**Solutions:**
1. **Check URL pattern** - Must contain `/graphql` or `/api/graphql`
2. **Check body format** - Should have `query`, `variables`, or `doc_id`
3. **Facebook-specific** - Look for `fb_api_req_friendly_name`
4. **Manual tagging** - Save as snippet and note it's GraphQL

---

## 🗺 Roadmap

### Phase 11: WebSocket Inspector (In Progress)
- [ ] Real-time WebSocket message capture
- [ ] Message filtering and search
- [ ] WS replay (send custom messages)
- [ ] Binary message decoding

### Phase 12: Request Builder
- [ ] Visual request editor
- [ ] Environment variables (base URLs, tokens)
- [ ] Collection management
- [ ] Pre-request scripts (JavaScript)

### Phase 13: Response Post-Processing
- [ ] JSONPath/XPath extractor
- [ ] Response transformers
- [ ] Chained requests (use response A in request B)
- [ ] Assertion testing

### Phase 14: Collaboration
- [ ] Export/import collections
- [ ] Share snippets via URL
- [ ] Team workspace (cloud sync)
- [ ] Version history

### Phase 15: Advanced Automation
- [ ] Visual workflow builder
- [ ] Conditional logic
- [ ] Loops and iterations
- [ ] Error handling and retries
- [ ] Scheduled execution

### Phase 16: Security Features
- [ ] Secret scanning (API keys in responses)
- [ ] Insecure header detection
- [ ] CORS misconfiguration warnings
- [ ] Auth token expiry tracking

### Phase 17: Performance Insights
- [ ] Request waterfall charts
- [ ] Slow request alerts
- [ ] Duplicate request detection
- [ ] Cache efficiency analysis

### Phase 18: AI Assistance
- [ ] Auto-generate documentation
- [ ] Suggest optimal replay format
- [ ] Detect API patterns
- [ ] Natural language search

### Future Considerations
- [ ] Firefox support (WebExtensions)
- [ ] Safari support
- [ ] Mobile app (React Native)
- [ ] Desktop app (Electron)
- [ ] Chrome Web Store publication
- [ ] Automated testing suite
- [ ] CI/CD pipeline
- [ ] Enterprise SSO integration

---

## 🤝 Contributing

Contributions are welcome! Here's how to help:

### Reporting Issues

1. **Check existing issues** - Avoid duplicates
2. **Provide details:**
   - Chrome version
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable
   - Sample captured request (sanitized)

### Pull Requests

1. **Fork the repo**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make changes** - Follow existing code style
4. **Test thoroughly** - Ensure no regressions
5. **Commit with clear messages**
   ```bash
   git commit -m "Add: GraphQL schema export to CSV"
   ```
6. **Push and open PR**
   ```bash
   git push origin feature/your-feature-name
   ```

### Code Style

- **ESLint** - Run `npm run lint` (coming soon)
- **Prettier** - Run `npm run format` (coming soon)
- **Comments** - JSDoc for functions, inline for complex logic
- **Naming** - camelCase for variables/functions, PascalCase for classes

### Areas Needing Help

- [ ] Unit tests (Jest/Mocha)
- [ ] E2E tests (Puppeteer)
- [ ] TypeScript migration
- [ ] Performance optimizations
- [ ] Accessibility improvements
- [ ] Documentation translations
- [ ] UI/UX refinements

---

## 🔒 Security Considerations

### What This Extension Does

- **Captures locally** - All data stays in your browser
- **No telemetry** - Doesn't send data anywhere
- **User-controlled** - You decide when to capture/export

### What This Extension Does NOT Do

- ❌ Upload data to remote servers
- ❌ Track your browsing history
- ❌ Modify requests/responses (except for replay)
- ❌ Inject ads or analytics

### Best Practices

1. **Don't share exported data** - It may contain sensitive tokens
2. **Clear after use** - Use 🗑 to delete captured requests
3. **Use in private browsing** - For sensitive sites
4. **Review before copying** - Check for auth tokens in snippets
5. **Rotate tokens** - If you accidentally expose session cookies

### Known Limitations

- **HttpOnly cookies** - Can't be captured directly (use Cookie Guide)
- **Service Worker requests** - Some may not be intercepted
- **Encrypted payloads** - Can't decrypt TLS/HTTPS (by design)

---

## ❓ FAQ

### Is this legal?

**Yes**, for legitimate purposes like:
- Testing your own applications
- Security research (with permission)
- Learning how APIs work
- Building automation for tasks you're authorized to perform

**Don't use for:**
- Unauthorized access to systems
- Bypassing paywalls or restrictions
- Violating terms of service
- Malicious activities

### Will I get banned?

Possibly, if you:
- Send too many requests (rate limiting)
- Violate the site's ToS
- Use automation for prohibited activities

**Mitigation:**
- Add delays between requests
- Respect rate limits
- Use official APIs when available
- Read the site's ToS

### Does this work on mobile?

**No**, this is a Chrome/Edge desktop extension. Mobile browsers don't support extensions with these capabilities.

### Can I use this with Firefox?

**Not yet.** Firefox uses WebExtensions API which is similar but not identical. This is on the roadmap.

### How do I uninstall?

1. Go to `chrome://extensions/`
2. Find WiretapSuite
3. Click **Remove**
4. All local data is deleted automatically

### Where is my data stored?

In Chrome's extension storage (`chrome.storage.local`):
- **Location:** `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Local Extension Settings\[extension-id]`
- **Format:** LevelDB database
- **Access:** Only by the extension (unless you export)

### Can I sync data across devices?

**Not currently.** Data is stored locally. Cloud sync is planned for Phase 14.

### Is there a rate limit?

**No**, but:
- Chrome may throttle extensions that make too many storage writes
- Target websites will rate limit you if you replay too fast
- Be respectful of server resources

### Can I modify the code?

**Yes!** It's MIT licensed. Just:
- Keep the license notice
- Don't claim it as your own
- Share improvements back if possible

---

## 📄 License

**MIT License**

Copyright (c) 2024 Muzahir Abbas

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 🙏 Acknowledgments

- **Chrome DevTools team** - For the excellent CDP documentation
- **GraphQL community** - For the spec that makes detection possible
- **Open-source contributors** - For libraries and inspiration
- **Users** - For feedback and feature requests

---

## 📬 Contact

- **Issues:** [GitHub Issues](https://github.com/muzahirabbas/WireTap/issues)
- **Discussions:** [GitHub Discussions](https://github.com/muzahirabbas/WireTap/discussions)
- **Email:** (Open an issue for support)

---

<div align="center">

**Made with ❤️ by Muzahir Abbas for developers and security researchers**

[⬆ Back to Top](#-wiretabsuite-reverse-engineer--automate-web-app-apis)

</div>
