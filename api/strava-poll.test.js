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

// Mirrors the poll loop's cursor-advance decision in api/server.js: fetchStravaActivities now
// resolves null on any failure (bad status/network/timeout/parse error) and an array (possibly
// empty) only on a genuine 200. The poll loop must not advance lastPollAt on a failed fetch, and
// must not advance it either when there were strength activities to write but no state file
// existed yet to write them into (stateExists === false) — those activities need to be retried
// on the next tick rather than silently dropped.
function shouldAdvancePollCursor(activities, stateExists) {
  if (activities === null) return false // fetch failed — retry this window next tick
  const strengthActivities = filterStrengthActivities(activities)
  if (strengthActivities.length && !stateExists) return false // nowhere to write them — retry
  return true
}

test('shouldAdvancePollCursor does not advance when the fetch failed', () => {
  assert.equal(shouldAdvancePollCursor(null, true), false)
})

test('shouldAdvancePollCursor advances when the fetch succeeded with genuinely no activities', () => {
  assert.equal(shouldAdvancePollCursor([], true), true)
})

test('shouldAdvancePollCursor advances when strength activities were written into existing state', () => {
  assert.equal(shouldAdvancePollCursor([{ type: 'WeightTraining' }], true), true)
})

test('shouldAdvancePollCursor does not advance when strength activities had no state file to write into', () => {
  assert.equal(shouldAdvancePollCursor([{ type: 'WeightTraining' }], false), false)
})

test('shouldAdvancePollCursor advances when there were activities but none were strength, regardless of state', () => {
  assert.equal(shouldAdvancePollCursor([{ type: 'Run' }], false), true)
})

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

// Regression test for the athleteId-preservation fix in ensureFreshStravaToken: a token-refresh
// response has no `athlete` field, so `fresh.athleteId` is undefined. Spreading it naively over
// the stored config would clobber the real athleteId captured at initial OAuth connect time.
test('merging a refreshed token must not let an undefined athleteId clobber the stored one', () => {
  const cfg = { clientId: 'c', clientSecret: 's', refreshToken: 'r', accessToken: 'old', expiresAt: 1, athleteId: 12345 }
  const fresh = { accessToken: 'new', refreshToken: 'r2', expiresAt: 999999999, athleteId: undefined }
  const cleanFresh = Object.fromEntries(Object.entries(fresh).filter(([, v]) => v !== undefined))
  const merged = { ...cfg, ...cleanFresh }
  assert.equal(merged.athleteId, 12345)
  assert.equal(merged.accessToken, 'new')
  assert.equal(merged.refreshToken, 'r2')
})
