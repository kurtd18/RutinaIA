# Phase 2 — Garmin Manual CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Garmin Connect's activity-summary CSV export as empty placeholder workouts
(date/name/duration, no exercises) that merge through the existing import pipeline with zero UI
changes.

**Architecture:** One new pure function, `parseGarminCSV()`, added beside `parseWorkoutCSV()` and
`parseBodyweight()` in `frontend/src/lib/import-csv.js`, reusing all existing CSV/date/duration
helpers. It returns the exact same `{ kind: 'workouts', ... }` shape `parseWorkoutCSV()` returns
(with zero-valued set/match/exercise fields), so `frontend/src/sheets.jsx`'s existing
`ImportSummary` component and `mergeImport()` need no changes at all. `parseImport()` gets a third
fallback branch tried only after both existing parsers fail to recognise the file.

**Tech Stack:** existing repo tooling only — `cd frontend && npm test`, `vitest`. No new
dependencies.

## Global Constraints

- No Garmin API/OAuth connection, no Garmin credentials handled anywhere — this reads a file the
  user exports and drops into the existing "import from another app" flow, same as FitNotes/
  Strong/Hevy.
- The Garmin CSV column set is **not verified against a real exported file** (per the design spec,
  no sample file was available) — the code comment explaining this and citing the design spec must
  ship with the implementation, matching this file's existing convention of documenting exactly
  what each adapter was verified against.
- `parseGarminCSV()` must return the same field shape as `parseWorkoutCSV()` (`kind`, `source`,
  `workouts`, `customEx`, `matched`, `matchedSets`, `created`, `unmatchedNames`, `sets`, `skipped`,
  `warmups`, `fileUnit`, `mixedUnits`, `converted`, `rpeSets`, `rirSets`, `from`, `to`) — this is
  what lets `sheets.jsx` and `mergeImport()` go untouched. Do not add new fields the UI doesn't
  already know how to render.
- `parseImport()`'s existing dispatch order and error messages for non-Garmin files must not
  change — the new fallback only triggers when both `parseWorkoutCSV()` and `parseBodyweight()`
  have already errored on the same input.
- Multiple Garmin rows sharing the same date must merge into a single workout for that date
  (earliest start, latest end, names joined with `' + '` if they differ) — the rest of the app
  assumes one workout per date (see how `parseWorkoutCSV()`'s `byDate` grouping already enforces
  this, and how `mergeImport()` keys existing days by `w.d`).
- Every task ends with `cd frontend && npm test` passing before commit.

---

### Task 1: `parseGarminCSV()` + header aliases + `detectSource()` extension

**Files:**
- Modify: `frontend/src/lib/import-csv.js` (add to the `COLUMNS` table, add `parseGarminCSV()`
  function, extend `detectSource()`)
- Test: `frontend/src/lib/import-csv.test.js`

**Interfaces:**
- Produces: `parseGarminCSV(text) -> { kind: 'workouts', source: 'Garmin', workouts, customEx: [],
  matched: 0, matchedSets: 0, created: 0, unmatchedNames: [], sets: 0, skipped, warmups: 0,
  fileUnit: '', mixedUnits: false, converted: false, rpeSets: 0, rirSets: 0, from, to } | { error:
  'empty' | 'unrecognised' }`. Each `workouts[]` entry: `{ id: 'iw'+uid(), d, start, end,
  routineId: null, name, entries: [], prs: [], vol: 0 }`.
- Consumes: `parseCSV`, `mapHeader`, `parseWhen`, `toMinutes`, `uid` — all already defined/imported
  in `frontend/src/lib/import-csv.js` (no new imports needed).

- [ ] **Step 1: Read the current `COLUMNS` table and `detectSource()` to confirm line context**

Run: `grep -n "COLUMNS = \[\|workoutName\|'time'\|export function detectSource" frontend/src/lib/import-csv.js`

Confirm the `COLUMNS` array (around line 58) still has this `workoutName` row and this `time` row
before editing — if line numbers drifted, locate by this exact text instead:
```js
  ['workoutName', ['workout name', 'title', 'workout']],
```
```js
  ['time', ['time', 'duration']],
```

- [ ] **Step 2: Extend header aliases in `COLUMNS`**

Change:
```js
  ['workoutName', ['workout name', 'title', 'workout']],
```
to:
```js
  ['workoutName', ['workout name', 'title', 'workout', 'activity name']],
```

Add a new row immediately after it:
```js
  ['activityType', ['activity type', 'type']],
```

Change:
```js
  ['time', ['time', 'duration']],
```
to:
```js
  ['time', ['time', 'duration', 'elapsed time', 'moving time']],
```

- [ ] **Step 3: Extend `detectSource()`**

Find:
```js
export function detectSource(header) {
  const h = header.map(norm)
  if (h.includes('exercise title') && h.includes('set index')) return 'Hevy'
  if (h.includes('exercise name') && h.includes('set order')) return 'Strong'
  if (h.includes('exercise') && h.includes('kind')) return 'FitNotes (iOS)'
  if (h.includes('exercise') && h.includes('weight unit')) return 'FitNotes'
  if (h.includes('exercise') && h.includes('category')) return 'FitNotes'
  return null
}
```
Add one line before `return null`:
```js
export function detectSource(header) {
  const h = header.map(norm)
  if (h.includes('exercise title') && h.includes('set index')) return 'Hevy'
  if (h.includes('exercise name') && h.includes('set order')) return 'Strong'
  if (h.includes('exercise') && h.includes('kind')) return 'FitNotes (iOS)'
  if (h.includes('exercise') && h.includes('weight unit')) return 'FitNotes'
  if (h.includes('exercise') && h.includes('category')) return 'FitNotes'
  if (!h.includes('exercise') && h.includes('date') && (h.includes('title') || h.includes('activity type'))) return 'Garmin'
  return null
}
```

- [ ] **Step 4: Write the failing tests first**

Add to `frontend/src/lib/import-csv.test.js` (match the file's existing `describe`/`test` style —
run `grep -n "^describe\|^test\|from '\./import-csv" frontend/src/lib/import-csv.test.js` first to
match import statements and structure):

```js
describe('parseGarminCSV', () => {
  test('creates empty-entries workouts from a Garmin-shaped activity summary', () => {
    const csv = 'Date,Activity Type,Title,Time,Calories\n' +
      '2026-08-10 06:32:00,Strength Training,Morning Lift,00:45:00,320\n' +
      '2026-08-12 07:00:00,Running,,00:30:00,280\n'
    const parsed = parseGarminCSV(csv)
    expect(parsed.error).toBeUndefined()
    expect(parsed.kind).toBe('workouts')
    expect(parsed.source).toBe('Garmin')
    expect(parsed.workouts).toHaveLength(2)
    expect(parsed.workouts[0].d).toBe('2026-08-10')
    expect(parsed.workouts[0].name).toBe('Morning Lift')
    expect(parsed.workouts[0].entries).toEqual([])
    expect(parsed.workouts[1].name).toBe('Running')
    expect(parsed.sets).toBe(0)
    expect(parsed.matched).toBe(0)
  })

  test('computes end time from duration', () => {
    const csv = 'Date,Title,Time\n2026-08-10 06:00:00,Lift,00:45:00\n'
    const parsed = parseGarminCSV(csv)
    expect(parsed.workouts[0].end - parsed.workouts[0].start).toBe(45 * 60000)
  })

  test('missing duration leaves end equal to start', () => {
    const csv = 'Date,Title\n2026-08-10,Lift\n'
    const parsed = parseGarminCSV(csv)
    expect(parsed.workouts[0].end).toBe(parsed.workouts[0].start)
  })

  test('merges same-date rows into one workout', () => {
    const csv = 'Date,Activity Type,Time\n' +
      '2026-08-10 06:00:00,Strength Training,00:30:00\n' +
      '2026-08-10 18:00:00,Running,00:20:00\n'
    const parsed = parseGarminCSV(csv)
    expect(parsed.workouts).toHaveLength(1)
    expect(parsed.workouts[0].name).toBe('Strength Training + Running')
  })

  test('rejects a file with an exercise column (not a Garmin summary)', () => {
    const csv = 'Date,Exercise,Weight,Reps\n2026-08-10,Squat,100,5\n'
    expect(parseGarminCSV(csv).error).toBe('unrecognised')
  })

  test('rejects a file with no date or title/type column', () => {
    const csv = 'Foo,Bar\n1,2\n'
    expect(parseGarminCSV(csv).error).toBe('unrecognised')
  })

  test('rejects an empty file', () => {
    expect(parseGarminCSV('Date,Title\n').error).toBe('empty')
  })
})

describe('detectSource — Garmin', () => {
  test('recognises a Garmin-shaped header', () => {
    expect(detectSource(['Date', 'Activity Type', 'Title', 'Time'])).toBe('Garmin')
  })
  test('does not misclassify a per-set export as Garmin', () => {
    expect(detectSource(['Date', 'Exercise', 'Weight', 'Reps'])).not.toBe('Garmin')
  })
})
```

If `parseGarminCSV` and `detectSource` aren't already imported at the top of the test file, add
them to the existing `import { ... } from './import-csv.js'` line.

- [ ] **Step 5: Run the tests to confirm they fail**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "parseGarminCSV|detectSource — Garmin"`
Expected: FAIL — `parseGarminCSV is not a function` (it doesn't exist yet).

- [ ] **Step 6: Implement `parseGarminCSV()`**

Add this function to `frontend/src/lib/import-csv.js`, placed after `parseWorkoutCSV()` and before
the `/* ------------------------------------------------------- body weight ------ */` section
comment (i.e. immediately before `parseBodyweight`):

```js
/**
 * Garmin Connect's own CSV export (Activities list -> Export CSV) is an activity-SUMMARY
 * export: one row per session with date/type/title/duration, never a per-exercise set log —
 * per-set weight/reps data isn't available in any structured export Garmin provides. Rather
 * than pretend to reconstruct sets Garmin doesn't expose, each row becomes an empty workout
 * placeholder: the training day is recorded, and the user fills in the numbers themselves.
 *
 * Unlike every adapter above, this one is NOT verified against a real exported file — Garmin
 * doesn't document this CSV's columns and they reportedly vary between accounts. The column
 * names below are corroborated by several independent secondhand reports (Garmin's own
 * community forums, a data-export writeup) but not by an actual export. See
 * docs/superpowers/specs/2026-08-28-phase2-garmin-import-design.md for the sourcing. If you
 * have a real Garmin export, tighten this against it.
 */
export function parseGarminCSV(text) {
  const rows = parseCSV(text)
  if (rows.length < 2) return { error: 'empty' }
  const map = mapHeader(rows[0])
  if (map.exercise !== undefined) return { error: 'unrecognised' }
  if (map.date === undefined || (map.workoutName === undefined && map.activityType === undefined)) {
    return { error: 'unrecognised' }
  }

  const cell = (r, f) => (map[f] === undefined ? '' : String(r[map[f]] ?? '').trim())
  const byDate = new Map()
  let skipped = 0

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const when = parseWhen(cell(r, 'date'))
    if (!when) { skipped++; continue }
    const name = cell(r, 'workoutName') || cell(r, 'activityType') || 'Imported'
    const mins = toMinutes(cell(r, 'time'))
    const base = new Date(when.d + 'T00:00:00').getTime()
    const start = base + (when.t ?? 18 * 3600000)
    const end = mins > 0 ? start + mins * 60000 : start

    const existing = byDate.get(when.d)
    if (!existing) { byDate.set(when.d, { start, end, name }); continue }
    existing.start = Math.min(existing.start, start)
    existing.end = Math.max(existing.end, end)
    if (name && name !== existing.name) existing.name = existing.name + ' + ' + name
  }
  if (!byDate.size) return { error: 'unrecognised' }

  const dates = [...byDate.keys()].sort()
  const workouts = dates.map(d => {
    const day = byDate.get(d)
    return {
      id: 'iw' + uid(), d, start: day.start, end: day.end,
      routineId: null, name: day.name, entries: [], prs: [], vol: 0,
    }
  })

  return {
    kind: 'workouts', source: 'Garmin', workouts, customEx: [],
    matched: 0, matchedSets: 0, created: 0, unmatchedNames: [],
    sets: 0, skipped, warmups: 0, fileUnit: '', mixedUnits: false, converted: false,
    rpeSets: 0, rirSets: 0, from: dates[0] || null, to: dates[dates.length - 1] || null,
  }
}
```

- [ ] **Step 7: Run the tests to confirm they pass**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "parseGarminCSV|detectSource — Garmin"`
Expected: PASS, all cases from Step 4.

- [ ] **Step 8: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all pass (533+ existing tests plus the new ones from this task) — confirms the `COLUMNS`
table edits didn't shift any existing adapter's header matching (e.g. `activity name` as a new
`workoutName` alias must not collide with any existing FitNotes/Strong/Hevy fixture header).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/import-csv.js frontend/src/lib/import-csv.test.js
git commit -m "feat: parse Garmin's activity-summary CSV as placeholder workouts"
```

---

### Task 2: `parseImport()` dispatch integration + regression tests + docs

**Files:**
- Modify: `frontend/src/lib/import-csv.js` (`parseImport()` only)
- Modify: `docs/DATA_IMPORTS.md`
- Test: `frontend/src/lib/import-csv.test.js`

**Interfaces:**
- Consumes: `parseGarminCSV` from Task 1 (same file, no import needed), existing `parseWorkoutCSV`,
  `parseBodyweight`.
- Produces: `parseImport(text, opts)` now additionally routes Garmin-shaped files to
  `parseGarminCSV` — same signature and return shape as before, no caller changes needed
  (`frontend/src/sheets.jsx` already calls `parseImport(String(rd.result), { unit: S().unit })`
  and branches only on `.kind`/`.error`, both unchanged).

- [ ] **Step 1: Write the failing regression + integration tests first**

Add to `frontend/src/lib/import-csv.test.js`:

```js
describe('parseImport — Garmin fallback', () => {
  test('routes a Garmin-shaped file through parseGarminCSV', () => {
    const csv = 'Date,Activity Type,Title,Time\n2026-08-10 06:00:00,Strength Training,Morning Lift,00:45:00\n'
    const parsed = parseImport(csv, { unit: 'kg' })
    expect(parsed.source).toBe('Garmin')
    expect(parsed.kind).toBe('workouts')
    expect(parsed.workouts[0].entries).toEqual([])
  })

  test('a per-set export still wins over the Garmin fallback', () => {
    const csv = 'workout name,exercise,date,weight kg,reps\nLeg Day,Squat,2026-08-21,120,5\n'
    const parsed = parseImport(csv, { unit: 'kg' })
    expect(parsed.source).not.toBe('Garmin')
    expect(parsed.workouts[0].entries[0].sets[0].w).toBe(120)
  })

  test('a bodyweight export still wins over the Garmin fallback', () => {
    const csv = 'date,weight kg\n2026-08-21,82.5\n'
    const parsed = parseImport(csv, { unit: 'kg' })
    expect(parsed.kind).toBe('bodyweight')
  })

  test('a genuinely unrecognisable file still reports the original error', () => {
    const csv = 'Foo,Bar\n1,2\n'
    const parsed = parseImport(csv, { unit: 'kg' })
    expect(parsed.error).toBe('unrecognised')
  })
})

describe('mergeImport — Garmin placeholder workouts', () => {
  test('re-importing the same Garmin file twice adds nothing the second time', () => {
    const csv = 'Date,Title\n2026-08-10,Morning Lift\n'
    const parsed = parseGarminCSV(csv)
    const S = { workouts: [], customEx: [], exWeights: {} }
    const first = mergeImport(S, parsed)
    expect(first.added).toBe(1)
    const second = mergeImport(S, parseGarminCSV(csv))
    expect(second.added).toBe(0)
    expect(S.workouts).toHaveLength(1)
  })
})
```

If `parseImport`/`mergeImport` aren't already imported in the test file, add them to the existing
import line.

- [ ] **Step 2: Run the tests to confirm they fail on the routing tests**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "parseImport — Garmin fallback"`
Expected: the first test FAILs (`parsed.source` is not `'Garmin'` yet — `parseImport` doesn't call
`parseGarminCSV` yet). The other three tests in that block should already pass unchanged (they
exercise existing behavior) — confirm that, since it's the regression guard this task exists for.

- [ ] **Step 3: Implement the `parseImport()` change**

Find:
```js
/** Sniff the file and parse it as whatever it is. */
export function parseImport(text, opts) {
  const s = String(text)
  if (s.includes('HKQuantityTypeIdentifier') || /^\s*</.test(s)) return parseBodyweight(s, opts)
  const asWorkouts = parseWorkoutCSV(s, opts)
  if (!asWorkouts.error) return asWorkouts
  const asWeights = parseBodyweight(s, opts)
  return asWeights.error ? asWorkouts : asWeights
}
```
Replace with:
```js
/** Sniff the file and parse it as whatever it is. */
export function parseImport(text, opts) {
  const s = String(text)
  if (s.includes('HKQuantityTypeIdentifier') || /^\s*</.test(s)) return parseBodyweight(s, opts)
  const asWorkouts = parseWorkoutCSV(s, opts)
  if (!asWorkouts.error) return asWorkouts
  const asWeights = parseBodyweight(s, opts)
  if (!asWeights.error) return asWeights
  const asGarmin = parseGarminCSV(s)
  return asGarmin.error ? asWorkouts : asGarmin
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "parseImport — Garmin fallback|mergeImport — Garmin placeholder workouts"`
Expected: PASS, all cases.

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all pass — this is the regression check that every existing fixture (FitNotes, FitNotes
iOS, Strong, Hevy, Apple Health, generic spreadsheet) still resolves to its original `kind`/
`source` and never falls through to the new Garmin branch.

- [ ] **Step 6: Update `docs/DATA_IMPORTS.md`**

In the apps table, change:
```markdown
| App | How to export | 
|---|---|
| **FitNotes (Android)** | Settings → Backup/Export → **Spreadsheet Export** | 
| **FitNotes 2 (iOS)** | Export workouts as CSV; also manual/auto iCloud backups |
| **Strong** | Settings → Export Data | 
| **Hevy** | Profile → Settings → Export & Import Data (Workouts or Measurements) | 
```
to:
```markdown
| App | How to export | 
|---|---|
| **FitNotes (Android)** | Settings → Backup/Export → **Spreadsheet Export** | 
| **FitNotes 2 (iOS)** | Export workouts as CSV; also manual/auto iCloud backups |
| **Strong** | Settings → Export Data | 
| **Hevy** | Profile → Settings → Export & Import Data (Workouts or Measurements) | 
| **Garmin Connect** | Activities list → **Export CSV** (see note below) |
```

Immediately after the table (before the `You can also create your own` line), add:
```markdown
> Note: Garmin's export is a session summary (date, activity type, duration) — it does not
> contain per-exercise sets, reps or weight, because Garmin doesn't expose that data in any
> exportable format. Importing a Garmin file creates one empty training-day entry per session so
> your calendar/streak history is complete; you still fill in weights and reps for that day
> yourself, same as logging a workout normally.
```

In the canonical-field table, update these two rows:
```markdown
| `workoutName` | `workout name`, `title` |
```
to:
```markdown
| `workoutName` | `workout name`, `title`, `activity name` |
```
and:
```markdown
| `time` | `time`, `duration` |
```
to:
```markdown
| `time` | `time`, `duration`, `elapsed time`, `moving time` |
```

Add a new row after `category`:
```markdown
| `activityType` | `activity type`, `type` |
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/import-csv.js frontend/src/lib/import-csv.test.js docs/DATA_IMPORTS.md
git commit -m "feat: route Garmin CSVs through the new parser, document the import"
```

---

### Task 3: Full-scope verification and phase gate

**Files:** none modified — verification only.

- [ ] **Step 1: Full frontend build + test**

Run: `cd frontend && npm run build && npm test`
Expected: both succeed.

- [ ] **Step 2: Manual sanity check of the import UI**

Run the dev server (`cd frontend && npm run dev`), sign in as a guest/demo profile, and use
Settings' import flow with a small hand-made Garmin-shaped CSV (e.g. the fixture from Task 1 Step
4) to confirm the `ImportSummary` sheet renders sensibly (0 sets/matched/created tiles, correct
workout count and date range, "Import" button enabled) and that after import the workout appears
on its date with no exercises. This is the one thing the automated tests can't cover — a real
click-through of the sheet UI.

- [ ] **Step 3: Dispatch the three phase-gate subagents**

Invoke, in order, and address any findings before proceeding to Phase 3:
- `the-architect` — confirm `parseGarminCSV()`'s output shape genuinely matches what
  `mergeImport()` and `sheets.jsx` expect (no silent shape mismatch), and that no parallel
  import/data model was introduced.
- `cyber-neo` — confirm the CSV parsing stays within the existing untrusted-input handling
  patterns (bounded, no unsafe `eval`/injection risk from row content ending up in `name`, which
  is rendered as workout title text — check it goes through the same rendering path as every other
  imported workout name, no new `dangerouslySetInnerHTML` or similar).
- `all-deploy` — confirm `npm run build`, `npm test`, and `docker compose build api web` all still
  succeed.

- [ ] **Step 4: Final commit (if Step 2 or Step 3 required fixes)**

```bash
git add -A
git commit -m "fix: address Phase 2 gate findings"
```

If nothing needed fixing, skip this commit — Phase 2 is done as of Task 2's commit.
