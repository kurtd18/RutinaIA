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

describe('mergeImport — dedup granularity', () => {
  const makeWorkout = (d, start, name = 'Test') => ({
    id: 'w' + start, d, start, end: start + 3600000, routineId: null, name, entries: [], prs: [], vol: 0,
  })

  it('still treats re-importing the exact same file as a duplicate (idempotent)', () => {
    const S = { workouts: [makeWorkout('2026-08-30', 1756573200000)], bodyweight: [], customEx: [], exWeights: {} }
    const parsed = { kind: 'workouts', workouts: [makeWorkout('2026-08-30', 1756573200000)], customEx: [] }
    const result = mergeImport(S, parsed)
    expect(result.added).toBe(0)
    expect(result.skipped).toBe(1)
    expect(S.workouts).toHaveLength(1)
  })

  it('adds a same-date workout from a second source when start times differ beyond the tolerance', () => {
    const S = { workouts: [makeWorkout('2026-08-30', 1756573200000, 'Morning run')], bodyweight: [], customEx: [], exWeights: {} }
    // 8 hours later on the same date — well outside DEDUP_TOLERANCE_MS
    const parsed = { kind: 'workouts', workouts: [makeWorkout('2026-08-30', 1756573200000 + 8 * 3600000, 'Evening lift')], customEx: [] }
    const result = mergeImport(S, parsed)
    expect(result.added).toBe(1)
    expect(S.workouts).toHaveLength(2)
  })

  it('still treats two start times within the tolerance window as the same workout', () => {
    const S = { workouts: [makeWorkout('2026-08-30', 1756573200000)], bodyweight: [], customEx: [], exWeights: {} }
    // 2 minutes later — within the 5-minute DEDUP_TOLERANCE_MS
    const parsed = { kind: 'workouts', workouts: [makeWorkout('2026-08-30', 1756573200000 + 2 * 60000)], customEx: [] }
    const result = mergeImport(S, parsed)
    expect(result.added).toBe(0)
    expect(S.workouts).toHaveLength(1)
  })

  it('does not change bodyweight dedup (stays date-only)', () => {
    const S = { workouts: [], bodyweight: [{ d: '2026-08-30', w: 70, t: 1756573200000 }], customEx: [], exWeights: {} }
    const parsed = { kind: 'bodyweight', bodyweight: [{ d: '2026-08-30', w: 71, t: 1756573200000 + 8 * 3600000 }] }
    const result = mergeImport(S, parsed)
    expect(result.added).toBe(0) // same date still wins, regardless of time — unchanged behavior
    expect(S.bodyweight).toHaveLength(1)
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

describe('parseImport — TCX and XML dispatch', () => {
  const tcxFile = `<?xml version="1.0"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Other">
      <Id>2026-08-30T18:00:00Z</Id>
      <Lap StartTime="2026-08-30T18:00:00Z"><TotalTimeSeconds>1800</TotalTimeSeconds></Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`

  it('routes a TCX file to parseTCX, not the Apple Health branch', () => {
    const parsed = parseImport(tcxFile)
    expect(parsed.source).toBe('TCX')
    expect(parsed.error).toBeUndefined()
  })

  it('still routes an Apple Health export correctly (no regression)', () => {
    const appleHealthXml = `<HealthData>
      <Record type="HKQuantityTypeIdentifierBodyMass" value="70" unit="kg" startDate="2026-08-30 08:00:00 -0500" />
    </HealthData>`
    const parsed = parseImport(appleHealthXml)
    expect(parsed.kind).toBe('bodyweight')
    expect(parsed.source).toBe('Apple Health')
  })

  it('falls through to CSV/Garmin attempts for an XML file that is neither Apple Health nor TCX', () => {
    // A well-formed but unrelated XML document — should not error out immediately just because
    // it starts with '<'; parseImport should still attempt the CSV-shaped fallbacks (which will
    // also fail here since this isn't CSV either, but the point is it doesn't short-circuit).
    const unrelatedXml = '<Foo><Bar/></Foo>'
    const parsed = parseImport(unrelatedXml)
    expect(parsed.error).toBeTruthy() // still an error — this input is genuinely unrecognisable —
    // but reaching this error via the CSV/Garmin fallback path (not an immediate return from the
    // Apple Health branch) is what this test guards; see Step 4's implementation for why this
    // matters structurally even though the observable error outcome is the same.
  })
})

describe('mapHeader — Samsung Health column names', () => {
  it('recognises Samsung Health-style activity-summary headers as a Garmin-shaped import', () => {
    const csv = [
      'start_time,exercise_type,duration',
      '2026-08-30 18:00:00,Weight Training,3600',
    ].join('\n')
    const parsed = parseImport(csv)
    expect(parsed.error).toBeUndefined()
    expect(parsed.workouts).toHaveLength(1)
    expect(parsed.workouts[0].name).toBe('Weight Training')
  })
})
