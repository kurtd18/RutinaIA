# Phase 2: Garmin manual CSV import — design

Date: 2026-08-28
Status: Approved

## Context

Phase 1 (rebrand) is merged to `main`. This is Phase 2 of the RutinaIA roadmap defined in
`docs/superpowers/specs/2026-08-27-rutinaia-rebrand-and-features-design.md`: manual import of
Garmin data, no Garmin API/OAuth connection, no Garmin credentials handled anywhere.

## Why the original scope changed

The original phase spec assumed Garmin's export could be extended into the existing per-set CSV
importer (`frontend/src/lib/import-csv.js`), the same way FitNotes/Strong/Hevy were. That importer
requires an `exercise` column — every row is one logged set with a weight/rep count attached.

Research (no verified real Garmin export file was available to test against, see "What wasn't
verified" below) found that Garmin Connect's own "Export CSV" (Activities list → Export CSV) is an
**activity-summary** export — one row per session, with fields like date, activity type, title,
duration, and calories — not a per-set log. Per-exercise set/rep/weight data is only ever visible
in Garmin Connect's own UI or buried in a per-activity FIT file (a binary format), and even the
FIT file is unreliable: a Garmin forum thread confirms that manual edits a user makes to an
exercise's sets/reps/weight in the Garmin Connect app are **not** persisted back into the FIT file.
A second, independent source (Garmin's Health API activity-summary field list, documented at
support.mydatahelps.org) confirms zero reps/sets/weight fields exist in Garmin's own structured
activity-summary format either — this isn't a quirk of the CSV export specifically, Garmin simply
doesn't expose that data in any exportable structured format.

Given this, Phase 2's scope is redefined: **import Garmin's activity-summary CSV as empty workout
placeholders** — one workout entry per session (date, name, duration), with no exercises/sets. The
user still enters weights/reps by hand for that session, same as today, but the app now knows a
training day happened on that date. This preserves the actual value Garmin's export can reliably
provide (training-day history/consistency) without pretending to reconstruct data Garmin doesn't
give up.

## What wasn't verified

No real Garmin export file was available during design (the user doesn't have Garmin hardware to
hand). Garmin does not officially document the CSV's column set, and multiple independent forum
reports say it varies between accounts. The column names used here (`Date`, `Activity Type`,
`Title`, `Time`/`Duration`/`Elapsed Time`, `Calories`) are corroborated by several independent
secondhand reports (Garmin forums, a data-export blog) but are **not verified against an actual
exported file**, unlike every other adapter in `import-csv.js` (each of which has a comment citing
the exact real header row it was built against). This is called out explicitly in code so a future
contributor with a real Garmin export can tighten/correct the column list — the existing loose
"falls through to generic header matching" path already in `import-csv.js` is the fallback if the
named aliases don't match a real file.

## Design

### `parseGarminCSV(text)` — new function in `frontend/src/lib/import-csv.js`

- Lives beside `parseWorkoutCSV`/`parseBodyweight`, reuses the existing `parseCSV`, `mapHeader`,
  `norm`, `parseWhen`, `toMinutes` helpers — no new CSV-parsing machinery.
- New header aliases added to the existing `COLUMNS` table: `activityType` (`['activity type',
  'type']`), reusing `title`/`workoutName`(`['title', 'activity name']` — extend the existing
  `workoutName` aliases rather than adding a parallel field), and duration aliases extended to
  cover `['time', 'duration', 'elapsed time', 'moving time']`.
- A file matches the Garmin shape when it has a `date` column, a `workoutName` (title) or
  `activityType` column, and **no** `exercise` column. The missing exercise column is the
  deliberate signal that this is a summary export, not a per-set log — it's what makes this safe
  to try after `parseWorkoutCSV` has already rejected the file.
- Each data row becomes one workout: `{ id: 'iw'+uid(), d, start, end, routineId: null, name,
  entries: [], prs: [], vol: 0 }` — `name` is the row's title if present, else the activity type,
  else `'Imported'` (same fallback `parseWorkoutCSV` already uses). No `customEx` are created
  (nothing to match, `entries` is empty).
- Return shape matches `parseWorkoutCSV`'s exactly — `{ kind: 'workouts', source: 'Garmin',
  workouts, customEx: [], matched: 0, matchedSets: 0, created: 0, unmatchedNames: [], sets: 0,
  skipped, warmups: 0, fileUnit: '', mixedUnits: false, converted: false, rpeSets: 0, rirSets: 0,
  from, to }` — this is what lets the existing `ImportSummary` UI component
  (`frontend/src/sheets.jsx`) render it with zero changes: the "Sets"/"Exercises matched"/"Added as
  your own" tiles correctly show 0, and the unmatched-names section stays hidden since the array
  is empty.
- Rows with no parseable date are skipped and counted (`skipped++`), same error-tolerance
  philosophy as `parseWorkoutCSV` — a few odd rows in a long export shouldn't fail the whole
  import.

### `detectSource(header)` extension

Add a branch: if the header has a date-like column and an activity-type-like column but no
`exercise` column, return `'Garmin'`. Checked after the existing Hevy/Strong/FitNotes checks (those
are more specific and should win if a header somehow matches both).

### `parseImport(text, opts)` dispatch order

Currently: try `parseWorkoutCSV` → if error, try `parseBodyweight` → return whichever succeeded (or
the first error). Add a third fallback: if both of those error, try `parseGarminCSV`. A Garmin
summary file naturally fails the first two (no `exercise` column for `parseWorkoutCSV`, no weight
column for `parseBodyweight`), so it falls through cleanly to the new parser without changing
existing dispatch behavior for any other file.

### `mergeImport(S, parsed)` — no changes

Empty-`entries` workouts merge through the existing "existing days win" path unchanged: `e.sets.map`
and `e.entries.map` over an empty `entries` array are no-ops, `vol` computes to `0`. Re-importing
the same Garmin file twice does not duplicate placeholder workouts, same as any other import
source.

### UI — no changes

`frontend/src/sheets.jsx`'s `ImportSummary` and `importFromApp` already branch only on
`parsed.kind` (`'workouts'` vs `'bodyweight'`), never on `parsed.source`. Since Garmin's parsed
result is `kind: 'workouts'` with the same field shape as every other workout import, it renders
correctly with zero component changes. `docs/DATA_IMPORTS.md` gets a new table row noting Garmin's
CSV import creates placeholder training days without set data, same table format as the existing
FitNotes/Strong/Hevy rows.

## Testing

Per `CONTRIBUTING.md`: import/parsing logic needs a unit test beside the code. New tests in
`frontend/src/lib/import-csv.test.js`:
- A synthetic Garmin-shaped CSV (`Date,Activity Type,Title,Time,Calories`) produces workouts with
  empty `entries`, correct dates/names/durations, `sets: 0`, `matched: 0`.
- `detectSource()` returns `'Garmin'` for that header shape.
- `parseImport()` routes a Garmin-shaped file to `parseGarminCSV` and not to `parseWorkoutCSV`'s
  error path.
- A file with only some of the Garmin aliases present (e.g. `Date,Title` with no `Time`/`Calories`)
  still produces workouts with `end === start` (no duration), not a crash.
- Re-importing the same synthetic file twice via `mergeImport` produces 0 newly-added workouts the
  second time.
- Existing FitNotes/Strong/Hevy/Apple-Health test fixtures still parse to the same `kind` as
  before (dispatch-order regression guard — the new fallback must not intercept files it
  shouldn't).

## Out of scope (unchanged from the phase-1 spec)

- Garmin API/OAuth connection, Garmin account credentials of any kind.
- General wellness/activity data (cardio, steps, heart rate, sleep) — this phase is strength-log
  placeholder dates only, from the activity-summary CSV.
- Parsing the binary FIT file — out of scope per the "Alcance final F2" decision; may be
  reconsidered in a future phase if a verified real export becomes available and per-exercise data
  turns out to be reliably present in it.
