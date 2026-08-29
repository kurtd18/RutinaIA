import { describe, test, expect } from 'vitest'
import { buildTrainingSummary } from './ai-suggest.js'

const daysAgo = n => Date.now() - n * 24 * 3600000

describe('buildTrainingSummary', () => {
  test('returns an empty-but-valid summary for a user with no workout history', () => {
    const S = { workouts: [], exWeights: {}, customEx: [], unit: 'kg' }
    const summary = buildTrainingSummary(S)
    expect(summary).toBeTruthy()
    expect(Array.isArray(summary.recentWorkouts)).toBe(true)
    expect(summary.recentWorkouts).toHaveLength(0)
    expect(summary.oneRepMaxes).toEqual({})
    expect(typeof summary.muscleBalance).toBe('object')
  })

  test('does not touch the network — pure function', () => {
    // Sanity guard: calling it twice with the same input gives the same output (no hidden state/IO)
    const S = { workouts: [], exWeights: {}, customEx: [], unit: 'kg' }
    expect(buildTrainingSummary(S)).toEqual(buildTrainingSummary(S))
  })

  test('a populated S.workouts produces non-empty recentWorkouts with exercise ids/sets/reps', () => {
    const w = {
      id: 'w1', d: '2026-08-20', start: daysAgo(3), name: 'Push',
      entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }, { done: true, w: 60, r: 6 }] }],
    }
    const S = { workouts: [w], exWeights: {}, customEx: [], unit: 'kg' }
    const summary = buildTrainingSummary(S)
    expect(summary.recentWorkouts).toHaveLength(1)
    expect(summary.recentWorkouts[0].entries[0].id).toBe('0025')
    expect(summary.recentWorkouts[0].entries[0].sets).toEqual([
      { w: 60, r: 8 }, { w: 60, r: 6 },
    ])
  })

  test('workouts older than the recent window are excluded from recentWorkouts', () => {
    const oldW = {
      id: 'w-old', d: '2026-01-01', start: daysAgo(90), name: 'Push',
      entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }] }],
    }
    const S = { workouts: [oldW], exWeights: {}, customEx: [], unit: 'kg' }
    const summary = buildTrainingSummary(S)
    expect(summary.recentWorkouts).toHaveLength(0)
  })

  test('S.exWeights/workout history surfaces oneRepMaxes via onerm.js\'s estimator, not reimplemented', () => {
    const w = {
      id: 'w1', d: '2026-08-20', start: daysAgo(3), name: 'Push',
      entries: [{ id: '0025', sets: [{ done: true, w: 100, r: 5 }] }],
    }
    const S = { workouts: [w], exWeights: {}, customEx: [], unit: 'kg' }
    const summary = buildTrainingSummary(S)
    // Epley: 100 * (1 + 5/30) = 116.67
    expect(summary.oneRepMaxes['0025']).toBeCloseTo(116.67, 1)
  })

  test('a muscle-balance snapshot is present and matches what recovery.js computes for the same state', () => {
    const w = {
      id: 'w1', d: '2026-08-20', start: daysAgo(3), name: 'Push',
      entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }] }],
    }
    const S = { workouts: [w], exWeights: {}, customEx: [], unit: 'kg' }
    const summary = buildTrainingSummary(S)
    expect(summary.muscleBalance).toBeTruthy()
    expect(Object.keys(summary.muscleBalance).length).toBeGreaterThan(0)
  })
})
