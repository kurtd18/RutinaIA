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
