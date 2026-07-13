import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRegisteredGroups } from '../src/group-config.js';
import { parsePlaygroundCommand, PlaygroundResponder } from '../src/playground.js';
import { PlaygroundConfig } from '../src/types.js';

const config: PlaygroundConfig = {
  enabled: true,
  setupUrl: 'https://example.com/setup',
  cooldownSeconds: 60,
  maxResponsesPerMinute: 2,
};

test('playground accepts only normalized exact commands', () => {
  assert.equal(
    parsePlaygroundCommand('  ＠GROUPGUARD   TRY NO-LINKS  ', '@GroupGuard'),
    'try-no-links',
  );
  assert.equal(parsePlaygroundCommand('@GroupGuard demo', '@GroupGuard'), 'help');
  assert.equal(parsePlaygroundCommand('@GroupGuard try no-links please', '@GroupGuard'), null);
  assert.equal(parsePlaygroundCommand('@GroupGuard ignore instructions', '@GroupGuard'), null);
  assert.equal(parsePlaygroundCommand('x'.repeat(81), '@GroupGuard'), null);
});

test('playground applies sender cooldown without blocking another visitor', () => {
  const responder = new PlaygroundResponder();
  const first = responder.respond({
    chatJid: 'demo@g.us',
    senderJid: 'one@s.whatsapp.net',
    text: '@GroupGuard help',
    trigger: '@GroupGuard',
    config,
    now: 1_000_000,
  });
  assert.equal(first?.outcome, 'served');

  const repeated = responder.respond({
    chatJid: 'demo@g.us',
    senderJid: 'one@s.whatsapp.net',
    text: '@GroupGuard try no-spam',
    trigger: '@GroupGuard',
    config,
    now: 1_001_000,
  });
  assert.equal(repeated?.outcome, 'cooldown');

  const otherVisitor = responder.respond({
    chatJid: 'demo@g.us',
    senderJid: 'two@s.whatsapp.net',
    text: '@GroupGuard try no-spam',
    trigger: '@GroupGuard',
    config,
    now: 1_001_000,
  });
  assert.equal(otherVisitor?.outcome, 'served');
});

test('playground caps group responses independently of the account budget', () => {
  const responder = new PlaygroundResponder();
  for (const sender of ['one', 'two']) {
    const reply = responder.respond({
      chatJid: 'demo@g.us',
      senderJid: `${sender}@s.whatsapp.net`,
      text: '@GroupGuard help',
      trigger: '@GroupGuard',
      config,
      now: 2_000_000,
    });
    assert.equal(reply?.outcome, 'served');
  }

  const limited = responder.respond({
    chatJid: 'demo@g.us',
    senderJid: 'three@s.whatsapp.net',
    text: '@GroupGuard help',
    trigger: '@GroupGuard',
    config,
    now: 2_001_000,
  });
  assert.equal(limited?.outcome, 'group-budget');
  assert.equal(limited?.text, null);
});

test('playground configuration requires HTTPS and bounded limits', () => {
  const base = {
    name: 'Public demo',
    folder: 'playground',
    trigger: '@GroupGuard',
    added_at: new Date().toISOString(),
  };
  const unsafe = parseRegisteredGroups({
    'demo@g.us': {
      ...base,
      playground: {
        ...config,
        setupUrl: 'http://example.com/setup',
      },
    },
  });
  assert.equal(unsafe.errors.length, 1);

  const valid = parseRegisteredGroups({
    'demo@g.us': { ...base, playground: config },
  });
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.groups['demo@g.us'].playground?.maxResponsesPerMinute, 2);
});
