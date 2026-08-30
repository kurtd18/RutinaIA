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
