import { describe, expect, it } from 'vitest';

import { parseGroupGuardConfig } from './config.js';

const validConfig = {
  schemaVersion: 1,
  directory: {
    taxonomyPath: 'config/taxonomy.example.json',
    source: 'config/directory.example.json',
    cachePath: 'data/groupguard/directory.json',
  },
  groups: {
    'community-alpha@g.us': {
      directoryEnabled: true,
      moderation: {
        guards: [{ id: 'no-spam', enabled: true, params: { maxMessages: 5, windowSeconds: 10 } }],
      },
    },
  },
};

describe('GroupGuard configuration', () => {
  it('applies safe defaults to a valid group profile', () => {
    const config = parseGroupGuardConfig(validConfig);
    const group = config.groups['community-alpha@g.us'];

    expect(group).toMatchObject({ directoryEnabled: true, forwardUnmatchedToAgent: false });
    expect(group?.moderation).toMatchObject({
      observationMode: true,
      adminExempt: true,
      notifyOnDelete: false,
      minimumObservationHours: 24,
    });
    expect(config.directory).toMatchObject({ model: 'qwen3:4b', refreshHours: 24, minimumConfidence: 0.72 });
  });

  it('rejects private-chat IDs and unknown guards', () => {
    expect(() =>
      parseGroupGuardConfig({ ...validConfig, groups: { 'private-chat@s.whatsapp.net': validConfig.groups['community-alpha@g.us'] } }),
    ).toThrow(/group/i);
    expect(() =>
      parseGroupGuardConfig({
        ...validConfig,
        groups: {
          'community-alpha@g.us': { moderation: { guards: [{ id: 'invented-guard', enabled: true }] } },
        },
      }),
    ).toThrow(/guard/i);
  });

  it('rejects attempts to unlock enforcement inside the group policy file', () => {
    expect(() =>
      parseGroupGuardConfig({
        ...validConfig,
        groups: {
          'community-alpha@g.us': {
            moderation: { guards: [], enforcementUnlocked: true },
          },
        },
      }),
    ).toThrow(/enforcementUnlocked/);
  });
});
