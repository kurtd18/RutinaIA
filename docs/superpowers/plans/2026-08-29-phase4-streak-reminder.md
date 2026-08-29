# Phase 4 — Streak Reminder Push Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in PWA user who has enabled "streak reminder" gets a single push notification
the moment they've gone exactly `streakDays` (default 3, user-configurable) days without a logged
workout — independent of, and in addition to, the existing "workout planned today" reminder.

**Architecture:** Two new pure functions (`lastWorkoutDate`, `daysBetween`, `shouldFireStreakReminder`)
in a new `api/streak-reminder.js` module drive a second condition added to the existing 10s-tick
reminder loop in `api/server.js`. A new `streakReminderPush()` in `api/push-messages.js` builds the
notification copy. `frontend/src/store/useStore.js`'s `DEF.reminder` gains `streakOn`/`streakDays`
fields that round-trip through the existing full-state sync (no new API endpoint). Settings UI adds
two rows to the existing `PushCard` in `frontend/src/views/Settings.jsx`.

**Tech Stack:** existing repo tooling only — `cd api && npm test` (`node --test`), `cd frontend &&
npm test` (`vitest run`). No new dependencies.

## Global Constraints

- PWA/web-push only. The Capacitor mobile build (`MobileReminderCard`, `lib/mobile.js`'s
  `syncReminder`) is untouched — out of scope for this phase.
- No new API endpoint — `S.reminder` already round-trips through the existing full-state
  push/pull in `lib/api.js`.
- The streak reminder fires on an exact match (`daysBetween(...) === streakDays`), never `>=` —
  this is what makes it fire exactly once per streak break with no extra "already warned for this
  streak" bookkeeping.
- If the user has never logged a workout (`S.workouts` empty), the streak reminder never fires —
  no baseline to measure from.
- The streak reminder fires at the same local time as the existing day-reminder
  (`S.reminder.time`) — no separate time-of-day setting.
- Every task ends with the relevant test suite (`cd api && npm test` and/or `cd frontend && npm
  test`) passing before commit.

---

### Task 1: `api/streak-reminder.js` — pure date-math helpers

**Files:**
- Create: `api/streak-reminder.js`
- Test: `api/streak-reminder.test.js` (new)

**Interfaces:**
- Produces: `lastWorkoutDate(workouts) -> string | null`, `daysBetween(isoA, isoB) -> number`,
  `shouldFireStreakReminder({ lastWorkout, today, streakDays, alreadyFiredToday }) -> boolean`.
  `workouts` is an array of objects each with a `.d` field (`YYYY-MM-DD` string) — matches the
  shape `S.workouts` already uses elsewhere in `api/server.js` (see `w.d === now.date` at line
  304).
- Consumes: nothing — pure, no imports needed beyond built-ins.

- [ ] **Step 1: Write the failing tests**

Create `api/streak-reminder.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { lastWorkoutDate, daysBetween, shouldFireStreakReminder } from './streak-reminder.js';

test('lastWorkoutDate returns null for an empty or missing workout list', () => {
  assert.equal(lastWorkoutDate([]), null);
  assert.equal(lastWorkoutDate(undefined), null);
  assert.equal(lastWorkoutDate(null), null);
});

test('lastWorkoutDate returns the most recent date string', () => {
  const workouts = [{ d: '2026-08-10' }, { d: '2026-08-25' }, { d: '2026-08-15' }];
  assert.equal(lastWorkoutDate(workouts), '2026-08-25');
});

test('daysBetween counts whole days between two ISO date strings', () => {
  assert.equal(daysBetween('2026-08-25', '2026-08-28'), 3);
  assert.equal(daysBetween('2026-08-25', '2026-08-25'), 0);
  assert.equal(daysBetween('2026-08-28', '2026-08-25'), -3);
});

test('shouldFireStreakReminder is false when no workout has ever been logged', () => {
  assert.equal(shouldFireStreakReminder({
    lastWorkout: null, today: '2026-08-28', streakDays: 3, alreadyFiredToday: false,
  }), false);
});

test('shouldFireStreakReminder fires on an exact day match', () => {
  assert.equal(shouldFireStreakReminder({
    lastWorkout: '2026-08-25', today: '2026-08-28', streakDays: 3, alreadyFiredToday: false,
  }), true);
});

test('shouldFireStreakReminder does not re-fire the same day', () => {
  assert.equal(shouldFireStreakReminder({
    lastWorkout: '2026-08-25', today: '2026-08-28', streakDays: 3, alreadyFiredToday: true,
  }), false);
});

test('shouldFireStreakReminder does not fire the day after the threshold (streak not reset)', () => {
  assert.equal(shouldFireStreakReminder({
    lastWorkout: '2026-08-25', today: '2026-08-29', streakDays: 3, alreadyFiredToday: false,
  }), false);
});

test('shouldFireStreakReminder does not fire before the threshold is reached', () => {
  assert.equal(shouldFireStreakReminder({
    lastWorkout: '2026-08-25', today: '2026-08-27', streakDays: 3, alreadyFiredToday: false,
  }), false);
});

test('a new workout resets the calculation (streak recalculates from the new lastWorkout)', () => {
  // User trained again on 08-26, so a check on 08-29 measures from the new date, not the old one.
  assert.equal(shouldFireStreakReminder({
    lastWorkout: '2026-08-26', today: '2026-08-29', streakDays: 3, alreadyFiredToday: false,
  }), true);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd api && npx --node-options="" node --test streak-reminder.test.js`
Expected: FAIL — `streak-reminder.js` doesn't exist yet (module not found).

- [ ] **Step 3: Implement `api/streak-reminder.js`**

```js
// Pure date-math helpers for the streak reminder — kept separate from server.js so the
// "days since last workout" and "should this fire" logic has a unit test beside it, per
// CONTRIBUTING.md's rule for anything that reads a logged session back.

export function lastWorkoutDate(workouts) {
  if (!workouts || workouts.length === 0) return null;
  return workouts.reduce((max, w) => (w.d > max ? w.d : max), workouts[0].d);
}

export function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00Z');
  const b = new Date(isoB + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// Fires on an exact match, not >=: the day after the threshold, daysBetween has moved past
// streakDays and no longer matches, so this naturally stops firing on its own — until a new
// workout changes lastWorkout and the whole calculation restarts from there.
export function shouldFireStreakReminder({ lastWorkout, today, streakDays, alreadyFiredToday }) {
  if (!lastWorkout) return false;
  if (alreadyFiredToday) return false;
  return daysBetween(lastWorkout, today) === streakDays;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd api && npm test`
Expected: all pass, including the 8 new tests and every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add api/streak-reminder.js api/streak-reminder.test.js
git commit -m "feat: add pure streak-reminder date-math helpers"
```

---

### Task 2: `streakReminderPush()` — notification copy

**Files:**
- Modify: `api/push-messages.js`
- Test: `api/push-messages.test.js` (extend existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `streakReminderPush(lang, days) -> { title: string, body: string, tag: 'streak-reminder' }`.

- [ ] **Step 1: Add the failing test cases to `api/push-messages.test.js`**

Extend the existing file (do not create a new one — this mirrors `restTimerPush`/`dayReminderPush`
being tested together). Add these assertions inside the existing two `test(...)` blocks:

In `'localizes every server-generated notification in pt-BR'`, add before the closing `});`:

```js
  assert.deepEqual(streakReminderPush('pt-BR', 3), {
    title: 'Não perca sua sequência 🔥',
    body: 'Já se passaram 3 dias desde seu último treino.',
    tag: 'streak-reminder',
  });
```

In `'keeps the existing English copy as the fallback'`, add before the closing `});`:

```js
  assert.deepEqual(streakReminderPush('unknown', 5), streakReminderPush('en', 5));
  assert.equal(streakReminderPush('en', 3).body, "It's been 3 days since your last workout.");
```

And update the import at the top of the file:

```js
import { dayReminderPush, restTimerPush, testPush, streakReminderPush } from './push-messages.js';
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd api && npm test`
Expected: FAIL — `streakReminderPush` is not exported yet.

- [ ] **Step 3: Add the copy and function to `api/push-messages.js`**

Add `streakTitle` and a `streakBody` template function to both locale blocks in `COPY`:

```js
const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    testBody: 'Test notification ✅ — this is what alerts look like.',
    dayFallbackTitle: 'Workout planned today',
    dayRoutineSuffix: 'today',
    dayBody: "It's on your plan — let's go 💪",
    streakTitle: "Don't break your streak 🔥",
    streakBody: days => `It's been ${days} days since your last workout.`,
  },
  'pt-BR': {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Hora da próxima série.',
    testBody: 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    dayFallbackTitle: 'Treino planejado para hoje',
    dayRoutineSuffix: 'hoje',
    dayBody: 'Está no seu plano — vamos treinar 💪',
    streakTitle: 'Não perca sua sequência 🔥',
    streakBody: days => `Já se passaram ${days} dias desde seu último treino.`,
  },
};
```

Then add the exported function, after `dayReminderPush`:

```js
export function streakReminderPush(lang, days) {
  const copy = copyFor(lang);
  return {
    title: copy.streakTitle,
    body: copy.streakBody(days),
    tag: 'streak-reminder',
  };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd api && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add api/push-messages.js api/push-messages.test.js
git commit -m "feat: add streakReminderPush notification copy"
```

---

### Task 3: Wire the streak check into `server.js`'s reminder loop

**Files:**
- Modify: `api/server.js`

**Interfaces:**
- Consumes: `lastWorkoutDate`, `shouldFireStreakReminder` from Task 1 (`./streak-reminder.js`);
  `streakReminderPush` from Task 2 (`./push-messages.js`); `sendPush`, `saveDb`, `readState`, the
  existing `setInterval` loop and its `now`/`user`/`S` locals — all already defined/computed in
  `api/server.js`'s existing reminder loop (see lines 296–312 as read during design).
- Produces: nothing new for later tasks — this is the final server-side wiring.

- [ ] **Step 1: Confirm the current loop and import lines are still where expected**

Run: `grep -n "^import { dayReminderPush" api/server.js`
Run: `grep -n "user.lastReminder = now.date;" api/server.js`

Confirm both are present — this task edits immediately around them.

- [ ] **Step 2: Extend the import line**

Change:

```js
import { dayReminderPush, restTimerPush, testPush } from './push-messages.js';
```

to:

```js
import { dayReminderPush, restTimerPush, testPush, streakReminderPush } from './push-messages.js';
import { lastWorkoutDate, shouldFireStreakReminder } from './streak-reminder.js';
```

- [ ] **Step 3: Add the streak check inside the existing loop**

Immediately after the existing line `sendPush(user.id, dayReminderPush(S.lang, routine));` (still
inside the same `for (const user of db.users) { ... }` loop body, same `if (!S?.reminder?.on)
continue;`-scoped block — note the streak check must NOT be gated by that early `continue`, since a
user can have `streakOn: true` while the day-reminder `on` is `false`), restructure the top of the
loop body so the streak check runs independently. Replace the loop body (from `const S =
readState(user.id);` through the day-reminder's `sendPush(...)` call) with:

```js
    const S = readState(user.id);
    if (!S?.reminder) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now) continue;

    if (S.reminder.on && S.reminder.time === now.hhmm && user.lastReminder !== now.date) {
      if ((S.workouts || []).some(w => w.d === now.date)) {
        // already logged today — nothing to remind about
      } else {
        const rid = effectiveRoutineId(S, now.date);
        if (rid) {
          const routine = (S.routines || []).find(r => r.id === rid);
          console.log('reminder firing', user.id, rid);
          user.lastReminder = now.date;
          saveDb();
          sendPush(user.id, dayReminderPush(S.lang, routine));
        }
      }
    }

    if (S.reminder.streakOn && S.reminder.time === now.hhmm) {
      const lw = lastWorkoutDate(S.workouts);
      if (shouldFireStreakReminder({
        lastWorkout: lw, today: now.date,
        streakDays: S.reminder.streakDays || 3,
        alreadyFiredToday: user.lastStreakReminder === now.date,
      })) {
        console.log('streak reminder firing', user.id);
        user.lastStreakReminder = now.date;
        saveDb();
        sendPush(user.id, streakReminderPush(S.lang, S.reminder.streakDays || 3));
      }
    }
```

This preserves the exact existing day-reminder behavior (same conditions, same order of checks,
same `user.lastReminder` dedup) while adding the streak branch as a sibling condition gated on its
own `streakOn`/`user.lastStreakReminder`, both keyed off the same `now.hhmm === S.reminder.time`
tick-matching used by the day-reminder.

- [ ] **Step 4: Run the API test suite**

Run: `cd api && npm test`
Expected: all pass — this task has no new automated test of its own (the loop's conditions are
already covered by Task 1's unit tests on the extracted pure functions; the loop wiring itself is
integration glue, verified manually in Step 5).

- [ ] **Step 5: Manual sanity check**

Start the API locally (check `docker-compose.yml`/README for the usual dev-run command, or `cd api
&& DATA_DIR=/tmp/rutinaia-streak-test node server.js`). With a signed-in test user and an active
push subscription (`POST /api/push/subscribe`), set `S.reminder = { on: false, time: '<next
minute>', tz: '<your tz>', streakOn: true, streakDays: 3 }` via `POST /api/data` (or however state
is normally pushed — check `lib/api.js`'s `pushState` call shape), with `S.workouts` containing one
workout dated exactly 3 days before today. Confirm a "Don't break your streak" push arrives at the
configured time, and does not repeat on the next day's tick if you leave the test running (or
re-verify the exact-match logic via the Task 1 unit tests as sufficient evidence if leaving it
running overnight isn't practical). Note in the report whether this manual check was performed live
or reasoned through via the unit tests, and why.

- [ ] **Step 6: Commit**

```bash
git add api/server.js
git commit -m "feat: fire streak reminder push independently of day reminder"
```

---

### Task 4: Frontend — `DEF.reminder` fields + Settings UI

**Files:**
- Modify: `frontend/src/store/useStore.js`
- Modify: `frontend/src/views/Settings.jsx`

**Interfaces:**
- Consumes: nothing new — pure state field additions and UI wiring following patterns already
  present in both files.
- Produces: `S.reminder.streakOn: boolean`, `S.reminder.streakDays: number` — available to the
  server via the existing full-state sync from Task 3 onward.

- [ ] **Step 1: Extend `DEF.reminder` in `useStore.js`**

Run: `grep -n "reminder: { on: false" frontend/src/store/useStore.js` to confirm the exact current
line, then change:

```js
  reminder: { on: false, time: '08:00', tz: null }, effort: null, autoBackup: false,
```

to:

```js
  reminder: { on: false, time: '08:00', tz: null, streakOn: false, streakDays: 3 }, effort: null, autoBackup: false,
```

- [ ] **Step 2: Read `PushCard` in `Settings.jsx` to confirm the exact insertion point**

Run: `grep -n "function PushCard" -A 40 frontend/src/views/Settings.jsx`

Locate the closing of the existing day-reminder time `<Row>` (the block shown during design at
lines 356–361: the `{on && S.reminder?.on && (...)}` block rendering the `type="time"` input) —
this task inserts two new `Row`s immediately after that block, still inside the same `<Section>`.

- [ ] **Step 3: Add the streak toggle and days-input rows**

Immediately after the existing day-reminder time `Row` block (closing `)}` of `{on &&
S.reminder?.on && (...)}`), add:

```jsx
      {on && (
        <Row icon="flame" iconTint="var(--red)" title={t('Streak reminder')}>
          <Switch checked={!!S.reminder?.streakOn} onChange={() => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), streakOn: !s.reminder?.streakOn, tz: localTZ() } })} />
        </Row>
      )}
      {on && S.reminder?.streakOn && (
        <Row icon="calendar" iconTint="var(--red)" title={t('Days before reminding')}>
          <input type="number" min="1" max="30" className="timef" value={S.reminder?.streakDays ?? 3}
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), streakDays: Math.max(1, Math.min(30, Number(e.target.value) || 3)), tz: localTZ() } })} />
        </Row>
      )}
```

Use whatever icon names the file's existing `Row icon="..."` calls already use for `flame`/`calendar`
— run `grep -n 'icon="' frontend/src/views/Settings.jsx | sort -u -t'"' -k2,2` first; if `flame`
isn't among the existing icon names used elsewhere in the app, check `frontend/src/components/`
for the icon set (`grep -rn "flame" frontend/src/components/`) and substitute the closest existing
icon name instead (e.g. `zap` or `alert-triangle`) rather than introducing an icon that doesn't
exist in the set — do not add a new icon asset for this task.

- [ ] **Step 4: Add the two new i18n strings**

Run: `grep -n "'Reminder time'" frontend/src/lib/locales/en.js` (or wherever the `en` locale
catalogue lives — confirm path with `grep -rln "Reminder time" frontend/src/`) and add two new
entries next to it, matching the file's existing key/value format exactly:
- `'Streak reminder'`
- `'Days before reminding'`

Leave other locale files' translations for these keys to fall back to English (matching how the
push-copy fallback already works for locales beyond `en`/`pt-BR` at the server level) unless the
project's i18n tooling requires every locale file to have every key — check `grep -c "'Reminder
time'"` across all files under `frontend/src/lib/locales/` to see whether the existing key appears
in every locale file or only `en`; mirror whichever pattern is already there.

- [ ] **Step 5: Run the frontend dev server and manually verify**

Run `cd frontend && npm run dev`, open Settings, enable notifications, confirm the new "Streak
reminder" row appears, toggling it reveals the days input, the days input clamps to 1–30, and no
console errors appear.

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all pass — no new `.test.js` file in this task (pure UI/state-default wiring, no new
derivation logic), but must not regress anything.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/store/useStore.js frontend/src/views/Settings.jsx frontend/src/lib/locales/
git commit -m "feat: add streak reminder toggle to Settings"
```

---

### Task 5: Full-scope verification and phase gate

**Files:** none modified — verification only.

- [ ] **Step 1: Full build + test, both sides**

Run: `cd frontend && npm run build && npm test`
Run: `cd api && npm test`
Expected: all succeed.

- [ ] **Step 2: `docker compose build api web`**

Run from the repo root: `docker compose build api web`
Expected: both images build successfully (Docker Desktop must be running).

- [ ] **Step 3: Confirm no dependency was added**

Run: `git diff <first-phase-4-commit>..HEAD -- api/package.json frontend/package.json`
Expected: no output — neither `package.json` changed.

- [ ] **Step 4: Dispatch the phase-gate subagents**

Invoke, in order, and address any findings before Phase 4 is considered done:
- `the-architect` — confirm `S.reminder`'s new fields follow the existing state shape conventions,
  confirm the streak logic lives in the pure `api/streak-reminder.js` module rather than being
  inlined into `server.js`'s loop body, confirm the mobile reminder path
  (`MobileReminderCard`/`lib/mobile.js`) was not touched.
- `cyber-neo` — confirm the streak check adds no new attack surface (no new endpoint, no new
  user-controlled data reaching an external host), confirm `streakDays` is clamped both
  client-side (Task 4) and does not cause unbounded loop iteration or resource use server-side even
  if a malicious client pushes an out-of-range value (check `S.reminder.streakDays || 3` in
  `server.js` handles a huge or negative number gracefully — `daysBetween(...) === streakDays` with
  an absurd `streakDays` simply never matches, so confirm this reasoning holds, don't just assume
  it).
- `all-deploy` — confirm `npm run build`, `npm test` (both sides), and `docker compose build api
  web` all still succeed; confirm no new dependency was added to either `package.json`.

- [ ] **Step 5: Final commit (if Step 4 required fixes)**

```bash
git add -A
git commit -m "fix: address Phase 4 gate findings"
```

If nothing needed fixing, skip this commit — Phase 4 is done as of Task 4's commit.
