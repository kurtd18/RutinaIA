# Phase 6 — Multi-Brand Manual Import (Design Spec)

**Goal:** A user with a Samsung, Huawei, Fitbit, Polar, Coros, or Suunto watch (or any device that
exports TCX or a generic activity CSV) can import their workout history the same way Garmin/Apple
Health users already can — via `parseImport()`'s existing "sniff the file and parse it as whatever
it is" flow — without RutinaIA needing a bespoke parser per vendor. Also fixes an existing
over-eager dedup rule so a same-day import from a second source doesn't get silently discarded.

## Background and constraints discovered during design

- Samsung Health, Huawei Health, Fitbit, Coros, Polar, and Suunto all export activity summaries,
  but each vendor's CSV column names differ and none are verified/stable public specs — same
  situation Phase 2 already documented for Garmin's CSV (`parseGarminCSV` was built from secondhand
  reports, not a real exported file). Huawei in particular has no reliable native CSV export for
  workout data at all (route-only GPX/TCX/FIT/KML from the app; CSV requires third-party tools).
- The one format with broad, genuine cross-vendor support is **TCX** (Training Center Database XML)
  — Garmin, Fitbit, Polar, and Coros all export it directly, and Suunto activities interoperate via
  the same ecosystem. Building one robust TCX parser covers far more real users than adding one
  bespoke CSV parser per vendor name.
- Like Garmin's CSV and Apple Health's XML, TCX does not carry structured set/rep/weight data for
  strength training — a TCX-imported activity becomes the same kind of placeholder workout
  (date/name/duration, empty `entries`) that `parseGarminCSV` already produces. This phase does not
  change that limitation; it only widens which files can reach that placeholder path.
- `parseImport()`'s current XML-sniffing (`/^\s*</.test(s)`) sends *any* file starting with `<`
  straight into `parseBodyweight()` and returns its result unconditionally — including a `{error:
  ...}` result. A TCX file would hit this branch, fail to parse as Apple Health XML, and return an
  error instead of ever reaching a TCX parser. This is a real dispatch-ordering bug this phase must
  fix, not just a gap to route around.
- `mergeImport()`'s existing dedup key is the workout's date alone (`S.workouts.map(w => w.d)`):
  importing a file for a date that already has *any* workout skips the whole day, even if the new
  import is a different, non-overlapping activity from a different source. This phase narrows the
  key to date + start time (within a tolerance), so same-day-different-source imports coexist while
  re-importing the same file twice stays idempotent (per user decision).

## New parser: `parseTCX(text)`

Add to `frontend/src/lib/import-csv.js`, following the same shape/conventions as `parseGarminCSV`:

- **Detection**: text contains `<TrainingCenterDatabase` (the root element every TCX file has,
  regardless of namespace prefix) — checked before the generic `/^\s*</` XML branch, not after.
- **Extraction**: for each `<Activity Sport="...">` block, read:
  - `<Id>` — the activity's start timestamp (TCX's canonical field for this; ISO 8601).
  - Total duration — sum of each `<Lap>`'s `<TotalTimeSeconds>` within the activity (a TCX activity
    can have multiple laps; the workout's `end` is `start + totalSeconds * 1000`).
  - Activity name: TCX has no dedicated "name" field in the base schema the way Garmin's CSV does;
    fall back to `Sport` attribute (e.g. "Other", "Running") the same way `parseGarminCSV` falls
    back to `activityType` when `workoutName` is absent.
- **Output shape**: identical to `parseGarminCSV`'s — `{ kind: 'workouts', source: 'TCX', workouts,
  customEx: [], matched: 0, matchedSets: 0, created: 0, unmatchedNames: [], sets: 0, skipped,
  warmups: 0, fileUnit: '', mixedUnits: false, converted: false, rpeSets: 0, rirSets: 0, from, to }`,
  each workout `{ id: 'iw' + uid(), d, start, end, routineId: null, name, entries: [], prs: [], vol:
  0 }`. Multiple activities on the same calendar date are merged into one workout entry the same
  way `parseGarminCSV` already merges same-date CSV rows (min start, max end, names joined with
  `+`) — this phase does not change that same-file merge behavior, only the cross-import dedup rule
  (see below).
- Malformed/unparseable `<Activity>` blocks are skipped and counted, never thrown — matching
  `parseWorkoutCSV`'s "a history of several thousand sets will contain oddities" tolerance.
- **Not verified against a real exported file** — same explicit caveat `parseGarminCSV` already
  carries in its own doc comment; this phase's implementation is built from the public TCX schema
  structure, not a captured real-world export. If a real file surfaces later, tighten against it.

## `detectSource()` extension

Add a TCX branch (checked via the same `<TrainingCenterDatabase` marker, not header columns since
TCX isn't a CSV) returning `'TCX'` — shown back to the user in the import summary the same way
`'Garmin'`/`'Hevy'`/`'Strong'`/`'FitNotes'` already are.

## Generalized CSV column matching (Samsung Health, best-effort)

Extend the existing `COLUMNS` alias table in `mapHeader()` with Samsung Health's known CSV export
column naming (e.g. its verbose `com.samsung.health.exercise.*`-prefixed headers where documented,
normalized the same way existing aliases are — case/whitespace-insensitive via the existing `norm()`
helper). This does not add a new parser function: Samsung Health's CSV, once its columns map onto
the existing `date`/`workoutName`/`activityType`/`time` fields, already flows through the existing
`parseGarminCSV`-style activity-summary path (or `parseWorkoutCSV`'s structured path, if a future
Samsung export ever includes per-set data — unlikely but the dispatcher doesn't need to know).
Like the TCX parser, this is **not verified against a real exported file** — same caveat, same
"tighten later if a real file surfaces" posture.

Huawei is explicitly **not** given a bespoke path in this phase: its native app has no reliable CSV
export for workout data, and its GPX/TCX/FIT route exports mean a Huawei user's most reliable path
is already covered by the new TCX parser above (Huawei's own TCX export, when available via the
app or a third-party bridge, needs no special-casing — it's a TCX file like any other).

## `parseImport()` dispatch fix

Current code:

```js
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

New ordering — check the specific XML markers *before* falling back to the generic `/^\s*</` catch,
and don't return a bare error result from a mis-routed generic XML guess:

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

## `mergeImport()` dedup granularity fix

Current dedup key is `w.d` (date string) alone. New key is date + start-time bucket, with a
tolerance window so re-importing the exact same file (same millisecond timestamps) is still
recognized as a duplicate even across minor clock-formatting differences between export formats:

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

export function mergeImport(S, parsed) {
  if (parsed.kind === 'bodyweight') {
    // unchanged — bodyweight dedup stays date-only (one weigh-in per day is the existing,
    // correct model; this phase's dedup-granularity fix is scoped to workouts only, per the
    // race/overlap problem this phase was scoped to solve).
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

Note `isDuplicateWorkout` is `O(existing × incoming)` — acceptable at the scale a personal workout
history file reaches (thousands of workouts, not millions); no index/Map optimization needed for
this phase.

## Testing

- `parseTCX` unit tests in `import-csv.test.js`: a minimal valid TCX fixture (one `<Activity
  Sport="Other">` with one `<Lap>`), multiple activities same day (merge behavior matches
  `parseGarminCSV`'s), malformed/missing `<Id>` (skipped + counted), empty file (`{error:
  'empty'}` or `'unrecognised'`, matching the existing error-shape convention).
- `detectSource` test: a TCX-shaped input returns `'TCX'`.
- `parseImport` dispatch test: a TCX file routes to `parseTCX` (not swallowed by the Apple Health
  branch); an Apple Health XML file still routes correctly (no regression); a non-TCX, non-Apple-
  Health XML file falls through to the CSV/Garmin attempts rather than failing immediately.
- `mergeImport` dedup test: importing the same TCX/CSV file twice adds zero new workouts the second
  time (existing behavior, must not regress); importing a second file with a same-date-but-
  different-start-time workout adds it as a new entry (the fixed behavior); importing a file whose
  start time is within `DEDUP_TOLERANCE_MS` of an existing workout on the same date is still
  treated as a duplicate.
- Samsung Health column-mapping test: a CSV using the documented Samsung header names round-trips
  through `mapHeader`/`parseGarminCSV`'s style path the same way a Garmin-shaped CSV does.

## Out of scope (this phase)

- Per-vendor bespoke parsers for Samsung Health or Huawei specifically (superseded by the TCX +
  generalized-CSV approach).
- FIT file support (binary format, would need a dedicated binary parser — a much larger addition
  than TCX/CSV text parsing; not pursued this phase).
- Any change to how Strava-synced workouts (Phase 5) are deduplicated — Phase 5 explicitly never
  merges/dedupes against manually-logged workouts by design; this phase's dedup fix applies only to
  the manual CSV/TCX import path (`mergeImport`), not the Strava poll loop's direct append.
- Reconciling/merging two *different* workouts on the exact same date+time that happen to come from
  two different real sources (e.g. genuinely wearing two trackers) — the tolerance window treats
  near-simultaneous entries as the same import, which is the common case (re-import) rather than
  the rare one (two trackers); no UI to manually resolve a false-positive/false-negative dedup
  decision is added this phase.
