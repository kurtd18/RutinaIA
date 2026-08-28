# Phase 1 — Rebrand (openGym → RutinaIA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all visible "openGym" branding with "RutinaIA" across package metadata, UI copy, the PWA manifest, and the marketing site, without touching domain-bound config (`RP_ID`/`ORIGIN`), CI/CD templates, native mobile app IDs, or historical `CHANGELOG.md` entries.

**Architecture:** Pure find-and-replace of a literal brand string across ~20 files in five groups (package metadata, root docs, PWA shell, frontend UI copy + locales, marketing site), each group its own commit so a reviewer can approve/reject one group without blocking the others. No code logic changes — no new files, no new tests (there is no "behavior" to unit-test in a string rename).

**Tech Stack:** existing repo tooling only — `npm run build`, `npm test` (frontend), grep for verification. No new dependencies.

## Global Constraints

- Do NOT change `RP_ID`/`ORIGIN` or any other domain-bound value in `docs/SELF_HOSTING.md` / `.env.example` — the real RutinaIA domain isn't decided yet (per spec, phase 1 is text/branding only).
- Do NOT touch `CHANGELOG.md` — it's a historical record of real past events (old GitHub/domain incidents); rewriting it would falsify history.
- Do NOT touch CI/CD templates (`.gitlab-ci.yml`, `.github/workflows/*`, `.gitea/workflows/*`, issue templates) or native mobile identifiers (`frontend/android/**`, `frontend/ios/**`, `frontend/capacitor.config.json`) — these are infra/build-id concerns, not visible branding, and changing the Android package ID (`ch.duartesantos.opengym`) breaks existing installs; out of scope for this phase.
- Do NOT rename the internal JS identifier `openGymSheet` in `frontend/src/sheets.jsx:111` — it's a non-visible `history.pushState` state key, not user-facing text.
- Do NOT touch URLs, filenames, or domain strings that reference the real current infra (e.g. `opengym.duarte-santos.ch`, `openGym.apk`, `github.com/DuarteSantos8/openGym`) — only the literal brand word in visible copy changes.
- Every task ends with `git status`/grep verification before commit — no task is "done" on faith.

---

### Task 1: Package metadata (frontend, api, mcp)

**Files:**
- Modify: `frontend/package.json:2`
- Modify: `mcp/package.json:2,6`
- Modify: `mcp/README.md` (any `openGym` mentions — check with grep)

**Interfaces:** None — this task changes JSON string values only, no code.

- [ ] **Step 1: Update `frontend/package.json`**

Change line 2 from:
```json
  "name": "opengym-frontend",
```
to:
```json
  "name": "rutinaia-frontend",
```

- [ ] **Step 2: Update `mcp/package.json`**

Change line 2 from:
```json
  "name": "opengym-mcp",
```
to:
```json
  "name": "rutinaia-mcp",
```

Change line 6's description from:
```json
  "description": "MCP (Model Context Protocol) bridge for openGym — lets an external LLM read your routines, workouts, body-weight log, estimated 1RMs and muscle balance from your self-hosted data. Read-only, stdio transport; no extra container.",
```
to:
```json
  "description": "MCP (Model Context Protocol) bridge for RutinaIA — lets an external LLM read your routines, workouts, body-weight log, estimated 1RMs and muscle balance from your self-hosted data. Read-only, stdio transport; no extra container.",
```

- [ ] **Step 3: Check and update `mcp/README.md`**

Run: `grep -n openGym mcp/README.md`
For each match that is plain prose (not a URL/path), replace `openGym` with `RutinaIA`.

- [ ] **Step 4: Note on `api/package.json`**

Run: `grep -n '"name"' api/package.json` — this already reads `"name": "gym-api"`, no openGym string present. No change needed; confirm and move on.

- [ ] **Step 5: Verify**

Run: `grep -rn "opengym-frontend\|opengym-mcp" frontend/package.json mcp/package.json`
Expected: no matches (both renamed).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json mcp/package.json mcp/README.md
git commit -m "rebrand: rename frontend/mcp package names to RutinaIA"
```

---

### Task 2: PWA manifest and index.html shell

**Files:**
- Modify: `frontend/public/manifest.json:2-3`
- Modify: `frontend/index.html:6,12`

**Interfaces:** None — static config/HTML only.

- [ ] **Step 1: Update `frontend/public/manifest.json`**

Change lines 2-3 from:
```json
  "name": "openGym",
  "short_name": "openGym",
```
to:
```json
  "name": "RutinaIA",
  "short_name": "RutinaIA",
```

Leave `description` ("Personal gym & body weight tracker") as-is — it doesn't name the product.

- [ ] **Step 2: Update `frontend/index.html`**

Change line 6 from:
```html
<title>openGym</title>
```
to:
```html
<title>RutinaIA</title>
```

Change line 12 from:
```html
<meta name="apple-mobile-web-app-title" content="openGym">
```
to:
```html
<meta name="apple-mobile-web-app-title" content="RutinaIA">
```

- [ ] **Step 3: Verify**

Run: `grep -n openGym frontend/public/manifest.json frontend/index.html`
Expected: no matches.

- [ ] **Step 4: Build check**

Run: `cd frontend && npm run build`
Expected: build succeeds (this is a pure static-string change, should not fail — if it does, stop and investigate before continuing).

- [ ] **Step 5: Commit**

```bash
git add frontend/public/manifest.json frontend/index.html
git commit -m "rebrand: PWA manifest and page title to RutinaIA"
```

---

### Task 3: Frontend UI copy (views + components)

**Files:**
- Modify: `frontend/src/views/Settings.jsx:30,46,79,89,95,100,223,231,232,345,405`
- Modify: `frontend/src/views/Login.jsx:59,70,88`
- Modify: `frontend/src/views/Home.jsx:53`
- Modify: `frontend/src/views/MobileOnboarding.jsx:2,28,44,50,55`
- Modify: `frontend/src/sheets.jsx:1` (comment only — leave `openGymSheet` key at line 111 untouched)
- Modify: `frontend/src/components/Modals.jsx:802,822`
- Modify: `frontend/src/components/ErrorBoundary.jsx:18,30`
- Modify: `frontend/src/components/Icon.jsx:1` (comment only)

**Interfaces:** None — JSX string literals and comments only, no prop/function signature changes.

- [ ] **Step 1: `frontend/src/views/Settings.jsx`**

Line 30 — backup filename prefix, from:
```js
    const name = 'opengym-backup-' + todayISO() + '.json'
```
to:
```js
    const name = 'rutinaia-backup-' + todayISO() + '.json'
```

Line 46, from:
```js
        if (!data.workouts || !data.routines) throw new Error('not an openGym backup')
```
to:
```js
        if (!data.workouts || !data.routines) throw new Error('not a RutinaIA backup')
```

Lines 79, 89, 95, 100, 223, 231-232, 345, 405 — every remaining `openGym` occurrence in this file is inside a `t('...')` translated string or the version/source-code footer line. Replace the literal word `openGym` with `RutinaIA` in each; leave the GitLab URL on line 232 (`https://gitlab.com/DuarteSantos8/opengym`) untouched since it's a real infra reference, not copy.

Run to confirm the exact remaining set before editing: `grep -n openGym frontend/src/views/Settings.jsx`

- [ ] **Step 2: `frontend/src/views/Login.jsx`**

Line 59, from:
```jsx
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
```
to:
```jsx
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>RutinaIA</h1>
```

Lines 70 and 88 — replace `openGym` with `RutinaIA` inside the translated strings.

- [ ] **Step 3: `frontend/src/views/Home.jsx`**

Line 53, from:
```jsx
      <div><h1>{user ? t('Hi {0}', user.name) : 'openGym'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
```
Replace the literal fallback `'openGym'` with `'RutinaIA'`.

- [ ] **Step 4: `frontend/src/views/MobileOnboarding.jsx`**

Line 2 (comment), 28, 44, 50, 55 — replace every `openGym` with `RutinaIA`. Line 44 mirrors Login.jsx's heading pattern (`<h1 ...>openGym</h1>` → `<h1 ...>RutinaIA</h1>`).

- [ ] **Step 5: `frontend/src/sheets.jsx`**

Line 1 comment, from:
```js
// openGym control set.
```
to:
```js
// RutinaIA control set.
```

Do **not** change line 111 (`history.pushState({ openGymSheet: true }, '')`) — this is an internal state key, not user-visible text.

- [ ] **Step 6: `frontend/src/components/Modals.jsx`**

Line 802 — plan-share export filename, from:
```js
    const name = 'opengym-plan-' + todayISO() + '.json'
```
to:
```js
    const name = 'rutinaia-plan-' + todayISO() + '.json'
```

Line 822 — replace `openGym` with `RutinaIA` inside the translated string.

Note: `frontend/src/lib/plan-share.js` and `frontend/src/lib/plan-share.test.js` read/write plan-share files and may check for the `opengym-plan-` prefix or an `openGym` marker string used in Modals.jsx — before editing Modals.jsx, run `grep -n "opengym-plan\|openGym" frontend/src/lib/plan-share.js frontend/src/lib/plan-share.test.js` and update any matching prefix/marker there too, in the same commit, so import/export stays consistent.

- [ ] **Step 7: `frontend/src/components/ErrorBoundary.jsx`**

Line 18, from:
```js
  componentDidCatch(err) { console.error('openGym render error:', err) }
```
to:
```js
  componentDidCatch(err) { console.error('RutinaIA render error:', err) }
```

Line 30, replace `openGym` with `RutinaIA` inside the translated button label.

- [ ] **Step 8: `frontend/src/components/Icon.jsx`**

Line 1 comment, from:
```js
// openGym icon set — hand-drawn on a 24×24 grid, stroke-based, single weight.
```
to:
```js
// RutinaIA icon set — hand-drawn on a 24×24 grid, stroke-based, single weight.
```

- [ ] **Step 9: Verify**

Run: `grep -rn openGym frontend/src/views/Settings.jsx frontend/src/views/Login.jsx frontend/src/views/Home.jsx frontend/src/views/MobileOnboarding.jsx frontend/src/sheets.jsx frontend/src/components/Modals.jsx frontend/src/components/ErrorBoundary.jsx frontend/src/components/Icon.jsx`
Expected: no matches, EXCEPT `sheets.jsx:111` (`openGymSheet`), which must still be present unchanged.

- [ ] **Step 10: Run frontend tests**

Run: `cd frontend && npm test`
Expected: all pass. If `plan-share.test.js` fails because it asserted a fixture with `opengym-plan-` or `openGym`, that means Step 6's note was missed — go back and update `plan-share.js`/its test fixtures to match.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/views/Settings.jsx frontend/src/views/Login.jsx frontend/src/views/Home.jsx frontend/src/views/MobileOnboarding.jsx frontend/src/sheets.jsx frontend/src/components/Modals.jsx frontend/src/components/ErrorBoundary.jsx frontend/src/components/Icon.jsx frontend/src/lib/plan-share.js frontend/src/lib/plan-share.test.js
git commit -m "rebrand: frontend UI copy to RutinaIA"
```

---

### Task 4: Locale files (translated UI strings)

**Files:**
- Modify: `frontend/src/locales/zh.js`, `ru.js`, `tr.js`, `pt.js`, `pt-BR.js`, `pl.js`, `it.js`, `ko.js`, `hi.js`, `es.js`, `fr.js`, `de.js` (12 files)

**Interfaces:** None — translated string values only, keys (English source strings) unchanged.

**Context:** Every locale file keeps the brand name untranslated as literal `openGym` inside otherwise-translated sentences (confirmed via grep across zh.js, de.js, ko.js — same pattern in all 12). This is a mechanical token replace, not a translation task: only the substring `openGym` changes to `RutinaIA`, the surrounding translated sentence stays as-is.

- [ ] **Step 1: Count current occurrences per file (baseline)**

Run: `grep -c openGym frontend/src/locales/*.js`
Record the output — every count here must be 0 after Step 2.

- [ ] **Step 2: Bulk replace in all 12 locale files**

Run (Git Bash):
```bash
for f in frontend/src/locales/zh.js frontend/src/locales/ru.js frontend/src/locales/tr.js frontend/src/locales/pt.js frontend/src/locales/pt-BR.js frontend/src/locales/pl.js frontend/src/locales/it.js frontend/src/locales/ko.js frontend/src/locales/hi.js frontend/src/locales/es.js frontend/src/locales/fr.js frontend/src/locales/de.js; do
  sed -i 's/openGym/RutinaIA/g' "$f"
done
```

- [ ] **Step 3: Verify**

Run: `grep -c openGym frontend/src/locales/*.js`
Expected: every file reports `0`.

Run: `grep -c RutinaIA frontend/src/locales/*.js`
Expected: every count matches the baseline recorded in Step 1 for that file (same number of occurrences, just renamed).

- [ ] **Step 4: Run frontend tests**

Run: `cd frontend && npm test`
Expected: all pass (locale files aren't covered by string-content assertions, but this catches any accidental syntax breakage from the sed pass — check `grep -n "RutinaIA'.*'.*RutinaIA" frontend/src/locales/*.js` doesn't show any mangled quote if a test fails to parse).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/locales/zh.js frontend/src/locales/ru.js frontend/src/locales/tr.js frontend/src/locales/pt.js frontend/src/locales/pt-BR.js frontend/src/locales/pl.js frontend/src/locales/it.js frontend/src/locales/ko.js frontend/src/locales/hi.js frontend/src/locales/es.js frontend/src/locales/fr.js frontend/src/locales/de.js
git commit -m "rebrand: locale strings to RutinaIA"
```

---

### Task 5: Root docs (README, CONTRIBUTING, SELF_HOSTING, DATA_IMPORTS, MOBILE, SECURITY, NOTICE)

**Files:**
- Modify: `README.md` (29 occurrences)
- Modify: `CONTRIBUTING.md:1,3` (+ any further matches)
- Modify: `docs/SELF_HOSTING.md`, `docs/DATA_IMPORTS.md`, `docs/MOBILE.md` — **product-name mentions only**
- Modify: `SECURITY.md`, `NOTICE.md` — product-name mentions only

**Interfaces:** None — Markdown prose only.

- [ ] **Step 1: `README.md`**

Line 3, from:
```markdown
<img src="assets/banner.png" alt="openGym" width="720">
```
to:
```markdown
<img src="assets/banner.png" alt="RutinaIA" width="720">
```
(Leave the actual `assets/banner.png` file path as-is — the image asset itself is not part of this phase's scope; only its `alt` text changes.)

For the remaining occurrences, run: `grep -n openGym README.md` and replace each plain-prose `openGym` with `RutinaIA`. Skip any line that is a URL/path pointing at the real current domain or GitLab org (e.g. `gitlab.com/DuarteSantos8/opengym`) — those are infra references, out of scope until a domain/org exists for RutinaIA.

- [ ] **Step 2: `CONTRIBUTING.md`**

Lines 1 and 3, from:
```markdown
# Contributing to openGym

Thanks for taking a look! openGym is intentionally small and dependency-light, and the goal is
```
to:
```markdown
# Contributing to RutinaIA

Thanks for taking a look! RutinaIA is intentionally small and dependency-light, and the goal is
```

Run: `grep -n openGym CONTRIBUTING.md` for any remaining matches and replace prose occurrences the same way.

- [ ] **Step 3: `docs/SELF_HOSTING.md`, `docs/DATA_IMPORTS.md`, `docs/MOBILE.md`**

Run: `grep -n openGym docs/SELF_HOSTING.md docs/DATA_IMPORTS.md docs/MOBILE.md`

For each match, replace the plain-prose product name `openGym` → `RutinaIA`. Do **not** change any `RP_ID`, `ORIGIN`, env var example values, or literal domain/URL strings — per the Global Constraints, domain-bound config stays untouched this phase.

- [ ] **Step 4: `SECURITY.md`, `NOTICE.md`**

Run: `grep -n openGym SECURITY.md NOTICE.md`
Replace plain-prose product-name mentions the same way; leave any legal/license attribution text that names the original project's copyright holder as-is (`NOTICE.md` may need to retain historical attribution — if a line is a copyright/attribution notice rather than a product-name mention, leave it and flag it in the commit message instead of guessing).

- [ ] **Step 5: Verify**

Run: `grep -rln openGym README.md CONTRIBUTING.md docs/SELF_HOSTING.md docs/DATA_IMPORTS.md docs/MOBILE.md SECURITY.md NOTICE.md`
Expected: no file listed, OR only lines that are domain/URL/attribution references (spot-check any remaining hit against the exclusion rules above before deciding it's fine to leave).

- [ ] **Step 6: Commit**

```bash
git add README.md CONTRIBUTING.md docs/SELF_HOSTING.md docs/DATA_IMPORTS.md docs/MOBILE.md SECURITY.md NOTICE.md
git commit -m "rebrand: root docs to RutinaIA"
```

---

### Task 6: Marketing website (website/)

**Files:**
- Modify: `website/index.html:6,7,9,35,77,113,118,124,328,379,397` (copy/title lines only)
- Modify: `website/about.html`, `website/docs.html`, `website/site.js` — copy only

**Interfaces:** None — static HTML/JS content only.

- [ ] **Step 1: `website/index.html` — title/meta/JSON-LD (lines 6, 7, 9, 35)**

Line 6, from:
```html
<title>openGym — free, open-source gym &amp; body-weight tracker</title>
```
to:
```html
<title>RutinaIA — free, open-source gym &amp; body-weight tracker</title>
```

Line 7, from:
```html
<meta name="description" content="openGym is a free, open-source gym & body-weight tracker. Download the Android app or self-host it with Docker — no account, no cloud, no telemetry.">
```
to:
```html
<meta name="description" content="RutinaIA is a free, open-source gym & body-weight tracker. Download the Android app or self-host it with Docker — no account, no cloud, no telemetry.">
```

Line 9, from:
```html
<meta property="og:title" content="openGym — your workouts, your weights, your data">
```
to:
```html
<meta property="og:title" content="RutinaIA — your workouts, your weights, your data">
```

Line 35's JSON-LD `"name":"openGym"` → `"name":"RutinaIA"`. Leave the `downloadUrl` on line 40 (`https://opengym.duarte-santos.ch/openGym.apk`) untouched — real domain/filename, out of scope.

- [ ] **Step 2: `website/index.html` — body copy (lines 77, 113, 118, 124, 328, 379, 397)**

For each of these lines, replace the visible-copy occurrence of `openGym` with `RutinaIA`:
- Line 77: heading text `openGym` → `RutinaIA`
- Line 113: `<p class="eyebrow">openGym</p>` → `<p class="eyebrow">RutinaIA</p>`
- Line 118: `<a class="btn" href="#download">Get openGym</a>` → `<a class="btn" href="#download">Get RutinaIA</a>` (the `href="#download"` is an in-page anchor, not a domain — safe to leave)
- Line 124: `alt="openGym home screen: ..."` → `alt="RutinaIA home screen: ..."`
- Line 328: `<p class="eyebrow">Get openGym</p>` → `<p class="eyebrow">Get RutinaIA</p>`
- Line 379: `<blockquote>openGym started as <b>a tiny app I built for myself.</b> ...` → `<blockquote>RutinaIA started as <b>a tiny app I built for myself.</b> ...`
- Line 397: `<span>openGym in numbers</span>` → `<span>RutinaIA in numbers</span>`

Leave line 346 (`<a class="btn" href="openGym.apk" download>Download for Android</a>`) untouched — it's the actual APK filename served by CI, a build artifact name, not copy; changing it here would break the download link until CI is updated (out of scope for this phase).

Also check lines 99-100 (`My GitHub account was suspended, and the openGym repo went with it.` / `github.com/DuarteSantos8/openGym is offline`) — this is a real historical incident narrative naming the actual GitHub org/repo. Leave it as written (it's recounting real past events, same reasoning as the CHANGELOG.md exclusion), unless the visible product-name word itself appears outside the URL — if so, only that bare word may be swapped, never the `github.com/DuarteSantos8/openGym` path.

- [ ] **Step 3: `website/about.html`, `website/docs.html`, `website/site.js`**

Run: `grep -n openGym website/about.html website/docs.html website/site.js`

Apply the same rule used in Steps 1-2: replace the bare product-name word in visible copy/title/meta/JSON-LD; leave any real URL, filename (`.apk`), or GitHub org path untouched.

- [ ] **Step 4: Verify**

Run: `grep -rn openGym website/index.html website/about.html website/docs.html website/site.js`
Expected: remaining matches are only inside URLs/filenames/GitHub-org paths (spot-check each one against the exclusion rule) — no remaining bare-word product-name mentions in copy.

- [ ] **Step 5: Commit**

```bash
git add website/index.html website/about.html website/docs.html website/site.js
git commit -m "rebrand: marketing site copy to RutinaIA"
```

---

### Task 7: Full-scope verification and phase gate

**Files:** none modified — verification only.

- [ ] **Step 1: Repo-wide sanity grep**

Run: `grep -rln openGym --include='*.md' --include='*.jsx' --include='*.js' --include='*.json' --include='*.html' -- . ':!node_modules' ':!frontend/android' ':!frontend/ios' ':!.gitlab-ci.yml' ':!.github' ':!.gitea' ':!CHANGELOG.md'`

Review every remaining hit against the Global Constraints exclusion list (domain/URL/filename/attribution/internal-key/CI/mobile-ID). Anything that's a genuine missed visible-copy mention, fix and fold into the relevant task's commit (amend only if not yet pushed anywhere shared; otherwise a small follow-up commit).

- [ ] **Step 2: Full frontend build + test**

Run: `cd frontend && npm run build && npm test`
Expected: both succeed.

- [ ] **Step 3: Dispatch the three phase-gate subagents**

Invoke, in order, and address any findings before proceeding to Phase 2:
- `the-architect` — confirm no data-model or structural drift (this phase shouldn't have any, since it's string-only, but Task 3's `plan-share.js` prefix change touches an on-disk file format prefix — that's exactly the kind of thing to double-check).
- `cyber-neo` — confirm no secrets were touched/exposed by the bulk edits.
- `all-deploy` — confirm `npm run build`, `npm test`, and `docker compose build api web` all still succeed, and that `.gitlab-ci.yml`'s Node version/test commands still match.

- [ ] **Step 4: Final commit (if Step 1 required fixes)**

```bash
git add -A
git commit -m "rebrand: fix remaining openGym mentions found in full-scope sweep"
```

If Step 1 found nothing to fix, skip this commit — Phase 1 is done as of Task 6's commit.
