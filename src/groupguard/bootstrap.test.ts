import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupGuardService } from './bootstrap.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('GroupGuard service bootstrap', () => {
  it('loads a sanitized local configuration and handles an allowlisted group', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'groupguard-service-'));
    temporaryDirectories.push(projectRoot);
    await mkdir(path.join(projectRoot, 'config'));
    await writeFile(
      path.join(projectRoot, 'config', 'taxonomy.json'),
      JSON.stringify({ version: 'example-v1', categories: [{ id: 'home-moving', title: 'Home moving', aliases: ['movers'] }] }),
    );
    await writeFile(
      path.join(projectRoot, 'config', 'directory.json'),
      JSON.stringify({
        version: 'directory-v1',
        providers: [
          {
            id: 'provider-a',
            categoryIds: ['home-moving'],
            name: 'Northwind Moving',
            contacts: [{ label: 'Website', value: 'https://northwind.example.test' }],
          },
        ],
      }),
    );
    await writeFile(
      path.join(projectRoot, 'config', 'groupguard.json'),
      JSON.stringify({
        schemaVersion: 1,
        directory: {
          taxonomyPath: 'config/taxonomy.json',
          source: 'config/directory.json',
          cachePath: 'data/groupguard/directory.json',
        },
        groups: {
          'community-alpha@g.us': { directoryEnabled: true, moderation: { guards: [] } },
        },
      }),
    );
    const sendMessage = vi.fn().mockResolvedValue('platform-reply-1');
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const service = await GroupGuardService.create({
      projectRoot,
      configPath: 'config/groupguard.json',
      enforcementEnabled: false,
      sendMessage,
      deleteMessage: vi.fn(),
      resolveAdminState: vi.fn().mockResolvedValue({ verified: true, senderIsAdmin: false }),
      fetchImpl,
    });

    expect([...service.allowedGroups]).toEqual(['community-alpha@g.us']);
    await expect(
      service.handle({
        id: 'message-example-1',
        groupId: 'community-alpha@g.us',
        senderId: 'member-example',
        text: 'movers',
        contentType: 'conversation',
        isForwarded: false,
        isVoiceNote: false,
        timestamp: new Date('2026-01-15T12:00:00Z'),
      }),
    ).resolves.toMatchObject({ directoryReplied: true });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/generate',
      expect.objectContaining({ method: 'POST' }),
    );
    service.close();
  });
});
