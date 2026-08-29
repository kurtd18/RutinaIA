// Builds a compact, JSON-serializable summary of the user's training history for the AI routine
// suggestion feature. Pure — no network calls. Reuses the existing derivation modules rather than
// recomputing 1RM/muscle-balance math, so this and the rest of the app never disagree about what
// a user's training says.
import { best1RM } from './onerm.js'
import { fatigueOf, strengthOf } from './recovery.js'

const RECENT_WEEKS = 8

export function buildTrainingSummary(S) {
  const workouts = S.workouts || []
  const cutoff = Date.now() - RECENT_WEEKS * 7 * 24 * 3600000

  const recentWorkouts = workouts
    .filter(w => w.start >= cutoff)
    .map(w => ({
      d: w.d,
      name: w.name,
      entries: (w.entries || []).map(e => ({
        id: e.id,
        sets: (e.sets || []).map(s => ({ w: s.w, r: s.r })),
      })),
    }))

  const exIds = new Set()
  workouts.forEach(w => (w.entries || []).forEach(e => exIds.add(e.id)))

  const oneRepMaxes = {}
  for (const exId of exIds) {
    const best = best1RM(S, exId)
    if (best) oneRepMaxes[exId] = best.est
  }

  const now = Date.now()
  const muscleBalance = {
    fatigue: fatigueOf(workouts, now),
    strength: strengthOf(workouts, now),
  }

  return { recentWorkouts, oneRepMaxes, muscleBalance }
}
