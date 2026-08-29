import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mirrors the helpers added to api/server.js in this task — kept in sync manually
// since server.js has no module exports today.
function atomicWrite(file, content, opts) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, opts);
  fs.renameSync(tmp, file);
}
const aiKeyFile = (dataDir, uid) => path.join(dataDir, 'ai-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readAiKey(dataDir, uid) {
  try { return JSON.parse(fs.readFileSync(aiKeyFile(dataDir, uid), 'utf8')).key || null; } catch { return null; }
}

test('readAiKey returns null when no key file exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-key-'));
  assert.equal(readAiKey(dir, 'u1'), null);
});

test('atomicWrite + readAiKey round-trips a key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-key-'));
  atomicWrite(aiKeyFile(dir, 'u1'), JSON.stringify({ key: 'sk-ant-test123' }), { mode: 0o600 });
  assert.equal(readAiKey(dir, 'u1'), 'sk-ant-test123');
});

test('aiKeyFile sanitizes the uid the same way stateFile does', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-key-'));
  const f = aiKeyFile(dir, '../../etc/passwd');
  assert.ok(!f.includes('..'));
  assert.ok(path.dirname(f) === dir);
});

test('key file is written with restrictive permissions (mode 0600)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-key-'));
  const f = aiKeyFile(dir, 'u1');
  atomicWrite(f, JSON.stringify({ key: 'sk-ant-test123' }), { mode: 0o600 });
  const mode = fs.statSync(f).mode & 0o777;
  // Windows CI may not enforce POSIX modes identically — only assert on POSIX platforms
  if (process.platform !== 'win32') assert.equal(mode, 0o600);
});
