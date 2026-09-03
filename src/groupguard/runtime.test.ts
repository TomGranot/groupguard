import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GroupGuardConfig } from './config.js';
import { DirectoryResponder } from './directory/responder.js';
import { GroupGuardRuntime } from './runtime.js';
import { AccountSafetyController, EffectLedger } from './reliability/effects.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function config(overrides: Partial<GroupGuardConfig['groups'][string]> = {}): GroupGuardConfig {
  return {
    schemaVersion: 1,
    directory: {
      taxonomyPath: 'config/taxonomy.example.json',
      source: 'config/directory.example.json',
      cachePath: 'data/groupguard/directory.json',
      model: 'qwen3:4b',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      minimumConfidence: 0.72,
      refreshHours: 24,
      keepAlive: '25h',
    },
    groups: {
      'community-alpha@g.us': {
        directoryEnabled: true,
        forwardUnmatchedToAgent: false,
        moderation: {
          guards: [],
          observationMode: true,
          adminExempt: true,
          notifyOnDelete: false,
          dmCooldownSeconds: 300,
          minimumObservationHours: 24,
          observationStartedAt: '2026-01-01T00:00:00Z',
        },
        ...overrides,
      },
    },
    accountSafety: {
      budgets: {
        reply: { limit: 8, windowMs: 60_000 },
        'moderation-delete': { limit: 12, windowMs: 60_000 },
        'moderation-dm': { limit: 6, windowMs: 3_600_000 },
      },
      failureThreshold: 3,
      circuitCooldownMs: 900_000,
    },
  };
}

const directoryResponder = new DirectoryResponder({
  taxonomy: {
    version: 'example-v1',
    categories: [{ id: 'home-moving', title: 'Home moving', aliases: ['movers'] }],
  },
  snapshot: {
    version: 'directory-v1',
    providers: [
      {
        id: 'provider-a',
        categoryIds: ['home-moving'],
        name: 'Northwind Moving',
        contacts: [{ label: 'Website', value: 'https://northwind.example.test' }],
      },
    ],
  },
  classifier: { classify: vi.fn().mockResolvedValue(null) },
});

const event = {
  id: 'message-example-1',
  groupId: 'community-alpha@g.us',
  senderId: 'member-example',
  text: 'movers',
  contentType: 'conversation',
  isForwarded: false,
  isVoiceNote: false,
  timestamp: new Date('2026-01-15T12:00:00Z'),
};

async function createRuntime(runtimeConfig = config()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'groupguard-runtime-'));
  temporaryDirectories.push(directory);
  const ledger = new EffectLedger(path.join(directory, 'effects.db'));
  const sendMessage = vi.fn().mockResolvedValue('platform-reply-1');
  const deleteMessage = vi.fn().mockResolvedValue(undefined);
  const runtime = new GroupGuardRuntime({
    config: runtimeConfig,
    ledger,
    safety: new AccountSafetyController(runtimeConfig.accountSafety),
    directoryResponder: () => directoryResponder,
    sendMessage,
    deleteMessage,
    resolveAdminState: vi.fn().mockResolvedValue({ verified: true, senderIsAdmin: false }),
    enforcementEnabled: true,
    now: () => new Date('2026-01-15T12:00:00Z'),
  });
  return { runtime, ledger, sendMessage, deleteMessage };
}

describe('GroupGuard runtime', () => {
  it('delivers one durable directory response for a matching request', async () => {
    const { runtime, ledger, sendMessage } = await createRuntime();

    await expect(runtime.handle(event)).resolves.toMatchObject({ handled: true, directoryReplied: true });
    await expect(runtime.handle(event)).resolves.toMatchObject({ handled: true, duplicate: true });

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith('community-alpha@g.us', expect.stringContaining('🤖 *Home moving*'));
    expect(ledger.get('directory:community-alpha@g.us:message-example-1')).toMatchObject({ status: 'delivered' });
    ledger.close();
  });

  it('consumes irrelevant chatter unless the operator enables agent forwarding', async () => {
    const { runtime, ledger, sendMessage } = await createRuntime();
    const irrelevant = { ...event, id: 'message-example-2', text: 'Good morning' };

    await expect(runtime.handle(irrelevant)).resolves.toEqual({ handled: true });
    expect(sendMessage).not.toHaveBeenCalled();
    ledger.close();

    const forwardingConfig = config({ forwardUnmatchedToAgent: true });
    const forwarding = await createRuntime(forwardingConfig);
    await expect(forwarding.runtime.handle(irrelevant)).resolves.toEqual({ handled: false });
    forwarding.ledger.close();
  });

  it('deletes only after observation and the operator lock are both satisfied', async () => {
    const moderation = {
      guards: [{ id: 'no-links' as const, enabled: true }],
      observationMode: false,
      adminExempt: true,
      notifyOnDelete: false,
      dmCooldownSeconds: 300,
      minimumObservationHours: 24,
      observationStartedAt: '2026-01-01T00:00:00Z',
    };
    const { runtime, ledger, deleteMessage } = await createRuntime(config({ directoryEnabled: false, moderation }));

    await expect(runtime.handle({ ...event, text: 'https://example.test' })).resolves.toMatchObject({
      handled: true,
      moderationAction: 'delete',
    });
    expect(deleteMessage).toHaveBeenCalledOnce();
    ledger.close();
  });

  it('observes instead of deleting before the minimum observation period', async () => {
    const moderation = {
      guards: [{ id: 'no-links' as const, enabled: true }],
      observationMode: false,
      adminExempt: true,
      notifyOnDelete: false,
      dmCooldownSeconds: 300,
      minimumObservationHours: 24,
      observationStartedAt: '2026-01-15T11:30:00Z',
    };
    const { runtime, ledger, deleteMessage } = await createRuntime(config({ directoryEnabled: false, moderation }));

    await expect(runtime.handle({ ...event, text: 'https://example.test' })).resolves.toMatchObject({
      moderationAction: 'observe',
    });
    expect(deleteMessage).not.toHaveBeenCalled();
    ledger.close();
  });
});
