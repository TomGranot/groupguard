import assert from 'node:assert/strict';
import test from 'node:test';

import { AccountSafetyController } from '../src/account-safety.js';
import {
  createSafeGroup,
  parseRegisteredGroups,
  SAFE_MODERATION_DEFAULTS,
} from '../src/group-config.js';

function controller(): AccountSafetyController {
  return new AccountSafetyController({
    budgets: {
      message: { limit: 2, windowMs: 1_000 },
      moderation: { limit: 1, windowMs: 1_000 },
      'moderation-dm': { limit: 1, windowMs: 10_000 },
    },
    failureThreshold: 2,
    circuitCooldownMs: 5_000,
  });
}

test('reserves action budget before the network call', () => {
  const safety = controller();
  assert.equal(safety.reserve('message', 1_000).allowed, true);
  assert.equal(safety.reserve('message', 1_100).allowed, true);

  const denied = safety.reserve('message', 1_200);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'budget-exhausted');
  assert.equal(safety.reserve('message', 2_001).allowed, true);
});

test('opens a global circuit after consecutive failures', () => {
  const safety = controller();
  assert.equal(safety.recordFailure(1_000), false);
  assert.equal(safety.recordFailure(1_100), true);

  const denied = safety.reserve('moderation', 1_200);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'circuit-open');
  assert.equal(safety.reserve('moderation', 6_101).allowed, true);
});

test('safe group defaults cannot enforce or DM', () => {
  assert.equal(SAFE_MODERATION_DEFAULTS.observationMode, true);
  assert.equal(SAFE_MODERATION_DEFAULTS.adminExempt, true);
  assert.equal(SAFE_MODERATION_DEFAULTS.notifyOnDelete, false);

  const group = createSafeGroup('Family', 'family');
  assert.deepEqual(group.guards?.map((guard) => guard.guardId), ['no-spam']);
  assert.equal(group.moderationConfig?.observationMode, true);
});

test('invalid group configuration fails closed', () => {
  const parsed = parseRegisteredGroups({
    '123@g.us': {
      name: 'Unsafe',
      folder: '../../escape',
      trigger: '@GroupGuard',
      added_at: new Date().toISOString(),
    },
  });
  assert.deepEqual(parsed.groups, {});
  assert.equal(parsed.errors.length, 1);
});

test('unsafe guard thresholds and regex filters are rejected', () => {
  const base = {
    name: 'Unsafe',
    folder: 'unsafe',
    trigger: '@GroupGuard',
    added_at: new Date().toISOString(),
  };
  const invalidThreshold = parseRegisteredGroups({
    '123@g.us': {
      ...base,
      guards: [{ guardId: 'no-spam', enabled: true, params: { maxMessages: -1 } }],
    },
  });
  assert.equal(invalidThreshold.errors.length, 1);

  const regexFilter = parseRegisteredGroups({
    '123@g.us': {
      ...base,
      guards: [{ guardId: 'keyword-filter', enabled: true, params: { patterns: ['(a+)+$'] } }],
    },
  });
  assert.equal(regexFilter.errors.length, 1);
});

test('two groups cannot share an agent folder', () => {
  const group = {
    name: 'One',
    folder: 'shared',
    trigger: '@GroupGuard',
    added_at: new Date().toISOString(),
  };
  const parsed = parseRegisteredGroups({
    'one@g.us': group,
    'two@g.us': { ...group, name: 'Two' },
  });
  assert.equal(Object.keys(parsed.groups).length, 1);
  assert.equal(parsed.errors.length, 1);
});
