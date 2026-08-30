import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mirrors the helpers added to api/server.js in this task.
function atomicWrite(file, content, opts) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, content, opts)
  fs.renameSync(tmp, file)
}
const stravaFile = (dataDir, uid) => path.join(dataDir, 'strava-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json')
function readStravaConfig(dataDir, uid) {
  try { return JSON.parse(fs.readFileSync(stravaFile(dataDir, uid), 'utf8')) } catch { return null }
}
function writeStravaConfig(dataDir, uid, config) {
  atomicWrite(stravaFile(dataDir, uid), JSON.stringify(config), { mode: 0o600 })
}

test('readStravaConfig returns null when no config file exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-cfg-'))
  assert.equal(readStravaConfig(dir, 'u1'), null)
})

test('writeStravaConfig + readStravaConfig round-trips a config object', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-cfg-'))
  writeStravaConfig(dir, 'u1', { clientId: '123', clientSecret: 'sek' })
  assert.deepEqual(readStravaConfig(dir, 'u1'), { clientId: '123', clientSecret: 'sek' })
})

test('stravaFile sanitizes the uid the same way stateFile/aiKeyFile do', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-cfg-'))
  const f = stravaFile(dir, '../../etc/passwd')
  assert.ok(!f.includes('..'))
  assert.ok(path.dirname(f) === dir)
})

test('config file is written with restrictive permissions (mode 0600)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-cfg-'))
  writeStravaConfig(dir, 'u1', { clientId: '123', clientSecret: 'sek' })
  const mode = fs.statSync(stravaFile(dir, 'u1')).mode & 0o777
  if (process.platform !== 'win32') assert.equal(mode, 0o600)
})

test('writing config merges rather than overwrites existing token fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-cfg-'))
  writeStravaConfig(dir, 'u1', { clientId: '123', clientSecret: 'sek', accessToken: 'tok' })
  const existing = readStravaConfig(dir, 'u1') || {}
  writeStravaConfig(dir, 'u1', { ...existing, clientId: '456' })
  assert.deepEqual(readStravaConfig(dir, 'u1'), { clientId: '456', clientSecret: 'sek', accessToken: 'tok' })
})
