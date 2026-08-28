# RutinaIA: rebrand + Garmin import + AI routine suggestion — phased design

Date: 2026-08-27
Status: Approved

## Context

This repo is a fork of openGym (self-hosted gym/body-weight tracker PWA — see `CLAUDE.md`) being
turned into a standalone project, RutinaIA. The work is split into three independently gated
phases so each can be validated before the next begins. Three review subagents were created in
`.claude/agents/` (`the-architect`, `cyber-neo`, `all-deploy`) and are invoked at the end of every
phase, before that phase is considered done.

An accidental nested clone (`opengym/` duplicating the whole repo, untracked) was found during
initial inventory and deleted before any of this work started.

## Review gate (applies to every phase below)

At the end of each phase, before moving to the next:
1. `the-architect` — confirms the change follows existing structure/patterns and doesn't fork or
   corrupt the client/server data model (`store/useStore.js`, `api/server.js` state files).
2. `cyber-neo` — confirms no credentials/tokens in the clear, and (from phase 2 onward) that
   Garmin- and AI-provider-facing code handles untrusted input/external data safely.
3. `all-deploy` — confirms `npm run build`, `npm test`, and `docker compose build` for `api`/`web`
   still succeed, and that the GitLab CI gate (`.gitlab-ci.yml`, the canonical CI) still matches.

A phase is not done until all three have run clean (or their findings have been addressed).

## Phase 1 — Rebrand: openGym → RutinaIA

**Scope:** visible identity only. Package names (`frontend/package.json`, `api/package.json`,
`mcp/package.json`), `README.md`/`CONTRIBUTING.md`/`CHANGELOG.md` headers, UI text in
`frontend/src/views` and `frontend/src/components`, PWA manifest (`frontend/public`), and the
`website/` marketing site.

**Explicitly out of scope for this phase:** `RP_ID`/`ORIGIN` and any other domain-bound config in
`docs/SELF_HOSTING.md` or `.env.example` — those depend on the real deployment domain, which isn't
decided yet. They stay as openGym placeholders/generic until a domain is chosen; note this
explicitly in the PR/commit so it isn't mistaken for an oversight.

**Data model impact:** none — this phase touches no persisted state shape.

## Phase 2 — Garmin manual import (strength training)

**Scope:** the user exports their strength-training activities from Garmin Connect as CSV and
imports it manually through the existing import flow. Extend
`frontend/src/lib/import-csv.js`'s canonical-field mapping (documented in `docs/DATA_IMPORTS.md`)
with a Garmin column adapter, following the same pattern already used for FitNotes/Strong/Hevy —
do not build a parallel import pipeline. Imported sets land in the same session/history shape
every other import source produces.

**Explicitly out of scope for this phase:** no Garmin API connection, no Garmin account/credential
of any kind, and no import of general activity data (cardio, steps, heart rate, sleep) — that is a
different data model and is deferred to a future phase if wanted.

**Data model impact:** read-only extension to the import path; no changes to persisted state
shape itself, since imported data conforms to the existing history/session format.

## Phase 3 — AI routine suggestion engine

**Scope:** an engine that reads a user's existing training history — via the existing derivations
(`lib/progression.js`, `lib/recovery.js`, `lib/onerm.js`), not a re-derived copy — plus goals the
user states, and proposes/adjusts a weekly plan in the same routine data shape already consumed by
`views/Plan.jsx` / `views/RoutineEdit.jsx`.

**AI provider integration:**
- Bring-your-own-key: the user pastes their own LLM provider API key in Settings. With no key
  configured, the feature is entirely inert — no outbound calls, and the UI entry point doesn't
  appear. This keeps the "no third-party account, no telemetry" default intact, since it's opt-in
  and the key lives only on the user's own instance.
- The key is stored and used **server-side** (`api/`), never sent to or stored in the client
  (not in `localStorage`, not in the Zustand store, not in any `pushState` payload). All calls to
  the AI provider are made from `api/server.js`, following the existing single-file routing
  pattern.
- Requires explicit user opt-in before any training data leaves the instance; only the minimum
  data needed for the suggestion (recent training history relevant to the request, stated goals)
  is sent — no unrelated PII.
- The provider's response is treated as untrusted text: validated/sanitized before being written
  into the routine data model, never `eval`'d or rendered as raw HTML.

**Data model impact:** the engine's output must be shaped as a normal routine — no new parallel
"AI plan" format. If a suggested plan needs a transient/draft state before the user accepts it
into their real routine, that draft lives in existing UI/ephemeral state (`store/useUI.js`
pattern), not in persisted `state-<uid>.json`, until accepted.

## Testing

Per `CONTRIBUTING.md`: anything that decides what the user lifts next, or reads a logged session
back, needs a unit test in `frontend/src/lib` beside the code — this applies to the Garmin column
adapter (phase 2) and to any pure scoring/derivation logic backing the AI suggestion engine
(phase 3), not just to hand-testing via the UI.

## Out of scope (all phases)

- Domain/`RP_ID` changes (phase 1 note above).
- Garmin API/OAuth integration (phase 2 note above).
- General Garmin activity/wellness data import (phase 2 note above).
- A RutinaIA-operated/hosted AI proxy that uses the project's own API key on behalf of all
  self-hosters — out of scope for the self-hosted product; would only apply to a separate hosted
  offering if one is ever built.
