# Phase 6 — Multi-Brand Manual Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user with any TCX-exporting device (Garmin, Fitbit, Polar, Coros, Suunto-via-interop)
or Samsung Health can import their workout history through the existing `parseImport()` flow, and
a same-day import from a second source no longer gets silently discarded by an over-eager dedup
rule.

**Architecture:** All changes live in `frontend/src/lib/import-csv.js` (a new `parseTCX()` parser
following `parseGarminCSV`'s exact conventions, a `detectSource()` branch, a `COLUMNS` extension
for Samsung Health's header names, a dispatch-order fix in `parseImport()`, and a dedup-key fix in
`mergeImport()`) plus paired tests in `frontend/src/lib/import-csv.test.js`. No new files, no UI
changes — `parseImport()`'s "sniff and parse" contract with its callers is unchanged.

**Tech Stack:** existing repo tooling only — `cd frontend && npm test` (`vitest run`). No new
dependencies.

## Global Constraints

- No new dependency added to `frontend/package.json` — TCX parsing uses the same regex-based
  approach `parseGarminCSV`/`parseBodyweight` already use for their own XML/CSV parsing (no XML
  parser library).
- `parseTCX`'s output shape must be identical to `parseGarminCSV`'s (`{ kind: 'workouts', source,
  workouts, customEx: [], matched: 0, matchedSets: 0, created: 0, unmatchedNames: [], sets: 0,
  skipped, warmups: 0, fileUnit: '', mixedUnits: false, converted: false, rpeSets: 0, rirSets: 0,
  from, to }`), each workout `{ id: 'iw' + uid(), d, start, end, routineId: null, name, entries: [],
  prs: [], vol: 0 }` — this is what `mergeImport()` and the import-summary UI already expect from
  every placeholder-workout parser.
- `parseTCX` is explicitly NOT verified against a real exported TCX file — same documented caveat
  `parseGarminCSV` already carries. Say so in the function's doc comment.
- The dedup-granularity fix in `mergeImport()` applies ONLY to `S.workouts` (manual CSV/TCX import
  path). `S.bodyweight`'s dedup stays date-only. The Strava poll loop (Phase 5) is untouched — it
  never calls `mergeImport()` and its own no-merge behavior is unaffected by this phase.
- Nothing here throws on a malformed row/activity — bad input is counted and skipped, matching
  every existing parser's tolerance (`parseWorkoutCSV`'s own doc comment: "a history of several
  thousand sets will contain oddities, and losing the file over one of them helps nobody").
- Every task ends with `cd frontend && npm test` passing before commit.

---

### Task 1: `parseTCX()` — generic TCX parser + `detectSource` branch

**Files:**
- Modify: `frontend/src/lib/import-csv.js` (add `parseTCX()`, extend `detectSource()`)
- Test: `frontend/src/lib/import-csv.test.js` (extend existing file)

**Interfaces:**
- Produces: `parseTCX(text) -> { kind: 'workouts', source: 'TCX', workouts, ... }` (exact shape in
  Global Constraints above) or `{ error: 'empty' | 'unrecognised' }`. `detectSource(header)` gains
  no new parameter shape — TCX detection happens in `parseImport`/`parseTCX` directly since TCX
  isn't a CSV header, but `detectSource` itself is unaffected structurally (see Task 2 for how the
  'TCX' source label actually surfaces to the summary UI, since `detectSource` is CSV-header-only
  by design — read Step 1 below before assuming `detectSource` needs a TCX branch at all).
- Consumes: `parseCSV`, `parseWhen`, `uid` — already imported/defined in `import-csv.js`. No new
  imports needed (no XML-parsing library).

- [ ] **Step 1: Read `detectSource()` and confirm whether it needs a TCX branch**

Run: `grep -n "export function detectSource" -A 10 frontend/src/lib/import-csv.js`

`detectSource(header)` takes a CSV header array (`string[]`) — it is called by the frontend's
import-summary UI on a CSV's first row to display a friendly source name. TCX is XML, not CSV, so
it never reaches `detectSource` through the normal CSV path. Confirm this by checking where
`detectSource` is called from: `grep -rn "detectSource(" frontend/src/` (outside its own test/
definition file). If it's only ever called on a CSV header, `detectSource` needs NO new branch —
the 'TCX' source label comes entirely from `parseTCX`'s own `source: 'TCX'` field in its return
value, exactly how `parseGarminCSV` sets `source: 'Garmin'` without any `detectSource` involvement.
Do not add a `detectSource` branch that can never be reached with XML input — if Step 1 confirms
`detectSource` is CSV-only, skip any change to it entirely.

- [ ] **Step 2: Write the failing tests**

Add to `frontend/src/lib/import-csv.test.js` (add the import at the top: change the first line's
import list to include `parseTCX`):

```js
import { parseWorkoutCSV, parseGarminCSV, parseTCX, detectSource, parseImport, mergeImport } from './import-csv.js'
```

Then add:

```js
describe('parseTCX', () => {
  const tcx = (activities) => `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    ${activities}
  </Activities>
</TrainingCenterDatabase>`

  it('parses a single activity into one placeholder workout', () => {
    const xml = tcx(`
      <Activity Sport="Other">
        <Id>2026-08-30T18:00:00Z</Id>
        <Lap StartTime="2026-08-30T18:00:00Z">
          <TotalTimeSeconds>3600</TotalTimeSeconds>
        </Lap>
      </Activity>
    `)
    const parsed = parseTCX(xml)
    expect(parsed.kind).toBe('workouts')
    expect(parsed.source).toBe('TCX')
    expect(parsed.workouts).toHaveLength(1)
    const w = parsed.workouts[0]
    expect(w.d).toBe('2026-08-30')
    expect(w.name).toBe('Other')
    expect(w.entries).toEqual([])
    expect(w.end - w.start).toBe(3600000)
  })

  it('merges multiple activities on the same date into one workout, summing lap time', () => {
    const xml = tcx(`
      <Activity Sport="Strength Training">
        <Id>2026-08-30T08:00:00Z</Id>
        <Lap StartTime="2026-08-30T08:00:00Z"><TotalTimeSeconds>1800</TotalTimeSeconds></Lap>
      </Activity>
      <Activity Sport="Running">
        <Id>2026-08-30T18:00:00Z</Id>
        <Lap StartTime="2026-08-30T18:00:00Z"><TotalTimeSeconds>1200</TotalTimeSeconds></Lap>
      </Activity>
    `)
    const parsed = parseTCX(xml)
    expect(parsed.workouts).toHaveLength(1)
    const w = parsed.workouts[0]
    expect(w.name).toBe('Strength Training + Running')
    expect(w.start).toBeLessThan(w.end)
  })

  it('sums multiple laps within one activity', () => {
    const xml = tcx(`
      <Activity Sport="Other">
        <Id>2026-08-30T08:00:00Z</Id>
        <Lap StartTime="2026-08-30T08:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds></Lap>
        <Lap StartTime="2026-08-30T08:10:00Z"><TotalTimeSeconds>900</TotalTimeSeconds></Lap>
      </Activity>
    `)
    const parsed = parseTCX(xml)
    expect(parsed.workouts[0].end - parsed.workouts[0].start).toBe(1500000)
  })

  it('skips an activity with no parseable Id and counts it', () => {
    const xml = tcx(`
      <Activity Sport="Other">
        <Lap StartTime="2026-08-30T08:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds></Lap>
      </Activity>
    `)
    const parsed = parseTCX(xml)
    expect(parsed.error).toBe('unrecognised')
  })

  it('returns an error for a file with no TrainingCenterDatabase marker', () => {
    expect(parseTCX('<Foo></Foo>').error).toBeTruthy()
  })

  it('returns an empty-file error for an empty string', () => {
    expect(parseTCX('').error).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "parseTCX"`
Expected: FAIL — `parseTCX` is not exported yet.

- [ ] **Step 4: Implement `parseTCX()`**

Add to `frontend/src/lib/import-csv.js`, immediately after `parseGarminCSV`'s closing `}` (find
with `grep -n "^export function parseGarminCSV" -A 50 frontend/src/lib/import-csv.js` to locate the
exact insertion point):

```js
/**
 * TCX (Training Center Database XML) — the one activity-export format with genuine cross-vendor
 * support: Garmin, Fitbit, Polar, and Coros all export it directly, and Suunto activities
 * interoperate through the same ecosystem. Like Garmin's CSV and Apple Health's export, TCX
 * carries no structured set/rep/weight data for strength training, so this produces the same
 * kind of placeholder workout `parseGarminCSV` does — date/name/duration, empty `entries`.
 *
 * NOT verified against a real exported file — built from the public TCX schema structure. If you
 * have a real TCX export, tighten this against it.
 */
export function parseTCX(text) {
  const s = String(text || '')
  if (!s.trim()) return { error: 'empty' }
  if (!s.includes('<TrainingCenterDatabase')) return { error: 'unrecognised' }

  const activityRe = /<Activity\b[^>]*Sport="([^"]*)"[^>]*>([\s\S]*?)<\/Activity>/g
  const byDate = new Map()
  let skipped = 0
  let match

  while ((match = activityRe.exec(s))) {
    const sport = match[1] || 'Other'
    const body = match[2]
    const idMatch = /<Id>([^<]+)<\/Id>/.exec(body)
    if (!idMatch) { skipped++; continue }
    const when = parseWhen(idMatch[1])
    if (!when) { skipped++; continue }

    const lapSecondsRe = /<TotalTimeSeconds>([\d.]+)<\/TotalTimeSeconds>/g
    let totalSeconds = 0
    let lapMatch
    while ((lapMatch = lapSecondsRe.exec(body))) totalSeconds += parseFloat(lapMatch[1]) || 0

    const base = new Date(when.d + 'T00:00:00').getTime()
    const start = base + (when.t ?? 18 * 3600000)
    const end = totalSeconds > 0 ? start + totalSeconds * 1000 : start

    const existing = byDate.get(when.d)
    if (!existing) { byDate.set(when.d, { start, end, name: sport }); continue }
    existing.start = Math.min(existing.start, start)
    existing.end = Math.max(existing.end, end)
    if (sport && sport !== existing.name) existing.name = existing.name + ' + ' + sport
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
    kind: 'workouts', source: 'TCX', workouts, customEx: [],
    matched: 0, matchedSets: 0, created: 0, unmatchedNames: [],
    sets: 0, skipped, warmups: 0, fileUnit: '', mixedUnits: false, converted: false,
    rpeSets: 0, rirSets: 0, from: dates[0] || null, to: dates[dates.length - 1] || null,
  }
}
```

Note the multi-activity-same-day merge logic (min start, max end, names joined with `+`) is
deliberately identical in shape to `parseGarminCSV`'s same-date merge — this is the "same-file
merge" behavior the design spec says this phase does NOT change, only the cross-import dedup rule
(Task 4) is new.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "parseTCX"`
Expected: PASS, all 6 cases.

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/import-csv.js frontend/src/lib/import-csv.test.js
git commit -m "feat: add parseTCX for cross-vendor TCX activity imports"
```

---

### Task 2: `parseImport()` dispatch-order fix

**Files:**
- Modify: `frontend/src/lib/import-csv.js` (rewrite `parseImport`'s XML-branch ordering)
- Test: `frontend/src/lib/import-csv.test.js` (extend existing file)

**Interfaces:**
- Consumes: `parseTCX` from Task 1, `parseBodyweight`, `parseWorkoutCSV`, `parseGarminCSV` — all
  already present.
- Produces: nothing new for later tasks — `parseImport`'s external contract (one text string in,
  one parsed-or-error result out) is unchanged; only its internal dispatch order changes.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/lib/import-csv.test.js`:

```js
describe('parseImport — TCX and XML dispatch', () => {
  const tcxFile = `<?xml version="1.0"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Other">
      <Id>2026-08-30T18:00:00Z</Id>
      <Lap StartTime="2026-08-30T18:00:00Z"><TotalTimeSeconds>1800</TotalTimeSeconds></Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`

  it('routes a TCX file to parseTCX, not the Apple Health branch', () => {
    const parsed = parseImport(tcxFile)
    expect(parsed.source).toBe('TCX')
    expect(parsed.error).toBeUndefined()
  })

  it('still routes an Apple Health export correctly (no regression)', () => {
    const appleHealthXml = `<HealthData>
      <Record type="HKQuantityTypeIdentifierBodyMass" value="70" unit="kg" startDate="2026-08-30 08:00:00 -0500" />
    </HealthData>`
    const parsed = parseImport(appleHealthXml)
    expect(parsed.kind).toBe('bodyweight')
    expect(parsed.source).toBe('Apple Health')
  })

  it('falls through to CSV/Garmin attempts for an XML file that is neither Apple Health nor TCX', () => {
    // A well-formed but unrelated XML document — should not error out immediately just because
    // it starts with '<'; parseImport should still attempt the CSV-shaped fallbacks (which will
    // also fail here since this isn't CSV either, but the point is it doesn't short-circuit).
    const unrelatedXml = '<Foo><Bar/></Foo>'
    const parsed = parseImport(unrelatedXml)
    expect(parsed.error).toBeTruthy() // still an error — this input is genuinely unrecognisable —
    // but reaching this error via the CSV/Garmin fallback path (not an immediate return from the
    // Apple Health branch) is what this test guards; see Step 4's implementation for why this
    // matters structurally even though the observable error outcome is the same.
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "parseImport — TCX and XML dispatch"`
Expected: the first test FAILS (TCX file currently gets swallowed by the old `/^\s*</` branch and
returns `parseBodyweight`'s error result instead of `parseTCX`'s success). The second test should
already PASS (no regression yet, since Apple Health routing is unchanged). The third test's
assertion is weak by design (see Step 1's comment) so it may pass even before the fix — that's
fine, its job is to guard the fix in Step 5, not to fail here.

- [ ] **Step 3: Confirm the current `parseImport` implementation**

Run: `grep -n "^export function parseImport" -A 10 frontend/src/lib/import-csv.js`

Confirm it still matches the "Current code" block shown in the design spec's "`parseImport()`
dispatch fix" section.

- [ ] **Step 4: Replace `parseImport`'s body**

Replace the entire function with:

```js
export function parseImport(text, opts) {
  const s = String(text)
  if (s.includes('HKQuantityTypeIdentifier')) return parseBodyweight(s, opts)
  if (s.includes('<TrainingCenterDatabase')) return parseTCX(s)
  if (/^\s*</.test(s)) {
    const asWeights = parseBodyweight(s, opts)
    if (!asWeights.error) return asWeights
    // fall through — an XML file that's neither Apple Health nor TCX still gets a shot at the
    // CSV/Garmin paths below rather than failing immediately, matching this function's existing
    // "try every format before giving up" posture.
  }
  const asWorkouts = parseWorkoutCSV(s, opts)
  if (!asWorkouts.error) return asWorkouts
  const asWeights = parseBodyweight(s, opts)
  if (!asWeights.error) return asWeights
  const asGarmin = parseGarminCSV(s)
  return asGarmin.error ? asWorkouts : asGarmin
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "parseImport"`
Expected: all `parseImport`-related tests pass, including the 3 new ones and every pre-existing
`parseImport` test (e.g. the Garmin-fallback describe block from Phase 2).

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/import-csv.js frontend/src/lib/import-csv.test.js
git commit -m "fix: route TCX files past the Apple Health XML branch in parseImport"
```

---

### Task 3: Samsung Health CSV column names

**Files:**
- Modify: `frontend/src/lib/import-csv.js` (extend `COLUMNS`)
- Test: `frontend/src/lib/import-csv.test.js` (extend existing file)

**Interfaces:**
- Consumes: the existing `COLUMNS` array and `mapHeader()`/`norm()` — no signature changes.
- Produces: nothing new for later tasks — this widens which header strings `mapHeader()` already
  recognizes; every downstream parser (`parseWorkoutCSV`, `parseGarminCSV`) is unaffected in
  structure.

- [ ] **Step 1: Read the current `COLUMNS` table**

Run: `grep -n "^const COLUMNS" -A 25 frontend/src/lib/import-csv.js`

Confirm the exact current field list (`exercise`, `date`, `startTime`, `endTime`, `workoutName`,
`activityType`, `category`, `weightKg`, `weightLb`, `weight`, `weightUnit`, `reps`, `rpe`, `rir`,
`distanceKm`, `distance`, `distanceUnit`, `seconds`, `time`, `setType`, `note`) and the `norm()`
helper's exact normalization (find it: `grep -n "^function norm" -A 5
frontend/src/lib/import-csv.js`) so the new aliases you add match its output format exactly
(lowercased, whitespace-collapsed — confirm the exact rule before adding aliases with the wrong
casing/spacing convention).

- [ ] **Step 2: Write the failing test**

Add to `frontend/src/lib/import-csv.test.js`:

```js
describe('mapHeader — Samsung Health column names', () => {
  it('recognises Samsung Health-style activity-summary headers as a Garmin-shaped import', () => {
    const csv = [
      'start_time,exercise_type,duration',
      '2026-08-30 18:00:00,Weight Training,3600',
    ].join('\n')
    const parsed = parseImport(csv)
    expect(parsed.error).toBeUndefined()
    expect(parsed.workouts).toHaveLength(1)
    expect(parsed.workouts[0].name).toBe('Weight Training')
  })
})
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "Samsung Health"`
Expected: FAIL — `start_time`/`exercise_type`/`duration` aren't in `COLUMNS` yet, so `mapHeader`
won't populate `date`/`activityType`/`time`, and `parseGarminCSV`'s required-field check
(`map.date === undefined || (map.workoutName === undefined && map.activityType === undefined)`)
returns `{error: 'unrecognised'}`.

- [ ] **Step 4: Extend `COLUMNS`**

Add Samsung Health's documented header variants to the existing entries (do not create new field
names — map onto the existing `date`/`activityType`/`time`/`workoutName` fields so the existing
`parseGarminCSV`-style path picks them up with zero new parser code):

```js
  ['date', ['date', 'workout date', 'start_time', 'start time']],
  ['activityType', ['activity type', 'type', 'exercise_type', 'exercise type']],
  ['time', ['time', 'duration', 'elapsed time', 'moving time', 'duration_seconds']],
```

(These are edits to three existing `COLUMNS` rows, adding new alias strings to each — not new
rows. Locate each exact current row via Step 1's grep output and add the new alias strings to its
existing array, being careful not to introduce a naming collision: `date` already has `start
time`-style variants for CSVs like Strong's `start time`/`start date` mapping to `startTime`, not
`date` — confirm `startTime` and `date` don't end up claiming the same alias string, since
`mapHeader`'s `map[field] === undefined` first-match-wins logic means whichever field is checked
first in the `COLUMNS` array order claims an ambiguous alias. Re-verify against Step 1's exact
current `COLUMNS` order before finalizing which field each new alias belongs to.)

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "Samsung Health"`
Expected: PASS.

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all pass — this step matters more than usual for this task, since widening `COLUMNS`
aliases risks colliding with an existing format's column names (e.g. if `duration_seconds` happened
to collide with something Hevy/Strong/FitNotes already relies on). If any pre-existing test breaks,
narrow the new alias (e.g. drop an overly generic one) rather than special-casing around it.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/import-csv.js frontend/src/lib/import-csv.test.js
git commit -m "feat: recognize Samsung Health CSV column names in mapHeader"
```

---

### Task 4: `mergeImport()` dedup granularity fix

**Files:**
- Modify: `frontend/src/lib/import-csv.js` (add `isDuplicateWorkout`, `DEDUP_TOLERANCE_MS`, rewrite
  `mergeImport`'s workout-dedup branch)
- Test: `frontend/src/lib/import-csv.test.js` (extend existing file)

**Interfaces:**
- Produces: `isDuplicateWorkout(existing, incoming) -> boolean` (internal helper, may or may not be
  exported — export it only if the test needs to reach it directly; prefer testing it indirectly
  through `mergeImport` to match this file's existing test-through-the-public-function style, check
  Step 1 for how existing `mergeImport` tests are structured before deciding).
- Consumes: nothing new — operates on the same `S`/`parsed` shapes `mergeImport` already receives.

- [ ] **Step 1: Read the existing `mergeImport` tests to match their style**

Run: `grep -n "describe('mergeImport" -A 30 frontend/src/lib/import-csv.test.js`

Confirm how the existing "Garmin placeholder workouts" describe block builds its `S` fixture and
asserts `added`/`skipped` counts — match this exact style for the new tests below.

- [ ] **Step 2: Write the failing tests**

Add to `frontend/src/lib/import-csv.test.js`:

```js
describe('mergeImport — dedup granularity', () => {
  const makeWorkout = (d, start, name = 'Test') => ({
    id: 'w' + start, d, start, end: start + 3600000, routineId: null, name, entries: [], prs: [], vol: 0,
  })

  it('still treats re-importing the exact same file as a duplicate (idempotent)', () => {
    const S = { workouts: [makeWorkout('2026-08-30', 1756573200000)], bodyweight: [], customEx: [], exWeights: {} }
    const parsed = { kind: 'workouts', workouts: [makeWorkout('2026-08-30', 1756573200000)], customEx: [] }
    const result = mergeImport(S, parsed)
    expect(result.added).toBe(0)
    expect(result.skipped).toBe(1)
    expect(S.workouts).toHaveLength(1)
  })

  it('adds a same-date workout from a second source when start times differ beyond the tolerance', () => {
    const S = { workouts: [makeWorkout('2026-08-30', 1756573200000, 'Morning run')], bodyweight: [], customEx: [], exWeights: {} }
    // 8 hours later on the same date — well outside DEDUP_TOLERANCE_MS
    const parsed = { kind: 'workouts', workouts: [makeWorkout('2026-08-30', 1756573200000 + 8 * 3600000, 'Evening lift')], customEx: [] }
    const result = mergeImport(S, parsed)
    expect(result.added).toBe(1)
    expect(S.workouts).toHaveLength(2)
  })

  it('still treats two start times within the tolerance window as the same workout', () => {
    const S = { workouts: [makeWorkout('2026-08-30', 1756573200000)], bodyweight: [], customEx: [], exWeights: {} }
    // 2 minutes later — within the 5-minute DEDUP_TOLERANCE_MS
    const parsed = { kind: 'workouts', workouts: [makeWorkout('2026-08-30', 1756573200000 + 2 * 60000)], customEx: [] }
    const result = mergeImport(S, parsed)
    expect(result.added).toBe(0)
    expect(S.workouts).toHaveLength(1)
  })

  it('does not change bodyweight dedup (stays date-only)', () => {
    const S = { workouts: [], bodyweight: [{ d: '2026-08-30', w: 70, t: 1756573200000 }], customEx: [], exWeights: {} }
    const parsed = { kind: 'bodyweight', bodyweight: [{ d: '2026-08-30', w: 71, t: 1756573200000 + 8 * 3600000 }] }
    const result = mergeImport(S, parsed)
    expect(result.added).toBe(0) // same date still wins, regardless of time — unchanged behavior
    expect(S.bodyweight).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run the tests to confirm the second one fails**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "mergeImport — dedup granularity"`
Expected: the first, third, and fourth tests PASS already (current date-only dedup happens to
produce the same observable result for those cases). The second test FAILS — the current
`S.workouts.map(w => w.d)` key means "any workout that date" blocks the second, genuinely different
import.

- [ ] **Step 4: Implement the fix**

Find the current `mergeImport` function (`grep -n "^export function mergeImport" -A 20
frontend/src/lib/import-csv.js`) and replace it with:

```js
// Two workouts are "the same import" if they're on the same date and their start times are
// within DEDUP_TOLERANCE_MS of each other — not just "any workout exists that day". This lets a
// second source's genuinely different same-day workout coexist, while re-importing the same file
// twice still recognizes its own rows as duplicates (different export formats can round start
// times to the minute vs. the second, hence a tolerance rather than an exact match).
const DEDUP_TOLERANCE_MS = 5 * 60000 // 5 minutes

function isDuplicateWorkout(existing, incoming) {
  return existing.some(w => w.d === incoming.d && Math.abs((w.start || 0) - (incoming.start || 0)) <= DEDUP_TOLERANCE_MS)
}

/** Merge into state. Existing days win — importing twice never duplicates a workout. */
export function mergeImport(S, parsed) {
  if (parsed.kind === 'bodyweight') {
    const have = new Set(S.bodyweight.map(b => b.d))
    const fresh = parsed.bodyweight.filter(b => !have.has(b.d))
    S.bodyweight = [...S.bodyweight, ...fresh].sort((a, b) => (a.d < b.d ? -1 : 1))
    return { added: fresh.length, skipped: parsed.bodyweight.length - fresh.length }
  }
  const fresh = parsed.workouts.filter(w => !isDuplicateWorkout(S.workouts, w))
  const used = new Set(fresh.flatMap(w => w.entries.map(e => e.id)))
  const customs = parsed.customEx.filter(c => used.has(c.id) && !EXIDX[c.id])
  S.customEx = [...(S.customEx || []), ...customs]
  S.workouts = [...S.workouts, ...fresh].sort((a, b) => (a.d < b.d ? -1 : 1))
  fresh.forEach(w => w.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.map(s => s.w || 0), e.topW || 0)
    if (mx > 0) { const cur = S.exWeights[e.id]; if (!cur || w.d >= cur.d) S.exWeights[e.id] = { w: mx, d: w.d } }
  }))
  return { added: fresh.length, skipped: parsed.workouts.length - fresh.length }
}
```

Update the existing doc comment above `mergeImport` (currently "Existing days win — importing
twice never duplicates a workout") to reflect the new key:

```js
/** Merge into state. A workout is a duplicate only if an existing one shares its date AND starts
 *  within DEDUP_TOLERANCE_MS — re-importing the same file never duplicates a workout, but a
 *  different source's genuinely different same-day workout is kept. */
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd frontend && npx vitest run src/lib/import-csv.test.js -t "mergeImport"`
Expected: all `mergeImport`-related tests pass, including the 4 new ones and every pre-existing
`mergeImport` test (the Phase 2 "Garmin placeholder workouts" describe block especially — confirm
its idempotent-reimport assertion still holds under the new key).

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/import-csv.js frontend/src/lib/import-csv.test.js
git commit -m "fix: dedup imported workouts by date+start time, not date alone"
```

---

### Task 5: Full-scope verification and phase gate

**Files:** none modified — verification only.

- [ ] **Step 1: Full build + test**

Run: `cd frontend && npm run build && npm test`
Expected: all succeed. (No `api/` changes this phase — skip `cd api && npm test`, though running it
anyway as a quick no-regression sanity check costs nothing.)

- [ ] **Step 2: `docker compose build web`**

Run from the repo root: `docker compose build web`
Expected: image builds successfully (Docker Desktop must be running). `api` is unaffected by this
phase and does not need rebuilding, but building it too is harmless if convenient.

- [ ] **Step 3: Confirm no dependency was added**

Run: `git diff <first-phase-6-commit>..HEAD -- frontend/package.json`
Expected: no output.

- [ ] **Step 4: Dispatch the phase-gate subagents**

Invoke, in order, and address any findings before Phase 6 is considered done:
- `the-architect` — confirm `parseTCX`'s output shape is genuinely identical to `parseGarminCSV`'s
  (no drift that would break `mergeImport`'s or the summary UI's assumptions); confirm no new
  parser file/module was created outside `import-csv.js` (this phase's design deliberately keeps
  everything in one file, matching the existing per-format-function pattern already there); confirm
  `mergeImport`'s bodyweight branch is genuinely untouched.
- `cyber-neo` — confirm `parseTCX`'s regex-based parsing has no catastrophic-backtracking risk on
  adversarial input (a maliciously large/malformed TCX file) — this is client-side, browser-only
  code with no server exposure, so severity is inherently low, but a pathological regex could still
  freeze the importing user's own tab; spot-check the activity/lap regexes for obvious ReDoS
  patterns (unbounded nested quantifiers) given they run on user-supplied file content.
- `all-deploy` — confirm `npm run build`, `npm test`, and `docker compose build web` all still
  succeed; confirm no new dependency was added to `frontend/package.json`.

- [ ] **Step 5: Final commit (if Step 3 or Step 4 required fixes)**

```bash
git add -A
git commit -m "fix: address Phase 6 gate findings"
```

If nothing needed fixing, skip this commit — Phase 6 is done as of Task 4's commit.
