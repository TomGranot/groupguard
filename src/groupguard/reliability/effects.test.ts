import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AccountSafetyController, EffectLedger } from './effects.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('GroupGuard effect ledger', () => {
  it('claims one durable reply per inbound message across restarts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'groupguard-effects-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'effects.db');
    const first = new EffectLedger(databasePath);

    expect(
      first.claim({
        effectKey: 'directory:community-alpha:message-example-1',
        groupId: 'community-alpha@g.us',
        inboundId: 'message-example-1',
        kind: 'directory-reply',
        payload: '🤖 *Home moving*',
      }).claimed,
    ).toBe(true);
    first.close();

    const reopened = new EffectLedger(databasePath);
    const duplicate = reopened.claim({
      effectKey: 'directory:community-alpha:message-example-1',
      groupId: 'community-alpha@g.us',
      inboundId: 'message-example-1',
      kind: 'directory-reply',
      payload: 'a different payload must not replace the first',
    });

    expect(duplicate.claimed).toBe(false);
    expect(duplicate.record.payload).toBe('🤖 *Home moving*');
    reopened.close();
  });

  it('records delivered and ambiguous outcomes without chat content', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'groupguard-effects-'));
    temporaryDirectories.push(directory);
    const ledger = new EffectLedger(path.join(directory, 'effects.db'));
    ledger.claim({
      effectKey: 'directory:community-alpha:message-example-2',
      groupId: 'community-alpha@g.us',
      inboundId: 'message-example-2',
      kind: 'directory-reply',
      payload: 'Rendered response',
    });

    ledger.markUnknown('directory:community-alpha:message-example-2', 'Delivery timed out');

    expect(ledger.get('directory:community-alpha:message-example-2')).toMatchObject({
      status: 'unknown',
      error: 'Delivery timed out',
    });
    ledger.close();
  });
});

describe('GroupGuard account safety', () => {
  it('reserves attempts before the network call and opens a shared circuit', () => {
    const safety = new AccountSafetyController({
      budgets: {
        reply: { limit: 1, windowMs: 60_000 },
        'moderation-delete': { limit: 2, windowMs: 60_000 },
        'moderation-dm': { limit: 1, windowMs: 3_600_000 },
      },
      failureThreshold: 2,
      circuitCooldownMs: 300_000,
    });

    expect(safety.reserve('reply', 1_000).allowed).toBe(true);
    expect(safety.reserve('reply', 1_001)).toMatchObject({ allowed: false, reason: 'budget-exhausted' });
    expect(safety.recordFailure(2_000)).toBe(false);
    expect(safety.recordFailure(2_001)).toBe(true);
    expect(safety.reserve('moderation-delete', 2_002)).toMatchObject({ allowed: false, reason: 'circuit-open' });
  });
});
