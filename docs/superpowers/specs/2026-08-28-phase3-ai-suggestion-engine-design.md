# Phase 3: AI routine suggestion engine — design

Date: 2026-08-28
Status: Approved

## Context

Phases 1 (rebrand) and 2 (Garmin import) are merged to `main`. This is Phase 3 of the RutinaIA
roadmap defined in `docs/superpowers/specs/2026-08-27-rutinaia-rebrand-and-features-design.md`: a
motor de sugerencia de rutina por IA using an LLM provider, bring-your-own-key, that reads the
user's existing training history and proposes/adjusts their weekly plan.

## Provider and model

Anthropic only (per phase-1 decision). Model: `claude-opus-5`, the current default per the
`claude-api` skill's mandatory-default rule (no reason here to deviate — this is a single-call,
non-agentic classification/generation task, not a coding/agentic workload). Requests use adaptive
thinking (the Claude Opus 5 default — no `thinking` param needs to be sent) and
`output_config.format` (structured JSON output) instead of assistant-turn prefill, since prefill
returns a 400 on this model family.

## Why raw HTTPS instead of the official SDK

`api/`'s `CONTRIBUTING.md` constraint is explicit and currently exactly met: `api/package.json`
has precisely two dependencies (`@simplewebauthn/server`, `web-push`). Adding `@anthropic-ai/sdk`
would be a third, a "hard sell" per the project's own stated bar. `api/server.js` already makes
outbound HTTPS requests without a dependency — it imports `node:https` directly for the
SSRF-hardened push-notification path (`PUSH_AGENT`, `isPrivateAddr`, `PUSH_TIMEOUT_MS` — see
`api/server.js` lines ~72-100). The Anthropic call follows the same pattern: a single
`https.request` to a **fixed, hardcoded hostname** (`api.anthropic.com`) — no user-supplied URL,
so none of the SSRF protections built for the push path apply here (those exist because push
endpoints are attacker/user-chosen; the AI provider host never is). This keeps the dependency
count at two.

## Where the API key lives

**Not in `db.json`.** Every existing admin route (`GET /api/admin/users`, `GET /api/admin/user`)
explicitly whitelists fields it returns rather than spreading the user object — a deliberate
pattern per the comment at `api/server.js`'s `POST /api/push/subscribe` ("caller-supplied and
would otherwise put arbitrary fields into db.json, which every admin route reads back out"). Storing
the AI key inside `db.users[]` would still be *technically* safe under that pattern, but it's the
kind of thing a future edit could accidentally leak via a stray `...u` spread. Instead, the key
lives in its own per-user file, `ai-<uid>.json`, written with the same restrictive-permission
`atomicWrite` pattern already used for `secret` and `vapid.json` (mode `0600`). This structurally
separates it from every object any admin route iterates over.

## API surface (new routes in `api/server.js`)

- **`POST /api/ai/key`** — body `{ key: string }`. Requires session auth (`readSession(req)`).
  Writes `ai-<uid>.json` with `{ key }`. Returns `{ ok: true }`. Never echoes the key back.
- **`DELETE /api/ai/key`** — requires session auth. Deletes `ai-<uid>.json` if present. Returns
  `{ ok: true }`.
- **`GET /api/ai/status`** — requires session auth. Returns `{ configured: boolean }` only — never
  the key, not even masked.
- **`POST /api/ai/suggest`** — requires session auth. Body: `{ summary: object, goals: string }`
  (see "Request/response shape" below). Reads the user's key from `ai-<uid>.json`; if absent,
  returns `400 { error: 'no key configured' }` without attempting any outbound call. Builds the
  prompt server-side, makes the HTTPS request to Anthropic, and returns either the structured
  routine suggestion or a clear error (including surfacing a `stop_reason: "refusal"` as a
  user-facing "the provider declined this request" message, not a generic 500).

All four routes 401 immediately if `readSession(req)` returns no user, matching every existing
authenticated route's pattern (`GET /api/data`, `POST /api/push/subscribe`, etc.).

## Data flow: who builds the training summary

The frontend does. `CONTRIBUTING.md` is explicit: "anything that decides what you lift next, or
reads a logged session back, is a pure helper here with a unit test beside it" — the training
summary that shapes an AI-generated routine is squarely this kind of logic, and the pure
derivation modules it needs (`lib/progression.js`, `lib/onerm.js`, `lib/recovery.js`) already only
exist as frontend ES modules. Duplicating their logic in `api/server.js` would fork the "what does
this user's training say" computation into two places that could drift. Instead:

- **New file: `frontend/src/lib/ai-suggest.js`** — pure, no network calls. Exports
  `buildTrainingSummary(state)`, which reuses the existing derivation modules to produce a compact
  JSON object: recent workouts (last N weeks, exercise names + sets/reps/weight trend), current
  estimated 1RM per exercise the user has trained, and muscle-group balance/recovery snapshot.
  Paired with `ai-suggest.test.js`.
- The frontend calls `buildTrainingSummary(S)`, combines it with the user's free-text goals, and
  `POST`s `{ summary, goals }` to `/api/ai/suggest`.
- `api/server.js` treats `summary` and `goals` as opaque data to interpolate into the prompt — it
  does not re-derive or validate training semantics, only forwards.

## Request/response shape

**Request to Anthropic** (built server-side in `api/server.js`):
- `model: "claude-opus-5"`, minimal/no `thinking` override (adaptive is the Opus 5 default),
  `output_config.format` set to a JSON-schema matching the routine shape below (structured output,
  not prefill — prefill 400s on this model).
- System/user prompt: instructs the model to propose a weekly routine given the training summary
  and stated goals, referencing the existing exercise ID space (`frontend/src/lib/exercises.js`'s
  dataset IDs) so returned exercise references match real library entries. The exact prompt text
  is an implementation detail for the implementation plan, not fixed here.

**Structured output schema** — one routine object matching the shape already consumed by
`views/Plan.jsx` / `views/RoutineEdit.jsx`:
```json
{
  "name": "string",
  "emoji": "string",
  "ex": [
    { "id": "string (exercise id from the dataset)", "sets": "number", "reps": "number",
      "weight": "number", "mode": "'reps'" }
  ]
}
```
This is a **subset** of the fields a full routine `ex[]` entry can carry (`warmupSets`,
`bodyweight`, `side`, etc. are omitted from what the model must produce) — the frontend fills in
sane defaults for anything not returned, the same way `RoutineEdit.jsx` already does when a user
manually adds an exercise.

**Response to the frontend**: `{ ok: true, routine: {...} }` on success, or `{ ok: false, error:
'declined' | 'no key configured' | 'provider error' | ... }` on failure. `stop_reason: "refusal"`
maps to `'declined'`.

## Applying the suggestion — preview, not direct write

Same pattern as the Garmin/CSV import flow (`frontend/src/sheets.jsx`'s `ImportSummary`): the
returned routine is shown in a new preview sheet (exercises, sets/reps/weight) before anything
touches `S.routines`. The user explicitly confirms to add/replace the routine, or discards it with
zero state change. No new persisted "draft" field is needed — the suggestion lives in ephemeral UI
state (`store/useUI.js`-style, matching how other sheets hold their in-flight data) until accepted.

## UI

- **Settings**: new "AI routine suggestion" section. A field to paste/save the Anthropic API key
  (`POST /api/ai/key`), a "remove key" action (`DELETE /api/ai/key`), and — only rendered when
  `GET /api/ai/status` reports `configured: true` — a "Suggest a routine" entry point. With no key
  configured, that entry point does not render at all (matches the phase-1 spec's "the feature
  simply doesn't appear" requirement).
- **New sheet**: opened from that entry point. Free-text field for goals, a submit action that
  calls `buildTrainingSummary` + `POST /api/ai/suggest`, a loading state, and on success renders
  the preview described above.

## Security

- The key is opt-in (nothing calls out to Anthropic unless the user has pasted one), stored
  server-side only, in its own file outside `db.json`, mode `0600`, never returned by any route.
- Outbound request goes to a hardcoded host (`api.anthropic.com`) — no SSRF surface, since no
  user-controlled URL is ever dialed.
- Request/response bodies are never written to `data/audit.log` (which logs sign-in/admin events
  only, per the existing pattern) or console output, including on error paths — a failed Anthropic
  call must not dump the request (which contains the key in a header) in its error log line.
- Only the data the user explicitly triggers the feature for leaves the instance: the compact
  training summary and the goals text — no unrelated account data (email, session tokens).
- The model's structured-output response is treated as untrusted text: validated against the
  expected shape (exercise IDs checked against the real dataset via `EXIDX`, numeric fields
  coerced/clamped) before ever reaching `mergeImport`-style state-writing code, matching how
  imported CSV data is already validated before being trusted.

## Testing

Per `CONTRIBUTING.md`: `buildTrainingSummary` is exactly the kind of pure, session-reading logic
that needs a unit test beside it in `frontend/src/lib/ai-suggest.test.js` — covering an empty
history, a history with only some exercises trained, and the 1RM/muscle-balance derivation being
correctly reused rather than reimplemented. Server-side route logic (`api/server.js`) gets tests
in the existing `api/*.test.js` style (`node --test`) covering: key save/delete/status round-trip,
`/api/ai/suggest` rejecting when no key is configured, and the `refusal` stop-reason mapping —
using a mocked HTTPS response rather than a real Anthropic call.

## Out of scope (unchanged from the phase-1 spec)

- Any provider other than Anthropic.
- A RutinaIA-operated/hosted AI proxy using the project's own API key on behalf of all
  self-hosters.
- Automatic/scheduled suggestions (this is a user-triggered, on-demand action only).
- Multi-turn conversation with the model — each suggestion request is a single, stateless call.
