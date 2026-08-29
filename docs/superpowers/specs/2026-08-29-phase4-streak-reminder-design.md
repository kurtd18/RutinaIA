# Phase 4 — Streak Reminder Push Notification (Design Spec)

**Goal:** A user who has stopped training gets a single push notification once they've gone
`streakDays` (default 3, user-configurable) days without a logged workout — separate from, and
independent of, the existing "workout planned today" reminder. PWA/web-push only for this phase;
the Capacitor mobile build (local-notification path) is out of scope.

## Background

`api/server.js` already runs a 10s-tick loop that sends a per-user "workout planned today" push
(`dayReminderPush`) at a user-chosen local time, using `S.reminder = { on, time, tz }` and a
`user.lastReminder` dedup marker in `db.json`. This phase adds a second, independent condition to
that same loop rather than building new scheduling infrastructure.

## Data model

Extend `DEF.reminder` in `frontend/src/store/useStore.js`:

```js
reminder: { on: false, time: '08:00', tz: null, streakOn: false, streakDays: 3 }
```

No new API endpoint — `S.reminder` already round-trips through the existing full-state
push/pull (`lib/api.js` `pushState`/`pullState`), so `streakOn`/`streakDays` sync for free.

`db.json`'s per-user record gets one new field, `lastStreakReminder` (a date string, same shape
and purpose as the existing `lastReminder` field) — used purely as a same-day dedup guard, not a
"already warned for this streak" marker (see below for why that's unnecessary).

## Server logic

Add a small pure module, `api/streak-reminder.js`:

```js
// Pure date-math helpers for the streak reminder — kept separate from server.js so the
// "days since last workout" and "should this fire" logic has a unit test beside it, per
// CONTRIBUTING.md's rule for anything that reads a logged session back.

export function lastWorkoutDate(workouts) {
  if (!workouts || workouts.length === 0) return null
  return workouts.reduce((max, w) => (w.d > max ? w.d : max), workouts[0].d)
}

export function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00Z')
  const b = new Date(isoB + 'T00:00:00Z')
  return Math.round((b - a) / 86400000)
}

export function shouldFireStreakReminder({ lastWorkout, today, streakDays, alreadyFiredToday }) {
  if (!lastWorkout) return false // no workout ever logged — no baseline, never fires
  if (alreadyFiredToday) return false
  return daysBetween(lastWorkout, today) === streakDays
}
```

`shouldFireStreakReminder` fires on an exact match (`=== streakDays`), not `>=`. This is what
gives the "once per streak break" behavior without tracking which streak was already
acknowledged: the day after the threshold day, `daysBetween` has moved on to `streakDays + 1`,
which no longer matches, so it naturally doesn't re-fire — until the user logs a new workout,
which changes `lastWorkout` and resets the whole calculation. `alreadyFiredToday` (backed by
`user.lastStreakReminder === now.date`) only guards against firing twice within the same
matching day, mirroring the existing `user.lastReminder` pattern for the day-reminder.

In `api/server.js`'s existing `setInterval` loop, alongside the current day-reminder check, add:

```js
if (S?.reminder?.streakOn) {
  const lw = lastWorkoutDate(S.workouts)
  if (shouldFireStreakReminder({
    lastWorkout: lw, today: now.date,
    streakDays: S.reminder.streakDays || 3,
    alreadyFiredToday: user.lastStreakReminder === now.date,
  })) {
    user.lastStreakReminder = now.date
    saveDb()
    sendPush(user.id, streakReminderPush(S.lang, S.reminder.streakDays || 3))
  }
}
```

This reuses the loop's existing `now` (the user's local time, already computed for the
day-reminder check) and fires at the same `S.reminder.time` the day-reminder uses — no separate
time-of-day setting for the streak reminder.

## Push message

Add to `api/push-messages.js`, following the existing `dayReminderPush` pattern (copy for `en`
and `pt-BR`, falling back to `en` for other locales — matching every other message in this file):

```js
export function streakReminderPush(lang, days) {
  const copy = copyFor(lang)
  return {
    title: copy.streakTitle,
    body: copy.streakBody(days),
    tag: 'streak-reminder',
  }
}
```

Example copy (`en`): title `"Don't break your streak 🔥"`, body a template like
`` `It's been ${days} days since your last workout.` ``.

## Frontend UI

In `frontend/src/views/Settings.jsx`'s `PushCard` (the non-mobile notifications card — the
`MobileReminderCard` path is untouched, per this phase's PWA-only scope), inside the existing
"Notifications" `Section`, add a new `Row` below the existing day-reminder rows:

- A switch bound to `S.reminder?.streakOn`, following the exact update pattern already used for
  `S.reminder.on` (`update(s => { s.reminder = { ...(s.reminder || DEF.reminder), streakOn:
  !s.reminder?.streakOn } })`).
- When on, a number input bound to `S.reminder?.streakDays` (default `3`, clamped to a sane range
  e.g. 1–30), following the same `<input>` + `update()` pattern already used for the day-reminder's
  `time` field.

No new sheet, no new API call — this is pure `S.reminder` field wiring identical in shape to what
already exists two rows above it.

## Testing

- `api/streak-reminder.test.js` (new): unit tests for `lastWorkoutDate`, `daysBetween`, and
  `shouldFireStreakReminder` — covering: no workouts ever → never fires; exact-day match with no
  prior firing today → fires; exact-day match but already fired today → doesn't fire; day after
  the threshold (streak not reset) → doesn't fire (this is what proves the "once" behavior);
  streak reset by a new workout → recalculates from the new `lastWorkout` date.
- No new frontend unit test needed — this phase's frontend change is UI wiring of existing
  `S.reminder` fields (Settings.jsx), not new derivation logic; `buildTrainingSummary`-style pure
  helpers don't apply here since nothing new reads a logged session back on the frontend side.
- Manual check: toggle the streak reminder on with a low `streakDays` value against a test user
  with an old logged workout, advance/mock the server's date handling if feasible, confirm the
  push fires once and not on subsequent ticks.

## Out of scope (this phase)

- Capacitor/mobile local-notification path (`MobileReminderCard`, `lib/mobile.js`'s
  `syncReminder`) — stays exactly as it is today; a future phase can extend it symmetrically.
- Any new API endpoint — everything rides on the existing full-state sync.
- Multiple/escalating streak thresholds — single fixed `streakDays` value per user, one push per
  streak break.
