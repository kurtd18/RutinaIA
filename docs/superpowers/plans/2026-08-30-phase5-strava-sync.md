# Phase 5 — Strava Automatic Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user who registers their own Strava developer app can connect it in Settings, and
RutinaIA polls Strava every 6 hours for new `WeightTraining` activities, adding each as a
placeholder workout in their history automatically.

**Architecture:** `api/server.js` gets five new session-authenticated-or-OAuth-redirect routes
storing per-user Strava credentials/tokens in `strava-<uid>.json` (mode 0600, outside `db.json`
and `state-<uid>.json`), a raw-HTTPS OAuth token exchange/refresh (no SDK), and a new 6-hour
`setInterval` poll loop that reads each connected user's new activities and appends placeholder
workouts directly into their `state-<uid>.json`. Frontend gets `lib/api.js` exports and a new
`StravaSyncCard` in Settings, mirroring Phase 3's `AiSuggestCard` pattern exactly.

**Tech Stack:** existing repo tooling only — `cd api && npm test` (`node --test`), `cd frontend &&
npm test` (`vitest run`). No new dependencies on either side.

## Global Constraints

- No dependency added to `api/package.json` — the Strava calls are raw `node:https`, following
  the same pattern already used for the Anthropic relay (`api/server.js`'s `callAnthropic`).
- Bring-your-own Strava app only: each user supplies their own `clientId`/`clientSecret`. There is
  no RutinaIA-owned shared Strava app, no relay, no centralized OAuth callback service.
- Strava tokens/credentials are never returned by any route, never logged (including on error
  paths), and live in `strava-<uid>.json` — never in `db.json`, never in `state-<uid>.json`.
- Polling only, every 6 hours (`21600000` ms) — no webhooks, no on-demand "sync now" button.
- Only activities with `type === 'WeightTraining'` are synced. All other activity types are
  ignored entirely.
- Synced activities are never merged with existing manually-logged workouts on the same date —
  each becomes its own separate `S.workouts` entry.
- The poll loop must not let one user's failure (expired/revoked token, network error) stop the
  loop for any other user — failures are caught and logged per-user, never thrown.
- Every task ends with the relevant test suite (`cd api && npm test` and/or `cd frontend && npm
  test`) passing before commit.

---

### Task 1: Backend — Strava config storage routes

**Files:**
- Modify: `api/server.js` (add `stravaFile()`/`readStravaConfig()`/`writeStravaConfig()` helpers,
  three routes: `POST /api/strava/config`, `DELETE /api/strava/config`, `GET /api/strava/status`)
- Test: `api/strava-config.test.js` (new)

**Interfaces:**
- Produces: `stravaFile(uid) -> string` (mirrors `aiKeyFile`'s naming/sanitization exactly).
  `readStravaConfig(uid) -> object | null` — reads and returns the full stored config object, or
  null if none/unreadable. `writeStravaConfig(uid, config) -> void` — atomically writes the given
  object as JSON with mode 0600.
- Consumes: `atomicWrite`, `readSession`, `json`, `readBody` — all already defined in
  `api/server.js` (no new imports needed for this task).

- [ ] **Step 1: Confirm insertion points**

Run: `grep -n "const aiKeyFile\|function readAiKey\|'GET /api/ai/status'" api/server.js`

Confirm `aiKeyFile`/`readAiKey` (around line 64-66) and the `'GET /api/ai/status'` route entry
(around line 670) are still there — this task adds parallel code near both.

- [ ] **Step 2: Add `stravaFile()`, `readStravaConfig()`, `writeStravaConfig()` helpers**

Immediately after `readAiKey`'s closing `}` (around line 66), add:

```js
const stravaFile = uid => path.join(DATA, 'strava-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readStravaConfig(uid) {
  try { return JSON.parse(fs.readFileSync(stravaFile(uid), 'utf8')); } catch { return null; }
}
function writeStravaConfig(uid, config) {
  atomicWrite(stravaFile(uid), JSON.stringify(config), { mode: 0o600 });
}
```

- [ ] **Step 3: Add the three routes**

Inside the `routes` object, immediately after the `'GET /api/ai/status'` entry (find it with
`grep -n "'GET /api/ai/status'" api/server.js`), add:

```js
  'POST /api/strava/config': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const clientId = String(body.clientId || '').trim();
    const clientSecret = String(body.clientSecret || '').trim();
    if (!clientId || !clientSecret) return json(res, 400, { error: 'clientId and clientSecret required' });
    const existing = readStravaConfig(user.id) || {};
    writeStravaConfig(user.id, { ...existing, clientId, clientSecret });
    json(res, 200, { ok: true });
  },

  'DELETE /api/strava/config': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try { fs.unlinkSync(stravaFile(user.id)); } catch {}
    json(res, 200, { ok: true });
  },

  'GET /api/strava/status': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const cfg = readStravaConfig(user.id);
    json(res, 200, { configured: !!(cfg?.clientId && cfg?.clientSecret), connected: !!cfg?.accessToken });
  },
```

Note: `POST /api/strava/config` merges onto any existing stored fields (`{ ...existing, ... }`)
rather than overwriting the whole file, so re-saving credentials doesn't wipe out tokens obtained
in a prior OAuth flow (Task 2 will populate `accessToken`/`refreshToken`/etc. into this same file).

- [ ] **Step 4: Write the tests**

Create `api/strava-config.test.js` (match `api/ai-key.test.js`'s style — plain `node:test`, a
small standalone harness duplicating the pure helpers under test, since `server.js` has no module
exports):

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mirrors the helpers added to api/server.js in this task.
function atomicWrite(file, content, opts) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, content, opts)
  fs.renameSync(tmp, file)
}
const stravaFile = (dataDir, uid) => path.join(dataDir, 'strava-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json')
function readStravaConfig(dataDir, uid) {
  try { return JSON.parse(fs.readFileSync(stravaFile(dataDir, uid), 'utf8')) } catch { return null }
}
function writeStravaConfig(dataDir, uid, config) {
  atomicWrite(stravaFile(dataDir, uid), JSON.stringify(config), { mode: 0o600 })
}

test('readStravaConfig returns null when no config file exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-cfg-'))
  assert.equal(readStravaConfig(dir, 'u1'), null)
})

test('writeStravaConfig + readStravaConfig round-trips a config object', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-cfg-'))
  writeStravaConfig(dir, 'u1', { clientId: '123', clientSecret: 'sek' })
  assert.deepEqual(readStravaConfig(dir, 'u1'), { clientId: '123', clientSecret: 'sek' })
})

test('stravaFile sanitizes the uid the same way stateFile/aiKeyFile do', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-cfg-'))
  const f = stravaFile(dir, '../../etc/passwd')
  assert.ok(!f.includes('..'))
  assert.ok(path.dirname(f) === dir)
})

test('config file is written with restrictive permissions (mode 0600)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-cfg-'))
  writeStravaConfig(dir, 'u1', { clientId: '123', clientSecret: 'sek' })
  const mode = fs.statSync(stravaFile(dir, 'u1')).mode & 0o777
  if (process.platform !== 'win32') assert.equal(mode, 0o600)
})

test('writing config merges rather than overwrites existing token fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-cfg-'))
  writeStravaConfig(dir, 'u1', { clientId: '123', clientSecret: 'sek', accessToken: 'tok' })
  const existing = readStravaConfig(dir, 'u1') || {}
  writeStravaConfig(dir, 'u1', { ...existing, clientId: '456' })
  assert.deepEqual(readStravaConfig(dir, 'u1'), { clientId: '456', clientSecret: 'sek', accessToken: 'tok' })
})
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd api && npm test`
Expected: all pass, including the 5 new tests and every pre-existing test.

- [ ] **Step 6: Manual sanity check of the three routes**

Start the API locally (check `docker-compose.yml`/README for the usual dev-run command, or `cd api
&& DATA_DIR=/tmp/rutinaia-strava-test node server.js`), and against a signed-in session cookie,
hit `POST /api/strava/config`, `GET /api/strava/status`, `DELETE /api/strava/config`, `GET
/api/strava/status` again, confirming the booleans flip and no route ever echoes the secret. Note
in the report whether this manual check was actually performed or skipped, and why.

- [ ] **Step 7: Commit**

```bash
git add api/server.js api/strava-config.test.js
git commit -m "feat: add Strava config storage routes"
```

---

### Task 2: Backend — OAuth authorize + callback routes

**Files:**
- Modify: `api/server.js` (add `stravaOAuthState` Map, `GET /api/strava/authorize`, `GET
  /api/strava/callback`, `exchangeStravaCode()` helper)
- Test: `api/strava-oauth.test.js` (new)

**Interfaces:**
- Consumes: `readStravaConfig`/`writeStravaConfig` from Task 1 (same file, already present).
  `ORIGIN` env var (already defined at the top of `api/server.js`).
- Produces: `exchangeStravaCode(clientId, clientSecret, code) -> Promise<{ accessToken,
  refreshToken, expiresAt, athleteId } | null>` (null on any failure — bad code, network error,
  non-200 response). `GET /api/strava/authorize` and `GET /api/strava/callback` are both 302
  redirects, not JSON responses — the only two routes in the whole file that redirect instead of
  using `json()`.

- [ ] **Step 1: Confirm the existing nonce-Map pattern to reuse**

Run: `grep -n "^const challenges = new Map\|^const pairings = new Map" api/server.js`

Confirm both exist (around lines 481 and 499) — this task's `stravaOAuthState` Map follows the
exact same shape (`Map<string, { ...data, exp }>`, 5-minute expiry, cleaned by a `setInterval`)
already used for WebAuthn challenges and mobile pairing codes.

- [ ] **Step 2: Add the `stravaOAuthState` Map and its cleanup interval**

Immediately after the `pairings` Map and its cleanup `setInterval` (find with `grep -n
"pairings.delete(k)" api/server.js`), add:

```js
// OAuth CSRF-state nonces for the Strava connect flow — same shape/lifetime as `challenges`/
// `pairings` above. Keyed by a random nonce (not the uid) so a leaked/guessed uid can't forge a
// callback; the nonce is round-tripped through Strava's own redirect as the `state` param.
const stravaOAuthState = new Map(); // nonce -> {uid, exp}
setInterval(() => { for (const [k, v] of stravaOAuthState) if (v.exp < Date.now()) stravaOAuthState.delete(k); }, 60000).unref();
```

- [ ] **Step 3: Add `exchangeStravaCode()` helper**

Add near `callAnthropic` (find with `grep -n "function callAnthropic"`), after it:

```js
/* ---------- Strava OAuth (bring-your-own app) ---------- */
// Raw HTTPS, no SDK — same reasoning as callAnthropic: api/ has a hard two-dependency limit.
const STRAVA_HOST = 'www.strava.com';

function stravaTokenRequest(clientId, clientSecret, params) {
  return new Promise((resolve) => {
    const payload = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString();
    const req = https.request({
      host: STRAVA_HOST,
      path: '/oauth/token',
      method: 'POST',
      timeout: 30000,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(payload) },
    }, res => {
      let body = '';
      res.on('data', d => { body += d });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const parsed = JSON.parse(body);
          resolve({
            accessToken: parsed.access_token,
            refreshToken: parsed.refresh_token,
            expiresAt: parsed.expires_at,
            athleteId: parsed.athlete?.id,
          });
        } catch { resolve(null); }
      });
    });
    // Never log `payload` here — it carries the client secret.
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end(payload);
  });
}

function exchangeStravaCode(clientId, clientSecret, code) {
  return stravaTokenRequest(clientId, clientSecret, { code, grant_type: 'authorization_code' });
}

function refreshStravaToken(clientId, clientSecret, refreshToken) {
  return stravaTokenRequest(clientId, clientSecret, { refresh_token: refreshToken, grant_type: 'refresh_token' });
}
```

(`refreshStravaToken` is included here since it shares `stravaTokenRequest` with the authorize
exchange, but it is only actually called starting in Task 3 — that's fine, an unused-until-later
export inside the same file is normal here, not dead code, since Task 3 wires it in.)

- [ ] **Step 4: Add the two routes**

Inside the `routes` object, immediately after `'GET /api/strava/status'` from Task 1, add:

```js
  'GET /api/strava/authorize': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const cfg = readStravaConfig(user.id);
    if (!cfg?.clientId) return json(res, 400, { error: 'no Strava app configured' });
    const nonce = crypto.randomBytes(16).toString('base64url');
    stravaOAuthState.set(nonce, { uid: user.id, exp: Date.now() + 5 * 60000 });
    const authorizeUrl = new URL('https://www.strava.com/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', cfg.clientId);
    authorizeUrl.searchParams.set('redirect_uri', ORIGIN + '/api/strava/callback');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'activity:read');
    authorizeUrl.searchParams.set('state', nonce);
    res.writeHead(302, { Location: authorizeUrl.toString() });
    res.end();
  },

  'GET /api/strava/callback': async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const entry = state && stravaOAuthState.get(state);
    if (entry) stravaOAuthState.delete(state);
    const fail = () => { res.writeHead(302, { Location: '/settings?strava=error' }); res.end(); };
    if (!code || !entry || entry.exp < Date.now()) return fail();
    const cfg = readStravaConfig(entry.uid);
    if (!cfg?.clientId || !cfg?.clientSecret) return fail();
    const tokens = await exchangeStravaCode(cfg.clientId, cfg.clientSecret, code);
    if (!tokens) return fail();
    writeStravaConfig(entry.uid, { ...cfg, ...tokens, lastPollAt: Math.floor(Date.now() / 1000) });
    res.writeHead(302, { Location: '/settings?strava=connected' });
    res.end();
  },
```

Note `GET /api/strava/callback` deliberately does NOT call `readSession(req)` — the request
arrives as Strava's own top-level browser redirect, and while the session cookie is in fact sent
along (SameSite=Lax allows top-level GET navigations), user identity here comes from the
`stravaOAuthState` nonce set during `/authorize`, not from the cookie — this is what stops a
forged callback hit (no valid nonce = no user to write tokens for, cookie or not).

`lastPollAt` is initialized to "now" on first connect so the very first poll only picks up
activities from the moment of connecting onward, not the user's entire Strava history.

- [ ] **Step 5: Write the tests**

Create `api/strava-oauth.test.js`, testing the pure/isolable parts (URL construction, response
mapping) without a live network call — mirror `api/ai-suggest.test.js`'s pattern of duplicating
just the pure logic under test:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Mirrors the pure response-mapping logic inside stravaTokenRequest in api/server.js.
function mapStravaTokenResponse(status, body) {
  if (status !== 200) return null
  try {
    const parsed = JSON.parse(body)
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      expiresAt: parsed.expires_at,
      athleteId: parsed.athlete?.id,
    }
  } catch { return null }
}

test('mapStravaTokenResponse maps a successful token exchange response', () => {
  const body = JSON.stringify({
    access_token: 'acc123', refresh_token: 'ref456', expires_at: 1735689600,
    athlete: { id: 987654 },
  })
  assert.deepEqual(mapStravaTokenResponse(200, body), {
    accessToken: 'acc123', refreshToken: 'ref456', expiresAt: 1735689600, athleteId: 987654,
  })
})

test('mapStravaTokenResponse maps a refresh response with no athlete field', () => {
  const body = JSON.stringify({ access_token: 'acc123', refresh_token: 'ref456', expires_at: 1735689600 })
  assert.deepEqual(mapStravaTokenResponse(200, body), {
    accessToken: 'acc123', refreshToken: 'ref456', expiresAt: 1735689600, athleteId: undefined,
  })
})

test('mapStravaTokenResponse returns null on a non-200 status', () => {
  assert.equal(mapStravaTokenResponse(401, '{}'), null)
})

test('mapStravaTokenResponse returns null on malformed JSON', () => {
  assert.equal(mapStravaTokenResponse(200, 'not json'), null)
})
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `cd api && npm test`
Expected: all pass, including the 4 new tests.

- [ ] **Step 7: Verify no secret leakage on the error path**

Run: `grep -n "console.error\|console.log" api/server.js | grep -i "strava\|clientSecret\|payload"`
Expected: no matches — confirms neither `stravaTokenRequest`'s `req.on('error', ...)` handler nor
the two new routes log the request, the secret, or the exchanged tokens.

- [ ] **Step 8: Manual sanity check**

If you have (or can create) a real Strava API application, walk the flow end-to-end: `POST
/api/strava/config` with real credentials, navigate to `GET /api/strava/authorize` in a browser,
approve on Strava's consent screen, confirm the redirect back lands on `/settings?strava=connected`
and `GET /api/strava/status` now reports `connected: true`. If no real Strava app is available in
this environment, note in the report that this step was reasoned through via the unit tests
instead, and why.

- [ ] **Step 9: Commit**

```bash
git add api/server.js api/strava-oauth.test.js
git commit -m "feat: add Strava OAuth authorize/callback routes"
```

---

### Task 3: Backend — poll loop

**Files:**
- Modify: `api/server.js` (add `toPlaceholderWorkout()`, `isTokenExpired()`,
  `ensureFreshStravaToken()`, `fetchStravaActivities()`, and the 6-hour `setInterval` poll loop)
- Test: `api/strava-poll.test.js` (new)

**Interfaces:**
- Consumes: `readStravaConfig`/`writeStravaConfig` from Task 1, `refreshStravaToken` from Task 2,
  `readState`, `stateFile`, `atomicWrite`, `db.users` — all already present in `api/server.js`.
- Produces: nothing new for later tasks — this is the final piece of server-side sync logic.

- [ ] **Step 1: Write the failing tests for the pure functions**

Create `api/strava-poll.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Mirrors the pure helpers added to api/server.js in this task.
function isTokenExpired(expiresAt, now) {
  return !expiresAt || expiresAt <= Math.floor(now / 1000)
}

function toPlaceholderWorkout(activity, idFn) {
  const startMs = new Date(activity.start_date).getTime()
  const durationMs = (activity.elapsed_time || 0) * 1000
  return {
    id: idFn(), d: activity.start_date.slice(0, 10),
    start: startMs, end: startMs + durationMs,
    routineId: null, name: activity.name || 'Strava activity',
    entries: [], prs: [], vol: 0,
  }
}

function filterStrengthActivities(activities) {
  return (activities || []).filter(a => a.type === 'WeightTraining')
}

test('isTokenExpired treats a missing expiresAt as expired', () => {
  assert.equal(isTokenExpired(undefined, Date.now()), true)
})

test('isTokenExpired is true once expiresAt has passed', () => {
  const now = 1735689600000 // ms
  assert.equal(isTokenExpired(1735689599, now), true) // expiresAt in seconds, 1s before now
})

test('isTokenExpired is false while still valid', () => {
  const now = 1735689600000
  assert.equal(isTokenExpired(1735689700, now), false) // expiresAt 100s after now
})

test('toPlaceholderWorkout maps a WeightTraining activity to the placeholder shape', () => {
  const activity = { name: 'Leg Day', type: 'WeightTraining', start_date: '2026-08-30T18:00:00Z', elapsed_time: 3600 }
  const w = toPlaceholderWorkout(activity, () => 'sw-test-id')
  assert.equal(w.id, 'sw-test-id')
  assert.equal(w.d, '2026-08-30')
  assert.equal(w.name, 'Leg Day')
  assert.deepEqual(w.entries, [])
  assert.deepEqual(w.prs, [])
  assert.equal(w.vol, 0)
  assert.equal(w.routineId, null)
  assert.equal(w.end - w.start, 3600000)
})

test('toPlaceholderWorkout falls back to a default name when Strava sent none', () => {
  const activity = { type: 'WeightTraining', start_date: '2026-08-30T18:00:00Z', elapsed_time: 0 }
  const w = toPlaceholderWorkout(activity, () => 'id')
  assert.equal(w.name, 'Strava activity')
  assert.equal(w.start, w.end) // zero elapsed_time collapses to a point-in-time workout
})

test('filterStrengthActivities keeps only WeightTraining activities', () => {
  const activities = [
    { type: 'Run' }, { type: 'WeightTraining', name: 'A' }, { type: 'Ride' }, { type: 'WeightTraining', name: 'B' },
  ]
  const result = filterStrengthActivities(activities)
  assert.equal(result.length, 2)
  assert.deepEqual(result.map(a => a.name), ['A', 'B'])
})

test('filterStrengthActivities returns an empty array for no activities', () => {
  assert.deepEqual(filterStrengthActivities([]), [])
  assert.deepEqual(filterStrengthActivities(undefined), [])
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd api && npm test`
Expected: this is a self-contained test file with its own copies of the functions (matching the
"mirrors the pure helpers" pattern used throughout this plan), so it passes immediately since
nothing calls into `server.js` yet. Confirm instead that `server.js` doesn't have this logic yet:
`grep -n "toPlaceholderWorkout\|isTokenExpired" api/server.js` should return nothing before Step 3.

- [ ] **Step 3: Implement the pure helpers in `api/server.js`**

Add near `exchangeStravaCode`/`refreshStravaToken` (same "Strava OAuth" section from Task 2),
after `refreshStravaToken`:

```js
function isTokenExpired(expiresAt, now = Date.now()) {
  return !expiresAt || expiresAt <= Math.floor(now / 1000);
}

function toPlaceholderWorkout(activity, idFn = () => 'sw' + crypto.randomBytes(9).toString('base64url')) {
  const startMs = new Date(activity.start_date).getTime();
  const durationMs = (activity.elapsed_time || 0) * 1000;
  return {
    id: idFn(), d: activity.start_date.slice(0, 10),
    start: startMs, end: startMs + durationMs,
    routineId: null, name: activity.name || 'Strava activity',
    entries: [], prs: [], vol: 0,
  };
}

function filterStrengthActivities(activities) {
  return (activities || []).filter(a => a.type === 'WeightTraining');
}
```

- [ ] **Step 4: Implement `ensureFreshStravaToken()` and `fetchStravaActivities()`**

Add immediately after the helpers from Step 3:

```js
async function ensureFreshStravaToken(uid, cfg) {
  if (!isTokenExpired(cfg.expiresAt)) return cfg.accessToken;
  const fresh = await refreshStravaToken(cfg.clientId, cfg.clientSecret, cfg.refreshToken);
  if (!fresh) return null;
  writeStravaConfig(uid, { ...cfg, ...fresh });
  return fresh.accessToken;
}

function fetchStravaActivities(accessToken, afterEpoch) {
  return new Promise((resolve) => {
    const path = '/api/v3/athlete/activities?after=' + encodeURIComponent(afterEpoch) + '&per_page=100';
    const req = https.request({
      host: STRAVA_HOST, path, method: 'GET', timeout: 30000,
      headers: { authorization: 'Bearer ' + accessToken },
    }, res => {
      let body = '';
      res.on('data', d => { body += d });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve([]);
        try { resolve(JSON.parse(body)); } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.end();
  });
}
```

- [ ] **Step 5: Add the poll loop**

Add near the end of the file, alongside the other `setInterval` calls (find one with `grep -n
"setInterval(compactAudit" api/server.js` as a landmark — add this after it, still before the
`http.createServer(...)` call that starts listening):

```js
// Strava sync: every 6 hours, pull new WeightTraining activities for every connected user and
// append them as placeholder workouts. One user's failure (expired/revoked token, network error)
// must never stop this loop for anyone else — every per-user step below is wrapped so a thrown
// error is caught and logged, not propagated.
setInterval(async () => {
  for (const user of db.users) {
    try {
      const cfg = readStravaConfig(user.id);
      if (!cfg?.accessToken) continue;
      const accessToken = await ensureFreshStravaToken(user.id, cfg);
      if (!accessToken) continue;
      const activities = await fetchStravaActivities(accessToken, cfg.lastPollAt || Math.floor(Date.now() / 1000));
      const strengthActivities = filterStrengthActivities(activities);
      if (strengthActivities.length) {
        const S = readState(user.id);
        if (S) {
          S.workouts = [...(S.workouts || []), ...strengthActivities.map(a => toPlaceholderWorkout(a))];
          atomicWrite(stateFile(user.id), JSON.stringify(S));
        }
      }
      const latest = readStravaConfig(user.id) || cfg; // re-read: ensureFreshStravaToken may have updated tokens
      writeStravaConfig(user.id, { ...latest, lastPollAt: Math.floor(Date.now() / 1000) });
    } catch (e) {
      console.error('strava poll failed for user', user.id, e.message);
    }
  }
}, 21600000).unref();
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `cd api && npm test`
Expected: all pass, including the 7 new tests from Step 1.

- [ ] **Step 7: Verify no token leakage in the poll loop's error path**

Run: `grep -n "console.error.*strava\|console.log.*strava" api/server.js`
Expected: only the one line added in Step 5 (`console.error('strava poll failed for user', user.id,
e.message)`) — confirms no access token, refresh token, or client secret is ever logged, even on
failure (only the error's own `.message` and the uid are logged, never the caught error object
itself in full, which could carry request/response details).

- [ ] **Step 8: Commit**

```bash
git add api/server.js api/strava-poll.test.js
git commit -m "feat: add Strava poll loop for automatic WeightTraining sync"
```

---

### Task 4: Frontend — `lib/api.js` exports + Settings UI

**Files:**
- Modify: `frontend/src/lib/api.js`
- Modify: `frontend/src/views/Settings.jsx`

**Interfaces:**
- Consumes: the five routes from Tasks 1-2.
- Produces: `lib/api.js` exports `getStravaStatus()`, `saveStravaConfig(clientId, clientSecret)`,
  `deleteStravaConfig()`, `stravaAuthorizeUrl()`.

- [ ] **Step 1: Read the files this task edits, to match existing conventions**

Run: `grep -n "^export async function getAiStatus\|^export async function saveAiKey" frontend/src/lib/api.js`
— confirm the exact wrapper pattern (e.g. `apiFetch(path, opts)`) used by the Phase 3 AI
functions, and match it exactly.

Run: `grep -n "function AiSuggestCard" -A 40 frontend/src/views/Settings.jsx` — re-read the
existing card's structure (masked inputs, save button, status-driven conditional rows, `Section`/
`Row`/`Switch` usage, `t(...)` i18n calls) to mirror exactly for the new card.

- [ ] **Step 2: Add the API calls to `lib/api.js`**

Using the exact wrapper pattern found in Step 1, add:

```js
export async function getStravaStatus() {
  return apiFetch('/api/strava/status')
}
export async function saveStravaConfig(clientId, clientSecret) {
  return apiFetch('/api/strava/config', { method: 'POST', body: { clientId, clientSecret } })
}
export async function deleteStravaConfig() {
  return apiFetch('/api/strava/config', { method: 'DELETE' })
}
export function stravaAuthorizeUrl() {
  return '/api/strava/authorize'
}
```

(Adjust the wrapper call shape to match whatever Step 1 actually found — `apiFetch` is
illustrative, use the file's real helper name.) Note `getStravaStatus` returns the whole `{
configured, connected }` object (unlike `getAiStatus`, which returns just the boolean) — the
Settings card needs both flags to decide which rows to render, so don't unwrap it here.

- [ ] **Step 3: Add the `StravaSyncCard` component**

In `frontend/src/views/Settings.jsx`, following the structural pattern of `AiSuggestCard` (found
in Step 1), add a new component in the same file, placed near `AiSuggestCard` (not inside the
passkey/push-notification sections):

```jsx
function StravaSyncCard({ toast }) {
  const [status, setStatus] = useState({ configured: false, connected: false })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  useEffect(() => { getStravaStatus().then(setStatus).catch(() => {}) }, [])

  const save = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return
    await saveStravaConfig(clientId.trim(), clientSecret.trim())
    setClientId(''); setClientSecret('')
    setStatus(await getStravaStatus())
    toast(t('Strava app saved'))
  }

  const disconnect = async () => {
    await deleteStravaConfig()
    setStatus({ configured: false, connected: false })
    toast(t('Strava disconnected'))
  }

  return (
    <Section title={t('Strava sync')} footer={t('Uses your own Strava API application — see developers.strava.com. New WeightTraining activities are synced automatically, roughly every 6 hours.')}>
      {!status.connected && (
        <>
          <Row icon="key" iconTint="var(--acc)" title={t('Client ID')}>
            <input type="text" value={clientId} onChange={e => setClientId(e.target.value)} />
          </Row>
          <Row icon="key" iconTint="var(--acc)" title={t('Client Secret')}>
            <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
          </Row>
          <Row icon="save" iconTint="var(--acc)" title={t('Save Strava app')} accessory="chevron" onClick={save} />
        </>
      )}
      {status.configured && !status.connected && (
        <Row icon="link" iconTint="var(--acc)" title={t('Connect with Strava')} accessory="chevron"
          onClick={() => { window.location.href = stravaAuthorizeUrl() }} />
      )}
      {status.connected && (
        <>
          <Row icon="check" iconTint="var(--green)" title={t('Connected to Strava')} />
          <Row icon="unlink" iconTint="var(--red)" title={t('Disconnect')} accessory="chevron" onClick={disconnect} />
        </>
      )}
    </Section>
  )
}
```

Verify every icon name used (`key`, `save`, `link`, `check`, `unlink`) actually exists in the
codebase before using it — run `grep -rn "icon=\"" frontend/src/views/Settings.jsx
frontend/src/components/Icon.jsx | sort -u -t'"' -k2,2` and substitute the closest existing icon
name for any that don't exist, the same way Phase 4's Settings task did for the streak-reminder
icons. Do not add a new icon asset for this task.

Verify `useState`/`useEffect` are already imported in this file (`grep -n "^import.*useState"
frontend/src/views/Settings.jsx`) — if not, add them to the existing React import line rather than
a separate import statement.

- [ ] **Step 4: Render `StravaSyncCard` in the Settings view**

Find where `AiSuggestCard` is rendered in the main `Settings` component (`grep -n
"<AiSuggestCard" frontend/src/views/Settings.jsx`) and render `<StravaSyncCard toast={toast} />`
immediately after it, passing whatever props the surrounding component already threads through to
sibling cards (check `AiSuggestCard`'s actual prop list from Step 1 and match it — the plan's
example above assumes only `toast`, adjust if the real component takes more).

- [ ] **Step 5: Add i18n entries**

Run: `grep -rln "AI routine suggestion" frontend/src/locales/` to see which locale files carry
Phase 3's AI-feature strings (that phase's own task established the actual convention — some
projects fall back to English for new features and add translations later, matching whatever
Phase 3 actually did). Follow that exact same convention for these new strings: `'Strava sync'`,
`'Client ID'`, `'Client Secret'`, `'Save Strava app'`, `'Connect with Strava'`, `'Connected to
Strava'`, `'Disconnect'`, `'Strava app saved'`, `'Strava disconnected'`, and the footer sentence.
If Phase 3's strings only exist in English (no locale-file entries), do the same here — do not
introduce a stricter i18n bar for this feature than the immediately-preceding AI feature already
set. If Phase 3's strings ARE present in all locale files, add real translations to all of them
the same way Phase 4's fix-round did for its two strings.

- [ ] **Step 6: Run the frontend dev server and manually verify**

Run `cd frontend && npm run dev`, open Settings, confirm: with no Strava app configured, only the
Client ID/Secret inputs + save row show; after saving, the "Connect with Strava" row appears;
after a (real or stubbed) successful connect, "Connected to Strava" + "Disconnect" show instead.
If a real Strava app isn't available, stub `getStravaStatus`/`saveStravaConfig` temporarily to
return canned responses to check the conditional rendering, then revert the stub. Note in the
report which was done and why.

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all pass — this task added no new `.test.js` file itself (Task 3 covers the pure sync
logic server-side; this task is UI wiring), but must not regress anything.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/views/Settings.jsx frontend/src/locales/
git commit -m "feat: add Strava sync UI (app credentials, connect flow, status)"
```

---

### Task 5: Full-scope verification and phase gate

**Files:** none modified — verification only.

- [ ] **Step 1: Full build + test, both sides**

Run: `cd frontend && npm run build && npm test`
Run: `cd api && npm test`
Expected: all succeed.

- [ ] **Step 2: `docker compose build api web`**

Run from the repo root: `docker compose build api web`
Expected: both images build successfully (Docker Desktop must be running).

- [ ] **Step 3: Confirm no dependency was added**

Run: `git diff <first-phase-5-commit>..HEAD -- api/package.json frontend/package.json`
Expected: no output — neither `package.json` changed.

- [ ] **Step 4: Confirm no secret/token leakage across the whole diff**

Run: `git diff <first-phase-5-commit>..HEAD --stat` to list every changed file, then `grep -n
"console.log\|console.error" <each changed region of api/server.js>` to confirm no log statement
added in this phase includes a client secret, access token, refresh token, or full request/response
object in a way that could dump it.

- [ ] **Step 5: Dispatch the three phase-gate subagents**

Invoke, in order, and address any findings before Phase 5 is considered done:
- `the-architect` — confirm `strava-<uid>.json` genuinely stays outside `db.json` and
  `state-<uid>.json`'s own normal write path; confirm the poll loop's direct write to
  `state-<uid>.json` is the only place outside the client's own `POST /api/data` that touches that
  file, and that this is intentional/documented (per the spec's "known limitation" section) rather
  than an accidental new pattern; confirm the OAuth `state`-nonce Map follows the same
  shape/cleanup pattern as `challenges`/`pairings`.
- `cyber-neo` — confirm Strava credentials/tokens are opt-in, never returned by any route, never
  logged (request or response) on any path including errors; confirm the OAuth callback route
  correctly rejects a request with a missing/expired/forged `state` nonce and never trusts the
  session cookie alone for identifying which user's tokens to write; confirm the outbound call
  targets are the hardcoded Strava host with no user-controlled URL; confirm one user's poll
  failure cannot affect another user's data (loop isolation).
- `all-deploy` — confirm `npm run build`, `npm test` (both sides), and `docker compose build api
  web` all still succeed; confirm no new dependency was added to either `package.json`.

- [ ] **Step 6: Final commit (if Step 4 or Step 5 required fixes)**

```bash
git add -A
git commit -m "fix: address Phase 5 gate findings"
```

If nothing needed fixing, skip this commit — Phase 5 is done as of Task 4's commit.
