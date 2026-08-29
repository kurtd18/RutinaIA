# Phase 3 — AI Routine Suggestion Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can paste their own Anthropic API key in Settings, tap "Suggest a routine", state
goals in free text, and get back an AI-proposed weekly routine they preview and explicitly accept
or discard — with zero outbound calls or UI surface when no key is configured.

**Architecture:** Backend (`api/server.js`) gets four new session-authenticated routes storing the
key in its own file (`ai-<uid>.json`, mode 0600, outside `db.json`) and relaying a single
raw-HTTPS request to `api.anthropic.com` (no SDK — keeps `api/`'s dependency count at two).
Frontend gets a new pure module (`frontend/src/lib/ai-suggest.js`) that builds a compact training
summary by reusing existing derivation helpers, plus a Settings section and a preview sheet
following the same "review before it touches the store" pattern the CSV import flow already uses.

**Tech Stack:** existing repo tooling only — `cd frontend && npm test`, `cd api && npm test`
(`node --test`). No new dependencies on either side.

## Global Constraints

- No dependency added to `api/package.json` — the Anthropic call is raw `node:https`, following
  the same pattern already used for Web Push (`api/server.js`'s `PUSH_AGENT`/`sendPush`).
- The API key is never returned by any route, never logged (including on error paths), and lives
  in `ai-<uid>.json` — never in `db.json`, never in `state-<uid>.json`.
- Model is `claude-opus-5`. Use `output_config.format` (structured output) for the routine shape —
  do not use assistant-turn prefill (it 400s on this model).
- The "Suggest a routine" entry point in Settings must not render at all when
  `GET /api/ai/status` reports `configured: false` — this is the feature's opt-in gate, not just a
  disabled button.
- `buildTrainingSummary()` in `frontend/src/lib/ai-suggest.js` must be a pure function (state in,
  summary object out) reusing `lib/progression.js` / `lib/onerm.js` / `lib/recovery.js` — it must
  not reimplement 1RM or muscle-balance math, and it must not touch the network.
- The suggested routine is never written to `S.routines` except through explicit user
  confirmation in the preview sheet — no auto-apply path.
- Every task ends with the relevant test suite (`cd frontend && npm test` and/or
  `cd api && npm test`) passing before commit.

---

### Task 1: Backend — API key storage routes

**Files:**
- Modify: `api/server.js` (add `aiKeyFile()` helper, three routes: `POST /api/ai/key`,
  `DELETE /api/ai/key`, `GET /api/ai/status`)
- Test: `api/ai-key.test.js` (new)

**Interfaces:**
- Produces: `aiKeyFile(uid) -> string` (file path, mirrors `stateFile(uid)`'s naming/sanitization).
  `readAiKey(uid) -> string | null` — reads and returns the stored key, or null if none/unreadable.
- Consumes: `atomicWrite`, `readSession`, `json`, `readBody` — all already defined in
  `api/server.js` (no new imports needed for this task).

- [ ] **Step 1: Read the current file layout to confirm insertion points**

Run: `grep -n "const stateFile\|function readState\|^const routes = {\|'GET /api/data'" api/server.js`

Confirm `stateFile`/`readState` (around line 59-62) and the `routes` object opening (around line
525) are still there — these are the two places this task edits near.

- [ ] **Step 2: Add `aiKeyFile()` and `readAiKey()` helpers**

Immediately after the existing `readState` function (right after its closing `}`), add:

```js
const aiKeyFile = uid => path.join(DATA, 'ai-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readAiKey(uid) {
  try { return JSON.parse(fs.readFileSync(aiKeyFile(uid), 'utf8')).key || null; } catch { return null; }
}
```

- [ ] **Step 3: Add the three routes**

Inside the `routes` object, immediately after the `'GET /api/me'` entry (find it with
`grep -n "'GET /api/me'" api/server.js`), add:

```js
  'POST /api/ai/key': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const key = String(body.key || '').trim();
    if (!key) return json(res, 400, { error: 'key required' });
    atomicWrite(aiKeyFile(user.id), JSON.stringify({ key }), { mode: 0o600 });
    json(res, 200, { ok: true });
  },

  'DELETE /api/ai/key': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try { fs.unlinkSync(aiKeyFile(user.id)); } catch {}
    json(res, 200, { ok: true });
  },

  'GET /api/ai/status': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { configured: !!readAiKey(user.id) });
  },
```

- [ ] **Step 4: Check `atomicWrite`'s signature supports a mode option**

Run: `grep -n "function atomicWrite" -A 5 api/server.js`

The existing `atomicWrite(file, content)` (around line 54) does not take a mode argument today —
`fs.writeFileSync(tmp, content)` with default permissions, then `fs.renameSync`. Extend it to
accept an optional third `opts` argument, defaulting to today's behavior, so this task's `mode:
0o600` call actually restricts permissions (matching how `secretFile`/`vapidFile` are written
elsewhere in this file with `{ mode: 0o600 }`):

```js
function atomicWrite(file, content, opts) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, opts);
  fs.renameSync(tmp, file);
}
```

Verify this doesn't break any existing caller: `grep -n "atomicWrite(" api/server.js` — every
other call site passes only two arguments, so `opts` is `undefined` there and
`fs.writeFileSync(tmp, content, undefined)` behaves identically to the two-argument form.

- [ ] **Step 5: Write the tests**

Create `api/ai-key.test.js` (match the style of `api/verify-error.test.js` /
`api/push-messages.test.js` — run `grep -n "^import\|^describe\|^test" api/verify-error.test.js`
first to confirm the test file conventions: plain `node:test`, no framework). Since
`aiKeyFile`/`readAiKey` are not exported from `server.js` (it's a single-file app with no module
exports for these), test them via a small standalone harness that duplicates only the two pure
helpers under test — this mirrors the fact that `server.js` itself has no exported surface to unit
test directly; if `server.js` already exports anything for testing (check
`grep -n "^export" api/server.js`), export `aiKeyFile`/`readAiKey`/`atomicWrite` the same way
instead of duplicating them.

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mirrors the helpers added to api/server.js in this task — kept in sync manually
// since server.js has no module exports today.
function atomicWrite(file, content, opts) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, content, opts)
  fs.renameSync(tmp, file)
}
const aiKeyFile = (dataDir, uid) => path.join(dataDir, 'ai-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json')
function readAiKey(dataDir, uid) {
  try { return JSON.parse(fs.readFileSync(aiKeyFile(dataDir, uid), 'utf8')).key || null } catch { return null }
}

test('readAiKey returns null when no key file exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-key-'))
  assert.equal(readAiKey(dir, 'u1'), null)
})

test('atomicWrite + readAiKey round-trips a key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-key-'))
  atomicWrite(aiKeyFile(dir, 'u1'), JSON.stringify({ key: 'sk-ant-test123' }), { mode: 0o600 })
  assert.equal(readAiKey(dir, 'u1'), 'sk-ant-test123')
})

test('aiKeyFile sanitizes the uid the same way stateFile does', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-key-'))
  const f = aiKeyFile(dir, '../../etc/passwd')
  assert.ok(!f.includes('..'))
  assert.ok(path.dirname(f) === dir)
})

test('key file is written with restrictive permissions (mode 0600)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-key-'))
  const f = aiKeyFile(dir, 'u1')
  atomicWrite(f, JSON.stringify({ key: 'sk-ant-test123' }), { mode: 0o600 })
  const mode = fs.statSync(f).mode & 0o777
  // Windows CI may not enforce POSIX modes identically — only assert on POSIX platforms
  if (process.platform !== 'win32') assert.equal(mode, 0o600)
})
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `cd api && npm test`
Expected: all pass, including the 4 new tests and every pre-existing test (`push-messages.test.js`,
`verify-error.test.js`).

- [ ] **Step 7: Manual sanity check of the three routes**

Since `server.js` has no test harness that boots the HTTP server, do a quick manual check: start
the API (`cd api && DATA_DIR=/tmp/rutinaia-ai-test node server.js`, or the repo's existing dev-run
method — check `docker-compose.yml`/README for the usual local-run command first), and against a
signed-in session cookie, hit `POST /api/ai/key`, `GET /api/ai/status`, `DELETE /api/ai/key`,
`GET /api/ai/status` again, confirming the boolean flips and no route ever echoes the key. Note in
the report file whether this manual check was actually performed or skipped, and why.

- [ ] **Step 8: Commit**

```bash
git add api/server.js api/ai-key.test.js
git commit -m "feat: add API key storage routes for AI routine suggestions"
```

---

### Task 2: Backend — `POST /api/ai/suggest`

**Files:**
- Modify: `api/server.js` (add `callAnthropic()` helper, `POST /api/ai/suggest` route)
- Test: `api/ai-suggest.test.js` (new)

**Interfaces:**
- Consumes: `readAiKey` from Task 1 (same file, already present).
- Produces: `POST /api/ai/suggest` — body `{ summary: object, goals: string }` — response
  `{ ok: true, routine: { name, emoji, ex: [{ id, sets, reps, weight, mode }] } }` on success, or
  `{ ok: false, error: 'no key configured' | 'declined' | 'provider error' }` on failure. Status
  codes: 401 (no session), 400 (`no key configured`, or malformed request body), 200 with
  `ok: false` for a provider-side decline or error (this is a normal response the frontend must
  branch on, not an HTTP error — matches how `parseImport()`'s `{error: ...}` shape works on the
  frontend side).

- [ ] **Step 1: Write the failing tests first**

Create `api/ai-suggest.test.js`. This tests the request-building and response-mapping logic in
isolation (no real network call) — extract the pure parts as testable functions rather than
testing the live HTTPS call:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Mirrors the pure helpers added to api/server.js in this task.
function buildAnthropicRequestBody(summary, goals) {
  return {
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            emoji: { type: 'string' },
            ex: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  sets: { type: 'integer' },
                  reps: { type: 'integer' },
                  weight: { type: 'number' },
                  mode: { type: 'string', enum: ['reps'] },
                },
                required: ['id', 'sets', 'reps', 'weight', 'mode'],
                additionalProperties: false,
              },
            },
          },
          required: ['name', 'emoji', 'ex'],
          additionalProperties: false,
        },
      },
    },
    messages: [{
      role: 'user',
      content: `Training summary:\n${JSON.stringify(summary)}\n\nGoals: ${goals}\n\nPropose a single weekly routine as the specified JSON shape.`,
    }],
  }
}

function mapAnthropicResponse(status, body) {
  if (status !== 200) return { ok: false, error: 'provider error' }
  let parsed
  try { parsed = JSON.parse(body) } catch { return { ok: false, error: 'provider error' } }
  if (parsed.stop_reason === 'refusal') return { ok: false, error: 'declined' }
  const textBlock = (parsed.content || []).find(b => b.type === 'text')
  if (!textBlock) return { ok: false, error: 'provider error' }
  let routine
  try { routine = JSON.parse(textBlock.text) } catch { return { ok: false, error: 'provider error' } }
  return { ok: true, routine }
}

test('buildAnthropicRequestBody uses claude-opus-5 and structured output, not prefill', () => {
  const req = buildAnthropicRequestBody({ workouts: [] }, 'build muscle')
  assert.equal(req.model, 'claude-opus-5')
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.ok(!req.messages.some(m => m.role === 'assistant'))
})

test('mapAnthropicResponse maps a refusal stop_reason to a declined error', () => {
  const body = JSON.stringify({ stop_reason: 'refusal', content: [] })
  assert.deepEqual(mapAnthropicResponse(200, body), { ok: false, error: 'declined' })
})

test('mapAnthropicResponse maps a non-200 status to a provider error', () => {
  assert.deepEqual(mapAnthropicResponse(500, '{}'), { ok: false, error: 'provider error' })
})

test('mapAnthropicResponse parses a successful structured-output routine', () => {
  const routine = { name: 'Push Day', emoji: '💪', ex: [{ id: '0025', sets: 3, reps: 8, weight: 60, mode: 'reps' }] }
  const body = JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(routine) }] })
  assert.deepEqual(mapAnthropicResponse(200, body), { ok: true, routine })
})

test('mapAnthropicResponse handles malformed JSON in the text block', () => {
  const body = JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] })
  assert.deepEqual(mapAnthropicResponse(200, body), { ok: false, error: 'provider error' })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd api && npm test`
Expected: FAIL — this is a self-contained test file with its own copies of the functions, so it
will actually pass immediately since nothing calls into `server.js`. This is intentional per the
"mirrors the pure helpers" pattern used in Task 1 — the meaningful failure to check for here is
that `api/server.js` does NOT yet have `POST /api/ai/suggest` wired up. Confirm that instead:
`grep -n "POST /api/ai/suggest" api/server.js` should return nothing before Step 3.

- [ ] **Step 3: Implement `callAnthropic()` and the route**

Add near the top of `api/server.js`, after the `PUSH_AGENT`/`sendPush` block (find it with
`grep -n "async function sendPush"`), the request builder, response mapper, and HTTPS call:

```js
/* ---------- AI routine suggestion (Anthropic, bring-your-own-key) ---------- */
// Raw HTTPS, no SDK — api/ has a hard two-dependency limit (see CONTRIBUTING.md) and already
// makes outbound HTTPS calls this way for Web Push. Unlike the push path, the hostname here is
// fixed (api.anthropic.com), never user-supplied, so none of PUSH_AGENT's SSRF guarding applies.
const ANTHROPIC_HOST = 'api.anthropic.com'
const ANTHROPIC_TIMEOUT_MS = 30000

function buildAnthropicRequestBody(summary, goals) {
  return {
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            emoji: { type: 'string' },
            ex: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  sets: { type: 'integer' },
                  reps: { type: 'integer' },
                  weight: { type: 'number' },
                  mode: { type: 'string', enum: ['reps'] },
                },
                required: ['id', 'sets', 'reps', 'weight', 'mode'],
                additionalProperties: false,
              },
            },
          },
          required: ['name', 'emoji', 'ex'],
          additionalProperties: false,
        },
      },
    },
    messages: [{
      role: 'user',
      content: `Training summary:\n${JSON.stringify(summary)}\n\nGoals: ${goals}\n\nPropose a single weekly routine as the specified JSON shape.`,
    }],
  }
}

function mapAnthropicResponse(status, body) {
  if (status !== 200) return { ok: false, error: 'provider error' }
  let parsed
  try { parsed = JSON.parse(body) } catch { return { ok: false, error: 'provider error' } }
  if (parsed.stop_reason === 'refusal') return { ok: false, error: 'declined' }
  const textBlock = (parsed.content || []).find(b => b.type === 'text')
  if (!textBlock) return { ok: false, error: 'provider error' }
  let routine
  try { routine = JSON.parse(textBlock.text) } catch { return { ok: false, error: 'provider error' } }
  return { ok: true, routine }
}

function callAnthropic(apiKey, summary, goals) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(buildAnthropicRequestBody(summary, goals))
    const req = https.request({
      host: ANTHROPIC_HOST,
      path: '/v1/messages',
      method: 'POST',
      timeout: ANTHROPIC_TIMEOUT_MS,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    }, res => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => resolve(mapAnthropicResponse(res.statusCode, body)))
    })
    // Never log `payload` or the request object here — it carries the caller's API key in a
    // header. Only the error's own message (never the request) is safe to surface.
    req.on('error', () => resolve({ ok: false, error: 'provider error' }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'provider error' }) })
    req.end(payload)
  })
}
```

Then add the route inside `routes`, immediately after `'GET /api/ai/status'` from Task 1:

```js
  'POST /api/ai/suggest': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const apiKey = readAiKey(user.id);
    if (!apiKey) return json(res, 400, { error: 'no key configured' });
    const body = await readBody(req);
    if (!body.summary || typeof body.summary !== 'object') return json(res, 400, { error: 'summary required' });
    const goals = String(body.goals || '').trim().slice(0, 2000);
    const result = await callAnthropic(apiKey, body.summary, goals);
    json(res, 200, result);
  },
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd api && npm test`
Expected: all pass, including the 5 new tests from Step 1.

- [ ] **Step 5: Verify no key/payload leakage on the error path**

Run: `grep -n "console.error\|console.log" api/server.js | grep -i "anthropic\|apiKey\|payload"`
Expected: no matches — confirms the `req.on('error', ...)` handler added in Step 3 does not log
the request or key.

- [ ] **Step 6: Commit**

```bash
git add api/server.js api/ai-suggest.test.js
git commit -m "feat: add POST /api/ai/suggest, raw HTTPS relay to Anthropic"
```

---

### Task 3: Frontend — `buildTrainingSummary()`

**Files:**
- Create: `frontend/src/lib/ai-suggest.js`
- Test: `frontend/src/lib/ai-suggest.test.js`

**Interfaces:**
- Produces: `buildTrainingSummary(state) -> { recentWorkouts: [...], oneRepMaxes: {...}, muscleBalance: {...} }`
  — exact internal shape is this task's to design against the real derivation modules; the
  external contract other tasks depend on is just: pure function, no network, takes the Zustand
  state shape (`S.workouts`, `S.exWeights`, etc.), returns a plain JSON-serializable object.
- Consumes: whatever `lib/progression.js`, `lib/onerm.js`, `lib/recovery.js` already export for
  "current estimated 1RM" and "muscle balance" — **read these three files first** (they were not
  fully read while writing this plan) to find their actual exported function names/signatures
  before writing `buildTrainingSummary`. Do not invent function names.

- [ ] **Step 1: Read the derivation modules to find real exports**

Run: `grep -n "^export function\|^export const" frontend/src/lib/onerm.js frontend/src/lib/recovery.js frontend/src/lib/progression.js`

Use the actual exported names found here when writing Step 3 — the plan cannot enumerate them
without having read the files, so this step is not optional busywork, it's where the real
function signatures come from.

- [ ] **Step 2: Write the failing tests first**

Create `frontend/src/lib/ai-suggest.test.js` (match the existing test file conventions in
`frontend/src/lib/` — run `grep -n "^import\|^describe\|^test" frontend/src/lib/onerm.test.js`
first, if it exists, to match style; otherwise match `import-csv.test.js`'s vitest style).

Write at minimum these cases (fill in real fixture shapes matching what `frontend/src/store/useStore.js`'s
initial state / a populated state actually looks like — check `grep -n "workouts:\|exWeights:\|bodyweight:" frontend/src/store/useStore.js`
for the real field names before writing fixtures):

```js
import { describe, test, expect } from 'vitest'
import { buildTrainingSummary } from './ai-suggest.js'

describe('buildTrainingSummary', () => {
  test('returns an empty-but-valid summary for a user with no workout history', () => {
    const S = { workouts: [], exWeights: {}, customEx: [], unit: 'kg' }
    const summary = buildTrainingSummary(S)
    expect(summary).toBeTruthy()
    expect(Array.isArray(summary.recentWorkouts)).toBe(true)
    expect(summary.recentWorkouts).toHaveLength(0)
  })

  test('does not touch the network — pure function', () => {
    // Sanity guard: calling it twice with the same input gives the same output (no hidden state/IO)
    const S = { workouts: [], exWeights: {}, customEx: [], unit: 'kg' }
    expect(buildTrainingSummary(S)).toEqual(buildTrainingSummary(S))
  })

  // Additional cases the implementer must add once Step 1's real exports are known:
  // - a populated S.workouts produces non-empty recentWorkouts with exercise ids/sets/reps
  // - S.exWeights entries surface as oneRepMaxes (reusing onerm.js's estimator, not reimplementing it)
  // - a muscle-balance snapshot is present and matches what recovery.js would compute for the same state
})
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `cd frontend && npx vitest run src/lib/ai-suggest.test.js`
Expected: FAIL — `ai-suggest.js` doesn't exist yet.

- [ ] **Step 4: Implement `buildTrainingSummary()`**

Using the real exports found in Step 1, write `frontend/src/lib/ai-suggest.js`. Structure:

```js
// Builds a compact, JSON-serializable summary of the user's training history for the AI routine
// suggestion feature. Pure — no network calls. Reuses the existing derivation modules rather than
// recomputing 1RM/muscle-balance math, so this and the rest of the app never disagree about what
// a user's training says.
import { /* real exports found in Step 1 */ } from './onerm.js'
import { /* real exports found in Step 1 */ } from './recovery.js'

const RECENT_WEEKS = 8

export function buildTrainingSummary(S) {
  const cutoff = Date.now() - RECENT_WEEKS * 7 * 24 * 3600000
  const recentWorkouts = (S.workouts || [])
    .filter(w => w.start >= cutoff)
    .map(w => ({
      d: w.d,
      name: w.name,
      entries: w.entries.map(e => ({
        id: e.id,
        sets: e.sets.map(s => ({ w: s.w, r: s.r })),
      })),
    }))

  // Fill in using the real onerm.js/recovery.js exports from Step 1 — do not hand-roll the math.
  const oneRepMaxes = {} // exercise id -> estimated 1RM, from onerm.js over S.workouts/S.exWeights
  const muscleBalance = {} // body-part -> whatever recovery.js's existing summary shape is

  return { recentWorkouts, oneRepMaxes, muscleBalance }
}
```

- [ ] **Step 5: Fill in the real oneRepMaxes/muscleBalance computation and finish the tests from Step 2**

Wire the actual calls to the Step 1 exports, then add the "populated history" test cases noted as
TODO in Step 2's test file, using a realistic fixture (copy the shape of an existing workout
fixture from another test file in `frontend/src/lib/` via `grep -rn "entries:.*\[{" frontend/src/lib/*.test.js`
rather than inventing one from scratch).

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `cd frontend && npx vitest run src/lib/ai-suggest.test.js`
Expected: PASS, all cases.

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all pass (no regression in any other file).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/ai-suggest.js frontend/src/lib/ai-suggest.test.js
git commit -m "feat: add buildTrainingSummary pure helper for AI routine suggestions"
```

---

### Task 4: Frontend — Settings UI + suggestion sheet

**Files:**
- Modify: `frontend/src/views/Settings.jsx` (add "AI routine suggestion" section)
- Modify: `frontend/src/sheets.jsx` (add the goals-input + preview sheet)
- Modify: `frontend/src/lib/api.js` (add the three API calls, per its role as "the only place that
  talks to the backend")

**Interfaces:**
- Consumes: `buildTrainingSummary` from Task 3, the three routes from Tasks 1-2.
- Produces: `lib/api.js` exports (name them to match that file's existing export style — read it
  first): `getAiStatus()`, `saveAiKey(key)`, `deleteAiKey()`, `suggestRoutine(summary, goals)`.

- [ ] **Step 1: Read the files this task edits, to match existing conventions**

Run: `grep -n "^export" frontend/src/lib/api.js` — find the existing call pattern (likely a
shared `fetch` wrapper) and match it exactly rather than hand-rolling new fetch calls.

Run: `grep -n "function ImportSummary\|function importFromApp\|ui().openSheet" frontend/src/sheets.jsx`
— re-confirm the sheet-opening pattern already used for `ImportSummary` (read in this plan's
design phase): `ui().openSheet(close => <Component .../>)`, `update(s => {...})` for store writes,
`toast(...)` for confirmation messages, `t(...)` for i18n strings.

Run: `grep -n "function Settings\|<h4 className=\"sec\"" frontend/src/views/Settings.jsx` — find
an existing settings section (e.g. push notifications, from earlier phase-1 work) to match its
structural pattern (a `<h4 className="sec">` heading, `<Row>` components) for the new section.

- [ ] **Step 2: Add the API calls to `lib/api.js`**

Using the exact wrapper pattern found in Step 1, add four functions. If the existing wrapper is
e.g. `apiFetch(path, opts)`, follow that; the shapes below assume such a wrapper exists — adjust
to match what Step 1 actually found:

```js
export async function getAiStatus() {
  const r = await apiFetch('/api/ai/status')
  return r.configured
}
export async function saveAiKey(key) {
  return apiFetch('/api/ai/key', { method: 'POST', body: { key } })
}
export async function deleteAiKey() {
  return apiFetch('/api/ai/key', { method: 'DELETE' })
}
export async function suggestRoutine(summary, goals) {
  return apiFetch('/api/ai/suggest', { method: 'POST', body: { summary, goals } })
}
```

- [ ] **Step 3: Add the Settings section**

In `frontend/src/views/Settings.jsx`, following the structural pattern found in Step 1, add a new
section (placed near other account-level settings, not inside the passkey/push sections):

- A heading, e.g. `<h4 className="sec">{t('AI routine suggestion')}</h4>`.
- A key-entry `<Row>` with a text input (masked/password-style) and a save button calling
  `saveAiKey(key)`, on success setting local state so the UI reflects "configured".
- A "remove key" action visible only when configured, calling `deleteAiKey()`.
- A "Suggest a routine" `<Row>` rendered **only when `getAiStatus()` returned true** (fetch this
  on mount, e.g. via the same `useEffect`/load pattern other async Settings data already uses —
  check how push-subscription status is loaded for the existing convention). Tapping it opens the
  goals-input sheet from Step 4.

- [ ] **Step 4: Add the goals-input + preview sheet in `sheets.jsx`**

Two sheets, or one sheet with two internal steps — match whichever pattern `ImportSummary`/its
caller already uses for "collect input, then show a result to confirm." Minimum behavior:

1. **Goals sheet**: a free-text field, a submit button. On submit: call
   `buildTrainingSummary(S)` (import from `lib/ai-suggest.js`), then `suggestRoutine(summary, goals)`.
   Show a loading state while the request is in flight.
2. **On success** (`result.ok === true`): open a preview showing `result.routine`'s name, emoji,
   and each exercise (id resolved to its display name via the existing exercise-lookup used
   elsewhere, e.g. `EXIDX` from `lib/exercises.js`), sets/reps/weight. A "Add this routine" button
   that does `update(s => { s.S.routines.push({ id: 'r' + uid(), ...result.routine }) })` (match
   the exact routine-id-generation convention — check how `RoutineEdit.jsx` mints new routine ids
   via `grep -n "uid()" frontend/src/views/RoutineEdit.jsx` and reuse the same helper), closes the
   sheet, and shows a `toast(...)` confirmation. A "Discard" button that just closes with no state
   change.
3. **On failure** (`result.ok === false`): map `result.error` to a user-facing message —
   `'declined'` → something like `t('The AI provider declined this request.')`, `'no key
   configured'` → shouldn't be reachable given the entry-point gating, but handle it gracefully
   anyway (e.g. same message as a generic failure), `'provider error'` → a generic retry message.

- [ ] **Step 5: Validate returned exercise IDs before rendering/accepting**

Per the design spec's security section, the model's structured output is untrusted: before the
preview sheet renders or the "Add this routine" action commits, filter `result.routine.ex` to
entries whose `id` exists in `EXIDX` (drop any that don't, and if that leaves zero exercises,
treat the whole response as `ok: false` with a `'provider error'`-style message rather than
offering to add an empty routine). Clamp `sets`/`reps` to sane positive-integer ranges and `weight`
to a sane non-negative number before display, mirroring how `import-csv.js` already sanitizes
numeric fields from an untrusted source (`Math.round(num(...))` pattern).

- [ ] **Step 6: Run the frontend dev server and manually click through the flow**

Run `cd frontend && npm run dev`, sign in as a guest/demo profile, and manually verify: with no key
configured, the "Suggest a routine" row does not appear; after saving a key (even a fake one for
this UI check), it appears; submitting goals shows a loading state; simulate both a success and a
failure path if a real key isn't available (e.g. temporarily stub `suggestRoutine` to return a
canned response) to confirm the preview and error-message rendering both look right. Note in the
report whether a real Anthropic call was exercised or only the UI shell was checked, and why.

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all pass — this task added no new `.test.js` files itself (Task 3 covers the pure logic;
this task is UI wiring), but must not regress anything.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/Settings.jsx frontend/src/sheets.jsx frontend/src/lib/api.js
git commit -m "feat: add AI routine suggestion UI (key management, goals sheet, preview)"
```

---

### Task 5: Full-scope verification and phase gate

**Files:** none modified — verification only.

- [ ] **Step 1: Full build + test, both sides**

Run: `cd frontend && npm run build && npm test`
Run: `cd api && npm test`
Expected: all succeed.

- [ ] **Step 2: Confirm no key/secret leakage across the whole diff**

Run: `git diff main --stat` (or the equivalent range for this branch) to list every changed file,
then `grep -n "console.log\|console.error" <each changed api/server.js region>` to confirm no log
statement added in this phase includes a request body, header object, or the word `apiKey`/`key`
verbatim in a way that could dump it.

- [ ] **Step 3: Dispatch the three phase-gate subagents**

Invoke, in order, and address any findings before Phase 3 is considered done:
- `the-architect` — confirm the AI key storage genuinely stays outside `db.json` and every admin
  route's field-whitelisting pattern; confirm `buildTrainingSummary` doesn't fork 1RM/muscle-balance
  logic away from `lib/onerm.js`/`lib/recovery.js`; confirm the suggested routine only ever reaches
  `S.routines` through the explicit "Add this routine" action, never automatically.
- `cyber-neo` — confirm the API key is opt-in, never returned by any route, never logged (request
  or response) on any path including errors; confirm the outbound call target is the hardcoded
  Anthropic host with no user-controlled URL; confirm the model's structured-output response is
  validated (exercise IDs checked against `EXIDX`, numeric fields clamped) before being offered to
  the user or written to state.
- `all-deploy` — confirm `npm run build`, `npm test` (both sides), and `docker compose build api
  web` all still succeed; confirm no new dependency was added to either `package.json`.

- [ ] **Step 4: Final commit (if Step 2 or Step 3 required fixes)**

```bash
git add -A
git commit -m "fix: address Phase 3 gate findings"
```

If nothing needed fixing, skip this commit — Phase 3 is done as of Task 4's commit.
