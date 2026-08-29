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

// The model's structured output is untrusted input — same trust level as an imported CSV row
// (see import-csv.js). Drops any exercise id that isn't in the local library (exIdx, normally
// EXIDX from lib/exercises.js) and clamps sets/reps/weight to sane ranges before the routine is
// shown or added. Returns null if nothing usable is left, so the caller can treat the whole
// response as a provider error rather than offering to add an empty routine.
const MAX_SETS = 10
const MAX_REPS = 100
const MAX_WEIGHT = 1000
export function sanitizeAiRoutine(routine, exIdx) {
  if (!routine || typeof routine !== 'object' || !Array.isArray(routine.ex)) return null
  const ex = routine.ex
    .filter(e => e && typeof e.id === 'string' && exIdx[e.id])
    .map(e => ({
      id: e.id,
      sets: Math.min(MAX_SETS, Math.max(1, Math.round(Number(e.sets) || 1))),
      reps: Math.min(MAX_REPS, Math.max(1, Math.round(Number(e.reps) || 1))),
      weight: Math.min(MAX_WEIGHT, Math.max(0, Math.round((Number(e.weight) || 0) * 10) / 10)),
    }))
  if (!ex.length) return null
  return {
    name: String(routine.name || '').trim().slice(0, 60) || 'AI routine',
    emoji: typeof routine.emoji === 'string' ? routine.emoji.slice(0, 4) : '✨',
    ex,
  }
}
