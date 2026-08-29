import { test } from 'node:test'
import assert from 'node:assert/strict'

// Mirrors the pure helpers added to api/server.js in this task.
function buildAnthropicRequestBody(summary, goals) {
  return {
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            emoji: { type: 'string' },
            ex: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  sets: { type: 'integer' },
                  reps: { type: 'integer' },
                  weight: { type: 'number' },
                  mode: { type: 'string', enum: ['reps'] },
                },
                required: ['id', 'sets', 'reps', 'weight', 'mode'],
                additionalProperties: false,
              },
            },
          },
          required: ['name', 'emoji', 'ex'],
          additionalProperties: false,
        },
      },
    },
    messages: [{
      role: 'user',
      content: `Training summary:\n${JSON.stringify(summary)}\n\nGoals: ${goals}\n\nPropose a single weekly routine as the specified JSON shape.`,
    }],
  }
}

function mapAnthropicResponse(status, body) {
  if (status !== 200) return { ok: false, error: 'provider error' }
  let parsed
  try { parsed = JSON.parse(body) } catch { return { ok: false, error: 'provider error' } }
  if (parsed.stop_reason === 'refusal') return { ok: false, error: 'declined' }
  const textBlock = (parsed.content || []).find(b => b.type === 'text')
  if (!textBlock) return { ok: false, error: 'provider error' }
  let routine
  try { routine = JSON.parse(textBlock.text) } catch { return { ok: false, error: 'provider error' } }
  return { ok: true, routine }
}

test('buildAnthropicRequestBody uses claude-opus-5 and structured output, not prefill', () => {
  const req = buildAnthropicRequestBody({ workouts: [] }, 'build muscle')
  assert.equal(req.model, 'claude-opus-5')
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.ok(!req.messages.some(m => m.role === 'assistant'))
})

test('mapAnthropicResponse maps a refusal stop_reason to a declined error', () => {
  const body = JSON.stringify({ stop_reason: 'refusal', content: [] })
  assert.deepEqual(mapAnthropicResponse(200, body), { ok: false, error: 'declined' })
})

test('mapAnthropicResponse maps a non-200 status to a provider error', () => {
  assert.deepEqual(mapAnthropicResponse(500, '{}'), { ok: false, error: 'provider error' })
})

test('mapAnthropicResponse parses a successful structured-output routine', () => {
  const routine = { name: 'Push Day', emoji: '💪', ex: [{ id: '0025', sets: 3, reps: 8, weight: 60, mode: 'reps' }] }
  const body = JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(routine) }] })
  assert.deepEqual(mapAnthropicResponse(200, body), { ok: true, routine })
})

test('mapAnthropicResponse handles malformed JSON in the text block', () => {
  const body = JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] })
  assert.deepEqual(mapAnthropicResponse(200, body), { ok: false, error: 'provider error' })
})
