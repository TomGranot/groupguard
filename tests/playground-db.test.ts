import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('playground ledger deduplicates commands and preserves rate limits', async () => {
  const originalDirectory = process.cwd();
  const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-playground-'));

  try {
    process.chdir(testDirectory);
    const {
      claimPlaygroundEvent,
      finishPlaygroundEvent,
      getPlaygroundRateUsage,
      initDatabase,
    } = await import('../src/db.js');
    initDatabase();

    const timestamp = '2026-07-13T12:00:00.000Z';
    const claim = {
      event_key: 'playground:demo:first',
      chat_jid: 'demo@g.us',
      message_id: 'first',
      actor_hash: 'actor-one',
      command: 'help',
      timestamp,
    };
    assert.equal(claimPlaygroundEvent(claim), true);
    assert.equal(claimPlaygroundEvent(claim), false);

    assert.deepEqual(
      getPlaygroundRateUsage({
        chatJid: 'demo@g.us',
        actorHash: 'actor-one',
        actorSince: '2026-07-13T11:59:00.000Z',
        groupSince: '2026-07-13T11:59:00.000Z',
      }),
      { actorResponses: 1, groupResponses: 1 },
    );

    assert.equal(claimPlaygroundEvent({
      ...claim,
      event_key: 'playground:demo:second',
      message_id: 'second',
      timestamp: '2026-07-13T12:00:01.000Z',
    }), true);
    finishPlaygroundEvent('playground:demo:second', 'cooldown');

    assert.deepEqual(
      getPlaygroundRateUsage({
        chatJid: 'demo@g.us',
        actorHash: 'actor-one',
        actorSince: '2026-07-13T11:59:00.000Z',
        groupSince: '2026-07-13T11:59:00.000Z',
      }),
      { actorResponses: 1, groupResponses: 1 },
    );
  } finally {
    process.chdir(originalDirectory);
    fs.rmSync(testDirectory, { recursive: true, force: true });
  }
});
