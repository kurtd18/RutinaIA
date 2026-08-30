import { test } from 'node:test'
import assert from 'node:assert/strict'

// Mirrors the pure response-mapping logic inside stravaTokenRequest in api/server.js.
function mapStravaTokenResponse(status, body) {
  if (status !== 200) return null
  try {
    const parsed = JSON.parse(body)
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      expiresAt: parsed.expires_at,
      athleteId: parsed.athlete?.id,
    }
  } catch { return null }
}

test('mapStravaTokenResponse maps a successful token exchange response', () => {
  const body = JSON.stringify({
    access_token: 'acc123', refresh_token: 'ref456', expires_at: 1735689600,
    athlete: { id: 987654 },
  })
  assert.deepEqual(mapStravaTokenResponse(200, body), {
    accessToken: 'acc123', refreshToken: 'ref456', expiresAt: 1735689600, athleteId: 987654,
  })
})

test('mapStravaTokenResponse maps a refresh response with no athlete field', () => {
  const body = JSON.stringify({ access_token: 'acc123', refresh_token: 'ref456', expires_at: 1735689600 })
  assert.deepEqual(mapStravaTokenResponse(200, body), {
    accessToken: 'acc123', refreshToken: 'ref456', expiresAt: 1735689600, athleteId: undefined,
  })
})

test('mapStravaTokenResponse returns null on a non-200 status', () => {
  assert.equal(mapStravaTokenResponse(401, '{}'), null)
})

test('mapStravaTokenResponse returns null on malformed JSON', () => {
  assert.equal(mapStravaTokenResponse(200, 'not json'), null)
})
