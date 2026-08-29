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
