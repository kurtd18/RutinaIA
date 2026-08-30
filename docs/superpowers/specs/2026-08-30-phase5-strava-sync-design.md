# Phase 5 — Strava Automatic Sync (Design Spec)

**Goal:** A user who has their own Strava developer app can connect it in Settings, and RutinaIA
polls Strava every 6 hours for new `WeightTraining` activities, adding each as a placeholder
workout in their history — no manual CSV export/import needed. Zero cost, zero shared
infrastructure for the RutinaIA maintainer: bring-your-own Strava app, same pattern as Phase 3's
bring-your-own Anthropic key.

## Background and constraints discovered during design

- Strava's official API has, since June 2026, required a paid developer subscription
  ($11.99/mo or $79.99/yr) for Standard-tier access, and Standard tier caps at 10 connected
  athletes per app. A single RutinaIA-owned app would put this cost on the maintainer and cap
  the whole user base at 10 people.
- Strava OAuth apps support exactly **one authorization callback domain** per app — there is no
  way for a single shared Client ID to redirect back to many different self-hosted instances'
  own domains without an intermediate relay service.
- Both constraints are avoided by having **each user register their own Strava API application**
  at developers.strava.com, using their own RutinaIA instance's domain as the callback domain,
  and pasting their own Client ID/Secret into Settings. This mirrors the existing bring-your-own
  Anthropic-key pattern from Phase 3 exactly, and keeps `api/`'s dependency count unchanged (raw
  `node:https`, no Strava SDK).
- Strava's activity API does not expose structured set/rep/weight data for strength training,
  same limitation already documented for Garmin's CSV export in Phase 2. Synced activities become
  placeholder workouts (date, name, duration — empty `entries`), which the user fills in manually
  afterward, identical in shape to what `parseGarminCSV` already produces.
- Per user decision, this phase uses **polling**, not Strava webhooks — simpler, no public
  callback endpoint required beyond the one-time OAuth redirect, and easily within the 200
  req/15min & 2000 req/day free-tier-adjacent rate limit at a 6-hour interval.
- Per user decision, synced activities are **never merged** with existing manually-logged
  workouts on the same date — each becomes its own separate `S.workouts` entry, exactly like two
  independent CSV-imported rows would.

## Data model

New per-user file `strava-<uid>.json` (mode `0600`, outside `db.json` and `state-<uid>.json` —
same isolation pattern as `ai-<uid>.json`):

```json
{
  "clientId": "12345",
  "clientSecret": "...",
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": 1735689600,
  "athleteId": 987654,
  "lastPollAt": 1735689600
}
```

- `clientId`/`clientSecret`: the user's own Strava app credentials, entered once in Settings.
- `accessToken`/`refreshToken`/`expiresAt`: populated after the OAuth authorize flow completes;
  refreshed automatically before each poll if expired.
- `athleteId`: the connected Strava athlete's numeric id, from the OAuth token response —
  informational only (not currently used to scope anything beyond confirming the connection).
- `lastPollAt`: epoch seconds of the last successful poll. Drives the `after` query param on the
  next poll — this is the sync cursor, and doubles as the dedup mechanism (see below).

`db.json` and `state-<uid>.json` are untouched by this new file's existence; `S.workouts` (in
`state-<uid>.json`) gains new entries written directly by the server's poll loop (see Server
Logic).

## Server: OAuth flow

Following the same route-table pattern as every other `api/server.js` endpoint:

- `POST /api/strava/config` — body `{ clientId, clientSecret }`. Session-authenticated. Writes
  `strava-<uid>.json` with just these two fields (no tokens yet — the user still needs to
  authorize). Mirrors `POST /api/ai/key`'s shape exactly.
- `GET /api/strava/authorize` — session-authenticated. Reads the stored `clientId`, builds and
  redirects (302) to `https://www.strava.com/oauth/authorize` with `client_id`, `redirect_uri`
  (`${ORIGIN}/api/strava/callback`, reusing the existing `ORIGIN` env var already used for
  WebAuthn), `response_type=code`, `scope=activity:read`, and a signed `state` parameter carrying
  the user's session/uid (so the callback — hit by Strava's redirect, not by an authenticated
  fetch — knows which user's tokens to write; signed the same HMAC way session cookies already
  are, to prevent forging).
- `GET /api/strava/callback` — receives `?code=...&state=...`, verifies `state`, exchanges `code`
  for tokens via a raw HTTPS POST to `https://www.strava.com/oauth/token` (client_id, client_secret,
  code, grant_type=authorization_code), writes `accessToken`/`refreshToken`/`expiresAt`/`athleteId`
  into the same `strava-<uid>.json`, then redirects (302) back into the app's Settings page with a
  success/failure query flag the frontend can toast on.
- `GET /api/strava/status` — session-authenticated. Returns
  `{ configured: boolean, connected: boolean }` — `configured` means clientId/clientSecret are
  saved, `connected` means a valid (or refreshable) token pair exists. Never returns the secret or
  tokens themselves, matching `GET /api/ai/status`'s never-echo-the-key rule.
- `DELETE /api/strava/config` — session-authenticated. Deletes `strava-<uid>.json` entirely
  (config and tokens both) — matches `DELETE /api/ai/key`'s full-removal behavior.

## Server: poll loop

A new `setInterval` (alongside the existing reminder-loop and challenge-cleanup intervals already
in `api/server.js`), ticking every 6 hours (`21600000` ms):

```js
setInterval(async () => {
  for (const user of db.users) {
    const cfg = readStravaConfig(user.id) // null if never configured
    if (!cfg?.accessToken) continue
    const token = await ensureFreshStravaToken(user.id, cfg) // refreshes if cfg.expiresAt has passed
    if (!token) continue // refresh failed (revoked, etc.) — skip this user this tick, try again next tick
    const activities = await fetchStravaActivities(token, cfg.lastPollAt)
    const strengthActivities = activities.filter(a => a.type === 'WeightTraining')
    if (strengthActivities.length) {
      const S = readState(user.id)
      if (S) {
        S.workouts = [...(S.workouts || []), ...strengthActivities.map(toPlaceholderWorkout)]
        atomicWrite(stateFile(user.id), JSON.stringify(S))
      }
    }
    writeStravaConfig(user.id, { ...cfg, lastPollAt: Math.floor(Date.now() / 1000) })
  }
}, 21600000).unref()
```

- `ensureFreshStravaToken`: if `cfg.expiresAt` is in the past, POST to
  `https://www.strava.com/oauth/token` with `grant_type=refresh_token`, update the stored tokens,
  return the fresh access token; returns `null` on failure (logged, not thrown — one user's
  expired/revoked connection must not stop the loop for everyone else).
- `fetchStravaActivities`: `GET https://www.strava.com/api/v3/athlete/activities?after=<lastPollAt>`
  with the bearer token, raw `https.request`, same style as `callAnthropic`.
- `toPlaceholderWorkout`: maps a Strava activity to the same workout shape `parseGarminCSV`
  already produces — `{ id: 'sw' + uid(), d: <activity date>, start, end, routineId: null, name:
  activity.name, entries: [], prs: [], vol: 0 }` (`'sw'` prefix for "Strava workout", vs. `'iw'`
  for CSV-imported, so the two sources stay distinguishable in `id` if ever needed for debugging).
- **Known limitation, accepted for this phase:** this is the first place `api/server.js` writes to
  `state-<uid>.json` outside of the client's own full-state push (`POST /api/data`). If the
  client pushes a debounced state write at the same moment the poll loop appends a workout, one
  write will clobber the other (last-write-wins on the same file). The risk window is narrow (a
  6-hour poll landing in the same instant as a debounced client save), and the failure mode is
  self-correcting (the client re-pulls state on next load and would only be missing a Strava
  activity it can re-sync next poll cycle, not lose manually-entered data — since the client's
  own in-memory state always wins for what *it* wrote). A real fix (merge-on-write, versioning)
  is out of scope for this phase.

  Two caveats found during final review, tracing the actual committed behavior rather than this
  description: first, the poll loop's write to `state-<uid>.json` does not bump `S._ts` (the
  timestamp field the frontend's `pullState` uses to decide whether to accept server state or
  re-push local state). This means the interleaving that drops a Strava activity is not a narrow
  same-instant race — it is common: any client that makes a local edit before its *next*
  `pullState` call after a poll has already appended a Strava activity will overwrite that
  appended activity when it pushes its own state, and since `lastPollAt` has already advanced
  past that activity's timestamp, it is never retried. A long-running PWA session spanning an
  overnight poll is a realistic everyday trigger for this, not an edge case.

  Second, there is a narrower multi-device scenario where genuinely manually-entered data — not
  just a Strava sync — could be lost: if the poll loop's write regresses the state file as above,
  and a second device then pulls that regressed state and later pushes its own state with a
  bumped `_ts`, the first device's next `pullState` will accept the second device's state as
  authoritative, and the first device's own unsynced local edit can be lost. This requires a
  specific multi-device timing chain and so is narrow, but it means this limitation should not be
  described as fully self-correcting/safe the way the original wording implied.

## Frontend

`frontend/src/lib/api.js` — four new exports, matching the existing wrapper style used by
`getAiStatus`/`saveAiKey`/`deleteAiKey`:

```js
export async function getStravaStatus() { ... } // GET /api/strava/status
export async function saveStravaConfig(clientId, clientSecret) { ... } // POST /api/strava/config
export async function deleteStravaConfig() { ... } // DELETE /api/strava/config
export function stravaAuthorizeUrl() { return '/api/strava/authorize' } // plain link/redirect, not a fetch
```

`frontend/src/views/Settings.jsx` — new `StravaSyncCard`, structurally mirroring the existing
`AiSuggestCard` (same file, same `<Section>`/`<Row>` conventions):

- Two masked text inputs (Client ID, Client Secret) + a save button calling `saveStravaConfig`.
- Once `configured` is true, a "Connect with Strava" `Row` (`accessory="chevron"`) that navigates
  the browser to `GET /api/strava/authorize` (a real navigation/redirect, not a fetch, since the
  user must interact with Strava's own consent screen).
- Once `connected` is true, show connection status and a "Disconnect" action calling
  `deleteStravaConfig`.
- Footer copy explaining: "Uses your own Strava API application — see developers.strava.com.
  New WeightTraining activities are synced automatically, roughly every 6 hours."

## Testing

- `api/strava-sync.test.js` (new): unit tests for the pure mapping/decision functions extracted
  the same way Phase 3 extracted `mapAnthropicResponse` — `toPlaceholderWorkout(activity)` (shape
  matches `parseGarminCSV`'s output for an equivalent activity), a token-freshness check function
  `isTokenExpired(expiresAt, now)`, and the activity-type filter logic isolated as a pure
  predicate. No live network call tested (same pattern as `mapAnthropicResponse`'s tests using
  canned request/response fixtures).
- Manual check: with a real (or sandboxed) Strava app, walk the OAuth connect flow end-to-end,
  confirm a `WeightTraining` activity appears as a placeholder workout after a manual trigger of
  the poll logic (a debug/manual-trigger path may be useful during development, but is not a
  permanent API surface — this phase does not add a "sync now" button, only automatic polling,
  per the "polling, not on-demand" scope decision already made).

## Out of scope (this phase)

- Webhooks (explicitly decided against — polling only).
- Any shared/RutinaIA-owned Strava app, relay, or centralized OAuth callback service.
- Merging Strava-synced workouts with manually-logged workouts on the same date.
- Syncing any activity type other than `WeightTraining` (running, cycling, etc. are not imported).
- A manual "sync now" button — sync is fully automatic on the 6-hour interval only.
- Robust concurrent-write protection between the poll loop and the client's state push (see
  "Known limitation" above).
- Garmin, Samsung, Huawei, or other device/platform sync — tracked separately as the other half of
  the originally-discussed Phase 5 scope (manual multi-brand import improvements), not part of
  this spec.
