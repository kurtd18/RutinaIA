import test from 'node:test';
import assert from 'node:assert/strict';
import { dayReminderPush, restTimerPush, testPush, streakReminderPush } from './push-messages.js';

test('localizes every server-generated notification in pt-BR', () => {
  assert.deepEqual(restTimerPush('pt-BR'), {
    title: 'Descanso terminado 💪',
    body: 'Hora da próxima série.',
    tag: 'rest-timer',
  });
  assert.deepEqual(testPush('pt-BR'), {
    title: 'RutinaIA',
    body: 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    tag: 'test',
  });
  assert.deepEqual(dayReminderPush('pt-BR', { name: 'Treino A', emoji: '💪' }), {
    title: '💪 Treino A hoje',
    body: 'Está no seu plano — vamos treinar 💪',
    tag: 'day-reminder',
  });
  assert.deepEqual(streakReminderPush('pt-BR', 3), {
    title: 'Não perca sua sequência 🔥',
    body: 'Já se passaram 3 dias desde seu último treino.',
    tag: 'streak-reminder',
  });
});

test('keeps the existing English copy as the fallback', () => {
  assert.deepEqual(restTimerPush('fr'), restTimerPush('en'));
  assert.equal(dayReminderPush('unknown', null).title, 'Workout planned today');
  assert.equal(testPush(undefined).body, 'Test notification ✅ — this is what alerts look like.');
  assert.deepEqual(streakReminderPush('unknown', 5), streakReminderPush('en', 5));
  assert.equal(streakReminderPush('en', 3).body, "It's been 3 days since your last workout.");
});
