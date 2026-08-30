import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV, parseGarminCSV, parseTCX, detectSource, parseImport, mergeImport } from './import-csv.js'

const CSV = [
  'Date,Exercise,Weight,Reps,Set Type',
  '2026-08-08,Bench Press,100,5,Warm-up',
  '2026.08.08,Bench Press,80,5,Working',
  '8 Aug 2026,Bench Press,80,5,Working',
  '2026/08/08,Bench Press,85,3,Working',
].join('\n')

describe('CSV warm-up provenance', () => {
  it('retains the imported warm-up phase and excludes it from topW', () => {
    const parsed = parseWorkoutCSV(CSV, { unit: 'kg' })
    const entry = parsed.workouts[0].entries[0]

    expect(parsed.warmups).toBe(1)
    expect(entry.sets).toEqual([
      { w: 100, r: 5, done: true, phase: 'warmup' },
      { w: 80, r: 5, done: true },
      { w: 80, r: 5, done: true },
      { w: 85, r: 3, done: true },
    ])
    expect(entry.topW).toBe(85)
  })
})

// gravl writes its units in parentheses ("Weight (kg)", "Set Duration (sec)"). Header text is
// normalised before it is matched, so the alias table has to hold the normalised form — an alias
// written with the parentheses can never match. Sample rows are from the gravl export in !21.
const GRAVL = [
  'Date,Start Date,Workout,Source,Workout Duration (min),Energy,Exercise,Superset,Set,Set Type,Reps,Weight (kg),Distance (km),Set Duration (sec),Incline,Steps,Effort,Workout Notes',
  '2026/01/01,1:11 PM,Push Day,,11,11,Chin Up,No,1,Normal,11,11,0,,,,Ideal,felt strong',
  '2026/01/22,2:22 PM,External Something,APP,21,22,Walking,No,0,Normal,0,0,0,22,,,,',
].join('\n')

describe('gravl export', () => {
  it('reads slash dates, parenthesised weight and per-set duration', () => {
    const parsed = parseWorkoutCSV(GRAVL, { unit: 'kg' })

    expect(parsed.skipped).toBe(0)
    expect(parsed.from).toBe('2026-01-01')
    expect(parsed.to).toBe('2026-01-22')

    const [lift, cardio] = parsed.workouts
    expect(lift.name).toBe('Push Day')
    expect(lift.entries[0].sets).toEqual([{ w: 11, r: 11, done: true }])

    // "Set Duration (sec)" is seconds, not minutes: read as `time` it would land as 22 minutes.
    expect(cardio.entries[0].sets).toEqual([{ min: 0.4, speed: 0, done: true }])
  })
})

describe('parseGarminCSV', () => {
  it('creates empty-entries workouts from a Garmin-shaped activity summary', () => {
    const csv = 'Date,Activity Type,Title,Time,Calories\n' +
      '2026-08-10 06:32:00,Strength Training,Morning Lift,00:45:00,320\n' +
      '2026-08-12 07:00:00,Running,,00:30:00,280\n'
    const parsed = parseGarminCSV(csv)
    expect(parsed.error).toBeUndefined()
    expect(parsed.kind).toBe('workouts')
    expect(parsed.source).toBe('Garmin')
    expect(parsed.workouts).toHaveLength(2)
    expect(parsed.workouts[0].d).toBe('2026-08-10')
    expect(parsed.workouts[0].name).toBe('Morning Lift')
    expect(parsed.workouts[0].entries).toEqual([])
    expect(parsed.workouts[1].name).toBe('Running')
    expect(parsed.sets).toBe(0)
    expect(parsed.matched).toBe(0)
  })

  it('computes end time from duration', () => {
    const csv = 'Date,Title,Time\n2026-08-10 06:00:00,Lift,00:45:00\n'
    const parsed = parseGarminCSV(csv)
    expect(parsed.workouts[0].end - parsed.workouts[0].start).toBe(45 * 60000)
  })

  it('missing duration leaves end equal to start', () => {
    const csv = 'Date,Title\n2026-08-10,Lift\n'
    const parsed = parseGarminCSV(csv)
    expect(parsed.workouts[0].end).toBe(parsed.workouts[0].start)
  })

  it('merges same-date rows into one workout', () => {
    const csv = 'Date,Activity Type,Time\n' +
      '2026-08-10 06:00:00,Strength Training,00:30:00\n' +
      '2026-08-10 18:00:00,Running,00:20:00\n'
    const parsed = parseGarminCSV(csv)
    expect(parsed.workouts).toHaveLength(1)
    expect(parsed.workouts[0].name).toBe('Strength Training + Running')
  })

  it('rejects a file with an exercise column (not a Garmin summary)', () => {
    const csv = 'Date,Exercise,Weight,Reps\n2026-08-10,Squat,100,5\n'
    expect(parseGarminCSV(csv).error).toBe('unrecognised')
  })

  it('rejects a file with no date or title/type column', () => {
    const csv = 'Foo,Bar\n1,2\n'
    expect(parseGarminCSV(csv).error).toBe('unrecognised')
  })

  it('rejects an empty file', () => {
    expect(parseGarminCSV('Date,Title\n').error).toBe('empty')
  })
})

describe('detectSource — Garmin', () => {
  it('recognises a Garmin-shaped header', () => {
    expect(detectSource(['Date', 'Activity Type', 'Title', 'Time'])).toBe('Garmin')
  })
  it('does not misclassify a per-set export as Garmin', () => {
    expect(detectSource(['Date', 'Exercise', 'Weight', 'Reps'])).not.toBe('Garmin')
  })
})

describe('parseImport — Garmin fallback', () => {
  it('routes a Garmin-shaped file through parseGarminCSV', () => {
    const csv = 'Date,Activity Type,Title,Time\n2026-08-10 06:00:00,Strength Training,Morning Lift,00:45:00\n'
    const parsed = parseImport(csv, { unit: 'kg' })
    expect(parsed.source).toBe('Garmin')
    expect(parsed.kind).toBe('workouts')
    expect(parsed.workouts[0].entries).toEqual([])
  })

  it('a per-set export still wins over the Garmin fallback', () => {
    const csv = 'workout name,exercise,date,weight kg,reps\nLeg Day,Squat,2026-08-21,120,5\n'
    const parsed = parseImport(csv, { unit: 'kg' })
    expect(parsed.source).not.toBe('Garmin')
    expect(parsed.workouts[0].entries[0].sets[0].w).toBe(120)
  })

  it('a bodyweight export still wins over the Garmin fallback', () => {
    const csv = 'date,weight kg\n2026-08-21,82.5\n'
    const parsed = parseImport(csv, { unit: 'kg' })
    expect(parsed.kind).toBe('bodyweight')
  })

  it('a genuinely unrecognisable file still reports the original error', () => {
    const csv = 'Foo,Bar\n1,2\n'
    const parsed = parseImport(csv, { unit: 'kg' })
    expect(parsed.error).toBe('unrecognised')
  })
})

describe('mergeImport — Garmin placeholder workouts', () => {
  it('re-importing the same Garmin file twice adds nothing the second time', () => {
    const csv = 'Date,Title\n2026-08-10,Morning Lift\n'
    const parsed = parseGarminCSV(csv)
    const S = { workouts: [], customEx: [], exWeights: {} }
    const first = mergeImport(S, parsed)
    expect(first.added).toBe(1)
    const second = mergeImport(S, parseGarminCSV(csv))
    expect(second.added).toBe(0)
    expect(S.workouts).toHaveLength(1)
  })
})

describe('parseTCX', () => {
  const tcx = (activities) => `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    ${activities}
  </Activities>
</TrainingCenterDatabase>`

  it('parses a single activity into one placeholder workout', () => {
    const xml = tcx(`
      <Activity Sport="Other">
        <Id>2026-08-30T18:00:00Z</Id>
        <Lap StartTime="2026-08-30T18:00:00Z">
          <TotalTimeSeconds>3600</TotalTimeSeconds>
        </Lap>
      </Activity>
    `)
    const parsed = parseTCX(xml)
    expect(parsed.kind).toBe('workouts')
    expect(parsed.source).toBe('TCX')
    expect(parsed.workouts).toHaveLength(1)
    const w = parsed.workouts[0]
    expect(w.d).toBe('2026-08-30')
    expect(w.name).toBe('Other')
    expect(w.entries).toEqual([])
    expect(w.end - w.start).toBe(3600000)
  })

  it('merges multiple activities on the same date into one workout, summing lap time', () => {
    const xml = tcx(`
      <Activity Sport="Strength Training">
        <Id>2026-08-30T08:00:00Z</Id>
        <Lap StartTime="2026-08-30T08:00:00Z"><TotalTimeSeconds>1800</TotalTimeSeconds></Lap>
      </Activity>
      <Activity Sport="Running">
        <Id>2026-08-30T18:00:00Z</Id>
        <Lap StartTime="2026-08-30T18:00:00Z"><TotalTimeSeconds>1200</TotalTimeSeconds></Lap>
      </Activity>
    `)
    const parsed = parseTCX(xml)
    expect(parsed.workouts).toHaveLength(1)
    const w = parsed.workouts[0]
    expect(w.name).toBe('Strength Training + Running')
    expect(w.start).toBeLessThan(w.end)
  })

  it('sums multiple laps within one activity', () => {
    const xml = tcx(`
      <Activity Sport="Other">
        <Id>2026-08-30T08:00:00Z</Id>
        <Lap StartTime="2026-08-30T08:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds></Lap>
        <Lap StartTime="2026-08-30T08:10:00Z"><TotalTimeSeconds>900</TotalTimeSeconds></Lap>
      </Activity>
    `)
    const parsed = parseTCX(xml)
    expect(parsed.workouts[0].end - parsed.workouts[0].start).toBe(1500000)
  })

  it('skips an activity with no parseable Id and counts it', () => {
    const xml = tcx(`
      <Activity Sport="Other">
        <Lap StartTime="2026-08-30T08:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds></Lap>
      </Activity>
    `)
    const parsed = parseTCX(xml)
    expect(parsed.error).toBe('unrecognised')
  })

  it('returns an error for a file with no TrainingCenterDatabase marker', () => {
    expect(parseTCX('<Foo></Foo>').error).toBeTruthy()
  })

  it('returns an empty-file error for an empty string', () => {
    expect(parseTCX('').error).toBeTruthy()
  })
})
